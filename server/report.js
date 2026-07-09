/* =====================================================================
   report.js — builds the printable Marathi inspection report as HTML.
   PDF download uses pdfmake 0.2.x with embedded Noto Sans Devanagari
   TTF fonts (zero external services).
   ===================================================================== */
'use strict';

const fs = require('fs');
const path = require('path');
const cfg = require('./checklist-config');
const { CHECKLIST_META, CHECKLIST_TITLES, FALLBACK_QUESTIONS, PENALTIES, SIG_LABELS, SHIFTS, WEEKS, APP } = cfg;
const { _getSession, _parseJSON } = require('./handlers');

/* ---- embedded font base64 (TTF, read once at boot) ---- */
const _FONT_DIR = path.resolve(__dirname, '..', 'public', 'fonts');
function _b64(name) {
  try { return fs.readFileSync(path.join(_FONT_DIR, name)).toString('base64'); }
  catch (e) { console.error('[report] font load failed:', name, e.message); return ''; }
}
const FONT_REGULAR = _b64('NotoSansDevanagari-Regular.ttf');
const FONT_BOLD = _b64('NotoSansDevanagari-Bold.ttf');

/* ---- helpers ---- */
const DEV_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function mn(n) { return String(n).replace(/[0-9]/g, d => DEV_DIGITS[+d]); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
function ansCls(v) { return v === 'होय' ? 'yes' : (v === 'नाही' ? 'no' : 'cc'); }
function normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

/* ---- CSS for the browser-viewable HTML ---- */
const CSS = `
@page { size: A4; margin: 6mm 8mm; }
* { box-sizing: border-box; }
body { font-family: 'Noto Sans Devanagari','Mangal',Arial,sans-serif; color:#111; margin:0; padding:10px; font-size:12px; }
.sheet { border:1.5px solid #000; padding:8px 10px; max-width:1000px; margin:0 auto; }
.org { text-align:center; font-weight:800; font-size:15px; margin-bottom:2px; }
.sub { text-align:center; font-size:11px; color:#333; margin-bottom:6px; }
.info { width:100%; border-collapse:collapse; margin:4px 0 6px; }
.info td { border:1px solid #999; padding:3px 6px; font-size:11.5px; }
.ttl { text-align:center; font-weight:800; font-size:12.5px; margin:6px 0; }
table.grid { width:100%; border-collapse:collapse; table-layout:fixed; margin-bottom:8px; }
table.grid th, table.grid td { border:1px solid #333; padding:3px 4px; font-size:10.5px; vertical-align:top; word-wrap:break-word; }
table.grid th { background:#f0f2f5; text-align:center; font-weight:700; }
.cc { text-align:center; }
.qtext { text-align:left; }
.yes { color:#1a6b2e; font-weight:700; text-align:center; }
.no  { color:#b91c1c; font-weight:700; text-align:center; }
.rmk { font-size:9px; color:#b91c1c; font-style:italic; }
.dand { margin-top:8px; page-break-inside:avoid; }
.dand table { width:100%; border-collapse:collapse; }
.dand td, .dand th { border:1px solid #333; padding:3px 6px; font-size:10.5px; }
.sigwrap { margin-top:14px; width:100%; border-collapse:collapse; page-break-inside:avoid; }
.sigwrap td { border:1px solid #333; padding:10px 8px; font-size:11px; vertical-align:top; width:50%; height:70px; }
.ftr { margin-top:10px; text-align:center; font-size:9px; color:#666; }
.toolbar { text-align:center; margin:10px auto; max-width:1000px; display:flex; gap:10px; justify-content:center; flex-wrap:wrap; }
.toolbar button { background:#0b3d6e; color:#fff; border:0; padding:12px 24px; border-radius:8px; font-size:15px; cursor:pointer; font-weight:600; }
.toolbar button:active { transform:scale(0.97); }
.toolbar .dl-btn { background:#0E9F6E; font-size:16px; }
@media print {
  .toolbar { display:none !important; }
  body { padding:0; margin:0; }
  .sheet { border:none; padding:0; max-width:none; margin:0; box-shadow:none; }
  .info td, .grid td, .grid th, .dand td, .dand th, .sigwrap td { font-size:9px !important; }
  .grid { page-break-inside:auto; }
  thead { display:table-header-group; }
  tr { page-break-inside:avoid; }
  .dand, .sigwrap { page-break-inside:avoid; }
}
`;

/* ---- HTML block builders (browser view) ---- */
function headerBlock(row) {
  const dateDisp = String(row.created_date || '').trim();
  return (
    '<div class="org">महाराष्ट्र राज्य मार्ग परिवहन महामंडळ</div>' +
    '<div class="sub">' + esc(APP.APP_NAME) + '</div>' +
    '<table class="info"><tr>' +
      '<td>विभाग- ' + esc(row.district || '') + '</td>' +
      '<td style="text-align:right">आगार- ________</td>' +
    '</tr><tr>' +
      '<td>बसस्थानक- ' + esc(row.station || '') + '</td>' +
      '<td style="text-align:right">दिनांक- ' + esc(dateDisp) + '</td>' +
    '</tr></table>' +
    '<div class="ttl">' + esc(CHECKLIST_TITLES[row.checklist_key] || row.checklist_type || '') + '</div>'
  );
}
function penaltyBlock(key) {
  const list = PENALTIES[key] || [];
  let rows = list.map((p, i) =>
    '<tr><td class="cc">' + mn(i + 1) + '</td><td>' + esc(p.desc) + ' (रु.' + mn(p.amt) + '/-)</td><td class="cc"></td></tr>'
  ).join('');
  rows += '<tr><td></td><td style="text-align:right;font-weight:700">एकूण दंड रु.</td><td class="cc" style="font-weight:700">' + mn(0) + '</td></tr>';
  return '<div class="dand"><table>' +
    '<tr><th style="width:10%">अ. क्र.</th><th>दंडात्मक तरतूद</th><th style="width:18%">दंड रु.</th></tr>' + rows + '</table></div>';
}
function sigBlock(key, row) {
  const s = SIG_LABELS[key] || { left: 'पर्यवेक्षक\nनाव\nस्वाक्षरी', right: 'स्थानक प्रमुख\nनाव\nस्वाक्षरी' };
  const left = s.left.replace('नाव-', 'नाव- ' + (row.supervisor_name || '') + (row.employee_id ? ' (' + row.employee_id + ')' : ''))
                     .replace(/(^|\n)नाव(\n|$)/, (m, a, b) => a + 'नाव- ' + (row.supervisor_name || '') + (row.employee_id ? ' (' + row.employee_id + ')' : '') + b);
  return '<table class="sigwrap"><tr><td>' + nl2br(left) + '</td><td>' + nl2br(s.right) + '</td></tr></table>';
}
function footerBlock(row) {
  return '<div class="ftr">टोकन: ' + esc(row.token_id || '') + ' &nbsp;|&nbsp; ' + esc(APP.APP_NAME) +
         ' &nbsp;|&nbsp; ' + esc(row.created_time || '') + '</div>';
}
function unitTable(row, units) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const present = (units || []).filter(u => u && u.shiftName);
  const colW = Math.max(6, Math.floor(60 / Math.max(1, present.length)));
  let head = '<tr><th style="width:6%">अ.क्र.</th><th style="width:' + (34 - 0) + '%">कामाचा तपशील</th>';
  present.forEach(u => { head += '<th style="width:' + colW + '%">' + esc(u.shiftName) + '</th>'; });
  head += '<th style="width:14%">शेरा</th></tr>';
  let body = '';
  questions.forEach((q, i) => {
    let cells = '';
    const remarks = [];
    present.forEach(u => {
      const a = (u.answers || {})[q] || '';
      cells += '<td class="' + ansCls(a) + '">' + esc(a) + '</td>';
      const rm = (u.remarks || {})[q];
      if (rm && remarks.indexOf(esc(rm)) === -1) remarks.push(esc(rm));
    });
    body += '<tr><td class="cc">' + mn(i + 1) + '</td><td class="qtext">' + esc(q) + '</td>' + cells +
            '<td class="rmk">' + (remarks.length ? remarks.join('<br>') : '') + '</td></tr>';
  });
  return '<table class="grid">' + head + body + '</table>';
}
function singleTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const unit = (_parseJSON(row.shifts_json, [])[0]) || { answers: {}, remarks: {} };
  let body = '';
  questions.forEach((q, i) => {
    const a = (unit.answers || {})[q] || '';
    const rm = (unit.remarks || {})[q] || '';
    body += '<tr><td class="cc">' + mn(i + 1) + '</td><td class="qtext">' + esc(q) + '</td>' +
            '<td class="' + ansCls(a) + '">' + esc(a) + '</td><td class="rmk">' + esc(rm) + '</td></tr>';
  });
  return '<table class="grid">' +
    '<tr><th style="width:7%">अ.क्र.</th><th>कामाचा तपशील</th><th style="width:20%">काम केले आहे/नाही</th><th style="width:16%">शेरा</th></tr>' +
    body + '</table>';
}
function busTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const buses = _parseJSON(row.buses_json, []);
  const dense = questions.length >= 8 ? ' style="font-size:8px"' : '';
  let head = '<tr><th style="width:5%">अ.क्र.</th><th style="width:15%">बस क्रमांक</th>';
  questions.forEach((q, i) => { head += '<th' + dense + '>' + esc(q) + '</th>'; });
  head += '<th style="width:12%">शेरा</th></tr>';
  const seen = {};
  let body = '';
  buses.forEach((b, idx) => {
    const nk = normUnit(b.busNumber);
    seen[nk] = (seen[nk] || 0) + 1;
    const label = esc(b.busNumber) + (seen[nk] > 1 ? ' (पुन्हा ' + mn(seen[nk]) + ')' : '');
    let cells = '';
    const remarks = [];
    questions.forEach((q, i) => {
      const a = (b.answers || {})[q] || '';
      cells += '<td class="' + ansCls(a) + '"' + dense + '>' + esc(a) + '</td>';
      const rm = (b.remarks || {})[q];
      const rmTxt = rm ? (mn(i + 1) + ': ' + esc(rm)) : '';
      if (rmTxt && remarks.indexOf(rmTxt) === -1) remarks.push(rmTxt);
    });
    body += '<tr><td class="cc">' + mn(idx + 1) + '</td><td class="cc" style="font-weight:700">' + label + '</td>' +
            cells + '<td class="rmk">' + remarks.join('<br>') + '</td></tr>';
  });
  if (!buses.length) body = '<tr><td class="cc" colspan="' + (questions.length + 3) + '">— नोंद नाही —</td></tr>';
  return '<div style="overflow-x:auto"><table class="grid">' + head + body + '</table></div>';
}
function buildBody(row) {
  const mode = (CHECKLIST_META[row.checklist_key] || {}).mode || 'shift';
  if (mode === 'bus') return busTable(row);
  if (mode === 'single') return singleTable(row);
  const units = _parseJSON(row.shifts_json, []);
  return unitTable(row, units);
}

