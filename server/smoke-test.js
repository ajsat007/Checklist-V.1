/* smoke-test.js — end-to-end API test against a running server.
   Usage: node server/smoke-test.js   (server must be running on :3000) */
'use strict';

const BASE = 'http://localhost:3000';
let pass = 0, fail = 0;

function ok(name, cond, extra) {
  if (cond) { pass++; console.log('  ✔ ' + name); }
  else { fail++; console.log('  ✘ ' + name + (extra ? '  → ' + extra : '')); }
}
async function call(fn, ...args) {
  const r = await fetch(BASE + '/exec', { method: 'POST', body: JSON.stringify({ fn, args }) });
  const t = await r.text();
  try { return JSON.parse(t); } catch (e) { return { _raw: t }; }
}

(async () => {
  console.log('— login / lookup —');
  const bad = await call('loginSupervisor', '9999', '9999');
  ok('unknown id rejected', bad.ok === false && bad.code === 'NOT_FOUND');
  const login = await call('loginSupervisor', '43877', '43877');
  ok('login 43877', login.ok === true && login.employee.name.length > 0, JSON.stringify(login));
  const wrongPw = await call('loginSupervisor', '43877', 'nope');
  ok('wrong password rejected', wrongPw.ok === false && wrongPw.code === 'BAD_PW');
  const look = await call('lookupSupervisorName', '43995');
  ok('lookup 43995', look.ok === true && !!look.name);

  console.log('— shift checklist (bs) —');
  const SID = 'SES-TEST-SHIFT-' + Date.now();
  const answersA = { 'फलाट स्वच्छता': 'होय', 'जिना': 'नाही', 'बसस्थानक झाडणे, पुसणे': 'होय', 'वाहतूक नियंत्रक कक्ष': 'होय', 'मजला (झाडलोट)': 'होय', 'मजला (मॉपिंग)': 'होय' };
  const answersB = { 'फलाट स्वच्छता': 'होय', 'जिना': 'होय', 'बसस्थानक झाडणे, पुसणे': 'होय', 'वाहतूक नियंत्रक कक्ष': 'होय', 'मजला (झाडलोट)': 'होय', 'मजला (मॉपिंग)': 'होय' };
  const shifts = [
    { shiftName: 'पहिली पाळी(Shift)', answers: answersA, remarks: { 'जिना': 'दुरुस्ती हवी' } },
    { shiftName: 'दुसरी पाळी(Shift)', answers: answersB, remarks: {} },
    { shiftName: 'तिसरी पाळी(Shift)', answers: answersB, remarks: {} },
    { shiftName: 'चौथी पाळी(Shift)', answers: answersB, remarks: {} },
    { shiftName: 'पाचवी पाळी(Shift)', answers: answersB, remarks: {} },
    { shiftName: 'सहावी पाळी(Shift)', answers: answersB, remarks: {} }
  ];
  const sub = await call('submitAllShifts', {
    sessionId: SID, tokenId: '', dist: 'अमरावती', stn: 'अमरावती',
    name: 'SACHIN SHIVLAL ADE', id: '43877', date: '2026-07-03', checklistKey: 'bs', shifts
  });
  ok('submitAllShifts ok', sub.ok === true, JSON.stringify(sub));
  ok('token format', /^MSRTC-[A-Z0-9]+-[A-Z0-9]+-\d{4}$/.test(sub.tokenId || ''), sub.tokenId);
  ok('pdfUrl returned', typeof sub.pdfUrl === 'string' && sub.pdfUrl.indexOf('/report/') === 0);

  const dup = await call('checkChecklistCompletedToday', '43877', 'अमरावती', 'bs', '2026-07-03');
  ok('completed-today gate fires', dup.completed === true);
  const dupSubmit = await call('createSession', { dist: 'अमरावती', stn: 'अमरावती', name: 'SACHIN SHIVLAL ADE', id: '43877', checklistKey: 'bs', date: '2026-07-03' });
  ok('duplicate createSession blocked', dupSubmit.ok === false && dupSubmit.completedToday === true);
  const badKey = await call('createSession', { dist: 'अ', stn: 'ब', name: 'x', id: '43877', checklistKey: 'zz', date: '2026-07-03' });
  ok('invalid checklist key rejected', badKey.ok === false);

  console.log('— reports / detail —');
  const rep = await call('getMyReports', '43877');
  ok('getMyReports has session', rep.ok === true && rep.results.some(x => x.sessionId === SID));
  const row = rep.results.find(x => x.sessionId === SID);
  ok('progressLabel', !!row && /पाळी/.test(row.progressLabel), row && row.progressLabel);
  ok('status Completed', !!row && row.status === 'Completed');
  const det = await call('getSessionDetail', SID, '43877');
  ok('detail units=2', det.ok === true && det.units.length === 2, JSON.stringify(det).slice(0, 120));
  ok('detail remark present', det.units[0].items.some(i => i.remark === 'दुरुस्ती हवी'));

  console.log('— edit —');
  const edit = await call('updateUnitAnswers', { sessionId: SID, unitName: 'पहिली पाळी(Shift)', mode: 'shift', id: '43877', answers: { 'फलाट स्वच्छता': 'नाही', 'जिना': 'होय' }, remarks: { 'फलाट स्वच्छता': 'पुन्हा करा' } });
  ok('updateUnitAnswers ok', edit.ok === true);
  const det2 = await call('getSessionDetail', SID, '43877');
  const u1 = det2.units.find(u => u.label === 'पहिली पाळी(Shift)');
  ok('edit persisted', !!u1 && u1.items.some(i => i.q === 'फलाट स्वच्छता' && i.answer === 'नाही'));
  const foreignEdit = await call('updateUnitAnswers', { sessionId: SID, unitName: 'पहिली पाळी(Shift)', mode: 'shift', id: '43995', answers: {} });
  ok('foreign edit rejected', foreignEdit.ok === false);

  console.log('— bus checklist (bw) —');
  const BID = 'SES-TEST-BUS-' + Date.now();
  const busPayload = (n, rep2) => ({
    sessionId: BID, tokenId: '', dist: 'पुणे', stn: 'स्वारगेट', name: 'DINESH SHAMRAO KUTHE', id: '43995',
    date: '2026-07-03', checklistKey: 'bw', busNumber: n, isRepeat: !!rep2,
    answers: { 'आसनांची स्वच्छता': 'होय' }, remarks: {}
  });
  const b1 = await call('saveBusEntry', busPayload('MH12AB1234'));
  ok('bus 1 saved', b1.ok === true && b1.totalBuses === 1, JSON.stringify(b1));
  const b2 = await call('saveBusEntry', busPayload('MH14XY9999'));
  ok('bus 2 saved', b2.ok === true && b2.totalBuses === 2);
  const b1r = await call('saveBusEntry', busPayload('MH12AB1234', true));
  ok('repeat bus appended', b1r.ok === true && b1r.totalBuses === 3);
  const b1u = await call('saveBusEntry', busPayload('MH14XY9999', false));
  ok('same bus replaced (not appended)', b1u.ok === true && b1u.totalBuses === 3);
  const fin = await call('finalizeBusSession', { sessionId: BID, id: '43995' });
  ok('finalize bus session', fin.ok === true && fin.pdfUrl.indexOf('/report/') === 0);

  console.log('— resume / incomplete —');
  const RID = 'SES-TEST-RES-' + Date.now();
  await call('saveBusEntry', Object.assign(busPayload('MH20ZZ0001'), { sessionId: RID }));
  const inc = await call('listIncompleteSessions', '43995');
  ok('incomplete listed', inc.ok === true && inc.sessions.some(s => s.sessionId === RID));
  const resume = await call('resumeSession', RID, '43995');
  ok('resumeSession', resume.ok === true && resume.completedBuses.length === 1 && resume.mode === 'bus', JSON.stringify(resume).slice(0, 150));
  const foreignResume = await call('resumeSession', RID, '43877');
  ok('foreign resume rejected', foreignResume.ok === false);

  console.log('— search —');
  const s1 = await call('searchReports', sub.tokenId, '', '', '', '43877');
  ok('search by token', s1.ok === true && s1.results.length === 1 && s1.results[0].sessionId === SID);
  const s2 = await call('searchReports', '', 'MH12AB', '', '', '43995');
  ok('search by bus number', s2.ok === true && s2.results.some(x => x.sessionId === BID));
  const s3 = await call('searchReports', '', '', 'bw', '2026-07-03', '43995');
  ok('search by type+date', s3.ok === true && s3.results.every(x => x.checklistKey === 'bw'));

  console.log('— report HTML —');
  const html1 = await (await fetch(BASE + '/report/' + SID)).text();
  ok('shift report renders', html1.indexOf('महाराष्ट्र राज्य मार्ग परिवहन महामंडळ') !== -1 && html1.indexOf('पहिली पाळी(Shift)') !== -1);
  ok('report shows remark', html1.indexOf('पुन्हा करा') !== -1);
  ok('report shows penalty table', html1.indexOf('दंडात्मक तरतूद') !== -1);
  const html2 = await (await fetch(BASE + '/report/' + BID)).text();
  ok('bus report renders', html2.indexOf('MH12AB1234') !== -1 && html2.indexOf('पुन्हा') !== -1);
  const html404 = await (await fetch(BASE + '/report/NOPE')).text();
  ok('missing report handled', html404.indexOf('अहवाल आढळला नाही') !== -1);

  console.log('— pdf poll endpoints —');
  const gp = await call('getSessionPdf', SID);
  ok('getSessionPdf', gp.ok === true && gp.pdfUrl.indexOf('/report/') === 0);
  const gn = await call('generatePdfNow', SID, '43877');
  ok('generatePdfNow', gn.ok === true);

  console.log('— stats / delete —');
  const st = await call('getEmployeeStats', '43877');
  ok('stats total>=1', st.ok === true && st.total >= 1);
  const delForeign = await call('deleteSession', SID, '43995');
  ok('foreign delete rejected', delForeign.ok === false);
  const del = await call('deleteSession', SID, '43877');
  ok('own delete ok', del.ok === true);
  const gone = await call('getSessionDetail', SID, '43877');
  ok('deleted session gone', gone.ok === false);

  console.log('— static frontend —');
  const idx = await (await fetch(BASE + '/')).text();
  ok('index.html served', idx.indexOf('css/style.css') !== -1 && idx.indexOf('js/app.js') !== -1);
  const cssR = await fetch(BASE + '/css/style.css');
  ok('style.css served', cssR.status === 200 && (cssR.headers.get('content-type') || '').indexOf('text/css') === 0);
  const jsR = await fetch(BASE + '/js/app.js');
  const jsT = await jsR.text();
  ok('app.js served + /exec URL', jsR.status === 200 && jsT.indexOf("var APPS_SCRIPT_URL = '/exec'") !== -1);
  const trav = await fetch(BASE + '/..%2Fserver%2Fdb.js');
  ok('path traversal blocked', trav.status === 403 || trav.status === 404, 'status=' + trav.status);

  console.log('\nRESULT: %d passed, %d failed', pass, fail);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('SMOKE TEST CRASH:', e); process.exit(2); });
