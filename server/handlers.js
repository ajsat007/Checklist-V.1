/* =====================================================================
   handlers.js — one function per client `fn`, mirroring the old Code.gs
   signatures and JSON return shapes. Each returns a plain object; the
   /exec dispatcher JSON-stringifies it (the client does JSON.parse).
   ===================================================================== */
'use strict';

const db  = require('./db');
const cfg = require('./checklist-config');
const { CHECKLIST_META, CHECKLIST_TITLES, FALLBACK_QUESTIONS, STATUS } = cfg;
// Write-through to the Google Sheet (durable store). All three are no-ops when
// the SHEET_ID / GOOGLE_SA_* env vars are absent, and they run on a background
// queue — the HTTP response never waits for the Sheets API.
const { mirrorInsert, mirrorUpdate, mirrorDelete } = require('./sheet-sync');

/* ---------- small utilities ---------- */

function _s(v) { return String(v == null ? '' : v).trim().replace(/[<>]/g, ''); }

function _istParts(d) {
  d = d || new Date();
  const date = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d);
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(d);
  return { date: date, time: time, full: date + ' ' + time };
}
function _todayISO() {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function _isoToDDMM(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return '';
  const p = iso.split('-'); return p[2] + '/' + p[1] + '/' + p[0];
}
function _ddmmToISO(d) {
  if (!d) return '';
  const p = String(d).split(' ')[0].split('/'); if (p.length !== 3) return '';
  return p[2] + '-' + p[1] + '-' + p[0];
}

/* Devanagari → Latin (ported from _devToLatin) for token area codes */
const _DEV_MAP = {
  'अ':'A','आ':'AA','इ':'I','ई':'I','उ':'U','ऊ':'U','ऋ':'RU','ए':'E','ऐ':'AI','ओ':'O','औ':'AU','अं':'AN','अः':'AH',
  'क':'K','ख':'KH','ग':'G','घ':'GH','ङ':'NG','च':'CH','छ':'CHH','ज':'J','झ':'JH','ञ':'NY',
  'ट':'T','ठ':'TH','ड':'D','ढ':'DH','ण':'N','त':'T','थ':'TH','द':'D','ध':'DH','न':'N',
  'प':'P','फ':'PH','ब':'B','भ':'BH','म':'M','य':'Y','र':'R','ल':'L','व':'V','श':'SH','ष':'SH','स':'S','ह':'H',
  'ळ':'L','क्ष':'KSH','ज्ञ':'DNY','ा':'A','ि':'I','ी':'I','ु':'U','ू':'U','े':'E','ै':'AI','ो':'O','ौ':'AU','ृ':'RU',
  '्':'','ं':'N','ः':'H','ँ':'N','़':''
};
function _devToLatin(text) {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const two = text.substr(i, 2);
    if (_DEV_MAP[two] !== undefined) { out += _DEV_MAP[two]; i++; continue; }
    const ch = text.charAt(i);
    out += (_DEV_MAP[ch] !== undefined) ? _DEV_MAP[ch] : (/[A-Za-z0-9 ]/.test(ch) ? ch : '');
  }
  return out;
}
function _toAreaCode(text, len) {
  if (!text) return 'NA';
  let latin = String(text).trim().toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (!latin) latin = _devToLatin(String(text)).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (!latin) return 'NA';
  const words = latin.split(/\s+/).filter(Boolean);
  let code;
  if (words.length >= len) code = words.map(w => w.charAt(0)).join('');
  else {
    const w0 = words[0];
    const dense = w0.charAt(0) + w0.slice(1).replace(/[AEIOU]/g, '');
    code = (dense.length >= len) ? dense : w0;
  }
  code = code.replace(/[^A-Z0-9]/g, '');
  if (code.length < len) code = code + 'XXXX';
  return code.slice(0, len) || 'NA';
}
function _nextToken(dist, stn) {
  const dc = _toAreaCode(dist, 3), sc = _toAreaCode(stn, 4);
  const code = dc + '_' + sc;
  const row = db.prepare('SELECT seq FROM token_counters WHERE code=?').get(code);
  const n = (row ? row.seq : 0) + 1;
  db.prepare('INSERT INTO token_counters(code,seq) VALUES(?,?) ON CONFLICT(code) DO UPDATE SET seq=excluded.seq').run(code, n);
  return 'MSRTC-' + dc + '-' + sc + '-' + String(n).padStart(4, '0');
}
function _genSessionId() {
  return 'SES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
}

function _log(action, sessionId, details) {
  try {
    db.prepare('INSERT INTO audit_log(ts,action,session_id,details) VALUES(?,?,?,?)')
      .run(_istParts().full, action, sessionId || '', details ? JSON.stringify(details) : '');
  } catch (e) { /* non-fatal */ }
}

