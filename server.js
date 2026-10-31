/*
 * ======= • ======= • ======= • ======= • =======• =======
 * AniKotoAPI — server.js
 * Repository: https://github.com/Shineii86/AniKotoAPI
 *
 * @description
 *   Main entry point for the AniKotoAPI Express server.
 *   Configures CORS, middleware, static files, API routes,
 *   and 404 handling. Starts the server on the configured port.
 *
 * @exports
 *   None (side-effect: starts Express server)
 *
 * @author  Shinei Nouzen
 * @license MIT
 * ======= • ======= • ======= • ======= • =======• =======
 */

// WARNING: This import must stay first. Static imports are evaluated before the
// module body runs, so a dotenv.config() call down there fires only after every
// helper has already been evaluated — and helpers that read process.env at their
// top level (mirror, cache, proxy, streamProxy) would silently keep their
// defaults. Importing dotenv/config runs config() as an import side effect, so
// .env is populated before any of those modules load.
import "dotenv/config";
import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { createApiRoutes } from "./src/routes/apiRoutes.js";
import { addCreatorInfo } from "./src/middleware/creatorInfo.js";
import { createCatalogRouter } from "./src/routes/catalog.route.js";
import { EMBED_ORIGINS } from "./public/assets/embed-policy.js";
import { createAniKotoClient } from "./src/services/anikotoApi.js";
import { createPublishedCatalog } from "./src/services/publishedCatalog.js";
import { getCatalogMode } from "./src/services/catalogMode.js";
import { createAccountsRouter } from "./src/routes/accounts.route.js";
import { createCommentsRouter, createCommentsModerationRouter } from './src/routes/comments.route.js';
import { createCmsRouter } from "./src/routes/cms.route.js";
import { createBrandingRouter } from "./src/routes/branding.route.js";
import { createVisitorsRouter } from './src/routes/visitors.route.js';
import { createSubtitleTranslationRouter } from './src/routes/subtitleTranslation.route.js';
import { createApiRateLimit } from './src/middleware/apiRateLimit.js';
import { getDb } from "./src/db/index.js";
import { createSeoRouter } from './src/routes/seo.route.js';
import { createSynopsisTranslationRouter } from './src/routes/synopsisTranslation.route.js';

// ══════════════════════════════════════════════════════════════
// SERVER CONFIGURATION
// ══════════════════════════════════════════════════════════════

const app = express();
const PORT = process.env.PORT || 4444;
const HOST = process.env.HOST || "0.0.0.0";
// aaPanel's local reverse proxy supplies the original visitor address.
app.set("trust proxy", "loopback");
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const publicDir = path.join(process.cwd(), "public");
const catalogClient = createAniKotoClient();
const publishedCatalog = createPublishedCatalog(getDb, catalogClient);
const publicCatalog = getCatalogMode(process.env.PUBLIC_CATALOG_MODE) === 'managed' ? publishedCatalog : null;
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(",");

// ---- FEATURE: Response compression ----
app.use(compression({
  filter: (req, res) => {
    if (req.headers["x-no-compression"]) return false;
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024
}));

// ---- FEATURE: Request body size limits ----
app.use('/api/comments', express.json({ limit: '32kb' }));
app.use(express.json({ limit: "10kb" }));
app.use(express.urlencoded({ extended: false, limit: "10kb" }));

// ══════════════════════════════════════════════════════════════
// REQUEST ID TRACKING
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Unique request ID for debugging ----
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader("X-Request-Id", req.id);
  next();
});

// ══════════════════════════════════════════════════════════════
// CORS MIDDLEWARE
// ══════════════════════════════════════════════════════════════

// NOTE: Single unified CORS middleware — handles all origin validation
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (!allowedOrigins || allowedOrigins.includes("*") || (origin && allowedOrigins.includes(origin))) {
    res.setHeader("Access-Control-Allow-Origin", origin || "*");
  }
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-Requested-With, X-Admin-Token");
  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }
  next();
});

