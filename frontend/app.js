/* ═══════════════════════════════════════════════════════════════
   Clonely Pro — SPA Controller
   ═══════════════════════════════════════════════════════════════ */

'use strict';

const TOKEN_KEY = 'clonely_token';
let currentUser = null;

function authHeaders() {
  const token = localStorage.getItem(TOKEN_KEY);
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function apiFetch(url, options = {}) {
  const headers = { ...(options.headers || {}), ...authHeaders() };
  if (options.body && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const response = await fetch(url, { credentials: 'include', ...options, headers });
  if (response.status === 401 && !String(url).includes('/api/auth/')) {
    localStorage.removeItem(TOKEN_KEY);
    window.location.href = '/login?next=/app';
    throw new Error('Sign in to continue.');
  }
  return response;
}

async function loadSession() {
  const response = await apiFetch('/api/auth/me');
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || 'Sign in to continue.');
  currentUser = data.user;
  renderAccount(currentUser);
  return currentUser;
}

function renderAccount(user) {
  if (!user) return;
  setText('sidebar-user-name', user.name || user.email);
  setText('sidebar-user-plan', user.planName || user.plan);
  setText('topbar-plan', user.planName || 'Starter');
  setText('billing-current-plan', user.planName || 'Starter');
  setText('billing-usage-summary', `${user.usage.clones}/${user.usage.cloneLimit} clones · ${user.usage.analyses}/${user.usage.analysisLimit} analyses`);
  setText('billing-status-text', user.billing?.status === 'active' ? 'Active' : 'Starter access');
  setText('billing-renewal-text', user.billing?.renewsAt ? `Renews ${new Date(user.billing.renewsAt).toLocaleDateString()}.` : 'No payment method required.');
  setText('welcome-title', `Welcome back, ${(user.name || 'there').split(' ')[0]} 👋`);
  const nameInput = document.getElementById('settings-name');
  const emailInput = document.getElementById('settings-email');
  const companyInput = document.getElementById('settings-company');
  if (nameInput) nameInput.value = user.name || '';
  if (emailInput) emailInput.value = user.email || '';
  if (companyInput) companyInput.value = user.company || '';
  const clonePct = user.usage.cloneLimit
    ? Math.min(100, Math.round((user.usage.clones / user.usage.cloneLimit) * 100))
    : 0;
  const analysisPct = user.usage.analysisLimit
    ? Math.min(100, Math.round((user.usage.analyses / user.usage.analysisLimit) * 100))
    : 0;
  setText(
    'usage-summary',
    `${user.usage.clones}/${user.usage.cloneLimit} clones · ${user.usage.analyses}/${user.usage.analysisLimit} analyses`,
  );
  const clonesBar = document.getElementById('usage-clones-bar');
  const analysesBar = document.getElementById('usage-analyses-bar');
  if (clonesBar) clonesBar.style.width = `${clonePct}%`;
  if (analysesBar) analysesBar.style.width = `${analysisPct}%`;
  applyPlanEntitlements(user);
}

function applyPlanEntitlements(user) {
  const entitlements = user.entitlements || {};
  const hasAiModes = entitlements.aiModes === true;
  const formats = entitlements.formats;
  const hasAllFormats = formats === 'all';

  document.querySelectorAll('#mode-grid .mode-card').forEach((card) => {
    const input = card.querySelector('input[name="rebuildMode"]');
    const locked = input?.value !== 'mirror' && !hasAiModes;
    card.classList.toggle('locked', locked);
    if (input) {
      input.disabled = locked;
      card.title = locked ? 'Upgrade to Pro or Team to unlock this mode.' : '';
    }
  });

  document.querySelectorAll('#format-grid .format-card').forEach((card) => {
    const input = card.querySelector('input[name="outputType"]');
    const locked = !input || (!hasAllFormats && !formats?.includes(input.value));
    card.classList.toggle('locked', locked);
    if (input) {
      input.disabled = locked;
      card.title = locked ? 'Upgrade to Pro or Team to unlock this output format.' : '';
    }
  });
}

async function logout() {
  await apiFetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = '/';
}

document.getElementById('logout-button')?.addEventListener('click', logout);

// ─── State ────────────────────────────────────────────────────────
let activeProjectId = null;
let activeProject   = null;
let activeFilePath  = '';
let allProjects     = [];
let currentWizardStep = 1;
let billingPlans = [];

// ─── View Navigation ──────────────────────────────────────────────
const viewNames = ['dashboard', 'new-clone', 'projects', 'editor', 'reports', 'chat', 'billing', 'settings'];
const viewTitles = {
  'dashboard': 'Dashboard',
  'new-clone': 'New Clone',
  'projects':  'Projects',
  'editor':    'File Editor',
  'reports':   'Reports',
  'chat':      'AI Chat',
  'billing':   'Billing',
  'settings':  'Settings',
};

function switchView(name) {
  // Update sidebar
  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.view === name);
  });
  // Update panels
  document.querySelectorAll('.view').forEach(el => {
    const isTarget = el.id === `view-${name}`;
    el.classList.toggle('active', isTarget);
    if (isTarget) el.style.display = '';
    else el.style.display = 'none';
  });
  // Update topbar title
  const topbarTitle = document.getElementById('topbar-title');
  if (topbarTitle) topbarTitle.textContent = viewTitles[name] || name;
  // Close mobile sidebar
  document.getElementById('sidebar').classList.remove('open');
  // History
  window.history.pushState({ view: name }, '', '#' + name);
}

// Sidebar toggle (mobile)
document.getElementById('sidebar-toggle')?.addEventListener('click', () => {
  document.getElementById('sidebar').classList.toggle('open');
});

// Nav items
document.querySelectorAll('.nav-item[data-view]').forEach(item => {
  item.addEventListener('click', () => switchView(item.dataset.view));
});

// Handle browser back/forward
window.addEventListener('popstate', (e) => {
  if (e.state?.view) switchView(e.state.view);
});

