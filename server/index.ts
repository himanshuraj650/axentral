import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";

const app = express();
const httpServer = createServer(app);

app.disable("x-powered-by");

const API_RATE_WINDOW_MS = 60_000;
const API_RATE_MAX_REQUESTS = 240;
const apiRateMap = new Map<string, { count: number; windowStart: number }>();

app.use(express.json({ limit: "256kb" }));

app.use(express.urlencoded({ extended: false, limit: "64kb" }));

app.use((req, res, next) => {
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "no-referrer");
  res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
  res.setHeader("Cross-Origin-Resource-Policy", "same-origin");
  res.setHeader("Permissions-Policy", "geolocation=(), display-capture=(), usb=(), accelerometer=(), gyroscope=()");
  res.setHeader("Content-Security-Policy", "frame-ancestors 'none'; base-uri 'self'; form-action 'self'");

  if (req.path.startsWith("/api") || req.headers.accept?.includes("text/html")) {
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
  }

  next();
});

app.use("/api", (req, res, next) => {
  const now = Date.now();
  const ip = req.ip || req.socket.remoteAddress || "unknown";
  const state = apiRateMap.get(ip);

  if (!state || now - state.windowStart >= API_RATE_WINDOW_MS) {
    apiRateMap.set(ip, { count: 1, windowStart: now });
    return next();
  }

  state.count += 1;

  if (state.count > API_RATE_MAX_REQUESTS) {
    const retryAfterSec = Math.ceil((API_RATE_WINDOW_MS - (now - state.windowStart)) / 1000);
    res.setHeader("Retry-After", String(Math.max(retryAfterSec, 1)));
    return res.status(429).json({ message: "Too many requests. Slow down and retry." });
  }

  if (Math.random() < 0.01) {
    const cutoff = now - API_RATE_WINDOW_MS * 2;
    apiRateMap.forEach((value, key) => {
      if (value.windowStart < cutoff) {
        apiRateMap.delete(key);
      }
    });
  }

  return next();
});

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

function logSecurityMode() {
  const persistentRooms = process.env.ALLOW_PERSISTENT_ROOM_STORAGE === "true";
  const persistentCallLogs = process.env.ALLOW_SERVER_CALL_LOGS === "true";
  const ephemeralMode = !persistentRooms && !persistentCallLogs;

  log(`Ephemeral Mode: ${ephemeralMode ? "ON" : "OFF"}`, "security");
  log(`Persistent Room Storage: ${persistentRooms ? "ON" : "OFF"}`, "security");
  log(`Persistent Call Logs: ${persistentCallLogs ? "ON" : "OFF"}`, "security");
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      log(`${req.method} ${path} ${res.statusCode} in ${duration}ms`);
    }
  });

  next();
});

(async () => {
  await registerRoutes(httpServer, app);

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

httpServer.listen(port, "0.0.0.0", () => {
  log(`serving on port ${port}`);
  logSecurityMode();
});
})();