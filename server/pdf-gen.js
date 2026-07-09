/* =====================================================================
   pdf-gen.js — server-side PDF generation using pdfmake 0.2.12 in a
   VM sandbox (zero npm dependencies, fonts embedded as base64 at boot).
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const cfg = require('./checklist-config');
const { CHECKLIST_META, CHECKLIST_TITLES, FALLBACK_QUESTIONS, PENALTIES, SIG_LABELS, APP } = cfg;
const { _getSession, _parseJSON } = require('./handlers');

/* =========== fonts (base64, loaded once at boot) =========== */
const _FONT_DIR = path.resolve(__dirname, '..', 'public', 'fonts');
function _b64(name) {
  try { return fs.readFileSync(path.join(_FONT_DIR, name)).toString('base64'); }
  catch (e) { console.error('[pdf-gen] font load failed:', name, e.message); return ''; }
}
const FONT_REGULAR = _b64('NotoSansDevanagari-Regular.ttf') || _b64('NotoSansDevanagari-Regular.woff2') || '';
const FONT_BOLD   = _b64('NotoSansDevanagari-Bold.ttf')   || _b64('NotoSansDevanagari-Bold.woff2')   || '';

/* =========== pdfmake sandbox (warm once at boot) =========== */
const PDFMAKE_CODE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pdfmake.min.js'), 'utf8');

function _buildSandbox(ctxFontReg, ctxFontBold) {
  const sandbox = {};
  const GLOBALS = [
    'Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
    'Float32Array','Float64Array','ArrayBuffer','DataView','Blob','URL','TextEncoder','TextDecoder',
    'Object','Array','String','Number','Boolean','JSON','Math','Date','RegExp','Map','Set','Promise',
    'Symbol','parseInt','parseFloat','isNaN','isFinite',
    'encodeURI','encodeURIComponent','decodeURI','decodeURIComponent',
    'Error','TypeError','RangeError','ReferenceError','console','setTimeout','clearTimeout'
  ];
  GLOBALS.forEach(k => { if (globalThis[k]) sandbox[k] = globalThis[k]; });
  sandbox.module   = { exports: {} };
  sandbox.exports  = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  sandbox.self     = sandbox;
  sandbox.window   = sandbox;
  sandbox.document = { createElement: () => ({}), body: { appendChild: () => {} }, createElementNS: () => ({}) };
  sandbox.navigator = { userAgent: 'Node' };

  const ctx = vm.createContext(sandbox);
  vm.runInContext(PDFMAKE_CODE, ctx, { timeout: 15000 });

  // Warm up: generate a tiny doc so fontkit initialises
  const warmFonts = {
    NotoSansDevanagari: {
      normal: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf',
      italics: 'NotoSansDevanagari-Regular.ttf', bolditalics: 'NotoSansDevanagari-Bold.ttf',
    },
  };
  const warmVfs = {
    'NotoSansDevanagari-Regular.ttf': ctxFontReg,
    'NotoSansDevanagari-Bold.ttf': ctxFontBold,
  };
  try {
    ctx.pdfMake.createPdf(
      { pageSize: 'A4', content: [{ text: 'w', fontSize: 8 }], defaultStyle: { font: 'NotoSansDevanagari' } },
      null, warmFonts, warmVfs,
    ).getBase64(() => { /* warm */ });
  } catch (_) { /* warmup non-fatal */ }
  return ctx;
}

let SANDBOX = null;

/** Lazily initialise the sandbox so module-require never throws. */
function _getSandbox() {
  if (!SANDBOX) {
    if (!FONT_REGULAR || !FONT_BOLD) throw new Error('Font data not loaded — check public/fonts/');
    SANDBOX = _buildSandbox(FONT_REGULAR, FONT_BOLD);
  }
  return SANDBOX;
}

/* =========== helpers =========== */
const DEV_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function mn(n) {
  return String(n == null ? 0 : n).replace(/[0-9]/g, d => DEV_DIGITS[+d]);
}
function esc(s) {
  return String(s == null ? '' : s);
}
function normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/* Safely parse JSON array — never return non-array */
function _safeArray(val) {
  const arr = _parseJSON(val, []);
  return Array.isArray(arr) ? arr : [];
}

