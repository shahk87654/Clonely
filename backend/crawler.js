const axios = require("axios");
const cheerio = require("cheerio");
const { normalizeRoute } = require("./route-detector");

const USER_AGENT =
  "Mozilla/5.0 (compatible; WebsiteRebuilderAIPro-Crawler/1.0)";
const XML_PAGE_EXCLUSIONS =
  /\.(avif|css|eot|gif|ico|jpe?g|js|json|mp3|mp4|otf|pdf|png|svg|ttf|webm|webp|woff2?|zip)$/i;

async function fetchResource(url, timeout = 10000) {
  return axios.get(url, {
    timeout,
    maxRedirects: 5,
    maxContentLength: 10 * 1024 * 1024,
    responseType: "text",
    headers: { "User-Agent": USER_AGENT },
    validateStatus: (status) => status >= 200 && status < 500,
  });
}

function sameDomainUrl(value, baseUrl) {
  try {
    const base = new URL(baseUrl);
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return null;
    if (!["http:", "https:"].includes(resolved.protocol)) return null;
    return resolved;
  } catch {
    return null;
  }
}

function extractLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];
  $("a[href]").each((_, element) => {
    const resolved = sameDomainUrl($(element).attr("href"), pageUrl);
    if (resolved) links.push(resolved.href);
  });
  return links;
}

function parseSitemap(xml, baseUrl) {
  const $ = cheerio.load(xml, { xmlMode: true });
  const pages = [];
  const sitemaps = [];
  $("url > loc").each((_, element) => {
    const resolved = sameDomainUrl($(element).text().trim(), baseUrl);
    if (resolved && !XML_PAGE_EXCLUSIONS.test(resolved.pathname)) {
      pages.push(resolved.href);
    }
  });
  $("sitemap > loc").each((_, element) => {
    const resolved = sameDomainUrl($(element).text().trim(), baseUrl);
    if (resolved) sitemaps.push(resolved.href);
  });
  return { pages, sitemaps };
}

function sitemapUrlsFromRobots(robotsText, baseUrl) {
  return String(robotsText || "")
    .split(/\r?\n/)
    .map((line) => line.match(/^\s*sitemap\s*:\s*(.+)\s*$/i)?.[1])
    .filter(Boolean)
    .map((value) => sameDomainUrl(value, baseUrl)?.href)
    .filter(Boolean);
}

async function discoverSitemapPages(origin, robotsText) {
  const sitemapCandidates = new Set([
    `${origin}/sitemap.xml`,
    ...sitemapUrlsFromRobots(robotsText, origin),
  ]);
  const pageUrls = new Set();
  const checked = new Set();
  const queue = [...sitemapCandidates];

  while (queue.length && checked.size < 5) {
    const sitemapUrl = queue.shift();
    if (checked.has(sitemapUrl)) continue;
    checked.add(sitemapUrl);
    try {
      const response = await fetchResource(sitemapUrl, 7000);
      if (response.status >= 400) continue;
      const parsed = parseSitemap(response.data, origin);
      parsed.pages.forEach((url) => pageUrls.add(url));
      parsed.sitemaps.forEach((url) => {
        if (!checked.has(url)) queue.push(url);
      });
    } catch {
      // Sitemap discovery is optional; link crawling continues without it.
    }
  }

  return {
    sitemapUrls: [...checked],
    pageUrls: [...pageUrls],
  };
}

async function crawlWebsite(targetUrl, { maxPages = 25 } = {}) {
  const limit = Math.max(1, Math.min(Number(maxPages) || 25, 25));
  const initialUrl = new URL(targetUrl).href;
  const origin = new URL(initialUrl).origin;
  let robotsText = "";
  let robotsStatus = null;

  try {
    const robotsResponse = await fetchResource(`${origin}/robots.txt`, 7000);
    robotsStatus = robotsResponse.status;
    if (
      robotsResponse.status < 400 &&
      String(robotsResponse.headers["content-type"]).includes("text/plain")
    ) {
      robotsText = robotsResponse.data;
    }
  } catch {
    // robots.txt is optional.
  }

  const sitemap = await discoverSitemapPages(origin, robotsText);
  const queue = [initialUrl, ...sitemap.pageUrls];
  const queued = new Set(queue);
  const visited = new Set();
  const pages = [];
  const failedPages = [];

  while (queue.length && pages.length < limit) {
    const pageUrl = queue.shift();
    const route = normalizeRoute(pageUrl, initialUrl);
    if (!route || visited.has(route)) continue;
    visited.add(route);

    try {
      const response = await fetchResource(pageUrl, 12000);
      const contentType = String(response.headers["content-type"] || "");
      if (response.status >= 400 || !contentType.includes("text/html")) {
        failedPages.push({
          url: pageUrl,
          path: route,
          status: response.status,
          error: contentType.includes("text/html")
            ? `HTTP ${response.status}`
            : "Not an HTML page",
        });
        continue;
      }

      const $ = cheerio.load(response.data);
      pages.push({
        url: pageUrl,
        path: route,
        title: $("title").text().trim() || route,
        status: response.status,
        html: response.data,
        headers: response.headers,
      });

      extractLinks(response.data, pageUrl).forEach((link) => {
        const linkRoute = normalizeRoute(link, initialUrl);
        if (
          linkRoute &&
          !visited.has(linkRoute) &&
          !queued.has(link) &&
          queue.length < 250
        ) {
          queued.add(link);
          queue.push(link);
        }
      });
    } catch (error) {
      failedPages.push({
        url: pageUrl,
        path: route,
        status: error.response?.status || 0,
        error: error.message,
      });
    }
  }

  if (!pages.length) {
    throw new Error(
      failedPages[0]?.error || "The target did not return an HTML page.",
    );
  }

  return {
    targetUrl: initialUrl,
    origin,
    pages,
    routes: pages.map((page) => page.path),
    discoveredPages: pages.map(({ title, path: pagePath, status, url }) => ({
      title,
      path: pagePath,
      status,
      url,
    })),
    failedPages,
    robots: {
      url: `${origin}/robots.txt`,
      status: robotsStatus,
      found: Boolean(robotsText),
      content: robotsText,
    },
    sitemap: {
      urls: sitemap.sitemapUrls,
      found: sitemap.pageUrls.length > 0,
      discoveredUrlCount: sitemap.pageUrls.length,
    },
    maxPages: limit,
  };
}

module.exports = {
  crawlWebsite,
  extractLinks,
  parseSitemap,
  sitemapUrlsFromRobots,
};
