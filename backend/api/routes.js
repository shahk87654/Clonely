const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const {
  analyzeHtml,
  createZip,
  detectComponents,
  analyzeWebsiteAssets,
  crawlWebsite,
  collectAssets,
  generateProjectV1,
} = require("../engine");
const { writeExportPreset } = require("../exporters");
const ai = require("../ai");
const {
  calculateProjectStats,
  formatBytes,
  generateReportMarkdown,
  generateWebsiteReport,
} = require("../reporter");
const {
  addProject,
  exportStoragePath,
  filenameSlug,
  findUserProject,
  listFilesRecursively,
  outputDirectory,
  projectStoragePath,
  readProjectsForUser,
  reportStoragePaths,
  resolveProjectFile,
  safeProjectName,
  storageDirectory,
  projectsDirectory,
  cacheDirectory,
  reportsDirectory,
  exportsDirectory,
} = require("../storage");
const { HttpError, asyncHandler } = require("../utils/http");
const auth = require("../auth");

const outputTypes = {
  "static-html": { label: "Static HTML" },
  php: { label: "PHP" },
  laravel: { label: "Laravel" },
  wordpress: { label: "WordPress Theme" },
  nextjs: { label: "Next.js" },
  nuxt: { label: "Nuxt" },
  react: { label: "React" },
  vue: { label: "Vue" },
  aspnet: { label: "ASP.NET" },
  express: { label: "Express" },
  node: { label: "Node" },
};

const exportFormats = {
  zip: { label: "ZIP" },
  git: { label: "Git Repository" },
  docker: { label: "Docker" },
  plesk: { label: "Plesk" },
  cpanel: { label: "cPanel" },
  ftp: { label: "FTP Package" },
};

function parseTargetUrl(value) {
  const parsedUrl = new URL(value);
  if (!["http:", "https:"].includes(parsedUrl.protocol)) {
    throw new HttpError("Unsupported protocol.", 400);
  }
  return parsedUrl;
}

function validateProjectId(projectId) {
  if (!/^[a-zA-Z0-9-]+$/.test(projectId || "")) {
    throw new HttpError("Invalid project ID.", 400);
  }
}

function validateZipName(zipName) {
  const safeName = path.basename(zipName);
  if (safeName !== zipName || !safeName.endsWith(".zip")) {
    throw new HttpError("Invalid ZIP filename.", 400);
  }
  return safeName;
}

function applyDocumentOptions($, projectName, sourceUrl, options) {
  if (options.mobileResponsive !== false && !$('meta[name="viewport"]').length) {
    $("head").prepend(
      '<meta name="viewport" content="width=device-width, initial-scale=1.0">',
    );
  }

  if (options.seoOptimize !== false) {
    if (!$("title").text().trim()) {
      $("head").append("<title></title>");
      $("title").last().text(projectName);
    }
    if (!$('meta[name="description"]').length) {
      $("head").append('<meta name="description">');
      $('meta[name="description"]')
        .last()
        .attr("content", `${projectName} rebuilt website`);
    }
    if (!$('link[rel="canonical"]').length) {
      $("head").append('<link rel="canonical">');
      $('link[rel="canonical"]').last().attr("href", sourceUrl);
    }
  }
}

async function writeProjectReports(projectId, report, directory) {
  const { storageReport, projectReport, websiteReport, legacyReport } =
    reportStoragePaths(projectId);
  const payloads = [
    [storageReport, report],
    [projectReport, report],
    [websiteReport, report],
    [legacyReport, report],
    [path.join(directory, "report.json"), report],
    [path.join(directory, "website-report.json"), report],
    [
      path.join(directory, "seo.json"),
      { score: report.seoScore, scoreLabel: `${report.seoScore}/100` },
    ],
    [
      path.join(directory, "accessibility.json"),
      {
        score: report.accessibilityScore,
        scoreLabel: `${report.accessibilityScore}/100`,
      },
    ],
    [
      path.join(directory, "performance.json"),
      { score: report.performanceScore, scoreLabel: `${report.performanceScore}/100` },
    ],
    [
      path.join(directory, "technology.json"),
      {
        technologies: report.detectedTechnologies,
        detectedTechnologies: report.detectedTechnologies,
      },
    ],
    [
      path.join(directory, "components.json"),
      {
        components: report.detectedComponents,
        componentMap: report.componentMap || [],
        generatedFiles: report.generatedFiles || [],
      },
    ],
    [
      path.join(directory, "routes.json"),
      { routes: report.detectedRoutes, pagesFound: report.pagesFound },
    ],
    [
      path.join(directory, "assets.json"),
      {
        assetsDownloaded: report.assetsDownloaded,
        counts: {
          images: report.imagesCount,
          css: report.cssCount,
          js: report.jsCount,
          fonts: report.fontsCount,
          videos: report.videosCount,
          icons: report.iconsCount,
          svg: report.svgCount,
          audio: report.audioCount,
          documents: report.documentsCount,
          manifests: report.manifestsCount,
          data: report.dataCount,
          externalCdnAssets: report.externalCdnAssets,
        },
        failedAssets: report.failedAssets,
      },
    ],
  ];

  for (const [filePath, value] of payloads) {
    await fs.ensureDir(path.dirname(filePath));
    await fs.writeJson(filePath, value, { spaces: 2 });
  }
  await fs.writeFile(path.join(directory, "REPORT.md"), generateReportMarkdown(report));
}