const REPORT_BASE = '/report/';
function _pdfUrl(sessionId) { return REPORT_BASE + encodeURIComponent(sessionId); }

/* ---------- session row helpers ---------- */

const _selSession = db.prepare('SELECT * FROM sessions WHERE session_id=?');
function _getSession(id) { return _selSession.get(String(id)); }

function _parseJSON(s, fallback) { try { const v = JSON.parse(s || ''); return v == null ? fallback : v; } catch (e) { return fallback; } }

function _sanitizeRemarks(r) {
  const out = {}; if (!r) return out;
  Object.keys(r).forEach(k => { let v = String(r[k] || '').trim(); if (v.length > 300) v = v.slice(0, 300); if (v) out[k] = v; });
  return out;
}
function _normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/* Create the session row if it doesn't exist; returns the row. Mirrors
   _ensureSessionRow: server generates the real sequential token; supports
   backdated entries (client sends date as yyyy-MM-dd). */
function _ensureSessionRow(payload, defaultStatus, defaultTotalShifts) {
  let row = payload.sessionId ? _getSession(payload.sessionId) : null;
  if (row) return row;

  const sessionId = payload.sessionId || _genSessionId();
  const iso = (payload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))) ? String(payload.date) : _todayISO();
  const nowT = _istParts();
  const createdDate = _isoToDDMM(iso) || nowT.date;
  const createdTime = createdDate + ' ' + nowT.time;
  const key = _s(payload.checklistKey);
  const label = payload.checklist || CHECKLIST_TITLES[key] || (CHECKLIST_META[key] || {}).label || key;
  const tokenId = _nextToken(payload.dist, payload.stn);

  db.prepare(`INSERT INTO sessions
    (session_id, token_id, district, station, supervisor_name, employee_id,
     checklist_type, checklist_key, created_time, created_date, date_iso,
     last_updated, completed_shifts, total_buses, status, total_shifts, pdf_url, shifts_json, buses_json)
    VALUES (@session_id,@token_id,@district,@station,@supervisor_name,@employee_id,
     @checklist_type,@checklist_key,@created_time,@created_date,@date_iso,
     @last_updated,0,0,@status,@total_shifts,'','[]','[]')`).run({
    session_id: sessionId, token_id: tokenId,
    district: _s(payload.dist), station: _s(payload.stn),
    supervisor_name: _s(payload.name), employee_id: _s(payload.id),
    checklist_type: _s(label), checklist_key: key,
    created_time: createdTime, created_date: createdDate, date_iso: iso,
    last_updated: nowT.full, status: defaultStatus || STATUS.IN_PROCESS,
    total_shifts: defaultTotalShifts || 0
  });
  _log('SESSION_CREATE', sessionId, { key: key, stn: payload.stn });
  const created = _getSession(sessionId);
  mirrorInsert(created);   // durable copy in the Google Sheet (async, non-blocking)
  return created;
}

function _unitsForKey(key) {
  const m = CHECKLIST_META[key] || {};
  if (m.mode === 'bus') return [];
  if (m.mode === 'week') return cfg.WEEKS;
  if (m.mode === 'single') return ['एकदा'];
  return cfg.SHIFTS;
}

/* ---------- handlers ---------- */

const H = {};

H.getBootData = function () {
  const rows = db.prepare('SELECT district, station FROM locations ORDER BY district, station').all();
  const districts = {};
  rows.forEach(r => { (districts[r.district] = districts[r.district] || []).push(r.station); });
  return { districts: districts, employees: [], questions: FALLBACK_QUESTIONS };
};

H.getDistrictData = function () { return H.getBootData().districts; };

H.loginSupervisor = function (empId, password) {
  const id = _s(empId), pw = String(password || '').trim();
  if (!id) return { ok: false, code: 'EMPTY_ID', msg: '❌ कर्मचारी आयडी आवश्यक आहे.' };
  if (!/^\d+$/.test(id)) return { ok: false, code: 'BAD_ID', msg: '❌ कर्मचारी आयडी फक्त संख्या असावा.' };
  const e = db.prepare('SELECT * FROM employees WHERE employee_id=?').get(id);
  if (!e) return { ok: false, code: 'NOT_FOUND', msg: '❌ कर्मचारी आयडी "' + id + '" आढळला नाही.' };
  if (!e.active) return { ok: false, code: 'INACTIVE', msg: '❌ हे खाते सक्रिय नाही.' };
  const expected = (e.password && String(e.password).trim()) ? String(e.password).trim() : id;
  if (pw && pw !== expected) return { ok: false, code: 'BAD_PW', msg: '❌ पासवर्ड चुकीचा आहे.' };
  _log('LOGIN', '', { id: id });
  return { ok: true, employee: { id: id, name: e.name }, msg: '✅ लॉगिन यशस्वी.' };
};