// Initialize from hash or default
function initView() {
  const hash = window.location.hash.replace('#', '');
  const view = viewNames.includes(hash) ? hash : 'dashboard';
  // Reset all
  document.querySelectorAll('.view').forEach(el => {
    el.style.display = 'none';
    el.classList.remove('active');
  });
  switchView(view);
}

// ─── Output structure trees ───────────────────────────────────────
const structures = {
  'static-html': { badge: 'HTML', tree: `project/\n├── index.html\n├── assets/\n│   ├── styles.css\n│   ├── scripts.js\n│   └── images/\n├── fonts/\n├── videos/\n├── icons/\n├── documents/\n├── manifests/\n├── data/\n└── README.md` },
  php:       { badge: 'PHP',     tree: `project/\n├── index.php\n├── assets/\n│   ├── styles.css\n│   ├── scripts.js\n│   └── images/\n└── README.md` },
  laravel:   { badge: 'LARAVEL', tree: `project/\n├── public/\n│   ├── index.php\n│   └── assets/\n├── resources/views/\n│   └── welcome.blade.php\n├── routes/web.php\n└── composer.json` },
  wordpress: { badge: 'WP',      tree: `theme/\n├── index.php\n├── functions.php\n├── style.css\n├── assets/\n│   ├── scripts.js\n│   └── images/\n└── README.md` },
  nextjs:    { badge: 'NEXT.JS', tree: `project/\n├── app/\n│   ├── layout.js\n│   ├── page.js\n│   └── globals.css\n├── public/site/\n│   ├── index.html\n│   └── assets/\n└── package.json` },
  nuxt:      { badge: 'NUXT',    tree: `project/\n├── app/\n│   ├── app.vue\n│   └── page.vue\n├── public/assets/\n├── nuxt.config.ts\n└── package.json` },
  react:     { badge: 'REACT',   tree: `project/\n├── src/\n│   ├── App.jsx\n│   ├── main.jsx\n│   └── index.css\n├── public/\n│   ├── source.html\n│   └── assets/\n└── package.json` },
  vue:       { badge: 'VUE',     tree: `project/\n├── src/\n│   ├── App.vue\n│   └── main.js\n├── public/\n│   ├── source.html\n│   └── assets/\n└── package.json` },
  aspnet:    { badge: '.NET',    tree: `project/\n├── wwwroot/\n│   ├── index.html\n│   └── assets/\n├── Program.cs\n├── RebuiltWebsite.csproj\n└── README.md` },
  express:   { badge: 'EXPRESS', tree: `project/\n├── server.js\n├── public/assets/\n├── routes/index.js\n├── package.json\n└── README.md` },
  node:      { badge: 'NODE',    tree: `project/\n├── server.js\n├── public/assets/\n├── package.json\n└── README.md` },
};

const aiStructures = {
  'static-html': { badge: 'AI HTML',    tree: `project/\n├── index.html\n├── style.css\n├── script.js\n├── images/\n├── fonts/\n├── videos/\n├── icons/\n├── documents/\n├── manifests/\n├── data/\n└── README.md` },
  php:       { badge: 'AI PHP',     tree: `project/\n├── index.php\n├── includes/\n│   ├── header.php\n│   └── footer.php\n├── components/\n├── assets/css/\n├── assets/js/\n├── assets/images/\n└── README.md` },
  laravel:   { badge: 'AI LARAVEL', tree: `project/\n├── resources/views/\n│   ├── layouts/app.blade.php\n│   ├── components/\n│   └── home.blade.php\n├── routes/web.php\n├── public/assets/\n└── README.md` },
  wordpress: { badge: 'AI WP',      tree: `theme/\n├── style.css\n├── functions.php\n├── header.php\n├── footer.php\n├── page.php\n├── single.php\n├── assets/\n└── README.md` },
  nextjs:    { badge: 'AI NEXT.JS', tree: `project/\n├── app/\n│   ├── layout.js\n│   ├── page.js\n│   └── globals.css\n├── components/\n├── public/assets/\n├── package.json\n└── README.md` },
  nuxt:      { badge: 'AI NUXT',    tree: `project/\n├── app/\n│   ├── app.vue\n│   └── page.vue\n├── components/\n├── public/assets/\n├── nuxt.config.ts\n├── package.json\n└── README.md` },
  react:     { badge: 'AI REACT',   tree: `project/\n├── src/components/\n├── src/pages/Home.jsx\n├── src/App.jsx\n├── src/main.jsx\n├── public/assets/\n├── package.json\n└── README.md` },
  vue:       { badge: 'AI VUE',     tree: `project/\n├── src/components/\n├── src/views/Home.vue\n├── src/App.vue\n├── src/main.js\n├── public/assets/\n├── package.json\n└── README.md` },
  aspnet:    { badge: 'AI .NET',    tree: `project/\n├── Controllers/\n├── Views/\n│   ├── Home/\n│   └── Shared/\n├── wwwroot/\n├── Program.cs\n├── RebuiltWebsite.csproj\n└── README.md` },
  express:   { badge: 'AI EXPRESS', tree: `project/\n├── routes/\n├── public/assets/\n├── server.js\n├── package.json\n└── README.md` },
  node:      { badge: 'AI NODE',    tree: `project/\n├── public/assets/\n├── server.js\n├── package.json\n└── README.md` },
};

// ─── Form references ──────────────────────────────────────────────
const form = document.getElementById('rebuild-form');

function selectedOutputType() { return form.elements.outputType?.value || 'static-html'; }
function selectedMode()       { return form.elements.rebuildMode?.value || 'mirror'; }
function selectedExportFormat(){ return form.elements.exportFormat?.value || 'zip'; }

function updateStructure() {
  const source = selectedMode() === 'mirror' ? structures : aiStructures;
  const data = source[selectedOutputType()] || source['static-html'];
  const badge = document.getElementById('structure-type');
  const preview = document.getElementById('structure-preview');
  if (badge) badge.textContent = data.badge;
  if (preview) preview.textContent = data.tree;
}

