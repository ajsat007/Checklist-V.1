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

/* =========== pdfmake sandbox (lazy init at first call) =========== */
const PDFMAKE_CODE = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pdfmake.min.js'), 'utf8');

function _buildSandbox() {
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
  // Warm up
  try {
    const w = ctx.pdfMake.createPdf(
      { pageSize: 'A4', content: [{ text: 'w', fontSize: 8 }], defaultStyle: { font: 'NotoSansDevanagari' } },
      null,
      { NotoSansDevanagari: { normal: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf', italics: 'NotoSansDevanagari-Regular.ttf', bolditalics: 'NotoSansDevanagari-Bold.ttf' } },
      { 'NotoSansDevanagari-Regular.ttf': FONT_REGULAR, 'NotoSansDevanagari-Bold.ttf': FONT_BOLD }
    );
    w.getBase64(function() { /* warm */ });
  } catch (_) { /* non-fatal */ }
  return ctx;
}

let SANDBOX = null;
function _getSandbox() {
  if (!SANDBOX) {
    if (!FONT_REGULAR || !FONT_BOLD) throw new Error('Font data not loaded');
    SANDBOX = _buildSandbox();
  }
  return SANDBOX;
}

/* =========== helpers =========== */
const DEV_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function mn(n) { return String(n == null ? 0 : n).replace(/[0-9]/g, function(d) { return DEV_DIGITS[+d]; }); }
function normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }
function _safeArray(val) { const a = _parseJSON(val, []); return Array.isArray(a) ? a : []; }

function _pc(text, opts) {
  if (text == null) text = '';
  var cell = { text: String(text) };
  if (opts) { for (var k in opts) cell[k] = opts[k]; }
  return cell;
}

function _ansCell(a) {
  if (!a) return _pc('', { alignment: 'center' });
  return _pc(a, {
    alignment: 'center', bold: true,
    color: a === 'होय' ? '#1a6b2e' : (a === 'नाही' ? '#b91c1c' : undefined),
  });
}

/* Grid table layout — ALL callbacks use regular function() NOT arrow functions
   because pdfmake checks arguments.length internally for grid line rendering. */
function _gridLayout() {
  return {
    hLineWidth: function() { return 0.55; },
    vLineWidth: function() { return 0.55; },
    hLineColor: function() { return '#555555'; },
    vLineColor: function() { return '#555555'; },
    fillColor: function(i) { return i === 0 ? '#e8ecf0' : null; },
    paddingLeft: function() { return 4; },
    paddingRight: function() { return 4; },
    paddingTop: function() { return 3; },
    paddingBottom: function() { return 3; },
  };
}

/* =========== Bus-mode table =========== */
function _pdfBusTable(row) {
  var questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  var buses = _safeArray(row.buses_json);
  var n = buses.length;
  var qCount = questions.length;

  // Proportional widths: '*' for question columns so they fill page width
  var isDense = n > 18 || qCount >= 6;
  var hFS = isDense ? 7 : 8;
  var rFS = isDense ? 7.5 : 8.5;
  var snFS = isDense ? 6.5 : 7.5;

  var widths = [16, 60];
  for (var i = 0; i < qCount; i++) widths.push('*');
  widths.push(28);

  var body = [];
  // Header row
  var hdr = [
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: hFS }),
    _pc('बस\nक्रमांक', { alignment: 'center', bold: true, fontSize: hFS }),
  ];
  for (var hi = 0; hi < questions.length; hi++) {
    hdr.push(_pc(questions[hi], { alignment: 'center', bold: true, fontSize: snFS }));
  }
  hdr.push(_pc('शेरा', { alignment: 'center', bold: true, fontSize: hFS }));
  body.push(hdr);

  // Data rows
  var seen = {};
  for (var bi = 0; bi < buses.length; bi++) {
    var b = buses[bi];
    var busNum = b && b.busNumber ? String(b.busNumber) : '';
    var nk = normUnit(busNum);
    seen[nk] = (seen[nk] || 0) + 1;
    var label = busNum + (seen[nk] > 1 ? ' (' + mn(seen[nk]) + ')' : '');

    var remarks = [];
    var remarkTexts = [];
    var cells = [
      _pc(mn(bi + 1), { alignment: 'center', fontSize: rFS }),
      _pc(label, { alignment: 'center', bold: true, fontSize: rFS, noWrap: true }),
    ];
    for (var qi = 0; qi < questions.length; qi++) {
      var q = questions[qi];
      var answers = b && b.answers ? b.answers : {};
      var remarksObj = b && b.remarks ? b.remarks : {};
      var a = answers[q] || '';
      var rm = remarksObj[q];
      if (rm) {
        var rmStr = String(rm);
        remarks.push(rmStr);
        if (remarkTexts.indexOf(rmStr) === -1) remarkTexts.push(rmStr);
      }
      cells.push(_ansCell(a));
    }
    // Dedup: if all same text, show once without Q-prefix; otherwise show unique texts with Q-prefix
    var displayRm = '';
    if (remarkTexts.length === 1) {
      displayRm = remarkTexts[0];
    } else if (remarks.length > 0) {
      var seen = [];
      for (var ri = 0; ri < remarks.length; ri++) {
        var label2 = 'Q' + mn(ri + 1) + ': ' + remarks[ri];
        if (seen.indexOf(label2) === -1) seen.push(label2);
      }
      displayRm = seen.join(', ');
    }
    cells.push(_pc(displayRm, { fontSize: 6, color: '#b91c1c', italics: true }));
    body.push(cells);
  }

  if (n === 0) {
    body.push([_pc('— नोंद नाही —', { colSpan: 3 + qCount, alignment: 'center', fontSize: 9 })]);
  }

  return {
    table: { widths: widths, body: body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: rFS,
  };
}