H.lookupSupervisorName = function (empId) {
  const id = _s(empId);
  if (!id) return { ok: false, msg: 'ID required' };
  const e = db.prepare('SELECT * FROM employees WHERE employee_id=?').get(id);
  if (!e || !e.active) return { ok: false, id: id, msg: 'आढळला नाही' };
  return { ok: true, id: id, name: e.name };
};

H.getEmployeeStats = function (empId) {
  const id = _s(empId);
  const total = db.prepare('SELECT COUNT(*) c FROM sessions WHERE employee_id=?').get(id).c;
  const withPdf = db.prepare("SELECT COUNT(*) c FROM sessions WHERE employee_id=? AND status=?").get(id, STATUS.COMPLETED).c;
  return { ok: true, total: total, withPdf: withPdf };
};

H.checkChecklistCompletedToday = function (empId, station, checklistKey, checkDate) {
  const iso = (checkDate && /^\d{4}-\d{2}-\d{2}$/.test(String(checkDate))) ? String(checkDate) : _todayISO();
  const dd = _isoToDDMM(iso);
  const m = CHECKLIST_META[checklistKey] || {};
  if (m.mode === 'bus') return { completed: false };
  const r = db.prepare(`SELECT * FROM sessions WHERE employee_id=? AND station=? AND checklist_key=? AND status=? AND created_date=? LIMIT 1`)
    .get(_s(empId), _s(station), _s(checklistKey), STATUS.COMPLETED, dd);
  if (!r) return { completed: false };
  const shifts = _parseJSON(r.shifts_json, []);
  return { completed: true, date: dd, unitsDone: r.completed_shifts || shifts.length, unitsTotal: r.total_shifts || _unitsForKey(checklistKey).length, sessionId: r.session_id, tokenId: r.token_id, msg: 'ही चेकलिस्ट आज आधीच पूर्ण झाली आहे.' };
};

H.createSession = function (payload) {
  payload = payload || {};
  if (!payload.dist || !payload.stn || !payload.name || !payload.id) return { ok: false, msg: 'अपूर्ण माहिती.' };
  const key = _s(payload.checklistKey);
  if (!CHECKLIST_META[key]) return { ok: false, msg: 'अवैध चेकलिस्ट प्रकार.' };
  const m = CHECKLIST_META[key];
  const iso = (payload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))) ? String(payload.date) : _todayISO();
  if (m.mode !== 'bus') {
    const done = H.checkChecklistCompletedToday(payload.id, payload.stn, key, payload.date);
    if (done.completed) { _log('DUPLICATE_BLOCKED', '', { stn: payload.stn, key: key }); return { ok: false, completedToday: true, info: done }; }
  }
  // Auto-resume: if an in-progress session exists for same employee+station+checklist+date, return it
  const existing = db.prepare(
    "SELECT * FROM sessions WHERE employee_id=? AND station=? AND checklist_key=? AND status!=? AND created_date=? ORDER BY session_id DESC LIMIT 1"
  ).get(_s(payload.id), _s(payload.stn), key, STATUS.COMPLETED, _isoToDDMM(iso));
  if (existing) {
    return { ok: true, sessionId: existing.session_id, tokenId: existing.token_id, mode: m.mode, resumed: true,
      completedBuses: _parseJSON(existing.buses_json, []), completedShifts: _parseJSON(existing.shifts_json, []) };
  }
  const total = (m.mode === 'shift') ? ((payload.totalShifts === 4 || payload.totalShifts === 6) ? payload.totalShifts : 6) : _unitsForKey(key).length;
  const row = _ensureSessionRow(payload, STATUS.IN_PROCESS, total);
  return { ok: true, sessionId: row.session_id, tokenId: row.token_id, mode: m.mode,
    completedBuses: _parseJSON(row.buses_json, []), completedShifts: _parseJSON(row.shifts_json, []) };
};

/* Merge shifts (replace by shiftName) into shifts_json. */
function _mergeShifts(sessionId, shifts) {
  const row = _getSession(sessionId); if (!row) return null;
  const byName = {};
  _parseJSON(row.shifts_json, []).forEach(u => { if (u && u.shiftName) byName[_normUnit(u.shiftName)] = u; });
  (shifts || []).forEach(s => {
    if (!s || !s.shiftName) return;
    const ans = s.answers || {};
    byName[_normUnit(s.shiftName)] = {
      shiftName: s.shiftName,
      questions: (s.questions && s.questions.length) ? s.questions : Object.keys(ans),
      answers: ans, remarks: _sanitizeRemarks(s.remarks)
    };
  });
  const merged = Object.keys(byName).map(k => byName[k]);
  db.prepare('UPDATE sessions SET shifts_json=?, last_updated=? WHERE session_id=?')
    .run(JSON.stringify(merged), _istParts().full, sessionId);
  return merged;
}

