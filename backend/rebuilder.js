const path = require("path");
const cheerio = require("cheerio");
const fs = require("fs-extra");
const {
  cleanHtml,
  generateSupportFiles,
  removeDuplicateCssBlocks,
} = require("./cleaner");

const IMAGE_PATTERN = /\.(avif|gif|ico|jpe?g|png|svg|webp)$/i;
const FONT_PATTERN = /\.(eot|otf|ttf|woff2?)$/i;
const CSS_PATTERN = /\.css$/i;
const SCRIPT_PATTERN = /\.m?js$/i;

function componentName(type, index = 0) {
  const names = {
    header: "Header",
    navbar: "Navbar",
    hero: "Hero",
    cards: "Cards",
    form: "ContactForm",
    faq: "Faq",
    footer: "Footer",
    section: `ContentSection${index + 1}`,
  };
  return names[type] || `Section${index + 1}`;
}

function analyzeSections(html) {
  const $ = cheerio.load(html, { decodeEntities: false });
  const sections = [];
  const seen = new Set();

  function add(type, elements, combine = false) {
    const selected = elements.toArray().filter((element) => !seen.has(element));
    if (!selected.length) return;
    const targets = combine ? [selected.slice(0, 12)] : selected.slice(0, 4);

    targets.forEach((target) => {
      const nodes = Array.isArray(target) ? target : [target];
      nodes.forEach((node) => seen.add(node));
      const sectionHtml = nodes.map((node) => $.html(node)).join("\n");
      const text = nodes
        .map((node) => $(node).text().replace(/\s+/g, " ").trim())
        .join(" ")
        .slice(0, 240);
      sections.push({
        type,
        name: componentName(type, sections.length),
        html: sectionHtml,
        text,
      });
    });
  }

  add("header", $("header").first());
  add("navbar", $("nav").first());
  add(
    "hero",
    $('[class*="hero"], [id*="hero"], [class*="banner"], [class*="jumbotron"]')
      .first(),
  );
  add(
    "cards",
    $('[class~="card"], [class*="card-"], [class*="feature-card"], article'),
    true,
  );
  add("form", $("form").first());
  add(
    "faq",
    $('[class*="faq"], [id*="faq"], details').first(),
  );

  $("main > section, main > div, body > section").each((_, element) => {
    if (!seen.has(element)) add("section", $(element));
  });
  add("footer", $("footer").first());

  if (!sections.length) {
    add("section", $("body").children().not("script, style"), true);
  }

  const counts = {};
  sections.forEach((section) => {
    counts[section.type] = (counts[section.type] || 0) + 1;
    section.name = componentName(section.type, counts[section.type] - 1);
  });

  return {
    title: $("title").text().trim() || "Rebuilt Website",
    sections,
    sectionTypes: [...new Set(sections.map((section) => section.type))],
  };
}

function detectComponents(html) {
  return analyzeSections(html).sections.map(({ type, name, text }) => ({
    type,
    name,
    text,
  }));
}

const STRUCTURES = {
  "static-html": [
    "index.html",
    "style.css",
    "script.js",
    "images/",
    "README.md",
  ],
  php: [
    "index.php",
    "includes/header.php",
    "includes/footer.php",
    "components/",
    "assets/css/",
    "assets/js/",
    "assets/images/",
    "README.md",
  ],
  laravel: [
    "resources/views/layouts/app.blade.php",
    "resources/views/components/",
    "resources/views/home.blade.php",
    "routes/web.php",
    "public/assets/",
    "README.md",
  ],
  wordpress: [
    "style.css",
    "functions.php",
    "header.php",
    "footer.php",
    "page.php",
    "single.php",
    "assets/",
    "README.md",
  ],
  nextjs: [
    "app/layout.js",
    "app/page.js",
    "app/globals.css",
    "components/",
    "public/assets/",
    "package.json",
    "README.md",
  ],
  react: [
    "src/components/",
    "src/pages/Home.jsx",
    "src/App.jsx",
    "src/main.jsx",
    "public/assets/",
    "package.json",
    "README.md",
  ],
  vue: [
    "src/components/",
    "src/views/Home.vue",
    "src/App.vue",
    "src/main.js",
    "public/assets/",
    "package.json",
    "README.md",
  ],
  aspnet: [
    "Controllers/HomeController.cs",
    "Views/Home/Index.cshtml",
    "Views/Shared/",
    "wwwroot/",
    "Program.cs",
    "RebuiltWebsite.csproj",
    "README.md",
  ],
};

