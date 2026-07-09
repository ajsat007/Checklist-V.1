/* =====================================================================
   report.js — builds the printable Marathi inspection report as HTML.
   PDF via browser Print → Save as PDF (native, perfect Devanagari).
   ===================================================================== */
'use strict';

const cfg = require('./checklist-config');
const { CHECKLIST_META, CHECKLIST_TITLES, FALLBACK_QUESTIONS, PENALTIES, SIG_LABELS, APP } = cfg;
const { _getSession, _parseJSON } = require('./handlers');

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
@font-face {
  font-family: 'Noto Sans Devanagari';
  font-style: normal;
  font-weight: 400;
  font-display: block;
  src: url('/fonts/NotoSansDevanagari-Regular.ttf') format('truetype');
}
@font-face {
  font-family: 'Noto Sans Devanagari';
  font-style: normal;
  font-weight: 700;
  font-display: block;
  src: url('/fonts/NotoSansDevanagari-Bold.ttf') format('truetype');
}
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
.guide-overlay { display:none; position:fixed; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.6); z-index:9999; justify-content:center; align-items:center; padding:20px; }
.guide-card { background:#fff; border-radius:14px; max-width:420px; width:100%; padding:28px 24px; box-shadow:0 8px 40px rgba(0,0,0,0.3); position:relative; max-height:90vh; overflow-y:auto; }
.guide-card h3 { margin:0 0 6px; font-size:17px; color:#0b3d6e; text-align:center; }
.guide-card p { margin:4px 0 14px; font-size:13px; color:#555; text-align:center; }
.guide-step { display:flex; align-items:flex-start; gap:12px; margin-bottom:14px; padding:10px 12px; background:#f7f9fc; border-radius:10px; }
.guide-step .num { background:#0b3d6e; color:#fff; width:26px; height:26px; border-radius:50%; display:flex; align-items:center; justify-content:center; font-size:13px; font-weight:700; flex-shrink:0; margin-top:2px; }
.guide-step .txt { font-size:13px; color:#222; line-height:1.5; }
.guide-step .txt strong { color:#0b3d6e; }
.guide-close { display:block; width:100%; padding:12px; background:#0b3d6e; color:#fff; border:0; border-radius:8px; font-size:15px; font-weight:600; cursor:pointer; margin-top:4px; }
.guide-close:hover { background:#0a2f52; }
.guide-hint { font-size:10px; color:#aaa; text-align:center; margin:10px 0 0; cursor:pointer; text-decoration:underline; }
@media print {
  .toolbar, .guide-overlay, #printGuide, .dl-hint { display:none !important; }
  body { padding:0; margin:0; }
  .sheet { border:none; padding:0; max-width:none; margin:0; box-shadow:none; }
  .info td, .grid td, .grid th, .dand td, .dand th, .sigwrap td { font-size:9px !important; }
  .grid { page-break-inside:auto; }
  thead { display:table-header-group; }
  .dand, .sigwrap { page-break-inside:avoid; }
  [style*="overflow-x:auto"] { overflow:visible !important; max-height:none !important; height:auto !important; }
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
  const n = buses.length;
  const dense = questions.length >= 8 ? ' style="font-size:8px"' : '';
  let head = '<tr><th style="width:5%">अ.क्र.</th><th style="width:15%">बस क्रमांक</th>';
  questions.forEach((q, i) => { head += '<th' + dense + '>' + esc(q) + '</th>'; });
  head += '<th style="width:12%">शेरा</th></tr>';
  const seen = {};
  let body = '';
  // Diagnostic: log actual bus count to server console
  if (typeof console !== 'undefined') console.log('[pdf] busTable session=' + (row.token_id || row.session_id) + ' buses=' + n + ' questions=' + questions.length);
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

/* ---- buildReport (entry point) ---- */
function buildReport(sessionId, autoPrint, options) {
  const row = _getSession(sessionId);
  if (!row) {
    return '<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center">' +
           '<h2>अहवाल आढळला नाही</h2><p>Report not found for session ' + esc(sessionId) + '.</p></body>';
  }

  const forPdf = options && options.forPdf;

  // Count validation for bus sessions
  if (!forPdf && (row.checklist_key === 'bw' || (CHECKLIST_META[row.checklist_key] || {}).mode === 'bus')) {
    const buses = _parseJSON(row.buses_json, []);
    if (row.total_buses !== buses.length) {
      console.warn('[pdf] BUS COUNT MISMATCH! session=' + row.session_id + ' total_buses_col=' + row.total_buses + ' actual_json=' + buses.length);
    }
  }

  const toolbarHtml = forPdf ? '' :
    '<div class="toolbar" style="flex-direction:column;align-items:center">' +
    '<button class="dl-btn" id="pdfDlBtn" style="font-size:18px;padding:14px 32px;width:100%;max-width:400px">📥 PDF डाउनलोड करा (एक क्लिक)</button>' +
    '<button onclick="window.print()" style="background:transparent;color:#0b3d6e;border:1px solid #0b3d6e;font-size:13px;padding:8px 16px">🖨️ प्रिंट / Print वापरून PDF</button>' +
    '</div>' +
    '<div class="dl-hint">PDF आपोआप डाउनलोड होईल. <a href="#" onclick="document.getElementById(\'guideModal\').style.display=\'flex\';return false" style="color:#0b3d6e">मदत / मोबाईल मार्गदर्शन</a></div>' +
    '<div class="guide-overlay" id="guideModal">' +
      '<div class="guide-card">' +
        '<h3>📱 PDF डाउनलोड कसे करावे</h3>' +
        '<p style="background:#e8f5e9;padding:8px 12px;border-radius:8px;font-size:13px">✅ <strong>नवीन:</strong> आता <strong>"PDF डाउनलोड करा (एक क्लिक)"</strong> बटणावर टॅप केल्यास PDF थेट डाउनलोड होईल — कोणतेही प्रिंट सेटिंग बदलण्याची गरज नाही!</p>' +
        '<p>जर वरील बटण काम करत नसेल तर खालील पद्धत वापरा:</p>' +
        '<div class="guide-step"><div class="num">1</div><div class="txt"><strong>"प्रिंट / Print वापरून PDF"</strong> या बटणावर टॅप करा.</div></div>' +
        '<div class="guide-step"><div class="num">2</div><div class="txt">प्रिंट डायलॉगमध्ये <strong>गंतव्य स्थान = Save as PDF</strong> निवडा.</div></div>' +
        '<div class="guide-step"><div class="num">3</div><div class="txt"><strong>PDF</strong> बटणावर टॅप करा (अँड्रॉइड) किंवा <strong>Save</strong> वर टॅप करा (iOS).</div></div>' +
        '<p style="margin-top:12px;font-size:12px;color:#666;background:#fff3cd;padding:8px 12px;border-radius:8px">' +
          '💡 <strong>महत्त्वाचे:</strong> प्रिंट डायलॉगमध्ये <strong>सर्व पाने (All Pages)</strong> निवडल्याची खात्री करा.' +
        '</p>' +
        '<button class="guide-close" onclick="document.getElementById(\'guideModal\').style.display=\'none\'">👍 समजले</button>' +
        '<div class="guide-hint" onclick="document.getElementById(\'guideModal\').style.display=\'none\'">नंतर वाचेन</div>' +
      '</div>' +
    '</div>' +
    '<script>' +
    'document.getElementById("pdfDlBtn").onclick=function(){' +
      'var btn=this;btn.disabled=true;btn.textContent="⏳ PDF तयार होत आहे...";' +
      'fetch("/report/' + encodeURIComponent(sessionId) + '/pdf").then(function(r){' +
        'if(!r.ok){return r.text().then(function(t){throw new Error(t)});}' +
        'return r.blob();' +
      '}).then(function(blob){' +
        'var url=URL.createObjectURL(blob);' +
        'var a=document.createElement("a");a.href=url;a.download="' + esc((row && row.token_id) || 'report') + '.pdf";' +
        'document.body.appendChild(a);a.click();a.remove();' +
        'setTimeout(function(){URL.revokeObjectURL(url);},10000);' +
        'btn.textContent="✅ PDF डाउनलोड झाले!";' +
        'setTimeout(function(){btn.disabled=false;btn.textContent="📥 PDF डाउनलोड करा (एक क्लिक)";},3000);' +
      '}).catch(function(e){' +
        'console.error("PDF_DL:",e);' +
        'btn.textContent="❌ त्रुटी - प्रिंट वापरा";btn.style.background="#b91c1c";' +
        'setTimeout(function(){btn.disabled=false;btn.textContent="📥 PDF डाउनलोड करा (एक क्लिक)";btn.style.background="";},5000);' +
      '});' +
    '};' +
    '<\/script>';

  const html =
    '<!doctype html><html lang="mr"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width, initial-scale=1">' +
    '<title>' + esc(row.token_id || 'Report') + '</title>' +
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
    '<script>' +
    // Auto-show guide for mobile users on first visit
    'if(/Mobi|Android|iPhone|iPad|iPod/i.test(navigator.userAgent)&&!localStorage.getItem("pdfGuideShown")){' +
      'window.addEventListener("load",function(){' +
        'setTimeout(function(){' +
          'var g=document.getElementById("guideModal");if(g)g.style.display="flex";' +
          'localStorage.setItem("pdfGuideShown","1");' +
        '},800);' +
      '});' +
    '}' +
    '<\/script>' +
    (autoPrint ? '<script>window.addEventListener("load",function(){setTimeout(function(){window.print();},400);});<\/script>' : '') +
    '</body></html>';
  return html;
}

module.exports = { buildReport };