H.submitAllShifts = function (payload) {
  payload = payload || {};
  if (!payload.id || !payload.checklistKey || !Array.isArray(payload.shifts)) return { ok: false, msg: 'अपूर्ण डेटा.' };
  const key = _s(payload.checklistKey);
  if (!CHECKLIST_META[key]) return { ok: false, msg: 'अवैध चेकलिस्ट प्रकार.' };

  // completed-today gate — block only a DIFFERENT already-completed session
  const done = H.checkChecklistCompletedToday(payload.id, payload.stn, key, payload.date);
  if (done.completed && done.sessionId && done.sessionId !== payload.sessionId) {
    return { ok: false, completedToday: true, info: done };
  }

  const shifts = payload.shifts.filter(s => s && s.shiftName);
  const isShiftMode = CHECKLIST_META[key].mode === 'shift';
  const expectedTotal = isShiftMode ? (payload.totalShifts === 4 || payload.totalShifts === 6 ? payload.totalShifts : 6) : _unitsForKey(key).length;
  if (isShiftMode && shifts.length < expectedTotal) {
    return { ok: false, msg: 'सर्व ' + expectedTotal + ' पाळ्या भरणे आवश्यक आहे. फक्त ' + shifts.length + ' भरलेल्या आहेत.' };
  }
  const row = _ensureSessionRow(payload, STATUS.IN_PROCESS, expectedTotal);
  _mergeShifts(row.session_id, shifts);
  const merged = _parseJSON(_getSession(row.session_id).shifts_json, []);
  const totalShifts = Math.max(row.total_shifts || 0, merged.length, expectedTotal);
  db.prepare('UPDATE sessions SET completed_shifts=?, total_shifts=?, status=?, pdf_url=?, last_updated=? WHERE session_id=?')
    .run(merged.length, totalShifts, STATUS.COMPLETED, _pdfUrl(row.session_id), _istParts().full, row.session_id);
  _log('FINALIZE', row.session_id, { shifts: merged.length });
  mirrorUpdate(_getSession(row.session_id));   // push final state to the Sheet
  return { ok: true, tokenId: row.token_id, pdfUrl: _pdfUrl(row.session_id) };
};
H.submitFullChecklist = H.submitAllShifts;

/* Save/replace one bus (append when isRepeat). */
function _saveBus(sessionId, busNumber, answers, remarks, isRepeat, originalBusNumber) {
  const row = _getSession(sessionId); if (!row) return null;
  const buses = _parseJSON(row.buses_json, []);
  const entry = { busNumber: busNumber, answers: answers || {}, remarks: _sanitizeRemarks(remarks) };
  if (isRepeat) {
    buses.push(entry);
  } else {
    const target = _normUnit(originalBusNumber || busNumber);
    const idx = buses.findIndex(b => b && _normUnit(b.busNumber) === target);
    if (idx >= 0) buses[idx] = entry; else buses.push(entry);
  }
  db.prepare('UPDATE sessions SET buses_json=?, total_buses=?, last_updated=? WHERE session_id=?')
    .run(JSON.stringify(buses), buses.length, _istParts().full, sessionId);
  // Diagnostic trace
  _log('BUS_SAVED', sessionId, { bus: busNumber, totalSave: buses.length, repeat: !!isRepeat });
  return buses;
}

H.saveBusEntry = function (payload) {
  payload = payload || {};
  if (!payload.id || !payload.busNumber || !payload.answers) return { ok: false, msg: 'अपूर्ण डेटा.' };
  const key = _s(payload.checklistKey);
  if (!CHECKLIST_META[key]) return { ok: false, msg: 'अवैध चेकलिस्ट प्रकार.' };
  const row = _ensureSessionRow(payload, STATUS.IN_PROCESS, 0);
  const buses = _saveBus(row.session_id, _s(payload.busNumber), payload.answers, payload.remarks, !!payload.isRepeat);
  _log('BUS_SAVE', row.session_id, { bus: payload.busNumber, total: buses.length });
  mirrorUpdate(_getSession(row.session_id));   // push latest buses to the Sheet
  return { ok: true, sessionId: row.session_id, tokenId: row.token_id, totalBuses: buses.length };
};
H.saveBus = H.saveBusEntry;

