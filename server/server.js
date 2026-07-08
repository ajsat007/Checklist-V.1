/* =====================================================================
   pdf.js — server-side PDF generation via headless Chromium (Puppeteer).

   WHY THIS EXISTS
   ----------------
   The old flow generated PDFs in the user's browser with html2pdf.js,
   which rasterizes the DOM to a JPEG using html2canvas. html2canvas does
   its own text layout instead of using the browser's real OpenType
   shaping engine, so Devanagari broke: dropped/substituted characters,
   broken conjuncts, mispositioned matras, occasional tofu boxes, blurry
   non-searchable output.

   This module instead asks a real headless Chrome to print the exact
   same report page to PDF (page.pdf()). Chromium's native text engine
   does correct Indic-script shaping, so the resulting PDF has real,
   crisp, selectable, correctly-shaped text.

   USAGE
   -----
   const { renderSessionPDF, warmup } = require('./pdf');
   warmup();  // call once at server boot
   const buf = await renderSessionPDF(sessionId, `http://127.0.0.1:${PORT}`);
   ===================================================================== */
'use strict';

const puppeteer = require('puppeteer');

let browserPromise = null;
let launching = false;

/* Reuse a single browser instance across requests (Chromium startup is
   the slow part, ~1-2s). If it crashes, the next call relaunches it. */
async function getBrowser() {
  if (browserPromise) {
    try {
      const b = await browserPromise;
      if (b && b.isConnected()) return b;
    } catch (e) { /* fall through and relaunch */ }
    browserPromise = null;
  }
  if (!launching) {
    launching = true;
    browserPromise = puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--font-render-hinting=none'
      ]
    }).finally(() => { launching = false; });
  }
  return browserPromise;
}

/**
 * Render a session's inspection report to a PDF buffer.
 * @param {string} sessionId
 * @param {string} baseUrl  e.g. `http://127.0.0.1:${PORT}` — renders the
 *   server's OWN /report/:id route internally (loopback request), so the
 *   PDF is byte-for-byte what a user sees on screen.
 * @returns {Promise<Buffer>}
 */
async function renderSessionPDF(sessionId, baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1400 });
    const url = baseUrl + '/report/' + encodeURIComponent(sessionId) + '?pdf=1';
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || !resp.ok()) {
      throw new Error('Report page failed to load (HTTP ' + (resp ? resp.status() : '?') + ')');
    }
    // Explicitly wait for every @font-face to finish loading/parsing
    // before snapshotting (we don't need networkidle0 since there are no
    // external network calls — fonts are self-hosted).
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,   // honor @page { size:A4; margin:8mm } in report.js CSS
      timeout: 30000
    });
    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

/* Call once at server boot to launch Chromium immediately, instead of
   waiting for the first user's click. Removes Chromium's ~1-2s launch
   time from that first request's time budget. Fire-and-forget: if this
   fails, the first real request just launches it instead (same as
   before this existed). */
function warmup() {
  getBrowser().catch((e) => console.error('[pdf] warmup failed (will retry on first request):', e.message));
}

/* Call on shutdown (SIGTERM/SIGINT) so Render's redeploy/restart cycle
   doesn't leave an orphaned Chromium process behind. */
async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch (e) { /* already gone */ }
  browserPromise = null;
}

module.exports = { renderSessionPDF, closeBrowser, warmup };