async function inspectWebsite(url) {
  const crawler = await crawlWebsite(url, { maxPages: 25 });
  const primary = crawler.pages[0];
  const analysis = analyzeHtml(primary.html, primary.url, primary.headers);
  const components = detectComponents(primary.html);
  const routeAnalysis = {
    ...crawler,
    crawledPages: crawler.pages.length,
  };
  const assets = analyzeWebsiteAssets(crawler.pages, analysis.finalUrl);
  return { analysis, routeAnalysis, components, assets, crawler };
}

function resolveMode(requestBody) {
  const validModes = new Set([
    "mirror",
    "ai-rebuild",
    "ai-upgrade",
    "framework-migration",
  ]);
  const { aiRebuildMode = false, rebuildMode } = requestBody || {};
  return validModes.has(rebuildMode)
    ? rebuildMode
    : aiRebuildMode === true
      ? "ai-rebuild"
      : "mirror";
}

function modeLabel(mode) {
  return {
    mirror: "Mirror Website",
    "ai-rebuild": "AI Rebuild Project",
    "ai-upgrade": "AI Upgrade",
    "framework-migration": "Framework Migration",
  }[mode];
}

async function performAnalysis(url) {
  const parsedUrl = parseTargetUrl(url);
  const inspection = await inspectWebsite(parsedUrl.href);
  const { analysis, routeAnalysis, components, assets } = inspection;
  const report = generateWebsiteReport({
    html: analysis.html,
    technologies: analysis.technologies,
    components,
    routeAnalysis,
    assets,
    seoScore: analysis.seo?.score || analysis.metrics.seoScore,
    responsive: analysis.metrics.responsive,
    mode: "Analysis",
    project: { sourceUrl: analysis.finalUrl },
    analysis,
  });

  return {
    success: true,
    url: analysis.finalUrl,
    title: analysis.$("title").text().trim(),
    technologies: analysis.technologies,
    detectedTechnologies: analysis.technologies,
    metrics: analysis.metrics,
    dom: analysis.dom,
    layout: analysis.layout,
    seo: analysis.seo,
    accessibility: analysis.accessibility,
    performance: analysis.performance,
    componentsDetected: analysis.components,
    components,
    routes: routeAnalysis.routes,
    pages: routeAnalysis.discoveredPages,
    crawler: {
      robots: routeAnalysis.robots,
      sitemap: routeAnalysis.sitemap,
      failedPages: routeAnalysis.failedPages,
      maxPages: routeAnalysis.maxPages,
    },
    assets,
    scores: {
      seo: report.seoScore,
      accessibility: report.accessibilityScore,
      performance: report.performanceScore,
      estimatedSimilarity: report.estimatedSimilarity,
    },
    report,
  };
}