H.finalizeBusSession = function (payload) {
  payload = payload || {};
  const row = payload.sessionId ? _getSession(payload.sessionId) : null;
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  const buses = _parseJSON(row.buses_json, []);
  db.prepare('UPDATE sessions SET status=?, total_buses=?, pdf_url=?, last_updated=? WHERE session_id=?')
    .run(STATUS.COMPLETED, buses.length, _pdfUrl(row.session_id), _istParts().full, row.session_id);
  _log('FINALIZE', row.session_id, { buses: buses.length });
  mirrorUpdate(_getSession(row.session_id));   // push Completed status to the Sheet
  return { ok: true, pdfUrl: _pdfUrl(row.session_id) };
};
H.finalizeInspection = H.finalizeBusSession;

H.updateUnitAnswers = function (payload) {
  payload = payload || {};
  const row = payload.sessionId ? _getSession(payload.sessionId) : null;
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (payload.id && row.employee_id && String(row.employee_id) !== String(payload.id).trim())
    return { ok: false, msg: 'हे सत्र तुमचे नाही.' };

  if (payload.mode === 'bus') {
    _saveBus(row.session_id, _s(payload.unitName), payload.answers, payload.remarks, false, payload.originalUnitName);
  } else {
    _mergeShifts(row.session_id, [{ shiftName: payload.unitName, answers: payload.answers, remarks: payload.remarks }]);
    // if renamed shift (rare), drop the old name
    if (payload.originalUnitName && _normUnit(payload.originalUnitName) !== _normUnit(payload.unitName)) {
      const cur = _parseJSON(_getSession(row.session_id).shifts_json, []).filter(u => _normUnit(u.shiftName) !== _normUnit(payload.originalUnitName));
      db.prepare('UPDATE sessions SET shifts_json=? WHERE session_id=?').run(JSON.stringify(cur), row.session_id);
    }
  }
  db.prepare('UPDATE sessions SET pdf_url=?, last_updated=? WHERE session_id=?').run(_pdfUrl(row.session_id), _istParts().full, row.session_id);
  mirrorUpdate(_getSession(row.session_id));   // push edited answers to the Sheet
  return { ok: true, pdfUrl: _pdfUrl(row.session_id) };
};

H.editShift = function (payload) {
  payload = payload || {};
  return H.updateUnitAnswers({ sessionId: payload.sessionId, unitName: payload.shiftName, mode: 'shift', id: payload.id, answers: payload.answers, remarks: payload.remarks, originalUnitName: payload.originalShiftName });
};
H.editBus = function (payload) {
  payload = payload || {};
  return H.updateUnitAnswers({ sessionId: payload.sessionId, unitName: payload.busNumber, mode: 'bus', id: payload.id, answers: payload.answers, remarks: payload.remarks, originalUnitName: payload.originalBusNumber });
};

H.deleteSession = function (sessionId, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (requestingEmpId && row.employee_id && String(row.employee_id) !== String(requestingEmpId).trim())
    return { ok: false, msg: 'हे सत्र तुमचे नाही.' };
  db.prepare('DELETE FROM sessions WHERE session_id=?').run(String(sessionId));
  _log('DELETE', sessionId, {});
  mirrorDelete(String(sessionId));   // clear the row in the Sheet too
  return { ok: true, msg: '🗑 अहवाल हटवला.' };
};

H.deleteBusEntry = function (sessionId, busIndex, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (requestingEmpId && row.employee_id && String(row.employee_id) !== String(requestingEmpId).trim())
    return { ok: false, msg: 'हे सत्र तुमचे नाही.' };
  const buses = _parseJSON(row.buses_json, []);
  const idx = parseInt(busIndex, 10);
  if (isNaN(idx) || idx < 0 || idx >= buses.length) return { ok: false, msg: 'अवैध बस क्रमांक.' };
  const removed = buses.splice(idx, 1)[0];
  db.prepare('UPDATE sessions SET buses_json=?, total_buses=?, last_updated=? WHERE session_id=?')
    .run(JSON.stringify(buses), buses.length, _istParts().full, sessionId);
  _log('BUS_DELETE', sessionId, { bus: removed.busNumber, remaining: buses.length });
  mirrorUpdate(_getSession(sessionId));
  return { ok: true, remaining: buses.length, msg: '🗑 बस ' + (removed.busNumber || '') + ' हटवली.' };
};

