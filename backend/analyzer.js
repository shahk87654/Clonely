const axios = require("axios");
const cheerio = require("cheerio");
const { analyzeAssets } = require("./asset-analyzer");
const { detectComponents } = require("./component-detector");

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebsiteRebuilderAIPro/1.0; +https://localhost)";

function includesAny(value, patterns) {
  const normalized = String(value || "").toLowerCase();
  return patterns.some((pattern) => normalized.includes(pattern));
}

function safeText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function clampScore(value) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function analyzeDomStructure($) {
  const semanticSelectors = [
    { name: "header", selector: "header", confidence: 98 },
    { name: "nav", selector: "nav", confidence: 98 },
    { name: "main", selector: "main", confidence: 98 },
    { name: "footer", selector: "footer", confidence: 98 },
    { name: "article", selector: "article", confidence: 90 },
    { name: "section", selector: "section", confidence: 80 },
    { name: "aside", selector: "aside", confidence: 88 },
  ];

  const semanticSections = semanticSelectors
    .map(({ name, selector, confidence }) => {
      const count = $(selector).length;
      return count
        ? {
            name,
            count,
            confidence: clampScore(confidence + Math.min(3, count - 1)),
          }
        : null;
    })
    .filter(Boolean);

  const repeatedBlocks = [];
  const siblingGroups = new Map();
  $("body *").each((_, element) => {
    const parent = $(element).parent();
    if (!parent.length) return;
    const tag = element.tagName || element.name || "unknown";
    const className = safeText($(element).attr("class"));
    const idName = safeText($(element).attr("id"));
    const signature = `${parent.get(0)?.tagName || parent.get(0)?.name || "root"}::${tag}::${className}::${idName}`;
    if (!siblingGroups.has(signature)) siblingGroups.set(signature, []);
    siblingGroups.get(signature).push(element);
  });

  siblingGroups.forEach((elements, signature) => {
    if (elements.length < 2) return;
    const count = elements.length;
    const confidence = clampScore(70 + Math.min(20, count * 3));
    repeatedBlocks.push({
      signature,
      count,
      confidence,
    });
  });

  const forms = $("form").length;
  const buttons = $("button, [role='button'], input[type='button'], input[type='submit']").length;
  const cards = $("[class*='card'], [class*='tile'], article, .card").length;
  const tables = $("table").length;

  return {
    semanticSections,
    repeatedBlocks: repeatedBlocks.slice(0, 20),
    forms: {
      count: forms,
      confidence: forms ? clampScore(82 + Math.min(10, forms * 2)) : 0,
    },
    buttons: {
      count: buttons,
      confidence: buttons ? clampScore(78 + Math.min(10, buttons)) : 0,
    },
    cards: {
      count: cards,
      confidence: cards ? clampScore(75 + Math.min(15, cards / 2)) : 0,
    },
    tables: {
      count: tables,
      confidence: tables ? clampScore(85 + Math.min(10, tables * 2)) : 0,
    },
    totalSections: semanticSections.length,
  };
}

