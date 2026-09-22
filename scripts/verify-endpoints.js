const preferredBaseUrl = (process.env.BASE_URL || `http://localhost:${process.env.PORT || 4000}`).replace(/\/$/, "");
const fallbackBaseUrl = preferredBaseUrl.includes("localhost")
  ? preferredBaseUrl.replace("localhost", "127.0.0.1")
  : preferredBaseUrl;
const targetUrl = (process.env.TARGET_URL || fallbackBaseUrl).replace(/\/$/, "");

async function requestJson(url, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(options.headers || {}),
  };
  const response = await fetch(url, {
    ...options,
    headers,
  });
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  return { response, data };
}

async function requestJsonWithFallback(path, options = {}) {
  try {
    return await requestJson(`${preferredBaseUrl}${path}`, options);
  } catch (error) {
    if (fallbackBaseUrl === preferredBaseUrl) throw error;
    return requestJson(`${fallbackBaseUrl}${path}`, options);
  }
}

function pickBaseUrl() {
  return fallbackBaseUrl === preferredBaseUrl ? preferredBaseUrl : fallbackBaseUrl;
}

let authToken = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const checks = [];

  const email = `verify-${Date.now()}@clonely.test`;
  const signup = await requestJsonWithFallback("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({
      name: "Endpoint Verifier",
      email,
      password: "verify-pass-123",
    }),
  });
  assert(signup.response.ok, `/api/auth/signup failed: ${JSON.stringify(signup.data)}`);
  authToken = signup.data.token;
  assert(authToken, "/api/auth/signup did not return token");
  checks.push({ endpoint: "POST /api/auth/signup", status: signup.response.status });

  const me = await requestJsonWithFallback("/api/auth/me");
  assert(me.response.ok, "/api/auth/me failed");
  assert(me.data.user?.email === email, "/api/auth/me did not return the signed-up user");
  checks.push({ endpoint: "GET /api/auth/me", status: me.response.status });

  const subscribe = await requestJsonWithFallback("/api/billing/subscribe", {
    method: "POST",
    body: JSON.stringify({ plan: "pro" }),
  });
  assert(subscribe.response.ok, "/api/billing/subscribe failed");
  checks.push({ endpoint: "POST /api/billing/subscribe", status: subscribe.response.status });

  const projects = await requestJsonWithFallback("/api/projects");
  assert(projects.response.ok, "/api/projects failed");
  assert(Array.isArray(projects.data.projects), "/api/projects did not return projects[]");
  checks.push({ endpoint: "GET /api/projects", status: projects.response.status });

  const analyze = await requestJsonWithFallback("/api/analyze", {
    method: "POST",
    body: JSON.stringify({ url: targetUrl }),
  });
  assert(analyze.response.ok, "/api/analyze failed");
  assert(Array.isArray(analyze.data.technologies), "/api/analyze did not return technologies[]");
  checks.push({ endpoint: "POST /api/analyze", status: analyze.response.status });

  const rebuild = await requestJsonWithFallback("/api/rebuild", {
    method: "POST",
    body: JSON.stringify({
      url: targetUrl,
      outputType: "static-html",
      projectName: "Endpoint Verification",
      rebuildMode: "mirror",
      options: {
        downloadImages: false,
        downloadVideos: false,
        downloadFonts: false,
        rewriteCss: true,
        optimizeImages: false,
        mobileResponsive: true,
        seoOptimize: true,
        generateComponents: false,
        aiCleanCode: false,
        splitComponents: true,
        removeDuplicateCss: true,
        renameClasses: true,
        improveAccessibility: true,
        generateReadme: true,
        generateHtaccess: false,
        generateSitemap: false,
        generateRobots: false,
      },
    }),
  });
  assert(rebuild.response.ok, `/api/rebuild failed: ${JSON.stringify(rebuild.data)}`);
  assert(rebuild.data.project?.id, "/api/rebuild did not return project.id");
  const projectId = rebuild.data.project.id;
  const zipName = rebuild.data.project.zipName;
  checks.push({ endpoint: "POST /api/rebuild", status: rebuild.response.status });

  const project = await requestJsonWithFallback(`/api/project/${projectId}`);
  assert(project.response.ok, "/api/project/:id failed");
  checks.push({ endpoint: "GET /api/project/:id", status: project.response.status });

  const report = await requestJsonWithFallback(`/api/report/${projectId}`);
  assert(report.response.ok, "/api/report/:id failed");
  checks.push({ endpoint: "GET /api/report/:id", status: report.response.status });

  const inspector = await requestJsonWithFallback(`/api/project/${projectId}/inspector`);
  assert(inspector.response.ok, "/api/project/:id/inspector failed");
  checks.push({ endpoint: "GET /api/project/:id/inspector", status: inspector.response.status });

  const files = await requestJsonWithFallback(`/api/project/${projectId}/files`);
  assert(files.response.ok, "/api/project/:id/files failed");
  assert(Array.isArray(files.data.files), "/api/project/:id/files did not return files[]");
  checks.push({ endpoint: "GET /api/project/:id/files", status: files.response.status });

  const filePath = files.data.files.find((entry) => entry.endsWith("index.html")) || files.data.files[0];
  if (filePath) {
    const file = await requestJsonWithFallback(`/api/project/${projectId}/file?path=${encodeURIComponent(filePath)}`);
    assert(file.response.ok, "/api/project/:id/file failed");
    checks.push({ endpoint: "GET /api/project/:id/file", status: file.response.status });
  }

  const exportResponse = await requestJsonWithFallback("/api/export", {
    method: "POST",
    body: JSON.stringify({ projectId, exportFormat: "zip" }),
  });
  assert(exportResponse.response.ok, "/api/export failed");
  checks.push({ endpoint: "POST /api/export", status: exportResponse.response.status });

  const download = await fetch(`${pickBaseUrl()}/api/download/${encodeURIComponent(zipName)}`, {
    method: "HEAD",
    headers: { Authorization: `Bearer ${authToken}` },
  });
  assert(download.ok, "/api/download/:zipName failed");
  checks.push({ endpoint: "GET /api/download/:zipName", status: download.status });

  const chat = await requestJsonWithFallback("/api/chat", {
    method: "POST",
    body: JSON.stringify({ projectId, message: "Check status" }),
  });
  assert(chat.response.ok, "/api/chat failed");
  checks.push({ endpoint: "POST /api/chat", status: chat.response.status });

  const migrate = await requestJsonWithFallback("/api/migrate", {
    method: "POST",
    body: JSON.stringify({
      url: targetUrl,
      outputType: "static-html",
      projectName: "Endpoint Migration Verification",
      options: {},
    }),
  });
  assert(migrate.response.ok, "/api/migrate failed");
  checks.push({ endpoint: "POST /api/migrate", status: migrate.response.status });

  console.log(JSON.stringify({ ok: true, checks }, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
