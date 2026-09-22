const { generateWebsiteReport } = require("../../backend/reporter");

function buildSeoReport(report) {
  return {
    score: report?.seoScore ?? 0,
    notes: report?.seoScore >= 80 ? ["Strong metadata"] : ["Metadata needs work"],
  };
}

module.exports = { buildSeoReport, generateWebsiteReport };