function createCleanStructure(outputType, analysis) {
  return {
    outputType,
    files: STRUCTURES[outputType] || STRUCTURES["static-html"],
    components: analysis.sections.map((section) => section.name),
  };
}

function cleanFragment(fragment, classMap, options = {}) {
  const $ = cheerio.load(fragment, { decodeEntities: false }, false);
  $("script, style, noscript").remove();
  $("*").each((_, element) => {
    const classes = ($(element).attr("class") || "").split(/\s+/).filter(Boolean);
    const cleaned = classes.map((className) => {
      if (options.renameClasses === false) return className;
      const looksGenerated =
        className.length > 24 ||
        /(^|[-_])[a-f0-9]{6,}($|[-_])/i.test(className) ||
        /^(css|sc|jsx)-[a-z0-9]+$/i.test(className);
      if (!looksGenerated) return className;
      if (!classMap.has(className)) {
        classMap.set(className, `clean-element-${classMap.size + 1}`);
      }
      return classMap.get(className);
    });
    if (cleaned.length) $(element).attr("class", [...new Set(cleaned)].join(" "));
    else $(element).removeAttr("class");
    $(element).removeAttr("style");
    [...element.attribs ? Object.keys(element.attribs) : []]
      .filter((attribute) => attribute.startsWith("data-") && attribute !== "data-component")
      .forEach((attribute) => $(element).removeAttr(attribute));
  });
  if (options.improveAccessibility !== false) {
    $("img:not([alt])").attr("alt", "");
    $("button:not([type])").attr("type", "button");
    $("html:not([lang])").attr("lang", "en");
  }
  return $.html().trim();
}

async function prepareAssets(stagingDirectory, outputType, html, options = {}) {
  const sourceDirectory = path.join(stagingDirectory, "assets");
  if (!(await fs.pathExists(sourceDirectory))) {
    return { html, css: "", script: "" };
  }

  const files = await fs.readdir(sourceDirectory);
  const cssParts = [];
  const scriptParts = [];
  let rewrittenHtml = html;

  if (outputType === "static-html") {
    await fs.ensureDir(path.join(stagingDirectory, "images"));
    await fs.ensureDir(path.join(stagingDirectory, "fonts"));

    const cssReplacements = [];
    for (const filename of files) {
      const source = path.join(sourceDirectory, filename);
      if (CSS_PATTERN.test(filename)) {
        cssParts.push(await fs.readFile(source, "utf8"));
      } else if (SCRIPT_PATTERN.test(filename)) {
        scriptParts.push(await fs.readFile(source, "utf8"));
      } else {
        const folder = FONT_PATTERN.test(filename) ? "fonts" : "images";
        await fs.move(source, path.join(stagingDirectory, folder, filename), {
          overwrite: true,
        });
        rewrittenHtml = rewrittenHtml
          .split(`assets/${filename}`)
          .join(`${folder}/${filename}`);
        cssReplacements.push([filename, `${folder}/${filename}`]);
      }
    }
    await fs.remove(sourceDirectory);
    let combinedCss = cssParts.join("\n");
    cssReplacements.forEach(([filename, replacement]) => {
      combinedCss = combinedCss
        .split(`url(${filename})`)
        .join(`url(${replacement})`)
        .split(`url("${filename}")`)
        .join(`url("${replacement}")`)
        .split(`url('${filename}')`)
        .join(`url('${replacement}')`);
    });
    return {
      html: rewrittenHtml,
      css:
        options.removeDuplicateCss === false
          ? combinedCss
          : removeDuplicateCssBlocks(combinedCss),
      script: [...new Set(scriptParts)].join("\n\n"),
    };
  }

  if (outputType === "php") {
    for (const filename of files) {
      const folder = CSS_PATTERN.test(filename)
        ? "css"
        : SCRIPT_PATTERN.test(filename)
          ? "js"
          : FONT_PATTERN.test(filename)
            ? "fonts"
            : "images";
      await fs.move(
        path.join(sourceDirectory, filename),
        path.join(stagingDirectory, "assets", folder, filename),
        { overwrite: true },
      );
      rewrittenHtml = rewrittenHtml
        .split(`assets/${filename}`)
        .join(`assets/${folder}/${filename}`);
    }
    return { html: rewrittenHtml, css: "", script: "" };
  }

  const destinations = {
    laravel: path.join(stagingDirectory, "public", "assets"),
    nextjs: path.join(stagingDirectory, "public", "assets"),
    react: path.join(stagingDirectory, "public", "assets"),
    vue: path.join(stagingDirectory, "public", "assets"),
    aspnet: path.join(stagingDirectory, "wwwroot", "assets"),
  };
  const destination = destinations[outputType];
  if (destination) {
    await fs.ensureDir(path.dirname(destination));
    await fs.move(sourceDirectory, destination, { overwrite: true });
    rewrittenHtml = rewrittenHtml.split('="assets/').join('="/assets/');
  }

  return { html: rewrittenHtml, css: "", script: "" };
}

