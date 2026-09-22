const { analyzeHtml, analyzeWebsite } = require("../analyzer");
const { crawlWebsite } = require("../crawler");
const { collectAssets } = require("../asset-collector");
const { analyzeAssets, analyzeWebsiteAssets } = require("../asset-analyzer");
const { detectComponents } = require("../component-detector");
const { generateProjectV1 } = require("../project-generator");
const { generateWebsiteReport } = require("../reporter");
const { createZip } = require("../zipper");

module.exports = {
  analyzeHtml,
  analyzeWebsite,
  crawlWebsite,
  collectAssets,
  analyzeAssets,
  analyzeWebsiteAssets,
  detectComponents,
  generateProjectV1,
  generateWebsiteReport,
  createZip,
};
