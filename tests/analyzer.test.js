const fs = require("fs");
const path = require("path");
const assert = require("assert");
const { analyzeHtml } = require("../backend/analyzer");

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

function runAnalysis(name, expected) {
  const html = loadFixture(name);
  const result = analyzeHtml(html, `https://example.com/${name}`);
  assert(result.dom, `${name}: dom analysis missing`);
  assert(result.layout, `${name}: layout analysis missing`);
  assert(result.seo, `${name}: seo analysis missing`);
  assert(result.accessibility, `${name}: accessibility analysis missing`);
  assert(result.performance, `${name}: performance analysis missing`);
  assert(Array.isArray(result.components), `${name}: components missing`);
  assert(result.metrics.seoScore >= 0, `${name}: seo score invalid`);

  if (expected.pageType) {
    assert.strictEqual(result.layout.pageType, expected.pageType, `${name}: pageType`);
  }
  if (expected.layoutPattern) {
    assert.strictEqual(result.layout.layoutPattern, expected.layoutPattern, `${name}: layoutPattern`);
  }
  if (expected.componentNames) {
    const names = result.components.map((component) => component.name);
    for (const componentName of expected.componentNames) {
      assert(
        names.includes(componentName),
        `${name}: expected component ${componentName} not detected`,
      );
    }
  }
  if (expected.minSeoScore) {
    assert(
      result.seo.score >= expected.minSeoScore,
      `${name}: expected SEO score >= ${expected.minSeoScore}, got ${result.seo.score}`,
    );
  }
  if (expected.minAccessibilityScore) {
    assert(
      result.accessibility.score >= expected.minAccessibilityScore,
      `${name}: expected accessibility score >= ${expected.minAccessibilityScore}, got ${result.accessibility.score}`,
    );
  }
  return result;
}

const landing = runAnalysis("landing.html", {
  pageType: "landing",
  layoutPattern: "hero-first",
  componentNames: ["Navbar", "Hero", "Cards", "FAQ", "Footer", "Contact Form"],
  minSeoScore: 60,
  minAccessibilityScore: 70,
});

const ecommerce = runAnalysis("ecommerce.html", {
  pageType: "ecommerce",
  layoutPattern: "grid",
  componentNames: ["Navbar", "Product Grid", "Sidebar", "Footer"],
});

const dashboard = runAnalysis("dashboard.html", {
  pageType: "dashboard",
  layoutPattern: "sidebar",
  componentNames: ["Navbar", "Sidebar", "Cards", "Footer"],
});

assert(landing.dom.semanticSections.some((section) => section.name === "header"));
assert(ecommerce.performance.assetCounts.images >= 1);
assert(dashboard.accessibility.hasLang);

console.log(
  JSON.stringify(
    {
      ok: true,
      fixtures: ["landing.html", "ecommerce.html", "dashboard.html"],
      results: {
        landing: {
          pageType: landing.layout.pageType,
          layoutPattern: landing.layout.layoutPattern,
        },
        ecommerce: {
          pageType: ecommerce.layout.pageType,
          layoutPattern: ecommerce.layout.layoutPattern,
        },
        dashboard: {
          pageType: dashboard.layout.pageType,
          layoutPattern: dashboard.layout.layoutPattern,
        },
      },
    },
    null,
    2,
  ),
);