async function performRebuild(requestBody, user) {
  const { url, outputType, options = {}, exportFormat = "zip" } = requestBody || {};
  const output = outputTypes[outputType];
  if (!url || !output) {
    throw new HttpError("Provide a URL and a valid output type.", 400);
  }
  if (!user) {
    throw new HttpError("Sign in to continue.", 401);
  }

  const parsedUrl = parseTargetUrl(url);
  const projectName = safeProjectName(requestBody.projectName, parsedUrl.href);
  const mode = resolveMode(requestBody);
  auth.assertCloneAllowed(user, { outputType, rebuildMode: mode });
  const normalizedExportFormat = String(exportFormat).toLowerCase();
  const exportPreset =
    exportFormats[normalizedExportFormat] || exportFormats.zip;
  const jobId = `${Date.now()}-${crypto.randomBytes(4).toString("hex")}`;
  const stagingDirectory = path.join(storageDirectory, `${jobId}-project`);
  const projectDirectory = projectStoragePath(jobId);
  const zipFilename = `${filenameSlug(projectName)}-${jobId}-${outputType}.zip`;
  const zipPath = path.join(outputDirectory, zipFilename);

  await fs.ensureDir(outputDirectory);
  await fs.ensureDir(storageDirectory);
  await fs.ensureDir(projectsDirectory);
  await fs.ensureDir(cacheDirectory);
  await fs.ensureDir(reportsDirectory);
  await fs.ensureDir(exportsDirectory);
  await fs.ensureDir(stagingDirectory);

  const { analysis, routeAnalysis, components, assets, crawler } =
    await inspectWebsite(parsedUrl.href);
  applyDocumentOptions(analysis.$, projectName, analysis.finalUrl, options);
  crawler.pages[0].html = analysis.$.html();

  const collected = await collectAssets(crawler.pages, stagingDirectory, options);
  const rebuildResult = await generateProjectV1({
    pages: collected.pages,
    outputType,
    stagingDirectory,
    sourceUrl: analysis.finalUrl,
    projectName,
    technologies: analysis.technologies,
    detectedComponents: analysis.components,
    mode,
    options,
    exportFormat: normalizedExportFormat,
  });

  const projectStats = await calculateProjectStats(stagingDirectory);
  const reportStructure = [
    ...rebuildResult.outputStructure,
    "report.json",
    "REPORT.md",
    "website-report.json",
  ].sort();

  const report = generateWebsiteReport({
    html: analysis.html,
    technologies: analysis.technologies,
    components,
    routeAnalysis,
    assets,
    seoScore: analysis.seo?.score || analysis.metrics.seoScore,
    responsive: analysis.metrics.responsive,
    mode: modeLabel(mode),
    project: {
      id: jobId,
      name: projectName,
      sourceUrl: analysis.finalUrl,
      outputType,
      outputLabel: output.label,
      exportFormat: normalizedExportFormat,
      exportLabel: exportPreset.label,
      status: "Completed",
    },
    analysis,
    inspector: {
      ...projectStats,
      pagesGenerated: rebuildResult.pagesGenerated,
      componentsGenerated: rebuildResult.components.length,
      assetsDownloaded: collected.assetCount,
      componentMap: rebuildResult.componentMap || [],
      generatedFiles: rebuildResult.generatedFiles || [],
      estimatedSimilarity:
        mode === "mirror"
          ? 98
          : mode === "ai-upgrade"
            ? 88
            : mode === "framework-migration"
              ? 86
              : 92,
    },
    failedAssets: collected.failedAssets,
    outputStructure: reportStructure,
    componentMap: rebuildResult.componentMap || [],
    generatedFiles: rebuildResult.generatedFiles || [],
  });

  report.projectSize = projectStats.projectSize;
  report.projectSizeFormatted = formatBytes(projectStats.projectSize);
  report.fileCount = projectStats.fileCount;
  report.inspector.projectSize = projectStats.projectSize;
  report.inspector.projectSizeFormatted = formatBytes(projectStats.projectSize);
  report.inspector.fileCount = projectStats.fileCount;

  await writeProjectReports(jobId, report, stagingDirectory);
  await createZip(stagingDirectory, zipPath);
  const zipStat = await fs.stat(zipPath);
  await fs.copy(zipPath, exportStoragePath(zipFilename));
  report.inspector.zipSize = zipStat.size;
  report.inspector.zipSizeFormatted = formatBytes(zipStat.size);
  await writeProjectReports(jobId, report, stagingDirectory);

  await fs.remove(projectDirectory);
  await fs.copy(stagingDirectory, projectDirectory);
  await writeProjectReports(jobId, report, projectDirectory);
  await fs.remove(stagingDirectory);

  const project = {
    id: jobId,
    userId: user.id,
    name: projectName,
    url: analysis.finalUrl,
    outputType,
    outputLabel: output.label,
    exportFormat: normalizedExportFormat,
    exportLabel: exportPreset.label,
    date: new Date().toISOString(),
    status: "Completed",
    zipName: zipFilename,
    downloadUrl: `/api/download/${encodeURIComponent(zipFilename)}`,
    reportUrl: `/api/report/${jobId}`,
    inspectorUrl: `/api/project/${jobId}/inspector`,
    assetCount: collected.assetCount,
    technologies: analysis.technologies,
    aiRebuildMode: mode !== "mirror",
    rebuildMode: mode,
    detectedComponents: components,
    componentMap: rebuildResult.componentMap || [],
    detectedRoutes: routeAnalysis.routes,
    assets,
    assetCounts: collected.counts,
    failedAssets: collected.failedAssets,
    projectStructure: { files: reportStructure },
    report,
    options,
    exportFormat: normalizedExportFormat,
    exportLabel: exportPreset.label,
    componentMap: rebuildResult.componentMap || [],
    generatedFiles: rebuildResult.generatedFiles || [],
  };

  await addProject(project);
  await auth.incrementUsage(user.id, "clones");

  return {
    success: true,
    project,
    assetCount: collected.assetCount,
    technologies: analysis.technologies,
    aiRebuildMode: project.aiRebuildMode,
    exportFormat: project.exportFormat,
    exportLabel: project.exportLabel,
    detectedComponents: project.detectedComponents,
    projectStructure: project.projectStructure,
    routes: routeAnalysis.routes,
    assets,
    assetCounts: collected.counts,
    failedAssets: collected.failedAssets,
    report,
    componentMap: rebuildResult.componentMap || [],
    generatedFiles: rebuildResult.generatedFiles || [],
    reportUrl: project.reportUrl,
    inspectorUrl: project.inspectorUrl,
    downloadUrl: project.downloadUrl,
  };
}