H.fixPartialShiftSessions = function () {
  const shiftKeys = [];
  for (const k in CHECKLIST_META) { if (CHECKLIST_META[k].mode === 'shift') shiftKeys.push(k); }
  const ph = shiftKeys.map(() => '?').join(',');
  const rows = db.prepare(
    `SELECT * FROM sessions WHERE status='Completed' AND checklist_key IN (${ph}) AND total_shifts IN (1,2,3,5)`
  ).all(...shiftKeys);
  if (!rows.length) return { ok: true, fixed: 0, msg: 'कोणतेही अपूर्ण सत्र आढळले नाही.' };
  const updated = [];
  for (const row of rows) {
    db.prepare('UPDATE sessions SET status=?, last_updated=? WHERE session_id=?')
      .run('In Process', _istParts().full, row.session_id);
    mirrorUpdate(_getSession(row.session_id));
    updated.push({ id: row.session_id, district: row.district, station: row.station, shifts: row.completed_shifts + '/' + row.total_shifts });
  }
  _log('FIX_PARTIAL_SHIFTS', 'BATCH', { count: updated.length });
  return { ok: true, fixed: updated.length, sessions: updated, msg: updated.length + ' सत्रे "In Process" मध्ये बदलली.' };
};

function _sessionIdentity(row) {
  return {
    sessionId: row.session_id, tokenId: row.token_id,
    checklistKey: row.checklist_key, mode: (CHECKLIST_META[row.checklist_key] || {}).mode || 'shift',
    dist: row.district, stn: row.station, name: row.supervisor_name, id: row.employee_id,
    checklist: row.checklist_type, date: row.date_iso || _ddmmToISO(row.created_date),
    completedShifts: _parseJSON(row.shifts_json, []), completedBuses: _parseJSON(row.buses_json, [])
  };
}

H.getSessionForEdit = function (sessionId, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (requestingEmpId && row.employee_id && String(row.employee_id) !== String(requestingEmpId).trim())
    return { ok: false, msg: 'हे सत्र तुमचे नाही.' };
  return Object.assign({ ok: true }, _sessionIdentity(row));
};

H.resumeSession = function (sessionId, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (requestingEmpId && row.employee_id && String(row.employee_id) !== String(requestingEmpId).trim())
    return { ok: false, msg: 'हे सत्र तुमचे नाही.' };
  if (row.status === STATUS.COMPLETED) {
    // allow reopening to add more, mirror original by flipping to In Process
  }
  db.prepare('UPDATE sessions SET status=? WHERE session_id=?').run(STATUS.IN_PROCESS, row.session_id);
  mirrorUpdate(_getSession(row.session_id));   // keep Sheet status in step
  const id = _sessionIdentity(row);
  const totalUnits = row.total_shifts || _unitsForKey(row.checklist_key).length;
  return Object.assign({ ok: true }, id, {
    currentShiftIdx: id.completedShifts.length,
    totalUnits: totalUnits
  });
};

H.listIncompleteSessions = function (empId) {
  const rows = db.prepare("SELECT * FROM sessions WHERE employee_id=? AND status!=? ORDER BY session_id DESC LIMIT 100").all(_s(empId), STATUS.COMPLETED);
  return { ok: true, sessions: rows.map(_sessionIdentity) };
};

function _progressLabel(row) {
  const m = CHECKLIST_META[row.checklist_key] || {};
  if (m.mode === 'bus') return (row.total_buses || 0) + ' बस';
  const total = row.total_shifts || _unitsForKey(row.checklist_key).length;
  const suffix = m.mode === 'week' ? 'आठवडा' : (m.mode === 'single' ? 'पूर्ण' : 'पाळी(Shift)');
  return (row.completed_shifts || 0) + '/' + total + ' ' + suffix;
}

H.getSupervisorReports = function (empId, filterDate) {
  const id = _s(empId);
  if (!id) return { ok: false, msg: 'कर्मचारी आयडी आवश्यक आहे.' };
  let rows;
  if (filterDate && /^\d{4}-\d{2}-\d{2}$/.test(String(filterDate))) {
    rows = db.prepare('SELECT * FROM sessions WHERE employee_id=? AND created_date=? ORDER BY session_id DESC').all(id, _isoToDDMM(filterDate));
  } else {
    rows = db.prepare('SELECT * FROM sessions WHERE employee_id=? ORDER BY session_id DESC LIMIT 300').all(id);
  }
  const results = rows.map(r => {
    const t = String(r.created_time || '').split(' ');
    return {
      sessionId: r.session_id, tokenId: r.token_id, district: r.district, station: r.station,
      supervisor: r.supervisor_name, employeeId: r.employee_id, checklist: r.checklist_type,
      checklistKey: r.checklist_key, createdTime: r.created_time,
      dateDisp: t[0] || '', timeDisp: t[1] || '', progressLabel: _progressLabel(r),
      status: r.status, pdfUrl: r.pdf_url || ''
    };
  });
  return { ok: true, results: results, count: results.length, employee: { id: id, name: results.length ? results[0].supervisor : '' } };
};
H.getMyReports = H.getSupervisorReports;