function analyzeLayout($, html) {
  const source = html.toLowerCase();
  const hasSidebar = $("aside, [class*='sidebar'], [id*='sidebar']").length > 0;
  const hasHero = $("[class*='hero'], [id*='hero'], [class*='jumbotron']").length > 0;
  const hasCards = $("[class*='card'], article").length >= 3;
  const hasGrid = $("[class*='grid'], [class*='row'], [class*='columns'], [style*='grid']").length > 0;
  const hasDashboardSignals = includesAny(source, [
    "dashboard",
    "analytics",
    "stats",
    "kpi",
    "metric",
    "chart",
    "overview",
    "reports",
    "revenue",
    "performance",
  ]);
  const hasBlogSignals = includesAny(source, [
    "blog",
    "post",
    "author",
    "comments",
    "latest news",
    "news",
  ]);
  const hasEcommerceSignals = includesAny(source, [
    "product",
    "shop",
    "cart",
    "checkout",
    "price",
    "woocommerce",
    "sale",
  ]);
  const hasDocsSignals = includesAny(source, [
    "documentation",
    "docs",
    "api",
    "reference",
    "guide",
    "toc",
    "table of contents",
  ]);
  const hasPortfolioSignals = includesAny(source, [
    "portfolio",
    "projects",
    "case study",
    "gallery",
  ]);

  let pageType = "corporate";
  let typeConfidence = 55;
  if (hasDashboardSignals) {
    pageType = "dashboard";
    typeConfidence = 90;
  } else if (hasEcommerceSignals) {
    pageType = "ecommerce";
    typeConfidence = 90;
  } else if (hasBlogSignals) {
    pageType = "blog";
    typeConfidence = 88;
  } else if (hasDocsSignals) {
    pageType = "documentation";
    typeConfidence = 88;
  } else if (hasPortfolioSignals) {
    pageType = "portfolio";
    typeConfidence = 86;
  } else if (
    hasHero &&
    !hasSidebar &&
    !hasDashboardSignals &&
    !hasBlogSignals &&
    !hasEcommerceSignals &&
    !hasDocsSignals
  ) {
    pageType = "landing";
    typeConfidence = 80;
  }

  let layoutPattern = "single-column";
  let patternConfidence = 60;
  if (hasSidebar && (hasDashboardSignals || hasDocsSignals || (!hasCards && !hasGrid))) {
    layoutPattern = "sidebar";
    patternConfidence = 90;
  } else if (hasHero && $("main").length) {
    layoutPattern = "hero-first";
    patternConfidence = 84;
  } else if (hasCards || hasGrid) {
    layoutPattern = "grid";
    patternConfidence = 82;
  }

  if ($("[class*='two-column'], [class*='split'], [class*='dual-column'], [style*='flex']").length) {
    layoutPattern = "two-column";
    patternConfidence = 82;
  }
  if (hasCards && $("main article, article").length >= 4) {
    layoutPattern = "card-heavy";
    patternConfidence = 88;
  }

  return {
    pageType,
    pageTypeConfidence: typeConfidence,
    layoutPattern,
    layoutPatternConfidence: patternConfidence,
    signals: {
      hasSidebar,
      hasHero,
      hasCards,
      hasGrid,
      hasDashboardSignals,
      hasBlogSignals,
      hasEcommerceSignals,
      hasDocsSignals,
      hasPortfolioSignals,
    },
  };
}

function analyzeSeo($, html, finalUrl) {
  const title = safeText($("title").first().text());
  const description = safeText($('meta[name="description"]').attr("content"));
  const canonical = safeText($('link[rel="canonical"]').attr("href"));
  const ogTags = $(
    'meta[property^="og:"], meta[name^="og:"]',
  ).length;
  const twitterTags = $(
    'meta[name^="twitter:"]',
  ).length;
  const schemaScripts = $('script[type="application/ld+json"]').length;
  const robotsHint = safeText($('meta[name="robots"]').attr("content"));
  const sitemapHint =
    $('link[rel="sitemap"]').attr("href") ||
    (includesAny(html, ["sitemap.xml"]) ? "present" : "");
  const headings = $("h1, h2, h3, h4, h5, h6")
    .map((_, element) => Number((element.tagName || element.name || "h0").replace("h", "")))
    .get();
  const h1Count = $("h1").length;
  const headingOrderIssues = headings.reduce((count, level, index) => {
    const prev = headings[index - 1];
    if (!prev) return count;
    return level > prev + 1 ? count + 1 : count;
  }, 0);

  let score = 0;
  if (title) score += 20;
  if (title.length >= 20 && title.length <= 65) score += 10;
  if (description) score += 20;
  if (description.length >= 50 && description.length <= 180) score += 10;
  if (h1Count === 1) score += 10;
  if (canonical) score += 10;
  if (ogTags >= 4) score += 8;
  if (twitterTags >= 2) score += 5;
  if (schemaScripts > 0) score += 5;
  if (robotsHint) score += 2;
  if (sitemapHint) score += 2;
  score -= Math.min(10, headingOrderIssues * 3);

  return {
    title,
    description,
    h1Count,
    headingOrderIssues,
    canonical,
    ogTags,
    twitterTags,
    schemaCount: schemaScripts,
    robotsHint,
    sitemapHint,
    score: clampScore(score),
    issues: {
      missingTitle: !title,
      missingDescription: !description,
      missingCanonical: !canonical,
      headingOrderIssues,
    },
    sourceUrl: finalUrl,
  };
}