/* ================================================================
   pdfmake document definition builders (client-side PDF generation)
   ================================================================ */

/* Build a single pdfmake cell object from text + optional styling */
function _pc(text, opts) {
  if (!text && text !== 0) text = '';
  const cell = { text: String(text) };
  if (opts) Object.assign(cell, opts);
  return cell;
}

/* Answer cell with green/red coloring */
function _ansCell(a) {
  if (!a) return _pc('', { alignment: 'center' });
  return _pc(a, {
    alignment: 'center',
    bold: true,
    color: a === 'होय' ? '#1a6b2e' : (a === 'नाही' ? '#b91c1c' : undefined)
  });
}

/* Grid table layout with bordered cells and gray header */
function _gridLayout() {
  return {
    hLineWidth: function (i) { return 0.5; },
    vLineWidth: function (i) { return 0.5; },
    hLineColor: function (i) { return '#333'; },
    vLineColor: function (i) { return '#333'; },
    fillColor: function (i) { return i === 0 ? '#f0f2f5' : null; },
    paddingLeft: function (i) { return 3; },
    paddingRight: function (i) { return 3; },
    paddingTop: function (i) { return 2; },
    paddingBottom: function (i) { return 2; }
  };
}

/* Shift-mode table: questions x shifts */
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
  const hdr = [
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: 8 }),
    _pc('कामाचा तपशील', { bold: true, fontSize: 8.5 }),
    ...present.map(u => _pc(u.shiftName, { alignment: 'center', bold: true, fontSize: 8 })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: 8 })
  ];
  body.push(hdr);

  questions.forEach((q, i) => {
    const remarks = [];
    const cells = [
      _pc(mn(i + 1), { alignment: 'center', fontSize: 8.5 }),
      _pc(q, { fontSize: 8.5 })
    ];
    present.forEach(u => {
      const a = (u.answers || {})[q] || '';
      const rm = (u.remarks || {})[q];
      if (rm && remarks.indexOf(mn(i + 1) + ': ' + rm) === -1) remarks.push(mn(i + 1) + ': ' + rm);
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 7, color: '#b91c1c', italics: true }));
    body.push(cells);
  });

  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: 8.5
  };
}

