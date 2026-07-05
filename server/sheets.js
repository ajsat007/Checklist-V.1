/* =====================================================================
   sheets.js — durable backing store in a Google Sheet, ZERO npm deps.

   Auth: a Google service-account JSON key. We sign an OAuth2 JWT with Node's
   built-in crypto, exchange it for an access token (cached ~55 min), and call
   the Sheets REST API v4 with fetch. No googleapis package.

   Enabled only when all three env vars are present:
     SHEET_ID                the spreadsheet id
     GOOGLE_SA_EMAIL         service-account client_email
     GOOGLE_SA_PRIVATE_KEY   service-account private_key (with real or \n-escaped newlines)

   When absent, sheetsEnabled() is false and the app runs on pure SQLite/CSV
   (local dev needs no Google setup, and the site degrades safely).

   Tab + columns match the original app exactly (see COLS below), so historical
   rows round-trip without transformation.
   ===================================================================== */
'use strict';

const crypto = require('crypto');

const SHEET_ID = process.env.SHEET_ID || '';
const SA_EMAIL = process.env.GOOGLE_SA_EMAIL || '';
// Render stores multi-line secrets with literal \n — normalize to real newlines.
const SA_KEY = (process.env.GOOGLE_SA_PRIVATE_KEY || '').replace(/\\n/g, '\n');
const TAB = process.env.SHEET_TAB || 'Inspection_Sessions';

// The 20 columns, in sheet order. handlers.js maps a session → this array.
const COLS = [
  'Session ID', 'Token ID', 'District', 'Station', 'Supervisor Name', 'Employee ID',
  'Checklist Type', 'Checklist Key', 'Created Time', 'Last Updated', 'Completed Shifts',
  'Total Buses', 'Status', 'PDF URL', 'Last Modified', 'Modified By', 'Total Shifts',
  'Shifts JSON', 'Buses JSON', 'Synced'
];

function sheetsEnabled() { return !!(SHEET_ID && SA_EMAIL && SA_KEY); }

/* ---------- OAuth2: signed JWT → access token (cached) ---------- */
let _tok = null, _tokExp = 0;

function _b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function _accessToken() {
  const now = Math.floor(Date.now() / 1000);
  if (_tok && now < _tokExp - 60) return _tok;

  const header = _b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = _b64url(JSON.stringify({
    iss: SA_EMAIL,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now, exp: now + 3600
  }));
  const signingInput = header + '.' + claim;
  const signature = _b64url(crypto.sign('RSA-SHA256', Buffer.from(signingInput), SA_KEY));
  const jwt = signingInput + '.' + signature;

  const resp = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(jwt)
  });
  const data = await resp.json();
  if (!data.access_token) throw new Error('Google token error: ' + JSON.stringify(data));
  _tok = data.access_token;
  _tokExp = now + (data.expires_in || 3600);
  return _tok;
}

const API = 'https://sheets.googleapis.com/v4/spreadsheets/';

async function _api(method, path, body) {
  const token = await _accessToken();
  const resp = await fetch(API + SHEET_ID + path, {
    method,
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error('Sheets API ' + resp.status + ': ' + txt.slice(0, 300));
  }
  return resp.json();
}

/* ---------- operations used by the app ---------- */

// Bulk-read every data row. Returns array of arrays (excluding the header).
async function readAllSessions() {
  const range = encodeURIComponent(TAB + '!A1:T100000');
  const data = await _api('GET', '/values/' + range);
  const rows = data.values || [];
  if (!rows.length) return { header: COLS.slice(), rows: [] };
  return { header: rows[0], rows: rows.slice(1) };
}

// Append one row (INSERT). rowArr must be COLS-ordered.
// Returns the 1-based sheet row number it landed on (parsed from the API's
// updatedRange, e.g. "Inspection_Sessions!A24297:T24297" -> 24297), or 0.
async function appendSession(rowArr) {
  const range = encodeURIComponent(TAB + '!A1');
  const res = await _api('POST',
    '/values/' + range + ':append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    { values: [rowArr] });
  const ur = res && res.updates && res.updates.updatedRange || '';
  const m = ur.match(/![A-Z]+(\d+)/);
  return m ? parseInt(m[1], 10) : 0;
}

// Overwrite a specific 1-based sheet row (UPDATE). rowNumber includes the header
// (header = row 1, so first data row = 2).
async function updateSessionRow(rowNumber, rowArr) {
  const range = encodeURIComponent(TAB + '!A' + rowNumber + ':T' + rowNumber);
  await _api('PUT', '/values/' + range + '?valueInputOption=RAW', { values: [rowArr] });
}

// Clear a row's values (DELETE — keeps row numbering stable for other rows).
async function clearSessionRow(rowNumber) {
  const range = encodeURIComponent(TAB + '!A' + rowNumber + ':T' + rowNumber);
  await _api('POST', '/values/' + range + ':clear', {});
}

module.exports = {
  sheetsEnabled, COLS, TAB,
  readAllSessions, appendSession, updateSessionRow, clearSessionRow
};