function analyzeAccessibility($, html) {
  const images = $("img").length;
  const missingAlt = $("img")
    .filter((_, element) => !safeText($(element).attr("alt")))
    .length;
  const buttonsWithoutLabels = $(
    "button, [role='button'], input[type='button'], input[type='submit']",
  )
    .filter((_, element) => {
      const $el = $(element);
      const text = safeText($el.text());
      const aria = safeText($el.attr("aria-label"));
      const title = safeText($el.attr("title"));
      const value = safeText($el.attr("value"));
      return !(text || aria || title || value);
    })
    .length;
  const formsWithoutLabels = $("form").filter((_, form) => {
    const $form = $(form);
    const fields = $form.find("input, textarea, select");
    if (!fields.length) return false;
    const labelled = fields.filter((_, element) => {
      const $el = $(element);
      const id = safeText($el.attr("id"));
      if (!id) return false;
      return (
        $form.find(`label[for="${id}"]`).length > 0 ||
        safeText($el.attr("aria-label")) ||
        safeText($el.attr("aria-labelledby")) ||
        safeText($el.attr("title"))
      );
    }).length;
    return labelled < fields.length;
  }).length;
  const headings = $("h1, h2, h3, h4, h5, h6")
    .map((_, element) => Number((element.tagName || element.name || "h0").replace("h", "")))
    .get();
  const headingOrderIssues = headings.reduce((count, level, index) => {
    const prev = headings[index - 1];
    if (!prev) return count;
    return level > prev + 1 ? count + 1 : count;
  }, 0);
  const hasLang = $("html[lang]").length > 0;
  const ariaHints = $(
    "[aria-label], [aria-labelledby], [aria-describedby], [role]",
  ).length;

  let score = 100;
  score -= Math.min(25, missingAlt * 5);
  score -= Math.min(20, buttonsWithoutLabels * 5);
  score -= Math.min(20, formsWithoutLabels * 8);
  score -= Math.min(10, headingOrderIssues * 4);
  if (!hasLang) score -= 10;
  if (ariaHints === 0) score -= 5;

  return {
    images,
    missingAlt,
    buttonsWithoutLabels,
    formsWithoutLabels,
    headingOrderIssues,
    hasLang,
    ariaHints,
    score: clampScore(score),
    issues: {
      missingAlt,
      buttonsWithoutLabels,
      formsWithoutLabels,
      headingOrderIssues,
      missingLang: !hasLang,
    },
  };
}

function analyzePerformance($, html, assets) {
  const assetCounts = assets?.counts || {};
  const scripts = $("script[src]");
  const blockingScripts = scripts.filter((_, element) => {
    const $el = $(element);
    return !$el.attr("defer") && !$el.attr("async");
  }).length;
  const blockingStylesheets = $("link[rel='stylesheet']").length;
  const externalScriptCount = scripts.filter((_, element) => {
    const src = safeText($(element).attr("src"));
    try {
      return src && new URL(src, "https://placeholder.local").origin !== "https://placeholder.local";
    } catch {
      return false;
    }
  }).length;
  const htmlLength = html.length;
  const largeHtmlEstimate =
    htmlLength > 500000 ? "very-large" : htmlLength > 150000 ? "large" : htmlLength > 50000 ? "medium" : "small";

  let score = 100;
  score -= Math.min(20, Math.max(0, (assetCounts.css || 0) - 4) * 2);
  score -= Math.min(20, Math.max(0, (assetCounts.js || 0) - 5) * 2);
  score -= Math.min(20, Math.max(0, (assetCounts.images || 0) - 20));
  score -= Math.min(15, blockingScripts * 3);
  score -= Math.min(10, blockingStylesheets * 2);
  score -= Math.min(10, externalScriptCount * 2);
  if (htmlLength > 300000) score -= 10;
  else if (htmlLength > 100000) score -= 5;

  return {
    assetCounts: {
      images: assetCounts.images || 0,
      css: assetCounts.css || 0,
      js: assetCounts.js || 0,
      fonts: assetCounts.fonts || 0,
      videos: assetCounts.videos || 0,
      svg: assetCounts.svg || 0,
      icons: assetCounts.icons || 0,
      externalCdnAssets: assetCounts.externalCdnAssets || 0,
    },
    imageCount: assetCounts.images || 0,
    blockingCssCount: blockingStylesheets,
    blockingJsCount: blockingScripts,
    externalScriptCount,
    largeHtmlEstimate,
    htmlLength,
    score: clampScore(score),
    estimatedImpact: {
      cssBlocking: blockingStylesheets,
      jsBlocking: blockingScripts,
      largeHtml: largeHtmlEstimate,
    },
  };
}