/* Bus-mode table: buses x questions */
function _pdfBusTable(row) {
  const key = row.checklist_key;
  const questions = FALLBACK_QUESTIONS[key] || [];
  const buses = _parseJSON(row.buses_json, []);
  const n = buses.length;
  const qCount = questions.length;

  // Scale font sizes and widths based on data volume
  const isDense = n > 15 || qCount >= 6;
  const colW = isDense ? 24 : 30;
  const hFontSize = isDense ? 6.5 : 7;
  const rFontSize = isDense ? 7 : 8;

  const widths = [14, 48];
  for (let i = 0; i < qCount; i++) widths.push(colW);
  widths.push(30);

  const body = [];
  const hdr = [
    _pc('अ.\nक्र.', { alignment: 'center', bold: true, fontSize: hFontSize }),
    _pc('बस क्रमांक', { alignment: 'center', bold: true, fontSize: hFontSize }),
    ...questions.map(q => _pc(q, { alignment: 'center', bold: true, fontSize: hFontSize })),
    _pc('शेरा', { alignment: 'center', bold: true, fontSize: hFontSize })
  ];
  body.push(hdr);

  const seen = {};
  (buses || []).forEach((b, idx) => {
    const nk = normUnit(b.busNumber);
    seen[nk] = (seen[nk] || 0) + 1;
    const label = (b.busNumber || '') + (seen[nk] > 1 ? ' (पुन्हा ' + mn(seen[nk]) + ')' : '');
    const remarks = [];
    const cells = [
      _pc(mn(idx + 1), { alignment: 'center', fontSize: rFontSize }),
      _pc(label, { alignment: 'center', bold: true, fontSize: rFontSize })
    ];
    questions.forEach((q, i) => {
      const a = (b.answers || {})[q] || '';
      const rm = (b.remarks || {})[q];
      if (rm && remarks.indexOf(mn(i + 1) + ': ' + rm) === -1) remarks.push(mn(i + 1) + ': ' + rm);
      cells.push(_ansCell(a));
    });
    cells.push(_pc(remarks.join(', '), { fontSize: 6, color: '#b91c1c', italics: true }));
    body.push(cells);
  });

  if (!buses.length) {
    body.push([_pc('— नोंद नाही —', { colSpan: 3 + questions.length, alignment: 'center', fontSize: 9 })]);
  }

  return {
    table: { widths, body, dontBreakRows: false, headerRows: 1 },
    layout: _gridLayout(),
    fontSize: rFontSize
  };
}

