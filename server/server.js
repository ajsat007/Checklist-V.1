/* =====================================================================
   server.js — the whole backend, ZERO npm dependencies (Node >= 22.13).
     POST /exec        { fn, args } -> dispatch to a whitelisted handler
     GET  /report/:id  printable Marathi inspection report (Print -> PDF)
     GET  /*           static SPA files from ../public
   Run:  node server/server.js     (or: npm start)
   ===================================================================== */
'use strict';

const http = require('http');
const path = require('path');
const fs   = require('fs');

const seed = require('./seed');
const { H } = require('./handlers');
const { buildReport } = require('./report');
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
  'searchReports', 'searchPastInspections', 'peekContinuationSession'
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
  let rel = decodeURIComponent(urlPath.split('?')[0]);
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
      const result = await H[fn].apply(null, args);   // handlers may be async (Sheet mirror)
      return send(res, 200, typeof result === 'string' ? result : JSON.stringify(result));
    } catch (err) {
      console.error('[exec]', err);
      return send(res, 200, JSON.stringify({ ok: false, msg: 'Server error: ' + (err && err.message ? err.message : err) }));
    }
  }

  // ---- GET /report/:id : printable report ----
  if (req.method === 'GET' && url.startsWith('/report/')) {
    const q = url.indexOf('?');
    const id = decodeURIComponent(url.slice('/report/'.length, q === -1 ? undefined : q));
    const autoPrint = q !== -1 && url.slice(q).indexOf('print=1') !== -1;
    return send(res, 200, buildReport(id, autoPrint), 'text/html; charset=utf-8');
  }

  if (req.method === 'GET' && url.split('?')[0] === '/health') {
    return send(res, 200, JSON.stringify({ ok: true }));
  }

  // ---- GET /backup?key=ADMIN_KEY : download a consistent DB snapshot ----
  // Set the ADMIN_KEY environment variable to enable. VACUUM INTO produces a
  // clean single-file copy that is safe to take while the app is running.
  if (req.method === 'GET' && url.split('?')[0] === '/backup') {
    const adminKey = process.env.ADMIN_KEY || '';
    const givenKey = (url.split('key=')[1] || '').split('&')[0];
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

/* Boot: when Google Sheet env vars are set, restore ALL sessions from the
   Sheet into SQLite BEFORE serving traffic (this is what makes history
   survive Render free-plan restarts). Without env vars, start as before. */
(async () => {
  if (sheetsEnabled()) {
    try {
      const t0 = Date.now();
      const r = await loadFromSheet(db);
      console.log('[boot] restored %d sessions from Google Sheet in %ds',
        r.loaded, Math.round((Date.now() - t0) / 1000));
    } catch (e) {
      console.error('[boot] Sheet restore FAILED (continuing with local data):', e.message);
    }
  } else {
    console.log('[boot] Sheet sync disabled (SHEET_ID / GOOGLE_SA_* env vars not set)');
  }
  server.listen(PORT, () => {
    console.log('MSRTC Checklist server running → http://localhost:' + PORT);
  });
})();
