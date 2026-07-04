/* =====================================================================
   migrate-sessions.js — one-time import of historical inspection records
   from the old Google Sheet's Inspection_Sessions tab (CSV export).

   Usage:
     node server/migrate-sessions.js path/to/Inspection_Sessions.csv

   - Streams the file (works for 300+ MB exports) — never loads it whole.
   - INSERT OR IGNORE by Session ID: re-running never duplicates or
     overwrites rows, and sessions created in the new app are untouched.
   - Old Google Drive PDF URLs are kept (those PDFs still exist on Drive);
     sessions without one fall back to the new /report/:id page.
   ===================================================================== */
'use strict';

const fs = require('fs');
const db = require('./db');

const file = process.argv[2];
if (!file || !fs.existsSync(file)) {
  console.error('Usage: node server/migrate-sessions.js <Inspection_Sessions.csv>');
  process.exit(1);
}

/* Streaming CSV row emitter (quotes, "" escapes, newlines inside cells).
   pendingQuote: a '"' seen inside a quoted field at the very END of a chunk —
   we can't know yet whether it closes the field or is the first half of an
   escaped "" pair, so the decision is deferred to the next chunk's first char. */
function streamCsv(path, onRow, onDone) {
  const stream = fs.createReadStream(path, { encoding: 'utf8' });
  let field = '', row = [], inQ = false, first = true, prevCR = false, pendingQuote = false;
  stream.on('data', (chunk) => {
    let i = 0;
    if (pendingQuote) {
      pendingQuote = false;
      if (chunk[0] === '"') { field += '"'; i = 1; }   // it was an escaped ""
      else inQ = false;                                 // it was the closing quote
    }
    for (; i < chunk.length; i++) {
      const c = chunk[i];
      if (first) { first = false; if (c === '﻿') continue; }         // BOM
      if (prevCR) { prevCR = false; if (c === '\n') continue; }       // CRLF
      if (inQ) {
        if (c === '"') {
          if (i + 1 < chunk.length) {
            if (chunk[i + 1] === '"') { field += '"'; i++; }
            else inQ = false;
          } else pendingQuote = true;                   // decide on next chunk
        } else field += c;
      } else if (c === '"') inQ = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r') prevCR = true;
        row.push(field); field = '';
        if (row.length > 1 || (row[0] && row[0].trim() !== '')) onRow(row);
        row = [];
      } else field += c;
    }
  });
  stream.on('end', () => {
    if (pendingQuote) inQ = false;                      // EOF: it closed the field
    row.push(field);
    if (row.length > 1 || (row[0] && row[0].trim() !== '')) onRow(row);
    onDone();
  });
  stream.on('error', (e) => { console.error('read error:', e); process.exit(1); });
}

function ddmmToISO(d) {
  const p = String(d || '').split(' ')[0].split('/');
  if (p.length !== 3) return '';
  return p[2] + '-' + p[1] + '-' + p[0];
}
function intOr0(v) { const n = parseInt(v, 10); return isNaN(n) ? 0 : n; }
function validJsonArr(s) {
  if (!s || !String(s).trim()) return '[]';
  try { const v = JSON.parse(s); return Array.isArray(v) ? JSON.stringify(v) : '[]'; }
  catch (e) { return '[]'; }
}

const ins = db.prepare(`INSERT OR IGNORE INTO sessions
  (session_id, token_id, district, station, supervisor_name, employee_id,
   checklist_type, checklist_key, created_time, created_date, date_iso,
   last_updated, completed_shifts, total_buses, status, total_shifts,
   pdf_url, shifts_json, buses_json)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

let header = null, col = {};
let seen = 0, imported = 0, skipped = 0, badJson = 0;
let batch = [];
const BATCH = 500;

function flush() {
  if (!batch.length) return;
  const rows = batch; batch = [];
  const tx = db.transaction(() => { rows.forEach(r => { imported += ins.run(...r).changes; }); });
  tx();
}

console.log('Importing sessions from', file, '…');
const t0 = Date.now();

streamCsv(file, (row) => {
  if (!header) {
    header = row.map(h => String(h).trim());
    header.forEach((h, i) => { col[h] = i; });
    const required = ['Session ID', 'Token ID', 'Created Time', 'Checklist Key'];
    const missing = required.filter(h => col[h] === undefined);
    if (missing.length) { console.error('Missing expected columns: ' + missing.join(', ')); process.exit(1); }
    return;
  }
  seen++;
  const g = (name) => String(row[col[name]] === undefined ? '' : row[col[name]]).trim();
  const sid = g('Session ID');
  if (!sid) { skipped++; return; }
  const createdTime = g('Created Time');
  const createdDate = createdTime.split(' ')[0] || '';
  const shiftsJson = validJsonArr(g('Shifts JSON'));
  const busesJson  = validJsonArr(g('Buses JSON'));
  if ((g('Shifts JSON') && shiftsJson === '[]' && g('Shifts JSON') !== '[]') ||
      (g('Buses JSON')  && busesJson  === '[]' && g('Buses JSON')  !== '[]')) badJson++;
  batch.push([
    sid, g('Token ID'), g('District'), g('Station'), g('Supervisor Name'), g('Employee ID'),
    g('Checklist Type'), g('Checklist Key'), createdTime, createdDate, ddmmToISO(createdDate),
    g('Last Updated') || createdTime, intOr0(g('Completed Shifts')), intOr0(g('Total Buses')),
    g('Status') || 'Completed', intOr0(g('Total Shifts')),
    g('PDF URL'), shiftsJson, busesJson
  ]);
  if (batch.length >= BATCH) flush();
  if (seen % 5000 === 0) console.log('  …' + seen + ' rows read');
}, () => {
  flush();
  const total = db.prepare('SELECT COUNT(*) c FROM sessions').get().c;
  console.log('Done in ' + Math.round((Date.now() - t0) / 1000) + 's');
  console.log('  rows read      : ' + seen);
  console.log('  newly imported : ' + imported);
  console.log('  skipped (no id): ' + skipped);
  console.log('  cells with unparseable JSON (stored as []): ' + badJson);
  console.log('  sessions now in database: ' + total);
});
