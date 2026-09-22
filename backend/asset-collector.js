const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const cheerio = require("cheerio");
const fs = require("fs-extra");

const TYPE_DIRECTORIES = {
  image: "images",
  icon: "icons",
  css: "css",
  js: "js",
  font: "fonts",
  video: "videos",
  svg: "svg",
  audio: "audio",
  document: "documents",
  manifest: "manifests",
  data: "data",
};

const EXTENSION_TYPES = [
  ["font", /\.(eot|otf|ttf|woff2?)(\?|$)/i],
  ["video", /\.(m4v|mov|mp4|ogv|webm)(\?|$)/i],
  ["audio", /\.(m4a|mp3|oga|ogg|wav)(\?|$)/i],
  ["svg", /\.svg(\?|$)/i],
  ["manifest", /\.(webmanifest|manifest)(\?|$)/i],
  ["document", /\.pdf(\?|$)/i],
  ["data", /\.json(\?|$)/i],
  ["icon", /\.ico(\?|$)/i],
  ["image", /\.(avif|gif|ico|jpe?g|png|webp)(\?|$)/i],
  ["css", /\.css(\?|$)/i],
  ["js", /\.m?js(\?|$)/i],
];

const CONTENT_TYPE_EXTENSIONS = {
  "text/css": ".css",
  "application/javascript": ".js",
  "text/javascript": ".js",
  "application/pdf": ".pdf",
  "application/json": ".json",
  "application/manifest+json": ".webmanifest",
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/gif": ".gif",
  "image/svg+xml": ".svg",
  "image/x-icon": ".ico",
  "image/vnd.microsoft.icon": ".ico",
  "image/webp": ".webp",
  "font/woff": ".woff",
  "font/woff2": ".woff2",
  "video/mp4": ".mp4",
  "video/webm": ".webm",
  "audio/mpeg": ".mp3",
  "audio/ogg": ".ogg",
  "audio/wav": ".wav",
};