// ─── Wizard Step Navigation ───────────────────────────────────────
function goToWizardStep(n) {
  const total = 5;
  n = Math.max(1, Math.min(total, n));
  currentWizardStep = n;

  // Step panels
  document.querySelectorAll('.wizard-step-panel').forEach(p => {
    const num = parseInt(p.id.replace('wstep-', ''));
    p.classList.toggle('active', num === n);
  });

  // Step indicators
  document.querySelectorAll('.wiz-step').forEach(s => {
    const num = parseInt(s.dataset.step);
    s.classList.toggle('active', num === n);
    s.classList.toggle('done', num < n);
  });
}

// Wire nav buttons
document.querySelectorAll('.btn-next[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => {
    const target = parseInt(btn.dataset.goto);
    if (target === 5) populateReview();
    goToWizardStep(target);
  });
});
document.querySelectorAll('.btn-prev[data-goto]').forEach(btn => {
  btn.addEventListener('click', () => goToWizardStep(parseInt(btn.dataset.goto)));
});

// ─── Mode Cards ───────────────────────────────────────────────────
const modeCards = [...document.querySelectorAll('.mode-card')];
const aiImprovements = document.getElementById('ai-improvements');

modeCards.forEach(card => {
  card.addEventListener('click', () => {
    modeCards.forEach(c => c.classList.remove('selected'));
    card.classList.add('selected');
    const isAI = selectedMode() !== 'mirror';
    if (aiImprovements) aiImprovements.hidden = !isAI;
    updateStructure();
  });
});

// ─── Format Cards ─────────────────────────────────────────────────
function wireCards(selector) {
  const cards = [...document.querySelectorAll(selector)];
  cards.forEach(card => {
    card.addEventListener('click', () => {
      cards.forEach(c => c.classList.remove('selected'));
      card.classList.add('selected');
      updateStructure();
    });
  });
}
wireCards('#format-grid .format-card');
wireCards('#export-grid .format-card');

// ─── Review Step Population ───────────────────────────────────────
const modeLabels = {
  mirror: 'Mirror Clone',
  'ai-rebuild': 'AI Rebuild',
  'ai-upgrade': 'AI Upgrade',
  'framework-migration': 'Framework Migration',
};
const outputLabels = {
  'static-html': 'Static HTML', php: 'PHP', laravel: 'Laravel',
  wordpress: 'WordPress', nextjs: 'Next.js', nuxt: 'Nuxt',
  react: 'React', vue: 'Vue', aspnet: 'ASP.NET', express: 'Express', node: 'Node',
};
const exportLabels = {
  zip: 'ZIP Archive', git: 'Git Repository', docker: 'Docker',
  plesk: 'Plesk', cpanel: 'cPanel', ftp: 'FTP Package',
};

function populateReview() {
  setText('review-url',    form.elements.url?.value || '—');
  setText('review-name',   form.elements.projectName?.value || '—');
  setText('review-mode',   modeLabels[selectedMode()] || selectedMode());
  setText('review-output', outputLabels[selectedOutputType()] || selectedOutputType());
  setText('review-export', exportLabels[selectedExportFormat()] || selectedExportFormat());
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

// ─── Progress ─────────────────────────────────────────────────────
const progressPanel   = document.getElementById('progress-panel');
const progressSteps   = [...document.querySelectorAll('#progress-steps li')];
const progressBar     = document.getElementById('progress-bar');
const progressPercent = document.getElementById('progress-percent');
const progressTitle   = document.getElementById('progress-title');
const resultActions   = document.getElementById('result-actions');
const downloadLink    = document.getElementById('download-link');
const progressTrack   = document.querySelector('.progress-track');

let progressTimer, progressIndex = 0;

function setProgress(index) {
  progressIndex = Math.min(index, progressSteps.length);
  progressSteps.forEach((step, i) => {
    step.classList.toggle('done',   i < progressIndex);
    step.classList.toggle('active', i === progressIndex);
  });
  const pct = Math.round((progressIndex / progressSteps.length) * 100);
  if (progressBar) progressBar.style.width = pct + '%';
  if (progressPercent) progressPercent.textContent = pct + '%';
  if (progressTrack) progressTrack.setAttribute('aria-valuenow', pct);
}

function startProgress() {
  clearInterval(progressTimer);
  if (!progressPanel) return;
  progressPanel.hidden = false;
  progressPanel.classList.remove('error');
  if (resultActions) resultActions.hidden = true;
  setText('progress-title', 'Cloning your website…');
  setProgress(0);
  progressTimer = setInterval(() => {
    if (progressIndex < progressSteps.length - 2) setProgress(progressIndex + 1);
  }, 850);
  progressPanel.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function finishProgress(data) {
  clearInterval(progressTimer);
  setProgress(progressSteps.length);
  setText('progress-title', 'Clone complete!');
  const componentText = data.aiRebuildMode ? ` ${data.report?.componentsCreated || 0} components generated.` : '';
  const exportText = data.project?.exportLabel ? ` Exported as ${data.project.exportLabel}.` : '';
  setText('result-message', `${data.assetCount} assets downloaded. ${data.technologies?.length} technologies detected.${componentText}${exportText}`);
  setText('result-technology', data.technologies?.slice(0,3).join(', ') || '—');
  setText('result-pages',      data.report?.pagesCount ?? 0);
  setText('result-assets',     data.assetCount ?? 0);
  setText('result-components', data.report?.componentsCreated ?? 0);
  setText('result-similarity', `${data.report?.estimatedSimilarity ?? 0}%`);
  if (downloadLink) { downloadLink.href = data.downloadUrl; downloadLink.removeAttribute('hidden'); }
  if (resultActions) resultActions.hidden = false;
  renderAnalysisPanels(data);
  renderReport(data.report);
  if (data.project?.id) loadProjectEditor(data.project.id, data.project);
  loadProjects();
  loadSession().catch(() => {});
}

function failProgress(message) {
  clearInterval(progressTimer);
  if (progressPanel) progressPanel.classList.add('error');
  setText('progress-title', 'Build failed');
  setText('result-message', message);
  if (downloadLink) downloadLink.hidden = true;
  if (resultActions) resultActions.hidden = false;
}

// ─── Get form options ─────────────────────────────────────────────
function getOptions() {
  const names = [
    'downloadImages','downloadVideos','downloadFonts','rewriteCss','optimizeImages',
    'mobileResponsive','seoOptimize','generateComponents','aiCleanCode',
    'splitComponents','removeDuplicateCss','renameClasses','improveAccessibility',
    'generateReadme','generateHtaccess','generateSitemap','generateRobots',
  ];
  return Object.fromEntries(
    names.map(name => [name, form.elements[name]?.checked ?? false])
  );
}

// ─── Form Submit ──────────────────────────────────────────────────
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const submitBtn = document.getElementById('submit-button');
  if (submitBtn) { submitBtn.disabled = true; submitBtn.classList.add('loading'); }
  startProgress();
  try {
    const resp = await apiFetch('/api/rebuild', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: form.elements.url?.value.trim(),
        projectName: form.elements.projectName?.value.trim(),
        outputType: selectedOutputType(),
        aiRebuildMode: selectedMode() !== 'mirror',
        rebuildMode: selectedMode(),
        exportFormat: selectedExportFormat(),
        options: getOptions(),
      }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'The rebuild could not be completed.');
    finishProgress(data);
  } catch (err) {
    failProgress(err.message);
  } finally {
    if (submitBtn) { submitBtn.disabled = false; submitBtn.classList.remove('loading'); }
  }
});