function pageHtml(title, sections, stylesheet = "style.css", script = "script.js") {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${title}</title>
    <link rel="stylesheet" href="${stylesheet}">
  </head>
  <body>
${sections.map((section) => `    ${section.html}`).join("\n")}
    <script src="${script}"></script>
  </body>
</html>
`;
}

function readme({ projectName, sourceUrl, outputType, analysis, technologies }) {
  return `# ${projectName}

Rule-based developer-friendly rebuild of ${sourceUrl}.

## Output

- Format: ${outputType}
- Detected technologies: ${technologies.join(", ") || "HTML"}
- Components: ${analysis.sections.map((section) => section.name).join(", ")}

## Notes

The source DOM was divided into semantic components and generated classes were
renamed where safe. Review interactive behavior and connect any required APIs
before production use.

Generated by Website Rebuilder AI Pro.
`;
}

function jsString(value) {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

function jsxComponent(section) {
  return `const markup = ${jsString(section.html)};

export default function ${section.name}() {
  return (
    <section className="component component-${section.type}" data-component="${section.name}">
      <div dangerouslySetInnerHTML={{ __html: markup }} />
    </section>
  );
}
`;
}

async function generateStatic(context) {
  const { stagingDirectory, analysis, assets } = context;
  const baseCss = `* { box-sizing: border-box; }
html { scroll-behavior: smooth; }
body { margin: 0; font-family: system-ui, sans-serif; line-height: 1.6; }
img, video { max-width: 100%; height: auto; }
.component { width: min(1200px, calc(100% - 32px)); margin-inline: auto; }
`;
  await fs.writeFile(
    path.join(stagingDirectory, "index.html"),
    pageHtml(analysis.title, analysis.sections),
  );
  await fs.writeFile(
    path.join(stagingDirectory, "style.css"),
    `${baseCss}\n${assets.css}`,
  );
  await fs.writeFile(
    path.join(stagingDirectory, "script.js"),
    assets.script || '"use strict";\n',
  );
}

async function generatePhp(context) {
  const { stagingDirectory, analysis } = context;
  const header = analysis.sections.find((section) => section.type === "header");
  const footer = analysis.sections.find((section) => section.type === "footer");
  const content = analysis.sections.filter(
    (section) => !["header", "footer"].includes(section.type),
  );
  await fs.outputFile(
    path.join(stagingDirectory, "includes", "header.php"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${analysis.title}</title></head><body>\n${header?.html || ""}`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "includes", "footer.php"),
    `${footer?.html || ""}\n</body></html>`,
  );
  for (const section of content) {
    await fs.outputFile(
      path.join(stagingDirectory, "components", `${section.name}.php`),
      section.html,
    );
  }
  const requires = content
    .map((section) => `require __DIR__ . '/components/${section.name}.php';`)
    .join("\n");
  await fs.writeFile(
    path.join(stagingDirectory, "index.php"),
    `<?php\nrequire __DIR__ . '/includes/header.php';\n${requires}\nrequire __DIR__ . '/includes/footer.php';\n`,
  );
}