// ---- FEATURE: Security headers ----
app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-XSS-Protection", "1; mode=block");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  // NOTE: Google Fonts is allowed explicitly — the stylesheet loads from
  // fonts.googleapis.com and pulls font files from fonts.gstatic.com. Both the
  // docs page and the frontend use it; without these the pages fell back to
  // system fonts. Everything else stays same-origin.
  // NOTE: cdn.jsdelivr.net is allowed for hls.js on the watch page. Media and
  // segments are fetched same-origin through the stream proxy, so connect-src
  // stays 'self'; media-src allows blob: for the MediaSource buffers hls.js uses.
  res.setHeader("Content-Security-Policy", `default-src 'self'; script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net; worker-src 'self' blob:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: https:; font-src 'self' data: https://fonts.gstatic.com; media-src 'self' blob:; connect-src 'self' https://api.klipy.com; frame-src ${EMBED_ORIGINS.join(' ')}`);
  res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  res.setHeader("X-Permitted-Cross-Domain-Policies", "none");
  next();
});

// ══════════════════════════════════════════════════════════════
// STATIC FILES
// ══════════════════════════════════════════════════════════════

// NOTE: redirect: false prevents automatic redirects to index.html.
// index: false stops it answering "/" with index.html, so the landing route
// below can own the root; the anime home lives at /home.
app.use(createSeoRouter({ publicDir, client: catalogClient, catalog: publicCatalog }));
app.use('/api/branding', createBrandingRouter(publicDir));
app.use(express.static(publicDir, { redirect: false, index: false }));

// ══════════════════════════════════════════════════════════════
// CLEAN URL ROUTES
// ══════════════════════════════════════════════════════════════

// Serve HTML files without .html extension
// NOTE: The streaming frontend now lives at "/" (public/index.html); the API
// documentation page moved here so both can coexist.
app.get("/docs", (req, res) => {
  res.sendFile(path.join(publicDir, "docs.html"));
});

app.get('/account', (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, 'account.html'));
});
app.get(['/login', '/register'], (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(publicDir, req.path === '/register' ? 'register.html' : 'login.html'));
});

// NOTE: Watch page. Slug and episode are read client-side from the path.
app.get(["/watch/:slug/:ep", "/watch/:slug"], (req, res) => {
  res.sendFile(path.join(publicDir, "watch.html"));
});

// NOTE: Admin CMS page. The page itself is static; its JS supplies the admin
// token to the (token-protected) /api/admin/* endpoints.
app.get("/admin", (req, res) => {
  res.sendFile(path.join(publicDir, "admin.html"));
});

// ══════════════════════════════════════════════════════════════
// RESPONSE HELPERS
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Standardized JSON response wrapper ----
/**
 * Wraps data in a standardized success JSON response.
 *
 * @param {object} res - Express response object
 * @param {*} data - The data to return in the response
 * @param {number} status - HTTP status code (default: 200)
 */
const jsonResponse = (res, data, status = 200) =>
  res.status(status).json({ success: true, results: data });

// ---- FEATURE: Standardized error response wrapper ----
/**
 * Returns a standardized error JSON response.
 *
 * @param {object} res - Express response object
 * @param {string} message - Error message to return (default: "Internal server error")
 * @param {number} status - HTTP status code (default: 500)
 */
const jsonError = (res, message = "Internal server error", status = 500) =>
  res.status(status).json({ success: false, message });

// ══════════════════════════════════════════════════════════════
// API ROUTES
// ══════════════════════════════════════════════════════════════

app.use(createApiRateLimit());

// ---- FEATURE: Creator info middleware (injects attribution into all responses) ----
app.use(addCreatorInfo);

// ---- FEATURE: Request timeout middleware (30 seconds) ----
app.use((req, res, next) => {
  const timeout = parseInt(process.env.REQUEST_TIMEOUT) || 30000;
  req.setTimeout(timeout, () => {
    if (!res.headersSent) {
      res.status(408).json({ success: false, message: "Request timeout" });
    }
  });
  next();
});

