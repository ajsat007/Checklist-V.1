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
const db = require('./db');

/* ---- font base64 ---- */
const _FONT_DIR = path.resolve(__dirname, '..', 'public', 'fonts');
function _b64(name) {
  try { return fs.readFileSync(path.join(_FONT_DIR, name)).toString('base64'); }
  catch (e) { console.error('[pdf-gen] font load failed:', name, e.message); return ''; }
}
const FONT_REGULAR = _b64('NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = _b64('NotoSansDevanagari-Bold.ttf');

/* ---- pdfmake sandbox (warm once at boot) ---- */
const SANDBOX = (() => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'pdfmake.min.js'), 'utf8');
  const sandbox = {};
  const globals = [
    'Uint8Array','Uint16Array','Uint32Array','Int8Array','Int16Array','Int32Array',
    'Float32Array','Float64Array','ArrayBuffer','DataView','Blob','URL','TextEncoder','TextDecoder',
    'Object','Array','String','Number','Boolean','JSON','Math','Date','RegExp','Map','Set','Promise',
    'Symbol','parseInt','parseFloat','isNaN','isFinite',
    'encodeURI','encodeURIComponent','decodeURI','decodeURIComponent',
    'Error','TypeError','RangeError','ReferenceError','console','setTimeout','clearTimeout'
  ];
  globals.forEach(k => { if (globalThis[k]) sandbox[k] = globalThis[k]; });
  sandbox.module = { exports: {} };
  sandbox.exports = sandbox.module.exports;
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.document = { createElement: () => ({}), body: { appendChild: () => {} }, createElementNS: () => ({}) };
  sandbox.navigator = { userAgent: 'Node' };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(code, ctx, { timeout: 15000 });
  // Warm up — generate a tiny doc so fontkit is initialized
  try {
    const warmDoc = ctx.pdfMake.createPdf(
      { pageSize: 'A4', content: [{ text: 'warmup', fontSize: 8 }], defaultStyle: { font: 'NotoSansDevanagari' } },
      null,
      { NotoSansDevanagari: { normal: 'NotoSansDevanagari-Regular.ttf', bold: 'NotoSansDevanagari-Bold.ttf', italics: 'NotoSansDevanagari-Regular.ttf', bolditalics: 'NotoSansDevanagari-Bold.ttf' } },
      { 'NotoSansDevanagari-Regular.ttf': FONT_REGULAR, 'NotoSansDevanagari-Bold.ttf': FONT_BOLD }
    );
    warmDoc.getBase64(() => {}); // async warmup — first real call loads font data
  } catch(e) { /* warmup failure non-fatal */ }
  return ctx;
})();

/* ---- helpers ---- */
const DEV_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function mn(n) { return String(n).replace(/[0-9]/g, d => DEV_DIGITS[+d]); }
function normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/* ---- pdfmake cell helper ---- */
function _pc(text, opts) {
  if (!text && text !== 0) text = '';
  const cell = { text: String(text) };
  if (opts) Object.assign(cell, opts);
  return cell;
}

/* Answer cell with green/red */
function _ansCell(a) {
  if (!a) return _pc('', { alignment: 'center' });
  return _pc(a, {
    alignment: 'center', bold: true,
    color: a === 'होय' ? '#1a6b2e' : (a === 'नाही' ? '#b91c1c' : undefined)
  });
}

/* Grid table layout */
function _gridLayout() {
  return {
    hLineWidth: () => 0.5, vLineWidth: () => 0.5,
    hLineColor: () => '#333', vLineColor: () => '#333',
    fillColor: (i) => i === 0 ? '#f0f2f5' : null,
    paddingLeft: () => 3, paddingRight: () => 3,
    paddingTop: () => 2, paddingBottom: () => 2
  };
}

