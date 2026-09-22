const path = require("path");
const crypto = require("crypto");
const fs = require("fs-extra");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { HttpError } = require("../utils/http");
const { storageDirectory } = require("../storage");

const usersFile = path.join(storageDirectory, "users.json");
const COOKIE_NAME = "clonely_token";
const TOKEN_DAYS = 7;
const JWT_SECRET =
  process.env.JWT_SECRET || "clonely-dev-secret-change-me-before-production";

const PLANS = {
  free: {
    id: "free",
    name: "Starter",
    price: 0,
    priceLabel: "$0",
    interval: "forever",
    clonesPerMonth: 3,
    analysesPerMonth: 15,
    formats: ["static-html"],
    aiModes: false,
    seats: 1,
    features: [
      "3 clones per month",
      "15 URL analyses",
      "Static HTML output",
      "ZIP downloads",
      "Project file editor",
    ],
  },
  pro: {
    id: "pro",
    name: "Pro",
    price: 29,
    priceLabel: "$29",
    interval: "month",
    clonesPerMonth: 50,
    analysesPerMonth: 200,
    formats: "all",
    aiModes: true,
    seats: 1,
    features: [
      "50 clones per month",
      "200 URL analyses",
      "All 11 output formats",
      "AI rebuild & upgrade modes",
      "Framework migration",
      "Priority processing",
    ],
  },
  team: {
    id: "team",
    name: "Team",
    price: 99,
    priceLabel: "$99",
    interval: "month",
    clonesPerMonth: 500,
    analysesPerMonth: 2000,
    formats: "all",
    aiModes: true,
    seats: 10,
    features: [
      "500 clones per month",
      "2,000 URL analyses",
      "All formats and AI modes",
      "Up to 10 seats",
      "Shared project workspace",
      "Usage analytics",
    ],
  },
};

function currentMonthKey() {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
}

function parseCookies(header) {
  const cookies = {};
  String(header || "")
    .split(";")
    .forEach((part) => {
      const index = part.indexOf("=");
      if (index === -1) return;
      const key = part.slice(0, index).trim();
      const value = part.slice(index + 1).trim();
      if (key) cookies[key] = decodeURIComponent(value);
    });
  return cookies;
}

async function ensureUsersFile() {
  await fs.ensureDir(storageDirectory);
  if (!(await fs.pathExists(usersFile))) {
    await fs.writeJson(usersFile, [], { spaces: 2 });
  }
}

async function readUsers() {
  await ensureUsersFile();
  try {
    const users = await fs.readJson(usersFile);
    return Array.isArray(users) ? users : [];
  } catch {
    return [];
  }
}

async function saveUsers(users) {
  await fs.writeJson(usersFile, users, { spaces: 2 });
}

function normalizeUsage(user) {
  const month = currentMonthKey();
  if (!user.usage || user.usage.month !== month) {
    user.usage = { month, clones: 0, analyses: 0 };
  }
  return user.usage;
}

function publicUser(user) {
  const usage = normalizeUsage(user);
  const plan = PLANS[user.plan] || PLANS.free;
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    company: user.company || "",
    plan: plan.id,
    planName: plan.name,
    createdAt: user.createdAt,
    billing: user.billing || { status: plan.id === "free" ? "none" : "active" },
    usage: {
      month: usage.month,
      clones: usage.clones,
      analyses: usage.analyses,
      cloneLimit: plan.clonesPerMonth,
      analysisLimit: plan.analysesPerMonth,
    },
    entitlements: {
      formats: plan.formats,
      aiModes: plan.aiModes,
      seats: plan.seats,
      teamMembers: plan.seats > 1 ? user.teamMembers || [] : [],
      teamMemberLimit: Math.max(0, plan.seats - 1),
    },
  };
}

function signToken(user) {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, {
    expiresIn: `${TOKEN_DAYS}d`,
  });
}

