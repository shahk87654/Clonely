const path = require("path");

function slugify(value, fallback = "website") {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || fallback
  );
}

function safeJoin(root, child) {
  const resolved = path.resolve(root, child);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Invalid path.");
  }
  return resolved;
}

module.exports = { slugify, safeJoin };
