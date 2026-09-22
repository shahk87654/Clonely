const { cleanHtml, upgradeHtml } = require("../../backend/cleaner");

function optimizeHtml(html, options = {}) {
  return cleanHtml(html, options);
}

module.exports = { optimizeHtml, cleanHtml, upgradeHtml };
