/* =====================================================================
   report.js — builds the printable Marathi inspection report as HTML.
   Open in the browser and use Print → "Save as PDF" for a clean PDF.
   Layout ported from the old Apps Script _pdf* functions (header, title,
   answer table per mode, penalty table, signatures, footer).
   ===================================================================== */
'use strict';

const cfg = require('./checklist-config');
const { CHECKLIST_META, CHECKLIST_TITLES, FALLBACK_QUESTIONS, PENALTIES, SIG_LABELS, SHIFTS, WEEKS, APP } = cfg;
const { _getSession, _parseJSON } = require('./handlers');

const DEV_DIGITS = ['०','१','२','३','४','५','६','७','८','९'];
function mn(n) { return String(n).replace(/[0-9]/g, d => DEV_DIGITS[+d]); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function nl2br(s) { return esc(s).replace(/\n/g, '<br>'); }
function ansCls(v) { return v === 'होय' ? 'yes' : (v === 'नाही' ? 'no' : 'cc'); }
function normUnit(s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); }

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
.toolbar .dl-hint { width:100%; font-size:11px; color:#555; margin-top:2px; line-height:1.5; }
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
  return (
    '<div class="dand"><table>' +
      '<tr><th style="width:10%">अ. क्र.</th><th>दंडात्मक तरतूद</th><th style="width:18%">दंड रु.</th></tr>' +
      rows +
    '</table></div>'
  );
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

/* shift/week mode: rows = questions, columns = each unit present */
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

/* single mode: # | question | answer | remark */
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

/* bus mode: rows = buses, columns = questions */
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

function buildReport(sessionId, autoPrint, options) {
  const row = _getSession(sessionId);
  if (!row) {
    return '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">' +
           '<h2>अहवाल आढळला नाही</h2><p>Report not found for session ' + esc(sessionId) + '.</p></body>';
  }
  const forPdf = options && options.forPdf;
  const sessionEnc = encodeURIComponent(sessionId);
  const tokenSafe = esc((row && row.token_id) || 'report');
  const toolbarHtml = forPdf ? '' :
    '<div class="toolbar">' +
    '<button class="dl-btn" id="pdfDlBtn">📥 PDF डाउनलोड करा</button>' +
    '</div>' +
    '<script>' +
    'document.getElementById("pdfDlBtn").onclick=async function(){' +
      'var btn=this;btn.disabled=true;btn.textContent="⏳ तयार होत आहे...";' +
      'try{' +
        'var resp=await fetch("/report/' + sessionEnc + '/download");' +
        'if(!resp.ok) throw new Error("HTTP "+resp.status);' +
        'var blob=await resp.blob();' +
        'var url=URL.createObjectURL(blob);' +
        'var a=document.createElement("a");a.href=url;a.download="' + tokenSafe + '.pdf";' +
        'document.body.appendChild(a);a.click();a.remove();' +
        'setTimeout(function(){URL.revokeObjectURL(url);},15000);' +
        'btn.textContent="✅ डाउनलोड झाले!";' +
        'setTimeout(function(){btn.disabled=false;btn.textContent="📥 PDF डाउनलोड करा";},2000);' +
      '}catch(err){' +
        'alert("PDF डाउनलोड अयशस्वी: "+err.message+"\\n\\nकृपया नंतर पुन्हा प्रयत्न करा.");' +
        'btn.disabled=false;btn.textContent="📥 PDF डाउनलोड करा";' +
      '}' +
    '};' +
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
