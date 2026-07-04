/* =====================================================================
   seed.js — sample master data so the app runs out-of-the-box.
   Idempotent: safe to run repeatedly (INSERT OR IGNORE).

   NOTE: These districts/stations/employees are SAMPLES. Replace them with
   your real lists — see README.md ("Importing your real master data").
   ===================================================================== */
'use strict';

const db = require('./db');

// { district: [station, ...] }  — sample Maharashtra depots (Devanagari)
const SAMPLE_LOCATIONS = {
  'अमरावती': ['अमरावती', 'दर्यापूर', 'अचलपूर', 'मोर्शी'],
  'नागपूर':  ['नागपूर गणेशपेठ', 'नागपूर एमआयडीसी', 'काटोल', 'रामटेक'],
  'पुणे':    ['पुणे स्टेशन', 'स्वारगेट', 'शिवाजीनगर', 'हडपसर'],
  'नाशिक':   ['नाशिक', 'मालेगाव', 'सिन्नर', 'इगतपुरी'],
  'छत्रपती संभाजीनगर': ['मध्यवर्ती बसस्थानक', 'सिडको', 'पैठण', 'गंगापूर']
};

// Demo supervisors. Password defaults to the employee id when blank.
const SAMPLE_EMPLOYEES = [
  { id: '1001', name: 'राजेश पाटील',   pw: '', active: 1 },
  { id: '1002', name: 'सुनिल देशमुख',  pw: '', active: 1 },
  { id: '1003', name: 'अनिता जाधव',    pw: '', active: 1 }
];

function seed() {
  // REAL data first: if data/locations.csv / data/employees.csv exist they are
  // imported (upsert) on every boot — commit those files and skip the samples.
  const { importCsvIfPresent } = require('./import');
  const imported = importCsvIfPresent();

  if (!imported) {
    // No CSVs anywhere → fall back to demo samples so the app runs instantly.
    const insLoc = db.prepare('INSERT OR IGNORE INTO locations (district, station) VALUES (?, ?)');
    const insEmp = db.prepare('INSERT OR IGNORE INTO employees (employee_id, name, password, active) VALUES (?, ?, ?, ?)');
    const tx = db.transaction(() => {
      Object.keys(SAMPLE_LOCATIONS).forEach((d) => {
        SAMPLE_LOCATIONS[d].forEach((s) => insLoc.run(d, s));
      });
      SAMPLE_EMPLOYEES.forEach((e) => insEmp.run(e.id, e.name, e.pw, e.active));
    });
    tx();
  } else {
    console.log('[seed] imported from CSV — locations rows: %d, employees rows: %d',
      imported.locations, imported.employees);
  }

  const locN = db.prepare('SELECT COUNT(*) c FROM locations').get().c;
  const empN = db.prepare('SELECT COUNT(*) c FROM employees').get().c;
  return { locations: locN, employees: empN };
}

module.exports = seed;

// Allow `node seed.js` to (re)seed manually.
if (require.main === module) {
  const r = seed();
  console.log('[seed] locations=%d employees=%d', r.locations, r.employees);
}