function sendAuthPayload(response, user) {
  const token = auth.signToken(user);
  auth.setAuthCookie(response, token);
  response.json({ success: true, token, user: auth.publicUser(user) });
}

function registerApiRoutes(app) {
  app.get("/api/plans", (_request, response) => {
    response.json({
      plans: Object.values(auth.PLANS).map(({ id, name, price, priceLabel, interval, features }) => ({
        id,
        name,
        price,
        priceLabel,
        interval,
        features,
      })),
    });
  });

  app.post(
    "/api/auth/signup",
    asyncHandler(async (request, response) => {
      const user = await auth.createUser(request.body || {});
      sendAuthPayload(response, user);
    }),
  );

  app.post(
    "/api/auth/login",
    asyncHandler(async (request, response) => {
      const { email, password } = request.body || {};
      const user = await auth.authenticateUser(email, password);
      sendAuthPayload(response, user);
    }),
  );

  app.post("/api/auth/logout", (_request, response) => {
    auth.clearAuthCookie(response);
    response.json({ success: true });
  });

  app.get(
    "/api/auth/me",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      response.json({ user: auth.publicUser(request.user) });
    }),
  );

  app.patch(
    "/api/account",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const { name, company } = request.body || {};
      const patch = {};
      if (typeof name === "string" && name.trim()) {
        patch.name = name.trim().slice(0, 80);
      }
      if (typeof company === "string") {
        patch.company = company.trim().slice(0, 80);
      }
      const user = await auth.updateUser(request.user.id, patch);
      response.json({ success: true, user: auth.publicUser(user) });
    }),
  );

  app.get(
    "/api/team/members",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      auth.assertTeamPlan(request.user);
      response.json({
        members: auth.publicUser(request.user).entitlements.teamMembers,
        limit: auth.publicUser(request.user).entitlements.teamMemberLimit,
      });
    }),
  );

  app.post(
    "/api/team/members",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const user = await auth.addTeamMember(request.user.id, request.body || {});
      response.status(201).json({
        success: true,
        member: auth.publicUser(user).entitlements.teamMembers.at(-1),
        user: auth.publicUser(user),
      });
    }),
  );

  app.delete(
    "/api/team/members/:memberId",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const user = await auth.removeTeamMember(request.user.id, request.params.memberId);
      response.json({ success: true, user: auth.publicUser(user) });
    }),
  );

  app.post(
    "/api/billing/subscribe",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const planId = String(request.body?.plan || "").toLowerCase();
      if (!auth.PLANS[planId]) {
        throw new HttpError("Unknown plan.", 400);
      }
      const renewsAt = new Date();
      renewsAt.setMonth(renewsAt.getMonth() + 1);
      const user = await auth.updateUser(request.user.id, {
        plan: planId,
        billing: {
          status: planId === "free" ? "none" : "active",
          provider: "demo",
          plan: planId,
          activatedAt: new Date().toISOString(),
          renewsAt: planId === "free" ? null : renewsAt.toISOString(),
        },
      });
      response.json({
        success: true,
        demo: true,
        message:
          planId === "free"
            ? "You're on the Starter plan."
            : `${auth.PLANS[planId].name} is now active. Connect a payment provider when you go live.`,
        user: auth.publicUser(user),
      });
    }),
  );

  app.post(
    "/api/analyze",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      try {
        auth.assertAnalysisAllowed(request.user);
        const result = await performAnalysis(request.body?.url);
        await auth.incrementUsage(request.user.id, "analyses");
        response.json(result);
      } catch (error) {
        if (error instanceof HttpError) throw error;
        const message =
          error.code === "ENOTFOUND"
            ? "The target website could not be found."
            : error.code === "ECONNABORTED"
              ? "The target website took too long to respond."
              : error.message || "The website could not be analyzed.";
        throw new HttpError(message, 502);
      }
    }),
  );

  app.get(
    "/api/projects",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      response.json({ projects: await readProjectsForUser(request.user.id) });
    }),
  );

  app.get(
    "/api/report/:projectId",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      auth.assertProjectAccess(project, request.user);
      const { storageReport, projectReport, websiteReport, legacyReport } =
        reportStoragePaths(request.params.projectId);
      const reportPath =
        (await fs.pathExists(projectReport) && projectReport) ||
        (await fs.pathExists(websiteReport) && websiteReport) ||
        (await fs.pathExists(storageReport) && storageReport) ||
        (await fs.pathExists(legacyReport) && legacyReport);
      if (!reportPath) {
        throw new HttpError("Project report not found.", 404);
      }
      response.json(await fs.readJson(reportPath));
    }),
  );

  app.get(
    "/api/project/:projectId",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const { storageReport, projectReport, websiteReport, legacyReport } =
        reportStoragePaths(request.params.projectId);
      const reportPath =
        (await fs.pathExists(projectReport) && projectReport) ||
        (await fs.pathExists(websiteReport) && websiteReport) ||
        (await fs.pathExists(storageReport) && storageReport) ||
        (await fs.pathExists(legacyReport) && legacyReport);
      const report = reportPath ? await fs.readJson(reportPath) : null;
      const projectDirectory = projectStoragePath(request.params.projectId);
      const files = await listFilesRecursively(projectDirectory);
      response.json({
        project,
        report,
        files,
        fileCount: files.length,
        exists: await fs.pathExists(projectDirectory),
      });
    }),
  );

  app.get(
    "/api/project/:projectId/files",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const projectDirectory = projectStoragePath(request.params.projectId);
      if (!(await fs.pathExists(projectDirectory))) {
        throw new HttpError("Project files not found.", 404);
      }
      response.json({ files: await listFilesRecursively(projectDirectory) });
    }),
  );

  app.get(
    "/api/project/:projectId/file",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const filePath = request.query.path;
      if (!filePath) throw new HttpError("Invalid project file request.", 400);
      const projectDirectory = projectStoragePath(request.params.projectId);
      if (!(await fs.pathExists(projectDirectory))) {
        throw new HttpError("Project files not found.", 404);
      }
      const resolvedPath = resolveProjectFile(projectDirectory, String(filePath));
      if (!(await fs.pathExists(resolvedPath))) {
        throw new HttpError("File not found.", 404);
      }
      const content = await fs.readFile(resolvedPath, "utf8");
      response.json({ path: String(filePath), content });
    }),
  );

  app.post(
    "/api/project/:projectId/file",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const { path: filePath, content = "" } = request.body || {};
      if (!filePath) throw new HttpError("Invalid project file request.", 400);
      const projectDirectory = projectStoragePath(request.params.projectId);
      if (!(await fs.pathExists(projectDirectory))) {
        throw new HttpError("Project files not found.", 404);
      }
      const resolvedPath = resolveProjectFile(projectDirectory, String(filePath));
      await fs.ensureDir(path.dirname(resolvedPath));
      await fs.writeFile(resolvedPath, String(content), "utf8");
      response.json({ success: true, path: String(filePath) });
    }),
  );

  app.get(
    "/api/project/:projectId/inspector",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      validateProjectId(request.params.projectId);
      const project = await findUserProject(request.user.id, request.params.projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const { storageReport, projectReport, websiteReport, legacyReport } =
        reportStoragePaths(request.params.projectId);
      const reportPath =
        (await fs.pathExists(projectReport) && projectReport) ||
        (await fs.pathExists(websiteReport) && websiteReport) ||
        (await fs.pathExists(storageReport) && storageReport) ||
        (await fs.pathExists(legacyReport) && legacyReport);
      if (!reportPath) throw new HttpError("Project inspector not found.", 404);
      const report = await fs.readJson(reportPath);
      const zipPath = project?.zipName ? path.join(outputDirectory, project.zipName) : null;
      const zipSize =
        zipPath && (await fs.pathExists(zipPath)) ? (await fs.stat(zipPath)).size : 0;
      response.json({
        projectId: request.params.projectId,
        status: report.status,
        projectSize: report.projectSize || 0,
        projectSizeFormatted: formatBytes(report.projectSize || 0),
        fileCount: report.fileCount || 0,
        pagesGenerated: report.inspector?.pagesGenerated || 1,
        componentsGenerated: report.componentsCreated || 0,
        assetsDownloaded: project?.assetCount || 0,
        zipSize,
        zipSizeFormatted: formatBytes(zipSize),
      });
    }),
  );

  app.get(
    "/api/download/:zipName",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const zipName = validateZipName(request.params.zipName);
      const projects = await readProjectsForUser(request.user.id);
      const ownsZip = projects.some(
        (item) => item.zipName === zipName || zipName.includes(item.id),
      );
      if (!ownsZip) throw new HttpError("ZIP file not found.", 404);
      const zipPath = path.join(outputDirectory, zipName);
      if (!(await fs.pathExists(zipPath))) {
        throw new HttpError("ZIP file not found.", 404);
      }
      response.download(zipPath, zipName);
    }),
  );

  app.post(
    "/api/migrate",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const result = await performRebuild(
        {
          ...(request.body || {}),
          rebuildMode: "framework-migration",
          aiRebuildMode: true,
        },
        request.user,
      );
      response.json(result);
    }),
  );

  app.post(
    "/api/export",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const { projectId, exportFormat = "zip" } = request.body || {};
      validateProjectId(projectId);
      const project = await findUserProject(request.user.id, projectId);
      if (!project) throw new HttpError("Project not found.", 404);
      const projectDirectory = projectStoragePath(projectId);
      if (!(await fs.pathExists(projectDirectory))) {
        throw new HttpError("Project files not found.", 404);
      }
      const normalizedExportFormat = String(exportFormat).toLowerCase();
      if (auth.getPlan(request.user).id === "free" && normalizedExportFormat !== "zip") {
        throw new HttpError("Starter includes ZIP downloads only. Upgrade to export this format.", 402);
      }
      const exportDirectory = path.join(
        cacheDirectory,
        `${projectId}-${normalizedExportFormat}-${Date.now()}`,
      );
      const exportZipName = `${filenameSlug(project.name)}-${projectId}-${normalizedExportFormat}.zip`;
      const exportZipPath = path.join(outputDirectory, exportZipName);
      await fs.remove(exportDirectory);
      await fs.copy(projectDirectory, exportDirectory);
      await writeExportPreset(
        exportDirectory,
        normalizedExportFormat,
        project.name,
        project.outputType,
      );
      await createZip(exportDirectory, exportZipPath);
      await fs.remove(exportDirectory);
      await fs.copy(exportZipPath, exportStoragePath(exportZipName));
      response.json({
        success: true,
        projectId,
        exportFormat: normalizedExportFormat,
        downloadUrl: `/api/download/${encodeURIComponent(exportZipName)}`,
        zipName: exportZipName,
      });
    }),
  );

  app.post(
    "/api/chat",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const { projectId, message } = request.body || {};
      const project = projectId
        ? await findUserProject(request.user.id, projectId)
        : null;
      const reply = ai.chat.buildChatResponse({ message, project });
      response.json({
        success: true,
        ...reply,
        providers: ai.providers.listProviders(),
        hint:
          "Future provider integration can replace the rule-based response without changing this route contract.",
      });
    }),
  );

  app.post(
    "/api/rebuild",
    auth.requireAuth,
    asyncHandler(async (request, response) => {
      const result = await performRebuild(request.body || {}, request.user);
      response.json(result);
    }),
  );
}

module.exports = {
  registerApiRoutes,
  performAnalysis,
  performRebuild,
  parseTargetUrl,
};
