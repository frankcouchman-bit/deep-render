import express from "express";
import { chromium } from "playwright";

const app = express();
app.use(express.json({ limit: "512kb" }));

// optional auth: set API_KEY in Render (then set same as RENDER_API_KEY in Worker)
const mustAuth = !!process.env.API_KEY;
function checkAuth(req, res, next) {
  if (!mustAuth) return next();
  const got = req.get("authorization") || "";
  const want = `Bearer ${process.env.API_KEY}`;
  if (got === want) return next();
  return res.status(401).json({ error: "unauthorized" });
}

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/render", checkAuth, async (req, res) => {
  const { url, waitUntil = "networkidle", timeoutMs = 60000 } = req.body || {};
  if (!url || !/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Missing or invalid url" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-gpu"]
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; DeepRender/1.0; +https://render.com)",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      viewport: { width: 1366, height: 768 }
    });
    const page = await ctx.newPage();
    await page.goto(url, { waitUntil, timeout: timeoutMs });
    const html = await page.content();
    return res.json({ ok: true, url: page.url(), html });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  } finally {
    if (browser) await browser.close();
  }
});

const port = process.env.PORT || 8080;
app.listen(port, "0.0.0.0", () => {
  console.log("Deep Render listening on", port);
});