async function generateLaravel(context) {
  const { stagingDirectory, analysis } = context;
  for (const section of analysis.sections) {
    await fs.outputFile(
      path.join(
        stagingDirectory,
        "resources",
        "views",
        "components",
        `${section.name.toLowerCase()}.blade.php`,
      ),
      section.html,
    );
  }
  const components = analysis.sections
    .map((section) => `<x-${section.name.toLowerCase()} />`)
    .join("\n");
  await fs.outputFile(
    path.join(stagingDirectory, "resources", "views", "layouts", "app.blade.php"),
    `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>${analysis.title}</title></head><body>@yield('content')</body></html>`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "resources", "views", "home.blade.php"),
    `@extends('layouts.app')\n@section('content')\n${components}\n@endsection\n`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "routes", "web.php"),
    "<?php\n\nuse Illuminate\\Support\\Facades\\Route;\n\nRoute::view('/', 'home');\n",
  );
}

async function generateWordPress(context) {
  const { stagingDirectory, analysis, projectName } = context;
  const header = analysis.sections.find((section) => section.type === "header");
  const footer = analysis.sections.find((section) => section.type === "footer");
  const content = analysis.sections.filter(
    (section) => !["header", "footer"].includes(section.type),
  );
  await fs.writeFile(
    path.join(stagingDirectory, "style.css"),
    `/*\nTheme Name: ${projectName}\nDescription: AI Rebuild Mode theme\nVersion: 1.0.0\n*/\n`,
  );
  await fs.writeFile(
    path.join(stagingDirectory, "functions.php"),
    "<?php\nfunction rebuilt_assets() { wp_enqueue_style('rebuilt-style', get_stylesheet_uri()); }\nadd_action('wp_enqueue_scripts', 'rebuilt_assets');\n",
  );
  await fs.writeFile(
    path.join(stagingDirectory, "header.php"),
    `<!doctype html><html <?php language_attributes(); ?>><head><?php wp_head(); ?></head><body <?php body_class(); ?>>${header?.html || ""}`,
  );
  await fs.writeFile(
    path.join(stagingDirectory, "footer.php"),
    `${footer?.html || ""}<?php wp_footer(); ?></body></html>`,
  );
  await fs.writeFile(
    path.join(stagingDirectory, "page.php"),
    `<?php get_header(); ?>\n${content.map((section) => section.html).join("\n")}\n<?php get_footer(); ?>`,
  );
  await fs.writeFile(
    path.join(stagingDirectory, "single.php"),
    "<?php get_header(); ?>\n<main><?php while (have_posts()) : the_post(); the_content(); endwhile; ?></main>\n<?php get_footer(); ?>",
  );
  await fs.writeFile(
    path.join(stagingDirectory, "index.php"),
    "<?php get_template_part('page'); ?>",
  );
}

async function writeJsComponents(directory, sections) {
  for (const section of sections) {
    await fs.outputFile(
      path.join(directory, `${section.name}.jsx`),
      jsxComponent(section),
    );
  }
}

async function generateNext(context) {
  const { stagingDirectory, analysis, projectName } = context;
  const componentsDirectory = path.join(stagingDirectory, "components");
  await writeJsComponents(componentsDirectory, analysis.sections);
  const imports = analysis.sections
    .map(
      (section) =>
        `import ${section.name} from "../components/${section.name}";`,
    )
    .join("\n");
  const elements = analysis.sections
    .map((section) => `      <${section.name} />`)
    .join("\n");
  await fs.outputFile(
    path.join(stagingDirectory, "app", "page.js"),
    `${imports}\n\nexport default function Home() {\n  return <main>\n${elements}\n  </main>;\n}\n`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "app", "layout.js"),
    `import "./globals.css";\nexport const metadata = { title: ${jsString(analysis.title)} };\nexport default function RootLayout({ children }) { return <html lang="en"><body>{children}</body></html>; }\n`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "app", "globals.css"),
    "* { box-sizing: border-box; } body { margin: 0; font-family: system-ui, sans-serif; } img { max-width: 100%; }\n",
  );
  await fs.writeJson(
    path.join(stagingDirectory, "package.json"),
    {
      name: projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      private: true,
      version: "1.0.0",
      scripts: { dev: "next dev", build: "next build", start: "next start" },
      dependencies: { next: "^15.1.3", react: "^19.0.0", "react-dom": "^19.0.0" },
    },
    { spaces: 2 },
  );
}