/* =========== pdfmake cell builder =========== */
function _pc(text, opts) {
  if (text == null) text = '';
  const cell = { text: String(text) };
  if (opts) Object.assign(cell, opts);
  return cell;
}

/* Answer cell with green/red colouring */
function _ansCell(a) {
  if (!a) return _pc('', { alignment: 'center' });
  return _pc(a, {
    alignment: 'center', bold: true,
    color: a === 'होय' ? '#1a6b2e' : (a === 'नाही' ? '#b91c1c' : undefined),
  });
}

/* Grid table layout for all tables — uses pdfmake default grid for borders
   (which draws proper all-around cell lines) plus header row fill. */
function _gridLayout() {
  return {
    // pdfmake default: grid lines on all sides, thin borders
    // We only override fillColor for header row; borders use default grid behavior
    fillColor: function(i) { return i === 0 ? '#e8ecf0' : null; },
    paddingLeft: function() { return 4; },
    paddingRight: function() { return 4; },
    paddingTop: function() { return 3; },
    paddingBottom: function() { return 3; },
    hLineWidth: function(i) { return i === 1 ? 1.0 : 0.55; },
    vLineWidth: function() { return 0.6; },
    hLineColor: function() { return '#444444'; },
    vLineColor: function() { return '#444444'; },
  };
}

/* =========== Bus-mode table =========== */
function _pdfBusTable(row) {
  const questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  const buses = _safeArray(row.buses_json);
  const n = buses.length;
  const qCount = questions.length;

  // Dynamically scale fonts/widths based on data volume
  const isDense = n > 18 || qCount >= 6;
  const hFS = isDense ? 6.5 : 7.5;
  const rFS = isDense ? 7 : 8;
  const colW = Math.min(36, Math.max(20, Math.floor(isDense ? 24 : 34)));
  const firstW = Math.min(16, Math.max(10, Math.floor(n >= 100 ? 12 : 14)));
  const busW  = Math.min(55, Math.max(38, Math.floor(n >= 100 ? 42 : 48)));

  const widths = [firstW, busW];
  for (let i = 0; i < qCount; i++) widths.push(colW);
  widths.push(Math.min(34, Math.max(22, colW + 4)));

  const body = [];
  // Header row
  body.push([
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: hFS }),
    _pc('बस क्रमांक', { alignment: 'center', bold: true, fontSize: hFS }),
    ...questions.map(q => _pc(q, { alignment: 'center', bold: true, fontSize: hFS })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: hFS }),
  ]);

  // Data rows
  const seen = {};
  (buses || []).forEach((b, idx) => {
    const busNum = b && b.busNumber ? String(b.busNumber) : '';
    const nk = normUnit(busNum);
    seen[nk] = (seen[nk] || 0) + 1;
    const label = busNum + (seen[nk] > 1 ? ' (' + mn(seen[nk]) + ')' : '');

    const remarks = [];
    const cells = [
      _pc(mn(idx + 1), { alignment: 'center', fontSize: rFS }),
      _pc(label, { alignment: 'center', bold: true, fontSize: rFS }),
    ];
    (questions || []).forEach((q, qi) => {
      const answers = b && b.answers ? b.answers : {};
      const remarksObj = b && b.remarks ? b.remarks : {};
      const a = answers[q] || '';
      const rm = remarksObj[q];
      if (rm) remarks.push(mn(qi + 1) + ': ' + String(rm));
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 6, color: '#b91c1c', italics: true }));
    body.push(cells);
  });

  if (!n) {
    body.push([_pc('— नोंद नाही —', { colSpan: 3 + qCount, alignment: 'center', fontSize: 9 })]);
  }

  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: rFS,
    // Dynamic table will auto-split across pages — no height cap needed
  };
}

/* =========== Shift-mode table =========== */
function _pdfShiftTable(row) {
  const questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  const units = _safeArray(row.shifts_json);
  const present = (units || []).filter(u => u && u.shiftName);
  const n = present.length;

  const widths = [22, '*'];
  for (let i = 0; i < n; i++) widths.push(Math.max(38, Math.min(56, 56 - n * 3)));
  widths.push(42);

  const body = [];
  body.push([
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
    ...present.map(u => _pc(u.shiftName, { alignment: 'center', bold: true, fontSize: 8 })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8 }),
  ]);

  questions.forEach((q, i) => {
    const remarks = [];
    const cells = [
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 }),
    ];
    present.forEach(u => {
      const answers = u && u.answers ? u.answers : {};
      const remarksObj = u && u.remarks ? u.remarks : {};
      const a = answers[q] || '';
      const rm = remarksObj[q];
      if (rm) remarks.push(mn(i + 1) + ': ' + String(rm));
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 7, color: '#b91c1c', italics: true }));
    body.push(cells);
  });

  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: 8.5,
  };
}