function resolveAsset(value, baseUrl) {
  if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) {
    return null;
  }
  try {
    const url = new URL(value, baseUrl);
    return ["http:", "https:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function inferType(url, fallback = "image") {
  return EXTENSION_TYPES.find(([, pattern]) => pattern.test(url))?.[0] || fallback;
}

function safeFilename(url, contentType) {
  const parsed = new URL(url);
  let extension = path.extname(parsed.pathname).slice(0, 12);
  if (!extension) {
    extension =
      CONTENT_TYPE_EXTENSIONS[String(contentType || "").split(";")[0]] || "";
  }
  const base =
    path
      .basename(parsed.pathname, path.extname(parsed.pathname))
      .replace(/[^a-zA-Z0-9_-]/g, "-")
      .slice(0, 50) || "asset";
  const hash = crypto.createHash("sha1").update(url).digest("hex").slice(0, 10);
  return `${base}-${hash}${extension}`;
}

function allowedType(type, options) {
  if (["image", "svg", "icon"].includes(type))
    return options.downloadImages !== false;
  if (type === "video") return options.downloadVideos !== false;
  if (type === "font") return options.downloadFonts !== false;
  return true;
}

async function collectAssets(pages, destination, options = {}) {
  const assetRoot = path.join(destination, "assets");
  await Promise.all(
    Object.values(TYPE_DIRECTORIES).map((directory) =>
      fs.ensureDir(path.join(assetRoot, directory)),
    ),
  );

  const documents = pages.map((page) => ({
    ...page,
    $: cheerio.load(page.html, { decodeEntities: false }),
    references: [],
  }));
  const jobs = new Map();

  function register(document, element, attribute, value, fallbackType) {
    const url = resolveAsset(value, document.url);
    if (!url) return;
    const type = inferType(url, fallbackType);
    if (!allowedType(type, options)) return;
    const reference = { element, attribute, original: value, url, type };
    document.references.push(reference);
    if (!jobs.has(url)) jobs.set(url, { url, type });
  }

  documents.forEach((document) => {
    const $ = document.$;
    $("link[rel='stylesheet'][href]").each((_, element) =>
      register(document, element, "href", $(element).attr("href"), "css"),
    );
    $("link[rel='manifest'][href]").each((_, element) =>
      register(document, element, "href", $(element).attr("href"), "manifest"),
    );
    $("link[rel*='icon'][href]").each((_, element) =>
      register(document, element, "href", $(element).attr("href"), "icon"),
    );
    $("script[src]").each((_, element) =>
      register(document, element, "src", $(element).attr("src"), "js"),
    );
    $("img[src], input[type='image'][src]").each((_, element) =>
      register(document, element, "src", $(element).attr("src"), "image"),
    );
    $("video[src]").each((_, element) =>
      register(document, element, "src", $(element).attr("src"), "video"),
    );
    $("audio[src]").each((_, element) =>
      register(document, element, "src", $(element).attr("src"), "audio"),
    );
    $("video[poster]").each((_, element) =>
      register(document, element, "poster", $(element).attr("poster"), "image"),
    );
    $("source[src]").each((_, element) =>
      register(
        document,
        element,
        "src",
        $(element).attr("src"),
        $(element).closest("video").length
          ? "video"
          : $(element).closest("audio").length
            ? "audio"
            : "image",
      ),
    );
    $("a[href]").each((_, element) => {
      const value = $(element).attr("href") || "";
      if (/\.pdf(\?|$)/i.test(value)) {
        register(document, element, "href", value, "document");
      } else if (/\.json(\?|$)/i.test(value)) {
        register(document, element, "href", value, "data");
      } else if (/\.(webmanifest|manifest)(\?|$)/i.test(value)) {
        register(document, element, "href", value, "manifest");
      }
    });
    $("[srcset]").each((_, element) => {
      const srcset = $(element).attr("srcset") || "";
      srcset.split(",").forEach((entry) => {
        const value = entry.trim().split(/\s+/)[0];
        register(document, element, "srcset", value, "image");
      });
    });
  });

  const downloaded = new Map();
  const inFlight = new Map();
  const failedAssets = [];
  const counts = {
    images: 0,
    icons: 0,
    css: 0,
    js: 0,
    fonts: 0,
    videos: 0,
    svg: 0,
    audio: 0,
    documents: 0,
    manifests: 0,
    data: 0,
  };

  function countKey(type) {
    return {
      image: "images",
      icon: "icons",
      css: "css",
      js: "js",
      font: "fonts",
      video: "videos",
      svg: "svg",
      audio: "audio",
      document: "documents",
      manifest: "manifests",
      data: "data",
    }[type];
  }

  async function downloadOne(url, requestedType) {
    if (downloaded.has(url)) return downloaded.get(url);
    if (inFlight.has(url)) return inFlight.get(url);

    const promise = (async () => {
      try {
        const response = await axios.get(url, {
          timeout: 15000,
          maxRedirects: 5,
          maxContentLength: 30 * 1024 * 1024,
          responseType: "arraybuffer",
          headers: {
            "User-Agent":
              "Mozilla/5.0 (compatible; WebsiteRebuilderAIPro/1.0)",
            Referer: new URL(url).origin,
          },
        });
        const contentType = response.headers["content-type"] || "";
        const resolvedType =
          contentType.includes("text/css")
            ? "css"
            : contentType.includes("javascript")
              ? "js"
              : contentType.includes("font")
                ? "font"
                : contentType.includes("video")
                  ? "video"
                  : contentType.includes("audio")
                    ? "audio"
                    : contentType.includes("pdf")
                      ? "document"
                      : contentType.includes("json")
                        ? "data"
                        : contentType.includes("manifest")
                          ? "manifest"
                  : contentType.includes("svg")
                    ? "svg"
                    : requestedType;
        if (!allowedType(resolvedType, options)) return null;

        const filename = safeFilename(url, contentType);
        const directory = TYPE_DIRECTORIES[resolvedType] || "images";
        const relativePath = `assets/${directory}/${filename}`;
        const record = { url, type: resolvedType, filename, relativePath };
        downloaded.set(url, record);

        let contents = response.data;
        if (resolvedType === "css" && options.rewriteCss !== false) {
          let css = response.data.toString("utf8");
          const matches = [
            ...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi),
          ];
          for (const match of matches) {
            const nestedOriginal = match[2].trim();
            const nestedUrl = resolveAsset(nestedOriginal, url);
            if (!nestedUrl) continue;
            const nestedType = inferType(nestedUrl, "image");
            if (!allowedType(nestedType, options)) continue;
            const nested = await downloadOne(nestedUrl, nestedType);
            if (nested) {
              css = css
                .split(nestedOriginal)
                .join(`../${TYPE_DIRECTORIES[nested.type]}/${nested.filename}`);
            }
          }
          contents = css;
        }

        await fs.writeFile(path.join(destination, relativePath), contents);
        counts[countKey(resolvedType)] += 1;
        return record;
      } catch (error) {
        failedAssets.push({
          url,
          type: requestedType,
          error: error.message,
          status: error.response?.status || 0,
        });
        return null;
      } finally {
        inFlight.delete(url);
      }
    })();

    inFlight.set(url, promise);
    return promise;
  }

  const queue = [...jobs.values()];
  let cursor = 0;
  const workers = Array.from(
    { length: Math.min(6, Math.max(1, queue.length)) },
    async () => {
      while (cursor < queue.length) {
        const job = queue[cursor++];
        await downloadOne(job.url, job.type);
      }
    },
  );
  await Promise.all(workers);

  const rewrittenPages = documents.map((document) => {
    const $ = document.$;
    document.references.forEach((reference) => {
      const local = downloaded.get(reference.url);
      if (!local) {
        if (reference.attribute !== "srcset") {
          $(reference.element).attr(reference.attribute, reference.url);
        }
        return;
      }
      if (reference.attribute === "srcset") {
        const current = $(reference.element).attr("srcset") || "";
        $(reference.element).attr(
          "srcset",
          current.split(reference.original).join(local.relativePath),
        );
      } else {
        $(reference.element).attr(reference.attribute, local.relativePath);
      }
    });
    return {
      ...document,
      $: undefined,
      references: undefined,
      html: $.html(),
    };
  });

  return {
    pages: rewrittenPages,
    counts,
    assetCount: Object.values(counts).reduce((total, count) => total + count, 0),
    downloadedAssets: [...downloaded.values()],
    failedAssets,
  };
}

module.exports = {
  collectAssets,
  inferType,
  resolveAsset,
};