app.use('/api/auth', createAccountsRouter(getDb));
app.use('/api/comments', createCommentsRouter(getDb, catalogClient, publicCatalog));
app.use('/api/admin/comments', createCommentsModerationRouter(getDb));
app.use('/api', createVisitorsRouter(getDb));
app.use('/api/stream/sub-translate', createSubtitleTranslationRouter(getDb));
app.use('/api/catalog/synopsis', createSynopsisTranslationRouter(getDb, catalogClient, publicCatalog));
app.use("/api/admin", createCmsRouter(getDb, catalogClient));
app.use("/api/catalog", createCatalogRouter(catalogClient, publicCatalog));
createApiRoutes(app, jsonResponse, jsonError, publishedCatalog);

// ══════════════════════════════════════════════════════════════
// 404 HANDLER
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Global error handler ----
app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ success: false, message: 'Invalid JSON body' });
  }
  console.error(`[ERROR] ${req.id} ${err.message}`, err.stack);
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ success: false, message: "Request entity too large" });
  }
  res.status(err.status || 500).json({
    success: false,
    message: process.env.NODE_ENV === 'production' ? "Internal server error" : err.message
  });
});

// ---- FEATURE: Catch-all 404 handler for undefined routes ----
app.use((req, res) => {
  const filePath = path.join(publicDir, "404.html");
  if (fs.existsSync(filePath)) {
    res.status(404).sendFile(filePath);
  } else {
    res.status(404).json({
      success: false,
      message: "Endpoint not found",
      availableEndpoints: [
        "/", "/search", "/search/suggest", "/info", "/watch",
        "/episodes/:id", "/episodes-ajax/:id", "/stream", "/servers",
        "/mapper-servers", "/download", "/stream/resolve",
        "/stream/qualities", "/stream/proxy", "/stream/ts-proxy",
        "/spotlight", "/trending", "/top-ten", "/suggestions",
        "/random", "/most-popular", "/upcoming", "/top-rankings",
        "/recently-updated", "/completed", "/new-release",
        "/newly-added", "/latest-updated", "/trending-sidebar",
        "/seasons/:id", "/watch-order/:id", "/az-list/:letter",
        "/filter", "/genre/:genre", "/type/:type", "/status/:status",
        "/schedule", "/health", "/stats", "/cache/stats",
        "/mirrors", "/openapi"
      ]
    });
  }
});

// ══════════════════════════════════════════════════════════════
// SERVER START
// ══════════════════════════════════════════════════════════════

const server = app.listen(PORT, HOST, () => {
  console.info(`AniKotoAPI listening at ${PORT}`);
});

// ---- FEATURE: Hourly CMS auto-update scheduler ----
// NOTE: In-process timer for localhost/long-running hosts. Serverless deploys
// should instead call POST /api/admin/run-updates from an external cron.
if (process.env.ADMIN_TOKEN && process.env.NODE_ENV !== "test") {
  const { startCmsScheduler } = await import("./src/services/cmsCatalog.js");
  startCmsScheduler(getDb(), catalogClient);
  console.info("[AUTO-UPDATE] hourly scheduler started");
}

// ══════════════════════════════════════════════════════════════
// GRACEFUL SHUTDOWN
// ══════════════════════════════════════════════════════════════

// ---- FEATURE: Graceful shutdown handling ----
const gracefulShutdown = (signal) => {
  console.info(`\n[SHUTDOWN] Received ${signal}. Starting graceful shutdown...`);
  server.close(() => {
    console.info("[SHUTDOWN] Server closed. Goodbye.");
    process.exit(0);
  });
  setTimeout(() => {
    console.error("[SHUTDOWN] Forced shutdown after timeout.");
    process.exit(1);
  }, 10000);
};

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

process.on("unhandledRejection", (reason, promise) => {
  console.error("[UNHANDLED] Unhandled Rejection:", reason);
});

process.on("uncaughtException", (error) => {
  console.error("[UNCAUGHT] Uncaught Exception:", error);
  gracefulShutdown("uncaughtException");
});

// ══════════════════════════════════════════════════════════════ END: server.js