function detectTechnologies(html, headers, finalUrl, $) {
  const source = html.toLowerCase();
  const assetUrls = $("script[src], link[href]")
    .map((_, element) => $(element).attr("src") || $(element).attr("href"))
    .get()
    .join(" ")
    .toLowerCase();
  const headerText = JSON.stringify(headers).toLowerCase();
  const detected = new Set(["HTML"]);

  if ($("link[rel='stylesheet'], style").length || source.includes("style=")) detected.add("CSS");
  if ($("script").length) detected.add("JavaScript");
  if (
    includesAny(headerText + finalUrl + assetUrls, ["php", "phpsessid", ".php"]) ||
    $('form[action*=".php"]').length
  ) {
    detected.add("PHP");
  }
  if (
    includesAny(assetUrls, ["bootstrap"]) ||
    $(
      '.container, .container-fluid, .row, [class~="col"], [class^="col-"], [class*=" col-"]',
    ).length
  ) detected.add("Bootstrap");
  if (includesAny(assetUrls + source, ["jquery", "jquery-migrate"])) detected.add("jQuery");
  if (
    includesAny(assetUrls, ["wp-content", "wp-includes", "wp-json"]) ||
    $('meta[name="generator"][content*="WordPress" i]').length ||
    includesAny(source, ["/wp-content/", "/wp-includes/", 'rel="https://api.w.org/"'])
  ) {
    detected.add("WordPress");
  }
  if (includesAny(source, ["data-reactroot", "__react", "react-dom"]) || $("#root, #react-root").length) {
    detected.add("React");
  }
  if (includesAny(source + assetUrls, ["__next_data__", "/_next/"])) {
    detected.add("Next.js");
    detected.add("React");
  }
  if (includesAny(source + assetUrls, ["vue.js", "vue.min.js", "__vue__", "data-v-", "/_nuxt/"])) {
    detected.add("Vue");
  }
  if (includesAny(source + assetUrls, ["__nuxt__", "/_nuxt/", "nuxt-link"])) {
    detected.add("Nuxt");
    detected.add("Vue");
  }
  if ($("html[ng-version], app-root, [ng-app]").length || includesAny(assetUrls, ["angular.js", "angular.min.js", "zone.js"])) {
    detected.add("Angular");
  }
  if (includesAny(source + assetUrls, ["tailwind", "cdn.tailwindcss.com", "--tw-"])) detected.add("Tailwind");
  if (
    includesAny(headerText, ["laravel_session", "laravel"]) ||
    $('meta[name="csrf-token"]').length ||
    includesAny(source, ["laravel_session"])
  ) {
    detected.add("Laravel");
    detected.add("PHP");
  }
  if (/{{\s*[^}]+\s*}}|@(extends|section|yield|include)\s*\(/i.test(html) || includesAny(assetUrls, [".blade.php"])) {
    detected.add("Blade");
    detected.add("Laravel");
    detected.add("PHP");
  }
  if (includesAny(source + assetUrls, ["livewire/livewire", "livewire.js", "wire:id=", "wire:model=", "wire:click="])) {
    detected.add("Livewire");
    detected.add("Laravel");
  }
  if (includesAny(source + assetUrls, ["elementor-", "elementor/", "data-elementor-type"])) {
    detected.add("Elementor");
    detected.add("WordPress");
  }
  if (includesAny(source + assetUrls, ["woocommerce", "wc-cart-fragments", "wc-blocks"])) {
    detected.add("WooCommerce");
    detected.add("WordPress");
  }
  if (includesAny(headerText + assetUrls, ["cloudflare", "cf-ray", "cdnjs.cloudflare.com"])) detected.add("Cloudflare");
  if (includesAny(source + assetUrls, ["fonts.googleapis.com", "fonts.gstatic.com"])) detected.add("Google Fonts");
  if (includesAny(source + assetUrls, ["fontawesome", "font-awesome", "fa-solid", "fa-regular"])) detected.add("FontAwesome");
  if (includesAny(source + assetUrls, ["swiper", "swiper-bundle"])) detected.add("Swiper");
  if (includesAny(source + assetUrls, ["shopify", "myshopify", "cdn.shopify.com", "shopify-section", "shopify-payment-button"])) {
    detected.add("Shopify");
  }
  if (includesAny(source + assetUrls, ["webflow", "data-wf-page", "data-wf-site", "webflow.js", "wf-"])) detected.add("Webflow");
  if (includesAny(source + assetUrls, ["googletagmanager.com/gtag/js", "gtag(", "ga(", "ua-", "g-"])) detected.add("Google Analytics");
  if (includesAny(source + assetUrls, ["fbq(", "fbevents.js", "facebook.com/tr"])) detected.add("Meta Pixel");
  if (includesAny(source + assetUrls, ["googletagmanager.com/gtm.js", "gtm-"])) detected.add("Tag Manager");
  if (includesAny(source + assetUrls, ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "stackpath.bootstrapcdn.com", "assets-cdn"])) detected.add("CDN");
  if (includesAny(source + assetUrls, ["youtube.com", "youtu.be", "vimeo.com", "player.vimeo.com", "wistia"])) detected.add("Video Provider");
  if (includesAny(source + assetUrls, ["maps.googleapis.com", "google.com/maps", "mapbox", "leaflet"])) detected.add("Maps");
  if (includesAny(source + assetUrls, ["stripe", "paypal", "razorpay", "squareup", "adyen", "klarna", "checkout"])) detected.add("Payment Provider");
  if ($("[x-data], [x-show], [x-bind], [x-on]").length || includesAny(assetUrls, ["alpinejs", "alpine.js"])) detected.add("Alpine.js");
  if ($("[data-aos]").length || includesAny(assetUrls, ["aos.js", "aos.css"])) detected.add("AOS");
  if (includesAny(source + assetUrls, ["gsap", "greensock", "tweenmax"])) detected.add("GSAP");
  if (includesAny(source + assetUrls, ["/@vite/", "@vite/client", "vite.js", "vite.svg", "__vite__"])) detected.add("Vite");
  if ((includesAny(assetUrls, ["axios", "axios.min.js"]) || /\baxios\s*\.\s*(get|post|put|delete)\s*\(/i.test(html))) detected.add("Axios");

  return [...detected];
}

