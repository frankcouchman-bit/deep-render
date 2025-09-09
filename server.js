import express from "express";
import morgan from "morgan";
import { chromium } from "playwright";

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.RENDER_API_KEY || ""; // optional bearer

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

app.get("/", (_req, res) => res.json({ ok: true, name: "wcag-renderer" }));
app.get("/health", (_req, res) => res.json({ ok: true }));

// Optional bearer auth
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const h = req.get("authorization") || "";
  if (h === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

/**
 * POST /render
 * Body: { url: string, waitUntil?: "domcontentloaded"|"load"|"networkidle", timeoutMs?: number }
 */
app.post("/render", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const waitUntil = ["domcontentloaded", "load", "networkidle"].includes(req.body?.waitUntil)
    ? req.body.waitUntil
    : "networkidle";
  const timeoutMs = Math.min(60000, Math.max(8000, Number(req.body?.timeoutMs || 30000)));

  if (!/^https?:\/\//i.test(url)) return res.status(400).json({ error: "Invalid url" });

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote",
        "--disable-blink-features=AutomationControlled"
      ]
    });

    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent:
        "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
        "Chrome/120.0.0.0 Safari/537.36",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      locale: "en-US",
      timezoneId: "UTC"
    });

    const page = await context.newPage();

    // Light anti-bot hardening
    await page.addInitScript(() => {
      Object.defineProperty(navigator, "webdriver", { get: () => false });
    });

    // First try block heavy assets
    await page.route("**/*", (route) => {
      const type = route.request().resourceType();
      if (["image", "media", "font"].includes(type)) return route.abort();
      route.continue();
    });

    // Two-phase navigation
    const tryNavigate = async (blockHeavy) => {
      if (!blockHeavy) await page.unroute("**/*");
      const resp = await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        .catch((e) => ({ _err: e }));
      if (!resp || resp._err) throw new Error("Navigation failed or timed out");
    };

    try {
      await tryNavigate(true);
    } catch {
      await tryNavigate(false);
    }

    // Wait to settle but cap wait time
    await Promise.race([
      page.waitForLoadState(waitUntil, { timeout: Math.min(timeoutMs, 25000) }).catch(() => {}),
      new Promise((r) => setTimeout(r, Math.min(timeoutMs, 25000)))
    ]);

    await page.waitForTimeout(1500); // allow DOM mutations

    const html = await page.content();
    const finalUrl = page.url();

    await page.close().catch(() => {});
    await context.close().catch(() => {});

    return res.json({ html, url: finalUrl });
  } catch (e) {
    const msg = e?.message || String(e);
    return res.status(500).json({ error: msg });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

const server = app.listen(PORT, () => {
  console.log(`Render API listening on :${PORT}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
