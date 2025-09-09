import express from "express";
import morgan from "morgan";
import { chromium } from "@playwright/test";

const PORT = process.env.PORT || 8080;
const API_KEY = process.env.RENDER_API_KEY || ""; // optional, set to require Bearer

const app = express();
app.use(express.json({ limit: "1mb" }));
app.use(morgan("tiny"));

// simple health
app.get("/health", (_, res) => res.json({ ok: true, ts: new Date().toISOString() }));

// optional API key auth
app.use((req, res, next) => {
  if (!API_KEY) return next();
  const h = req.get("authorization") || "";
  if (h === `Bearer ${API_KEY}`) return next();
  return res.status(401).json({ error: "Unauthorized" });
});

app.post("/render", async (req, res) => {
  const url = String(req.body?.url || "").trim();
  const waitUntil = req.body?.waitUntil || "networkidle"; // domcontentloaded | load | networkidle
  const timeoutMs = Math.min(60000, Math.max(5000, Number(req.body?.timeoutMs || 25000)));

  if (!/^https?:\/\//i.test(url)) {
    return res.status(400).json({ error: "Invalid url" });
  }

  let browser;
  try {
    browser = await chromium.launch({
      headless: true,
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-dev-shm-usage",
        "--disable-gpu",
        "--no-zygote"
      ]
    });
    const context = await browser.newContext({
      viewport: { width: 1366, height: 768 },
      userAgent: "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119 Safari/537.36 A11yRenderer/1.0",
      javaScriptEnabled: true,
      ignoreHTTPSErrors: true,
      // useful for sites with locales/consent
      locale: "en-US",
      timezoneId: "UTC"
    });
    const page = await context.newPage();

    // block heavy resources to speed up
    await page.route("**/*", (route) => {
      const r = route.request();
      const type = r.resourceType();
      if (["image", "media", "font"].includes(type)) return route.abort();
      return route.continue();
    });

    const nav = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(e => ({ _err: e }));
    if (!nav || nav._err) {
      // last-ditch try without blocking
      await page.unroute("**/*");
      const nav2 = await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs }).catch(e => ({ _err: e }));
      if (!nav2 || nav2._err) {
        throw new Error("Navigation failed or timed out");
      }
    }

    // wait for network to settle but with cap
    const settle = page.waitForLoadState(waitUntil, { timeout: Math.max(5000, Math.min(20000, timeoutMs)) })
      .catch(() => {}); // ignore if networkidle never happens
    // also wait a small fixed delay to let client JS mutate DOM
    const delay = new Promise(r => setTimeout(r, 1500));
    await Promise.race([Promise.all([settle, delay]), new Promise(r => setTimeout(r, timeoutMs))]);

    // remove scripts/styles to keep HTML clean-ish? (Your worker already strips, so keep raw)
    const content = await page.content();
    const finalUrl = page.url();

    res.json({ html: content, url: finalUrl });
  } catch (e) {
    res.status(500).json({ error: String(e.message || e) });
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
});

app.listen(PORT, () => {
  console.log(`Render API listening on :${PORT}`);
});
