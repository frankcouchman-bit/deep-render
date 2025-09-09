import express from "express";
import morgan from "morgan";
import { chromium } from "playwright"; // use playwright (not -core) to match baked browsers

const PORT = Number(process.env.PORT || 8080);

// Optional bearer for your Worker to call this safely
const API_KEY = process.env.RENDER_API_KEY || "";

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Health
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
  try {
    const url = String(req.body?.url || "").trim();
    const waitUntil =
      ["domcontentloaded", "load", "networkidle"].includes(req.body?.waitUntil)
        ? req.body.waitUntil
        : "networkidle";
    const timeoutMs = Math.min(60000, Math.max(8000, Number(req.body?.timeoutMs || 25000)));

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Invalid url" });
    }

    const browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote"
      ]
    });

    try {
      const context = await browser.newContext({
        viewport: { width: 1366, height: 768 },
        userAgent:
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) " +
          "Chrome/120 Safari/537.36 A11yRenderer/1.0",
        javaScriptEnabled: true,
        ignoreHTTPSErrors: true,
        locale: "en-US",
        timezoneId: "UTC"
      });

      const page = await context.newPage();

      // Speed-up: block heavy assets on first try
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "media", "font"].includes(type)) return route.abort();
        route.continue();
      });

      // Try a two-phase navigation (with and without blocking)
      const tryNavigate = async (blockHeavy) => {
        if (!blockHeavy) await page.unroute("**/*");
        const firstHop = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
          .catch((e) => ({ _err: e }));
        if (!firstHop || firstHop._err) {
          throw new Error("Navigation failed or timed out");
        }
      };

      try {
        await tryNavigate(true);
      } catch {
        await tryNavigate(false);
      }

      // Settle network a bit but don’t hang forever
      await Promise.race([
        page.waitForLoadState(waitUntil, { timeout: Math.min(timeoutMs, 20000) }).catch(() => {}),
        new Promise((r) => setTimeout(r, Math.min(timeoutMs, 20000)))
      ]);

      // Let client JS mutate DOM briefly
      await page.waitForTimeout(1500);

      const html = await page.content();
      const finalUrl = page.url();

      await page.close().catch(() => {});
      await context.close().catch(() => {});

      return res.json({ html, url: finalUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
});

// Graceful shutdown (Render sends SIGTERM)
const server = app.listen(PORT, () => {
  console.log(`Render API listening on :${PORT}`);
});
process.on("SIGTERM", () => server.close(() => process.exit(0)));
process.on("SIGINT", () => server.close(() => process.exit(0)));
