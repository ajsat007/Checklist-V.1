/* =====================================================================
   pdf.js — PDF generation via Browserless.io (hosted headless Chrome).

   WHY THIS EXISTS
   ----------------
   Running Chrome directly on Render's free plan (512MB RAM) kept crashing
   silently no matter which Chrome build we tried (bundled, system, or the
   memory-optimized @sparticuz/chromium) — the container doesn't have
   enough RAM to run any headless browser reliably alongside the Node app.

   Browserless.io runs Chrome on THEIR servers instead. We just send them
   our report page's public URL; their Chrome renders it (with the
   self-hosted Devanagari font loading normally) and sends back a PDF.
   No Chrome, no Docker, no memory issues on our side at all.

   Requires the BROWSERLESS_TOKEN environment variable to be set (get a
   free token at https://www.browserless.io/).
   ===================================================================== */
'use strict';

/**
 * Render a session's inspection report to a PDF buffer, using Browserless's
 * hosted Chrome instead of running Chrome locally.
 * @param {string} sessionId
 * @param {string} baseUrl  e.g. `http://127.0.0.1:${PORT}` — used only as
 *   a fallback if RENDER_EXTERNAL_URL isn't set (e.g. local dev).
 * @returns {Promise<Buffer>}
 */
async function renderSessionPDF(sessionId, baseUrl) {
  const token = process.env.BROWSERLESS_TOKEN;
  if (!token) {
    throw new Error('BROWSERLESS_TOKEN environment variable is not set');
  }

  // Render sets RENDER_EXTERNAL_URL automatically to this app's public
  // https:// address. Browserless needs a PUBLIC url (not localhost) so
  // their Chrome (running on their own servers) can actually fetch it.
  const publicBase = process.env.RENDER_EXTERNAL_URL || baseUrl;
  const reportUrl = publicBase + '/report/' + encodeURIComponent(sessionId) + '?pdf=1';

  const resp = await fetch('https://production-sfo.browserless.io/pdf?token=' + token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      url: reportUrl,
      options: { printBackground: true, preferCSSPageSize: true }
    })
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error('Browserless PDF request failed (HTTP ' + resp.status + '): ' + text.slice(0, 300));
  }

  const arrayBuf = await resp.arrayBuffer();
  return Buffer.from(arrayBuf);
}

/* No-ops kept so server.js (which calls these) doesn't need any changes. */
function warmup() { /* nothing to warm up — Browserless is always ready */ }
async function closeBrowser() { /* nothing to close — no local browser */ }

module.exports = { renderSessionPDF, closeBrowser, warmup };
