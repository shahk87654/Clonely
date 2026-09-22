const fs = require("fs-extra");
const path = require("path");
const os = require("os");
const assert = require("assert");
const { analyzeHtml } = require("../backend/analyzer");
const { generateProjectV1 } = require("../backend/project-generator");

function loadFixture(name) {
  return fs.readFileSync(path.join(__dirname, "fixtures", name), "utf8");
}

async function runGeneration({
  html,
  outputType,
  mode,
  projectName,
  sourceUrl,
  expectedFiles = [],
}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "rebuilder-gen-"));
  try {
    const analysis = analyzeHtml(html, sourceUrl);
    const result = await generateProjectV1({
      pages: [
        {
          path: "/",
          url: sourceUrl,
          title: "Home",
          html,
        },
      ],
      outputType,
      stagingDirectory: tempRoot,
      projectName,
      sourceUrl,
      technologies: analysis.technologies,
      detectedComponents: analysis.components,
      mode,
      options: {
        splitComponents: true,
        removeDuplicateCss: true,
        renameClasses: true,
        improveAccessibility: true,
        generateReadme: true,
        generateHtaccess: true,
        generateSitemap: true,
        generateRobots: true,
      },
      exportFormat: "zip",
    });

    for (const file of expectedFiles) {
      assert(
        await fs.pathExists(path.join(tempRoot, file)),
        `${outputType}/${mode}: expected ${file}`,
      );
    }
    assert(result.outputStructure.length > 0, `${outputType}/${mode}: outputStructure empty`);
    assert(result.componentMap.length > 0, `${outputType}/${mode}: componentMap empty`);
    assert(result.generatedFiles.length > 0, `${outputType}/${mode}: generatedFiles empty`);
    return { tempRoot, result };
  } finally {
    await fs.remove(tempRoot);
  }
}

async function main() {
  const html = loadFixture("landing.html");
  const staticRun = await runGeneration({
    html,
    outputType: "static-html",
    mode: "ai-rebuild",
    projectName: "Static Fixture",
    sourceUrl: "https://example.com/",
    expectedFiles: [
      "index.html",
      "style.css",
      "script.js",
      "COMPONENTS.md",
      "README.md",
    ],
  });

  const phpRun = await runGeneration({
    html,
    outputType: "php",
    mode: "ai-rebuild",
    projectName: "PHP Fixture",
    sourceUrl: "https://example.com/",
    expectedFiles: [
      "index.php",
      "includes/header.php",
      "includes/footer.php",
      "COMPONENTS.md",
    ],
  });

  const migrationRun = await runGeneration({
    html,
    outputType: "nextjs",
    mode: "framework-migration",
    projectName: "Next Fixture",
    sourceUrl: "https://example.com/",
    expectedFiles: [
      "app/page.js",
      "README.md",
      "COMPONENTS.md",
      "MIGRATION_NOTES.md",
    ],
  });

  assert(
    staticRun.result.componentMap.some((component) => component.file.includes("navbar")),
    "static: navbar component not mapped",
  );
  assert(
    phpRun.result.componentMap.some((component) => component.file.includes("footer")),
    "php: footer component not mapped",
  );
  assert(
    migrationRun.result.outputStructure.some((file) => file === "MIGRATION_NOTES.md"),
    "migration: notes file missing",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        cases: {
          staticHtml: staticRun.result.outputStructure.slice(0, 8),
          php: phpRun.result.outputStructure.slice(0, 8),
          nextjs: migrationRun.result.outputStructure.slice(0, 8),
        },
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