/* माघील अहवाल — the logged-in supervisor's OWN history only, server-paged.
   (Privacy: a supervisor sees only their own reports.) Paging keeps it fast
   even for the busiest supervisors (300+ records). Returns one page plus
   total + chip counts + hasMore. Optional filters: date (yyyy-MM-dd),
   status ('done'|'todo'|'pdf'), and a free-text search over token/station. */
H.getMyReportsPaged = function (empId, filterDate, status, offset, search) {
  const id = _s(empId);
  if (!id) return { ok: false, msg: 'कर्मचारी आयडी आवश्यक आहे.' };
  const LIMIT = 100;
  offset = Math.max(0, parseInt(offset, 10) || 0);

  // Always scoped to this supervisor. Shared by both counts and the page query.
  const where = ['employee_id=?'], args = [id];
  if (filterDate && /^\d{4}-\d{2}-\d{2}$/.test(String(filterDate))) { where.push('created_date=?'); args.push(_isoToDDMM(filterDate)); }
  const sTerm = String(search || '').trim();
  if (sTerm) {
    const like = '%' + sTerm + '%';
    where.push('(token_id LIKE ? OR station LIKE ?)');
    args.push(like, like);
  }

  // Chip counts reflect the date/search filter but NOT the status chip
  // (so the user always sees how many done/todo/pdf exist within the filter).
  const baseSql = 'WHERE ' + where.join(' AND ');
  const c = db.prepare("SELECT COUNT(*) a, " +
    "SUM(CASE WHEN status='" + STATUS.COMPLETED + "' THEN 1 ELSE 0 END) d, " +
    "SUM(CASE WHEN status!='" + STATUS.COMPLETED + "' THEN 1 ELSE 0 END) t, " +
    "SUM(CASE WHEN pdf_url!='' THEN 1 ELSE 0 END) p FROM sessions " + baseSql).get(...args);

  // Page query adds the status filter.
  const pageWhere = where.slice(), pageArgs = args.slice();
  if (status === 'done') pageWhere.push("status='" + STATUS.COMPLETED + "'");
  else if (status === 'todo') pageWhere.push("status!='" + STATUS.COMPLETED + "'");
  else if (status === 'pdf') pageWhere.push("pdf_url!=''");
  const pageSql = pageWhere.length ? ('WHERE ' + pageWhere.join(' AND ')) : '';

  const total = db.prepare('SELECT COUNT(*) c FROM sessions ' + pageSql).get(...pageArgs).c;
  const rows = db.prepare('SELECT * FROM sessions ' + pageSql + ' ORDER BY session_id DESC LIMIT ? OFFSET ?')
    .all(...pageArgs, LIMIT, offset);

  const results = rows.map(r => {
    const t = String(r.created_time || '').split(' ');
    return {
      sessionId: r.session_id, tokenId: r.token_id, district: r.district, station: r.station,
      supervisor: r.supervisor_name, employeeId: r.employee_id, checklist: r.checklist_type,
      checklistKey: r.checklist_key, createdTime: r.created_time,
      dateDisp: t[0] || '', timeDisp: t[1] || '', progressLabel: _progressLabel(r),
      status: r.status, pdfUrl: r.pdf_url || ''
    };
  });

  return {
    ok: true, results: results, total: total, offset: offset, limit: LIMIT,
    hasMore: (offset + rows.length) < total,
    counts: { all: c.a || 0, done: c.d || 0, todo: c.t || 0, pdf: c.p || 0 }
  };
};

H.getReportFullDetail = function (sessionId, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'तपशील आढळले नाहीत.' };
  const m = CHECKLIST_META[row.checklist_key] || {};
  const qOrder = FALLBACK_QUESTIONS[row.checklist_key] || null;
  function toItems(ansObj, remObj) {
    ansObj = ansObj || {}; remObj = remObj || {};
    const keys = qOrder && qOrder.length ? qOrder.filter(q => ansObj[q] !== undefined) : Object.keys(ansObj);
    // include any answered questions not in the canonical list
    Object.keys(ansObj).forEach(q => { if (keys.indexOf(q) === -1) keys.push(q); });
    return keys.map(q => ({ q: q, answer: ansObj[q] || '', remark: remObj[q] || '' }));
  }
  let units = [];
  if (m.mode === 'bus') {
    units = _parseJSON(row.buses_json, []).map(b => ({ label: 'बस ' + b.busNumber, items: toItems(b.answers, b.remarks) }));
  } else {
    units = _parseJSON(row.shifts_json, []).map(s => ({ label: s.shiftName, items: toItems(s.answers, s.remarks) }));
  }
  return { ok: true, units: units, sessionId: row.session_id, mode: m.mode || 'shift' };
};
H.getSessionDetail = H.getReportFullDetail;