async function generateReact(context) {
  const { stagingDirectory, analysis, projectName } = context;
  const componentsDirectory = path.join(stagingDirectory, "src", "components");
  await writeJsComponents(componentsDirectory, analysis.sections);
  const imports = analysis.sections
    .map(
      (section) =>
        `import ${section.name} from "../components/${section.name}";`,
    )
    .join("\n");
  const elements = analysis.sections
    .map((section) => `      <${section.name} />`)
    .join("\n");
  await fs.outputFile(
    path.join(stagingDirectory, "src", "pages", "Home.jsx"),
    `${imports}\n\nexport default function Home() {\n  return <main>\n${elements}\n  </main>;\n}\n`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "src", "App.jsx"),
    'import Home from "./pages/Home";\nexport default function App() { return <Home />; }\n',
  );
  await fs.outputFile(
    path.join(stagingDirectory, "src", "main.jsx"),
    'import React from "react";\nimport { createRoot } from "react-dom/client";\nimport App from "./App";\ncreateRoot(document.getElementById("root")).render(<App />);\n',
  );
  await fs.writeFile(
    path.join(stagingDirectory, "index.html"),
    '<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.jsx"></script></body></html>',
  );
  await fs.writeJson(
    path.join(stagingDirectory, "package.json"),
    {
      name: projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      private: true,
      version: "1.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { vite: "^6.0.5", react: "^19.0.0", "react-dom": "^19.0.0" },
    },
    { spaces: 2 },
  );
}

async function generateVue(context) {
  const { stagingDirectory, analysis, projectName } = context;
  for (const section of analysis.sections) {
    await fs.outputFile(
      path.join(
        stagingDirectory,
        "src",
        "components",
        `${section.name}.vue`,
      ),
      `<template>\n  <section class="component component-${section.type}" data-component="${section.name}">\n${section.html}\n  </section>\n</template>\n`,
    );
  }
  const imports = analysis.sections
    .map(
      (section) =>
        `import ${section.name} from "../components/${section.name}.vue";`,
    )
    .join("\n");
  const elements = analysis.sections
    .map((section) => `    <${section.name} />`)
    .join("\n");
  const registration = analysis.sections.map((section) => section.name).join(", ");
  await fs.outputFile(
    path.join(stagingDirectory, "src", "views", "Home.vue"),
    `<script setup>\n${imports}\n</script>\n<template>\n  <main>\n${elements}\n  </main>\n</template>\n`,
  );
  await fs.outputFile(
    path.join(stagingDirectory, "src", "App.vue"),
    '<script setup>import Home from "./views/Home.vue";</script>\n<template><Home /></template>\n',
  );
  await fs.outputFile(
    path.join(stagingDirectory, "src", "main.js"),
    'import { createApp } from "vue";\nimport App from "./App.vue";\ncreateApp(App).mount("#app");\n',
  );
  await fs.writeFile(
    path.join(stagingDirectory, "index.html"),
    '<!doctype html><html><body><div id="app"></div><script type="module" src="/src/main.js"></script></body></html>',
  );
  await fs.writeJson(
    path.join(stagingDirectory, "package.json"),
    {
      name: projectName.toLowerCase().replace(/[^a-z0-9-]+/g, "-"),
      private: true,
      version: "1.0.0",
      type: "module",
      scripts: { dev: "vite", build: "vite build" },
      dependencies: { vite: "^6.0.5", vue: "^3.5.13" },
    },
    { spaces: 2 },
  );
}

