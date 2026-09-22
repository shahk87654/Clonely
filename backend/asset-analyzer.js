const cheerio = require("cheerio");

const EXTENSIONS = {
  images: /\.(avif|gif|ico|jpe?g|png|webp)(\?|$)/i,
  fonts: /\.(eot|otf|ttf|woff2?)(\?|$)/i,
  videos: /\.(m4v|mov|mp4|ogv|webm)(\?|$)/i,
  audio: /\.(m4a|mp3|oga|ogg|wav)(\?|$)/i,
  svg: /\.svg(\?|$)/i,
  documents: /\.pdf(\?|$)/i,
  data: /\.json(\?|$)/i,
  manifests: /\.(webmanifest|manifest)(\?|$)/i,
};

function resolveAsset(value, baseUrl) {
  if (!value || /^(data:|blob:|javascript:|#)/i.test(value)) return null;
  try {
    return new URL(value, baseUrl).href;
  } catch {
    return null;
  }
}

function analyzeAssets(html, baseUrl) {
  const $ = cheerio.load(html);
  const origin = new URL(baseUrl).origin;
  const groups = {
    images: new Set(),
    css: new Set(),
    js: new Set(),
    fonts: new Set(),
    videos: new Set(),
    icons: new Set(),
    svg: new Set(),
    audio: new Set(),
    documents: new Set(),
    data: new Set(),
    manifests: new Set(),
    externalCdn: new Set(),
  };

  function add(group, value) {
    const resolved = resolveAsset(value, baseUrl);
    if (!resolved) return;
    groups[group].add(resolved);
    if (new URL(resolved).origin !== origin) groups.externalCdn.add(resolved);
  }

  $("img[src], source[src], input[type='image'][src]").each((_, element) => {
    const value = $(element).attr("src");
    add(EXTENSIONS.svg.test(value || "") ? "svg" : "images", value);
  });
  $("link[rel='stylesheet'][href]").each((_, element) =>
    add("css", $(element).attr("href")),
  );
  $("script[src]").each((_, element) => add("js", $(element).attr("src")));
  $("video[src], video source[src]").each((_, element) =>
    add("videos", $(element).attr("src")),
  );
  $("link[rel*='icon'][href]").each((_, element) =>
    add("icons", $(element).attr("href")),
  );
  $("link[rel='manifest'][href]").each((_, element) =>
    add("manifests", $(element).attr("href")),
  );
  $("a[href]").each((_, element) => {
    const value = $(element).attr("href") || "";
    if (EXTENSIONS.documents.test(value)) add("documents", value);
    if (EXTENSIONS.data.test(value)) add("data", value);
    if (EXTENSIONS.manifests.test(value)) add("manifests", value);
  });
  $("audio[src], audio source[src]").each((_, element) =>
    add("audio", $(element).attr("src")),
  );
  $("svg").each((index) => groups.svg.add(`inline-svg-${index + 1}`));

  $("[src], [href]").each((_, element) => {
    const value = $(element).attr("src") || $(element).attr("href") || "";
    if (EXTENSIONS.fonts.test(value)) add("fonts", value);
    if (EXTENSIONS.videos.test(value)) add("videos", value);
    if (EXTENSIONS.svg.test(value)) add("svg", value);
  });

  const inlineCssCount = $("style").length;
  const inlineJsCount = $("script:not([src])").length;

  return {
    images: [...groups.images],
    css: [...groups.css],
    js: [...groups.js],
    fonts: [...groups.fonts],
    videos: [...groups.videos],
    icons: [...groups.icons],
    svg: [...groups.svg],
    audio: [...groups.audio],
    documents: [...groups.documents],
    data: [...groups.data],
    manifests: [...groups.manifests],
    externalCdnAssets: [...groups.externalCdn],
    inlineCssCount,
    inlineJsCount,
    counts: {
      images: groups.images.size,
      css: groups.css.size + inlineCssCount,
      js: groups.js.size + inlineJsCount,
      fonts: groups.fonts.size,
      videos: groups.videos.size,
      icons: groups.icons.size,
      svg: groups.svg.size,
      audio: groups.audio.size,
      documents: groups.documents.size,
      data: groups.data.size,
      manifests: groups.manifests.size,
      externalCdnAssets: groups.externalCdn.size,
    },
  };
}

function analyzeWebsiteAssets(pages, baseUrl) {
  const analyses = (pages || []).map((page) =>
    analyzeAssets(page.html, page.url || baseUrl),
  );
  if (!analyses.length) return analyzeAssets("", baseUrl);

  const keys = [
    "images",
    "css",
    "js",
    "fonts",
    "videos",
    "icons",
    "svg",
    "audio",
    "documents",
    "data",
    "manifests",
    "externalCdnAssets",
  ];
  const merged = Object.fromEntries(keys.map((key) => [key, new Set()]));
  let inlineCssCount = 0;
  let inlineJsCount = 0;

  analyses.forEach((analysis) => {
    keys.forEach((key) =>
      analysis[key].forEach((value) => merged[key].add(value)),
    );
    inlineCssCount += analysis.inlineCssCount;
    inlineJsCount += analysis.inlineJsCount;
  });

  return {
    ...Object.fromEntries(keys.map((key) => [key, [...merged[key]]])),
    inlineCssCount,
    inlineJsCount,
    counts: {
      images: merged.images.size,
      css: merged.css.size + inlineCssCount,
      js: merged.js.size + inlineJsCount,
      fonts: merged.fonts.size,
      videos: merged.videos.size,
      icons: merged.icons.size,
      svg: merged.svg.size,
      audio: merged.audio.size,
      documents: merged.documents.size,
      data: merged.data.size,
      manifests: merged.manifests.size,
      externalCdnAssets: merged.externalCdnAssets.size,
    },
  };
}

module.exports = { analyzeAssets, analyzeWebsiteAssets };
