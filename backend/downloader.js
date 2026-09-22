const path = require("path");
const crypto = require("crypto");
const axios = require("axios");
const fs = require("fs-extra");
const { USER_AGENT } = require("./analyzer");

const ASSET_ATTRIBUTES = [
  ["link[href]", "href", "document"],
  ["script[src]", "src", "script"],
  ["img[src]", "src", "image"],
  ["source[src]", "src", "media"],
  ["video[src]", "src", "video"],
  ["audio[src]", "src", "media"],
  ["video[poster]", "poster", "image"],
];

const IMAGE_EXTENSIONS = /\.(avif|gif|ico|jpe?g|png|svg|webp)(\?|$)/i;
const VIDEO_EXTENSIONS = /\.(m4v|mov|mp4|ogv|webm)(\?|$)/i;
const FONT_EXTENSIONS = /\.(eot|otf|ttf|woff2?)(\?|$)/i;

function safeFilename(assetUrl, contentType) {
  const parsed = new URL(assetUrl);
  let extension = path.extname(parsed.pathname).slice(0, 12);
  const name = path.basename(parsed.pathname, extension) || "asset";
  const cleanName = name.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50) || "asset";

  if (!extension) {
    const knownTypes = {
      "text/css": ".css",
      "application/javascript": ".js",
      "text/javascript": ".js",
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/gif": ".gif",
      "image/svg+xml": ".svg",
      "image/webp": ".webp",
      "image/x-icon": ".ico",
      "font/woff": ".woff",
      "font/woff2": ".woff2",
    };
    extension = knownTypes[(contentType || "").split(";")[0]] || "";
  }

  const hash = crypto.createHash("sha1").update(assetUrl).digest("hex").slice(0, 10);
  return `${cleanName}-${hash}${extension}`;
}

function resolveAssetUrl(value, baseUrl) {
  if (!value || /^(data:|blob:|javascript:|mailto:|tel:|#)/i.test(value)) {
    return null;
  }

  try {
    const resolved = new URL(value, baseUrl);
    return ["http:", "https:"].includes(resolved.protocol) ? resolved.href : null;
  } catch {
    return null;
  }
}

async function fetchAsset(assetUrl) {
  return axios.get(assetUrl, {
    responseType: "arraybuffer",
    timeout: 15000,
    maxRedirects: 5,
    maxContentLength: 25 * 1024 * 1024,
    headers: {
      "User-Agent": USER_AGENT,
      Referer: new URL(assetUrl).origin,
    },
  });
}

function shouldDownload(job, options) {
  if (job.kind === "image" || IMAGE_EXTENSIONS.test(job.assetUrl)) {
    return options.downloadImages !== false;
  }
  if (job.kind === "video" || VIDEO_EXTENSIONS.test(job.assetUrl)) {
    return options.downloadVideos !== false;
  }
  if (FONT_EXTENSIONS.test(job.assetUrl)) {
    return options.downloadFonts !== false;
  }
  return true;
}

async function rewriteCssUrls(
  css,
  stylesheetUrl,
  destination,
  downloaded,
  options,
) {
  const references = [
    ...css.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi),
  ];
  let rewritten = css;
  let addedCount = 0;

  for (const match of references) {
    const originalValue = match[2].trim();
    const assetUrl = resolveAssetUrl(originalValue, stylesheetUrl);
    if (!assetUrl || !shouldDownload({ assetUrl }, options)) continue;

    try {
      let localPath = downloaded.get(assetUrl);
      if (!localPath) {
        const response = await fetchAsset(assetUrl);
        const filename = safeFilename(assetUrl, response.headers["content-type"]);
        localPath = `assets/${filename}`;
        await fs.writeFile(path.join(destination, localPath), response.data);
        downloaded.set(assetUrl, localPath);
        addedCount += 1;
      }
      rewritten = rewritten.split(originalValue).join(path.basename(localPath));
    } catch {
      // Preserve remote CSS references that cannot be downloaded.
    }
  }

  return { css: rewritten, addedCount };
}

async function downloadAssets($, baseUrl, destination, options = {}) {
  const assetsDirectory = path.join(destination, "assets");
  await fs.ensureDir(assetsDirectory);

  const jobs = [];
  for (const [selector, attribute, kind] of ASSET_ATTRIBUTES) {
    $(selector).each((_, element) => {
      const value = $(element).attr(attribute);
      const assetUrl = resolveAssetUrl(value, baseUrl);
      if (assetUrl) jobs.push({ element, attribute, assetUrl, kind });
    });
  }

  $("[srcset]").each((_, element) => {
    const entries = ($(element).attr("srcset") || "").split(",");
    for (const entry of entries) {
      const [value] = entry.trim().split(/\s+/);
      const assetUrl = resolveAssetUrl(value, baseUrl);
      if (assetUrl && options.downloadImages !== false) {
        jobs.push({
          element,
          attribute: "srcset",
          assetUrl,
          originalValue: value,
        });
      }
    }
  });

  const downloaded = new Map();
  let assetCount = 0;

  for (const job of jobs) {
    if (!shouldDownload(job, options)) continue;

    try {
      let localPath = downloaded.get(job.assetUrl);
      if (!localPath) {
        const response = await fetchAsset(job.assetUrl);
        const filename = safeFilename(
          job.assetUrl,
          response.headers["content-type"],
        );
        localPath = `assets/${filename}`;
        let contents = response.data;
        const isCss =
          String(response.headers["content-type"]).includes("text/css") ||
          localPath.endsWith(".css");
        if (isCss && options.rewriteCss !== false) {
          const cssResult = await rewriteCssUrls(
            response.data.toString("utf8"),
            job.assetUrl,
            destination,
            downloaded,
            options,
          );
          contents = cssResult.css;
          assetCount += cssResult.addedCount;
        }
        await fs.writeFile(path.join(destination, localPath), contents);
        downloaded.set(job.assetUrl, localPath);
        assetCount += 1;
      }

      if (job.attribute === "srcset") {
        const current = $(job.element).attr("srcset") || "";
        $(job.element).attr(
          "srcset",
          current.replace(job.originalValue, localPath),
        );
      } else {
        $(job.element).attr(job.attribute, localPath);
      }
    } catch {
      // Leave unavailable assets pointing to their original URL.
      if (job.attribute !== "srcset") {
        $(job.element).attr(job.attribute, job.assetUrl);
      }
    }
  }

  return { html: $.html(), assetCount };
}

module.exports = { downloadAssets };