function setAuthCookie(response, token) {
  const maxAge = TOKEN_DAYS * 24 * 60 * 60;
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=${encodeURIComponent(token)}; HttpOnly; Path=/; Max-Age=${maxAge}; SameSite=Lax${secure}`,
  );
}

function clearAuthCookie(response) {
  response.setHeader(
    "Set-Cookie",
    `${COOKIE_NAME}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`,
  );
}

function extractToken(request) {
  const header = request.headers.authorization || "";
  if (header.startsWith("Bearer ")) return header.slice(7).trim();
  const cookies = parseCookies(request.headers.cookie);
  return cookies[COOKIE_NAME] || "";
}

async function findUserById(id) {
  const users = await readUsers();
  return users.find((user) => user.id === id) || null;
}

async function findUserByEmail(email) {
  const users = await readUsers();
  return users.find((user) => user.email === String(email || "").toLowerCase().trim()) || null;
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
}

async function createUser({ name, email, password, company = "", plan = "free" }) {
  const trimmedEmail = String(email || "").toLowerCase().trim();
  const trimmedName = String(name || "").trim().slice(0, 80);
  const trimmedPassword = String(password || "");
  if (!trimmedName) throw new HttpError("Enter your name.", 400);
  if (!validateEmail(trimmedEmail)) throw new HttpError("Enter a valid email address.", 400);
  if (trimmedPassword.length < 8) {
    throw new HttpError("Password must be at least 8 characters.", 400);
  }
  if (await findUserByEmail(trimmedEmail)) {
    throw new HttpError("An account with that email already exists.", 409);
  }

  const selectedPlan = PLANS[String(plan || "free").toLowerCase()]
    ? String(plan || "free").toLowerCase()
    : "free";
  const renewsAt = new Date();
  renewsAt.setMonth(renewsAt.getMonth() + 1);

  const users = await readUsers();
  const user = {
    id: crypto.randomUUID(),
    name: trimmedName,
    email: trimmedEmail,
    company: String(company || "").trim().slice(0, 80),
    passwordHash: await bcrypt.hash(trimmedPassword, 10),
    plan: selectedPlan,
    createdAt: new Date().toISOString(),
    usage: { month: currentMonthKey(), clones: 0, analyses: 0 },
    billing: {
      status: selectedPlan === "free" ? "none" : "active",
      provider: "demo",
      plan: selectedPlan,
      activatedAt: new Date().toISOString(),
      renewsAt: selectedPlan === "free" ? null : renewsAt.toISOString(),
    },
  };
  users.push(user);
  await saveUsers(users);
  return user;
}

async function authenticateUser(email, password) {
  const user = await findUserByEmail(email);
  if (!user) throw new HttpError("Invalid email or password.", 401);
  const matches = await bcrypt.compare(String(password || ""), user.passwordHash);
  if (!matches) throw new HttpError("Invalid email or password.", 401);
  return user;
}

async function updateUser(userId, patch) {
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) throw new HttpError("Account not found.", 404);
  users[index] = { ...users[index], ...patch };
  await saveUsers(users);
  return users[index];
}

async function addTeamMember(userId, { name, email }) {
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) throw new HttpError("Account not found.", 404);
  const owner = users[index];
  const plan = assertTeamPlan(owner);
  const members = Array.isArray(owner.teamMembers) ? owner.teamMembers : [];
  if (members.length >= plan.seats - 1) {
    throw new HttpError(`Your ${plan.name} plan allows ${plan.seats} seats.`, 402);
  }
  const normalizedEmail = String(email || "").toLowerCase().trim();
  if (!validateEmail(normalizedEmail)) {
    throw new HttpError("Enter a valid team member email address.", 400);
  }
  if (normalizedEmail === owner.email || members.some((member) => member.email === normalizedEmail)) {
    throw new HttpError("That email is already part of this workspace.", 409);
  }
  const member = {
    id: crypto.randomUUID(),
    name: String(name || normalizedEmail.split("@")[0]).trim().slice(0, 80),
    email: normalizedEmail,
    role: "member",
    status: "invited",
    invitedAt: new Date().toISOString(),
  };
  owner.teamMembers = [...members, member];
  users[index] = owner;
  await saveUsers(users);
  return owner;
}

async function removeTeamMember(userId, memberId) {
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) throw new HttpError("Account not found.", 404);
  const owner = users[index];
  const members = Array.isArray(owner.teamMembers) ? owner.teamMembers : [];
  if (!members.some((member) => member.id === memberId)) {
    throw new HttpError("Team member not found.", 404);
  }
  owner.teamMembers = members.filter((member) => member.id !== memberId);
  users[index] = owner;
  await saveUsers(users);
  return owner;
}

async function incrementUsage(userId, field) {
  const users = await readUsers();
  const index = users.findIndex((user) => user.id === userId);
  if (index === -1) throw new HttpError("Account not found.", 404);
  normalizeUsage(users[index]);
  users[index].usage[field] = (users[index].usage[field] || 0) + 1;
  await saveUsers(users);
  return users[index];
}

function getPlan(user) {
  return PLANS[user?.plan] || PLANS.free;
}

function assertTeamPlan(user) {
  const plan = getPlan(user);
  if (plan.seats <= 1) {
    throw new HttpError("Team members require the Team plan.", 402);
  }
  return plan;
}

function assertCloneAllowed(user, { outputType, rebuildMode }) {
  const plan = getPlan(user);
  normalizeUsage(user);
  if (user.usage.clones >= plan.clonesPerMonth) {
    throw new HttpError(
      `You've used all ${plan.clonesPerMonth} clones on the ${plan.name} plan this month. Upgrade to continue.`,
      402,
    );
  }
  if (plan.formats !== "all" && !plan.formats.includes(outputType)) {
    throw new HttpError(
      `${plan.name} includes Static HTML only. Upgrade to Pro for all output formats.`,
      402,
    );
  }
  if (!plan.aiModes && rebuildMode && rebuildMode !== "mirror") {
    throw new HttpError(
      "AI rebuild, upgrade, and framework migration require a Pro or Team plan.",
      402,
    );
  }
}