/* =========== Single-mode table =========== */
function _pdfSingleTable(row) {
  const questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  const units = _safeArray(row.shifts_json);
  const unit = units[0] || {};

  const body = [[
    _pc('अ.क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
    _pc('काम केले\nआहे/नाही', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]];

  questions.forEach((q, i) => {
    const answers = unit.answers || {};
    const remarks = unit.remarks || {};
    const a = answers[q] || '';
    const rm = remarks[q] || '';
    body.push([
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 }),
      _ansCell(a),
      _pc(String(rm), { fontSize: 7.5, color: '#b91c1c', italics: true }),
    ]);
  });

  return {
    table: { widths: [22, '*', 60, 50], body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: 8.5,
  };
}

/* =========== Penalty table =========== */
function _pdfPenaltyTable(key) {
  const list = PENALTIES[key] || [];
  const body = [[
    _pc('अ. क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
    _pc('दंडात्मक तरतूद', { bold: true, fontSize: 8.5 }),
    _pc('दंड रु.', { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]];
  (list || []).forEach((p, i) => {
    body.push([
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc((p.desc || '') + ' (रु.' + mn(p.amt || 0) + '/-)', { fontSize: 8.5 }),
      _pc('', { alignment: 'center' }),
    ]);
  });
  body.push([
    _pc('', {}),
    _pc('एकूण दंड रु.', { alignment: 'right', bold: true, fontSize: 8.5 }),
    _pc(mn(0), { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]);
  return {
    table: { widths: [26, '*', 40], body },
    layout: _gridLayout(),
    margin: [0, 6, 0, 0],
  };
}

/* =========== Signature block =========== */
function _pdfSigBlock(key, row) {
  const s = SIG_LABELS[key] || {
    left: 'पर्यवेक्षक\nनाव\nस्वाक्षरी',
    right: 'स्थानक प्रमुख\nनाव\nस्वाक्षरी',
  };
  const leftName = row.supervisor_name || '';
  const leftId   = row.employee_id || '';
  const leftTxt = (s.left || '')
    .replace('नाव-', 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : ''))
    .replace(/(^|\n)नाव(\n|$)/, (m, a, b) =>
      a + 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : '') + b);

  return {
    table: {
      widths: ['*', '*'],
      body: [[
        { text: String(leftTxt || '').split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5 },
        { text: String(s.right || '').split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5 },
      ]],
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#333', vLineColor: () => '#333',
      paddingLeft: () => 4, paddingRight: () => 4,
      paddingTop: () => 4, paddingBottom: () => 4,
    },
    margin: [0, 10, 0, 0],
  };
}

/* =========== Top-level document definition =========== */
function _buildDd(row) {
  const mode = (CHECKLIST_META[row.checklist_key] || {}).mode || 'shift';
  const title = CHECKLIST_TITLES[row.checklist_key] || row.checklist_type || '';
  const dateDisp = String(row.created_date || '').trim();
  const token = row.token_id || '';
  const timeDisp = row.created_time || '';
  const isBus = mode === 'bus';

  const headerStack = [
    { text: 'महाराष्ट्र राज्य मार्ग परिवहन महामंडळ', style: 'org' },
    { text: APP.APP_NAME, style: 'sub', margin: [0, 0, 0, 4] },
    {
      table: {
        widths: ['*', '*'],
        body: [
          [
            { text: 'विभाग- ' + (row.district || ''), fontSize: 9.5, margin: [3, 2, 3, 2] },
            { text: 'आगार- ________', fontSize: 9.5, alignment: 'right', margin: [3, 2, 3, 2] },
          ],
          [
            { text: 'बसस्थानक- ' + (row.station || ''), fontSize: 9.5, margin: [3, 2, 3, 2] },
            { text: 'दिनांक- ' + dateDisp, fontSize: 9.5, alignment: 'right', margin: [3, 2, 3, 2] },
          ],
        ],
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#999', vLineColor: () => '#999',
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 2, paddingBottom: () => 2,
      },
      margin: [0, 0, 0, 4],
    },
    { text: title, style: 'title' },
  ];

  let contentBody;
  if (mode === 'bus')         contentBody = _pdfBusTable(row);
  else if (mode === 'single') contentBody = _pdfSingleTable(row);
  else                        contentBody = _pdfShiftTable(row);

  return {
    pageSize: 'A4',
    pageOrientation: isBus ? 'landscape' : undefined,
    pageMargins: isBus ? [12, 14, 12, 14] : [18, 18, 18, 18],
    compress: true,
    defaultStyle: { font: 'NotoSansDevanagari', fontSize: isBus ? 8 : 9 },
    content: [
      ...headerStack,
      contentBody,
      _pdfPenaltyTable(row.checklist_key),
      _pdfSigBlock(row.checklist_key, row),
      { text: 'टोकन: ' + token + '  |  ' + APP.APP_NAME + '  |  ' + timeDisp, style: 'footer' },
    ],
    styles: {
      org:    { alignment: 'center', bold: true, fontSize: 13, margin: [0, 0, 0, 1] },
      sub:    { alignment: 'center', fontSize: 10, color: '#333' },
      title:  { alignment: 'center', bold: true, fontSize: 11, margin: [0, 4, 0, 6] },
      footer: { alignment: 'center', fontSize: 8, color: '#666', margin: [0, 8, 0, 0] },
    },
  };
}

/* =========== Public API =========== */

/**
 * Generate a PDF buffer for a session, with auto-retry and timeout.
 * @param {string} sessionId
 * @param {object} [opts]            Optional overrides.
 * @param {number} [opts.timeoutMs]  Max ms to wait (default 30 000).
 * @param {number} [opts.retries]    Max retries on failure (default 1).
 * @returns {Promise<Buffer>}
 */
async function generatePdf(sessionId, opts) {
  const timeoutMs = (opts && opts.timeoutMs) || 30000;
  const maxRetries = (opts && opts.retries != null) ? opts.retries : 1;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await _generateOnce(sessionId, timeoutMs);
      // Validate output
      if (!Buffer.isBuffer(result) || result.length < 10) {
        throw new Error('Generated PDF is too small (' + (result ? result.length : 0) + ' bytes)');
      }
      if (result.slice(0, 5).toString() !== '%PDF-') {
        throw new Error('Generated output is not a valid PDF (magic bytes mismatch)');
      }
      return result;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      console.warn('[pdf-gen] attempt ' + (attempt + 1) + '/' + (maxRetries + 1) + ' failed for ' + sessionId + ': ' + err.message);
      // Brief back-off before retry
      await new Promise(r => setTimeout(r, 1000 + attempt * 500));
    }
  }
  // Unreachable, but keeps TS happy
  throw new Error('PDF generation failed after ' + (maxRetries + 1) + ' attempts');
}

function _generateOnce(sessionId, timeoutMs) {
  return new Promise((resolve, reject) => {
    const row = _getSession(sessionId);
    if (!row) return reject(new Error('Session not found: ' + sessionId));

    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      reject(new Error('PDF generation timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    try {
      const dd = _buildDd(row);
      const fonts = {
        NotoSansDevanagari: {
          normal: 'NotoSansDevanagari-Regular.ttf',
          bold: 'NotoSansDevanagari-Bold.ttf',
          italics: 'NotoSansDevanagari-Regular.ttf',
          bolditalics: 'NotoSansDevanagari-Bold.ttf',
        },
      };
      const vfs = {
        'NotoSansDevanagari-Regular.ttf': FONT_REGULAR,
        'NotoSansDevanagari-Bold.ttf': FONT_BOLD,
      };

      const sandbox = _getSandbox();
      const doc = sandbox.pdfMake.createPdf(dd, null, fonts, vfs);

      doc.getBase64(function (data) {
        if (timedOut) return; // already rejected
        clearTimeout(timer);
        try {
          const buf = Buffer.from(data, 'base64');
          resolve(buf);
        } catch (e) { reject(e); }
      });
    } catch (e) {
      if (timedOut) return;
      clearTimeout(timer);
      reject(e);
    }
  });
}

module.exports = { generatePdf };