/* =========== Shift-mode table =========== */
function _pdfShiftTable(row) {
  var questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  var units = _safeArray(row.shifts_json);
  var present = [];
  for (var ui = 0; ui < units.length; ui++) {
    if (units[ui] && units[ui].shiftName) present.push(units[ui]);
  }
  var n = present.length;
  var widths = [22, '*'];
  for (var i = 0; i < n; i++) widths.push(Math.max(38, Math.min(56, 56 - n * 3)));
  widths.push(42);

  var body = [];
  var hdr = [
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
  ];
  for (var ui2 = 0; ui2 < present.length; ui2++) {
    hdr.push(_pc(present[ui2].shiftName, { alignment: 'center', bold: true, fontSize: 8 }));
  }
  hdr.push(_pc('शेरा', { alignment: 'center', bold: true, fontSize: 8 }));
  body.push(hdr);

  for (var qi2 = 0; qi2 < questions.length; qi2++) {
    var q2 = questions[qi2];
    var rawRm = [];
    var dedupRm = [];
    var cells2 = [
      _pc(mn(qi2 + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q2, { fontSize: 8.5 }),
    ];
    for (var ui3 = 0; ui3 < present.length; ui3++) {
      var u = present[ui3];
      var answers2 = u && u.answers ? u.answers : {};
      var remarksObj2 = u && u.remarks ? u.remarks : {};
      var a2 = answers2[q2] || '';
      var rm2 = remarksObj2[q2];
      if (rm2) {
        var rmStr = String(rm2);
        rawRm.push(rmStr);
        if (dedupRm.indexOf(rmStr) === -1) dedupRm.push(rmStr);
      }
      cells2.push(_ansCell(a2));
    }
    // Dedup: if all shifts have same remark text, show once; else show unique texts
    var displayRm2 = '';
    if (dedupRm.length === 1) {
      displayRm2 = dedupRm[0];
    } else if (rawRm.length > 0) {
      var seen2 = [];
      for (var si = 0; si < present.length; si++) {
        var shiftName = present[si].shiftName || '';
        if (shiftName && rawRm[si]) {
          var entry = shiftName + ': ' + rawRm[si];
          if (seen2.indexOf(entry) === -1) seen2.push(entry);
        }
      }
      displayRm2 = seen2.join(', ');
    }
    cells2.push(_pc(displayRm2, { fontSize: 7, color: '#b91c1c', italics: true }));
    body.push(cells2);
  }

  return {
    table: { widths: widths, body: body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: 8.5,
  };
}

/* =========== Single-mode table =========== */
function _pdfSingleTable(row) {
  var questions = FALLBACK_QUESTIONS[row.checklist_key] || [];
  var units = _safeArray(row.shifts_json);
  var unit = units[0] || {};

  var body = [[
    _pc('अ.क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
    _pc('काम केले\nआहे/नाही', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]];

  for (var qi = 0; qi < questions.length; qi++) {
    var q = questions[qi];
    var answers = unit.answers || {};
    var remarks = unit.remarks || {};
    var a = answers[q] || '';
    var rm = remarks[q] || '';
    body.push([
      _pc(mn(qi + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 }),
      _ansCell(a),
      _pc(String(rm), { fontSize: 7.5, color: '#b91c1c', italics: true }),
    ]);
  }

  return {
    table: { widths: [22, '*', 60, 50], body: body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: 8.5,
  };
}

/* =========== Penalty table =========== */
function _pdfPenaltyTable(key) {
  var list = PENALTIES[key] || [];
  var body = [[
    _pc('अ. क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
    _pc('दंडात्मक तरतूद', { bold: true, fontSize: 8.5 }),
    _pc('दंड रु.', { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]];
  for (var i = 0; i < list.length; i++) {
    var p = list[i];
    body.push([
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc((p.desc || '') + ' (रु.' + mn(p.amt || 0) + '/-)', { fontSize: 8.5 }),
      _pc('', { alignment: 'center' }),
    ]);
  }
  body.push([
    _pc('', {}),
    _pc('एकूण दंड रु.', { alignment: 'right', bold: true, fontSize: 8.5 }),
    _pc(mn(0), { alignment: 'center', bold: true, fontSize: 8.5 }),
  ]);
  return {
    table: { widths: [26, '*', 40], body: body },
    layout: _gridLayout(),
    margin: [0, 6, 0, 0],
  };
}

/* =========== Signature block =========== */
function _pdfSigBlock(key, row) {
  var s = SIG_LABELS[key] || {
    left: 'पर्यवेक्षक\nनाव\nस्वाक्षरी',
    right: 'स्थानक प्रमुख\nनाव\nस्वाक्षरी',
  };
  var leftName = row.supervisor_name || '';
  var leftId = row.employee_id || '';
  var leftTxt = (s.left || '')
    .replace('नाव-', 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : ''))
    .replace(/(^|\n)नाव(\n|$)/, function(m, a, b) {
      return a + 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : '') + b;
    });

  return {
    table: {
      widths: ['*', '*'],
      body: [[
        { text: String(leftTxt || '').split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5 },
        { text: String(s.right || '').split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5 },
      ]],
    },
    layout: {
      hLineWidth: function() { return 0.5; },
      vLineWidth: function() { return 0.5; },
      hLineColor: function() { return '#333'; },
      vLineColor: function() { return '#333'; },
      paddingLeft: function() { return 4; },
      paddingRight: function() { return 4; },
      paddingTop: function() { return 4; },
      paddingBottom: function() { return 4; },
    },
    margin: [0, 10, 0, 0],
  };
}

/* =========== Top-level document definition =========== */
function _buildDd(row) {
  var mode = (CHECKLIST_META[row.checklist_key] || {}).mode || 'shift';
  var title = CHECKLIST_TITLES[row.checklist_key] || row.checklist_type || '';
  var dateDisp = String(row.created_date || '').trim();
  var token = row.token_id || '';
  var timeDisp = row.created_time || '';
  var isBus = mode === 'bus';

  var headerStack = [
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
        hLineWidth: function() { return 0.5; },
        vLineWidth: function() { return 0.5; },
        hLineColor: function() { return '#999'; },
        vLineColor: function() { return '#999'; },
        paddingLeft: function() { return 3; },
        paddingRight: function() { return 3; },
        paddingTop: function() { return 2; },
        paddingBottom: function() { return 2; },
      },
      margin: [0, 0, 0, 4],
    },
    { text: title, style: 'title' },
  ];

  var contentBody;
  if (mode === 'bus')         contentBody = _pdfBusTable(row);
  else if (mode === 'single') contentBody = _pdfSingleTable(row);
  else                        contentBody = _pdfShiftTable(row);

  return {
    pageSize: 'A4',
    pageOrientation: isBus ? 'landscape' : undefined,
    pageMargins: isBus ? [12, 14, 12, 14] : [18, 18, 18, 18],
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
 * @param {object} [opts]
 * @param {number} [opts.timeoutMs]  Max ms (default 30000)
 * @param {number} [opts.retries]    Max retries (default 1)
 * @returns {Promise<Buffer>}
 */
async function generatePdf(sessionId, opts) {
  var timeoutMs = (opts && opts.timeoutMs) || 30000;
  var maxRetries = (opts && opts.retries != null) ? opts.retries : 1;

  for (var attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      var result = await _generateOnce(sessionId, timeoutMs);
      if (!Buffer.isBuffer(result) || result.length < 10) {
        throw new Error('Generated PDF invalid size (' + (result ? result.length : 0) + ' bytes)');
      }
      if (result.slice(0, 5).toString() !== '%PDF-') {
        throw new Error('Generated output not a valid PDF');
      }
      return result;
    } catch (err) {
      if (attempt >= maxRetries) throw err;
      console.warn('[pdf-gen] attempt ' + (attempt + 1) + ' failed for ' + sessionId + ': ' + err.message);
      await new Promise(function(r) { setTimeout(r, 1000 + attempt * 500); });
    }
  }
  throw new Error('PDF generation failed');
}

function _generateOnce(sessionId, timeoutMs) {
  return new Promise(function(resolve, reject) {
    var row = _getSession(sessionId);
    if (!row) return reject(new Error('Session not found: ' + sessionId));

    // Count validation: warn if total_buses column doesn't match actual JSON array length
    if (row.checklist_key === 'bw' || (CHECKLIST_META[row.checklist_key] || {}).mode === 'bus') {
      var _busesChk = _safeArray(row.buses_json);
      if (row.total_buses !== _busesChk.length) {
        console.warn('[pdf-gen] BUS COUNT MISMATCH for ' + (row.token_id || sessionId) + ': DB field says ' + row.total_buses + ' but JSON has ' + _busesChk.length + ' buses. Using actual JSON data.');
      }
    }

    var timedOut = false;
    var timer = setTimeout(function() {
      timedOut = true;
      reject(new Error('PDF generation timed out after ' + timeoutMs + 'ms'));
    }, timeoutMs);

    try {
      var dd = _buildDd(row);
      var fonts = {
        NotoSansDevanagari: {
          normal: 'NotoSansDevanagari-Regular.ttf',
          bold: 'NotoSansDevanagari-Bold.ttf',
          italics: 'NotoSansDevanagari-Regular.ttf',
          bolditalics: 'NotoSansDevanagari-Bold.ttf',
        },
      };
      var vfs = {
        'NotoSansDevanagari-Regular.ttf': FONT_REGULAR,
        'NotoSansDevanagari-Bold.ttf': FONT_BOLD,
      };

      var sandbox = _getSandbox();
      var doc = sandbox.pdfMake.createPdf(dd, null, fonts, vfs);

      doc.getBase64(function(data) {
        if (timedOut) return;
        clearTimeout(timer);
        try {
          resolve(Buffer.from(data, 'base64'));
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
