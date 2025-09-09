import express from "express";
import morgan from "morgan";
import { chromium } from "playwright";

// ---- Config -----------------------------------------------------------------
const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.RENDER_API_KEY || ""; // optional: require Bearer
const DEFAULT_TIMEOUT = 25000; // ms
const MAX_TIMEOUT = 60000;     // ms
const MIN_TIMEOUT = 5000;      // ms

// ---- App --------------------------------------------------------------------
const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// (Optional) very permissive CORS so you can hit it directly in a pinch.
// Not required for Worker->Renderer server-to-server calls.
app.use((req, res, next) => {
  const origin = req.headers.origin || "*";
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Vary", "Origin");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Access-Control-Allow-Methods", "POST,GET,OPTIONS");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
});

// Health
app.get("/", (_req, res) => res.json({ ok: true, name: "wcag-renderer" }));
app.get("/health", (_req, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// Optional API key auth
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const h = req.get("authorization") || "";
  if (h === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

// ---- Helpers ----------------------------------------------------------------
function clampTimeout(ms) {
  const n = Number(ms || DEFAULT_TIMEOUT);
  return Math.min(MAX_TIMEOUT, Math.max(MIN_TIMEOUT, n));
}

function buildLaunchArgs() {
  // Docker-friendly Chromium flags
  return [
    "--no-sandbox",
    "--disable-setuid-sandbox",
    "--disable-dev-shm-usage",
    "--disable-gpu",
    "--no-zygote",
    "--single-process" // helps on some constrained hosts
  ];
}

// ---- Render endpoint ---------------------------------------------------------
app.post("/render", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const waitUntil = String(req.body?.waitUntil || "networkidle"); // 'load'|'domcontentloaded'|'networkidle'
  const timeoutMs = clampTimeout(req.body?.timeoutMs);

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid url" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: buildLaunchArgs()
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36 A11yRenderer/1.0",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "UTC"
    });

    const page = await context.newPage();

    // Block heavy resources to speed up (images, media, fonts)
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (type === "image" || type === "media" || type === "font") return route.abort();
      return route.continue();
    });

    // First navigation: be conservative to get *something* quickly
    let nav = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: timeoutMs
    }).catch(e => ({ _err: e }));

    if (!nav || nav._err) {
      // Retry once with routing disabled (some CSP/redirect chains dislike routing)
      try { await page.unroute("**/*"); } catch {}
      nav = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: timeoutMs
      }).catch(e => ({ _err: e }));
      if (!nav || nav._err) {
        throw new Error("Navigation failed or timed out");
      }
    }

    // Then try to satisfy the caller's requested readiness
    // Cap the wait to avoid hanging indefinitely on chatty apps.
    await page.waitForLoadState(waitUntil, {
      timeout: Math.min(20000, timeoutMs)
    }).catch(() => { /* swallow if it never reaches networkidle */ });

    // Small deterministic delay to let client JS mutate DOM
    await page.waitForTimeout(1500);

    const content = await page.content();
    const finalUrl = page.url();

    res.json({ html: content, url: finalUrl });
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    res.status(500).json({ error: msg });
  } finally {
    try { await browser?.close(); } catch {}
  }
});

// ---- Server start ------------------------------------------------------------
const server = app.listen(PORT, "0.0.0.0", () => {
  console.log(`Render API listening on :${PORT}`);
});

// Keep-alive settings to behave nicely behind proxies
server.keepAliveTimeout = 61_000;
server.headersTimeout = 65_000;
