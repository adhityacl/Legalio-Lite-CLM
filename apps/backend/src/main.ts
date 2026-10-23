import "dotenv/config";
import express from "express";
import path from "node:path";
import { connect, end, parseDatabaseConfig, resolveDatabaseConfig, saveDatabaseConfig, testConnection, type DatabaseConfig } from "./db";
import { createSensitiveRateLimiter, trustProxySetting } from "./edgeConfig";
import { REPOSITORY_DIR } from "./runtimePaths";
import { componentLog, requestLogging } from "./logger";
import { mountSystemConsole } from "./systemConsoleHosting";

const log = componentLog("main");

/*
 * Process entry. Until a database is configured only the onboarding database step answers; the application
 * (./server) is imported once the pool is connected, so it never starts without a database and needs no restart.
 */
// lib/auth.ts checks this too, but only when ./server loads, which can be after a stranger filled in the database form.
if (process.env.NODE_ENV === "production" && !process.env.BETTER_AUTH_SECRET) {
  log.error("BETTER_AUTH_SECRET must be set in production (use a long random value).");
  process.exit(1);
}

const PORT = Number(process.env.PORT) || 3000;
let realApp: express.Express | null = null;
let applicationModule: typeof import("./server") | null = null;
let connecting = false;

/** Connects, then loads and initializes the application; the caller ends the pool if this throws. */
async function startApplication(config: DatabaseConfig) {
  connect(config);
  const server = await import("./server");
  applicationModule = server;
  await server.init();
  return server.app;
}

const app = express();
app.set("trust proxy", trustProxySetting());
app.use(requestLogging());
app.use(createSensitiveRateLimiter());
// Ahead of the hand-off below so it keeps answering 409 once the application runs. Its own small JSON parser only:
// a global one would consume the application's 25 MB request bodies.
app.post("/api/system/database", express.json(), async (req: express.Request, res: express.Response) => {
  let configured = true;
  try { configured = resolveDatabaseConfig() !== null; } catch { /* an unreadable file still counts as configured */ }
  if (realApp || connecting || configured) {
    return res.status(409).json({ error: "DATABASE_ALREADY_CONFIGURED", message: "The database is already configured." });
  }
  let config: DatabaseConfig;
  try {
    config = parseDatabaseConfig(req.body);
  } catch (err) {
    return res.status(400).json({ error: "INVALID_DATABASE_CONFIG", message: (err as Error).message });
  }
  connecting = true;
  try {
    await testConnection(config);
    const ready = await startApplication(config);
    // Saved only once the schema exists, so a failed attempt leaves the form available.
    await saveDatabaseConfig(config);
    realApp = ready;
    log.info("Onboarding: database connected and saved.");
    res.status(201).json({ success: true });
  } catch (err: any) {
    await end().catch(() => undefined);
    const raw = String(err?.message || err?.code || "Could not connect to the database.");
    const message = config.password && raw.includes(config.password) ? "Could not connect to the database." : raw;
    log.error("[onboarding] database step failed:", message);
    res.status(400).json({ error: "DATABASE_CONNECTION_FAILED", message });
  } finally {
    connecting = false;
  }
});
app.use((req: express.Request, res: express.Response, next: express.NextFunction) => (realApp ? realApp(req, res, next) : next()));
app.get("/api/system/public-status", (_req: express.Request, res: express.Response) => {
  res.set("Cache-Control", "no-store").json({ needsDatabase: true });
});
app.all("/api/*", (_req: express.Request, res: express.Response) => {
  res.status(503).json({ error: "DATABASE_REQUIRED", message: "Connect a PostgreSQL database to finish setting up this installation." });
});

async function main() {
  const config = resolveDatabaseConfig();
  if (config) {
    try {
      await testConnection(config);
      realApp = await startApplication(config);
    } catch (err: any) {
      // Never fall back to the form: while the database is down anyone could point the installation elsewhere.
      log.error("Cannot start: the configured database is unavailable:", err?.message || err);
      process.exit(1);
    }
  }
  mountSystemConsole(app, process.env.SYSTEM_CONSOLE_DIR || path.join(REPOSITORY_DIR, "apps/backend/dist/console"));
  let viteServer: { close(): Promise<void> } | undefined;
  // API_ONLY=true (set by `npm run dev:backend`) skips Vite entirely, for
  // running the backend as its own process against a separate `npm run
  // dev:frontend` — the default `npm run dev` still runs both combined.
  if (process.env.NODE_ENV !== "production" && process.env.API_ONLY !== "true") {
    // Dynamically imported so `vite` never ends up in the production
    // server bundle — the backend is a standalone API in production, the
    // frontend build is served separately (see README).
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({
      root: path.join(REPOSITORY_DIR, "apps/frontend"),
      configFile: path.join(REPOSITORY_DIR, "apps/frontend/vite.config.ts"),
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
    viteServer = vite;
  }
  const server = app.listen(PORT, "0.0.0.0", () => {
    log.info(`Pengelola Kontrak & IO Server running on http://0.0.0.0:${PORT}`);
  });
  let shuttingDown = false;
  /** Stops accepting requests, lets in-flight requests, background jobs and queued database saves finish, then closes the pool. */
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const limit = Math.max(1000, Number(process.env.SHUTDOWN_TIMEOUT_MS) || 30_000);
    log.info({ signal, timeoutMs: limit }, "Shutting down server...");
    setTimeout(() => {
      log.error("Forcing shutdown: in-flight work did not finish in time.");
      process.exit(1);
    }, limit).unref();
    try {
      if (viteServer) await viteServer.close();
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeIdleConnections();
      });
      await applicationModule?.drain();
      await end();
      log.info("Server closed");
      process.exit(0);
    } catch (err) {
      log.error("Shutdown failed:", err);
      process.exit(1);
    }
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch((err) => {
  log.error("Startup failed:", err);
  process.exit(1);
});