/* Single-mode table: question / answer / remark */
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
    layout: _gridLayout(),
    fontSize: 8.5
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
    layout: _gridLayout(),
    margin: [0, 6, 0, 0]
  };
}

/* Signature block */
function _pdfSigBlock(key, row) {
  const s = SIG_LABELS[key] || { left: 'पर्यवेक्षक\nनाव\nस्वाक्षरी', right: 'स्थानक प्रमुख\nनाव\nस्वाक्षरी' };
  const leftName = row.supervisor_name || '';
  const leftId = row.employee_id || '';
  const leftTxt = s.left.replace('नाव-', 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : ''))
                         .replace(/(^|\n)नाव(\n|$)/, (m, a, b) => a + 'नाव-' + (leftName ? ' ' + leftName + (leftId ? ' (' + leftId + ')' : '') : '') + b);
  const rightTxt = s.right;
  return {
    table: {
      widths: ['*', '*'],
      body: [
        [
          { text: leftTxt.split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5, height: 60 },
          { text: rightTxt.split('\n').filter(Boolean).join('\n'), margin: [4, 4, 4, 4], fontSize: 9.5, height: 60 }
        ]
      ]
    },
    layout: {
      hLineWidth: function () { return 0.5; },
      vLineWidth: function () { return 0.5; },
      hLineColor: function () { return '#333'; },
      vLineColor: function () { return '#333'; },
      paddingLeft: function () { return 4; },
      paddingRight: function () { return 4; },
      paddingTop: function () { return 4; },
      paddingBottom: function () { return 4; }
    },
    margin: [0, 10, 0, 0]
  };
}

