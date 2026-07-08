/* =====================================================================
   pdf.js — server-side PDF generation via headless Chromium (Puppeteer).
   ===================================================================== */
'use strict';

const puppeteer = require('puppeteer');

let browserPromise = null;
let launching = false;

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

async function renderSessionPDF(sessionId, baseUrl) {
  const browser = await getBrowser();
  const page = await browser.newPage();
  try {
    await page.setViewport({ width: 900, height: 1400 });
    const url = baseUrl + '/report/' + encodeURIComponent(sessionId) + '?pdf=1';
    const resp = await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
    if (!resp || !resp.ok()) {
      throw new Error('Report page failed to load (HTTP ' + (resp ? resp.status() : '?') + ')');
    }
    await page.evaluate(() => document.fonts && document.fonts.ready);

    const pdfBuffer = await page.pdf({
      printBackground: true,
      preferCSSPageSize: true,
      timeout: 30000
    });
    return pdfBuffer;
  } finally {
    await page.close().catch(() => {});
  }
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch (e) { /* already gone */ }
  browserPromise = null;
}

module.exports = { renderSessionPDF, closeBrowser };
