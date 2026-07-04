/* =====================================================================
   import.js — load REAL master data from CSV files into the database.

   Files (UTF-8, first row = header):
     data/locations.csv   →  district,station
     data/employees.csv   →  employee_id,name,password,active

   - password empty  => login password is the employee id (same rule as before)
   - active empty    => 1 (active)
   - Rows are UPSERTED: safe to re-run; existing ids/pairs are updated, and
     nothing is deleted (remove rows manually if someone leaves).
   - Excel's "CSV UTF-8" adds a BOM — handled.

   Run manually:   node server/import.js
   Auto-run:       seed.js calls this at every server start when the CSV
                   files exist, so on cloud hosts (Render) you just commit
                   the CSVs and each deploy imports them.
   ===================================================================== */
'use strict';

const fs   = require('fs');
const path = require('path');
const db   = require('./db');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
// CSVs may live in the repo's data/ even when DATA_DIR points elsewhere
// (Render: DB on /data disk, CSVs shipped with the code).
const CSV_DIRS = [path.join(__dirname, '..', 'data'), DATA_DIR];

function findCsv(name) {
  for (const dir of CSV_DIRS) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/* Minimal CSV parser: handles quoted fields, escaped quotes, CRLF, BOM. */
function parseCsv(text) {
  text = text.replace(/^﻿/, '');
  const rows = [];
  let row = [], field = '', inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQ = false;
      } else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some(f => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some(f => f.trim() !== '')) rows.push(row);
  return rows;
}

function importLocations(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) return 0;
  const up = db.prepare('INSERT OR IGNORE INTO locations (district, station) VALUES (?, ?)');
  let n = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {           // skip header
      const d = String(rows[i][0] || '').trim();
      const s = String(rows[i][1] || '').trim();
      if (!d || !s) continue;
      up.run(d, s); n++;
    }
  });
  tx();
  return n;
}

function importEmployees(file) {
  const rows = parseCsv(fs.readFileSync(file, 'utf8'));
  if (rows.length < 2) return 0;
  const up = db.prepare(`INSERT INTO employees (employee_id, name, password, active)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(employee_id) DO UPDATE SET name=excluded.name, password=excluded.password, active=excluded.active`);
  let n = 0;
  const tx = db.transaction(() => {
    for (let i = 1; i < rows.length; i++) {
      const id = String(rows[i][0] || '').trim();
      const name = String(rows[i][1] || '').trim();
      if (!id || !name || !/^\d+$/.test(id)) continue;
      const pw  = String(rows[i][2] || '').trim();
      const act = String(rows[i][3] === undefined || rows[i][3] === '' ? '1' : rows[i][3]).trim();
      const active = (act === '0' || /^(no|false|inactive)$/i.test(act)) ? 0 : 1;
      up.run(id, name, pw, active); n++;
    }
  });
  tx();
  return n;
}

/* Returns {locations, employees} counts imported, or null if no CSVs exist. */
function importCsvIfPresent() {
  const locFile = findCsv('locations.csv');
  const empFile = findCsv('employees.csv');
  if (!locFile && !empFile) return null;
  const out = { locations: 0, employees: 0 };
  if (locFile) out.locations = importLocations(locFile);
  if (empFile) out.employees = importEmployees(empFile);
  return out;
}

module.exports = { importCsvIfPresent, parseCsv };

if (require.main === module) {
  const r = importCsvIfPresent();
  if (!r) {
    console.log('No CSV files found. Create data/locations.csv and/or data/employees.csv first.');
    console.log('  locations.csv →  district,station');
    console.log('  employees.csv →  employee_id,name,password,active');
  } else {
    console.log('[import] locations rows processed: %d, employees rows processed: %d', r.locations, r.employees);
  }
}