/* Merge all pieces into the top-level pdfmake document definition */
function _pdfDd(row) {
  const mode = (CHECKLIST_META[row.checklist_key] || {}).mode || 'shift';
  const title = CHECKLIST_TITLES[row.checklist_key] || row.checklist_type || '';
  const dateDisp = String(row.created_date || '').trim();
  const token = row.token_id || '';
  const timeDisp = row.created_time || '';

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
        hLineWidth: function () { return 0.5; },
        vLineWidth: function () { return 0.5; },
        hLineColor: function () { return '#999'; },
        vLineColor: function () { return '#999'; },
        paddingLeft: function () { return 3; },
        paddingRight: function () { return 3; },
        paddingTop: function () { return 2; },
        paddingBottom: function () { return 2; }
      },
      margin: [0, 0, 0, 4]
    },
    { text: title, style: 'title' }
  ];

  let contentBody;
  if (mode === 'bus') contentBody = _pdfBusTable(row);
  else if (mode === 'single') contentBody = _pdfSingleTable(row);
  else contentBody = _pdfShiftTable(row);

  const footerTxt = 'टोकन: ' + token + '  |  ' + APP.APP_NAME + '  |  ' + timeDisp;

  const isBusMode = mode === 'bus';
  return {
    pageSize: 'A4',
    pageOrientation: isBusMode ? 'landscape' : undefined,
    pageMargins: isBusMode ? [12, 14, 12, 14] : [18, 18, 18, 18],
    compress: true,
    defaultStyle: { font: 'NotoSansDevanagari', fontSize: isBusMode ? 8 : 9 },
    content: [
      ...headerStack,
      contentBody,
      _pdfPenaltyTable(row.checklist_key),
      _pdfSigBlock(row.checklist_key, row),
      { text: footerTxt, style: 'footer' }
    ],
    styles: {
      org: { alignment: 'center', bold: true, fontSize: 13, margin: [0, 0, 0, 1] },
      sub: { alignment: 'center', fontSize: 10, color: '#333' },
      title: { alignment: 'center', bold: true, fontSize: 11, margin: [0, 4, 0, 6] },
      footer: { alignment: 'center', fontSize: 8, color: '#666', margin: [0, 8, 0, 0] }
    }
  };
}