// ─── Analyze Button ───────────────────────────────────────────────
const analyzeBtn = document.getElementById('analyze-button');
analyzeBtn?.addEventListener('click', async () => {
  const urlInput = form.elements.url;
  if (!urlInput?.reportValidity()) return;
  analyzeBtn.disabled = true;
  analyzeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14" style="animation:spin 600ms linear infinite"><path fill-rule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1z" clip-rule="evenodd"/></svg> Analyzing…`;

  const analyzeResult = document.getElementById('analyze-result');
  const statusBadge   = document.getElementById('analyze-status-badge');
  if (analyzeResult) analyzeResult.hidden = true;

  try {
    const resp = await apiFetch('/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: urlInput.value.trim() }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Analysis failed.');
    renderAnalysisPanels(data);
    renderReport(data.report, false);
    loadSession().catch(() => {});
    if (analyzeResult) analyzeResult.hidden = false;
    if (statusBadge) statusBadge.textContent = 'Complete';
    // Auto-fill project name if empty
    const nameInput = form.elements.projectName;
    if (nameInput && !nameInput.value) {
      try { nameInput.value = new URL(urlInput.value).hostname.replace('www.',''); } catch {}
    }
  } catch (err) {
    renderTechnologies([]);
    const tl = document.getElementById('technology-list');
    if (tl) { tl.innerHTML = ''; const p = document.createElement('p'); p.className = 'empty-copy'; p.textContent = err.message; tl.append(p); }
    if (analyzeResult) analyzeResult.hidden = false;
    if (statusBadge) { statusBadge.textContent = 'Failed'; statusBadge.className = 'status-badge'; statusBadge.style.cssText = 'background:var(--danger-bg);color:var(--danger);border:1px solid rgba(225,29,72,.2)'; }
  } finally {
    analyzeBtn.disabled = false;
    analyzeBtn.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="14" height="14"><path fill-rule="evenodd" d="M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z" clip-rule="evenodd"/></svg> Analyze URL`;
  }
});

// ─── Render helpers ───────────────────────────────────────────────
function renderTechnologies(techs) {
  const el = document.getElementById('technology-list');
  if (!el) return;
  el.replaceChildren();
  if (!techs?.length) {
    const p = document.createElement('p'); p.className = 'empty-copy'; p.textContent = 'No common technologies detected.'; el.append(p); return;
  }
  techs.forEach(t => { const c = document.createElement('span'); c.className = 'technology-chip'; c.textContent = t; el.append(c); });
}

function renderInspectorItems(containerId, items, emptyMsg, formatter) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  if (!items?.length) {
    const p = document.createElement('p'); p.className = 'empty-copy'; p.textContent = emptyMsg; el.append(p); return;
  }
  items.forEach(item => { const row = document.createElement('div'); row.className = 'inspector-item'; formatter(row, item); el.append(row); });
}

function renderComponents(components) {
  renderInspectorItems('component-list', components, 'No components detected.', (row, c) => {
    const name = document.createElement('span');
    const conf = document.createElement('b');
    name.textContent = typeof c === 'string' ? c : c.name;
    conf.textContent = typeof c === 'string' ? 'Detected' : `${c.confidence}%`;
    row.append(name, conf);
  });
}

function renderRoutes(routes) {
  renderInspectorItems('route-list', routes, 'No internal routes detected.', (row, r) => { row.textContent = r; row.title = r; });
}

function renderMiniMetrics(containerId, metrics) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.replaceChildren();
  el.className = 'mini-metrics';
  metrics.forEach(([label, value]) => {
    const item = document.createElement('div'); item.className = 'side-metric';
    const s = document.createElement('span'); s.textContent = label;
    const b = document.createElement('strong'); b.textContent = value ?? 0;
    item.append(s, b); el.append(item);
  });
}

