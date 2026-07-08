'use strict';

const puppeteer = require('puppeteer-core');
const chromium = require('@sparticuz/chromium');

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
      args: chromium.args,
      executablePath: await chromium.executablePath()
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
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (!resp || !resp.ok()) {
      throw new Error('Report page failed to load (HTTP ' + (resp ? resp.status() : '?') + ')');
    }
    await page.evaluate(() => document.fonts && document.fonts.ready);
    return await page.pdf({ printBackground: true, preferCSSPageSize: true, timeout: 30000 });
  } finally {
    await page.close().catch(() => {});
  }
}

function warmup() {
  getBrowser().catch((e) => console.error('[pdf] warmup failed:', e.message));
}

async function closeBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    if (b) await b.close();
  } catch (e) {}
  browserPromise = null;
}

module.exports = { renderSessionPDF, closeBrowser, warmup };
