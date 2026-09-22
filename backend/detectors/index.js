const { detectComponents } = require("../component-detector");
const { analyzeAssets, analyzeWebsiteAssets } = require("../asset-analyzer");
const { analyzePageMetrics, detectTechnologies } = require("../analyzer");

module.exports = {
  detectComponents,
  analyzeAssets,
  analyzeWebsiteAssets,
  analyzePageMetrics,
  detectTechnologies,
};