function renderAssets(assets, report = {}) {
  const c = assets?.counts || {
    images: report.imagesCount, css: report.cssCount ?? report.cssFilesCount,
    js: report.jsCount ?? report.jsFilesCount, fonts: report.fontsCount,
    videos: report.videosCount, icons: report.iconsCount, svg: report.svgCount,
    audio: report.audioCount, documents: report.documentsCount,
    manifests: report.manifestsCount, data: report.dataCount,
    externalCdnAssets: report.externalCdnAssets,
  };
  renderMiniMetrics('asset-summary', [
    ['Images', c.images], ['CSS', c.css], ['JavaScript', c.js],
    ['Fonts', c.fonts], ['Videos', c.videos], ['SVG', c.svg],
    ['Audio', c.audio], ['PDF', c.documents], ['Icons', c.icons],
    ['External CDN', c.externalCdnAssets],
  ]);
}

function renderSideReport(report) {
  if (!report) return;
  const score = v => Number.isFinite(v) ? `${v}/100` : '—';
  renderMiniMetrics('side-report', [
    ['SEO', score(report.seoScore)],
    ['Accessibility', score(report.accessibilityScore)],
    ['Performance', score(report.performanceScore)],
    ['Responsive', report.responsiveStatus || (report.responsive ? 'Responsive' : 'Needs review')],
    ['Pages', report.pagesCount],
    ['Similarity', `${report.estimatedSimilarity}%`],
  ]);
}

function renderAnalysisPanels(data) {
  renderTechnologies(data.technologies || data.detectedTechnologies || data.report?.detectedTechnologies);
  renderComponents(data.components || data.detectedComponents || data.report?.detectedComponents);
  renderRoutes(data.routes || data.detectedRoutes || data.report?.detectedRoutes);
  renderAssets(data.assets, data.report);
  renderSideReport(data.report);
}

// ─── Report Rendering ─────────────────────────────────────────────
function renderReport(report, shouldSwitch = false) {
  if (!report) return;
  const score = v => Number.isFinite(v) ? `${v}/100` : '—';
  const metrics = [
    ['Pages', report.pagesCount], ['Images', report.imagesCount],
    ['CSS files', report.cssCount ?? report.cssFilesCount],
    ['JS files', report.jsCount ?? report.jsFilesCount],
    ['Fonts', report.fontsCount], ['Videos', report.videosCount],
    ['Icons', report.iconsCount], ['SVG', report.svgCount],
    ['Audio', report.audioCount], ['PDF', report.documentsCount],
    ['Responsive', report.responsiveStatus || (report.responsive ? 'Yes' : 'No')],
    ['SEO Score', score(report.seoScore)],
    ['Accessibility', score(report.accessibilityScore)],
    ['Performance', score(report.performanceScore)],
    ['Components', report.componentsCreated],
    ['Similarity', `${report.estimatedSimilarity}%`],
    ['Project Size', report.projectSizeFormatted || '—'],
    ['Files', report.fileCount ?? '—'],
    ['ZIP Size', report.inspector?.zipSizeFormatted || '—'],
  ];

  setText('report-title', report.projectName ? `${report.projectName} — Report` : 'Website Report');
  const reportScores = [report.seoScore, report.accessibilityScore, report.performanceScore].filter(Number.isFinite);
  const overallScore = reportScores.length ? Math.round(reportScores.reduce((total, value) => total + value, 0) / reportScores.length) : null;
  setText('report-overall-score', overallScore === null ? '—' : `${overallScore}/100`);
  const scoreLabel = overallScore === null ? 'Awaiting scores' : overallScore >= 85 ? 'Strong foundation' : overallScore >= 65 ? 'Worth a review' : 'Needs attention';
  const scoreDescription = document.querySelector('.report-score-card p');
  if (scoreDescription) scoreDescription.textContent = `${scoreLabel}. Based on SEO, accessibility, performance, and source structure.`;
  [['seo', report.seoScore], ['accessibility', report.accessibilityScore], ['performance', report.performanceScore]].forEach(([key, value]) => {
    const scoreText = Number.isFinite(value) ? `${value}/100` : '—';
    setText(`report-${key}-score`, scoreText);
    const bar = document.getElementById(`report-${key}-bar`);
    if (bar) bar.style.width = `${Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : 0}%`;
  });

  const metricsEl = document.getElementById('report-metrics');
  if (metricsEl) {
    metricsEl.replaceChildren();
    metrics.forEach(([label, value]) => {
      const el = document.createElement('div'); el.className = 'report-metric';
      const s = document.createElement('span'); s.textContent = label;
      const b = document.createElement('strong'); b.textContent = value ?? 0;
      el.append(s, b); metricsEl.append(el);
    });
  }

  const techList = document.getElementById('report-technology-list');
  if (techList) {
    techList.replaceChildren();
    (report.detectedTechnologies || report.technologies || []).forEach(t => {
      const c = document.createElement('span'); c.className = 'technology-chip'; c.textContent = t; techList.append(c);
    });
  }

  // Show report content, hide empty state
  const emptyPanel = document.getElementById('report-panel');
  const contentPanel = document.getElementById('report-content');
  if (emptyPanel) emptyPanel.style.display = 'none';
  if (contentPanel) { contentPanel.hidden = false; }

  if (shouldSwitch) switchView('reports');
}

async function viewReport(project) {
  try {
    const resp = await apiFetch(project.reportUrl || `/api/report/${encodeURIComponent(project.id)}`);
    const report = await resp.json();
    if (!resp.ok) throw new Error(report.error || 'Report unavailable.');
    renderAnalysisPanels({ report });
    renderReport(report, true);
  } catch (err) {
    alert(err.message);
  }
}

