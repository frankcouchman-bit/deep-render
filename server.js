import express from "express";
import bodyParser from "body-parser";
import { chromium } from "playwright";

const app = express();
app.use(bodyParser.json({ limit: "1mb" }));

// Optional bearer auth; if set on Render, the Worker will send this header.
const AUTH = process.env.RENDER_API_KEY || "";

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/render", async (req, res) => {
  try {
    if (AUTH) {
      const hdr = req.get("authorization") || "";
      if (hdr !== `Bearer ${AUTH}`) return res.status(401).json({ error: "unauthorized" });
    }

    const { url, waitUntil = "networkidle", timeoutMs = 30000 } = req.body || {};
    if (!url || !/^https?:\/\//i.test(url)) return res.status(400).json({ error: "bad_url" });

    const browser = await chromium.launch({
      args: ["--no-sandbox", "--disable-dev-shm-usage"],
      headless: true
    });
    const ctx = await browser.newContext({
      userAgent: "Mozilla/5.0 (compatible; A11yDeepRender/1.0)"
    });
    const page = await ctx.newPage();

    let finalUrl = url;
    try {
      await page.goto(url, { waitUntil, timeout: timeoutMs });
      finalUrl = page.url();
      await page.waitForTimeout(500); // small settle for SPA updates
    } catch (_) { /* allow partial loads */ }

    const html = await page.content();
    await ctx.close();
    await browser.close();

    res.json({ html, url: finalUrl, status: 200 });
  } catch (e) {
    console.error("render error:", e);
    res.status(500).json({ error: "render_failed", detail: String(e) });
  }
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log("Deep Render listening on :" + port));