/* Bus-mode table */
function _pdfBusTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const buses = _parseJSON(row.buses_json, []);
  const n = buses.length;
  const qCount = questions.length;
  const isDense = n > 15 || qCount >= 6;
  const colW = isDense ? 24 : 30;
  const hFS = isDense ? 6.5 : 7;
  const rFS = isDense ? 7 : 8;
  const widths = [14, 48];
  for (let i = 0; i < qCount; i++) widths.push(colW);
  widths.push(30);
  const body = [];
  body.push([
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: hFS }),
    _pc('बस क्रमांक', { alignment: 'center', bold: true, fontSize: hFS }),
    ...questions.map(q => _pc(q, { alignment: 'center', bold: true, fontSize: hFS })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: hFS })
  ]);
  const seen = {};
  (buses || []).forEach((b, idx) => {
    const nk = normUnit(b.busNumber);
    seen[nk] = (seen[nk] || 0) + 1;
    const label = (b.busNumber || '') + (seen[nk] > 1 ? ' (पुन्हा ' + mn(seen[nk]) + ')' : '');
    const remarks = [];
    const cells = [
      _pc(mn(idx + 1), { alignment: 'center', fontSize: rFS }),
      _pc(label, { alignment: 'center', bold: true, fontSize: rFS })
    ];
    questions.forEach((q, i) => {
      const a = (b.answers || {})[q] || '';
      const rm = (b.remarks || {})[q];
      if (rm) remarks.push(mn(i + 1) + ': ' + rm);
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 6, color: '#b91c1c', italics: true }));
    body.push(cells);
  });
  if (!buses.length) body.push([_pc('— नोंद नाही —', { colSpan: 3 + qCount, alignment: 'center', fontSize: 9 })]);
  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(), fontSize: rFS
  };
}

/* Shift-mode table */
function _pdfShiftTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const units = _parseJSON(row.shifts_json, []);
  const present = (units || []).filter(u => u && u.shiftName);
  const n = present.length;
  const widths = [22, '*'];
  for (let i = 0; i < n; i++) widths.push(Math.max(38, 56 - n * 3));
  widths.push(42);
  const body = [];
  body.push([
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
    ...present.map(u => _pc(u.shiftName, { alignment: 'center', bold: true, fontSize: 8 })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8 })
  ]);
  questions.forEach((q, i) => {
    const remarks = [];
    const cells = [
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 })
    ];
    present.forEach(u => {
      const a = (u.answers || {})[q] || '';
      const rm = (u.remarks || {})[q];
      if (rm) remarks.push(mn(i + 1) + ': ' + rm);
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 7, color: '#b91c1c', italics: true }));
    body.push(cells);
  });
  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(), fontSize: 8.5
  };
}

/* Single-mode table */
function _pdfSingleTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const unit = (_parseJSON(row.shifts_json, [])[0]) || { answers: {}, remarks: {} };
  const body = [
    [
      _pc('अ.क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
      _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
      _pc('काम केले\nआहे/नाही', { alignment: 'center', bold: true, fontSize: 8 }),
      _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8.5 })
    ]
  ];
  questions.forEach((q, i) => {
    const a = (unit.answers || {})[q] || '';
    const rm = (unit.remarks || {})[q] || '';
    body.push([
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 }),
      _ansCell(a),
      _pc(rm, { fontSize: 7.5, color: '#b91c1c', italics: true })
    ]);
  });
  return {
    table: { widths: [22, '*', 60, 50], body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(), fontSize: 8.5
  };
}

/* Penalty table */
function _pdfPenaltyTable(key) {
  const list = PENALTIES[key] || [];
  const body = [
    [
      _pc('अ. क्र.', { alignment: 'center', bold: true, fontSize: 8.5 }),
      _pc('दंडात्मक तरतूद', { bold: true, fontSize: 8.5 }),
      _pc('दंड रु.', { alignment: 'center', bold: true, fontSize: 8.5 })
    ]
  ];
  list.forEach((p, i) => {
    body.push([
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(p.desc + ' (रु.' + mn(p.amt) + '/-)', { fontSize: 8.5 }),
      _pc('', { alignment: 'center' })
    ]);
  });
  body.push([
    _pc('', {}),
    _pc('एकूण दंड रु.', { alignment: 'right', bold: true, fontSize: 8.5 }),
    _pc(mn(0), { alignment: 'center', bold: true, fontSize: 8.5 })
  ]);
  return {
    table: { widths: [26, '*', 40], body },
    layout: _gridLayout(), margin: [0, 6, 0, 0]
  };
}