// ─── Projects Table ───────────────────────────────────────────────
function projectRow(project) {
  const tr = document.createElement('tr');
  // Name cell
  const nameTd = document.createElement('td');
  const name = document.createElement('strong'); name.textContent = project.name;
  const meta = document.createElement('span'); meta.textContent = `${project.assetCount || 0} assets · ${project.exportLabel || 'ZIP'}`;
  nameTd.append(name, meta);
  // URL cell
  const urlTd = document.createElement('td');
  const urlSpan = document.createElement('span'); urlSpan.className = 'project-url'; urlSpan.title = project.url; urlSpan.textContent = project.url;
  urlTd.append(urlSpan);
  // Output cell
  const outputTd = document.createElement('td');
  const outputBadge = document.createElement('span'); outputBadge.className = 'output-label'; outputBadge.textContent = project.outputLabel || project.outputType;
  outputTd.append(outputBadge);
  // Mode cell
  const modeTd = document.createElement('td');
  modeTd.textContent = modeLabels[project.rebuildMode] || (project.aiRebuildMode ? 'AI Rebuild' : 'Mirror');
  // Status cell
  const statusTd = document.createElement('td');
  const statusSpan = document.createElement('span'); statusSpan.className = 'status-complete'; statusSpan.textContent = project.status || 'Completed';
  statusTd.append(statusSpan);
  // Date cell
  const dateTd = document.createElement('td');
  dateTd.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(project.date));
  // Actions cell
  const actTd = document.createElement('td'); actTd.className = 'table-actions';
  const dl = document.createElement('a'); dl.className = 'table-download';
  dl.href = project.downloadUrl || `/api/download/${encodeURIComponent(project.zipName)}`;
  dl.innerHTML = `<svg viewBox="0 0 20 20" fill="currentColor" width="12" height="12"><path fill-rule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zm3.293-7.707a1 1 0 011.414 0L9 10.586V3a1 1 0 112 0v7.586l1.293-1.293a1 1 0 111.414 1.414l-3 3a1 1 0 01-1.414 0l-3-3a1 1 0 010-1.414z" clip-rule="evenodd"/></svg> Download`;
  const reportBtn = document.createElement('button'); reportBtn.className = 'report-action'; reportBtn.type = 'button'; reportBtn.textContent = 'Report';
  reportBtn.disabled = !project.reportUrl; reportBtn.addEventListener('click', () => viewReport(project));
  const editBtn = document.createElement('button'); editBtn.className = 'report-action'; editBtn.type = 'button'; editBtn.textContent = 'Edit Files';
  editBtn.addEventListener('click', () => { loadProjectEditor(project.id, project); switchView('editor'); });
  actTd.append(dl, reportBtn, editBtn);
  tr.append(nameTd, urlTd, outputTd, modeTd, statusTd, dateTd, actTd);
  return tr;
}

function renderProjectsTable(projects, tbodyId = 'projects-list') {
  const tbody = document.getElementById(tbodyId);
  if (!tbody) return;
  tbody.replaceChildren();
  if (!projects.length) {
    tbody.innerHTML = `<tr><td colspan="7" class="table-empty">No projects yet. <button class="btn-accent" onclick="switchView('new-clone')" style="margin-left:8px">Clone your first website</button></td></tr>`;
    return;
  }
  projects.forEach(p => tbody.append(projectRow(p)));
}

function renderDashboardTable(projects) {
  const tbody = document.getElementById('dashboard-projects-list');
  if (!tbody) return;
  tbody.replaceChildren();
  const recent = projects.slice(0, 5);
  if (!recent.length) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty">No projects yet.</td></tr>`;
    return;
  }
  recent.forEach(p => {
    const tr = document.createElement('tr');
    const nameTd = document.createElement('td');
    const name = document.createElement('strong'); name.textContent = p.name;
    const meta = document.createElement('span'); meta.textContent = p.url;
    meta.style.cssText = 'display:block;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:var(--muted);font-size:.7rem';
    nameTd.append(name, meta);
    const urlTd = document.createElement('td');
    const urlSpan = document.createElement('span'); urlSpan.className = 'project-url'; urlSpan.textContent = p.url;
    urlTd.append(urlSpan);
    const outputTd = document.createElement('td');
    const badge = document.createElement('span'); badge.className = 'output-label'; badge.textContent = p.outputLabel || p.outputType;
    outputTd.append(badge);
    const statusTd = document.createElement('td');
    const status = document.createElement('span'); status.className = 'status-complete'; status.textContent = p.status || 'Completed';
    statusTd.append(status);
    const dateTd = document.createElement('td');
    dateTd.textContent = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(p.date));
    const actTd = document.createElement('td'); actTd.className = 'table-actions';
    const dl = document.createElement('a'); dl.className = 'table-download';
    dl.href = p.downloadUrl || `/api/download/${encodeURIComponent(p.zipName)}`; dl.textContent = 'Download';
    const editBtn = document.createElement('button'); editBtn.className = 'report-action'; editBtn.type = 'button'; editBtn.textContent = 'Edit';
    editBtn.addEventListener('click', () => { loadProjectEditor(p.id, p); switchView('editor'); });
    actTd.append(dl, editBtn);
    tr.append(nameTd, urlTd, outputTd, statusTd, dateTd, actTd);
    tbody.append(tr);
  });
}

async function loadProjects() {
  ['projects-list', 'dashboard-projects-list'].forEach(id => {
    const el = document.getElementById(id);
    const cols = id === 'projects-list' ? 7 : 6;
    if (el) el.innerHTML = `<tr><td colspan="${cols}" class="table-empty">Loading projects…</td></tr>`;
  });

  try {
    const resp = await apiFetch('/api/projects');
    const data = await resp.json();
    if (!resp.ok) throw new Error();
    allProjects = data.projects || [];
    renderProjectsTable(allProjects, 'projects-list');
    renderDashboardTable(allProjects);
    updateDashboardStats(allProjects);
    if (!activeProjectId && allProjects[0]) {
      loadProjectEditor(allProjects[0].id, allProjects[0]);
    }
  } catch {
    ['projects-list', 'dashboard-projects-list'].forEach(id => {
      const el = document.getElementById(id);
      const cols = id === 'projects-list' ? 7 : 6;
      if (el) el.innerHTML = `<tr><td colspan="${cols}" class="table-empty">Project history unavailable.</td></tr>`;
    });
  }
}

