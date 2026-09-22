const path = require("path");
const fs = require("fs-extra");
const cheerio = require("cheerio");

function calculateAccessibilityScore(html) {
  const $ = cheerio.load(html);
  let score = 35;
  const images = $("img").length;
  const imagesWithAlt = $("img[alt]").length;
  if (!images || imagesWithAlt === images) score += 20;
  else score += Math.round((imagesWithAlt / images) * 20);
  if ($("html[lang]").length) score += 10;
  if ($("main").length) score += 10;
  if ($("nav").length) score += 5;
  if ($("h1").length === 1) score += 10;
  const inputs = $("input, textarea, select").length;
  const labelled = $("input[id], textarea[id], select[id]").filter(
    (_, element) => {
      const id = $(element).attr("id");
      return $("label[for]").filter(
        (_labelIndex, label) => $(label).attr("for") === id,
      ).length;
    },
  ).length;
  if (!inputs || labelled === inputs) score += 10;
  else score += Math.round((labelled / inputs) * 10);
  return Math.min(100, score);
}

function calculatePerformanceScore(html, assets) {
  const $ = cheerio.load(html);
  let score = 100;
  score -= Math.min(20, Math.max(0, assets.counts.js - 5) * 2);
  score -= Math.min(15, Math.max(0, assets.counts.css - 4) * 2);
  score -= Math.min(15, Math.max(0, assets.counts.images - 20));
  score -= Math.min(10, $("script:not([defer]):not([async])[src]").length * 2);
  score -= Math.min(10, $("[style]").length);
  score -= html.length > 500000 ? 10 : html.length > 200000 ? 5 : 0;
  return Math.max(0, score);
}

async function calculateProjectStats(directory) {
  let projectSize = 0;
  let fileCount = 0;

  async function visit(current) {
    if (!(await fs.pathExists(current))) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) await visit(entryPath);
      else {
        const stat = await fs.stat(entryPath);
        projectSize += stat.size;
        fileCount += 1;
      }
    }
  }

  await visit(directory);
  return { projectSize, fileCount };
}

function formatBytes(bytes = 0) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function generateWebsiteReport({
  html,
  technologies,
  components,
  routeAnalysis,
  assets,
  seoScore,
  responsive,
  mode = "Analysis",
  project = {},
  inspector = {},
  failedAssets = [],
  outputStructure = [],
  analysis = {},
}) {
  const detectedRoutes = routeAnalysis.routes || ["/"];
  const componentsCreated = inspector.componentsGenerated || 0;
  const projectSize = inspector.projectSize || 0;
  const fileCount = inspector.fileCount || 0;
  const seoDetails = analysis.seo || {};
  const accessibilityDetails = analysis.accessibility || {};
  const performanceDetails = analysis.performance || {};
  const layoutDetails = analysis.layout || {};
  const domDetails = analysis.dom || {};
  const componentMap = inspector.componentMap || [];
  const generatedFiles = inspector.generatedFiles || outputStructure;

  return {
    projectId: project.id || null,
    projectName: project.name || null,
    sourceUrl: project.sourceUrl,
    outputType: project.outputType || null,
    outputLabel: project.outputLabel || null,
    mode,
    status: project.status || "Analyzed",
    createdAt: project.createdAt || new Date().toISOString(),
    pagesCount: routeAnalysis.crawledPages || 1,
    imagesCount: assets.counts.images,
    cssCount: assets.counts.css,
    jsCount: assets.counts.js,
    cssFilesCount: assets.counts.css,
    jsFilesCount: assets.counts.js,
    fontsCount: assets.counts.fonts,
    videosCount: assets.counts.videos,
    iconsCount: assets.counts.icons,
    svgCount: assets.counts.svg,
    audioCount: assets.counts.audio,
    documentsCount: assets.counts.documents,
    manifestsCount: assets.counts.manifests,
    dataCount: assets.counts.data,
    detectedTechnologies: technologies,
    technologies,
    detectedComponents: components,
    componentCount: components.length,
    componentMap,
    detectedRoutes,
    layoutType: layoutDetails.pageType || "corporate",
    layoutPattern: layoutDetails.layoutPattern || "single-column",
    layoutSignals: layoutDetails.signals || {},
    domAnalysis: domDetails,
    pagesFound:
      routeAnalysis.discoveredPages ||
      routeAnalysis.pages?.map(({ title, path: pagePath, status }) => ({
        title,
        path: pagePath,
        status,
      })) ||
      [],
    responsiveStatus: responsive ? "Responsive" : "Needs review",
    responsive: Boolean(responsive),
    seoScore: seoDetails.score ?? seoScore,
    seoDetails,
    accessibilityScore:
      accessibilityDetails.score ?? calculateAccessibilityScore(html),
    accessibilityDetails,
    performanceScore:
      performanceDetails.score ?? calculatePerformanceScore(html, assets),
    performanceDetails,
    estimatedSimilarity:
      inspector.estimatedSimilarity ?? (mode === "Mirror Website" ? 98 : 90),
    projectSize,
    projectSizeFormatted: formatBytes(projectSize),
    fileCount,
    componentsCreated,
    externalCdnAssets: assets.counts.externalCdnAssets,
    assetsDownloaded: inspector.assetsDownloaded || 0,
    generatedFiles,
    outputStructure,
    failedAssets,
    inspector: {
      projectSize,
      projectSizeFormatted: formatBytes(projectSize),
      fileCount,
      pagesGenerated: inspector.pagesGenerated || routeAnalysis.crawledPages || 1,
      componentsGenerated: componentsCreated,
      assetsDownloaded: inspector.assetsDownloaded || 0,
      zipSize: inspector.zipSize || 0,
      zipSizeFormatted: formatBytes(inspector.zipSize || 0),
      componentMap,
      generatedFiles,
    },
  };
}

