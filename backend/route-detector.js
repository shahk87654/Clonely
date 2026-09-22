const axios = require("axios");
const cheerio = require("cheerio");

const PAGE_EXTENSION_PATTERN =
  /\.(avif|css|csv|docx?|eot|gif|ico|jpe?g|js|json|mp3|mp4|otf|pdf|png|svg|ttf|txt|webm|webp|woff2?|xml|zip)$/i;

function normalizeRoute(value, baseUrl) {
  if (!value || /^(#|javascript:|mailto:|tel:|data:|blob:)/i.test(value)) {
    return null;
  }

  try {
    const base = new URL(baseUrl);
    const resolved = new URL(value, base);
    if (resolved.origin !== base.origin) return null;
    if (PAGE_EXTENSION_PATTERN.test(resolved.pathname)) return null;
    if (resolved.pathname.startsWith("/api/")) return null;

    let pathname = resolved.pathname.replace(/\/{2,}/g, "/");
    if (pathname.length > 1) pathname = pathname.replace(/\/$/, "");
    const query = [...resolved.searchParams.entries()]
      .filter(([key]) => !key.toLowerCase().startsWith("utm_"))
      .sort(([a], [b]) => a.localeCompare(b));
    const search = query.length
      ? `?${new URLSearchParams(query).toString()}`
      : "";
    return `${pathname || "/"}${search}`;
  } catch {
    return null;
  }
}

function detectRoutes(html, baseUrl) {
  const $ = cheerio.load(html);
  const routes = new Set([normalizeRoute(baseUrl, baseUrl) || "/"]);
  $("a[href]").each((_, element) => {
    const route = normalizeRoute($(element).attr("href"), baseUrl);
    if (route) routes.add(route);
  });
  return [...routes];
}

async function crawlInternalRoutes(
  initialHtml,
  baseUrl,
  { maxPages = 10, timeout = 8000 } = {},
) {
  const origin = new URL(baseUrl).origin;
  const initialRoute = normalizeRoute(baseUrl, baseUrl) || "/";
  const discovered = new Set(detectRoutes(initialHtml, baseUrl));
  const queue = [...discovered].filter((route) => route !== initialRoute);
  const visited = new Set([initialRoute]);
  const pages = [{ route: initialRoute, url: baseUrl, html: initialHtml }];

  while (queue.length && pages.length < Math.min(maxPages, 10)) {
    const route = queue.shift();
    if (visited.has(route)) continue;
    visited.add(route);

    try {
      const pageUrl = new URL(route, origin).href;
      const response = await axios.get(pageUrl, {
        timeout,
        maxRedirects: 3,
        maxContentLength: 5 * 1024 * 1024,
        responseType: "text",
        headers: {
          "User-Agent":
            "Mozilla/5.0 (compatible; WebsiteRebuilderAIPro/1.0)",
        },
      });
      if (!String(response.headers["content-type"]).includes("text/html")) {
        continue;
      }

      pages.push({ route, url: pageUrl, html: response.data });
      detectRoutes(response.data, pageUrl).forEach((childRoute) => {
        if (!discovered.has(childRoute)) {
          discovered.add(childRoute);
          if (!visited.has(childRoute)) queue.push(childRoute);
        }
      });
    } catch {
      // A failed internal route should not block analysis of the source page.
    }
  }

  return {
    routes: [...discovered].slice(0, 100),
    pages,
    crawledPages: pages.length,
    maxPages: Math.min(maxPages, 10),
  };
}

module.exports = {
  crawlInternalRoutes,
  detectRoutes,
  normalizeRoute,
};