function updateDashboardStats(projects) {
  setText('stat-total-projects', projects.length);
  setText('stat-success-builds', projects.filter(p => !p.error).length);
}

// ─── Project Filter ───────────────────────────────────────────────
function applyProjectFilter() {
  const search = (document.getElementById('project-search')?.value || '').toLowerCase();
  const mode   = document.getElementById('project-filter-mode')?.value || '';
  const output = document.getElementById('project-filter-output')?.value || '';
  const filtered = allProjects.filter(p => {
    const matchSearch = !search || p.name.toLowerCase().includes(search) || p.url.toLowerCase().includes(search);
    const matchMode   = !mode || (p.rebuildMode === mode) || (mode === 'ai-rebuild' && p.aiRebuildMode && !p.rebuildMode);
    const matchOutput = !output || p.outputType === output;
    return matchSearch && matchMode && matchOutput;
  });
  renderProjectsTable(filtered, 'projects-list');
}

document.getElementById('project-search')?.addEventListener('input', applyProjectFilter);
document.getElementById('project-filter-mode')?.addEventListener('change', applyProjectFilter);
document.getElementById('project-filter-output')?.addEventListener('change', applyProjectFilter);
document.getElementById('refresh-projects')?.addEventListener('click', loadProjects);

// ─── File Editor ──────────────────────────────────────────────────
async function fetchProjectFiles(projectId) {
  const r = await apiFetch(`/api/project/${encodeURIComponent(projectId)}/files`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'Project files unavailable.');
  return d.files || [];
}

async function fetchProjectFile(projectId, filePath) {
  const r = await apiFetch(`/api/project/${encodeURIComponent(projectId)}/file?path=${encodeURIComponent(filePath)}`);
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'File content unavailable.');
  return d.content ?? '';
}

