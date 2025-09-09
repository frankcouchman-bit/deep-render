import express from "express";
import morgan from "morgan";
import { chromium } from "playwright-core"; // use -core to rely on system browsers

const PORT = Number(process.env.PORT || 8080);
const API_KEY = process.env.RENDER_API_KEY || ""; // optional bearer
const app = express();

app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// Basic health checks
app.get("/", (_req, res) => res.json({ ok: true, name: "wcag-renderer" }));
app.get("/health", (_req, res) => res.json({ ok: true, name: "wcag-renderer" }));

// Optional auth: require Bearer if set
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const h = req.get("authorization") || "";
  if (h === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

/**
 * POST /render
 * Body:
 *   { url: string, waitUntil?: "domcontentloaded"|"load"|"networkidle", timeoutMs?: number }
 */
app.post("/render", async (req, res) => {
  try {
    const url = String(req.body?.url || "").trim();
    const waitUntil =
      ["domcontentloaded", "load", "networkidle"].includes(req.body?.waitUntil)
        ? req.body.waitUntil
        : "networkidle";
    const timeoutMs = Math.min(60000, Math.max(5000, Number(req.body?.timeoutMs || 25000)));

    if (!/^https?:\/\//i.test(url)) {
      return res.status(400).json({ error: "Invalid url" });
    }

    // Important: rely on bundled Chromium from the Docker image
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

      // Block heavy assets for speed
      await page.route("**/*", (route) => {
        const type = route.request().resourceType();
        if (["image", "media", "font"].includes(type)) return route.abort();
        return route.continue();
      });

      // Navigate with a conservative first hop
      const first = await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
        .catch((e) => ({ _err: e }));

      if (!first || first._err) {
        // Try again without blocking if first attempt failed
        await page.unroute("**/*");
        const second = await page
          .goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs })
          .catch((e) => ({ _err: e }));
        if (!second || second._err) {
          throw new Error("Navigation failed or timed out");
        }
      }

      // Wait for network to settle, but cap the wait so we don't hang
      await Promise.race([
        page.waitForLoadState(waitUntil, {
          timeout: Math.max(5000, Math.min(20000, timeoutMs))
        }).catch(() => {}),
        new Promise((r) => setTimeout(r, Math.min(timeoutMs, 20000)))
      ]);

      // Allow client JS a brief moment to mutate the DOM
      await new Promise((r) => setTimeout(r, 1500));

      const content = await page.content();
      const finalUrl = page.url();

      await page.close().catch(() => {});
      await context.close().catch(() => {});

      // Return rendered HTML
      return res.json({ html: content, url: finalUrl });
    } finally {
      await browser.close().catch(() => {});
    }
  } catch (e) {
    const msg = (e && e.message) ? e.message : String(e);
    return res.status(500).json({ error: msg });
  }
});

// Graceful shutdown for Render
const server = app.listen(PORT, () => {
  console.log(`Render API listening on :${PORT}`);
});
process.on("SIGTERM", () => {
  server.close(() => process.exit(0));
});
process.on("SIGINT", () => {
  server.close(() => process.exit(0));
});