async function generateAspNet(context) {
  const { stagingDirectory, analysis } = context;
  await fs.outputFile(
    path.join(stagingDirectory, "Controllers", "HomeController.cs"),
    'using Microsoft.AspNetCore.Mvc;\npublic class HomeController : Controller { public IActionResult Index() => View(); }\n',
  );
  for (const section of analysis.sections) {
    await fs.outputFile(
      path.join(
        stagingDirectory,
        "Views",
        "Shared",
        `_${section.name}.cshtml`,
      ),
      section.html,
    );
  }
  await fs.outputFile(
    path.join(stagingDirectory, "Views", "Home", "Index.cshtml"),
    analysis.sections
      .map((section) => `<partial name="_${section.name}" />`)
      .join("\n"),
  );
  await fs.writeFile(
    path.join(stagingDirectory, "Program.cs"),
    'var builder = WebApplication.CreateBuilder(args);\nbuilder.Services.AddControllersWithViews();\nvar app = builder.Build();\napp.UseStaticFiles();\napp.MapControllerRoute(name: "default", pattern: "{controller=Home}/{action=Index}/{id?}");\napp.Run();\n',
  );
  await fs.writeFile(
    path.join(stagingDirectory, "RebuiltWebsite.csproj"),
    '<Project Sdk="Microsoft.NET.Sdk.Web"><PropertyGroup><TargetFramework>net8.0</TargetFramework><Nullable>enable</Nullable><ImplicitUsings>enable</ImplicitUsings></PropertyGroup></Project>',
  );
}

const generators = {
  "static-html": generateStatic,
  php: generatePhp,
  laravel: generateLaravel,
  wordpress: generateWordPress,
  nextjs: generateNext,
  react: generateReact,
  vue: generateVue,
  aspnet: generateAspNet,
};

async function generateDeveloperFriendlyProject({
  html,
  outputType,
  stagingDirectory,
  projectName,
  sourceUrl,
  technologies = [],
  options = {},
}) {
  const cleanedDocument = cleanHtml(html, options);
  const assets = await prepareAssets(
    stagingDirectory,
    outputType,
    cleanedDocument.html,
    options,
  );
  assets.css = [assets.css, cleanedDocument.css].filter(Boolean).join("\n\n");
  assets.script = [assets.script, cleanedDocument.js]
    .filter(Boolean)
    .join("\n\n");
  const rawAnalysis = analyzeSections(assets.html);
  const classMap = new Map();
  const sourceSections =
    options.splitComponents === false
      ? [
          {
            type: "section",
            name: "PageContent",
            html: rawAnalysis.sections
              .map((section) => section.html)
              .join("\n"),
            text: rawAnalysis.sections
              .map((section) => section.text)
              .join(" ")
              .slice(0, 240),
          },
        ]
      : rawAnalysis.sections;
  const analysis = {
    ...rawAnalysis,
    sections: sourceSections.map((section) => ({
      ...section,
      html: cleanFragment(section.html, classMap, options),
    })),
  };
  const structure = createCleanStructure(outputType, analysis);

  // Future OpenAI/Codex integration point:
  // send the normalized analysis and component model to a code-generation
  // service here, then validate its response before writing project files.
  await generators[outputType]({
    stagingDirectory,
    projectName,
    sourceUrl,
    technologies,
    analysis,
    assets,
  });

  const publicRoots = {
    laravel: "public",
    nextjs: "public",
    react: "public",
    vue: "public",
    aspnet: "wwwroot",
  };
  const publicRoot = path.join(
    stagingDirectory,
    publicRoots[outputType] || "",
  );
  await generateSupportFiles({
    directory: stagingDirectory,
    publicDirectory: publicRoot,
    sourceUrl,
    readme: readme({
      projectName,
      sourceUrl,
      outputType,
      analysis,
      technologies,
    }),
    options,
  });

  return {
    analysis,
    structure,
    classRenames: {
      ...cleanedDocument.classRenames,
      ...Object.fromEntries(classMap),
    },
  };
}

module.exports = {
  analyzeSections,
  detectComponents,
  createCleanStructure,
  generateDeveloperFriendlyProject,
};
