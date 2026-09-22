const { calculateAccessibilityScore } = require("../../backend/reporter");

function buildAccessibilityReport(html) {
  return {
    score: calculateAccessibilityScore(html || ""),
  };
}

module.exports = { buildAccessibilityReport, calculateAccessibilityScore };
