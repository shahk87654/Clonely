const path = require("path");
const fs = require("fs-extra");

async function generateStaticHtml({
  html,
  stagingDirectory,
  projectName,
  sourceUrl,
}) {
  await fs.writeFile(path.join(stagingDirectory, "index.html"), html);
  await fs.writeFile(
    path.join(stagingDirectory, "README.md"),
    `# ${projectName}\n\nStatic website rebuilt from ${sourceUrl}.\n\nOpen \`index.html\` in a browser or serve this directory with any static web server.\n`,
  );
}

module.exports = generateStaticHtml;