/* ---- buildReport (entry point) ---- */
function buildReport(sessionId, autoPrint, options) {
  const row = _getSession(sessionId);
  if (!row) {
    return '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">' +
           '<h2>अहवाल आढळला नाही</h2><p>Report not found for session ' + esc(sessionId) + '.</p></body>';
  }

  const forPdf = options && options.forPdf;
  const tokenSafe = esc((row && row.token_id) || 'report');
  const ddJson = JSON.stringify(_pdfDd(row));

  const toolbarHtml = forPdf ? '' :
    '<div class="toolbar">' +
    '<button class="dl-btn" id="pdfDlBtn">📥 PDF डाउनलोड करा</button>' +
    '</div>' +
    '<script src="/js/pdfmake.min.js"><\/script>' +
    '<script>' +
    'var _PDF_DD=' + ddJson + ';' +
    'var _PDF_VFS={' +
      "'NotoSansDevanagari-Regular.ttf':'" + FONT_REGULAR + "'," +
      "'NotoSansDevanagari-Bold.ttf':'" + FONT_BOLD + "'" +
    '};' +
    'var _PDF_FONTS={' +
      'NotoSansDevanagari:{' +
        "normal:'NotoSansDevanagari-Regular.ttf'," +
        "bold:'NotoSansDevanagari-Bold.ttf'," +
        "italics:'NotoSansDevanagari-Regular.ttf'," +
        "bolditalics:'NotoSansDevanagari-Bold.ttf'" +
      '}' +
    '};' +
    'function _dlPDF(){' +
      'var btn=document.getElementById("pdfDlBtn");if(!btn)return;' +
      'btn.disabled=true;btn.textContent="\\u23f3 PDF \\u0924\\u092f\\u093e\\u0930 \\u0939\\u094b\\u0924 \\u0906\\u0939\\u0947...";' +
      'try{' +
        'if(typeof pdfMake==="undefined"||!pdfMake.createPdf)throw new Error("PDF library not loaded");' +
        'pdfMake.createPdf(_PDF_DD,null,_PDF_FONTS,_PDF_VFS).download("' + tokenSafe + '.pdf");' +
        'setTimeout(function(){btn.disabled=false;btn.textContent="\\uD83d\\udce5 PDF \\u0921\\u093e\\u0909\\u0928\\u0932\\u094b\\u0921 \\u0915\\u0930\\u093e";},3000);' +
      '}catch(e){' +
        'console.error("PDF_DL:",e);' +
        'btn.textContent="\\u274c PDF \\u0924\\u094d\\u0930\\u0941\\u091f\\u0940 - \\u092a\\u0943\\u0937\\u094d\\u0920 \\u0930\\u093f\\u092b\\u094d\\u0930\\u0947\\u0936 \\u0915\\u0930\\u093e";' +
        'btn.style.background="#b91c1c";' +
        'setTimeout(function(){' +
          'btn.disabled=false;' +
          'btn.textContent="\\uD83d\\udce5 PDF \\u0921\\u093e\\u0909\\u0928\\u0932\\u094b\\u0921 \\u0915\\u0930\\u093e";' +
          'btn.style.background="";' +
        '},5000);' +
      '}' +
    '}' +
    'setTimeout(function(){' +
      'var b=document.getElementById("pdfDlBtn");if(!b)return;' +
      'if(typeof pdfMake==="undefined"||!pdfMake.createPdf){' +
        'b.textContent="\\u274c PDF \\u0932\\u093e\\u092f\\u092c\\u094d\\u0930\\u0947\\u0930\\u0940 \\u0924\\u094d\\u0930\\u0941\\u091f\\u0940";' +
        'b.style.background="#b91c1c";' +
      '}' +
      'b.onclick=_dlPDF;' +
    '},100);' +
    '<\/script>';

  const html =
    '<!doctype html><html lang="mr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(row.token_id || 'Report') + '</title>' +
    '<link rel="preconnect" href="https://fonts.googleapis.com">' +
    '<link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;600;700;800&display=swap" rel="stylesheet">' +
    '<style>' + CSS + '</style>' +
    '</head><body>' +
    toolbarHtml +
    '<div class="sheet" id="reportSheet">' +
      headerBlock(row) +
      buildBody(row) +
      penaltyBlock(row.checklist_key) +
      sigBlock(row.checklist_key, row) +
      footerBlock(row) +
    '</div>' +
    (autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});<\/script>' : '') +
    '</body></html>';
  return html;
}

module.exports = { buildReport };