function analyzePageMetrics($, html, headers = {}, finalUrl = "", assets = { counts: {} }) {
  const dom = analyzeDomStructure($);
  const layout = analyzeLayout($, html);
  const seo = analyzeSeo($, html, finalUrl);
  const accessibility = analyzeAccessibility($, html);
  const performance = analyzePerformance($, html, assets);

  const imageCount = $("img").length;
  const imagesWithAlt = $("img[alt]").filter((_, element) => Boolean($(element).attr("alt")?.trim())).length;
  const assetReferences = $("[src], [href]")
    .map((_, element) => $(element).attr("src") || $(element).attr("href"))
    .get();
  const fontCount = new Set(assetReferences.filter((value) => /\.(eot|otf|ttf|woff2?)(\?|$)/i.test(value || ""))).size;
  const hasViewport = $('meta[name="viewport"]').length > 0;
  const responsive = hasViewport || /@media\s*\(/i.test(html);

  return {
    pagesCount: 1,
    imagesCount: imageCount,
    cssFilesCount: $("link[rel='stylesheet']").length,
    jsFilesCount: $("script[src]").length,
    fontsCount: fontCount,
    videosCount: $("video").length,
    responsive,
    responsiveStatus: responsive ? "Responsive" : "Needs review",
    seoScore: seo.score,
    accessibilityScore: accessibility.score,
    performanceScore: performance.score,
    pageType: layout.pageType,
    layoutPattern: layout.layoutPattern,
    dom,
    layout,
    seo,
    accessibility,
    performance,
    headers,
  };
}

async function analyzeWebsite(url) {
  const response = await axios.get(url, {
    timeout: 20000,
    maxRedirects: 5,
    maxContentLength: 10 * 1024 * 1024,
    headers: { "User-Agent": USER_AGENT },
    responseType: "text",
  });

  const contentType = response.headers["content-type"] || "";
  if (!contentType.includes("text/html")) {
    throw new Error("The target URL did not return an HTML page.");
  }

  const finalUrl = response.request?.res?.responseUrl || url;
  return analyzeHtml(response.data, finalUrl, response.headers);
}

function analyzeHtml(html, finalUrl, headers = {}) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const technologies = detectTechnologies(html, headers, finalUrl, $);
  const assets = analyzeAssets(html, finalUrl);
  const dom = analyzeDomStructure($);
  const layout = analyzeLayout($, html);
  const seo = analyzeSeo($, html, finalUrl);
  const accessibility = analyzeAccessibility($, html);
  const performance = analyzePerformance($, html, assets);
  const metrics = analyzePageMetrics($, html, headers, finalUrl, assets);
  const components = detectComponents(html);

  return {
    html,
    finalUrl,
    $,
    technologies,
    metrics,
    dom,
    layout,
    seo,
    accessibility,
    performance,
    components,
  };
}

module.exports = {
  analyzeWebsite,
  analyzeHtml,
  analyzePageMetrics,
  analyzeDomStructure,
  analyzeLayout,
  analyzeSeo,
  analyzeAccessibility,
  analyzePerformance,
  detectTechnologies,
  USER_AGENT,
};
