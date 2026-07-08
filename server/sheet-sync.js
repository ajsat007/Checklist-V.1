/* =====================================================================
   sheet-sync.js — keeps the Google Sheet in step with SQLite.

   - Maps a SQLite session row  <->  the Sheet's 20-column row array.
   - Holds the in-memory Session-ID -> sheet-row-number map (built at boot).
   - Write-through helpers (mirrorInsert/Update/Delete) run ASYNC in the
     background off a small serial queue, so:
       * the HTTP response never waits on the Sheets round-trip, and
       * concurrent writes to the Sheet are serialized (no lost row numbers).
   - When sheets are disabled (no env vars) every helper is a no-op, so the
     app behaves exactly like the pure-SQLite build.

   The durable truth is the Sheet; SQLite is the fast, rebuildable cache.
   ===================================================================== */
'use strict';

const sheets = require('./sheets');

// Session ID -> 1-based sheet row number (header is row 1).
const rowMap = new Map();

/* SQLite session row -> COLS-ordered array for the Sheet. */
function rowFromSession(s) {
  return [
    s.session_id || '', s.token_id || '', s.district || '', s.station || '',
    s.supervisor_name || '', s.employee_id || '', s.checklist_type || '', s.checklist_key || '',
    s.created_time || '', s.last_updated || '', String(s.completed_shifts || 0),
    String(s.total_buses || 0), s.status || '', s.pdf_url || '', '', '',
    String(s.total_shifts || 0), s.shifts_json || '[]', s.buses_json || '[]', 'TRUE'
  ];
}

/* Sheet row array -> object shaped like a SQLite session row (for boot load). */
function sessionFromRow(arr) {
  const g = (i) => (arr[i] === undefined || arr[i] === null) ? '' : String(arr[i]);
  const createdTime = g(8);
  const createdDate = createdTime.split(' ')[0] || '';
  const dp = createdDate.split('/');
  const dateIso = dp.length === 3 ? (dp[2] + '-' + dp[1] + '-' + dp[0]) : '';
  const jsonOr = (v) => { try { const x = JSON.parse(v); return Array.isArray(x) ? v : '[]'; } catch (e) { return '[]'; } };
  const sid = g(0).trim();
  if (!sid) return null;
  return {
    session_id: sid, token_id: g(1), district: g(2), station: g(3),
    supervisor_name: g(4), employee_id: g(5), checklist_type: g(6), checklist_key: g(7),
    created_time: createdTime, created_date: createdDate, date_iso: dateIso,
    last_updated: g(9) || createdTime,
    completed_shifts: parseInt(g(10), 10) || 0, total_buses: parseInt(g(11), 10) || 0,
    status: g(12) || 'Completed', pdf_url: g(13), total_shifts: parseInt(g(16), 10) || 0,
    shifts_json: jsonOr(g(17)), buses_json: jsonOr(g(18))
  };
}

/* ---- background serial queue (never blocks the request) ---- */
let _chain = Promise.resolve();
function _enqueue(fn) {
  _chain = _chain.then(fn).catch((e) => { console.error('[sheet-sync]', e.message); });
  return _chain;
}

function mirrorInsert(sessionRow) {
  if (!sheets.sheetsEnabled()) return;
  _enqueue(async () => {
    const rn = await sheets.appendSession(rowFromSession(sessionRow));
    if (rn) rowMap.set(sessionRow.session_id, rn);   // updates hit the row directly
  });
}

function mirrorUpdate(sessionRow) {
  if (!sheets.sheetsEnabled()) return;
  _enqueue(async () => {
    let rn = rowMap.get(sessionRow.session_id);
    if (!rn) rn = await _resolveRow(sessionRow.session_id);
    if (rn) {
      await sheets.updateSessionRow(rn, rowFromSession(sessionRow));
    } else {
      // fell out of the map (e.g. created before a restart) → re-add
      const newRn = await sheets.appendSession(rowFromSession(sessionRow));
      if (newRn) rowMap.set(sessionRow.session_id, newRn);
    }
  });
}

function mirrorDelete(sessionId) {
  if (!sheets.sheetsEnabled()) return;
  _enqueue(async () => {
    let rn = rowMap.get(sessionId);
    if (!rn) rn = await _resolveRow(sessionId);
    if (rn) {
      await sheets.deleteSessionRow(rn);
      // Physical row deletion shifts all subsequent rows up by 1,
      // so rebuild the map to keep row pointers accurate.
      rowMap.clear();
      await _resolveRow();
    }
  });
}

/* Find a session's current sheet row by re-reading ONLY the ID column (a few
   hundred KB even at 24k rows). Rebuilds the whole map in one cheap call. */
async function _resolveRow(sessionId) {
  const ids = await sheets.readIdColumn();
  rowMap.clear();
  ids.forEach((id, i) => { if (id) rowMap.set(id, i + 2); });
  return rowMap.get(sessionId) || 0;
}

/* Boot: pull every row from the Sheet into SQLite and build the row map.
   Chunked (1500 rows/call) so peak memory stays ~25 MB — Render's free
   instance has only 512 MB and one giant read would OOM it. */
async function loadFromSheet(db) {
  if (!sheets.sheetsEnabled()) return { loaded: 0, enabled: false };
  const ins = db.prepare(`INSERT OR REPLACE INTO sessions
    (session_id, token_id, district, station, supervisor_name, employee_id,
     checklist_type, checklist_key, created_time, created_date, date_iso,
     last_updated, completed_shifts, total_buses, status, total_shifts,
     pdf_url, shifts_json, buses_json)
    VALUES (@session_id,@token_id,@district,@station,@supervisor_name,@employee_id,
     @checklist_type,@checklist_key,@created_time,@created_date,@date_iso,
     @last_updated,@completed_shifts,@total_buses,@status,@total_shifts,
     @pdf_url,@shifts_json,@buses_json)`);
  let loaded = 0;
  rowMap.clear();
  await sheets.readSessionsChunked((rows, startRow) => {
    const tx = db.transaction(() => {
      rows.forEach((r, i) => {
        const s = sessionFromRow(r);
        if (!s) return;
        ins.run(s);
        rowMap.set(s.session_id, startRow + i);
        loaded++;
      });
    });
    tx();
  });
  return { loaded, enabled: true };
}

module.exports = {
  rowFromSession, sessionFromRow, loadFromSheet,
  mirrorInsert, mirrorUpdate, mirrorDelete, rowMap
};
