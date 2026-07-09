/* =====================================================================
   server.js — the whole backend (Node >= 22.13).
     POST /exec              { fn, args } -> dispatch to a whitelisted handler
     GET  /report/:id        printable Marathi inspection report
     GET  /report/:id/pdf    one-click PDF download
     GET  /*                 static SPA files from ../public
   Run:  node server/server.js     (or: npm start)
   ===================================================================== */
'use strict';

const http = require('http');
const path = require('path');
const fs   = require('fs');

const seed = require('./seed');
const { H } = require('./handlers');
const { buildReport } = require('./report');
const { generatePdf } = require('./pdf-gen');
const db = require('./db');
const { loadFromSheet } = require('./sheet-sync');
const { sheetsEnabled } = require('./sheets');

// Seed sample master data on first boot (idempotent).
seed();

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

// Whitelist of callable functions (never dispatch arbitrary names).
const ALLOWED = new Set([
  'getBootData', 'getDistrictData', 'loginSupervisor', 'lookupSupervisorName', 'getEmployeeStats',
  'checkChecklistCompletedToday', 'createSession',
  'submitAllShifts', 'submitFullChecklist', 'saveBusEntry', 'saveBus',
  'finalizeBusSession', 'finalizeInspection', 'updateUnitAnswers', 'editShift', 'editBus',
  'deleteSession', 'deleteBusEntry', 'getSessionForEdit', 'resumeSession', 'listIncompleteSessions',
  'getMyReports', 'getSupervisorReports', 'getMyReportsPaged', 'getSessionDetail', 'getReportFullDetail',
  'generateSessionPdf', 'generatePdfNow', 'regeneratePDFForSession', 'getSessionPdf',
  'searchReports', 'searchPastInspections', 'peekContinuationSession',
  'fixPartialShiftSessions',
  'fixChecklistTypes'
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png':  'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.svg':  'image/svg+xml', '.ico': 'image/x-icon',
  '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf'
};

function send(res, status, body, type) {
  res.writeHead(status, { 'Content-Type': type || 'application/json; charset=utf-8' });
  res.end(body);
}
function escapeHtml(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'})[c]); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { reject(new Error('body too large')); req.destroy(); return; }
      data += c;
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

function serveStatic(res, urlPath) {
  let rel;
  try { rel = decodeURIComponent(urlPath.split('?')[0]); } catch (e) { rel = urlPath.split('?')[0]; }
  if (rel === '/' || rel === '') rel = '/index.html';
  // prevent path traversal: resolve inside PUBLIC_DIR only
  const abs = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!abs.startsWith(PUBLIC_DIR)) return send(res, 403, 'Forbidden', 'text/plain');
  fs.readFile(abs, (err, buf) => {
    if (err) return send(res, 404, 'Not found', 'text/plain');
    send(res, 200, buf, MIME[path.extname(abs).toLowerCase()] || 'application/octet-stream');
  });
}

const server = http.createServer(async (req, res) => {
  const url = req.url || '/';

  // ---- POST /exec : { fn, args } dispatcher ----
  if (req.method === 'POST' && url === '/exec') {
    try {
      const raw = await readBody(req);
      let body = {};
      try { body = JSON.parse(raw || '{}'); } catch (e) { body = {}; }
      const fn = body.fn;
      const args = Array.isArray(body.args) ? body.args : [];
      if (!ALLOWED.has(fn) || typeof H[fn] !== 'function') {
        return send(res, 200, JSON.stringify({ ok: false, msg: 'Function not allowed: ' + fn }));
      }
      const result = await H[fn].apply(null, args);
      return send(res, 200, typeof result === 'string' ? result : JSON.stringify(result));
    } catch (err) {
      console.error('[exec]', err);
      return send(res, 200, JSON.stringify({ ok: false, msg: 'Server error: ' + (err && err.message ? err.message : err) }));
    }
  }

  // ---- GET /report/:id : printable report (Print → Save as PDF) ----
  if (req.method === 'GET' && url.startsWith('/report/')) {
    try {
      const q = url.indexOf('?');
      const rawId = url.slice('/report/'.length, q === -1 ? undefined : q);

      // Check for /report/:id/pdf route (one-click PDF download)
      const cleanRawId = rawId.split('?')[0]; // strip query params
      if (cleanRawId.endsWith('/pdf')) {
        const sessionId = cleanRawId.slice(0, -4); // remove /pdf suffix
        try {
          const pdfBuf = await generatePdf(decodeURIComponent(sessionId));
          const row = require('./handlers')._getSession(sessionId);
          const safeName = ((row && row.token_id) || sessionId).replace(/[^A-Za-z0-9_\-]/g, '_') + '.pdf';
          res.writeHead(200, {
            'Content-Type': 'application/pdf',
            'Content-Disposition': 'attachment; filename="' + safeName + '"',
            'Content-Length': pdfBuf.length,
            'Cache-Control': 'no-store'
          });
          return res.end(pdfBuf);
        } catch (err) {
          console.error('[pdf-dl]', err);
          return send(res, 500, JSON.stringify({ ok: false, msg: 'PDF generation failed: ' + err.message }), 'application/json');
        }
      }

      let id;
      try { id = decodeURIComponent(rawId); } catch (e) { id = rawId; }
      const qs = q === -1 ? '' : url.slice(q);
      const autoPrint = qs.indexOf('print=1') !== -1;
      const forPdf = qs.indexOf('pdf=1') !== -1;
      return send(res, 200, buildReport(id, autoPrint, { forPdf }), 'text/html; charset=utf-8');
    } catch (err) {
      console.error('[report]', err);
      return send(res, 500, '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center"><h2>अहवाल तयार करताना त्रुटी</h2><p>Report error: ' + escapeHtml(String(err.message || err)) + '</p></body>', 'text/html; charset=utf-8');
    }
  }

  if (req.method === 'GET' && url.split('?')[0] === '/health') {
    try { db.prepare('SELECT 1').get(); return send(res, 200, JSON.stringify({ ok: true, db: 'ok' })); }
    catch (e) { return send(res, 500, JSON.stringify({ ok: false, db: 'error', msg: e.message })); }
  }

  // ---- GET /backup?key=ADMIN_KEY : download a consistent DB snapshot ----
  if (req.method === 'GET' && url.split('?')[0] === '/backup') {
    const adminKey = process.env.ADMIN_KEY || '';
    const qIdx = url.indexOf('?');
    const params = qIdx >= 0 ? new URLSearchParams(url.slice(qIdx + 1)) : new URLSearchParams();
    const givenKey = params.get('key') || '';
    if (!adminKey) return send(res, 404, 'Backups disabled (set ADMIN_KEY).', 'text/plain');
    if (givenKey !== adminKey) return send(res, 403, 'Forbidden', 'text/plain');
    try {
      const db = require('./db');
      const os = require('os');
      const tmp = path.join(os.tmpdir(), 'msrtc-backup-' + Date.now() + '.db');
      db.exec("VACUUM INTO '" + tmp.replace(/'/g, "''").replace(/\\/g, '/') + "'");
      const buf = fs.readFileSync(tmp);
      fs.unlink(tmp, () => {});
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Disposition': 'attachment; filename="msrtc-checklist-backup.db"'
      });
      return res.end(buf);
    } catch (err) {
      console.error('[backup]', err);
      return send(res, 500, 'Backup failed: ' + err.message, 'text/plain');
    }
  }

  // ---- static SPA ----
  if (req.method === 'GET') return serveStatic(res, url);

  send(res, 405, 'Method not allowed', 'text/plain');
});

// Server-level error handler (prevents crash on EADDRINUSE, etc.)
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error('[fatal] Port ' + PORT + ' is already in use.');
    process.exit(1);
  }
  console.error('[fatal] Server error:', err);
});

/* Boot: when Google Sheet env vars are set, restore ALL sessions from the
   Sheet into SQLite BEFORE serving traffic. Without env vars, start as before. */
(async () => {
  if (sheetsEnabled()) {
    try {
      const t0 = Date.now();
      const timeout = new Promise((_, rej) =>
        setTimeout(() => rej(new Error('Sheet restore timed out after 20s')), 20000));
      const r = await Promise.race([loadFromSheet(db), timeout]);
      console.log('[boot] restored %d sessions from Google Sheet in %ds',
        r.loaded, Math.round((Date.now() - t0) / 1000));
    } catch (e) {
      console.error('[boot] Sheet restore FAILED or timed out (continuing with local data):', e.message);
    }
  } else {
    console.log('[boot] Sheet sync disabled (SHEET_ID / GOOGLE_SA_* env vars not set)');
  }
  server.listen(PORT, () => {
    console.log('MSRTC Checklist server running → http://localhost:' + PORT);
  });
})();

// Shutdown handler.
['SIGTERM', 'SIGINT'].forEach((sig) => {
  process.on(sig, () => {
    console.log('[shutdown] ' + sig + ' received, closing server...');
    server.close(() => process.exit(0));
  });
});