async function saveProjectFile(projectId, filePath, content) {
  const r = await apiFetch(`/api/project/${encodeURIComponent(projectId)}/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path: filePath, content }),
  });
  const d = await r.json();
  if (!r.ok) throw new Error(d.error || 'File could not be saved.');
  return d;
}

function renderEditorFiles(files) {
  const container = document.getElementById('editor-files');
  if (!container) return;
  container.replaceChildren();
  if (!files?.length) {
    const p = document.createElement('p'); p.className = 'empty-copy'; p.textContent = 'No files available.'; container.append(p); return;
  }
  files.forEach(file => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'editor-file-btn';
    btn.title = file;
    btn.textContent = file;
    btn.addEventListener('click', async () => {
      if (!activeProjectId) return;
      // Highlight active
      container.querySelectorAll('.editor-file-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeFilePath = file;
      setText('editor-file-path', file);
      setText('editor-status', 'Loading…');
      try {
        const content = await fetchProjectFile(activeProjectId, file);
        const editor = document.getElementById('editor-content');
        if (editor) editor.value = content;
        setText('editor-status', `Loaded: ${file}`);
      } catch (err) {
        setText('editor-status', err.message);
      }
    });
    container.append(btn);
  });
}

async function loadProjectEditor(projectId, project = null) {
  activeProjectId = projectId;
  activeProject   = project;
  activeFilePath  = '';
  const label = document.getElementById('editor-project-label');
  if (label) label.textContent = project?.name || projectId;
  const chatLabel = document.getElementById('chat-project-label');
  if (chatLabel) chatLabel.textContent = project?.name || projectId;
  const editorDownload = document.getElementById('editor-download');
  if (editorDownload) {
    editorDownload.hidden = !project?.downloadUrl;
    editorDownload.href = project?.downloadUrl || '#';
  }
  setText('editor-file-path', 'Select a file from the explorer');
  const editorContent = document.getElementById('editor-content');
  if (editorContent) editorContent.value = '';
  setText('editor-status', 'Loading project files…');
  try {
    const files = await fetchProjectFiles(projectId);
    renderEditorFiles(files);
    setText('editor-status', `${files.length} file${files.length !== 1 ? 's' : ''} ready.`);
    if (files[0]) {
      activeFilePath = files[0];
      setText('editor-file-path', files[0]);
      const content = await fetchProjectFile(projectId, files[0]);
      if (editorContent) editorContent.value = content;
      setText('editor-status', `Loaded: ${files[0]}`);
      // Highlight first
      const firstBtn = document.querySelector('.editor-file-btn');
      if (firstBtn) firstBtn.classList.add('active');
    }
  } catch (err) {
    const container = document.getElementById('editor-files');
    if (container) { container.replaceChildren(); const p = document.createElement('p'); p.className = 'empty-copy'; p.textContent = err.message; container.append(p); }
    setText('editor-status', err.message);
  }
}

async function saveActiveFile() {
  if (!activeProjectId || !activeFilePath) { setText('editor-status', 'Select a file first.'); return; }
  setText('editor-status', 'Saving…');
  const editorContent = document.getElementById('editor-content');
  try {
    await saveProjectFile(activeProjectId, activeFilePath, editorContent?.value || '');
    setText('editor-status', `Saved: ${activeFilePath}`);
  } catch (err) {
    setText('editor-status', err.message);
  }
}

document.getElementById('editor-refresh')?.addEventListener('click', () => { if (activeProjectId) loadProjectEditor(activeProjectId, activeProject); });
document.getElementById('editor-save')?.addEventListener('click', saveActiveFile);

// ─── AI Chat ──────────────────────────────────────────────────────
function appendChatBubble(text, variant = 'assistant') {
  const log = document.getElementById('chat-log');
  if (!log) return;
  const bubble = document.createElement('div'); bubble.className = `chat-bubble ${variant}`;
  bubble.textContent = text;
  log.append(bubble);
  log.scrollTop = log.scrollHeight;
}

async function submitChatMessage() {
  const chatInput = document.getElementById('chat-input');
  const message = chatInput?.value.trim();
  if (!message) return;
  appendChatBubble(message, 'user');
  if (chatInput) chatInput.value = '';
  try {
    const resp = await apiFetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, projectId: activeProjectId }),
    });
    const data = await resp.json();
    if (!resp.ok) throw new Error(data.error || 'Chat request failed.');
    appendChatBubble(data.reply || 'Action queued.', 'assistant');
  } catch (err) {
    appendChatBubble(err.message, 'assistant');
  }
}

document.getElementById('chat-send')?.addEventListener('click', submitChatMessage);
document.getElementById('chat-input')?.addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); submitChatMessage(); }
});

// Quick prompt chips
document.querySelectorAll('.prompt-chip').forEach(chip => {
  chip.addEventListener('click', () => {
    const chatInput = document.getElementById('chat-input');
    if (chatInput) { chatInput.value = chip.dataset.prompt; chatInput.focus(); }
  });
});

function renderBillingPlans(plans) {
  const grid = document.getElementById('billing-plans');
  if (!grid) return;
  grid.replaceChildren();
  plans.forEach((plan) => {
    const card = document.createElement('article');
    card.className = `price-card ${plan.id === currentUser?.plan ? 'featured' : ''}`;
    const title = document.createElement('h3');
    title.textContent = plan.name;
    const price = document.createElement('p');
    price.className = 'price';
    price.innerHTML = `${plan.priceLabel}${plan.interval === 'month' ? '<span>/mo</span>' : ''}`;
    const list = document.createElement('ul');
    (plan.features || []).forEach((feature) => {
      const li = document.createElement('li');
      li.textContent = feature;
      list.append(li);
    });
    const button = document.createElement('button');
    button.type = 'button';
    button.className = plan.id === currentUser?.plan ? 'btn-ghost' : 'btn-accent';
    button.textContent = plan.id === currentUser?.plan ? 'Current plan' : `Activate ${plan.name}`;
    button.disabled = plan.id === currentUser?.plan;
    button.addEventListener('click', () => subscribeToPlan(plan.id));
    card.append(title, price, list, button);
    grid.append(card);
  });
}

async function loadBillingPlans() {
  const response = await apiFetch('/api/plans');
  const data = await response.json();
  billingPlans = data.plans || [];
  renderBillingPlans(billingPlans);
}

async function subscribeToPlan(plan) {
  const message = document.getElementById('billing-message');
  try {
    const response = await apiFetch('/api/billing/subscribe', {
      method: 'POST',
      body: JSON.stringify({ plan }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not update plan.');
    currentUser = data.user;
    renderAccount(currentUser);
    renderBillingPlans(billingPlans);
    await loadTeamMembers();
    if (message) {
      message.hidden = false;
      message.textContent = data.message || 'Plan updated.';
    }
  } catch (error) {
    if (message) {
      message.hidden = false;
      message.textContent = error.message;
    }
  }
}

function renderTeamMembers(members, limit) {
  const list = document.getElementById('team-member-list');
  const limitText = document.getElementById('team-members-limit');
  if (!list) return;
  if (limitText) limitText.textContent = `${members.length}/${limit} seats used. Team members can be added from this page.`;
  list.replaceChildren();
  members.forEach((member) => {
    const row = document.createElement('div');
    row.className = 'team-member-row';
    const identity = document.createElement('div');
    const name = document.createElement('strong');
    name.textContent = member.name;
    const email = document.createElement('small');
    email.textContent = `${member.email} · ${member.status}`;
    identity.append(name, email);
    const remove = document.createElement('button');
    remove.className = 'btn-ghost';
    remove.type = 'button';
    remove.textContent = 'Remove';
    remove.addEventListener('click', () => removeTeamMember(member.id));
    row.append(identity, remove);
    list.append(row);
  });
}

async function loadTeamMembers() {
  const card = document.getElementById('team-members-card');
  if (!card) return;
  const isTeam = (currentUser?.entitlements?.seats || 1) > 1;
  card.hidden = !isTeam;
  if (!isTeam) return;
  const response = await apiFetch('/api/team/members');
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Could not load team members.');
  renderTeamMembers(data.members || [], data.limit || 0);
}

async function removeTeamMember(memberId) {
  const status = document.getElementById('team-member-status');
  try {
    const response = await apiFetch(`/api/team/members/${encodeURIComponent(memberId)}`, { method: 'DELETE' });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not remove team member.');
    currentUser = data.user;
    renderAccount(currentUser);
    await loadTeamMembers();
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent = error.message;
    }
  }
}

document.getElementById('team-member-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const status = document.getElementById('team-member-status');
  try {
    const response = await apiFetch('/api/team/members', {
      method: 'POST',
      body: JSON.stringify({ name: form.name.value.trim(), email: form.email.value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not add team member.');
    currentUser = data.user;
    form.reset();
    renderAccount(currentUser);
    await loadTeamMembers();
    if (status) status.hidden = true;
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent = error.message;
    }
  }
});

document.getElementById('settings-form')?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const status = document.getElementById('settings-status');
  try {
    const response = await apiFetch('/api/account', {
      method: 'PATCH',
      body: JSON.stringify({
        name: document.getElementById('settings-name')?.value.trim(),
        company: document.getElementById('settings-company')?.value.trim(),
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not save settings.');
    currentUser = data.user;
    renderAccount(currentUser);
    if (status) {
      status.hidden = false;
      status.textContent = 'Saved.';
      status.style.color = 'var(--success)';
    }
  } catch (error) {
    if (status) {
      status.hidden = false;
      status.textContent = error.message;
      status.style.color = 'var(--danger)';
    }
  }
});

// ─── Boot ─────────────────────────────────────────────────────────
updateStructure();

async function bootApp() {
  try {
    await loadSession();
    await loadBillingPlans();
    await loadTeamMembers();
    await loadProjects();
    initView();
  } catch {
    window.location.href = '/login?next=/app';
  }
}

bootApp();
