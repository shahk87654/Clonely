const path = require("path");
const express = require("express");
const cors = require("cors");
const { registerApiRoutes } = require("./api/routes");
const { ensureStorage, frontendDirectory } = require("./storage");
const { globalErrorHandler } = require("./utils/http");

const app = express();
const port = process.env.PORT || 3000;

app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "32kb" }));
app.use(express.static(frontendDirectory, { index: false }));

registerApiRoutes(app);

function sendFrontend(fileName) {
  return (_request, response) => {
    response.sendFile(path.join(frontendDirectory, fileName));
  };
}

app.get("/", sendFrontend("landing.html"));
app.get("/pricing", sendFrontend("landing.html"));
app.get("/login", sendFrontend("login.html"));
app.get("/signup", sendFrontend("signup.html"));
app.get("/privacy", sendFrontend("privacy.html"));
app.get("/terms", sendFrontend("terms.html"));
app.get("/acceptable-use", sendFrontend("acceptable-use.html"));
app.get("/app", sendFrontend("index.html"));

app.use((request, response, next) => {
  if (request.path.startsWith("/api/")) {
    return response.status(404).json({ error: "Not found." });
  }
  if (request.method !== "GET") return next();
  if (request.path.startsWith("/app")) {
    return response.sendFile(path.join(frontendDirectory, "index.html"));
  }
  return response.sendFile(path.join(frontendDirectory, "landing.html"));
});

app.use(globalErrorHandler);

async function start() {
  await ensureStorage();
  app.listen(port, () => {
    console.log(`Clonely running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Failed to start server:", error);
  process.exitCode = 1;
});