function generateReportMarkdown(report) {
  const technologies = report.detectedTechnologies.join(", ") || "HTML";
  const components = report.detectedComponents
    .map((component) =>
      typeof component === "string"
        ? component
        : `${component.name} (${component.confidence}%)`,
    )
    .join(", ");
  const layout = report.layoutType || "corporate";
  const pattern = report.layoutPattern || "single-column";
  const componentCount = report.componentCount || 0;

  return `# Website Rebuild Report

## Summary

- Project: ${report.projectName || "Analysis"}
- Source: ${report.sourceUrl}
- Mode: ${report.mode}
- Pages found: ${report.pagesCount}
- Assets downloaded: ${report.assetsDownloaded}
- Layout type: ${layout}
- Layout pattern: ${pattern}
- Component count: ${componentCount}
- Technologies: ${technologies}
- Components: ${components || "None"}
- Failed assets: ${report.failedAssets.length}

## Quality scores

- SEO: ${report.seoScore}/100
- Accessibility: ${report.accessibilityScore}/100
- Performance: ${report.performanceScore}/100
- Estimated similarity: ${report.estimatedSimilarity}%

## Analyzer details

- Title: ${report.seoDetails?.title || "Missing"}
- Description: ${report.seoDetails?.description ? "Present" : "Missing"}
- H1 count: ${report.seoDetails?.h1Count ?? 0}
- Heading order issues: ${report.seoDetails?.headingOrderIssues ?? 0}
- Missing alt attributes: ${report.accessibilityDetails?.missingAlt ?? 0}
- Unlabelled buttons: ${report.accessibilityDetails?.buttonsWithoutLabels ?? 0}
- Unlabelled forms: ${report.accessibilityDetails?.formsWithoutLabels ?? 0}
- Blocking CSS: ${report.performanceDetails?.blockingCssCount ?? 0}
- Blocking JS: ${report.performanceDetails?.blockingJsCount ?? 0}
- Large HTML estimate: ${report.performanceDetails?.largeHtmlEstimate || "unknown"}

## Output structure

${report.outputStructure.map((file) => `- \`${file}\``).join("\n") || "- No generated files"}

## Failed assets

${report.failedAssets.map((asset) => `- ${asset.url} - ${asset.error}`).join("\n") || "- None"}
`;
}

module.exports = {
  calculateAccessibilityScore,
  calculatePerformanceScore,
  calculateProjectStats,
  formatBytes,
  generateReportMarkdown,
  generateWebsiteReport,
};