/* Signature block */
function _pdfSigBlock(key, row) {
  const s = SIG_LABELS[key] || { left: 'पर्यवेक्षक\nनाव\nस्वाक्षरी', right: 'स्थानक प्रमुख\nनाव\nस्वाक्षरी' };
  const leftName = row.supervisor_name || '';
  const leftId = row.employee_id || '';
  const leftTxt = s.left
    .replace('नाव-', 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : ''))
    .replace(/(^|\n)नाव(\n|$)/, (m, a, b) => a + 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : '') + b);
  return {
    table: {
      widths: ['*', '*'],
      body: [[
        { text: leftTxt.split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5, height: 60 },
        { text: s.right.split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5, height: 60 }
      ]]
    },
    layout: {
      hLineWidth: () => 0.5, vLineWidth: () => 0.5,
      hLineColor: () => '#333', vLineColor: () => '#333',
      paddingLeft: () => 4, paddingRight: () => 4,
      paddingTop: () => 4, paddingBottom: () => 4
    },
    margin: [0, 10, 0, 0]
  };
}

/* ---- Top-level document definition ---- */
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
            { text: 'आगार- ________', fontSize: 9.5, alignment: 'right', margin: [3, 2, 3, 2] }
          ],
          [
            { text: 'बसस्थानक- ' + (row.station || ''), fontSize: 9.5, margin: [3, 2, 3, 2] },
            { text: 'दिनांक- ' + dateDisp, fontSize: 9.5, alignment: 'right', margin: [3, 2, 3, 2] }
          ]
        ]
      },
      layout: {
        hLineWidth: () => 0.5, vLineWidth: () => 0.5,
        hLineColor: () => '#999', vLineColor: () => '#999',
        paddingLeft: () => 3, paddingRight: () => 3,
        paddingTop: () => 2, paddingBottom: () => 2
      },
      margin: [0, 0, 0, 4]
    },
    { text: title, style: 'title' }
  ];

  let contentBody;
  if (mode === 'bus') contentBody = _pdfBusTable(row);
  else if (mode === 'single') contentBody = _pdfSingleTable(row);
  else contentBody = _pdfShiftTable(row);

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
      { text: 'टोकन: ' + token + '  |  ' + APP.APP_NAME + '  |  ' + timeDisp, style: 'footer' }
    ],
    styles: {
      org: { alignment: 'center', bold: true, fontSize: 13, margin: [0, 0, 0, 1] },
      sub: { alignment: 'center', fontSize: 10, color: '#333' },
      title: { alignment: 'center', bold: true, fontSize: 11, margin: [0, 4, 0, 6] },
      footer: { alignment: 'center', fontSize: 8, color: '#666', margin: [0, 8, 0, 0] }
    }
  };
}

/* ---- Public API ---- */

/**
 * Generate a PDF buffer for a session.
 * @param {string} sessionId
 * @returns {Promise<Buffer>}
 */
function generatePdf(sessionId) {
  return new Promise((resolve, reject) => {
    const row = _getSession(sessionId);
    if (!row) return reject(new Error('Session not found: ' + sessionId));
    try {
      const dd = _buildDd(row);
      const fonts = {
        NotoSansDevanagari: {
          normal: 'NotoSansDevanagari-Regular.ttf',
          bold: 'NotoSansDevanagari-Bold.ttf',
          italics: 'NotoSansDevanagari-Regular.ttf',
          bolditalics: 'NotoSansDevanagari-Bold.ttf'
        }
      };
      const vfs = {
        'NotoSansDevanagari-Regular.ttf': FONT_REGULAR,
        'NotoSansDevanagari-Bold.ttf': FONT_BOLD
      };
      const doc = SANDBOX.pdfMake.createPdf(dd, null, fonts, vfs);
      doc.getBase64(function (data) {
        try {
          const buf = Buffer.from(data, 'base64');
          resolve(buf);
        } catch (e) { reject(e); }
      });
    } catch (e) { reject(e); }
  });
}

module.exports = { generatePdf };
