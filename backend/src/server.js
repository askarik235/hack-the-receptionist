// Express app. Run with `npm run dev` (watch mode) or `npm start -w backend`.
import express from "express";
import { pathToFileURL } from "node:url";
import { loadEnvFile, loadConfig, PORTRAITS_DIR } from "./config.js";
import { openDb } from "./db.js";
import { createNapsterClient } from "./napster/client.js";
import { playerMiddleware } from "./lib/players.js";
import { loadContent } from "./game/content.js";
import { toolsRouter } from "./tools/router.js";
import { callsRouter } from "./calls/router.js";

export function createApp({ config, db, content = loadContent(), napster = null, calls = {} }) {
  const app = express();
  app.disable("x-powered-by");
  if (config.production) app.set("trust proxy", 1); // behind Render's proxy

  // Note for later: the Napster webhook route needs express.raw() and must be mounted
  // BEFORE this JSON parser, because its signature is computed over the raw body.
  app.use(express.json({ limit: "16kb" }));

  app.get("/api/health", (req, res) => res.json({ ok: true }));

  // Called by Napster mid-call, not by the browser (no player cookie here).
  app.use("/tools", toolsRouter({ config, db, content }));
  // Character portraits, downloaded by Napster when setup creates a custom companion.
  app.use("/portraits", (req, res, next) => (/^\/[a-z0-9-]+\.(jpe?g|png|webp)$/.test(req.path) ? next() : res.status(404).end()));
  app.use("/portraits", express.static(PORTRAITS_DIR, { index: false, dotfiles: "deny" }));
  app.use("/portraits", (req, res) => res.status(404).end());

  app.use("/api", playerMiddleware({ db, secret: config.sessionSecret, secureCookies: config.production }));

  const clearedLevels = db.prepare("SELECT level FROM cleared_levels WHERE player_id = ? ORDER BY level");
  app.get("/api/me", (req, res) => {
    res.json({ clearedLevels: clearedLevels.all(req.player.id).map((row) => row.level) });
  });

  if (napster) app.use("/api/calls", callsRouter({ config, db, content, napster, ...calls }));

  app.use("/api", (req, res) => res.status(404).json({ error: "not_found" }));

  // Errors never leak stack traces or internal details to the browser.
  app.use((err, req, res, next) => {
    if (err.type === "entity.parse.failed") return res.status(400).json({ error: "invalid_json" });
    if (err.type === "entity.too.large") return res.status(413).json({ error: "too_large" });
    console.error(err);
    res.status(500).json({ error: "server_error" });
  });

  return app;
}

function main() {
  loadEnvFile();
  let config;
  try {
    config = loadConfig();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  for (const warning of config.warnings) console.warn(`Warning: ${warning}`);

  let content;
  try {
    content = loadContent();
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
  console.log(`Loaded ${content.levels.length} level(s), ${content.staff.length} staff.`);

  const db = openDb(config.dbPath);
  const napster = createNapsterClient({ apiKey: config.napsterApiKey });
  const app = createApp({ config, db, content, napster });
  app.listen(config.port, () => console.log(`Backend running at http://localhost:${config.port}`));
}

// Start only when run directly (tests import createApp without starting a server).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
