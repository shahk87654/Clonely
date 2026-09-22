const path = require("path");
const fs = require("fs-extra");

const rootDirectory = path.resolve(__dirname, "..", "..");
const outputDirectory = path.join(rootDirectory, "output");
const storageDirectory = path.join(rootDirectory, "storage");
const projectsDirectory = path.join(storageDirectory, "projects");
const cacheDirectory = path.join(storageDirectory, "cache");
const reportsDirectory = path.join(storageDirectory, "reports");
const exportsDirectory = path.join(storageDirectory, "exports");
const projectsIndexFile = path.join(projectsDirectory, "index.json");
const legacyMetadataDirectory = path.join(rootDirectory, "backend", "output");
const legacyProjectsFile = path.join(legacyMetadataDirectory, "projects.json");
const legacyReportsDirectory = path.join(legacyMetadataDirectory, "reports");
const frontendDirectory = path.join(rootDirectory, "frontend");

function projectStoragePath(projectId) {
  return path.join(projectsDirectory, projectId);
}

function reportStoragePaths(projectId) {
  return {
    storageReport: path.join(reportsDirectory, `${projectId}.json`),
    projectReport: path.join(projectStoragePath(projectId), "report.json"),
    websiteReport: path.join(projectStoragePath(projectId), "website-report.json"),
    legacyReport: path.join(legacyReportsDirectory, `${projectId}.json`),
  };
}

function exportStoragePath(fileName) {
  return path.join(exportsDirectory, fileName);
}

async function ensureStorage() {
  await fs.ensureDir(outputDirectory);
  await fs.ensureDir(storageDirectory);
  await fs.ensureDir(projectsDirectory);
  await fs.ensureDir(cacheDirectory);
  await fs.ensureDir(reportsDirectory);
  await fs.ensureDir(exportsDirectory);
  await fs.ensureDir(legacyMetadataDirectory);
  await fs.ensureDir(legacyReportsDirectory);
  if (!(await fs.pathExists(projectsIndexFile))) {
    await fs.writeJson(projectsIndexFile, [], { spaces: 2 });
  }
  if (!(await fs.pathExists(legacyProjectsFile))) {
    await fs.writeJson(legacyProjectsFile, [], { spaces: 2 });
  }
  const usersFile = path.join(storageDirectory, "users.json");
  if (!(await fs.pathExists(usersFile))) {
    await fs.writeJson(usersFile, [], { spaces: 2 });
  }
}

async function readProjects() {
  const candidates = [projectsIndexFile, legacyProjectsFile];
  for (const candidate of candidates) {
    try {
      const projects = await fs.readJson(candidate);
      if (Array.isArray(projects)) return projects;
    } catch (error) {
      if (error.code !== "ENOENT") continue;
    }
  }
  return [];
}

async function saveProjects(projects) {
  const normalized = Array.isArray(projects) ? projects.slice(0, 100) : [];
  await fs.writeJson(projectsIndexFile, normalized, { spaces: 2 });
  await fs.writeJson(legacyProjectsFile, normalized, { spaces: 2 });
}

async function addProject(project) {
  const projects = await readProjects();
  projects.unshift(project);
  await saveProjects(projects);
}

async function readProjectsForUser(userId) {
  const projects = await readProjects();
  return projects.filter((project) => project.userId === userId);
}

async function findUserProject(userId, projectId) {
  const projects = await readProjectsForUser(userId);
  return projects.find((project) => project.id === projectId) || null;
}

async function listFilesRecursively(directory) {
  const files = [];

  async function visit(current, prefix = "") {
    if (!(await fs.pathExists(current))) return;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await visit(path.join(current, entry.name), relative);
      else files.push(relative);
    }
  }

  await visit(directory);
  return files.sort();
}

function resolveProjectFile(root, filePath) {
  const normalized = path.normalize(String(filePath)).replace(/^([.][.][/\\])+/, "");
  const resolved = path.resolve(root, normalized);
  if (!resolved.startsWith(path.resolve(root))) {
    throw new Error("Invalid file path.");
  }
  return resolved;
}

function safeProjectName(value, url) {
  const fallback = new URL(url).hostname.replace(/^www\./, "") || "Rebuilt Website";
  return String(value || fallback).trim().slice(0, 80) || fallback;
}

function filenameSlug(value) {
  return (
    String(value || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 48) || "website"
  );
}

module.exports = {
  rootDirectory,
  outputDirectory,
  storageDirectory,
  projectsDirectory,
  cacheDirectory,
  reportsDirectory,
  exportsDirectory,
  projectsIndexFile,
  legacyMetadataDirectory,
  legacyProjectsFile,
  legacyReportsDirectory,
  frontendDirectory,
  projectStoragePath,
  reportStoragePaths,
  exportStoragePath,
  ensureStorage,
  readProjects,
  saveProjects,
  addProject,
  readProjectsForUser,
  findUserProject,
  listFilesRecursively,
  resolveProjectFile,
  safeProjectName,
  filenameSlug,
};