function assertAnalysisAllowed(user) {
  const plan = getPlan(user);
  normalizeUsage(user);
  if (user.usage.analyses >= plan.analysesPerMonth) {
    throw new HttpError(
      `You've used all ${plan.analysesPerMonth} analyses on the ${plan.name} plan this month. Upgrade to continue.`,
      402,
    );
  }
}

async function optionalAuth(request, _response, next) {
  request.user = null;
  const token = extractToken(request);
  if (!token) return next();
  try {
    const payload = jwt.verify(token, JWT_SECRET);
    const user = await findUserById(payload.sub);
    if (user) request.user = user;
  } catch {
    request.user = null;
  }
  next();
}

function requireAuth(request, response, next) {
  const token = extractToken(request);
  if (!token) {
    return next(new HttpError("Sign in to continue.", 401));
  }
  Promise.resolve()
    .then(() => jwt.verify(token, JWT_SECRET))
    .then((payload) => findUserById(payload.sub))
    .then((user) => {
      if (!user) return next(new HttpError("Sign in to continue.", 401));
      request.user = user;
      next();
    })
    .catch(() => {
      clearAuthCookie(response);
      next(new HttpError("Your session expired. Sign in again.", 401));
    });
}

function assertProjectAccess(project, user) {
  if (!project || project.userId !== user.id) {
    throw new HttpError("Project not found.", 404);
  }
}

module.exports = {
  PLANS,
  COOKIE_NAME,
  usersFile,
  ensureUsersFile,
  publicUser,
  signToken,
  setAuthCookie,
  clearAuthCookie,
  createUser,
  authenticateUser,
  updateUser,
  addTeamMember,
  removeTeamMember,
  incrementUsage,
  getPlan,
  assertTeamPlan,
  assertCloneAllowed,
  assertAnalysisAllowed,
  optionalAuth,
  requireAuth,
  assertProjectAccess,
};