H.generateSessionPdf = function (sessionId, requestingEmpId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  if (!row.pdf_url) db.prepare('UPDATE sessions SET pdf_url=? WHERE session_id=?').run(_pdfUrl(sessionId), sessionId);
  return { ok: true, pdfUrl: _pdfUrl(sessionId) };
};
H.generatePdfNow = H.generateSessionPdf;
H.regeneratePDFForSession = H.generateSessionPdf;

H.getSessionPdf = function (sessionId) {
  const row = _getSession(sessionId);
  if (!row) return { ok: false, msg: 'सत्र आढळले नाही.' };
  return { ok: true, pdfUrl: _pdfUrl(sessionId) };
};

H.searchReports = function (token, bus, type, date, empId) {
  const clauses = [], args = [];
  if (empId) { clauses.push('employee_id=?'); args.push(_s(empId)); }
  if (token) { clauses.push('token_id LIKE ?'); args.push('%' + _s(token) + '%'); }
  if (type)  { clauses.push('checklist_key=?'); args.push(_s(type)); }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(String(date))) { clauses.push('created_date=?'); args.push(_isoToDDMM(date)); }
  const where = clauses.length ? ('WHERE ' + clauses.join(' AND ')) : '';
  let rows = db.prepare('SELECT * FROM sessions ' + where + ' ORDER BY session_id DESC LIMIT 300').all(...args);
  if (bus) {
    const b = _normUnit(bus);
    rows = rows.filter(r => _parseJSON(r.buses_json, []).some(x => _normUnit(x.busNumber).indexOf(b) !== -1));
  }
  const results = rows.map(r => ({
    sessionId: r.session_id, tokenId: r.token_id, station: r.station, supervisor: r.supervisor_name,
    employeeId: r.employee_id, checklistKey: r.checklist_key, status: r.status,
    pdfUrl: r.pdf_url || '', totalBuses: r.total_buses || 0, createdTime: r.created_time
  }));
  return { ok: true, results: results };
};
H.searchPastInspections = H.searchReports;

H.peekContinuationSession = function (station, checklistKey, empId) {
  const row = db.prepare("SELECT * FROM sessions WHERE station=? AND checklist_key=? AND employee_id=? AND status!=? ORDER BY session_id DESC LIMIT 1")
    .get(_s(station), _s(checklistKey), _s(empId), STATUS.COMPLETED);
  if (!row) return { found: false };
  return { found: true, sessionId: row.session_id, tokenId: row.token_id };
};

/* Fix all existing checklist_type values to match CHECKLIST_TITLES.
   Call after deploy to correct old data in DB and Sheet. */
H.fixChecklistTypes = function (syncSheet) {
  const fixes = [];
  for (const key in CHECKLIST_TITLES) {
    const correct = CHECKLIST_TITLES[key];
    const rows = db.prepare('SELECT DISTINCT checklist_type FROM sessions WHERE checklist_key=? AND checklist_type!=?').all(key, correct);
    rows.forEach(r => {
      const count = db.prepare("UPDATE sessions SET checklist_type=? WHERE checklist_key=? AND checklist_type=?").run(correct, key, r.checklist_type).changes;
      if (count > 0) fixes.push({ from: r.checklist_type, to: correct, key, count });
    });
  }
  // Also fix the 1 wr row that has gh's title
  const wrFix = db.prepare("UPDATE sessions SET checklist_type=? WHERE checklist_key='wr' AND checklist_type=?").run('प्रसाधनगृह स्वच्छता दैनंदिन तपासणी', 'विश्रांतीगृह स्वच्छता दैनंदिन तपासणी');
  if (wrFix.changes > 0) fixes.push({ from: 'विश्रांतीगृह स्वच्छता दैनंदिन तपासणी', to: 'प्रसाधनगृह स्वच्छता दैनंदिन तपासणी', key: 'wr', count: wrFix.changes });

  if (syncSheet && fixes.length) {
    // Re-sync all affected sessions to the Sheet
    const allKeys = [...new Set(fixes.map(f => f.key))];
    const pH = allKeys.map(() => '?').join(',');
    const sessions = db.prepare(`SELECT * FROM sessions WHERE checklist_key IN (${pH})`).all(...allKeys);
    let synced = 0;
    for (const s of sessions) {
      mirrorUpdate(s);
      synced++;
    }
    return { ok: true, fixed: fixes, totalSynced: synced };
  }
  return { ok: true, fixed: fixes };
};

module.exports = { H, _getSession, _parseJSON, _unitsForKey };
