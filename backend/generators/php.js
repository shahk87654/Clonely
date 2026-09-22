const path = require("path");
const fs = require("fs-extra");

async function generatePhp({ html, stagingDirectory, projectName, sourceUrl }) {
  await fs.writeFile(path.join(stagingDirectory, "index.php"), html);
  await fs.writeFile(
    path.join(stagingDirectory, "README.md"),
    `# ${projectName}\n\nPHP website rebuilt from ${sourceUrl}.\n\nServe this folder with PHP:\n\n\`\`\`bash\nphp -S localhost:8000\n\`\`\`\n`,
  );
}

module.exports = generatePhp;
