/* =====================================================================
   MSRTC Smart Mechanized Cleaning — Code.gs
   Version 17.1-fast  (all performance fixes + bug fixes integrated)
   ---------------------------------------------------------------------
   CHANGES vs 17.0:
   - _readRows: contiguous-run block reads (90 calls → 1-3 per session)
   - createSession: completed-today check moved server-side (1 fewer RTT)
   - saveShift: dead code removed; finalize count fixed (+1 bug);
     duplicate check reads only the Shift Name column
   - saveBus: count from client (+1), no redundant full reload
   - _autoFinalizeSession: correct count, Total Buses no longer zeroed
   - _updateSessionRecord: one read + one write (was up to 5 setValue)
   - SERVER_DRAFTS=false: redundant per-save draft writes disabled
   - processPDFQueue: drains full queue every 1 min (was 1 PDF / 5 min)
   - searchPastInspections: TextFinder-scoped to the supervisor's rows
   - deleteSession/processDeleteQueue: PDF + marker actually cleaned up
   - keepWarm removed (no effect on web-app cold starts)
   ---------------------------------------------------------------------
   SCALE NOTES (read before deploying at high volume):
   - Apps Script allows only ~30 SIMULTANEOUS executions. That caps
     concurrency, not registrations. Genuine 100k+ CONCURRENT users
     require a real DB backend (Cloud SQL / BigQuery / similar).
   - Google Sheet hard limit = 10,000,000 cells. With 14 cols this is
     ~700k session rows. YOU MUST archive monthly (see archiveOldSessions)
     or writes will eventually fail.
   - Backdated entries are allowed, so Created Time is NOT monotonic with
     row order. We therefore never early-exit scans by date.
   ===================================================================== */

/* === GLOBAL CONFIGURATION === */

var CONFIG = {
  APP_NAME:               'MSRTC Smart Mechanized Cleaning',
  APP_TAGLINE:            'MSRTC Facility Management Platform',
  POWERED_BY:             'Smart Services',
  VERSION:                '20.0',
  SPREADSHEET_ID:         '1yf4HaXD618anMLffv4OG4py_CxaxGzABi45taw-TS-o',   // Google Sheets is the only database
  SHIFT_CONTINUITY_HOURS: 24,
  SESSION_TIMEOUT_MIN:    30,
  MAX_REMARK_LENGTH:      300,
  PDF_FOLDER:             'MSRTC_Cleaning_Reports',
  LOG_SHEET:              'Audit_Log',
  CACHE_TTL_MS:           300000,   // L1 in-memory master-data TTL (5 min)
  MAX_RESULTS:            300,      // SCALE: cap rows returned by reports/search
  RESULT_CACHE_SEC:       45,       // SCALE: short TTL for per-supervisor result cache
  STATS_CACHE_SEC:        60,       // SCALE: short TTL for employee stats cache
  ARCHIVE_KEEP_DAYS:      120       // archiveOldSessions() retention window
};

/* SPEED: server-side draft writes are redundant — client resume uses
   localStorage, and server resume rebuilds from Shift_/Bus_Responses,
   never from Draft_Sessions. Disabling removes a lock + TextFinder +
   write from EVERY save. Flip to true only if you build a flow that
   actually reads Draft_Sessions. */
var SERVER_DRAFTS = false;

var PDF_ON_DEMAND = true;

/* SPEED: per-shift / per-bus audit rows cost an appendRow (~300ms) on every
   single save. The data itself already lives in Shift_/Bus_Responses with
   timestamps, so the audit row adds nothing. Errors, finalize, login, edits
   and deletes are STILL logged. Set true to restore full hot-path logging. */
var HOT_PATH_AUDIT = false;

/* === SHIFT & WEEK DEFINITIONS === */

var SHIFTS = [
  'पहिली पाळी(Shift)', 'दुसरी पाळी(Shift)', 'तिसरी पाळी(Shift)',
  'चौथी पाळी(Shift)',  'पाचवी पाळी(Shift)', 'सहावी पाळी(Shift)'
];

var WEEKS = [
  'पहिला आठवडा', 'दुसरा आठवडा', 'तिसरा आठवडा', 'चौथा आठवडा'
];

/* === CHECKLIST META === */

// freq: 'daily' | 'weekly' | 'monthly'
// mode: 'shift' (6-shift) | 'bus' (per-bus) | 'week' (4-week) | 'single' (one-time)
var CHECKLIST_META = {
  bs:   { freq: 'daily',   mode: 'shift',  units: SHIFTS,   label: 'बसस्थानक दैनंदिन तपासणी' },
  bw:   { freq: 'daily',   mode: 'bus',    units: null,     label: 'बसेस दैनंदिन तपासणी' },
  gh:   { freq: 'daily',   mode: 'shift',  units: SHIFTS,   label: 'विश्रांतीगृह दैनंदिन तपासणी' },
  wr:   { freq: 'daily',   mode: 'shift',  units: SHIFTS,   label: 'प्रसाधनगृह दैनंदिन तपासणी' },
  es:   { freq: 'weekly',  mode: 'week',   units: WEEKS,    label: 'बसस्थानक साप्ताहिक तपासणी' },
  gh_w: { freq: 'weekly',  mode: 'week',   units: WEEKS,    label: 'विश्रांतीगृह साप्ताहिक तपासणी' },
  bm:   { freq: 'monthly', mode: 'bus',    units: null,     label: 'बसेस मासिक तपासणी' },
  sm:   { freq: 'monthly', mode: 'single', units: ['एकदा'], label: 'बसस्थानक मासिक तपासणी' }
};

var CHECKLIST_TITLES = {
  bs:   'बसस्थानक स्वच्छता दैनंदिन तपासणी',
  bw:   'बसेस स्वच्छता दैनंदिन तपासणी',
  gh:   'विश्रांतीगृह स्वच्छता दैनंदिन तपासणी',
  wr:   'प्रसाधनगृह स्वच्छता दैनंदिन तपासणी',
  es:   'बसस्थानक स्वच्छता-आठवड्यातून एकदा करावयाची स्वच्छता तपासणी',
  gh_w: 'चालक वाहक विश्रांतीगृह स्वच्छता व सोयीसुविधा -आठवड्यातून एकदा तपासणी',
  bm:   'बसेस स्वच्छता-महिन्यातून एकदा करावयाची स्वच्छता तपासणी',
  sm:   'बसस्थानक स्वच्छता- महिन्यातून एकदा करावयाची स्वच्छता तपासणी'
};

/* === FALLBACK QUESTIONS (all 8 checklist types) === */

var FALLBACK_QUESTIONS = {
  bs: [
    'बसस्थानक झाडणे, पुसणे',
    'वाहतूक नियंत्रक कक्ष, बसस्थानक प्रमुख कक्ष व इतर कक्ष स्वच्छता',
    'फलाट स्वच्छता',
    'मोकळी जागेची स्वच्छता',
    'मजला (झाडलोट)',
    'मजला (मॉपिंग)',
    'उभे पृष्ठभाग (भिंती)',
    'काचेचे भाग',
    'दरवाजे व संलग्न फिटिंग्ज',
    'खिडक्या व संलग्न फिटिंग्ज आणि फ्रेम',
    'रेलिंग',
    'आरसे',
    'ग्रील्स',
    'खांब',
    'कॉरिडॉर / मार्गिका',
    'जिना',
    'कचरापेटी स्वच्छता',
    'कचऱ्याची विल्हेवाट'
  ],
  bw: [
    'बस झाडने व धुणे (आतील व बाहेरील संपूर्ण बाजू)',
    'आसनांची स्वच्छता',
    'बसेसच्या खिडक्याच्या काचा पुसणे',
    'दरवाजे व संलग्न फिटिंग्ज',
    'बसवरील अनधीकृत स्टिकर पोस्टर काढणे',
    'चालक केबिन स्वच्छता',
    'सामान कप्प्याची स्वच्छता',
    'समोरील बाजू मोठी काच व आरसे',
    'कचरा उचलणे / कचरापेटी रिकामी करणे'
  ],
  gh: [
    'विश्रांतीगृह झाडणे, पुसणे',
    'विश्रांतीगृहातील स्वच्छतागृहाची स्वच्छता',
    'शौचालय, स्नानगृह व मुतारी यांची स्वच्छता',
    'कचरापेटी स्वच्छता',
    'कचऱ्याची विल्हेवाट',
    'विश्रांतीगृहामध्ये गरम पाणी उपलब्ध आहे/नाही',
    'विश्रांतीगृहामध्ये पिण्याचे पाणी उपलब्ध आहे/नाही'
  ],
  wr: [
    'शौचालय, स्नानगृह व मुतारी यांची स्वच्छता',
    'वॉश बेसिन',
    'मजला (झाडलोट)',
    'मजला (मॉपिंग)',
    'उभे पृष्ठभाग (भिंती)',
    'काचेचे भाग',
    'दरवाजे व संलग्न फिटिंग्ज',
    'खिडक्या व संलग्न फिटिंग्ज आणि फ्रेम',
    'रेलिंग',
    'आरसे',
    'ग्रील्स',
    'कचरापेट्या स्वच्छता',
    'कचऱ्याची विल्हेवाट'
  ],
  es: [
    'छताचे जाळे काढणे',
    'टेबल, खुर्च्या, लाईट, संगणक व इतर साहित्य यांची स्वच्छता',
    'बसस्थानकावरील कुंड्या, पाणपोई यांची स्वच्छता',
    'बसस्थानकावरील अनधिकृत स्टिकर्स व पोस्टर्स काढणे',
    'दरवाजे, खिडक्या व फ्रेम्स स्वच्छ करणे',
    'जाळे काढणे व भिंती स्वच्छ करणे',
    'कार्पेट, फर्निचर व फिटिंग्स (दिवे, पंखे इ.) स्वच्छ करणे',
    'कंट्रोल रूम, लिफ्ट, अग्निशमन उपकरणे, सीसीटीव्ही सिस्टम स्वच्छ करणे',
    'अनधिकृत पोस्टर्स व स्टिकर्स काढून टाकणे'
  ],
  gh_w: [
    'विश्रांतीगृहाची सखोल स्वच्छता',
    'विश्रांतीगृहातील शौचालय व स्नानगृह यांची सखोल स्वच्छता',
    'गिझर व वॉटर प्युरिफायर देखभाल',
    'कीटकनाशक फवारणी (दोन आठवड्यातून एकदा)',
    'कचरापेटी स्वच्छता व कचऱ्याची विल्हेवाट'
  ],
  bm: [
    'बस धुणे (आतील व बाहेरील संपूर्ण बाजू, चालक केबिन) सखोल स्वच्छता',
    'बसेसच्या चेसिस व छत यांची स्वच्छता',
    'बसवरील अनधीकृत स्टिकर पोस्टर काढणे',
    'बसमधील पडदे बदलून स्वच्छ केलेले पडदे लावणे',
    'सामान कप्प्याची सखोल स्वच्छता',
    'समोरील बाजू मोठी काच, आरसे व खिडक्यांच्या काचा वॉशिंग सोडा व शाम्पू वापरून सखोल स्वच्छता'
  ],
  sm: [
    'टेरेस व छतांची पाण्याने स्वच्छता करणे',
    'सर्व उपकरणांची स्वच्छता करणे',
    'टेलिफोन, संगणक, फर्निचर, साईनबोर्ड, स्विच बोर्ड, एसी इ. स्वच्छ करणे',
    'धूळ साफ करणे / ओला पोछा / व्हॅक्यूम क्लीनिंग करणे',
    'सर्व लाईटिंग व इलेक्ट्रिकल फिटिंग्स स्वच्छ करणे',
    'नाल्यांची स्वच्छता व देखभाल करणे',
    'कचरापेटी स्वच्छता व कचऱ्याची विल्हेवाट'
  ]
};

/* === PENALTIES PER CHECKLIST TYPE === */

var PENALTIES = {
  bs: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'पाणपोईद्वारे स्वच्छ पिण्याचे पाणी उपलब्ध नसणे',              amt: 500 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  bw: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  gh: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'स्वच्छ पिण्याचे पाणी उपलब्ध नसणे',                           amt: 500 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  wr: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  es: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  gh_w: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  bm: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ],
  sm: [
    { desc: 'स्वच्छता समाधानकारक नसणे',                                   amt: 500 },
    { desc: 'स्वच्छतेचे काम केलेले नाही',                                  amt: 500 },
    { desc: 'कर्मचारी अनुपस्थित',                                         amt: 100 },
    { desc: 'कर्मचारी गणवेशात नसणे',                                      amt: 100 },
    { desc: 'रा प पर्यवेक्षक/अधिकारी यांनी दिलेल्या आदेशाचे पालन न करणे', amt: 200 }
  ]
};

/* === SIGNATURE LABELS PER CHECKLIST TYPE === */

var SIG_LABELS = {
  bs:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव-\nस्वाक्षरी',
          right: 'स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  bw:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव\nस्वाक्षरी',
          right: 'वाहन परीक्षक/पाळी प्रमुख / स का अ सही\nनाव\nपदनाम\nस्वाक्षरी' },
  gh:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक सही\nनाव\nस्वाक्षरी',
          right: 'स वा नि / स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  wr:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव\nस्वाक्षरी',
          right: 'वाहतूक नियंत्रक / स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  es:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव',
          right: 'स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  gh_w: { left: 'सेवा पुरवठादाराचे पर्यवेक्षक सही\nनाव',
          right: 'स वा नि / स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  bm:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव\nस्वाक्षरी',
          right: 'वाहतूक नियंत्रक / स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' },
  sm:   { left: 'सेवा पुरवठादाराचे पर्यवेक्षक\nनाव',
          right: 'स्थानक प्रमुख\nनाव\nपदनाम\nस्वाक्षरी' }
};

var STATUS = {
  IN_PROCESS: 'In Process',
  PAUSED:     'Paused',
  COMPLETED:  'Completed'
};

var LOG_ACTIONS = {
  SESSION_CREATE:    'SESSION_CREATE',
  SESSION_RESUME:    'SESSION_RESUME',
  SHIFT_SAVE:        'SHIFT_SAVE',
  BUS_SAVE:          'BUS_SAVE',
  FINALIZE:          'FINALIZE',
  PDF_GENERATE:      'PDF_GENERATE',
  ERROR:             'ERROR',
  DUPLICATE_BLOCKED: 'DUPLICATE_BLOCKED'
};

/* === SERVER-SIDE CACHE (L1 in-memory, per execution) === */

var _CACHE = {
  districtData:       null,
  employeeData:       null,
  checklistQuestions: null,
  lastFetch:          0
};

/* === L2 CacheService helpers (shared across executions / users) === */

function _cacheGet(key) {
  try {
    var c = CacheService.getScriptCache().get(key);
    return c ? JSON.parse(c) : null;
  } catch (e) { Logger.log('Cache get failed: ' + e); return null; }
}
function _cacheSet(key, data, ttl) {
  try {
    var s = JSON.stringify(data);
    if (s.length < 100000) {                 // 100KB per-key limit
      CacheService.getScriptCache().put(key, s, ttl || 600);
    }
  } catch (e) { Logger.log('Cache set failed: ' + e); }
}
function _cacheInvalidate(key) {
  try { CacheService.getScriptCache().remove(key); } catch (e) {}
}

/* Clear all known caches on demand (menu). */
function clearAllCaches() {
  try {
    var keys = ['boot_data', 'district_map', 'emp_master'];
    try { CacheService.getScriptCache().removeAll(keys); } catch (e) { keys.forEach(_cacheInvalidate); }
    _CACHE.districtData = null;
    _CACHE.employeeData = null;
    _CACHE.checklistQuestions = null;
    _CACHE.lastFetch = 0;
    try { SpreadsheetApp.getUi().alert('✅ Cache cleared.\n\nThe next app load will fetch fresh data (districts, employees, boot payload).'); }
    catch (e) { Logger.log('clearAllCaches done'); }
  } catch (e) {
    Logger.log('clearAllCaches: ' + e);
    try { SpreadsheetApp.getUi().alert('Cache clear error: ' + e); } catch (e2) {}
  }
}

/* SCALE: per-supervisor result cache invalidation. Called after that
   supervisor writes, so their माघील अहवाल / stats refresh immediately. */
function _invalidateEmpCaches(empId, date) {
  try {
    if (!empId) return;
    var c = CacheService.getScriptCache();
    c.remove('stats_' + empId);
    c.remove('rep_' + empId + '_all');
    // FIX: माघील अहवाल's per-date cache key ('rep_' + empId + '_YYYY-MM-DD')
    // was never cleared here — only the no-filter 'all' key was. A
    // supervisor who submits, then checks माघील अहवाल with today's date
    // filter already active, could see a stale cached response (missing
    // the just-submitted session) for up to CONFIG.RESULT_CACHE_SEC
    // seconds. Clear it too whenever the caller knows which date changed.
    if (date) c.remove('rep_' + empId + '_' + date);
  } catch (e) {}
}

/* === WEB APP ENTRY === */

function doGet() {
  // SPEED: Index.html has no server-side templating scriptlets, so we skip
  // .evaluate() and serve the file directly — faster on every app open.
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle(CONFIG.APP_NAME)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}
/* EDIT one shift/unit in place — fixed _pending status check. */
function editShift(payload) {
  try {
    var v = _validatePayload(payload, ['sessionId', 'shiftName', 'answers']);
    if (!v.ok) return JSON.stringify({ ok: false, msg: 'अपूर्ण डेटा (कोड: ' + (v.field || '?') + ').' });

    var ownRow = _sessionOwnedBy(payload.sessionId, payload.id);
    if (ownRow === null)  return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    if (ownRow === false) return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });

    var lock = LockService.getUserLock();
    if (!lock.tryLock(8000)) return JSON.stringify({ ok: false, busy: true, msg: 'कृपया थांबा — मागील नोंद सुरू आहे.' });
    try {
      _mergeSessionShifts(payload.sessionId, [{
        shiftName: payload.shiftName,
        answers: payload.answers,
        remarks: payload.remarks || {}
      }]);

      var allShifts = loadPreviousShifts(payload.sessionId);
      _updateSessionRecord(payload.sessionId, allShifts.length, null, '', null);
      _stampModified(payload.sessionId, payload.id);
      _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
      logAction('EDIT_SHIFT', payload.sessionId, { shift: payload.shiftName });

      try {
        if (typeof appendMasterRowsForSession === "function")
          appendMasterRowsForSession(payload.sessionId);
      } catch (e) { Logger.log('master hook: ' + e); }

      var pdfUrl = '', pdfError = '';
      // SPEED: queue the regenerate instead of rendering synchronously —
      // same rationale as submitFullChecklist/finalizeInspection. The edit
      // itself (the part the supervisor is actually waiting on) is already
      // saved by _mergeSessionShifts above.
      _enqueuePDFJob(payload.sessionId);

      return JSON.stringify({
        ok: true,
        msg: '✏️ नोंद अद्ययावत झाली.',
        pdfUrl: pdfUrl,
        pdfError: pdfError
      });
    } finally { lock.releaseLock(); }
  } catch (e) {
    Logger.log('editShift: ' + e);
    logAction(LOG_ACTIONS.ERROR, payload.sessionId || '', { source: 'editShift', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* === REST ROUTER for external static frontend (fetch instead of google.script.run) === */
function doPost(e) {
  var out;
  try {
    var body = JSON.parse(e.postData.contents || '{}');
    var fn   = body.fn;
    var args = body.args || [];
    // whitelist the callable functions (security: never dispatch arbitrary names)
    var ALLOWED = {
      getBootData:1, loginSupervisor:1, lookupSupervisorName:1, getEmployeeStats:1,
      createSession:1, saveShift:1, saveBus:1, finalizeInspection:1,
      editShift:1, editBus:1, deleteSession:1, getSessionForEdit:1, resumeSession:1,
      peekContinuationSession:1, checkChecklistCompletedToday:1,
      getSupervisorReports:1, getReportFullDetail:1, regeneratePDFForSession:1,
      searchPastInspections:1, saveDraft:1, listIncompleteSessions:1,
      createSessionAndSaveShift:1,
      submitFullChecklist:1,
      getSessionPdf:1,
      // Compatibility adapter names (see bottom of file) — kept in sync so
      // the REST router accepts them too, not just google.script.run.
      submitAllShifts:1, saveBusEntry:1, getMyReports:1, generateSessionPdf:1,
      getSessionDetail:1, finalizeBusSession:1, updateUnitAnswers:1, searchReports:1
    };
    if (!ALLOWED[fn]) throw new Error('Function not allowed: ' + fn);
    var result = this[fn].apply(null, args);   // existing functions, unchanged
    out = (typeof result === 'string') ? result : JSON.stringify(result);
  } catch (err) {
    out = JSON.stringify({ ok:false, msg:'Server error: ' + err });
  }
  return ContentService.createTextOutput(out).setMimeType(ContentService.MimeType.JSON);
}
function getAppUrl() {
  try { return ScriptApp.getService().getUrl(); }
  catch (e) { return ''; }
}

/* === AUDIT LOGGING === */

function logAction(action, sessionId, details) {
  try {
    var sh = _getOrCreateSheet(CONFIG.LOG_SHEET, [
      'Timestamp', 'Action', 'Session ID', 'Details', 'User Email'
    ]);
    sh.appendRow([
      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss'),
      action || '',
      sessionId || '',
      typeof details === 'object' ? JSON.stringify(details) : String(details || ''),
      Session.getActiveUser().getEmail() || 'anonymous'
    ]);
  } catch (e) {
    Logger.log('Logger failed: ' + e);
  }
}

/* === TOKEN & SESSION ID GENERATORS === */

function getNextTokenId(district, station) {
  var distCode = _toAreaCode(district, 3);
  var stnCode  = _toAreaCode(station,  4);
  var counterKey = 'TOKEN_CTR_' + distCode + '_' + stnCode;
  // Try briefly for a clean sequential number; if the lock is busy, DON'T throw
  // — fall back to a timestamp-based suffix so a ground-level supervisor never
  // sees a "busy" error.
  try {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(1500)) {
      try {
        var props = PropertiesService.getScriptProperties();
        var n     = parseInt(props.getProperty(counterKey) || '0') + 1;
        props.setProperty(counterKey, String(n));
        return 'MSRTC-' + distCode + '-' + stnCode + '-' + ('0000' + n).slice(-4);
      } finally { lock.releaseLock(); }
    }
  } catch (e) { /* fall through to timestamp token */ }
  // Fallback: still unique (HHmmss + random), guaranteed no collision/no wait.
  var t = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HHmmss');
  var r = ('00' + Math.floor(Math.random() * 100)).slice(-2);
  return 'MSRTC-' + distCode + '-' + stnCode + '-' + t + r;
}

function _toAreaCode(text, len) {
  if (!text) return 'NA';
  var raw = String(text).trim();
  var latin = raw.toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (!latin) latin = _devToLatin(raw).toUpperCase().replace(/[^A-Z0-9 ]/g, '').trim();
  if (!latin) return 'NA';

  var words = latin.split(/\s+/).filter(function (w) { return w; });
  var code;
  if (words.length >= len) {
    code = words.map(function (w) { return w.charAt(0); }).join('');
  } else {
    var w0 = words[0];
    var dense = w0.charAt(0) + w0.slice(1).replace(/[AEIOU]/g, '');
    code = (dense.length >= len) ? dense : w0;
  }
  code = code.replace(/[^A-Z0-9]/g, '');
  if (code.length < len) code = (code + 'XXXX');
  return code.slice(0, len) || 'NA';
}

function _devToLatin(text) {
  var map = {
    'अ':'A','आ':'AA','इ':'I','ई':'I','उ':'U','ऊ':'U','ऋ':'RU','ए':'E','ऐ':'AI','ओ':'O','औ':'AU','अं':'AN','अः':'AH',
    'क':'K','ख':'KH','ग':'G','घ':'GH','ङ':'NG',
    'च':'CH','छ':'CHH','ज':'J','झ':'JH','ञ':'NY',
    'ट':'T','ठ':'TH','ड':'D','ढ':'DH','ण':'N',
    'त':'T','थ':'TH','द':'D','ध':'DH','न':'N',
    'प':'P','फ':'PH','ब':'B','भ':'BH','म':'M',
    'य':'Y','र':'R','ल':'L','व':'V','श':'SH','ष':'SH','स':'S','ह':'H',
    'ळ':'L','क्ष':'KSH','ज्ञ':'DNY',
    'ा':'A','ि':'I','ी':'I','ु':'U','ू':'U','े':'E','ै':'AI','ो':'O','ौ':'AU','ृ':'RU',
    '्':'', 'ं':'N','ः':'H','ँ':'N','़':''
  };
  var out = '';
  for (var i = 0; i < text.length; i++) {
    var two = text.substr(i, 2);
    if (map[two] !== undefined) { out += map[two]; i++; continue; }
    var ch = text.charAt(i);
    out += (map[ch] !== undefined) ? map[ch] : (/[A-Za-z0-9 ]/.test(ch) ? ch : '');
  }
  return out;
}

function _sanitizeForToken(text) {
  if (!text) return 'NA';
  var s = String(text).trim().replace(/[^A-Za-z0-9]/g, '');
  if (!s) s = 'NA';
  return s.length > 12 ? s.substring(0, 12) : s;
}

function getNextSessionId() {
  // Lock-free: the timestamp (to the second) plus a random suffix is unique
  // without any shared counter, so session creation never blocks or throws
  // "busy". We still bump a best-effort counter when the lock is free, but
  // never wait on it.
  var rand = ('000' + Math.floor(Math.random() * 1000)).slice(-3);
  var ts   = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMddHHmmss');
  try {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(800)) {
      try {
        var props = PropertiesService.getScriptProperties();
        var n = parseInt(props.getProperty('SESSION_COUNTER') || '0') + 1;
        props.setProperty('SESSION_COUNTER', String(n));
        rand = ('000' + n).slice(-3);
      } finally { lock.releaseLock(); }
    }
  } catch (e) { /* ignore — fall back to random suffix */ }
  return 'SES-' + ts + '-' + rand;
}

/* === INPUT SANITIZATION & VALIDATION === */

function _sanitizeInput(str) {
  if (!str) return '';
  return String(str).trim().replace(/[<>]/g, '');
}

/* Sheet-cell hardening: neutralize spreadsheet formula/CSV injection.
   setValue('=…') / '+…' / '-…' / '@…' would be evaluated by Sheets (and by
   Excel if the sheet is exported), letting a crafted Station/Name field run
   e.g. =IMPORTXML(evil). Prefixing a leading apostrophe forces the value to be
   stored as plain text; Sheets strips that apostrophe on read, so getValues()
   still returns the original string and the PDF/report output is unchanged.
   Use this for EVERY user-controlled value written into a sheet cell. */
function _sanitizeCell(str) {
  var s = _sanitizeInput(str);
  if (s && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return s;
}

function _validatePayload(payload, requiredFields) {
  if (!payload) {
    Logger.log('[_validatePayload] REJECTED — payload itself is null/undefined. Required fields: ' + requiredFields.join(', '));
    return { ok: false, msg: 'Empty payload.', field: null };
  }
  for (var i = 0; i < requiredFields.length; i++) {
    var f = requiredFields[i];
    if (!payload[f]) {
      // DIAGNOSTIC LOGGING (per request): every validation rejection now logs
      // exactly which field failed plus a snapshot of every required field's
      // actual value, so a false-positive "अपूर्ण डेटा" can be traced to its
      // real cause in Apps Script's Executions log instead of guessed at.
      var snapshot = {};
      requiredFields.forEach(function (rf) {
        var v = payload[rf];
        if (v && typeof v === 'object') {
          snapshot[rf] = Array.isArray(v) ? ('[array, length=' + v.length + ']') : ('[object, keys=' + Object.keys(v).length + ']');
        } else {
          snapshot[rf] = v;
        }
      });
      Logger.log('[_validatePayload] REJECTED on field "' + f + '" — required=[' + requiredFields.join(',') +
                 '] received=' + JSON.stringify(snapshot) +
                 ' sessionId=' + (payload.sessionId || '(none)') +
                 ' id=' + (payload.id || '(none)'));
      return { ok: false, msg: 'Missing field: ' + f, field: f };
    }
  }
  return { ok: true };
}

/* === MASTER DATA === */

function getDistrictData() {
  try {
    var now = new Date().getTime();
    if (_CACHE.districtData && (now - _CACHE.lastFetch) < CONFIG.CACHE_TTL_MS) {
      return _CACHE.districtData;
    }
    var cached = _cacheGet('district_map');
    if (cached && Object.keys(cached).length) { _CACHE.districtData = cached; _CACHE.lastFetch = now; return cached; }

    var sheet = _ss().getSheetByName('DistrictBusStation');
    if (!sheet) return {};
    var rows = sheet.getDataRange().getValues();
    var map  = {};
    for (var i = 1; i < rows.length; i++) {
      var d = String(rows[i][0] || '').trim();
      var s = String(rows[i][1] || '').trim();
      if (!d || !s) continue;
      if (!map[d]) map[d] = [];
      if (map[d].indexOf(s) === -1) map[d].push(s);
    }
    _CACHE.districtData = map;
    _CACHE.lastFetch = now;
    // NEVER cache an empty map — a transient empty read must not poison the
    // cache for 6 hours and leave every user with a blank district dropdown.
    if (Object.keys(map).length) _cacheSet('district_map', map, 21600);  // 6 hours
    return map;
  } catch (e) {
    Logger.log('getDistrictData: ' + e);
    return {};
  }
}

function getChecklistQuestions() {
  try { return FALLBACK_QUESTIONS; }
  catch (e) { Logger.log('getChecklistQuestions: ' + e); return FALLBACK_QUESTIONS; }
}

/* Returns WHY districts may be empty: is the spreadsheet bound? which sheets
   exist? does DistrictBusStation exist and how many rows? */
function _bootDiagnostics() {
  var d = { spreadsheetBound: false, sheets: [], hasDistrictSheet: false, districtRows: 0, sample: '', error: '' };
  try {
    var ss = _ss();
    if (!ss) { d.error = 'getActiveSpreadsheet() is NULL — the script is not bound to a spreadsheet. Open the sheet ▸ Extensions ▸ Apps Script, or set the spreadsheet ID.'; return d; }
    d.spreadsheetBound = true;
    ss.getSheets().forEach(function (s) { d.sheets.push(s.getName()); });
    var sh = ss.getSheetByName('DistrictBusStation');
    if (sh) {
      d.hasDistrictSheet = true;
      d.districtRows = sh.getLastRow();
      if (sh.getLastRow() >= 1) {
        var rowsToRead = Math.min(2, sh.getLastRow());
        d.sample = sh.getRange(1, 1, rowsToRead, 2).getValues().map(function (r) { return r.join(' | '); }).join('  //  ');
      }
    }
  } catch (e) { d.error = String(e); }
  return d;
}

/* Single boot call — districts + employees + questions in ONE round-trip. */
function getBootData() {
  var _t0 = new Date().getTime();
  try {
    var cached = _cacheGet('boot_data');
    if (cached && cached.districts && Object.keys(cached.districts).length) {
      Logger.log('[boot] cache hit ' + (new Date().getTime() - _t0) + 'ms');
      return JSON.stringify(cached);
    }
    var boot = {
      districts: getDistrictData(),
      employees: [],                 // intentionally empty — not needed at boot
      questions: FALLBACK_QUESTIONS
    };
    // If empty, attach diagnostics so the client can show the exact cause.
    if (!Object.keys(boot.districts).length) {
      boot._diag = _bootDiagnostics();
    } else {
      // Only cache a GOOD payload. An empty one must never be cached, or the
      // blank dropdown sticks for 6 hours after the sheet is fixed.
      _cacheSet('boot_data', boot, 21600);
    }
    Logger.log('[boot] cold build ' + (new Date().getTime() - _t0) + 'ms');
    return JSON.stringify(boot);
  } catch (e) {
    Logger.log('getBootData: ' + e);
    return JSON.stringify({ districts: {}, employees: [], questions: FALLBACK_QUESTIONS });
  }
}

/* =====================================================================
   REQ-04: WEB LOGIN — username = Employee ID, password = Employee ID (default)
   ===================================================================== */
/* Look up a supervisor's name by Employee ID (for the ID-only home screen). */
function lookupSupervisorName(empId) {
  try {
    var idClean = String(empId || '').trim();
    if (!idClean || !/^\d+$/.test(idClean)) return JSON.stringify({ ok: false });
    var sheet = _ss().getSheetByName('Employee_Master');
    if (!sheet || sheet.getLastRow() < 2) return JSON.stringify({ ok: false });
    var lastCol = sheet.getLastColumn();
    var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var cId = hdr.indexOf('employee id'); if (cId < 0) cId = 0;
    var cName = hdr.indexOf('supervisor name'); if (cName < 0) cName = 1;
    var hit = sheet.getRange(2, cId + 1, sheet.getLastRow() - 1, 1)
                   .createTextFinder(idClean).matchEntireCell(true).findNext();
    if (!hit) return JSON.stringify({ ok: false });
    var name = String(sheet.getRange(hit.getRow(), cName + 1).getValue() || '').trim();
    return JSON.stringify({ ok: true, id: idClean, name: name });
  } catch (e) {
    Logger.log('lookupSupervisorName: ' + e);
    return JSON.stringify({ ok: false });
  }
}

function loginSupervisor(empId, password) {
  try {
    var idClean = String(empId || '').trim();
    var pwClean = String(password || '').trim();

    if (!idClean) return JSON.stringify({ ok: false, code: 'EMPTY_ID', msg: '❌ कर्मचारी आयडी आवश्यक आहे. / Employee ID is required.' });
    if (!/^\d+$/.test(idClean)) return JSON.stringify({ ok: false, code: 'BAD_ID', msg: '❌ कर्मचारी आयडी फक्त संख्या असावा (उदा: 1001). / Employee ID must be numeric.' });
    if (!pwClean) return JSON.stringify({ ok: false, code: 'EMPTY_PW', msg: '❌ पासवर्ड आवश्यक आहे. / Password is required.' });

    var ss = _ss();
    var sheet = ss.getSheetByName('Employee_Master');
    if (!sheet) return JSON.stringify({ ok: false, code: 'NO_MASTER', msg: '❌ Employee_Master सापडले नाही. / Supervisor records not found.' });
    if (sheet.getLastRow() < 2) return JSON.stringify({ ok: false, code: 'NO_RECORDS', msg: '❌ कोणतेही पर्यवेक्षक रेकॉर्ड नाहीत. / No supervisor records.' });

    var lastCol = sheet.getLastColumn();
    var hdr = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
    var cId   = hdr.indexOf('employee id');
    var cName = hdr.indexOf('supervisor name');
    var cPw   = hdr.indexOf('password');
    var cAct  = hdr.indexOf('active');
    if (cId < 0)   cId = 0;
    if (cName < 0) cName = 1;

    var match = null;
    var tf = sheet.getRange(2, cId + 1, sheet.getLastRow() - 1, 1)
                  .createTextFinder(idClean).matchEntireCell(true).findNext();
    if (tf) match = sheet.getRange(tf.getRow(), 1, 1, lastCol).getValues()[0];
    if (!match) return JSON.stringify({ ok: false, code: 'NOT_FOUND', msg: '❌ कर्मचारी आयडी "' + idClean + '" आढळला नाही. / Account not found.' });

    if (cAct >= 0) {
      var act = String(match[cAct] || '').trim().toLowerCase();
      var inactive = (act === 'false' || act === 'no' || act === 'न' || act === 'inactive' || act === '0');
      if (inactive) return JSON.stringify({ ok: false, code: 'INACTIVE', msg: '❌ हे खाते सक्रिय नाही. / Account is not active.' });
    }

    var expected = idClean;
    if (cPw >= 0) {
      var custom = String(match[cPw] || '').trim();
      if (custom) expected = custom;
    }
    if (pwClean !== expected) {
      return JSON.stringify({ ok: false, code: 'BAD_PW', msg: '❌ पासवर्ड चुकीचा आहे. / Incorrect password.' });
    }

    var name = String(match[cName] || '').trim();
    logAction('LOGIN', '', { id: idClean });
    return JSON.stringify({ ok: true, employee: { id: idClean, name: name }, msg: '✅ लॉगिन यशस्वी. / Login successful.' });
  } catch (e) {
    Logger.log('loginSupervisor: ' + e);
    return JSON.stringify({ ok: false, code: 'ERROR', msg: 'त्रुटी / Error: ' + e.toString() });
  }
}

function getEmployeeMaster() {
  try {
    var now = new Date().getTime();
    if (_CACHE.employeeData && (now - _CACHE.lastFetch) < CONFIG.CACHE_TTL_MS) {
      return _CACHE.employeeData;
    }
    var cached = _cacheGet('emp_master');
    if (cached) { _CACHE.employeeData = cached; _CACHE.lastFetch = now; return cached; }

    var ss    = _ss();
    var sheet = ss.getSheetByName('Employee_Master');
    if (!sheet) {
      sheet = ss.insertSheet('Employee_Master');
      sheet.getRange(1, 1, 1, 2)
        .setValues([['Employee ID', 'Supervisor Name']])
        .setBackground('#002B6B').setFontColor('#FFC400').setFontWeight('bold');
      sheet.getRange(2, 1, 3, 2).setValues([
        ['1001', 'राजेश पाटील'],
        ['2568', 'सुनीता देशमुख'],
        ['9875', 'अजय शिंदे']
      ]);
    }
    var rows = sheet.getDataRange().getValues();
    var list = [];
    for (var i = 1; i < rows.length; i++) {
      var id   = String(rows[i][0] || '').trim();
      var name = String(rows[i][1] || '').trim();
      if (id && name) list.push({ id: id, name: name });
    }
    _CACHE.employeeData = list;
    _CACHE.lastFetch = now;
    _cacheSet('emp_master', list, 600);
    return list;
  } catch (e) {
    Logger.log('getEmployeeMaster: ' + e);
    return [];
  }
}

function validateEmployee(empId, empName) {
  try {
    if (!empId || !empName) {
      return JSON.stringify({ ok: false, msg: 'कर्मचारी आयडी आणि नाव आवश्यक.' });
    }
    if (!/^\d+$/.test(String(empId).trim())) {
      return JSON.stringify({ ok: false, msg: '❌ कर्मचारी आयडी फक्त संख्या असावा (उदा: 1001).' });
    }
    var employees = getEmployeeMaster();
    var idClean   = String(empId).trim();
    var nameClean = String(empName).trim();
    var byId      = employees.filter(function (e) { return e.id === idClean; });
    if (byId.length === 0) {
      return JSON.stringify({ ok: false, msg: '❌ कर्मचारी आयडी "' + empId + '" डेटाबेसमध्ये आढळला नाही.' });
    }
    if (byId[0].name !== nameClean) {
      return JSON.stringify({ ok: false, msg: '❌ नाव जुळत नाही! आयडी "' + empId + '" साठी: ' + byId[0].name });
    }
    return JSON.stringify({ ok: true, employee: byId[0], msg: '✅ प्रमाणित.' });
  } catch (e) {
    Logger.log('validateEmployee: ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

/* === SHEET ARCHITECTURE === */

function getSessionsSheet() {
  var sh = _getOrCreateSheet('Inspection_Sessions', [
    'Session ID', 'Token ID', 'District', 'Station',
    'Supervisor Name', 'Employee ID', 'Checklist Type', 'Checklist Key',
    'Created Time', 'Last Updated', 'Completed Shifts',
    'Total Buses', 'Status', 'PDF URL',
    'Last Modified', 'Modified By',
    'Total Shifts'
  ]);
  _lockDateColumnsAsText(sh);   // ← ADD THIS LINE
  return sh;
}

var SESSION_SHEET_HEADERS = [
  'Session ID', 'Token ID', 'District', 'Station',
  'Supervisor Name', 'Employee ID', 'Checklist Type', 'Checklist Key',
  'Created Time', 'Last Updated', 'Completed Shifts',
  'Total Buses', 'Status', 'PDF URL',
  'Last Modified', 'Modified By',
  'Total Shifts'
];

/* =====================================================================
   SESSION CHAIN — automatic multi-spreadsheet overflow for
   Inspection_Sessions only. Employee_Master, DistrictBusStation, and
   Audit_Log are NEVER part of this chain; they continue to resolve
   exclusively through _ss() (link 1 / CONFIG.SPREADSHEET_ID).

   Link 1 is always CONFIG.SPREADSHEET_ID. When link 1 (or whichever
   link is currently active) nears the 10M-cell ceiling, a brand-new
   spreadsheet is created automatically and appended to the chain — new
   sessions start flowing there. This can repeat indefinitely (link 2,
   3, 4, …). Existing rows NEVER move between links once written — only
   the choice of where a brand-new session gets created can advance to
   the next link. The chain's spreadsheet IDs (beyond link 1, which is
   always CONFIG.SPREADSHEET_ID) are tracked in Script Properties.

   Anything that operates on a SPECIFIC, already-existing sessionId
   (edit, resume, PDF generation, delete, …) must locate it via
   _locateSession(sessionId), which searches every link — a session can
   live in any link, not just the currently active one. Anything that
   lists/searches across MANY sessions (माघील अहवाल, search,
   continuation lookup) must iterate _chainIds() and merge results.
   ===================================================================== */

var SESSION_CHAIN_PROP        = 'SESSION_CHAIN_IDS';        // JSON array of link 2+ spreadsheet IDs
var SESSION_CHAIN_CACHE_KEY   = 'session_chain_active_id';  // CacheService key for the active-link decision
var SESSION_CHAIN_NEAR_LIMIT  = 9300000;                    // ~93% of 10M — safety margin before the hard error
var _CHAIN_SS_CACHE  = {};    // chainId -> Spreadsheet, memoized per execution
var _CHAIN_SH_CACHE  = {};    // chainId -> Sheet,        memoized per execution
var _LOC_CACHE       = {};    // sessionId -> {sheet,row,chainId}  — SPEED: avoid repeat TextFinder
var _CHAIN_IDS_CACHE = null;  // ordered [link1Id, link2Id, …]    — SPEED: avoid repeat Property reads

/* Ordered list of every chain link's spreadsheet ID, link 1 first.
   Link 1 is always CONFIG.SPREADSHEET_ID — this is enforced here, not
   just assumed, so a corrupted/missing property can never silently drop
   the primary spreadsheet from the chain. */
function _chainIds() {
  if (_CHAIN_IDS_CACHE) return _CHAIN_IDS_CACHE;
  var props = PropertiesService.getScriptProperties();
  var raw = props.getProperty(SESSION_CHAIN_PROP);
  var extra = [];
  if (raw) { try { extra = JSON.parse(raw) || []; } catch (e) { extra = []; } }
  extra = extra.filter(function (id) { return id && id !== CONFIG.SPREADSHEET_ID; });
  _CHAIN_IDS_CACHE = [CONFIG.SPREADSHEET_ID].concat(extra);
  return _CHAIN_IDS_CACHE;
}

function _chainSS(chainId) {
  if (_CHAIN_SS_CACHE[chainId]) return _CHAIN_SS_CACHE[chainId];
  var ss = (chainId === CONFIG.SPREADSHEET_ID) ? _ss() : SpreadsheetApp.openById(chainId);
  _CHAIN_SS_CACHE[chainId] = ss;
  return ss;
}

/* Inspection_Sessions sheet for a given chain link, created with the
   same headers/formatting/date-locking as link 1 if it doesn't exist
   yet (true the first time a new overflow link is created). */
function _chainSessionsSheet(chainId) {
  if (_CHAIN_SH_CACHE[chainId]) return _CHAIN_SH_CACHE[chainId];
  if (chainId === CONFIG.SPREADSHEET_ID) {
    var sh0 = getSessionsSheet();
    _CHAIN_SH_CACHE[chainId] = sh0;
    return sh0;
  }
  var ss = _chainSS(chainId);
  var sh = _getOrCreateSheet('Inspection_Sessions', SESSION_SHEET_HEADERS, ss);
  _lockDateColumnsAsText(sh);
  _ensureJsonCols(sh);
  _CHAIN_SH_CACHE[chainId] = sh;
  return sh;
}

/* Total reserved grid cells (rows × cols, summed across every tab) for
   a spreadsheet — counts the same way Google's 10M-cell limit does
   (the reserved grid, not just cells with data in them). */
function _isSheetNearLimit(ss) {
  var total = 0;
  ss.getSheets().forEach(function (sh) { total += sh.getMaxRows() * sh.getMaxColumns(); });
  return total >= SESSION_CHAIN_NEAR_LIMIT;
}

/* Which chain link should a BRAND-NEW session be written to right now?
   Normally just the last link in the chain. If that link is near its
   limit, a new spreadsheet is created and appended to the chain — under
   a lock, with a re-check after acquiring it, in case another execution
   already advanced the chain while this one was waiting. The decision
   is cached briefly so this never does a getMaxRows()/getMaxColumns()
   scan on every single save — only re-checked periodically. */
function _activeChainId() {
  var cache = CacheService.getScriptCache();
  var cached = cache.get(SESSION_CHAIN_CACHE_KEY);
  if (cached) return cached;

  var ids = _chainIds();
  var lastId = ids[ids.length - 1];
  var lastSS = _chainSS(lastId);

  if (_isSheetNearLimit(lastSS)) {
    var lock = LockService.getScriptLock();
    if (lock.tryLock(20000)) {
      try {
        ids = _chainIds();               // re-read — may have changed under lock contention
        lastId = ids[ids.length - 1];
        lastSS = _chainSS(lastId);
        if (_isSheetNearLimit(lastSS)) {
          var newSS = SpreadsheetApp.create('MSRTC_Inspection_Sessions_Link_' + (ids.length + 1));
          var newId = newSS.getId();
          _CHAIN_SS_CACHE[newId] = newSS;
          var realSheet = _getOrCreateSheet('Inspection_Sessions', SESSION_SHEET_HEADERS, newSS);
          _lockDateColumnsAsText(realSheet);
          _ensureJsonCols(realSheet);
          _CHAIN_SH_CACHE[newId] = realSheet;
          // Apps Script auto-creates a blank "Sheet1" — remove it now that
          // the real sheet exists (can't delete the LAST remaining sheet).
          try {
            var defSheet = newSS.getSheetByName('Sheet1');
            if (defSheet && newSS.getSheets().length > 1) newSS.deleteSheet(defSheet);
          } catch (eDel) { Logger.log('[chain] could not remove default Sheet1: ' + eDel); }

          var props = PropertiesService.getScriptProperties();
          var extraIds = ids.slice(1).concat([newId]);  // everything after link 1, plus the new one
          props.setProperty(SESSION_CHAIN_PROP, JSON.stringify(extraIds));
          _CHAIN_IDS_CACHE = null;   // force re-read on next _chainIds() call in this execution
          lastId = newId;
          Logger.log('[chain] Created overflow link #' + (ids.length + 1) + ': ' + newId);
        }
      } finally { try { lock.releaseLock(); } catch (e2) {} }
    }
  }

  cache.put(SESSION_CHAIN_CACHE_KEY, lastId, 1800);   // recheck capacity every 30 min
  return lastId;
}

/* Finds a specific session anywhere in the chain. Checks the currently
   active link FIRST (most lookups are for recent/active work, so this
   is the common-case fast path), then every other link in order.
   Returns {sheet, row, chainId} or null if the session doesn't exist
   anywhere in the chain. This is the ONLY correct way to resolve an
   existing sessionId once more than one chain link can exist — a
   session can live in any link, not necessarily the active one, since
   existing rows never move once written. */
   var _LOC_CS_PFX = 'LOC::';   // CacheService key prefix for cross-execution row cache
function _locateSession(sessionId) {
  if (!sessionId) return null;
  if (_LOC_CACHE[sessionId]) return _LOC_CACHE[sessionId];   // execution-level hit — free

  // Cross-execution cache: survives between bus saves (each = new execution).
  try {
    var _cs = CacheService.getScriptCache();
    var _cv = _cs.get(_LOC_CS_PFX + sessionId);
    if (_cv) {
      var _cp = JSON.parse(_cv);
      var _csh = _chainSessionsSheet(_cp.c);
      // VERIFY the cached row still actually holds this sessionId. Row numbers
      // shift whenever ANY delete path removes a row above it
      // (_cleanupDuplicateSessions, cleanupEmptyShellSessions, archiveOldSessions),
      // and those paths do NOT clear this cache. An unverified stale row silently
      // redirects reads/writes — bus counts, PDF URL, the bus-JSON append itself —
      // onto the WRONG (or blank) row. That is what produced the orphan rows with
      // a PDF URL but no Session ID. One getValue() per cached hit is a cheap
      // price for guaranteed correctness on a government system.
      try {
        var _vm  = _headerMap(_csh);
        var _vid = String(_csh.getRange(_cp.r, _vm['Session ID'] + 1).getValue() || '');
        if (_vid === String(sessionId)) {
          var resultC = { sheet: _csh, row: _cp.r, chainId: _cp.c };
          _LOC_CACHE[sessionId] = resultC;
          return resultC;
        }
        _cs.remove(_LOC_CS_PFX + sessionId);   // stale → drop, fall through to TextFinder
      } catch (_ve) {
        _cs.remove(_LOC_CS_PFX + sessionId);
      }
    }
  } catch (_ce) {}

  // Full TextFinder scan (cache miss) — checks the active link first.
  var ids = _chainIds();
  var activeId = ids[ids.length - 1];
  var ordered = [activeId].concat(ids.filter(function (id) { return id !== activeId; }));
  for (var i = 0; i < ordered.length; i++) {
    var sh = _chainSessionsSheet(ordered[i]);
    var rows = _findRowsByColumn(sh, 'Session ID', sessionId);
    if (rows.length) {
      var result = { sheet: sh, row: rows[rows.length - 1], chainId: ordered[i] };
      _LOC_CACHE[sessionId] = result;
      try {
        CacheService.getScriptCache().put(
          _LOC_CS_PFX + sessionId,
          JSON.stringify({ r: result.row, c: result.chainId }),
          600   // 10 min
        );
      } catch (_pe) {}
      return result;
    }
  }
  return null;
}

/* Finds orphan rows in Inspection_Sessions — rows with NO Session ID but with
   other data (counts, status, PDF URL) — caused by the stale-row-cache bug.
   For each: if it carries a PDF URL, tries to find the real session that PDF
   belongs to and move the URL back; then removes the identity-less row.
   Read-only PASS first (pass false), then run with true to apply. */
function recoverOrphanSessionRows(apply) {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  L('===== ORPHAN ROW RECOVERY (' + (apply ? 'APPLY' : 'DRY RUN') + ') =====\n');

  var ids = _chainIds();
  var totalOrphans = 0, urlsRehomed = 0, rowsDeleted = 0;

  // Build a quick PDF-URL → real session row index across all links.
  var urlToRow = {};   // pdfUrl -> {sh, c, row, sid}
  ids.forEach(function (id) {
    var sh = _chainSessionsSheet(id), c = _headerMap(sh);
    if (sh.getLastRow() < 2) return;
    var n = sh.getLastRow() - 1;
    var sidCol = sh.getRange(2, c['Session ID'] + 1, n, 1).getValues();
    var urlCol = (c['PDF URL'] !== undefined) ? sh.getRange(2, c['PDF URL'] + 1, n, 1).getValues() : null;
    for (var i = 0; i < n; i++) {
      var sid = String(sidCol[i][0] || '').trim();
      var url = urlCol ? String(urlCol[i][0] || '').trim() : '';
      if (sid && url) urlToRow[url] = { sh: sh, c: c, row: i + 2, sid: sid };
    }
  });

  ids.forEach(function (id, li) {
    var sh = _chainSessionsSheet(id), c = _headerMap(sh);
    if (sh.getLastRow() < 2) return;
    var n = sh.getLastRow() - 1;
    var data = sh.getRange(2, 1, n, sh.getLastColumn()).getValues();
    var toDelete = [];

    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var sid = String(row[c['Session ID']] || '').trim();
      if (sid) continue;   // has identity → fine

      // No Session ID. Does it carry ANY other data? (counts/status/url/json)
      var url    = c['PDF URL'] !== undefined ? String(row[c['PDF URL']] || '').trim() : '';
      var status = c['Status']  !== undefined ? String(row[c['Status']]  || '').trim() : '';
      var done   = parseInt(row[c['Completed Shifts']] || 0, 10) || 0;
      var buses  = parseInt(row[c['Total Buses']] || 0, 10) || 0;
      var sj = c[SHIFTS_JSON_COL] !== undefined ? String(row[c[SHIFTS_JSON_COL]] || '') : '';
      var bj = c[BUSES_JSON_COL]  !== undefined ? String(row[c[BUSES_JSON_COL]]  || '') : '';
      var hasRealJson = (sj && sj !== '[]') || (bj && bj !== '[]');

      if (!url && !status && !done && !buses && !hasRealJson) {
        // completely blank row — harmless, skip (let cleanup handle it)
        continue;
      }

      totalOrphans++;
      L('ORPHAN @ link' + (li+1) + ' row ' + (i+2) +
        ': url=' + (url ? 'yes' : 'no') + ' status=' + status +
        ' shifts=' + done + ' buses=' + buses + ' hasJSON=' + hasRealJson);

      // Try to re-home a stray PDF URL onto the real session that owns it,
      // but ONLY if that real session currently has NO url (don't overwrite).
      if (url && !hasRealJson && urlToRow[url]) {
        var tgt = urlToRow[url];
        L('   → PDF URL already belongs to ' + tgt.sid + ' (no action needed)');
      } else if (url && hasRealJson) {
        L('   ⚠️ orphan has its OWN JSON data — NOT auto-deleting. Inspect manually.');
        continue;   // safety: real lost work — never delete automatically
      }

      // Safe to remove: identity-less AND no standalone JSON answers of its own.
      if (!hasRealJson) toDelete.push(i + 2);
      else L('   ⚠️ kept (has JSON answers but no Session ID) — needs manual review.');
    }

    if (apply && toDelete.length) {
      toDelete.sort(function (a, b) { return b - a; });
      toDelete.forEach(function (rn) { sh.deleteRow(rn); });
      _LOC_CACHE = {};
      rowsDeleted += toDelete.length;
    } else if (toDelete.length) {
      L('   (dry run) would delete ' + toDelete.length + ' identity-less row(s) on link ' + (li+1));
    }
  });

  L('\nOrphans found: ' + totalOrphans + ' | rows deleted: ' + rowsDeleted +
    (apply ? '' : '  (DRY RUN — nothing changed)'));
  if (apply) { try { clearAllCaches(); } catch (e) {} }
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg.length > 8000 ? msg.slice(0,8000)+'\n…(see Logs)' : msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

/* Run from the editor with the token shown on the supervisor's success
   screen, e.g. diagnoseBusSession('MSRTC-PUN-SWGT-0007').
   Reveals whether 20→15 is a SPLIT (buses spread across 2 rows = the
   cache bug) or a true LOSS (buses never reached the server = outbox). */
function diagnoseBusSession(tokenOrSessionId) {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  var t = String(tokenOrSessionId || '').trim();
  L('===== BUS SESSION DIAGNOSTIC =====');
  L('Query: ' + t + '\n');

  var ids = _chainIds();
  var target = null, station = '', dateDay = '';

  // Locate the row by Session ID first, else by Token ID, across all links.
  for (var li = 0; li < ids.length && !target; li++) {
    var sh = _chainSessionsSheet(ids[li]);
    var c  = _headerMap(sh);
    var rows = _findRowsByColumn(sh, 'Session ID', t);
    if (!rows.length) rows = _findRowsByColumn(sh, 'Token ID', t);
    if (rows.length) {
      var r = rows[rows.length - 1];
      var v = _readRows(sh, [r])[0].values;
      target = { sh: sh, c: c, row: r, link: li + 1, v: v };
      station = String(v[c['Station']] || '').trim();
      dateDay = (_normalizeCreated(v[c['Created Time']]) || '').split(' ')[0];
    }
  }
  if (!target) { L('❌ Not found in any chain link.'); _alertJoin(out); return out.join('\n'); }

  var c = target.c, v = target.v;
  var sid   = String(v[c['Session ID']] || '');
  var key   = String(v[c['Checklist Key']] || '').trim();
  var colTB = parseInt(v[c['Total Buses']] || 0, 10) || 0;
  var jsonBuses = loadPreviousBuses(sid);

  L('FOUND (chain link ' + target.link + ', row ' + target.row + '):');
  L('  Session ID:        ' + sid);
  L('  Station:           ' + station + '   Date: ' + dateDay);
  L('  Checklist Key:     ' + key + '   Status: ' + String(v[c['Status']] || ''));
  L('  Total Buses COLUMN: ' + colTB);
  L('  Buses in JSON store: ' + jsonBuses.length + (colTB !== jsonBuses.length ? '   ⚠️ MISMATCH (count column is wrong)' : ''));
  L('  Bus numbers in JSON: ' + jsonBuses.map(function(b){return b.busNumber;}).join(', '));

  // SPLIT CHECK: any OTHER bw/bm session, same station + same day?
  L('\n--- Other bus sessions, same station + same day ---');
  var others = 0, otherTotal = 0;
  ids.forEach(function (id) {
    var sh2 = _chainSessionsSheet(id), c2 = _headerMap(sh2);
    var rn = _findRowsByColumn(sh2, 'Station', station);
    _readRows(sh2, rn).forEach(function (o) {
      var ov = o.values, osid = String(ov[c2['Session ID']] || '');
      if (osid === sid) return;
      var ok2 = String(ov[c2['Checklist Key']] || '').trim();
      var meta = CHECKLIST_META[ok2] || {};
      if (meta.mode !== 'bus') return;
      var oday = (_normalizeCreated(ov[c2['Created Time']]) || '').split(' ')[0];
      if (oday !== dateDay) return;
      var ob = loadPreviousBuses(osid).length;
      others++; otherTotal += ob;
      L('  • ' + osid + '  status=' + String(ov[c2['Status']] || '') +
        '  col=' + (parseInt(ov[c2['Total Buses']]||0,10)||0) + '  JSON=' + ob +
        '  buses=' + loadPreviousBuses(osid).map(function(b){return b.busNumber;}).join(','));
    });
  });
  if (!others) {
    L('  (none) → buses did NOT split. Missing buses never reached the server');
    L('  (stuck in the supervisor device outbox, or save errored). NOT the cache bug.');
  } else {
    L('\n  ⚠️ ' + others + ' other bus session(s) found, holding ' + otherTotal + ' buses.');
    L('  TOTAL across all rows = ' + (jsonBuses.length + otherTotal) +
      ' → this is a SPLIT. The cache fix prevents new splits; merge these rows to recover.');
  }
  _alertJoin(out);
  return out.join('\n');
}
function _alertJoin(out){ var m=out.join('\n'); try{SpreadsheetApp.getUi().alert(m.length>8000?m.slice(0,8000)+'\n…(see Logs)':m);}catch(e){Logger.log(m);} }

/* Times each stage of PDF generation for one session so you can see the real
   bottleneck instead of guessing. Run: timePdfGeneration('MSRTC-PUN-SWGT-0007') */
function timePdfGeneration(tokenOrSessionId) {
  var t = String(tokenOrSessionId || '').trim();
  var ids = _chainIds(), sid = '';
  for (var li = 0; li < ids.length && !sid; li++) {
    var sh = _chainSessionsSheet(ids[li]);
    var rows = _findRowsByColumn(sh, 'Session ID', t);
    if (!rows.length) rows = _findRowsByColumn(sh, 'Token ID', t);
    if (rows.length) sid = String(_readRows(sh, [rows[rows.length-1]])[0].values[_headerMap(sh)['Session ID']]);
  }
  if (!sid) { var m0='❌ not found'; try{SpreadsheetApp.getUi().alert(m0);}catch(e){} return m0; }

  function ms(fn){ var a=Date.now(); var r=fn(); return { t: Date.now()-a, r:r }; }
  var s1 = ms(function(){ return getSessionDataForPDF(sid); });
  var payload = s1.r; if (payload) payload._pending = false;
  var s2 = ms(function(){ return payload ? generateCombinedPDF(payload) : null; });

  var msg = '⏱ PDF TIMING for ' + sid + '\n\n' +
    '1) getSessionDataForPDF: ' + s1.t + ' ms\n' +
    '2) generateCombinedPDF:  ' + s2.t + ' ms   ← the one that matters\n\n' +
    (s2.t > 6000 ? '→ Render is the bottleneck. Apply the font fix below.\n'
                 : '→ Render is fast. Your problem is UX (supervisor leaves before the poll). See Step 4.\n') +
    'PDF: ' + (s2.r || 'FAILED');
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function getShiftResponsesSheet() {
  return _getOrCreateSheet('Shift_Responses', [
    'Session ID', 'Token ID', 'District', 'Station',
    'Supervisor Name', 'Employee ID', 'Checklist Type', 'Shift Name',
    'Question', 'Answer', 'Remark', 'Timestamp'
  ]);
}

function getBusResponsesSheet() {
  return _getOrCreateSheet('Bus_Responses', [
    'Session ID', 'Token ID', 'District', 'Station',
    'Supervisor Name', 'Employee ID', 'Checklist Type', 'Bus Number',
    'Question', 'Answer', 'Remark', 'Timestamp'
  ]);
}

function getDraftSheet() {
  return _getOrCreateSheet('Draft_Sessions', [
    'Session ID', 'Draft JSON', 'Last Updated'
  ]);
}

/* =====================================================================
   SCALE HELPERS — TextFinder-based row location
   ===================================================================== */

/* Header → 0-based column index map for a sheet (cached per execution). */
var _HDR_CACHE = {};
function _headerMap(sh) {
  var key = sh.getParent().getId() + '::' + sh.getName();
  if (_HDR_CACHE[key]) return _HDR_CACHE[key];
  var lastCol = Math.max(sh.getLastColumn(), 1);
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var map = {};
  headers.forEach(function (h, i) { map[String(h).trim()] = i; });
  map.__lastCol = lastCol;
  _HDR_CACHE[key] = map;
  return map;
}

/* Find the 1-based row numbers where `value` appears in a given column.
   Exact, case-sensitive, whole-cell match. Returns [] on no match. */
function _findRowsByColumn(sh, colName, value) {
  try {
    var map = _headerMap(sh);
    var col = map[colName];
    if (col === undefined) return [];
    var lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    var finder = sh.getRange(2, col + 1, lastRow - 1, 1)
                   .createTextFinder(String(value))
                   .matchEntireCell(true)
                   .matchCase(true);
    var found = finder.findAll();
    var rows = [];
    for (var i = 0; i < found.length; i++) rows.push(found[i].getRow());
    return rows;
  } catch (e) {
    Logger.log('[_findRowsByColumn] ' + colName + '=' + value + ' :: ' + e);
    return [];
  }
}

/* =====================================================================
   FIX A — _readRows: blocked contiguous-run reads.
   OLD: one getRange() per row → a session with 90 response rows cost 90
   Sheets calls (~9s) on every save / resume / PDF.
   NEW: consecutive row numbers are grouped into runs; each run is read
   with ONE getRange(). Only the requested rows are returned (preserves
   the FIX-3 correctness guarantee for non-contiguous rows after edits),
   and output order matches the CALLER'S input order (getSupervisorReports
   passes newest-first row numbers and relies on that).
   ===================================================================== */
function _readRows(sh, rowNums) {
  if (!rowNums || !rowNums.length) return [];
  var map = _headerMap(sh);
  var lastCol = map.__lastCol;

  var sorted = rowNums.slice().sort(function (a, b) { return a - b; });
  var byRow = {};
  var i = 0;
  while (i < sorted.length) {
    var start = sorted[i], end = start;
    while (i + 1 < sorted.length && sorted[i + 1] <= end + 1) {
      i++;
      if (sorted[i] > end) end = sorted[i];
    }
    var block = sh.getRange(start, 1, end - start + 1, lastCol).getValues();
    for (var r = 0; r < block.length; r++) byRow[start + r] = block[r];
    i++;
  }
  return rowNums.map(function (rn) { return { row: rn, values: byRow[rn] }; });
}

/* All rows for one Session ID in a response sheet, via TextFinder on col A. */
function _rowsForSession(sh, sessionId) {
  var rows = _findRowsByColumn(sh, 'Session ID', sessionId);
  if (!rows.length) return { headers: _headerMap(sh), data: [] };
  rows.sort(function (a, b) { return a - b; });
  var map  = _headerMap(sh);
  var data = _readRows(sh, rows).map(function (o) { return o.values; });
  return { headers: map, data: data };
}

var _SS_CACHE = null;    // SPEED: memoized spreadsheet handle (O(1) per execution)
function _ss() { return _SS_CACHE || (_SS_CACHE = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)); }

/* SPEED: read ONE column (values only). O(R) cells instead of O(R×C) for a
   full getDataRange() — typically a 16× smaller payload on the Sessions
   sheet. Returns [] for an empty sheet. */
function _colValues(sh, colName) {
  var map = _headerMap(sh);
  var col = map[colName];
  if (col === undefined || sh.getLastRow() < 2) return [];
  return sh.getRange(2, col + 1, sh.getLastRow() - 1, 1).getValues()
           .map(function (r) { return r[0]; });
}

var _SHEET_CACHE = {};   // SPEED: per-execution sheet handles (headers verified once)
function _getOrCreateSheet(name, headers, targetSS) {
  var ss = targetSS || _ss();
  var cacheKey = ss.getId() + '::' + name;
  if (_SHEET_CACHE[cacheKey]) return _SHEET_CACHE[cacheKey];
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, headers.length)
      .setValues([headers])
      .setBackground('#002B6B')
      .setFontColor('#FFC400')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    sh.setFrozenRows(1);
    sh.setRowHeight(1, 32);
  } else {
    var existingHeaders = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getValues()[0];
    var changed = false;
    headers.forEach(function (h, idx) {
      if (existingHeaders[idx] !== h) { sh.getRange(1, idx + 1).setValue(h); changed = true; }
    });
    if (changed) {
      sh.getRange(1, 1, 1, headers.length)
        .setBackground('#002B6B').setFontColor('#FFC400').setFontWeight('bold');
      delete _HDR_CACHE[cacheKey];  // flush stale header cache
    }
  }
  _SHEET_CACHE[cacheKey] = sh;
  return sh;
}

/* === DRAFT / RESUME === */

function saveDraft(sessionId, draftObj) {
  try {
    // AUTHZ: if a session row already exists for this id, only its owner may
    // overwrite the draft. _sessionOwnedBy returns false only when the row
    // exists AND belongs to a different employee; null (no such row yet — the
    // common "draft before the session is created" case) falls through and is
    // allowed, so the normal new-draft flow is unaffected.
    if (sessionId) {
      var _draftOwner = (draftObj && draftObj.id) || '';
      if (_sessionOwnedBy(sessionId, _draftOwner) === false) {
        return JSON.stringify({ ok: false, msg: 'Not authorized for this session.' });
      }
    }
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(4000)) return JSON.stringify({ ok: true, skipped: true });
    try {
      var sh   = getDraftSheet();
      var json = JSON.stringify(draftObj);
      var now  = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
      if (sh.getLastRow() >= 2) {
        var hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
                    .createTextFinder(String(sessionId)).matchEntireCell(true).findNext();
        if (hit) {
          sh.getRange(hit.getRow(), 2, 1, 2).setValues([[json, now]]);
          return JSON.stringify({ ok: true });
        }
      }
      sh.appendRow([sessionId, json, now]);
      return JSON.stringify({ ok: true });
    } finally { lock.releaseLock(); }
  } catch (e) {
    Logger.log('saveDraft: ' + e);
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

function deleteDraft(sessionId) {
  try {
    var sh = getDraftSheet();
    if (sh.getLastRow() < 2) return;
    var hit = sh.getRange(2, 1, sh.getLastRow() - 1, 1)
                .createTextFinder(String(sessionId)).matchEntireCell(true).findNext();
    if (hit) sh.deleteRow(hit.getRow());
  } catch (e) { Logger.log('deleteDraft: ' + e); }
}

/* === DATE PARSING UTILITY === */

function _parseISTDateString(s) {
  try {
    if (!s) return null;
    if (s instanceof Date) return s.getTime();
    var str   = String(s).trim();
    var parts = str.split(' ');
    if (parts.length < 2) return null;
    var dParts = parts[0].split('/');
    var tParts = parts[1].split(':');
    if (dParts.length !== 3 || tParts.length !== 3) return null;
    var d = new Date(
      parseInt(dParts[2]), parseInt(dParts[1]) - 1, parseInt(dParts[0]),
      parseInt(tParts[0]), parseInt(tParts[1]), parseInt(tParts[2])
    );
    if (isNaN(d.getTime())) return null;
    return d.getTime();
  } catch (e) { return null; }
}

// Call this once after getSessionsSheet() to lock date columns as plain text.
// Safe to call multiple times — only acts if the format isn't already set.
function _lockDateColumnsAsText(sh) {
  var map = _headerMap(sh);
  var cols = ['Created Time', 'Last Updated', 'Last Modified'];
  var lastRow = Math.max(sh.getLastRow(), 1);
  cols.forEach(function(col) {
    if (map[col] === undefined) return;
    // Set the ENTIRE column (including future rows) to plain text.
    sh.getRange(1, map[col] + 1, lastRow + 500, 1).setNumberFormat('@');
  });
}

function _normalizeCreated(raw) {
  if (!raw) return '';
  // If Sheets returned a Date object, format it explicitly in IST.
  // This is the primary source of the ±1 day shift — a JS Date is UTC
  // internally, and toString() or simple concatenation uses the server's
  // JVM timezone (UTC), not IST. Always force IST here.
  if (raw instanceof Date) {
    return Utilities.formatDate(raw, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
  }
  return String(raw || '').trim();
}

/* FIX: <input type="date"> on the client requires the value in exactly
   "YYYY-MM-DD" format — any other format is silently rejected by the
   browser (the field just appears empty). resumeSession returned no
   `date` field at all, and getSessionForEdit returned it as "DD/MM/YYYY"
   (split from the human-readable created-time string) — neither was
   usable to actually lock the date input on resume/edit. This converts
   the display format into the input-compatible one; returns '' if input
   is unparseable. */
function _toISODate(ddmmyyyyOrFull) {
  var datePart = String(ddmmyyyyOrFull || '').trim().split(' ')[0];
  var m = datePart.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return '';
  var dd = ('0' + m[1]).slice(-2);
  var mm = ('0' + m[2]).slice(-2);
  return m[3] + '-' + mm + '-' + dd;
}

/* === SHIFT / UNIT CONTINUITY (SAME-DAY RULE) === */

function _getUnitsForKey(checklistKey) {
  var meta = CHECKLIST_META[checklistKey];
  if (!meta) return SHIFTS;
  if (meta.mode === 'shift') return SHIFTS;
  if (meta.mode === 'week')  return WEEKS;
  if (meta.mode === 'single') return ['एकदा'];
  return SHIFTS;
}

/* VAR-SHIFTS: per-session unit total. Shift-mode stations choose 1-6 shifts
   per day; week mode is always 4, single always 1, bus unlimited. Blank or
   invalid stored values (all pre-existing rows) fall back to the full 6 —
   so legacy sessions behave exactly as before. */
function _sessionTotalUnits(checklistKey, storedTotal) {
  var meta = CHECKLIST_META[checklistKey] || {};
  var def  = _getUnitsForKey(checklistKey).length;
  if (meta.mode !== 'shift') return def;
  var n = parseInt(storedTotal, 10);
  /* FIXED: only 4 or 6 are valid shift counts.
     Any other value (1,2,3,5) falls back to 6 (default). */
  return (n === 4 || n === 6) ? n : 6;
}

function fixInvalidShiftCounts() {
  var sh  = getSessionsSheet();
  var c   = _headerMap(sh);
  if (sh.getLastRow() < 2) return 'No sessions.';
  if (c['Total Shifts'] === undefined) return 'Total Shifts column missing.';

  var n       = sh.getLastRow() - 1;
  var keyCol  = sh.getRange(2, c['Checklist Key'] + 1, n, 1).getValues();
  var totCol  = sh.getRange(2, c['Total Shifts']  + 1, n, 1).getValues();
  var fixed   = 0;

  for (var i = 0; i < n; i++) {
    var key  = String(keyCol[i][0] || '').trim();
    var meta = CHECKLIST_META[key]  || {};
    if (meta.mode !== 'shift') continue;

    var val = parseInt(totCol[i][0], 10) || 0;
    /* Only 4 or 6 allowed — anything else → fix to 6 */
    if (val !== 4 && val !== 6) {
      sh.getRange(i + 2, c['Total Shifts'] + 1).setValue(6);
      fixed++;
    }
  }

  clearAllCaches();
  var msg = 'Fixed ' + fixed + ' sessions with invalid shift counts.\n' +
            'All corrected to 6 shifts (default).';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
  return msg;
}

/* Detect an in-progress session for a station+checklist WITHOUT creating one. */
function peekContinuationSession(station, checklistKey, empId) {
  try {
    if (!station || !checklistKey) return JSON.stringify({ found: false });
    var meta = CHECKLIST_META[checklistKey] || {};
    if (meta.mode === 'bus') return JSON.stringify({ found: false });
    var cont = findContinuationSession(station, checklistKey, empId || null);
    if (!cont) return JSON.stringify({ found: false });

    var prevShifts = loadPreviousShifts(cont.sessionId);
    var allUnits   = _getUnitsForKey(checklistKey);
    var total      = _sessionTotalUnits(checklistKey, cont.totalShifts);
    var storedDone = (typeof cont.completedShifts === 'number') ? cont.completedShifts : 0;
    var nextIdx = Math.min(Math.max(prevShifts.length, storedDone), total);
    return JSON.stringify({
      found: true,
      sessionId: cont.sessionId,
      tokenId: cont.tokenId,
      completedShifts: prevShifts,
      currentShiftIdx: nextIdx,
      nextShiftName: nextIdx < total ? allUnits[nextIdx] : 'सर्व पूर्ण',
      totalUnits: total
    });
  } catch (e) {
    Logger.log('peekContinuationSession: ' + e);
    return JSON.stringify({ found: false });
  }
}

function findContinuationSession(station, checklistKey, empId) {
  try {
    if (!station || !checklistKey) return null;
    var meta = CHECKLIST_META[checklistKey];
    if (!meta) return null;
    var isBusMode = (meta.mode === 'bus');

    var stationClean = String(station).trim();
    var keyClean     = String(checklistKey).trim();
    var empClean     = empId ? String(empId).trim() : '';
    // A9 (defense-in-depth): an empty empId used to make the scan below match ANY
    // supervisor's in-process session (the Employee-ID filter is applied only
    // when empClean is truthy). Refuse it at the source so no caller can ever
    // adopt a foreign session. Every live caller (createSession, _ensureSessionRow
    // via its A1 guard) always passes a concrete id; the only empty-id caller is
    // the dead peekContinuationSession path, which correctly gets "no match".
    if (!empClean) return null;

    var bestMatch = null;
    var bestMs    = 0;

    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh = _chainSessionsSheet(ids[li]);
      var colIdx  = _headerMap(sh);
      var rowNums = _findRowsByColumn(sh, 'Station', stationClean);
      if (!rowNums.length) continue;
      var data = _readRows(sh, rowNums).map(function (o) { return o.values; });

      for (var i = data.length - 1; i >= 0; i--) {
        var row = data[i];
        if (String(row[colIdx['Checklist Key']] || '').trim() !== keyClean) continue;
        // FIX: filter by employee ID when provided — prevents Supervisor B's
        // first save from silently adopting Supervisor A's in-process session
        // at the same station/checklist-type, which caused data from B to
        // appear under A's token and "vanish" from B's माघील अहवाल view.
        if (empClean && String(row[colIdx['Employee ID']] || '').trim() !== empClean) continue;
        var rowDone  = parseInt(row[colIdx['Completed Shifts']] || 0);
        var rowTotal = _sessionTotalUnits(keyClean,
          colIdx['Total Shifts'] !== undefined ? row[colIdx['Total Shifts']] : '');
        if (!isBusMode && rowDone >= rowTotal) continue;
        var status = String(row[colIdx['Status']] || '').trim();
        if (status !== STATUS.IN_PROCESS && status !== STATUS.PAUSED) continue;

        var createdStr = _normalizeCreated(row[colIdx['Created Time']]);
        var createdMs  = _parseISTDateString(createdStr) || 0;
        if (createdMs > bestMs) {
          bestMs = createdMs;
          bestMatch = {
            sessionId:       String(row[colIdx['Session ID']]),
            tokenId:         String(row[colIdx['Token ID']]),
            dist:            String(row[colIdx['District']]),
            stn:             stationClean,
            name:            String(row[colIdx['Supervisor Name']]),
            id:              String(row[colIdx['Employee ID']]),
            checklistKey:    keyClean,
            completedShifts: rowDone,
            totalShifts:     rowTotal,
            totalBuses:      parseInt(row[colIdx['Total Buses']] || 0, 10) || 0,
            status:          status,
            createdMs:       createdMs
          };
        }
      }
    }
    return bestMatch;
  } catch (e) {
    Logger.log('[CONTINUITY] ERROR: ' + e);
    return null;
  }
}

/* Has THIS supervisor already completed this checklist at this station TODAY? */
function checkChecklistCompletedToday(empId, station, checklistKey, checkDate) {
  try {
    if (!empId || !station || !checklistKey) return JSON.stringify({ completed: false });
    var meta = CHECKLIST_META[checklistKey] || {};
    if (meta.mode === 'bus') return JSON.stringify({ completed: false });

    var idClean  = String(empId).trim();
    var stnClean = String(station).trim();
    var keyClean = String(checklistKey).trim();
    var todayStr;
    if (checkDate && /^\d{4}-\d{2}-\d{2}$/.test(String(checkDate))) {
      var dp = String(checkDate).split('-');
      todayStr = dp[2] + '/' + dp[1] + '/' + dp[0];
    } else {
      todayStr = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');
    }

    var ids = _chainIds();
    var activeId = ids[ids.length - 1];
    var ordered = [activeId].concat(ids.filter(function (id) { return id !== activeId; }));

    for (var li = 0; li < ordered.length; li++) {
      var sh = _chainSessionsSheet(ordered[li]);
      var colIdx  = _headerMap(sh);
      var rowNums = _findRowsByColumn(sh, 'Employee ID', idClean);
      if (!rowNums.length) continue;
      var data    = _readRows(sh, rowNums).map(function (o) { return o.values; });

      for (var i = data.length - 1; i >= 0; i--) {
        var row = data[i];
        if (String(row[colIdx['Station']]      || '').trim() !== stnClean) continue;
        if (String(row[colIdx['Checklist Key']]|| '').trim() !== keyClean) continue;

        var created = _normalizeCreated(row[colIdx['Created Time']]);
        if (created.indexOf(todayStr) !== 0) continue;

        var status = String(row[colIdx['Status']] || '').trim();
        var done   = parseInt(row[colIdx['Completed Shifts']] || 0, 10) || 0;
        var rowTot = _sessionTotalUnits(keyClean,
          colIdx['Total Shifts'] !== undefined ? row[colIdx['Total Shifts']] : '');

        // COMPLETED → fully blocked
        if (status === STATUS.COMPLETED || done >= rowTot) {
          return JSON.stringify({
            completed:  true,
            inProcess:  false,
            tokenId:    String(row[colIdx['Token ID']] || ''),
            pdfUrl:     String(row[colIdx['PDF URL']]  || ''),
            unitsDone:  done,
            unitsTotal: rowTot,
            date:       todayStr
          });
        }

        // ✅ FIXED: ALLOW BOTH IN_PROCESS AND PAUSED TO RESUME
        if (status === STATUS.IN_PROCESS || status === STATUS.PAUSED) {
          return JSON.stringify({
            completed:  false,
            inProcess:  true,
            sessionId:  String(row[colIdx['Session ID']] || ''),
            tokenId:    String(row[colIdx['Token ID']]   || ''),
            unitsDone:  done,
            unitsTotal: rowTot,
            date:       todayStr,
            wasPaused:  (status === STATUS.PAUSED),
            isEmpty:    (done === 0)
          });
        }
      }
    }
    return JSON.stringify({ completed: false });
  } catch (e) {
    Logger.log('[checkChecklistCompletedToday] ' + e);
    return JSON.stringify({ completed: false });
  }
}
function _normaliseUnitName(s) {
  if (!s) return '';
  var x = String(s)
    .replace(/[\u00A0\u200B\u200C\u200D\uFEFF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  // Devanagari can be saved composed (NFC) or decomposed (NFD); normalise.
  try { x = x.normalize('NFC'); } catch (e) {}
  return x;
}
// PDF-MATCH: a looser key — strips "(Shift)"/parentheses so older clients match.
function _shiftBaseName(s) {
  return _normaliseUnitName(String(s || '').replace(/\(Shift\)/g, '').replace(/[()]/g, ''));
}
// PDF-MATCH: union two shift lists by normalised name; on collision keep the
// object with MORE answered questions.
function _mergeShiftLists(a, b) {
  var byName = {}, order = [];
  function take(list) {
    (list || []).forEach(function (s) {
      if (!s || !s.shiftName) return;
      var k = _normaliseUnitName(s.shiftName);
      var ansCount = Object.keys(s.answers || {}).length;
      if (!byName[k]) { byName[k] = s; order.push(k); }
      else if (ansCount > Object.keys(byName[k].answers || {}).length) { byName[k] = s; }
    });
  }
  take(a); take(b);
  return order.map(function (k) { return byName[k]; });
}
/* =====================================================================
   CONSOLIDATED SESSION STORE  (1 row per session — answers packed as JSON)
   ---------------------------------------------------------------------
   All shift/bus answers for a session live in two JSON columns on the
   Inspection_Sessions sheet ("Shifts JSON", "Buses JSON") instead of in
   the separate per-question Shift_Responses / Bus_Responses sheets. This
   cuts row growth ~10-50x. Readers prefer JSON and fall back to the old
   sheets, so any not-yet-migrated session keeps working.
   ===================================================================== */
var SHIFTS_JSON_COL = 'Shifts JSON';
var BUSES_JSON_COL  = 'Buses JSON';

/* Make sure the two JSON columns exist on the sessions sheet. */
function _ensureJsonCols(targetSheet) {
  var sh = targetSheet || getSessionsSheet(), map = _headerMap(sh);
  var toAdd = [];
  if (map[SHIFTS_JSON_COL] === undefined) toAdd.push(SHIFTS_JSON_COL);
  if (map[BUSES_JSON_COL]  === undefined) toAdd.push(BUSES_JSON_COL);
  if (toAdd.length) {
    sh.getRange(1, sh.getLastColumn() + 1, 1, toAdd.length).setValues([toAdd]);
    _SHEET_CACHE = {}; _LOC_CACHE = {};
    delete _HDR_CACHE[sh.getParent().getId() + '::' + sh.getName()];  // ← flush stale header map so new columns are visible
  }
}

/* Latest sheet row for a session (or -1). Deprecated for new code — this
   collapses {sheet, row} into a bare row number, which is ambiguous once
   a session can live in any chain link. Kept only for this file's two
   remaining internal callers below; anything new should call
   _locateSession(sessionId) directly so the resolved sheet and row stay
   paired and can't silently drift apart. */
function _sessionRowIndex(sessionId) {
  var loc = _locateSession(sessionId);
  return loc ? loc.row : -1;
}

/* Read a JSON column → array (empty if missing/blank/un-parseable). */
function _readSessionUnits(sessionId, colName) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return [];
    var map = _headerMap(loc.sheet);
    if (map[colName] === undefined) return [];
    var raw = loc.sheet.getRange(loc.row, map[colName] + 1).getValue();
    if (!raw) return [];
    var arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) { Logger.log('_readSessionUnits(' + colName + '): ' + e); return []; }
}

/* Write an array into a JSON column (creates the column if needed).
   Returns false if the session row can't be found — callers MUST check
   this (previously every caller discarded it, so a missing row meant
   the save silently did nothing while still reporting success). */
function _writeSessionUnits(sessionId, colName, arr) {
  var loc = _locateSession(sessionId);
  if (!loc) {
    Logger.log('[_writeSessionUnits] FAILED — session row not found for sessionId=' + sessionId +
               ' col=' + colName + '. This session may not exist in any chain link (e.g. it was ' +
               'created while a different backend was active).');
    return false;
  }
  _ensureJsonCols(loc.sheet);
  var map = _headerMap(loc.sheet);   // re-read — _ensureJsonCols may have just added the column
  loc.sheet.getRange(loc.row, map[colName] + 1).setValue(JSON.stringify(arr || []));
  return true;
}

/* SECURITY/HARDENING: CONFIG.MAX_REMARK_LENGTH was defined but never
   enforced server-side — the client textarea's maxlength="300" is a UI
   courtesy only and is trivially bypassed (modified request, dev tools,
   direct API call). Remarks flow straight into fixed-width PDF table
   cells, so an oversized remark can break PDF layout or bloat storage.
   Applied once here, at the single choke point both _mergeSessionShifts
   and _saveSessionBus call before the write runs. */
function _sanitizeRemarks(remarksObj) {
  var limit = CONFIG.MAX_REMARK_LENGTH || 300;
  var out = {};
  if (!remarksObj) return out;
  Object.keys(remarksObj).forEach(function (k) {
    var v = String(remarksObj[k] || '').trim();
    if (v.length > limit) v = v.slice(0, limit);
    if (v) out[k] = v;
  });
  return out;
}

/* Merge shift units by shift name (replace matching, keep others, add new). */
/* A2: Serialize a read-modify-write of a session JSON column against EVERY
   other writer of that column, independent of which outer lock the caller
   holds. getUserLock() and getScriptLock() are DIFFERENT mutexes, so writers
   split across them — submitFullChecklist uses getScriptLock while editShift/
   saveShift/saveBus/editBus use getUserLock — do NOT block each other, a
   classic lost-update race on the single JSON cell (one execution's merged
   array silently overwrites the other's). This funnels all of them through ONE
   getScriptLock. Re-entrant: a caller that already holds the script lock
   (submitFullChecklist sets _JSON_WRITE_LOCK_HELD) runs inline so the same
   execution never re-acquires a lock it already owns. Best-effort: if the lock
   can't be acquired within the timeout we still run (no WORSE than the pre-fix
   behaviour, which held no shared lock at all across the user/script boundary)
   and log it, because skipping the write would lose data — the greater evil.
   No deadlock: script-lock holders never request the user lock, so there is no
   lock-order cycle. _JSON_WRITE_LOCK_HELD is a per-execution global (Apps
   Script isolates globals per execution), so it only ever reflects THIS run. */
var _JSON_WRITE_LOCK_HELD = false;
function _withJsonWriteLock(fn) {
  if (_JSON_WRITE_LOCK_HELD) return fn();
  var lock = LockService.getScriptLock();
  var got = false;
  try { got = lock.tryLock(10000); } catch (e) { got = false; }
  if (!got) Logger.log('[_withJsonWriteLock] proceeding WITHOUT shared lock (tryLock timed out)');
  _JSON_WRITE_LOCK_HELD = got;
  try {
    return fn();
  } finally {
    if (got) { _JSON_WRITE_LOCK_HELD = false; try { lock.releaseLock(); } catch (e2) {} }
  }
}

function _mergeSessionShifts(sessionId, shifts) {
  (shifts || []).forEach(function (s) { if (s) s.remarks = _sanitizeRemarks(s.remarks); });
  return _withJsonWriteLock(function () {
    var existing = _readSessionUnits(sessionId, SHIFTS_JSON_COL);
    var byName = {};
    existing.forEach(function (u) { if (u && u.shiftName) byName[_normaliseUnitName(u.shiftName)] = u; });
    (shifts || []).forEach(function (s) {
      if (!s || !s.shiftName) return;
      var ans = s.answers || {};
      byName[_normaliseUnitName(s.shiftName)] = {
        shiftName: s.shiftName,
        questions: (s.questions && s.questions.length) ? s.questions : Object.keys(ans),
        answers: ans,
        remarks: s.remarks || {}
      };
    });
    var merged = Object.keys(byName).map(function (k) { return byName[k]; });
    var wrote = _writeSessionUnits(sessionId, SHIFTS_JSON_COL, merged);
    if (!wrote) {
      throw new Error('Session सापडले नाही (ID: ' + sessionId + '). कृपया नवीन चेकलिस्ट सुरू करा.');
    }
    return merged;
  });
}

/* Save/replace ONE bus by bus number (matches saveBus's replace semantics). */
function _saveSessionBus(sessionId, busNumber, answers, remarks, timestamp, forceAppend, originalBusNumber) {
  remarks = _sanitizeRemarks(remarks);
  // A2: same read-modify-write serialization as _mergeSessionShifts. BUSES_JSON
  // is currently only written under getUserLock (saveBus/editBus), but funnel it
  // through the shared lock too so a future scriptLock-based bus writer can't
  // silently re-open the same lost-update race that SHIFTS_JSON had.
  return _withJsonWriteLock(function () {
    var existing = _readSessionUnits(sessionId, BUSES_JSON_COL);
    var bn = String(busNumber).toUpperCase();
    var origBn = originalBusNumber ? String(originalBusNumber).toUpperCase() : bn;
    var unit = {
      busNumber: bn, timestamp: timestamp || '',
      questions: Object.keys(answers || {}), answers: answers || {}, remarks: remarks || {}
    };
    if (forceAppend) {
      // REPEAT SAVE: always add as a NEW entry (separate wash event for the same bus)
      existing.push(unit);
    } else {
      // EDIT: find by original bus number (supports rename), update in-place; append if not found
      var idx = -1;
      for (var i = existing.length - 1; i >= 0; i--) {
        if (String(existing[i].busNumber).toUpperCase() === origBn) { idx = i; break; }
      }
      if (idx >= 0) existing[idx] = unit; else existing.push(unit);
    }
    var wrote = _writeSessionUnits(sessionId, BUSES_JSON_COL, existing);
    if (!wrote) {
      throw new Error('Session सापडले नाही (ID: ' + sessionId + '). कृपया नवीन चेकलिस्ट सुरू करा.');
    }
    return existing;
  });
}

/* Remove one bus by number (used by deleteSession/edit paths if needed). */
function _removeSessionBus(sessionId, busNumber) {
  var bn = String(busNumber).toUpperCase();
  // A3: this is the third direct caller of _writeSessionUnits and the only one
  // that used to DISCARD its boolean result — a false (row-not-found) return was
  // silently swallowed, so a failed removal looked successful. _removeSessionBus
  // currently has NO live callers (dead code, flagged for the A5 review), but
  // harden it to match _mergeSessionShifts/_saveSessionBus so a future revival
  // cannot silently drop data. A2: it is also a read-modify-write of BUSES_JSON,
  // so it goes through the same shared lock.
  return _withJsonWriteLock(function () {
    var kept = _readSessionUnits(sessionId, BUSES_JSON_COL)
      .filter(function (u) { return String(u.busNumber).toUpperCase() !== bn; });
    var wrote = _writeSessionUnits(sessionId, BUSES_JSON_COL, kept);
    if (!wrote) {
      throw new Error('Session सापडले नाही (ID: ' + sessionId + '). कृपया नवीन चेकलिस्ट सुरू करा.');
    }
    return kept;
  });
}

/* Canonical SHIFTS / WEEKS / एकदा ordering for a list of shift units. */
function _orderShifts(units) {
  var byShift = {}, insertOrder = [];
  units.forEach(function (u) {
    if (!u || !u.shiftName) return;
    var k = _normaliseUnitName(u.shiftName);
    if (!byShift[k]) { byShift[k] = u; insertOrder.push(k); }
  });
  var canonical = SHIFTS.concat(WEEKS).concat(['एकदा']).map(_normaliseUnitName);
  var result = [], handled = {};
  canonical.forEach(function (n) { if (byShift[n]) { result.push(byShift[n]); handled[n] = true; } });
  insertOrder.forEach(function (k) { if (!handled[k]) result.push(byShift[k]); });
  return result;
}

/* Non-creating sheet getter (legacy fallback must not re-create removed tabs). */
function _legacySheet(name) { try { return _ss().getSheetByName(name); } catch (e) { return null; } }

/* === SHIFT READER: JSON first, legacy Shift_Responses as fallback === */
function loadPreviousShifts(sessionId) {
  try {
    var fromJson = _readSessionUnits(sessionId, SHIFTS_JSON_COL);
    if (fromJson.length) return _orderShifts(fromJson);
    return _legacyLoadShifts(sessionId);
  } catch (e) { Logger.log('loadPreviousShifts ERROR: ' + e); return []; }
}

/* Legacy reader — only used for sessions not yet migrated to JSON. */
function _legacyLoadShifts(sessionId) {
  try {
    var sh = _legacySheet('Shift_Responses');
    if (!sh) return [];
    var rowNums = _findRowsByColumn(sh, 'Session ID', sessionId);
    if (!rowNums.length) return [];
    rowNums.sort(function (a, b) { return a - b; });
    var colIdx = _headerMap(sh);
    var data   = _readRows(sh, rowNums).map(function (o) { return o.values; });
    if (!data.length) return [];
    var byShift = {}, insertOrder = [];
    for (var i = 0; i < data.length; i++) {
      var row    = data[i];
      var shName = _normaliseUnitName(String(row[colIdx['Shift Name']] || ''));
      var q      = String(row[colIdx['Question']] || '');
      var a      = String(row[colIdx['Answer']]   || '');
      var r      = String(row[colIdx['Remark']]   || '');
      if (!shName || !q) continue;
      if (!byShift[shName]) { byShift[shName] = { shiftName: shName, questions: [], answers: {}, remarks: {} }; insertOrder.push(shName); }
      var unit = byShift[shName];
      if (unit.questions.indexOf(q) === -1) unit.questions.push(q);
      unit.answers[q] = a;
      if (r) unit.remarks[q] = r;
    }
    return _orderShifts(insertOrder.map(function (k) { return byShift[k]; }));
  } catch (e) { Logger.log('_legacyLoadShifts ERROR: ' + e); return []; }
}

/* === SESSION MANAGEMENT === */

function checkForDuplicateSubmission(district, station, supervisorId, checklistKey) {
  try {
    var normDistrict     = String(district     || '').trim();
    var normStation      = String(station      || '').trim();
    var normSupervisorId = String(supervisorId || '').trim();
    var normChecklistKey = String(checklistKey || '').trim();
    if (!normSupervisorId) return { isDuplicate: false };

    var todayIST = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');
    var meta  = CHECKLIST_META[checklistKey] || {};
    var isBus = (meta.mode === 'bus');

    var ids = _chainIds();
    var activeId = ids[ids.length - 1];
    var ordered = [activeId].concat(ids.filter(function (id) { return id !== activeId; }));

    for (var li = 0; li < ordered.length; li++) {
      var sh = _chainSessionsSheet(ordered[li]);
      var colMap = _headerMap(sh);
      if (colMap['Employee ID'] === undefined) continue;

      var rowNums = _findRowsByColumn(sh, 'Employee ID', normSupervisorId);
      if (!rowNums.length) continue;
      var rows = _readRows(sh, rowNums);
      rows.sort(function (a, b) { return b.row - a.row; });   // newest first

      for (var i = 0; i < rows.length; i++) {
        var row = rows[i].values;
        if (String(row[colMap['District']]      || '').trim() !== normDistrict)     continue;
        if (String(row[colMap['Station']]       || '').trim() !== normStation)      continue;
        if (String(row[colMap['Checklist Key']] || '').trim() !== normChecklistKey) continue;

        var createdDay = (_normalizeCreated(row[colMap['Created Time']]) || '').split(' ')[0];
        if (createdDay !== todayIST) continue;

        var rowStatus     = String(row[colMap['Status']] || '').trim();
        var rowDoneShifts = parseInt(row[colMap['Completed Shifts']] || 0);
        var rowTotalBuses = parseInt(row[colMap['Total Buses']]      || 0);
        // VAR-SHIFTS: use THIS session's stored shift count, not the fixed 6.
        var rowTotal      = _sessionTotalUnits(checklistKey,
          colMap['Total Shifts'] !== undefined ? row[colMap['Total Shifts']] : '');

        // "Completed today" = explicitly Completed, OR all of this session's
        // own shifts are in. (No more wait-for-6 on shorter sessions.)
        var shouldBlock = isBus
          ? (rowStatus === STATUS.COMPLETED || rowTotalBuses > 0)
          : (rowStatus === STATUS.COMPLETED || rowDoneShifts >= rowTotal);

        if (shouldBlock) {
          return {
            isDuplicate: true,
            existingSession: {
              sessionId:       String(row[colMap['Session ID']] || ''),
              tokenId:         String(row[colMap['Token ID']]   || ''),
              createdTime:     row[colMap['Created Time']],
              status:          rowStatus,
              completedShifts: rowDoneShifts,
              totalBuses:      rowTotalBuses
            }
          };
        }
      }
    }
    return { isDuplicate: false };
  } catch (e) {
    Logger.log('Duplicate check error: ' + e.toString());
    return { isDuplicate: false, error: e.toString() };
  }
}

/* =====================================================================
   ONE-TIME REPAIR — recompute "Completed Shifts" for every session.
   ===================================================================== */
/* ONE-TIME REPAIR — run once from the editor after deploying v18.1.
   Fixes OLD shift sessions that show pending / "6" in माघील अहवाल because
   their Total Shifts column is blank. For each shift-mode session it counts
   the DISTINCT shifts actually saved in Shift_Responses, writes that into
   Total Shifts + Completed Shifts, and marks the row Completed. Bus/week/
   single rows are left untouched. Safe to run multiple times. */
function repairOldShiftCounts() {
  var sh = getSessionsSheet();
  var c  = _headerMap(sh);
  if (sh.getLastRow() < 2) { Logger.log('no sessions'); return 'No sessions.'; }
  if (c['Total Shifts'] === undefined) { Logger.log('Total Shifts column missing — open the app once to auto-add it.'); return 'Total Shifts column missing.'; }

  var data = sh.getDataRange().getValues();   // one-time maintenance → full read OK
  var fixed = 0, examined = 0;

  for (var i = 1; i < data.length; i++) {
    var key  = String(data[i][c['Checklist Key']] || '').trim();
    var meta = CHECKLIST_META[key] || {};
    if (meta.mode !== 'shift') continue;       // only fixed-shift checklists
    examined++;

    var sessionId = String(data[i][c['Session ID']] || '');
    if (!sessionId) continue;

    // Count DISTINCT shift names actually saved for this session.
    var saved = loadPreviousShifts(sessionId);
    var n = saved.length;
    if (n < 1) continue;                       // nothing saved → leave as-is
    if (n > SHIFTS.length) n = SHIFTS.length;

    var rowNum = i + 1;
    sh.getRange(rowNum, c['Total Shifts']     + 1).setValue(n);
    sh.getRange(rowNum, c['Completed Shifts'] + 1).setValue(n);
    if (c['Status'] !== undefined) sh.getRange(rowNum, c['Status'] + 1).setValue(STATUS.COMPLETED);
    fixed++;
  }

  clearAllCaches();
  var msg = 'Repair done. Shift sessions examined: ' + examined + ', fixed: ' + fixed + '.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

function repairCompletedShiftCounts() {
  try {
    var sh = getSessionsSheet();
    var map = _headerMap(sh);
    var last = sh.getLastRow();
    if (last < 2) { _safeAlert_('No sessions to repair.'); return; }

    var idCol   = map['Session ID'] + 1;
    var doneCol = map['Completed Shifts'] + 1;

    var ids = sh.getRange(2, idCol, last - 1, 1).getValues();
    var fixed = 0, checked = 0;
    for (var i = 0; i < ids.length; i++) {
      var sid = String(ids[i][0] || '').trim();
      if (!sid) continue;
      checked++;
      var actual = loadPreviousShifts(sid).length;
      var rowNum = i + 2;
      var cur = parseInt(sh.getRange(rowNum, doneCol).getValue() || 0, 10) || 0;
      if (actual !== cur) {
        sh.getRange(rowNum, doneCol).setValue(actual);
        fixed++;
      }
    }
    SpreadsheetApp.flush();
    _safeAlert_('Repair done.\n\nSessions checked: ' + checked + '\nCounts corrected: ' + fixed +
      '\n\nIncomplete sessions will now resume from the correct shift.');
  } catch (e) {
    Logger.log('repairCompletedShiftCounts: ' + e);
    _safeAlert_('Repair error: ' + e);
  }
}

function _safeAlert_(m) { try { SpreadsheetApp.getUi().alert(m); } catch (e) { Logger.log(m); } }

/* ONE-TIME CLEANUP: removes empty "shell" rows from Inspection_Sessions —
   any row that's not Completed, has 0 shifts AND 0 buses, and has no
   actual data in either JSON column. Safe: only touches rows with
   zero recorded answers, regardless of checklist type or date. */
function cleanupEmptyShellSessions() {
  var sh = getSessionsSheet();
  var c  = _headerMap(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) return 'No sessions.';

  var data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var toDelete = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    if (String(row[c['Status']] || '').trim() === STATUS.COMPLETED) continue;
    var done  = parseInt(row[c['Completed Shifts']] || 0, 10) || 0;
    var buses = parseInt(row[c['Total Buses']] || 0, 10) || 0;
    if (done !== 0 || buses !== 0) continue;
    var sj = c[SHIFTS_JSON_COL] !== undefined ? String(row[c[SHIFTS_JSON_COL]] || '') : '';
    var bj = c[BUSES_JSON_COL]  !== undefined ? String(row[c[BUSES_JSON_COL]]  || '') : '';
    if ((sj && sj !== '[]') || (bj && bj !== '[]')) continue;   // has real data, keep
    toDelete.push(i + 2);
  }

  toDelete.sort(function (a, b) { return b - a; });   // bottom-up
  toDelete.forEach(function (rn) { sh.deleteRow(rn); });
  var msg = 'Removed ' + toDelete.length + ' empty shell rows.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/* =====================================================================
   FIX D — createSession now performs the "already completed today" check
   ITSELF (one server execution instead of two client round trips).
   If completed, returns { ok:false, completedToday:true, info:{...} }.
   ===================================================================== */
function createSession(payload) {
  try {
    var v = _validatePayload(payload, ['dist', 'stn', 'name', 'id']);
    if (!v.ok) return JSON.stringify({ ok: false, msg: 'अपूर्ण माहिती (कोड: ' + (v.field || '?') + ').' });

    var validation = JSON.parse(validateEmployee(payload.id, payload.name));
    if (!validation.ok) return JSON.stringify({ ok: false, msg: validation.msg });

    // Reject unknown checklist keys instead of silently defaulting to {}.
    // An unrecognized key gives meta.mode === undefined, which the shift/bus
    // branches below treat as a default shift session — so a typo or a crafted
    // key would create a mislabeled, mis-counted row. Only the 8 defined
    // checklist types are valid.
    if (!CHECKLIST_META[payload.checklistKey]) {
      return JSON.stringify({ ok: false, msg: 'अवैध चेकलिस्ट प्रकार. / Invalid checklist type.' });
    }
    var meta = CHECKLIST_META[payload.checklistKey];

    // FIX D: completed-today gate runs server-side in the same execution.
    if (meta.mode !== 'bus') {
      try {
        var done = JSON.parse(checkChecklistCompletedToday(payload.id, payload.stn, payload.checklistKey, payload.date));
        if (done && done.completed) {
          logAction(LOG_ACTIONS.DUPLICATE_BLOCKED, '', { stn: payload.stn, key: payload.checklistKey });
          return JSON.stringify({ ok: false, completedToday: true, info: done });
        }
      } catch (ce) { Logger.log('completed-today check: ' + ce); }
    }

    // VAR-SHIFTS: how many shifts this station runs today (shift mode only)
    var totalShiftsReq = _sessionTotalUnits(payload.checklistKey, payload.totalShifts);

    // FIX (duplicate rows): make the check-then-create atomic. Without this
    // lock, two concurrent createSession calls both saw "no session" and
    // both appended a row → multiple In Process entries per checklist.
    var csLock = LockService.getUserLock();
    if (!csLock.tryLock(8000)) {
      return JSON.stringify({ ok: false, busy: true, msg: 'कृपया थांबा…' });
    }
    try {

    // FIX: skip continuation for backdated entries (same logic as _ensureSessionRow).
    var _csTodayIST = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    var _csBackdate = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))
                      && String(payload.date) !== _csTodayIST;
    var cont = _csBackdate ? null : findContinuationSession(payload.stn, payload.checklistKey, payload.id);

    if (cont && meta.mode === 'bus') {
      _updateSessionStatus(cont.sessionId, STATUS.IN_PROCESS);
      var prevBuses = loadPreviousBuses(cont.sessionId);
      logAction(LOG_ACTIONS.SESSION_RESUME, cont.sessionId, { mode: 'bus', buses: prevBuses.length });
      return JSON.stringify({
        ok: true,
        sessionId:      cont.sessionId,
        tokenId:        cont.tokenId,
        continuation:   true,
        busContinuation:true,
        completedBuses: prevBuses,
        totalBuses:     prevBuses.length,
        msg: '🔄 आजचे बस सत्र चालू ठेवले आहे. (' + prevBuses.length + ' बस आधीच नोंद)'
      });
    }


    if (cont) {
      var prevShifts = loadPreviousShifts(cont.sessionId);
      var allUnits   = _getUnitsForKey(payload.checklistKey);
      var contTotal  = _sessionTotalUnits(payload.checklistKey, cont.totalShifts);
      
      // ✅ FIXED: RESET PAUSED → IN_PROCESS
      var newStatus = (cont.status === STATUS.PAUSED) ? STATUS.IN_PROCESS : cont.status;
      _updateSessionStatus(cont.sessionId, newStatus);
      
      var storedDone   = (typeof cont.completedShifts === 'number') ? cont.completedShifts : 0;
      var nextIdx      = Math.min(Math.max(prevShifts.length, storedDone), contTotal);
      var nextUnitName = nextIdx < contTotal ? allUnits[nextIdx] : 'सर्व पूर्ण';

      logAction(LOG_ACTIONS.SESSION_RESUME, cont.sessionId, { 
        nextUnit: nextUnitName, 
        done: nextIdx, 
        resumedFromStatus: cont.status,
        wasPaused: (cont.status === STATUS.PAUSED)
      });

      return JSON.stringify({
        ok: true,
        sessionId:       cont.sessionId,
        tokenId:         cont.tokenId,
        continuation:    true,
        completedShifts: prevShifts,
        currentShiftIdx: nextIdx,
        nextShiftName:   nextUnitName,
        totalUnits:      contTotal,
        msg: '🔄 ' + (cont.status === STATUS.PAUSED 
          ? 'रद्द केलेले सत्र पुन्हा सुरू केले आहे.' 
          : 'मागील सत्र चालू ठेवले आहे.') + 
             '\nपुढील: ' + nextUnitName + '\n(पूर्ण: ' + nextIdx + '/' + contTotal + ')'
      });
    }
    var sessionId = getNextSessionId();
    var tokenId   = getNextTokenId(payload.dist, payload.stn);
    var nowFull   = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    var nowTime   = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm:ss');

    var created = nowFull;
    if (payload.date && /^\d{4}-\d{2}-\d{2}$/.test(payload.date)) {
      var dp = payload.date.split('-');
      created = dp[2] + '/' + dp[1] + '/' + dp[0] + ' ' + nowTime;
    }
    var now = created;

    var sessSheet = _chainSessionsSheet(_activeChainId());
    var _clLabel = payload.checklist
      || (CHECKLIST_META[payload.checklistKey] || {}).label
      || payload.checklistKey || '';
            // AFTER
      var _newRowArr = new Array(17).fill('');
      _newRowArr[0]  = sessionId;
      _newRowArr[1]  = tokenId;
      _newRowArr[2]  = _sanitizeCell(payload.dist);
      _newRowArr[3]  = _sanitizeCell(payload.stn);
      _newRowArr[4]  = _sanitizeCell(payload.name);
      _newRowArr[5]  = _sanitizeCell(payload.id);
      _newRowArr[6]  = _sanitizeCell(_clLabel);
      _newRowArr[7]  = _sanitizeCell(payload.checklistKey || '');
      _newRowArr[8]  = now;
      _newRowArr[9]  = nowFull;
      _newRowArr[10] = 0;
      _newRowArr[11] = 0;
      _newRowArr[12] = STATUS.IN_PROCESS;
      _newRowArr[13] = '';
      _newRowArr[16] = totalShiftsReq;
      sessSheet.appendRow(_newRowArr);

    // Force Created Time & Last Updated to PLAIN TEXT (timezone safety)
    try {
      var _r   = sessSheet.getLastRow();
      var _map = _headerMap(sessSheet);
      if (_map['Created Time'] !== undefined)
        sessSheet.getRange(_r, _map['Created Time'] + 1).setNumberFormat('@').setValue(now);
      if (_map['Last Updated'] !== undefined)
        sessSheet.getRange(_r, _map['Last Updated'] + 1).setNumberFormat('@').setValue(nowFull);
      // VAR-SHIFTS: persist this session's shift count
      if (_map['Total Shifts'] !== undefined)
        sessSheet.getRange(_r, _map['Total Shifts'] + 1).setValue(totalShiftsReq);
    } catch (_e) { Logger.log('text-format set failed: ' + _e); }

    if (SERVER_DRAFTS) {
      saveDraft(sessionId, {
        sessionId: sessionId, tokenId: tokenId,
        dist: payload.dist, stn: payload.stn,
        name: payload.name, id: payload.id,
        date: payload.date || '',
        checklistKey: payload.checklistKey || '',
        checklist:    _clLabel,
        completedShifts: [], completedBuses: [],
        currentShiftIdx: 0, status: STATUS.IN_PROCESS,
        createdAt: now
      });
    }

    _invalidateEmpCaches(String(payload.id).trim(), payload.date);
    logAction(LOG_ACTIONS.SESSION_CREATE, sessionId, { station: payload.stn, checklist: payload.checklistKey });

    var units0 = _getUnitsForKey(payload.checklistKey);
    return JSON.stringify({
      ok: true, sessionId: sessionId, tokenId: tokenId,
      continuation: false, currentShiftIdx: 0,
      nextShiftName: units0[0] || '',
      totalUnits: totalShiftsReq
    });

    } finally { try { csLock.releaseLock(); } catch (_le) {} }
  } catch (e) {
    Logger.log('[SESSION] ERROR: ' + e);
    logAction(LOG_ACTIONS.ERROR, '', { source: 'createSession', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* =====================================================================
   SPEED: createSessionAndSaveShift — the FIRST shift save in ONE server
   execution instead of two round trips (createSession → saveShift).
   Response shape = saveShift's, plus sessionId/tokenId, or the
   createSession completedToday / continuation responses unchanged.
   ===================================================================== */
function createSessionAndSaveShift(payload) {
  try {
    var cs = JSON.parse(createSession(payload));
    if (!cs.ok) return JSON.stringify(cs);          // incl. completedToday
    if (cs.continuation) return JSON.stringify(cs); // client re-syncs; user re-confirms

    payload.sessionId       = cs.sessionId;
    payload.tokenId         = cs.tokenId;
    payload.completedShifts = [];                   // brand-new session
    var sv = JSON.parse(saveShift(payload));
    sv.sessionId = cs.sessionId;
    sv.tokenId   = sv.tokenId || cs.tokenId;
    sv.created   = true;
    return JSON.stringify(sv);
  } catch (e) {
    Logger.log('[createSessionAndSaveShift] ' + e);
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

function resumePausedSession(sessionId, empId) {
  try {
    if (!sessionId || !empId) return JSON.stringify({ ok: false, msg: 'अपूर्ण विनंती.' });

    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    var c = _headerMap(loc.sheet);

    var row = _readRows(loc.sheet, [loc.row])[0].values;
    var rowEmpId = String(row[c['Employee ID']] || '').trim();
    if (rowEmpId !== String(empId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });
    }
    
    var status = String(row[c['Status']] || '').trim();
    if (status === STATUS.COMPLETED) {
      return JSON.stringify({ ok: false, msg: '✅ ही चेकलिस्ट आधीच पूर्ण झाली आहे.' });
    }
    
    // If paused, resume; if in-process, already resumable
    if (status === STATUS.PAUSED) {
      _updateSessionStatus(sessionId, STATUS.IN_PROCESS);
      logAction('RESUME_PAUSED', sessionId, { by: empId });
    }
    
    return resumeSession(sessionId, empId);
  } catch (e) {
    Logger.log('[resumePausedSession] ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

/* Delete empty same-day duplicate "In Process" rows for the same
   station + checklist once one session completes. Only rows with NO
   saved data (0 shifts, 0 buses, not Completed) are removed. */
function _cleanupDuplicateSessions(keepSessionId, station, checklistKey) {
  try {
    if (!station || !checklistKey) return;
    var todayIST = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy');
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh = _chainSessionsSheet(ids[li]);
      var c  = _headerMap(sh);
      var rowNums = _findRowsByColumn(sh, 'Station', String(station).trim());
      if (!rowNums.length) continue;
      var read = _readRows(sh, rowNums);
      var toDelete = [];
      for (var i = 0; i < read.length; i++) {
        var row = read[i].values;
        if (String(row[c['Session ID']] || '') === String(keepSessionId)) continue;
        if (String(row[c['Checklist Key']] || '').trim() !== String(checklistKey).trim()) continue;
        if (String(row[c['Status']] || '').trim() === STATUS.COMPLETED) continue;
        var createdDay = (_normalizeCreated(row[c['Created Time']]) || '').split(' ')[0];
        if (createdDay !== todayIST) continue;
        var done  = parseInt(row[c['Completed Shifts']] || 0, 10) || 0;
        var buses = parseInt(row[c['Total Buses']] || 0, 10) || 0;
        if (done === 0 && buses === 0) toDelete.push(read[i].row);   // empty shell only
      }
      toDelete.sort(function (a, b) { return b - a; });
      toDelete.forEach(function (rn) { sh.deleteRow(rn); });
      if (toDelete.length) {
        _LOC_CACHE = {};   // rows shifted, drop cached positions
        Logger.log('[dedupe] removed ' + toDelete.length + ' empty duplicate(s) for ' + station + '/' + checklistKey + ' (link ' + ids[li] + ')');
      }
    }
  } catch (e) { Logger.log('[_cleanupDuplicateSessions] ' + e); }
}

function _updateSessionStatus(sessionId, status) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return;
    var sh      = loc.sheet;
    var map     = _headerMap(sh);
    var statusCol  = map['Status'] + 1;
    var updatedCol = map['Last Updated'] + 1;
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    var r = loc.row;
    if (statusCol  > 0) sh.getRange(r, statusCol).setValue(status);
    if (updatedCol > 0) sh.getRange(r, updatedCol).setValue(now);
  } catch (e) { Logger.log('_updateSessionStatus: ' + e); }
}

/* =====================================================================
   EDIT-AFTER-SUBMISSION  — edits UPDATE the same record.
   ===================================================================== */

/* Stamp the audit columns on a session row (located by Session ID). */
function _stampModified(sessionId, modifiedBy) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return;
    var sh  = loc.sheet;
    var map = _headerMap(sh);
    var r = loc.row;
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    if (map['Last Modified'] !== undefined) sh.getRange(r, map['Last Modified'] + 1).setNumberFormat('@').setValue(now);
    if (map['Modified By']   !== undefined) sh.getRange(r, map['Modified By']   + 1).setValue(String(modifiedBy || ''));
  } catch (e) { Logger.log('_stampModified: ' + e); }
}

/* Delete existing response rows for a session + (optional) one unit name. */
function _deleteResponseRows(sh, sessionId, colUnit, unitName) {
  try {
    var map = _headerMap(sh);
    var sesIdx  = map['Session ID'];
    var unitIdx = (colUnit !== undefined) ? map[colUnit] : undefined;
    if (sesIdx === undefined) return 0;
    var rowNums = _findRowsByColumn(sh, 'Session ID', sessionId);
    if (!rowNums.length) return 0;
    var toDelete = [];
    var read = _readRows(sh, rowNums);
    for (var i = 0; i < read.length; i++) {
      if (unitName === undefined || unitName === null ||
          String(read[i].values[unitIdx]).trim() === String(unitName).trim()) {
        toDelete.push(read[i].row);
      }
    }
    toDelete.sort(function (a, b) { return b - a; });   // bottom-up keeps indexes valid
    toDelete.forEach(function (rn) { sh.deleteRow(rn); });
    return toDelete.length;
  } catch (e) { Logger.log('_deleteResponseRows: ' + e); return 0; }
}

/* Verify the requester owns this session. */
function _sessionOwnedBy(sessionId, empId) {
  var loc = _locateSession(sessionId);
  if (!loc) return null;
  var map = _headerMap(loc.sheet);
  var row = _readRows(loc.sheet, [loc.row])[0].values;
  var owner = String(row[map['Employee ID']] || '').trim();
  if (empId && owner && owner !== String(empId).trim()) return false;
  return row;   // return the row values for reuse
}

/* Load a submitted record back into the form for editing. */
function getSessionForEdit(sessionId, requestingEmpId) {
  try {
    if (!sessionId) return JSON.stringify({ ok: false, msg: 'Session ID आवश्यक.' });
    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    var map = _headerMap(loc.sheet);
    var row = _readRows(loc.sheet, [loc.row])[0].values;
    var owner = String(row[map['Employee ID']] || '').trim();
    if (requestingEmpId && owner && owner !== String(requestingEmpId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत — हा अहवाल तुमचा नाही.' });
    }

    var checklistKey = String(row[map['Checklist Key']] || '').trim();
    var meta = CHECKLIST_META[checklistKey] || { mode: 'shift' };

    var base = {
      ok: true, edit: true,
      sessionId:    sessionId,
      tokenId:      String(row[map['Token ID']]        || ''),
      dist:         String(row[map['District']]        || ''),
      stn:          String(row[map['Station']]         || ''),
      name:         String(row[map['Supervisor Name']] || ''),
      id:           String(row[map['Employee ID']]     || ''),
      checklist:    String(row[map['Checklist Type']]  || ''),
      checklistKey: checklistKey,
      status:       String(row[map['Status']]          || ''),
      mode:         meta.mode,
      date:         _toISODate(_normalizeCreated(row[map['Created Time']]))
    };
    if (meta.mode === 'bus') {
      base.completedBuses  = loadPreviousBuses(sessionId);
      base.completedShifts = [];
    } else {
      base.completedShifts = loadPreviousShifts(sessionId);
      base.completedBuses  = [];
    }
    logAction('EDIT_LOAD', sessionId, { by: requestingEmpId, key: checklistKey });
    return JSON.stringify(base);
  } catch (e) {
    Logger.log('[getSessionForEdit] ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}


/* EDIT one bus in place — merged from the two duplicate definitions
   (duplicate-bus check restored) + fixed _pending status check.
   DELETE both of your existing editBus functions and use only this one. */
function editBus(payload) {
  try {
    var v = _validatePayload(payload, ['sessionId', 'busNumber', 'answers']);
    if (!v.ok) return JSON.stringify({ ok: false, msg: 'अपूर्ण बस डेटा (कोड: ' + (v.field || '?') + ').' });

    var ownRow = _sessionOwnedBy(payload.sessionId, payload.id);
    if (ownRow === null)  return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    if (ownRow === false) return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });

    var lock = LockService.getUserLock();
    if (!lock.tryLock(4000)) return JSON.stringify({ ok: false, busy: true, msg: 'कृपया थांबा — मागील नोंद सुरू आहे.' });
    try {
      var _bvRaw = String(payload.busNumber || '').replace(/[\s\-]/g, '').toUpperCase();
      var _bv = _validateMHBusNumber(_bvRaw);
      if (!_bv.ok) return JSON.stringify({ ok: false, msg: _bv.msg });
      var bnUp = _bv.clean;
      var origBn = payload.originalBusNumber ? String(payload.originalBusNumber).replace(/[\s\-]/g, '').toUpperCase() : null;
      // No duplicate check — editing; _saveSessionBus finds by origBn for renames.

      var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
      _saveSessionBus(payload.sessionId, bnUp, payload.answers, payload.remarks || {}, now, false, origBn);

      var allBuses = loadPreviousBuses(payload.sessionId);
      _updateSessionRecord(payload.sessionId, null, allBuses.length, '', null);
      _stampModified(payload.sessionId, payload.id);
      _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
      logAction('EDIT_BUS', payload.sessionId, { bus: bnUp });

      try {
        if (typeof appendMasterRowsForSession === 'function')
          appendMasterRowsForSession(payload.sessionId);
      } catch (e) { Logger.log('master hook: ' + e); }

      // FIX: clear the existing PDF URL so the client's poll waits for
      // the newly-generated PDF instead of immediately returning the stale
      // one (which still shows the pre-edit answers).
      try {
        var _eloc = _locateSession(payload.sessionId);
        if (_eloc) {
          var _em = _headerMap(_eloc.sheet);
          if (_em['PDF URL'] !== undefined) _eloc.sheet.getRange(_eloc.row, _em['PDF URL'] + 1).setValue('');
        }
      } catch (_ec) { Logger.log('[editBus] PDF URL clear: ' + _ec); }
      _enqueuePDFJob(payload.sessionId);

      return JSON.stringify({ ok: true, msg: '\u270f\ufe0f बस नोंद अद्ययावत झाली.', pdfUrl: '', pdfError: '' });
    } finally { lock.releaseLock(); }
  } catch (e) {
    Logger.log('editBus: ' + e);
    logAction(LOG_ACTIONS.ERROR, payload.sessionId || '', { source: 'editBus', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* =====================================================================
   FIX G — DELETE A WHOLE CHECKLIST (hard delete) — own records only.
   The job now captures token/district/station/key BEFORE the row is
   deleted, so the deferred cleanup can actually remove the PDF and the
   pending marker from Drive (the old version queued only the sessionId,
   making PDF cleanup impossible).
   ===================================================================== */
function deleteSession(sessionId, requestingEmpId) {
  try {
    if (!sessionId) return JSON.stringify({ ok: false, msg: 'Session ID आवश्यक.' });
    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    var sessSh = loc.sheet;
    var map    = _headerMap(sessSh);
    var ownerCheckRow = _readRows(sessSh, [loc.row])[0].values;
    var owner = String(ownerCheckRow[map['Employee ID']] || '').trim();
    if (requestingEmpId && owner && owner !== String(requestingEmpId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत.' });
    }
    var ownRow = ownerCheckRow;

    // Capture everything the deferred cleanup needs BEFORE deleting the row.
    var job = {
      sessionId: sessionId,
      tokenId:   String(ownRow[map['Token ID']]      || ''),
      dist:      String(ownRow[map['District']]      || ''),
      stn:       String(ownRow[map['Station']]       || ''),
      key:       String(ownRow[map['Checklist Key']] || ''),
      ts:        Date.now()
    };

    // 1) Delete ONLY the session row — fast; this is what the UI reacts to.
    var rows = _findRowsByColumn(sessSh, 'Session ID', sessionId);
    rows.sort(function (a, b) { return b - a; });
    rows.forEach(function (rn) { sessSh.deleteRow(rn); });
    _LOC_CACHE = {};   // row numbers shifted — invalidate all cached positions
    try { CacheService.getScriptCache().remove(_LOC_CS_PFX + sessionId); } catch (_cde) {}
    _invalidateEmpCaches(String(requestingEmpId || '').trim());

    // 2) Queue the heavy cleanup (response rows, PDF, marker).
    var props = PropertiesService.getScriptProperties();
    var q = JSON.parse(props.getProperty('DELETE_QUEUE') || '[]');
    q.push(job);
    props.setProperty('DELETE_QUEUE', JSON.stringify(q));

    logAction('DELETE_SESSION', sessionId, { by: requestingEmpId, deferred: true });
    return JSON.stringify({ ok: true, msg: '🗑 अहवाल हटवला.' });
  } catch (e) {
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

function processDeleteQueue() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props  = PropertiesService.getScriptProperties();
    var budget = 4 * 60 * 1000;            // stay under the 6-min limit
    var start  = Date.now();
    while (Date.now() - start < budget) {
      var q = JSON.parse(props.getProperty('DELETE_QUEUE') || '[]');
      if (!q.length) break;
      var job = q.shift();
      props.setProperty('DELETE_QUEUE', JSON.stringify(q));
      var sid = job.sessionId;
      // Consolidated store: answers live in the session row (deleted above).
      // Only touch legacy sheets if they still exist (don't recreate them).
      try { var _ls = _legacySheet('Shift_Responses'); if (_ls) _deleteResponseRows(_ls, sid); } catch (e1) { Logger.log('delQ shift: ' + e1); }
      try { var _lb = _legacySheet('Bus_Responses');   if (_lb) _deleteResponseRows(_lb, sid); } catch (e2) { Logger.log('delQ bus: '   + e2); }
      // Remove the PDF (both Completed & Pending trees) + the pending marker.
      try {
        if (job.key && job.tokenId) {
          var fname = 'MSRTC_' + String(job.key).toUpperCase() + '_' + job.tokenId + '.pdf';
          _pdfTrashExisting(job.dist || '', job.stn || '', fname);
        }
        _pdfClearPendingMarker(job.dist || '', job.stn || '', job.tokenId, sid);
      } catch (e3) { Logger.log('delQ pdf: ' + e3); }
    }
  } catch (e) { Logger.log('processDeleteQueue: ' + e); }
  finally { try { lock.releaseLock(); } catch (e4) {} }
}

function installDeleteQueueTrigger() {
  _deleteTriggersByName('processDeleteQueue');
  ScriptApp.newTrigger('processDeleteQueue').timeBased().everyMinutes(5).create();
  return 'Delete queue trigger installed (every 5 min, drains full queue).';
}

/* =====================================================================
   FIX I — _updateSessionRecord: one read + one write instead of up to
   five individual setValue() calls. The five target columns are
   contiguous in the standard layout; otherwise fall back per-cell.
   ===================================================================== */
function _updateSessionRecord(sessionId, completedShifts, completedBuses, pdfUrl, status, totalShifts) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return;
    var sh  = loc.sheet;
    var map = _headerMap(sh);
    var r   = loc.row;
    var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');

    var c = {
      lu: map['Last Updated'], cs: map['Completed Shifts'],
      tb: map['Total Buses'],  st: map['Status'], pu: map['PDF URL'],
      ts: map['Total Shifts']
    };
    var defined = [c.lu, c.cs, c.tb, c.st, c.pu].every(function (x) { return x !== undefined; });
    if (defined) {
      var startCol = Math.min(c.lu, c.cs, c.tb, c.st, c.pu);
      var endCol   = Math.max(c.lu, c.cs, c.tb, c.st, c.pu);
      // Include Total Shifts column in the batch range if needed
      if (totalShifts !== undefined && totalShifts !== null && c.ts !== undefined) {
        startCol = Math.min(startCol, c.ts);
        endCol   = Math.max(endCol, c.ts);
      }
      var width    = endCol - startCol + 1;
      if (width <= 12) {                             // contiguous enough → single batch write
        var rng  = sh.getRange(r, startCol + 1, 1, width);
        var vals = rng.getValues()[0];
        var prevPdf = c.pu !== undefined ? String(vals[c.pu - startCol] || '').trim() : '';
        vals[c.lu - startCol] = now;
        if (completedShifts !== null && completedShifts !== undefined) vals[c.cs - startCol] = completedShifts;
        if (completedBuses  !== null && completedBuses  !== undefined) vals[c.tb - startCol] = completedBuses;
        if (status) vals[c.st - startCol] = status;
        if (pdfUrl !== null && pdfUrl !== undefined) vals[c.pu - startCol] = pdfUrl;
        if (totalShifts !== undefined && totalShifts !== null && c.ts !== undefined) vals[c.ts - startCol] = totalShifts;
        rng.setValues([vals]);
        return prevPdf;   // ← return old PDF URL so caller can detect stale-PDF without extra API call
      }
    }
    // Fallback (non-standard column layout): per-cell writes.
    if (c.lu !== undefined) sh.getRange(r, c.lu + 1).setValue(now);
    if (completedShifts !== null && completedShifts !== undefined && c.cs !== undefined)
      sh.getRange(r, c.cs + 1).setValue(completedShifts);
    if (completedBuses !== null && completedBuses !== undefined && c.tb !== undefined)
      sh.getRange(r, c.tb + 1).setValue(completedBuses);
    if (status && c.st !== undefined) sh.getRange(r, c.st + 1).setValue(status);
    if (pdfUrl && c.pu !== undefined) sh.getRange(r, c.pu + 1).setValue(pdfUrl);
  } catch (e) { Logger.log('_updateSessionRecord: ' + e); }
}

/* One-time repair for rows whose Created Time shifted to the next day. */
function repairSessionDates() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return 'सर्व्हर व्यस्त — पुन्हा प्रयत्न करा.';
  try {
    var sh   = getSessionsSheet();
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return 'No rows to repair.';
    var headers = data[0];
    var ctCol = headers.indexOf('Created Time');
    var luCol = headers.indexOf('Last Updated');
    if (ctCol < 0) return 'Created Time column not found.';

    var fixed = 0;
    for (var i = 1; i < data.length; i++) {
      var raw = data[i][ctCol];
      var str = (raw instanceof Date)
        ? Utilities.formatDate(raw, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss')
        : String(raw || '').trim();
      if (!str) continue;
      sh.getRange(i + 1, ctCol + 1).setNumberFormat('@').setValue(str);
      if (luCol >= 0) {
        var lraw = data[i][luCol];
        var lstr = (lraw instanceof Date)
          ? Utilities.formatDate(lraw, 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss')
          : String(lraw || '').trim();
        if (lstr) sh.getRange(i + 1, luCol + 1).setNumberFormat('@').setValue(lstr);
      }
      fixed++;
    }
    sh.getRange(2, ctCol + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    if (luCol >= 0) sh.getRange(2, luCol + 1, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    fixSpreadsheetTimezone();
    return 'Repaired ' + fixed + ' rows. Created Time locked to IST text.';
  } catch (e) {
    Logger.log('repairSessionDates: ' + e);
    return 'Error: ' + e.toString();
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function markSessionsAsPaused() {
  try {
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh  = _chainSessionsSheet(ids[li]);
      var map = _headerMap(sh);
      if (map['Status'] === undefined || map['Last Updated'] === undefined) continue;
      var statuses = _colValues(sh, 'Status');
      if (!statuses.length) continue;
      var updated  = _colValues(sh, 'Last Updated');
      var cutoffMs = new Date().getTime() - (CONFIG.SESSION_TIMEOUT_MIN * 60 * 1000);

      var stale = [];                                   // sheet row numbers
      for (var i = 0; i < statuses.length; i++) {
        if (String(statuses[i]) !== STATUS.IN_PROCESS) continue;
        var lastUpdated = _parseISTDateString(_normalizeCreated(updated[i]));
        if (lastUpdated && lastUpdated < cutoffMs) stale.push(i + 2);
      }
      if (!stale.length) continue;

      var statusCol = map['Status'] + 1;
      var j = 0;                                        // write contiguous runs
      while (j < stale.length) {
        var start = stale[j], end = start;
        while (j + 1 < stale.length && stale[j + 1] === end + 1) { j++; end = stale[j]; }
        var block = [];
        for (var r = start; r <= end; r++) block.push([STATUS.PAUSED]);
        sh.getRange(start, statusCol, block.length, 1).setValues(block);
        j++;
      }
    }
  } catch (e) { Logger.log('markSessionsAsPaused: ' + e); }
}

function installPauseTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'markSessionsAsPaused') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('markSessionsAsPaused').timeBased().everyMinutes(30).create();
  return 'Stale-session pause trigger installed (every 30 min).';
}
/* =====================================================================
   FOLDER SORT TRIGGER — periodic safety-net.
   ===================================================================== */
function installFolderSortTrigger() {
  _deleteTriggersByName('sortPDFFolders');
  ScriptApp.newTrigger('sortPDFFolders')
    .timeBased()
    .everyHours(6)
    .create();
  return 'Folder-sort trigger installed (every 6 hours).';
}

function sortPDFFolders() {
  try {
    var root = getFolder(CONFIG.PDF_FOLDER);
    [PDF_TOP_COMPLETED, PDF_TOP_PENDING].forEach(function(treeName) {
      var treeIt = root.getFoldersByName(treeName);
      if (!treeIt.hasNext()) return;
      var tree = treeIt.next();
      var files = tree.getFiles();
      while (files.hasNext()) {
        var file = files.next();
        Logger.log('[sortPDFFolders] Loose file found: ' + file.getName());
      }
    });
    Logger.log('[sortPDFFolders] Folder check complete.');
  } catch (e) {
    Logger.log('[sortPDFFolders] Error: ' + e);
  }
}

/* =====================================================================
   FIX H — installAllTriggers: keepWarm REMOVED. A time trigger cannot
   keep web-app (doPost) executions warm — every request is a fresh
   execution regardless — so it only consumed trigger quota. Any
   previously installed keepWarm trigger is deleted here.
   ===================================================================== */
function installAllTriggers() {
  var out = [];
  out.push(fixSpreadsheetTimezone());
  out.push(installPauseTrigger());
  out.push(installPDFQueueTrigger());
  out.push(installMonthEndTrigger());
  out.push(installAutoFinalizeTrigger());
  out.push(installArchiveTrigger());
  out.push(installDeleteQueueTrigger());
  try {
    if (typeof installFolderSortTrigger === 'function') out.push(installFolderSortTrigger());
  } catch (e) { out.push('Folder-sort trigger skipped: ' + e); }
  _deleteTriggersByName('keepWarm');
  out.push('keepWarm trigger removed (no effect on web-app cold starts).');
  Logger.log(out.join('\n'));
  return out.join('\n');
}

function createEmployeeMaster() {
  var ss = _ss();
  var sh = ss.getSheetByName('Employee_Master');

  if (sh) {
    sh.getRange(1, 1, 1, 2)
      .setValues([['Employee ID', 'Supervisor Name']])
      .setBackground('#002B6B')
      .setFontColor('#FFC400')
      .setFontWeight('bold')
      .setHorizontalAlignment('center');
    Logger.log('Employee_Master already exists — headers verified.');
    return;
  }

  sh = ss.insertSheet('Employee_Master');

  sh.getRange(1, 1, 1, 2)
    .setValues([['Employee ID', 'Supervisor Name']])
    .setBackground('#002B6B')
    .setFontColor('#FFC400')
    .setFontWeight('bold')
    .setHorizontalAlignment('center');

  sh.setColumnWidth(1, 140);
  sh.setColumnWidth(2, 250);
  sh.setFrozenRows(1);
  sh.setRowHeight(1, 36);

  var sampleData = [
    ['1001', 'राजेश पाटील'],
    ['2568', 'सुनीता देशमुख'],
    ['9875', 'अजय शिंदे'],
    ['3456', 'प्रिया कुलकर्णी'],
    ['7890', 'संजय माने']
  ];

  sh.getRange(2, 1, sampleData.length, 2).setValues(sampleData);

  sh.getRange(2, 1, sampleData.length, 2)
    .setHorizontalAlignment('left')
    .setFontSize(11);

  sh.getRange(1, 1, sh.getMaxRows(), 1).setNumberFormat('@');

  var idRange = sh.getRange(2, 1, sh.getMaxRows() - 1, 1);
  var rule = SpreadsheetApp.newDataValidation()
    .requireNumberGreaterThan(0)
    .setAllowInvalid(false)
    .setHelpText('Employee ID must be a number (e.g. 1001)')
    .build();
  idRange.setDataValidation(rule);

  sh.autoResizeColumn(1);
  sh.autoResizeColumn(2);

  try {
    var protection = sh.getRange(1, 1, 1, 2).protect();
    protection.setDescription('Header row — do not edit');
    protection.setWarningOnly(true);
  } catch(e) {
    Logger.log('Protection skipped: ' + e);
  }

  Logger.log('Employee_Master created successfully with ' + sampleData.length + ' sample records.');
  Logger.log('Add your real supervisors in column A (ID) and column B (Name).');
}
/* Adds the two new export menu items. */
function onOpen() {
  try {
    SpreadsheetApp.getUi()
      .createMenu('⚙️ MSRTC')
      .addItem('सर्व ट्रिगर्स इंस्टॉल करा', 'installAllTriggers')
      .addItem('जुने सत्र संग्रहित करा (Archive)', 'archiveOldSessions')
      .addItem('कॅशे साफ करा (Clear Cache)', 'clearAllCaches')
      .addItem('📊 Session Status Report', 'diagnosticPausedSessions')
      .addItem('🔧 Debug Resume Session', 'debugResumeSession')
      .addSeparator()
      .addItem('🔍 Cell Usage Diagnostic (run this first)', 'diagnoseCellUsage')
      .addItem('🔗 Session Chain Status', 'diagnoseChainStatus')
      .addItem('✂️ Trim Empty Grid Space (safe, no data touched)', 'trimEmptyGridSpace')
      .addItem('📦 Archive Old Shift/Bus Response Rows', 'archiveLegacyResponseSheets')
      .addToUi();
  } catch (e) { Logger.log('onOpen: ' + e); }
}

function countPausedSessions() {
  try {
    var sh = getSessionsSheet();
    var c = _headerMap(sh);
    var statuses = _colValues(sh, 'Status');
    var paused = statuses.filter(function(s) { return String(s).trim() === STATUS.PAUSED; }).length;
    var inProcess = statuses.filter(function(s) { return String(s).trim() === STATUS.IN_PROCESS; }).length;
    var completed = statuses.filter(function(s) { return String(s).trim() === STATUS.COMPLETED; }).length;
    
    var msg = 'Checklist Status Summary:\n\n' +
      '✅ Completed: ' + completed + '\n' +
      '⏳ In Process: ' + inProcess + '\n' +
      '⏸️ Paused: ' + paused + '\n\n' +
      'Total: ' + (completed + inProcess + paused);
    
    SpreadsheetApp.getUi().alert(msg);
  } catch (e) { Logger.log(e); }
}

function fixSpreadsheetTimezone() {
  try {
    _ss().setSpreadsheetTimeZone('Asia/Kolkata');
    return 'Spreadsheet timezone set to Asia/Kolkata (IST).';
  } catch (e) {
    Logger.log('fixSpreadsheetTimezone: ' + e);
    return 'Timezone set failed: ' + e;
  }
}

/* === BATCH WRITE === */

function batchWriteToSheet(sheet, rows, batchSize) {
  // NOTE: callers (saveShift/saveBus/editShift/editBus) already hold the
  // user lock, so this function must NOT acquire it again. Write directly.
  try {
    batchSize = batchSize || 50;
    for (var i = 0; i < rows.length; i += batchSize) {
      var batch    = rows.slice(i, Math.min(i + batchSize, rows.length));
      var startRow = sheet.getLastRow() + 1;
      sheet.getRange(startRow, 1, batch.length, batch[0].length).setValues(batch);
    }
    return { ok: true, processed: rows.length };
  } catch (e) {
    Logger.log('Batch write error: ' + e.toString());
    return { ok: false, error: e.toString() };
  }
}

/* =====================================================================
   FIX B — saveShift: dead code removed; duplicate check reads ONLY the
   Shift Name column in blocked runs; no server draft write (SERVER_DRAFTS);
   FINALIZE COUNT FIXED — the old _autoFinalizeSession path wrote
   completedShifts.length WITHOUT the shift just saved (5/6 bug).
   ===================================================================== */
/* =====================================================================
   submitFullChecklist — the "all shifts on one screen, one submit" path.
   Receives the WHOLE day's shifts at once, writes them, marks the session
   COMPLETED, renders the PDF, and returns its URL. ONE server execution,
   ONE round trip. No per-shift saves, no In Process, no resume needed.

   payload = {
     sessionId?, tokenId?, dist, stn, name, id, date,
     checklistKey, checklist, totalShifts,
     shifts: [ { shiftName, answers:{q:val}, remarks:{q:txt} }, ... ]
   }
   ===================================================================== */
/* Lightweight poll: returns the PDF URL for a session once the background
   worker has rendered it (else pdfUrl:''). Used by the success screen so the
   download link appears a few seconds after submit without blocking it. */
function getSessionPdf(sessionId) {
  try {
    if (!sessionId) return JSON.stringify({ ok: false });
    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: true, pdfUrl: '' });
    var c = _headerMap(loc.sheet);
    if (c['PDF URL'] === undefined) return JSON.stringify({ ok: true, pdfUrl: '' });
    var url = String(loc.sheet.getRange(loc.row, c['PDF URL'] + 1).getValue() || '').trim();
    return JSON.stringify({ ok: true, pdfUrl: url });
  } catch (e) {
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* SPEED: generate the PDF immediately, in-line, rather than waiting on
   the queue + trigger. The queue exists so the submit click itself never
   has to wait for a PDF render — but the trigger that drains the queue
   has its own platform-level dispatch latency on top of the ~2s wake
   debounce, which is overhead this direct path skips entirely. The
   client calls this right after a successful save, in parallel with its
   existing poll; whichever path finishes first wins, and the queue keeps
   running as a safety net in case this call never completes (tab closed,
   network drop) — see the "already has a fresh PDF" skip in
   processPDFQueue, which avoids redundant double-rendering when this
   direct path already succeeded. */
function generatePdfNow(sessionId, requestingEmpId) {
  try {
    if (!sessionId) return JSON.stringify({ ok: false, msg: 'Session ID आवश्यक.' });
    if (requestingEmpId) {
      var owned = _sessionOwnedBy(sessionId, requestingEmpId);
      if (owned === null)  return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
      if (owned === false) return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });
    }
    var payload = getSessionDataForPDF(sessionId);
    if (!payload) return JSON.stringify({ ok: false, msg: 'Session डेटा आढळला नाही.' });
    payload._pending = (_getSessionStatus(sessionId) !== STATUS.COMPLETED);

    // Skip the both-tree trash search when there's no prior PDF to overwrite.
    try {
      var _gloc = _locateSession(sessionId);
      if (_gloc) {
        var _gm = _headerMap(_gloc.sheet);
        var _prev = String(_gloc.sheet.getRange(_gloc.row, _gm['PDF URL'] + 1).getValue() || '').trim();
        payload._skipTrash = !_prev;
      }
    } catch (_se) {}

    var url = generateCombinedPDF(payload);
    if (!url) return JSON.stringify({ ok: false, msg: 'PDF तयार करता आली नाही.' });
    _updateSessionRecord(sessionId, null, null, url, null);
    _invalidateEmpCaches(String(payload.id || '').trim());
    return JSON.stringify({ ok: true, pdfUrl: url });
  } catch (e) {
    Logger.log('[generatePdfNow] ' + sessionId + ': ' + e);
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* Ensure a session row exists for payload.sessionId; creates one if it
   doesn't. Returns {sessionId, tokenId}. Shared by submitFullChecklist
   and saveBus — both need this because the client always pre-generates a
   sessionId before the very first save of ANY kind (offline-queue
   support, instant token display), so "payload.sessionId is present"
   never reliably means "the row already exists" for either shift/week/
   single mode OR bus mode. Without this, the first save attempt for a
   brand-new session in either mode would fail to find a row to write
   into, even though the data write itself would otherwise be correct. */
function _ensureSessionRow(payload, defaultStatus, defaultTotalShifts) {
  var sessionId = payload.sessionId || '';
  var tokenId   = payload.tokenId   || '';
  var rowExists = false;
  if (sessionId) rowExists = (_sessionRowIndex(sessionId) >= 1);
  if (!rowExists) {
    // FIX: for backdated entries (supervisor selected a past date ≠ today),
    // skip the continuation check and always create a fresh row with the
    // correct past date. Without this fix, findContinuationSession returns
    // today's in-process bw session and:
    //   1. Backdated buses get a WRONG date (today's date in the sheet).
    //   2. Any bus already in today's session triggers a false duplicate error.
    // For today's entries, continuation works as before (resume existing session).
    var _todayIST = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyy-MM-dd');
    var _isBackdate = payload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))
                      && String(payload.date) !== _todayIST;
    // HARDENING (audit A1): only adopt an existing in-process session when we
    // have a concrete employee id to scope the lookup to. findContinuationSession
    // applies its Employee-ID filter only `if (empClean)`, so a falsy id makes it
    // match ANY supervisor's in-process session at this station+checklist — which
    // would silently merge this save into a DIFFERENT supervisor's compliance
    // record. The app's identity model always supplies a numeric id, so a missing
    // one means "start a fresh row", never "adopt someone else's session".
    var _contEmp = String(payload.id || '').trim();
    if (!_isBackdate && _contEmp) {
      var existing = findContinuationSession(payload.stn, payload.checklistKey, _contEmp);
      if (existing) { sessionId = existing.sessionId; tokenId = existing.tokenId; rowExists = true; }
    }
  }
  if (!rowExists) {
    if (!sessionId) sessionId = 'SES-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
    // Always generate the real, sequential token here — never trust a
    // client-sent tokenId for a brand-new row. The client pre-generates a
    // placeholder purely for instant on-screen display before the network
    // round-trip completes (e.g. "MSRTC-XXX-XXXX-145233", since its
    // regex-based code() strips out Marathi district/station names
    // entirely and falls back to a time-based suffix). That placeholder
    // is never meant to be the real token; only getNextTokenId()'s
    // properly transliterated, sequential "MSRTC-DIST-STN-0001" format
    // should ever be persisted or shown after the server responds.
    tokenId = getNextTokenId(payload.dist, payload.stn);
    // Respect backdated date from client (comes as yyyy-MM-dd from <input type="date">)
    var nowFull = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
    var nowTime = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'HH:mm:ss');
    var _createdStr = nowFull;
    if (payload.date && /^\d{4}-\d{2}-\d{2}$/.test(String(payload.date))) {
      var _sdp = payload.date.split('-');
      _createdStr = _sdp[2] + '/' + _sdp[1] + '/' + _sdp[0] + ' ' + nowTime;
    }
    var _activeId = _activeChainId();
    var sSheet = _chainSessionsSheet(_activeId);
    var sMap = _headerMap(sSheet);
    var rowArr = new Array(sSheet.getLastColumn()).fill('');
    function _set(col, val) { if (sMap[col] !== undefined) rowArr[sMap[col]] = val; }
    _set('Session ID', sessionId);   _set('Token ID', tokenId);
    _set('District', _sanitizeCell(payload.dist));  _set('Station', _sanitizeCell(payload.stn));
    _set('Supervisor Name', _sanitizeCell(payload.name)); _set('Employee ID', _sanitizeCell(payload.id));
    var _checklistLabel = payload.checklist
      || (CHECKLIST_META[payload.checklistKey] || {}).label
      || payload.checklistKey || '';
    _set('Checklist Type', _sanitizeCell(_checklistLabel)); _set('Checklist Key', _sanitizeCell(payload.checklistKey));
    _set('Created Time', _createdStr);   // ← backdated date
    _set('Last Updated', nowFull);
    _set('Completed Shifts', 0); _set('Total Buses', 0);
    _set('Status', defaultStatus); _set('Total Shifts', defaultTotalShifts || 0);
    sSheet.appendRow(rowArr);
    // Force plain-text format on date columns so Sheets doesn't auto-convert strings to Date.
    // Created Time + Last Updated are adjacent — batch them: 1 setNumberFormats + 1 setValues.
    try {
      var _nr = sSheet.getLastRow();
      var _nm = _headerMap(sSheet);
      var _ctCol = _nm['Created Time'], _luCol = _nm['Last Updated'];
      if (_ctCol !== undefined && _luCol !== undefined) {
        var _startC = Math.min(_ctCol, _luCol), _endC = Math.max(_ctCol, _luCol);
        var _w = _endC - _startC + 1;
        var _dateRng = sSheet.getRange(_nr, _startC + 1, 1, _w);
        var _fmts = [], _vals = [];
        for (var _di = 0; _di < _w; _di++) {
          _fmts.push('@');
          _vals.push(_di === (_ctCol - _startC) ? _createdStr : (_di === (_luCol - _startC) ? nowFull : rowArr[_startC + _di]));
        }
        _dateRng.setNumberFormats([_fmts]);   // 1 API call (was 2 × setNumberFormat)
        _dateRng.setValues([_vals]);           // 1 API call (was 2 × setValue)
      } else if (_ctCol !== undefined) {
        sSheet.getRange(_nr, _ctCol + 1).setNumberFormat('@').setValue(_createdStr);
      } else if (_luCol !== undefined) {
        sSheet.getRange(_nr, _luCol + 1).setNumberFormat('@').setValue(nowFull);
      }
    } catch (_te) { Logger.log('date col format: ' + _te); }
    _SHEET_CACHE = {}; _LOC_CACHE = {};
    // Pre-populate both caches for the new row so every _locateSession below is free.
    var _newRow = sSheet.getLastRow();
    _LOC_CACHE[sessionId] = { sheet: sSheet, row: _newRow, chainId: _activeId };
    try {
      CacheService.getScriptCache().put(
        _LOC_CS_PFX + sessionId,
        JSON.stringify({ r: _newRow, c: _activeId }),
        600
      );
    } catch (_cpe) {}
  }
  return { sessionId: sessionId, tokenId: tokenId };
}

function submitFullChecklist(payload) {
  var lock = LockService.getScriptLock();   // CHANGED: global lock, not deployment-dependent
  if (!lock.tryLock(5000)) return JSON.stringify({ ok: false, busy: true, msg: 'कृपया थांबा — पुन्हा प्रयत्न करा.' });
  _JSON_WRITE_LOCK_HELD = true;   // A2: we already hold getScriptLock — _mergeSessionShifts must run inline, not re-acquire it
  try {
    if (!payload || !payload.checklistKey || !payload.shifts || !payload.shifts.length) {
      // DIAGNOSTIC LOGGING (per request): the main submit button's rejection
      // now logs exactly what arrived, so a false-positive "अपूर्ण डेटा" here
      // can be traced to its real cause instead of guessed at.
      Logger.log('[submitFullChecklist] REJECTED — checklistKey=' + (payload && payload.checklistKey) +
                 ' shiftsLen=' + (payload && payload.shifts ? payload.shifts.length : '(missing)') +
                 ' sessionId=' + (payload && payload.sessionId) +
                 ' tokenId=' + (payload && payload.tokenId) +
                 ' stn=' + (payload && payload.stn) +
                 ' id=' + (payload && payload.id) +
                 ' rawPayloadKeys=' + (payload ? JSON.stringify(Object.keys(payload)) : '(no payload)'));
      var missingWhat = !payload ? 'विनंती' : (!payload.checklistKey ? 'चेकलिस्ट प्रकार' : 'पाळ्यांचा डेटा');
      return JSON.stringify({ ok: false, msg: 'अपूर्ण डेटा — ' + missingWhat + ' सर्व्हरला मिळाला नाही. कृपया पुन्हा प्रयत्न करा; पुन्हा झाल्यास स्क्रीनशॉट पाठवा.' });
    }
// ── DUPLICATE GATE ────────────────────────────────────────────────
    var _gMeta = CHECKLIST_META[payload.checklistKey] || {};
    // SPEED: skip the gate entirely if this sessionId already exists in the
    // sheet — we know it's an in-process session being continued, not a
    // duplicate first submission. The gate only matters for the very first
    // save of the day (brand-new sessionId), saving ~400ms on every repeat save.
    var _sessionConfirmedInSheet = !!(payload.sessionId && _sessionRowIndex(payload.sessionId) >= 1);
    if (_gMeta.mode !== 'bus' && !_sessionConfirmedInSheet) {
      try {
        var _gDone = JSON.parse(
        checkChecklistCompletedToday(payload.id, payload.stn, payload.checklistKey, payload.date)
        );
        // COMPLETED → block entirely
        if (_gDone && _gDone.completed && !_gDone.inProcess) {
          logAction(LOG_ACTIONS.DUPLICATE_BLOCKED, '',
            { stn: payload.stn, key: payload.checklistKey, by: payload.id });
          return JSON.stringify({
            ok: false,
            completedToday: true,
            info: _gDone,
            msg: '✅ ही चेकलिस्ट आज आधीच पूर्ण झाली आहे.'
          });
        }
        if (_gDone && _gDone.inProcess && _gDone.sessionId && !payload.sessionId) {
          payload.sessionId = _gDone.sessionId;
          payload.tokenId   = _gDone.tokenId;
          Logger.log('[submitFullChecklist] adopted existing in-process session ' + _gDone.sessionId);
        }
      } catch (_ge) { Logger.log('submitFull gate: ' + _ge); }
    }
    // ─────────────────────────────────────────────────────────────────
    var meta = CHECKLIST_META[payload.checklistKey] || {};
    var nDone = payload.shifts.length;   // shifts actually filled & submitted now
    
    // PARTIAL PROGRESS: the supervisor may submit only some of the day's
    // selected shifts. totalSelected = how many shifts the day requires
    // (the 4 or 6 chosen); status is In Process until all are filled.
    var totalSelected = parseInt(payload.totalShifts, 10);
    if (!(totalSelected >= 1 && totalSelected <= SHIFTS.length)) totalSelected = nDone;
    if (nDone > totalSelected) totalSelected = nDone;   // never less than what's filled
    var finalStatus = (meta.mode !== 'bus' && nDone >= totalSelected)
      ? STATUS.COMPLETED : STATUS.IN_PROCESS;

    // 1) Reuse today's open session for this station+checklist, else create
    //    one. FIX: this used to gate purely on "did payload.sessionId
    //    arrive empty" — but the client has always pre-generated a
    //    sessionId before even the FIRST submission (for offline-queue
    //    support and showing the token immediately), so a truthy
    //    payload.sessionId stopped meaning "this row already exists" a
    //    long time ago. Result: row-creation was skipped for every
    //    brand-new submission, and the merge step below correctly failed
    //    to find a row to write into, since none had ever been created.
    //    _ensureSessionRow checks real existence instead (shared with
    //    saveBus, which has the identical defect for bus-mode checklists).
    var ens = _ensureSessionRow(payload, finalStatus, totalSelected);
    var sessionId = ens.sessionId;
    var tokenId   = ens.tokenId;

    // 2) PER-SHIFT REPLACE: for each shift being submitted, clear ONLY that
    //    shift's old rows then write the new ones. Shifts saved earlier but
    //    not in this submit are kept intact — so adding the remaining shifts
    //    later (with or without the resume button) never loses prior data,
    //    and re-submitting a shift never duplicates it.
    // CONSOLIDATED STORE: merge these shifts into the session's JSON column
    // (per-shift replace by name — previously-saved shifts are kept intact).
    // SPEED: use the returned merged list directly — avoids a re-read via loadPreviousShifts.
    var allSaved = _mergeSessionShifts(sessionId, payload.shifts);
    nDone = allSaved.length;
    if (nDone > totalSelected) totalSelected = nDone;
    finalStatus = (meta.mode !== 'bus' && nDone >= totalSelected)
      ? STATUS.COMPLETED : STATUS.IN_PROCESS;

    // 3) SPEED: queue the PDF instead of rendering it synchronously here.
    //    The data write above is already done and the
    //    supervisor's tap can return right now — generateCombinedPDF's
    //    HTML→PDF render is the slowest single step in this whole click,
    //    and the success screen doesn't need it to render: _pollSessionPdf
    //    on the client already polls getSessionPdf() and drops the link in
    //    as soon as the queue (runs every 1 minute, the trigger platform's
    //    minimum) finishes it.
    var pdfUrl = '', pdfError = '';
    _enqueuePDFJob(sessionId);

    // 4) Stamp the session row: status + counts + totalShifts in ONE batch write.
    _updateSessionRecord(sessionId, nDone, null, pdfUrl, finalStatus, totalSelected);
    if (finalStatus === STATUS.COMPLETED) {
      _cleanupDuplicateSessions(sessionId, payload.stn, payload.checklistKey);
      deleteDraft(sessionId);
    }
    _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
    try { if (typeof appendMasterRowsForSession === 'function') appendMasterRowsForSession(sessionId); } catch (e) {}
    if (HOT_PATH_AUDIT) logAction(LOG_ACTIONS.FINALIZE, sessionId, { done: nDone, total: totalSelected, status: finalStatus });

    var doneMsg = (finalStatus === STATUS.COMPLETED)
      ? '✅ चेकलिस्ट पूर्ण झाली!'
      : ('💾 ' + nDone + '/' + totalSelected + ' पाळ्या जतन झाल्या. उरलेल्या पाळ्या नंतर "माघील अहवाल" मधून पूर्ण करा.');
    return JSON.stringify({
      ok: true, msg: doneMsg,
      sessionId: sessionId, tokenId: tokenId,
      status: finalStatus,
      completedShifts: nDone, totalShifts: totalSelected,
      pdfUrl: pdfUrl, pdfPending: !pdfUrl, pdfError: pdfError, shifts: nDone
    });
  } catch (e) {
    Logger.log('[submitFullChecklist] ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  } finally {
    _JSON_WRITE_LOCK_HELD = false;   // A2: clear the re-entrancy flag paired with the script lock
    try { lock.releaseLock(); } catch (_le) {}
  }
}

function saveShift(payload) {
  try {
    var v = _validatePayload(payload, ['sessionId', 'shiftName', 'answers']);
    if (!v.ok) return JSON.stringify({ ok: false, msg: 'अपूर्ण डेटा (कोड: ' + (v.field || '?') + ').' });

    /* Reject if this session is already Completed */
    var _storedTotal = '';
    var _loc = _locateSession(payload.sessionId);
    if (_loc) {
      var sColIdx = _headerMap(_loc.sheet);
      var _srow = _readRows(_loc.sheet, [_loc.row])[0].values;
      if (sColIdx['Total Shifts'] !== undefined) _storedTotal = _srow[sColIdx['Total Shifts']];
      if (String(_srow[sColIdx['Status']] || '').trim() === STATUS.COMPLETED) {
        return JSON.stringify({
          ok: false, alreadyCompleted: true,
          msg: '✅ ही चेकलिस्ट आधीच पूर्ण झाली आहे. नवीन चेकलिस्ट सुरू करा.',
          pdfUrl: String(_srow[sColIdx['PDF URL']] || '')
        });
      }
    }

    var lock = LockService.getUserLock();
    if (!lock.tryLock(8000)) {
      return JSON.stringify({ ok: false, busy: true,
        msg: 'कृपया थांबा — मागील नोंद सुरू आहे. / Please wait.' });
    }
    try {
      // Duplicate check against the consolidated JSON store.
      var normIncoming = _normaliseUnitName(payload.shiftName);
      var already = _readSessionUnits(payload.sessionId, SHIFTS_JSON_COL);
      for (var di = 0; di < already.length; di++) {
        if (_normaliseUnitName(String(already[di].shiftName || '')) === normIncoming) {
          return JSON.stringify({
            ok: false, duplicateShift: true, shiftName: payload.shiftName,
            msg: payload.shiftName + ' आधीच नोंदवली आहे. (Duplicate shift — already saved.)'
          });
        }
      }

      // CONSOLIDATED STORE: add this shift to the session's JSON.
      _mergeSessionShifts(payload.sessionId, [{
        shiftName: payload.shiftName,
        answers: payload.answers,
        remarks: payload.remarks || {}
      }]);

      var completedNow = ((payload.completedShifts || []).length) + 1;

      var meta          = CHECKLIST_META[payload.checklistKey] || {};
      var requiredUnits = _sessionTotalUnits(payload.checklistKey,
        (_storedTotal !== '' && _storedTotal != null) ? _storedTotal : payload.totalShifts);

      var reachedTotal = (meta.mode !== 'bus' && completedNow >= requiredUnits);

      if (meta.mode !== 'bus') {
        // QUOTA FIX: never render synchronously per shift. The old code called
        // generateCombinedPDF on EVERY shift save — 6 HTML→PDF conversions for a
        // 6-shift report, 5 of them instantly overwritten — which was a top cause
        // of the daily "too many conversions" quota error. Queue ONE PDF for the
        // whole session; the 1-min queue trigger renders it once, and the client's
        // _pollSessionPdf()/_tryDirectPdf() surface the link.
        var pdfUrl = '', pdfError = '';
        _updateSessionRecord(payload.sessionId, completedNow, null, pdfUrl, STATUS.COMPLETED);
        _enqueuePDFJob(payload.sessionId);
        _cleanupDuplicateSessions(payload.sessionId, payload.stn, payload.checklistKey);
        deleteDraft(payload.sessionId);
        _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
        try { if (typeof appendMasterRowsForSession === 'function') appendMasterRowsForSession(payload.sessionId); } catch (e) {}
        if (HOT_PATH_AUDIT) logAction(LOG_ACTIONS.SHIFT_SAVE, payload.sessionId,
          { shift: payload.shiftName, totalNow: completedNow, completedEach: true });

        return JSON.stringify({
          ok: true, msg: 'नोंद जतन झाली व पूर्ण म्हणून नोंदवली.',
          autoFinalized: true,
          eachShiftComplete: true,
          reachedTotal: reachedTotal,
          completedUnits: completedNow,
          requiredUnits:  requiredUnits,
          remaining:      Math.max(0, requiredUnits - completedNow),
          pdfUrl:   pdfUrl,
          pdfError: pdfError,
          tokenId:  payload.tokenId || '',
          status:   STATUS.COMPLETED
        });
      }

      _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
      return JSON.stringify({
        ok: true, msg: 'नोंद जतन झाली.', autoFinalized: false,
        completedUnits: completedNow, requiredUnits: requiredUnits
      });
    } finally { lock.releaseLock(); }
  } catch (e) {
    Logger.log('saveShift: ' + e);
    logAction(LOG_ACTIONS.ERROR, payload.sessionId || '',
      { source: 'saveShift', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* =====================================================================
   FIX C — _autoFinalizeSession: caller passes the correct completed
   count; Total Buses is left untouched (was being overwritten with 0).
   PDF is generated async by the queue trigger.
   ===================================================================== */
function _autoFinalizeSession(payload, doneCountOverride) {
  var doneCount = (typeof doneCountOverride === 'number')
    ? doneCountOverride
    : ((payload.completedShifts || []).length);
  _updateSessionRecord(payload.sessionId, doneCount, null, '', STATUS.COMPLETED);
  _cleanupDuplicateSessions(payload.sessionId, payload.stn, payload.checklistKey);  // one row per day
  deleteDraft(payload.sessionId);
  _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
  _enqueuePDFJob(payload.sessionId);   // background render
  try { if (typeof appendMasterRowsForSession === 'function') appendMasterRowsForSession(payload.sessionId); } catch(e){}
  return { pdfUrl: '', pdfError: '', queued: true };
}

function checkAndAutoFinalizePending() {
  try {
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh     = _chainSessionsSheet(ids[li]);
      var colIdx = _headerMap(sh);
      if (colIdx['Status'] === undefined) continue;
      var statuses = _colValues(sh, 'Status');
      var rowNums  = [];
      for (var s = 0; s < statuses.length; s++) {
        if (String(statuses[s] || '').trim() === STATUS.IN_PROCESS) rowNums.push(s + 2);
      }
      if (!rowNums.length) continue;
      var rowsRead = _readRows(sh, rowNums);

      for (var i = 0; i < rowsRead.length; i++) {
        var row = rowsRead[i].values;
        if (String(row[colIdx['PDF URL']] || '').trim()) continue;

        var checklistKey = String(row[colIdx['Checklist Key']] || '').trim();
        var meta         = CHECKLIST_META[checklistKey] || {};
        if (meta.mode === 'bus') continue;

        var requiredUnits = _sessionTotalUnits(checklistKey,
          colIdx['Total Shifts'] !== undefined ? row[colIdx['Total Shifts']] : '');
        var doneShifts    = parseInt(row[colIdx['Completed Shifts']] || 0, 10) || 0;
        if (doneShifts < requiredUnits) continue;

        var sessionId = String(row[colIdx['Session ID']] || '');
        try {
          _autoFinalizeSession({
            sessionId:    sessionId,
            tokenId:      String(row[colIdx['Token ID']]        || ''),
            dist:         String(row[colIdx['District']]        || ''),
            stn:          String(row[colIdx['Station']]         || ''),
            name:         String(row[colIdx['Supervisor Name']] || ''),
            id:           String(row[colIdx['Employee ID']]     || ''),
            checklistKey: checklistKey,
            checklist:    String(row[colIdx['Checklist Type']]  || ''),
            completedShifts: { length: doneShifts }
          }, doneShifts);
        } catch (e) { Logger.log('[AUTO-FINALIZE-PENDING] fail ' + sessionId + ' ' + e); }
        Utilities.sleep(1500);
      }
    }
  } catch (e) { Logger.log('[checkAndAutoFinalizePending] ' + e); }
}

function installAutoFinalizeTrigger() {
  _deleteTriggersByName('checkAndAutoFinalizePending');
  ScriptApp.newTrigger('checkAndAutoFinalizePending').timeBased().everyMinutes(30).create();
  return 'Auto-finalize trigger installed (every 30 min).';
}

/* === BUS SAVE === */

function saveBus(payload) {
  try {
    var v = _validatePayload(payload, ['sessionId', 'busNumber', 'answers']);
    if (!v.ok) return JSON.stringify({ ok: false, msg: 'अपूर्ण बस डेटा (कोड: ' + (v.field || '?') + ').' });

    var lock = LockService.getUserLock();
    if (!lock.tryLock(4000)) return JSON.stringify({ ok: false, busy: true, msg: 'कृपया थांबा — मागील नोंद सुरू आहे.' });
    try {
      // FIX: bus-mode checklists never went through createSession — the
      // client always pre-generates a sessionId before the first save
      // (same as shift mode), so this is the only place that could ever
      // create the session row for a brand-new bus checklist. Without
      // this, the first bus saved for any new session would fail with
      // "Session सापडले नाही", since there'd be nothing to write into.
      var _bvRaw = String(payload.busNumber || '').replace(/[\s\-]/g, '').toUpperCase();
      var _bv = _validateMHBusNumber(_bvRaw);
      if (!_bv.ok) return JSON.stringify({ ok: false, msg: _bv.msg });
      var bnUp = _bv.clean;

      var ens = _ensureSessionRow(payload, STATUS.IN_PROCESS, 0);
      payload.sessionId = ens.sessionId;
      payload.tokenId   = ens.tokenId;

      // FIX: client sends isRepeat:true; server used to check allowRepeat only
      // → repeat was always blocked even after "होय, पुन्हा नोंदवा" confirmation.
      var isRepeat = !!(payload.allowRepeat || payload.isRepeat);

  
      var now = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss');
      var allBuses = _saveSessionBus(payload.sessionId, bnUp, payload.answers, payload.remarks || {}, now, true);

      if (false) {   // legacy row path disabled
        var _noopB = batchWriteToSheet;
      }

      // SPEED: bus count from the client (+1 for this confirmed save) —
      // avoids re-reading & regrouping the whole session on every bus save.
      var busCountNow = allBuses.length;
      var _oldPdf = _updateSessionRecord(payload.sessionId, null, busCountNow, '', STATUS.IN_PROCESS);

      // SPEED FIX: _updateSessionRecord batch-read already includes PDF URL.
      // It returns old PDF URL so we detect stale PDFs here WITHOUT a separate
      // getRange().getValue() call (~100ms saved per bus save).
      if (_oldPdf) _enqueuePDFJob(payload.sessionId);

      if (SERVER_DRAFTS && payload.draftState) saveDraft(payload.sessionId, payload.draftState);
      _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
      if (HOT_PATH_AUDIT) logAction(LOG_ACTIONS.BUS_SAVE, payload.sessionId, { bus: bnUp, count: Object.keys(payload.answers || {}).length });
      return JSON.stringify({ ok: true, msg: 'बस नोंद झाली.', sessionId: payload.sessionId, tokenId: payload.tokenId });
    } finally { lock.releaseLock(); }
  } catch (e) {
    Logger.log('saveBus: ' + e);
    logAction(LOG_ACTIONS.ERROR, payload.sessionId || '', { source: 'saveBus', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}
/* Every shift checklist requires all units; PDF uses full template. */

/* === FINALIZE SESSION === */

function finalizeInspection(payload) {
  try {
    if (!payload || !payload.sessionId) {
      return JSON.stringify({ ok: false, msg: 'Session ID आढळला नाही.' });
    }

    var _meta    = CHECKLIST_META[payload.checklistKey] || {};
    var _isBus   = (_meta.mode === 'bus');
    var _storedTot = '';
    try {
      var _floc = _locateSession(payload.sessionId);
      if (_floc) {
        var _fc = _headerMap(_floc.sheet);
        if (_fc['Total Shifts'] !== undefined) {
          _storedTot = _readRows(_floc.sheet, [_floc.row])[0].values[_fc['Total Shifts']];
        }
      }
    } catch (_fe) {}
    var _total = _sessionTotalUnits(payload.checklistKey,
      (_storedTot !== '' && _storedTot != null) ? _storedTot : payload.totalShifts);
    payload.totalShifts = _total;
    var _doneShifts = (payload.completedShifts || []).length;
    var _willComplete = (_isBus || _doneShifts >= _total);
    payload._pending = !_willComplete;

    var newStatus = _willComplete ? STATUS.COMPLETED : STATUS.IN_PROCESS;

    // BUS-COUNT FIX: the client's finalize payload carries NO completedBuses, so
    // (payload.completedBuses||[]).length was 0 — which then OVERWROTE the real
    // "Total Buses" count with 0 on every bus finalize (the washes stay safe in
    // the Buses JSON column, but the count column, माघील अहवाल, dashboard and
    // every count-driven display went to 0). Derive the real counts SERVER-SIDE
    // from the consolidated JSON store, and pass null for the column that doesn't
    // apply to this mode so _updateSessionRecord leaves it untouched rather than
    // zeroing it.
    var _busCountFinal   = null;
    var _shiftCountFinal = null;
    if (_isBus) {
      try { _busCountFinal = loadPreviousBuses(payload.sessionId).length; }
      catch (e) { _busCountFinal = null; }
    } else {
      _shiftCountFinal = _doneShifts;
    }

    var pdfUrl = '', pdfError = '';
    _enqueuePDFJob(payload.sessionId);

    _updateSessionRecord(
      payload.sessionId, _shiftCountFinal,
      _busCountFinal,
      pdfUrl, newStatus
    );

    if (newStatus === STATUS.COMPLETED) {
      deleteDraft(payload.sessionId);
      _cleanupDuplicateSessions(payload.sessionId, payload.stn, payload.checklistKey);
    }
    _invalidateEmpCaches(String(payload.id || '').trim(), payload.date);
    if (HOT_PATH_AUDIT) logAction(LOG_ACTIONS.FINALIZE, payload.sessionId, {
      status: newStatus, shifts: _doneShifts, buses: _busCountFinal
    });
    try { if (typeof appendMasterRowsForSession === "function") appendMasterRowsForSession(payload.sessionId); } catch (e) { Logger.log('master hook: ' + e); }

    return JSON.stringify({
      ok: true,
      msg: '✅ चेकलिस्ट यशस्वीपणे पूर्ण झाली!',
      tokenId:  payload.tokenId,
      pdfUrl:   pdfUrl,
      pdfError: pdfError,
      status:   newStatus
    });
  } catch (e) {
    Logger.log('finalize: ' + e);
    logAction(LOG_ACTIONS.ERROR, payload.sessionId || '', { source: 'finalize', error: e.toString() });
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}


/* ONE-TIME REPAIR — recompute "Total Buses" for every bus-mode session from
   the consolidated Buses JSON, fixing rows whose count was zeroed by the old
   finalize bug. Bus rows only; safe to run multiple times.
   
   SPEED vs original:
   - Old: one getRange().setValue() per corrected row → O(n) API calls
   - New: one batch read per column, accumulate all corrections, one
     batch setValues() per sheet → O(1) API calls per sheet regardless
     of how many rows need fixing. On 500 bus sessions this is ~498
     fewer Sheets API calls and typically 10-30× faster. */
function repairBusCounts() {
  /* Bus-mode checklist keys — no CHECKLIST_META lookup needed */
  var BUS_KEYS = { 'bw': true, 'bm': true };

  var ids = _chainIds();
  var examined = 0, fixed = 0;

  for (var li = 0; li < ids.length; li++) {
    var sh      = _chainSessionsSheet(ids[li]);
    var c       = _headerMap(sh);
    var lastRow = sh.getLastRow();

    if (lastRow < 2)                         continue;
    if (c['Checklist Key'] === undefined ||
        c['Total Buses']   === undefined ||
        c['Session ID']    === undefined)    continue;

    var n = lastRow - 1;

    /* Single batch read — only the 3 columns we need */
    var minCol = Math.min(c['Session ID'], c['Checklist Key'], c['Total Buses']);
    var maxCol = Math.max(c['Session ID'], c['Checklist Key'], c['Total Buses']);
    var block  = sh.getRange(2, minCol + 1, n, maxCol - minCol + 1).getValues();

    var offSid = c['Session ID']    - minCol;
    var offKey = c['Checklist Key'] - minCol;
    var offBus = c['Total Buses']   - minCol;

    var corrections = [];   // { row (1-based sheet row), count }

    for (var i = 0; i < n; i++) {
      var key = String(block[i][offKey] || '').trim();

      /* Skip instantly — no CHECKLIST_META lookup, no loadPreviousBuses */
      if (!BUS_KEYS[key]) continue;
      examined++;

      var sid = String(block[i][offSid] || '').trim();
      if (!sid) continue;

      var actual = loadPreviousBuses(sid).length;
      var cur    = parseInt(block[i][offBus] || 0, 10) || 0;

      if (actual !== cur) corrections.push({ row: i + 2, count: actual });
    }

    if (!corrections.length) continue;
    fixed += corrections.length;

    /* Batch write — group contiguous rows into single setValues() calls */
    var busCol1 = c['Total Buses'] + 1;
    var ri = 0;
    while (ri < corrections.length) {
      var startRow = corrections[ri].row;
      var run      = [[ corrections[ri].count ]];
      while (ri + 1 < corrections.length &&
             corrections[ri + 1].row === corrections[ri].row + 1) {
        ri++;
        run.push([ corrections[ri].count ]);
      }
      sh.getRange(startRow, busCol1, run.length, 1).setValues(run);
      ri++;
    }
  }

  clearAllCaches();
  SpreadsheetApp.flush();

  var msg = 'Bus-count repair done.\n' +
            'bw/bm sessions examined : ' + examined + '\n' +
            'Counts corrected        : ' + fixed;
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/* fixInvalidShiftCounts() was defined twice with identical bodies; the second
   copy (formerly here) silently overrode the first. Removed to keep a single
   source of truth — the definition earlier in this file is the live one. */

/* Maharashtra RTO bus number validator.
   Accepts formats: MH-40-BP-9101 / MH40BP9101 / MH 40 BP 9101
   Pattern: MH + 2-digit RTO code + 2-letter series + 4-digit number
   Also accepts older 1-2 letter series: MH12A1234, MH04AB1234 */
/* Permissive bus-number check — accepts ANY alphanumeric number a supervisor
   enters in the field (MH, other states, passing/temp numbers). The old strict
   MH##XX#### pattern silently rejected legitimate field entries, which then
   never reached G.doneBuses on the client and vanished from the PDF. */
function _validateMHBusNumber(raw) {
  if (!raw) return { ok: false, msg: 'बस क्रमांक आवश्यक आहे.' };
  var bn = String(raw).toUpperCase().replace(/[\s\-]/g, '');
  if (bn.length < 4 || bn.length > 12) {
    return { ok: false, msg: '❌ बस क्रमांक ४ ते १२ अक्षरांचा असावा.' };
  }
  if (!/^[A-Z0-9]+$/.test(bn)) {
    return { ok: false, msg: '❌ बस क्रमांकात फक्त अक्षरे व अंक असावेत.' };
  }
  return { ok: true, clean: bn };
}
/* =====================================================================
   FIX F — searchPastInspections: Employee ID is mandatory, so locate
   ONLY that supervisor's rows via TextFinder instead of reading the
   entire Sessions sheet.
   ===================================================================== */
function searchPastInspections(filters) {
  try {
    if (!filters) filters = {};

    var reqEmpId = String(filters.employeeId || '').trim();
    if (!reqEmpId) {
      return JSON.stringify({ ok: false, msg: '❌ कर्मचारी आयडी आवश्यक आहे.', results: [], count: 0 });
    }

    var searchExactDate = null, rangeStartMs = null, rangeEndMs = null;
    if (filters.date) {
      var p = filters.date.split('-');
      if (p.length === 3) searchExactDate = p[2] + '/' + p[1] + '/' + p[0];
    }
    if (filters.dateFrom) {
      var pf = filters.dateFrom.split('-');
      if (pf.length === 3)
        rangeStartMs = new Date(parseInt(pf[0]), parseInt(pf[1]) - 1, parseInt(pf[2]), 0, 0, 0).getTime();
    }
    if (filters.dateTo) {
      var pt = filters.dateTo.split('-');
      if (pt.length === 3)
        rangeEndMs = new Date(parseInt(pt[0]), parseInt(pt[1]) - 1, parseInt(pt[2]), 23, 59, 59).getTime();
    }

    var tokenTerm = filters.token ? String(filters.token).trim().toUpperCase() : '';

    var results = [];
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh     = _chainSessionsSheet(ids[li]);
      var colIdx = _headerMap(sh);
      if (sh.getLastRow() < 2 || colIdx['Employee ID'] === undefined) continue;

      var rowNums = _findRowsByColumn(sh, 'Employee ID', reqEmpId);
      if (!rowNums.length) continue;
      rowNums.sort(function (a, b) { return b - a; });
      var srcRows = _readRows(sh, rowNums);

      // Bus-number filter for THIS link: find matching Session IDs via
      // TextFinder on the Buses JSON column (substring search, no full read).
      var busSessionSet = null;
      if (filters.busNumber) {
        busSessionSet = {};
        try {
          var bnTerm = String(filters.busNumber).trim().toUpperCase();
          var jcol   = colIdx[BUSES_JSON_COL];
          if (sh.getLastRow() >= 2 && jcol !== undefined) {
            var hits = sh.getRange(2, jcol + 1, sh.getLastRow() - 1, 1)
                          .createTextFinder(bnTerm).matchCase(false).findAll();
            var sesCol = colIdx['Session ID'] + 1;
            for (var h = 0; h < hits.length; h++) {
              var bsid = String(sh.getRange(hits[h].getRow(), sesCol).getValue() || '');
              if (bsid) busSessionSet[bsid] = true;
            }
          }
        } catch (be) { Logger.log('bus filter: ' + be); }
      }

      for (var i = 0; i < srcRows.length; i++) {
        var row     = srcRows[i].values;
        var created = _normalizeCreated(row[colIdx['Created Time']]);
        var rowToken= String(row[colIdx['Token ID']]   || '').toUpperCase();
        var rowSesId= String(row[colIdx['Session ID']] || '');

        if (tokenTerm && rowToken.indexOf(tokenTerm) === -1) continue;
        if (busSessionSet && !busSessionSet[rowSesId]) continue;

        if (searchExactDate) {
          if (created.indexOf(searchExactDate) !== 0) continue;
        } else if (rangeStartMs || rangeEndMs) {
          var createdMs = _parseISTDateString(created);
          if (!createdMs) continue;
          if (rangeStartMs && createdMs < rangeStartMs) continue;
          if (rangeEndMs   && createdMs > rangeEndMs)   continue;
        }
        if (filters.district     && String(row[colIdx['District']]      || '').trim() !== filters.district)     continue;
        if (filters.checklistKey && String(row[colIdx['Checklist Key']] || '').trim() !== filters.checklistKey) continue;

        results.push({
          sessionId:       rowSesId,
          tokenId:         String(row[colIdx['Token ID']]),
          district:        String(row[colIdx['District']]),
          station:         String(row[colIdx['Station']]),
          supervisor:      String(row[colIdx['Supervisor Name']]),
          employeeId:      reqEmpId,
          checklist:       String(row[colIdx['Checklist Type']]),
          checklistKey:    String(row[colIdx['Checklist Key']]),
          createdTime:     created,
          completedShifts: parseInt(row[colIdx['Completed Shifts']] || 0),
          totalBuses:      parseInt(row[colIdx['Total Buses']]      || 0),
          status:          String(row[colIdx['Status']] || ''),
          pdfUrl:          String(row[colIdx['PDF URL']] || '')
        });
      }
    }
    results.sort(function (a, b) { return b.createdTime.localeCompare(a.createdTime); });
    var capped = results.length > CONFIG.MAX_RESULTS;
    if (capped) results = results.slice(0, CONFIG.MAX_RESULTS);
    return JSON.stringify({ ok: true, results: results, count: results.length, capped: capped });
  } catch (e) {
    Logger.log('searchPastInspections ERROR: ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

function getEmployeeStats(empId) {
  try {
    if (!empId) return JSON.stringify({ ok: false });
    var idClean = String(empId).trim();

    var ck = 'stats_' + idClean;
    var cached = _cacheGet(ck);
    if (cached) return JSON.stringify(cached);

    var total = 0, withPdf = 0;
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh = _chainSessionsSheet(ids[li]);
      var colIdx = _headerMap(sh);
      if (colIdx['Employee ID'] === undefined || sh.getLastRow() < 2) continue;
      var rowNums = _findRowsByColumn(sh, 'Employee ID', idClean);
      if (!rowNums.length) continue;
      var rows = _readRows(sh, rowNums);
      total += rows.length;
      var pc = colIdx['PDF URL'];
      for (var i = 0; i < rows.length; i++) {
        if (pc !== undefined && String(rows[i].values[pc] || '').trim()) withPdf++;
      }
    }
    var out = { ok: true, total: total, withPdf: withPdf };
    _cacheSet(ck, out, CONFIG.STATS_CACHE_SEC);
    return JSON.stringify(out);
  } catch (e) {
    return JSON.stringify({ ok: false, msg: e.toString() });
  }
}

/* === SUPERVISOR REPORTS (माघील अहवाल) — SCALE: cap + short cache === */

function getSupervisorReports(empId, filterDate) {
  try {
    if (!empId) return JSON.stringify({ ok: false, msg: 'कर्मचारी आयडी आवश्यक आहे.' });

    var idClean = String(empId).trim();

    // SCALE: short-TTL cache keyed by emp + date filter
    var ck = 'rep_' + idClean + '_' + (filterDate || 'all');
    var cached = _cacheGet(ck);
    if (cached) return JSON.stringify(cached);

    var searchDateStr = null;
    if (filterDate && filterDate.length === 10) {
      var fp = filterDate.split('-');
      if (fp.length === 3) searchDateStr = fp[2] + '/' + fp[1] + '/' + fp[0];
    }

    var results = [];
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh = _chainSessionsSheet(ids[li]);
      var colIdx = _headerMap(sh);
      if (sh.getLastRow() < 2 || colIdx['Employee ID'] === undefined) continue;

      // SPEED: only this supervisor's rows (TextFinder), newest first.
      var rowNums = _findRowsByColumn(sh, 'Employee ID', idClean);
      if (!rowNums.length) continue;
      rowNums.sort(function (a, b) { return b - a; });
      var srcRows = _readRows(sh, rowNums);

      for (var i = 0; i < srcRows.length; i++) {
        var row      = srcRows[i].values;
        var rowEmpId = String(row[colIdx['Employee ID']] || '').trim();

        var createdTime = _normalizeCreated(row[colIdx['Created Time']]);
        if (searchDateStr && createdTime.indexOf(searchDateStr) !== 0) continue;

        var checklistKey    = String(row[colIdx['Checklist Key']] || '').trim();
        var status          = String(row[colIdx['Status']]        || '').trim();
        var pdfUrl          = String(row[colIdx['PDF URL']]       || '').trim();
        var completedShifts = parseInt(row[colIdx['Completed Shifts']] || 0);
        var totalBuses      = parseInt(row[colIdx['Total Buses']]      || 0);
        var meta            = CHECKLIST_META[checklistKey] || {};
        var units           = _getUnitsForKey(checklistKey);
        var totalUnits      = meta.mode === 'bus' ? '∞' : _sessionTotalUnits(checklistKey,
          colIdx['Total Shifts'] !== undefined ? row[colIdx['Total Shifts']] : '');

        var progressLabel = meta.mode === 'bus'
          ? totalBuses + ' बस'
          : completedShifts + '/' + totalUnits + ' ' + (meta.mode === 'week' ? 'आठवडा' : meta.mode === 'single' ? 'पूर्ण' : 'पाळी(Shift)');

        var dtParts  = createdTime.split(' ');

        results.push({
          sessionId:     String(row[colIdx['Session ID']]      || ''),
          tokenId:       String(row[colIdx['Token ID']]        || ''),
          district:      String(row[colIdx['District']]        || ''),
          station:       String(row[colIdx['Station']]         || ''),
          supervisor:    String(row[colIdx['Supervisor Name']] || ''),
          employeeId:    rowEmpId,
          checklist:     String(row[colIdx['Checklist Type']]  || ''),
          checklistKey:  checklistKey,
          createdTime:   createdTime,
          dateDisp:      dtParts[0] || '',
          timeDisp:      dtParts[1] || '',
          progressLabel: progressLabel,
          status:        status,
          pdfUrl:        pdfUrl
        });
      }
    }

    results.sort(function (a, b) { return b.createdTime.localeCompare(a.createdTime); });
    var capped = results.length > CONFIG.MAX_RESULTS;
    if (capped) results = results.slice(0, CONFIG.MAX_RESULTS);
    var employeeDisplay = { id: idClean, name: results.length ? results[0].supervisor : '' };
    var payload = { ok: true, results: results, count: results.length, employee: employeeDisplay,
                    capped: capped };
    _cacheSet(ck, payload, CONFIG.RESULT_CACHE_SEC);
    return JSON.stringify(payload);
  } catch (e) {
    Logger.log('[getSupervisorReports] ERROR: ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

function regeneratePDFForSession(sessionId, requestingEmpId) {
  try {
    if (!sessionId || !requestingEmpId) {
      return JSON.stringify({ ok: false, msg: 'Session ID आणि कर्मचारी आयडी आवश्यक.' });
    }

    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: false, msg: 'Session ID आढळला नाही.' });
    var sh = loc.sheet, colIdx = _headerMap(sh), rowNumber = loc.row;
    var sessionRow = _readRows(sh, [rowNumber])[0].values;

    var ownerEmpId = String(sessionRow[colIdx['Employee ID']] || '').trim();
    if (ownerEmpId !== String(requestingEmpId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });
    }

    var existingPdf = String(sessionRow[colIdx['PDF URL']] || '').trim();
    if (existingPdf) return JSON.stringify({ ok: true, pdfUrl: existingPdf, cached: true });

    var payload = getSessionDataForPDF(sessionId);
    if (!payload) return JSON.stringify({ ok: false, msg: 'Session डेटा आढळला नाही.' });
    // FIX: same routing gap as the PDF queue — without this, a regenerated
    // PDF for a still-In-Process session was always filed under "Completed".
    payload._pending = (String(sessionRow[colIdx['Status']] || '').trim() !== STATUS.COMPLETED);

    var pdfUrl = generateCombinedPDF(payload);
    if (!pdfUrl) return JSON.stringify({ ok: false, msg: 'PDF तयार करता आली नाही.' });

    if (rowNumber > 0 && colIdx['PDF URL'] !== undefined) {
      sh.getRange(rowNumber, colIdx['PDF URL'] + 1).setValue(pdfUrl);
    }
    _invalidateEmpCaches(ownerEmpId);
    logAction(LOG_ACTIONS.PDF_GENERATE, sessionId, { source: 'regeneratePDFForSession', url: pdfUrl });
    return JSON.stringify({ ok: true, pdfUrl: pdfUrl, cached: false });
  } catch (e) {
    Logger.log('[regeneratePDFForSession] ERROR: ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

/* === FULL REPORT DETAIL (माघील अहवाल expand) === */

function getReportFullDetail(sessionId, requestingEmpId) {
  try {
    if (!sessionId || !requestingEmpId) return JSON.stringify({ ok: false, msg: 'अपूर्ण विनंती.' });

    var loc = _locateSession(sessionId);
    if (!loc) return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    var colIdx  = _headerMap(loc.sheet);
    var sessionRow = _readRows(loc.sheet, [loc.row])[0].values;

    var ownerEmpId = String(sessionRow[colIdx['Employee ID']] || '').trim();
    if (ownerEmpId !== String(requestingEmpId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });
    }

    var checklistKey = String(sessionRow[colIdx['Checklist Key']] || '').trim();
    var meta         = CHECKLIST_META[checklistKey] || { mode: 'shift' };
    var units        = [];

    if (meta.mode === 'bus') {
      var buses = loadPreviousBuses(sessionId);
      buses.forEach(function (b) {
        var items = (b.questions || []).map(function (q) {
          return { q: q, answer: (b.answers || {})[q] || '', remark: (b.remarks || {})[q] || '' };
        });
        units.push({ label: '🚌 बस: ' + b.busNumber, items: items });
      });
    } else {
      var shifts = loadPreviousShifts(sessionId);
      shifts.forEach(function (s) {
        var items = (s.questions || []).map(function (q) {
          return { q: q, answer: (s.answers || {})[q] || '', remark: (s.remarks || {})[q] || '' };
        });
        units.push({ label: s.shiftName, items: items });
      });
    }

    return JSON.stringify({ ok: true, checklistKey: checklistKey, units: units });
  } catch (e) {
    Logger.log('[getReportFullDetail] ERROR: ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

function resumeSession(sessionId, requestingEmpId) {
  try {
    if (!sessionId || !requestingEmpId) return JSON.stringify({ ok: false, msg: 'अपूर्ण विनंती.' });
    var loc = _locateSession(sessionId);
    var c, row;
    if (loc) {
      c = _headerMap(loc.sheet);
      var rr = _readRows(loc.sheet, [loc.row]);
      if (rr.length) row = rr[0].values;
    }
    if (!row) return JSON.stringify({ ok: false, msg: 'Session आढळला नाही.' });
    if (String(row[c['Employee ID']] || '').trim() !== String(requestingEmpId).trim()) {
      return JSON.stringify({ ok: false, msg: '❌ अनधिकृत विनंती.' });
    }
    if (String(row[c['Status']] || '').trim() === STATUS.COMPLETED) {
      return JSON.stringify({ ok: false, msg: '✅ ही चेकलिस्ट आधीच पूर्ण झाली आहे.' });
    }

    var checklistKey = String(row[c['Checklist Key']] || '').trim();
    var meta  = CHECKLIST_META[checklistKey] || { mode: 'shift' };
    var units = _getUnitsForKey(checklistKey);

    var base = {
      ok: true, resume: true,
      sessionId:    sessionId,
      tokenId:      String(row[c['Token ID']] || ''),
      dist:         String(row[c['District']] || ''),
      stn:          String(row[c['Station']]  || ''),
      name:         String(row[c['Supervisor Name']] || ''),
      id:           String(row[c['Employee ID']] || ''),
      checklist:    String(row[c['Checklist Type']] || ''),
      checklistKey: checklistKey,
      mode:         meta.mode,
      date:         _toISODate(_normalizeCreated(row[c['Created Time']]))
    };

    if (meta.mode === 'bus') {
      base.completedBuses = loadPreviousBuses(sessionId);
      base.completedShifts = [];
      base.currentShiftIdx = 0;
      base.nextShiftName = 'बस धुणे सुरू करा';
      base.totalUnits = 'अनुसूची';
      base.pendingCount = base.completedBuses.length > 0 ? 'Unlimited' : 'Start here';
      base.alreadyComplete = false;
    } else {
      var prev = loadPreviousShifts(sessionId);
      var doneCount = prev.length;
      var storedDone = parseInt(row[c['Completed Shifts']] || 0, 10) || 0;
      if (storedDone > doneCount) doneCount = storedDone;
      
      // ✅ FIXED: Use stored Total Shifts
      var rawTotal = c['Total Shifts'] !== undefined ? parseInt(row[c['Total Shifts']], 10) : NaN;
      var rsTotal;
      if (rawTotal >= 1 && rawTotal <= SHIFTS.length) {
        rsTotal = rawTotal;
      } else {
        rsTotal = Math.max(doneCount, 1);
        if (rsTotal > SHIFTS.length) rsTotal = SHIFTS.length;
      }
      
      base.completedShifts = prev;
      base.totalUnits = rsTotal;
      base.currentShiftIdx = doneCount;
      
      // ✅ FIXED: Show next pending shift, not "complete"
      if (doneCount < rsTotal) {
        base.nextShiftName = units[doneCount];
        base.nextShiftIndex = doneCount;
        base.pendingCount = rsTotal - doneCount;
        base.alreadyComplete = false;
        base.msg = '🔄 मागील सत्र पुन्हा सुरू केले.\n' +
                   'पूर्ण: ' + doneCount + '/' + rsTotal + '\n' +
                   'पुढील: ' + base.nextShiftName;
      } else {
        base.nextShiftName = 'सर्व पूर्ण';
        base.pendingCount = 0;
        base.alreadyComplete = true;
        base.msg = '✅ सर्व पाळ्या पूर्ण झाल्या आहेत.';
      }
    }
    
    _updateSessionStatus(sessionId, STATUS.IN_PROCESS);
    return JSON.stringify(base);
  } catch (e) {
    Logger.log('[resumeSession] ' + e);
    return JSON.stringify({ ok: false, msg: 'त्रुटी: ' + e.toString() });
  }
}

function listIncompleteSessions(empId) {
  try {
    if (!empId) return JSON.stringify({ ok: false, results: [] });
    var idClean = String(empId).trim();
    var out = [];
    var ids = _chainIds();
    for (var li = 0; li < ids.length; li++) {
      var sh = _chainSessionsSheet(ids[li]);
      var c = _headerMap(sh);
      if (sh.getLastRow() < 2 || c['Employee ID'] === undefined) continue;
      var rowNums = _findRowsByColumn(sh, 'Employee ID', idClean);
      if (!rowNums.length) continue;
      rowNums.sort(function (a, b) { return b - a; });
      var srcRows = _readRows(sh, rowNums);
      for (var i = 0; i < srcRows.length; i++) {
        var row = srcRows[i].values;
        var status = String(row[c['Status']] || '').trim();
        if (status === STATUS.COMPLETED) continue;

        var key = String(row[c['Checklist Key']] || '').trim();
        var meta = CHECKLIST_META[key] || {};
        var liTotal = _sessionTotalUnits(key,
          c['Total Shifts'] !== undefined ? row[c['Total Shifts']] : '');
        var done = parseInt(row[c['Completed Shifts']] || 0, 10) || 0;
        var buses = parseInt(row[c['Total Buses']] || 0, 10) || 0;

        var progress = (meta.mode === 'bus') ? (buses + ' बस') : (done + '/' + liTotal + ' पूर्ण');
        var created = _normalizeCreated(row[c['Created Time']]);
        var dParts = created.split(' ');

        out.push({
          sessionId:   String(row[c['Session ID']] || ''),
          tokenId:     String(row[c['Token ID']]   || ''),
          district:    String(row[c['District']]   || ''),
          station:     String(row[c['Station']]    || ''),
          checklistKey: key,
          checklist:   String(row[c['Checklist Type']] || ''),
          status:      status,
          progress:    progress,
          dateDisp:    dParts[0] || '',
          mode:        meta.mode || 'shift',
          _createdMs:  _parseISTDateString(created) || 0
        });
      }
    }
    out.sort(function (a, b) { return b._createdMs - a._createdMs; });
    var capped = out.length > CONFIG.MAX_RESULTS;
    if (capped) out = out.slice(0, CONFIG.MAX_RESULTS);
    out.forEach(function (o) { delete o._createdMs; });
    return JSON.stringify({ ok: true, results: out, count: out.length });
  } catch (e) {
    Logger.log('[listIncompleteSessions] ' + e);
    return JSON.stringify({ ok: false, results: [], msg: e.toString() });
  }
}

/* === DRIVE HELPER === */

function getFolder(name) {
  var cacheKey = 'pdffolder_id:root|' + name;
  var cachedId = _cacheGet(cacheKey);
  if (cachedId) {
    try { return DriveApp.getFolderById(cachedId); }
    catch (eStale) { Logger.log('[getFolder] cached root folder id stale, re-resolving: ' + eStale); }
  }
  var it = DriveApp.getFoldersByName(name);
  var f  = it.hasNext() ? it.next() : DriveApp.createFolder(name);
  _cacheSet(cacheKey, f.getId(), 21600);   // 6 hours — CacheService's max
  return f;
}

/* === SESSION DATA FOR PDF === */

function getSessionDataForPDF(sessionId) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return null;
    var colMap = _headerMap(loc.sheet);
    var rowsRead = _readRows(loc.sheet, [loc.row]);
    if (!rowsRead.length) return null;
    var row = rowsRead[0].values;
    {
      var checklistKey    = String(row[colMap['Checklist Key']] || '');
      var meta            = CHECKLIST_META[checklistKey] || {};
      var completedShifts = [];
      var completedBuses  = [];

      if (meta.mode === 'bus') completedBuses = loadPreviousBuses(sessionId);
      else                     completedShifts = loadPreviousShifts(sessionId);

      return {
        sessionId:    sessionId,
        totalShifts:  colMap['Total Shifts'] !== undefined ? row[colMap['Total Shifts']] : '',
        tokenId:      String(row[colMap['Token ID']]       || ''),
        dist:         String(row[colMap['District']]       || ''),
        stn:          String(row[colMap['Station']]        || ''),
        name:         String(row[colMap['Supervisor Name']] || ''),
        id:           String(row[colMap['Employee ID']]    || ''),
        checklistKey: checklistKey,
        checklist:    String(row[colMap['Checklist Type']] || ''),
        date:         _normalizeCreated(row[colMap['Created Time']]).split(' ')[0] || '',
        completedShifts: completedShifts,
        completedBuses:  completedBuses,
        _dataReady:   true   // FIX BUG 2: prevents generateCombinedPDF from re-reading
      };
    }
  } catch (e) {
    Logger.log('[SESSION DATA ERROR] ' + e);
    return null;
  }
}

/* =====================================================================
   FIX E — ASYNC PDF QUEUE: drains the WHOLE queue within a 4-minute
   budget every minute (was: ONE PDF per 5-minute run → unbounded
   backlog). Each finished PDF also invalidates the supervisor's caches
   so माघील अहवाल shows the link immediately. One retry per failed job.
   ===================================================================== */

/* =====================================================================
   SPEED: ASYNC-FIRST PDF GENERATION — _getSessionStatus is the one new
   piece of plumbing this requires. submitFullChecklist, finalizeInspection,
   editShift and editBus used to call generateCombinedPDF() synchronously
   inside the click handler — the supervisor's tap sat there waiting for an
   HTML→PDF render (the single slowest step in any save) before the screen
   could respond. They now save the data, queue the PDF job, and return
   immediately; the existing PDF queue trigger (every 1 minute — Apps
   Script's minimum trigger granularity, already as fast as the platform
   allows) renders it in the background, and the client's already-built
   _pollSessionPdf() picks up the link a few seconds after that.
   Because the queue can now receive PARTIAL (not-yet-Completed) sessions
   too, it must know each session's CURRENT status to route the PDF into
   the right Drive tree ("पूर्ण/Completed" vs "अपूर्ण/Pending") — that's
   what this helper provides. */
function _getSessionStatus(sessionId) {
  try {
    var loc = _locateSession(sessionId);
    if (!loc) return '';
    var c = _headerMap(loc.sheet);
    var row = _readRows(loc.sheet, [loc.row])[0].values;
    return String(row[c['Status']] || '');
  } catch (e) { Logger.log('_getSessionStatus: ' + e); return ''; }
}

function _enqueuePDFJob(sessionId) {
  // Just write to the queue — the 1-minute processPDFQueue trigger is the
  // reliable delivery mechanism. ScriptApp.newTrigger (the old "wake" path)
  // cost 200–800ms + ScriptLock wait on every save and consumed trigger quota.
  // The client's _tryDirectPdf() already fires generatePdfNow() in parallel
  // right after each save, so PDFs still appear quickly in the common case.
  try {
    var props = PropertiesService.getScriptProperties();
    var lock  = LockService.getScriptLock();
    if (!lock.tryLock(3000)) { Logger.log('[_enqueuePDFJob] lock busy, will retry next minute'); return; }
    try {
      var queue = JSON.parse(props.getProperty('PDF_QUEUE') || '[]');
      // Deduplicate: if sessionId is already queued, just update the timestamp.
      var found = false;
      for (var i = 0; i < queue.length; i++) {
        if (queue[i].sessionId === sessionId) { queue[i].ts = Date.now(); found = true; break; }
      }
      if (!found) queue.push({ sessionId: sessionId, ts: Date.now() });
      props.setProperty('PDF_QUEUE', JSON.stringify(queue));
    } finally { try { lock.releaseLock(); } catch (e2) {} }
  } catch (e) { Logger.log('[_enqueuePDFJob] ' + e); }
}

/* One-time wake-up target for the PDF queue — fires ~2s after the first
   job in a burst is enqueued, instead of waiting for the next 1-minute
   scheduled tick. Reuses the exact same worker (processPDFQueue), so the
   queue format, retry logic, and Drive/status updates are all unchanged —
   only the wait-before-starting time is reduced. Apps Script auto-deletes
   one-time triggers after they fire, so no manual cleanup is needed here. */
function processPDFQueueWake() {
  try { PropertiesService.getScriptProperties().deleteProperty('PDF_WAKE_PENDING'); } catch (e) {}
  processPDFQueue();
}

function processPDFQueue() {
  if (PDF_ON_DEMAND) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    var props  = PropertiesService.getScriptProperties();
    var budget = 4 * 60 * 1000;              // stay well under the 6-min limit
    var start  = Date.now();
    while (Date.now() - start < budget) {
      var queue = JSON.parse(props.getProperty('PDF_QUEUE') || '[]');
      if (!queue.length) break;
      var job = queue.shift();
      props.setProperty('PDF_QUEUE', JSON.stringify(queue));
      try {
        // Skip if a PDF was already generated by _tryDirectPdf parallel path
        var _existLoc = _locateSession(job.sessionId);
        if (_existLoc) {
          var _em2 = _headerMap(_existLoc.sheet);
          if (_em2['PDF URL'] !== undefined) {
            var _existUrl = String(_existLoc.sheet.getRange(_existLoc.row, _em2['PDF URL'] + 1).getValue() || '').trim();
            if (_existUrl) { Logger.log('[processPDFQueue] skip ' + job.sessionId + ' — already has PDF'); continue; }
          }
        }
        var payload = getSessionDataForPDF(job.sessionId);
        if (!payload) {
          Logger.log('[processPDFQueue] DROPPED: ' + job.sessionId + ' — session row not found.');
          continue;
        }
        payload._pending = (_getSessionStatus(job.sessionId) !== STATUS.COMPLETED);
        var url = generateCombinedPDF(payload);
        if (url) {
          _updateSessionRecord(job.sessionId, null, null, url, null);
          _invalidateEmpCaches(String(payload.id || '').trim());
          Logger.log('[processPDFQueue] SUCCESS: ' + job.sessionId);
        }
      } catch (e) {
        Logger.log('[processPDFQueue] ERROR ' + job.sessionId + ': ' + e);
        if (!job.retried) {
          job.retried = true;
          var q2 = JSON.parse(props.getProperty('PDF_QUEUE') || '[]');
          q2.push(job);
          props.setProperty('PDF_QUEUE', JSON.stringify(q2));
          Logger.log('[processPDFQueue] REQUEUED: ' + job.sessionId);
        } else {
          Logger.log('[processPDFQueue] PERMANENTLY FAILED after retry: ' + job.sessionId +
                     ' | Error: ' + e + ' | Admin: use माघील अहवाल ✏️ → PDF पुन्हा तयार करा');
        }
      }
    }
  } catch (e) {
    Logger.log('[processPDFQueue] ' + e);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function installPDFQueueTrigger() {
  _deleteTriggersByName('processPDFQueue');
  ScriptApp.newTrigger('processPDFQueue').timeBased().everyMinutes(1).create();
  return 'PDF queue trigger installed (every 1 min, drains full queue).';
}

function disablePDFQueueTrigger() {
  _deleteTriggersByName('processPDFQueue');
  var msg = 'PDF queue trigger removed.\n' +
            'PDFs now generate via _tryDirectPdf (direct, after each save)\n' +
            'and on-demand from माघील अहवाल only.\n' +
            'Quota usage reduced ~80%.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
  return msg;
}
/* === MONTH-END BATCH PDF GENERATION === */

function monthEndPDFGeneration() {
  /* PERF: was O(R×C) full read nightly. Now two O(R) column scans
     (Status + PDF URL) and a blocked read of only the ≤10 rows in this
     batch. PDF rendering dominates; the scan is now negligible. */
  var props   = PropertiesService.getScriptProperties();
  var offset  = parseInt(props.getProperty('ME_PDF_OFFSET') || '0', 10) || 0;
  var sh      = getSessionsSheet();
  var colIdx  = _headerMap(sh);
  if (sh.getLastRow() < 2 || colIdx['Status'] === undefined) { props.deleteProperty('ME_PDF_OFFSET'); return; }

  var statuses = _colValues(sh, 'Status');
  var pdfs     = _colValues(sh, 'PDF URL');
  var pending  = [];                                   // sheet row numbers
  for (var i = 0; i < statuses.length; i++) {
    if (String(statuses[i]) === STATUS.COMPLETED && !String(pdfs[i] || '').trim()) {
      pending.push(i + 2);
    }
  }

  var batchRows = pending.slice(offset, offset + 10);
  if (batchRows.length) {
    var read = _readRows(sh, batchRows);
    read.forEach(function (rr) {
      var sessionId = String(rr.values[colIdx['Session ID']]);
      try {
        var payload = getSessionDataForPDF(sessionId);
        if (!payload) return;
        var url = generateCombinedPDF(payload);
        if (url) sh.getRange(rr.row, colIdx['PDF URL'] + 1).setValue(url);
      } catch (e) { Logger.log('[monthEnd PDF fail] ' + sessionId + ' ' + e); }
    });
  }

  if (offset + 10 < pending.length) {
    props.setProperty('ME_PDF_OFFSET', String(offset + 10));
    ScriptApp.newTrigger('monthEndPDFGeneration').timeBased().after(60 * 1000).create();
  } else {
    props.deleteProperty('ME_PDF_OFFSET');
  }
}

function installMonthEndTrigger() {
  _deleteTriggersByName('monthEndPDFGeneration');
  ScriptApp.newTrigger('monthEndPDFGeneration')
    .timeBased().atHour(23).nearMinute(0).everyDays(1)
    .inTimezone('Asia/Kolkata').create();
  return 'Month-end PDF trigger installed (daily 23:00 IST).';
}

function _deleteTriggersByName(fnName) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === fnName) ScriptApp.deleteTrigger(t);
  });
}

/* =====================================================================
   SCALE: ARCHIVAL — keeps the sheet under the 10M-cell limit.
   ===================================================================== */
function archiveOldSessions() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log('[archive] busy'); return; }
  try {
    var sh   = getSessionsSheet();
    var data = sh.getDataRange().getValues();
    if (data.length < 2) return;
    var headers = data[0];
    var colIdx  = {}; headers.forEach(function (h, i) { colIdx[h] = i; });

    var cutoffMs = new Date().getTime() - (CONFIG.ARCHIVE_KEEP_DAYS * 24 * 60 * 60 * 1000);

    var toArchive = [];      // {rowIndex, rowValues}
    for (var i = 1; i < data.length; i++) {
      var row = data[i];
      if (String(row[colIdx['Status']] || '').trim() !== STATUS.COMPLETED) continue;
      var createdMs = _parseISTDateString(_normalizeCreated(row[colIdx['Created Time']]));
      if (!createdMs || createdMs >= cutoffMs) continue;
      toArchive.push({ rowIndex: i + 1, values: row });
    }
    if (!toArchive.length) { Logger.log('[archive] nothing to archive'); return; }

    var archiveName = 'MSRTC_Archive_Sessions';
    var props = PropertiesService.getScriptProperties();
    var archiveId = props.getProperty('ARCHIVE_SS_ID');
    var archiveSS;
    if (archiveId) {
      try { archiveSS = SpreadsheetApp.openById(archiveId); } catch (e) { archiveSS = null; }
    }
    if (!archiveSS) {
      archiveSS = SpreadsheetApp.create(archiveName);
      props.setProperty('ARCHIVE_SS_ID', archiveSS.getId());
    }
    var aSheet = archiveSS.getSheets()[0];
    if (aSheet.getLastRow() === 0) aSheet.appendRow(headers);

    var rowsToWrite = toArchive.map(function (r) { return r.values; });
    aSheet.getRange(aSheet.getLastRow() + 1, 1, rowsToWrite.length, headers.length).setValues(rowsToWrite);

    toArchive.sort(function (a, b) { return b.rowIndex - a.rowIndex; });
    toArchive.forEach(function (r) { sh.deleteRow(r.rowIndex); });

    // Row numbers shifted — drop cached session→row positions so a save that
    // races this monthly trigger can't write to a stale/wrong row.
    // (Matches deleteSession / _cleanupDuplicateSessions.)
    _LOC_CACHE = {}; _SHEET_CACHE = {};

    Logger.log('[archive] archived ' + toArchive.length + ' sessions to ' + archiveName);
    return 'Archived ' + toArchive.length + ' completed sessions older than ' +
           CONFIG.ARCHIVE_KEEP_DAYS + ' days.';
  } catch (e) {
    Logger.log('[archiveOldSessions] ' + e);
    return 'Archive error: ' + e.toString();
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }
}

function installArchiveTrigger() {
  _deleteTriggersByName('archiveOldSessions');
  ScriptApp.newTrigger('archiveOldSessions')
    .timeBased().onMonthDay(1).atHour(2).inTimezone('Asia/Kolkata').create();
  return 'Archive trigger installed (1st of month, 02:00 IST).';
}

/* === LOAD PREVIOUS BUSES (per-wash, repeat-safe) === */

function loadPreviousBuses(sessionId) {
  try {
    var fromJson = _readSessionUnits(sessionId, BUSES_JSON_COL);
    if (fromJson.length) return fromJson;
    return _legacyLoadBuses(sessionId);
  } catch (e) { Logger.log('[LOAD BUSES ERROR] ' + e); return []; }
}

/* Legacy bus reader — only for sessions not yet migrated to JSON. */
function _legacyLoadBuses(sessionId) {
  try {
    var sh = _legacySheet('Bus_Responses');
    if (!sh) return [];
    var found = _rowsForSession(sh, sessionId);
    var colIdx = found.headers;
    var data   = found.data;
    if (!data.length) return [];

    var hasTs   = colIdx['Timestamp'] !== undefined;
    var washes  = [];
    var current = null;
    for (var i = 0; i < data.length; i++) {
      var row = data[i];
      var busNum = String(row[colIdx['Bus Number']]);
      var ts     = hasTs ? String(row[colIdx['Timestamp']] || '') : '';
      var q      = String(row[colIdx['Question']]);
      var a      = String(row[colIdx['Answer']]);
      var r      = String(row[colIdx['Remark']] || '');
      var isNewWash = !current ||
                      current.busNumber !== busNum ||
                      current.timestamp !== ts ||
                      (current.answers[q] !== undefined);
      if (isNewWash) {
        current = { busNumber: busNum, timestamp: ts, questions: [], answers: {}, remarks: {} };
        washes.push(current);
      }
      if (current.questions.indexOf(q) === -1) current.questions.push(q);
      current.answers[q] = a;
      if (r) current.remarks[q] = r;
    }
    return washes;
  } catch (e) {
    Logger.log('[LEGACY LOAD BUSES ERROR] ' + e);
    return [];
  }
}

/* =====================================================================
   PDF GENERATION — professional MSRTC templates
   ===================================================================== */

var _MN = ['०','१','२','३','४','५','६','७','८','९'];
function _mn(n) {
  return String(n).split('').map(function (d) { return /\d/.test(d) ? _MN[parseInt(d)] : d; }).join('');
}
function _nl2br(s) { return String(s || '').replace(/\n/g, '<br>'); }
function _ansCls(v) { return v === 'होय' ? 'yes' : (v === 'नाही' ? 'no' : 'cc'); }

function _devanagariFont() {
  return 'Mangal, "Noto Sans Devanagari", Arial, sans-serif';
}

function _pdfCss(landscape) {
  var isBus = !!landscape;
  var pageFlow = isBus
    ? ('thead{display:table-header-group}'
     + 'tfoot{display:table-footer-group}'
     + 'tr{page-break-inside:avoid}'
     + 'table.grid{page-break-inside:auto}'
     + 'table.grid tbody tr{page-break-inside:avoid;page-break-after:auto}'
     + 'table.grid.bus-long td,table.grid.bus-long th{font-size:6.5px;padding:2px 2px}')
    : ('.sheet{page-break-inside:avoid}'
     + 'table.grid{page-break-inside:avoid}'
     + 'tr{page-break-inside:avoid}');

   var embedded = _embeddedDevanagariFontFace();
  var fontHead = embedded ? embedded
    : "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap');";
  var fontStack = embedded
    ? '"NotoDeva", ' + _devanagariFont()   // embedded first, system fonts as backup
    : _devanagariFont();
  // FIX BUG 4: import Noto Sans Devanagari from Google Fonts so the PDF
  // renderer loads the correct font for Marathi Unicode characters.
  // Without this, the renderer falls back to system fonts which may not
  // include Devanagari glyphs → characters show as boxes/squares in the PDF.
  var fontImport = "@import url('https://fonts.googleapis.com/css2?family=Noto+Sans+Devanagari:wght@400;700&display=swap');";

  return fontImport
    + '@page{size:A4 ' + (isBus ? 'landscape' : 'portrait') + ';margin:7mm}'
    + 'body{font-family:' + fontStack + ';font-size:8px;color:#000;margin:0;padding:0}'
    + '.sheet{border:1.5px solid #000}'
    + '.hdr{text-align:center;font-weight:bold;font-size:12px;padding:4px 5px;border-bottom:1px solid #000}'
    + '.info{width:100%;border-collapse:collapse}'
    + '.info td{border:none;border-bottom:1px solid #000;padding:3px 6px;font-size:8.5px;width:50%}'
    + '.ttl{text-align:center;font-weight:bold;font-size:10.5px;padding:5px;border-bottom:1px solid #000}'
    + 'table.grid{width:100%;border-collapse:collapse;table-layout:fixed}'
    + 'table.grid th,table.grid td{'
    +   'border:1px solid #000;padding:3px 3px;font-size:8px;vertical-align:middle;'
    +   'word-wrap:break-word;overflow-wrap:break-word;word-break:break-word}'
    + 'table.grid th{background:#f2f2f2;font-weight:bold;text-align:center;line-height:1.2}'
    + pageFlow
    + '.cc{text-align:center}'
    + '.yes{text-align:center;color:#1a6b2e;font-weight:bold}'
    + '.no{text-align:center;color:#b91c1c;font-weight:bold}'
    + '.rmk{font-size:7px;color:#b91c1c;font-style:italic;text-align:left;word-break:break-word}'
    + '.dand{margin-top:0;page-break-inside:avoid}'
    + '.dand .dtitle{text-align:center;font-weight:bold;font-size:10px}'
    + '.dand .right{text-align:right;font-weight:bold}'
    + '.sigwrap{page-break-inside:avoid;margin-top:0}'
    + 'table.sig{width:100%;border-collapse:collapse;table-layout:fixed}'
    + 'table.sig td{border:1px solid #000;padding:4px 6px;font-size:8.5px;vertical-align:top;width:50%;height:18px}'
    + '.sig .role{font-weight:bold}'
    + '.ftr{text-align:center;font-size:7px;color:#555;margin-top:6px;page-break-inside:avoid}';
}

/* ONE-TIME: download Noto Sans Devanagari, base64-encode it, and stash it in a
   Drive file so PDF rendering never hits the network. Run once from the editor. */
function primeDevanagariFontForPdf() {
  // fontsource CDN is stable; TTF is the safest format for the legacy renderer.
  var url = 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-devanagari@latest/devanagari-400-normal.ttf';
  var resp = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
  if (resp.getResponseCode() !== 200) {
    var em = '❌ font download failed: HTTP ' + resp.getResponseCode() + '. Try a different URL.';
    Logger.log(em); try { SpreadsheetApp.getUi().alert(em); } catch (e) {}
    return em;
  }
  var b64 = Utilities.base64Encode(resp.getBlob().getBytes());
  var folder = getFolder(CONFIG.PDF_FOLDER);
  var fname = '_deva_font_b64.txt';
  var it = folder.getFilesByName(fname); while (it.hasNext()) it.next().setTrashed(true);
  var f = folder.createFile(fname, b64, MimeType.PLAIN_TEXT);
  PropertiesService.getScriptProperties().setProperty('DEVA_FONT_FILE_ID', f.getId());
  var msg = '✅ Devanagari font primed (' + Math.round(b64.length/1024) + ' KB base64). ' +
            'Now regenerate ONE PDF and confirm Marathi renders correctly.';
  Logger.log(msg); try { SpreadsheetApp.getUi().alert(msg); } catch (e) {}
  return msg;
}

/* Loads the embedded font once per execution. Returns '' if not primed, so
   the CSS safely falls back to the @import in that case. */
var _DEVA_FONT_CSS = null;
function _embeddedDevanagariFontFace() {
  if (_DEVA_FONT_CSS !== null) return _DEVA_FONT_CSS;
  _DEVA_FONT_CSS = '';
  try {
    var id = PropertiesService.getScriptProperties().getProperty('DEVA_FONT_FILE_ID');
    if (id) {
      var b64 = DriveApp.getFileById(id).getBlob().getDataAsString();
      _DEVA_FONT_CSS =
        '@font-face{font-family:"NotoDeva";font-style:normal;font-weight:400 700;' +
        'src:url(data:font/truetype;base64,' + b64 + ') format("truetype")}';
    }
  } catch (e) { Logger.log('_embeddedDevanagariFontFace: ' + e); _DEVA_FONT_CSS = ''; }
  return _DEVA_FONT_CSS;
}

function _pdfHeaderOpen(payload) {
  return '<div class="sheet">' +
    '<div class="hdr">महाराष्ट्र राज्य मार्ग परिवहन महामंडळ</div>' +
    '<table class="info">' +
      '<tr><td>विभाग- ' + _sanitizeInput(payload.dist || '') + '</td>' +
          '<td style="text-align:right">आगार- ___________</td></tr>' +
      '<tr><td>बसस्थानक- ' + _sanitizeInput(payload.stn || '') + '</td>' +
          '<td style="text-align:right">दिनांक- ' + _sanitizeInput(payload.date || '') + '</td></tr>' +
    '</table>';
}
function _pdfTitle(type) {
  return '<div class="ttl">' + (CHECKLIST_TITLES[type] || '') + '</div>';
}

function _pdfPenalty(type) {
  var penalties = PENALTIES[type] || [];
  var h = '<table class="grid dand"><thead>' +
    '<tr><th colspan="2" class="dtitle">दंडात्मक तरतूद</th>' +
        '<th style="width:14%">दंड रु.</th></tr></thead><tbody>';
  penalties.forEach(function (p, i) {
    h += '<tr><td class="cc" style="width:6%">' + _mn(i + 1) + '</td>' +
         '<td>' + p.desc + ' (रु.' + _mn(p.amt) + '/- )</td>' +
         '<td></td></tr>';
  });
  h += '<tr><td colspan="2" class="right">एकूण दंड रु.</td><td class="cc">०</td></tr>';
  h += '</tbody></table>';
  return h;
}

function _pdfSig(type, payload) {
  var sigs  = SIG_LABELS[type] || SIG_LABELS.bs;
  var L = String(sigs.left  || '').split('\n');
  var R = String(sigs.right || '').split('\n');
  var rows = Math.max(L.length, R.length);
  var h = '<div class="sigwrap"><table class="sig">';
  for (var i = 0; i < rows; i++) {
    var lc = L[i] || '', rc = R[i] || '';
    var cls = (i === 0) ? ' class="role"' : '';
    // Insert supervisor name after "नाव-" line on the left side
    var lcDisplay = _sanitizeInput(lc);
    if (lc.indexOf('नाव') !== -1 && payload && payload.name) {
      lcDisplay = _sanitizeInput(lc) + ' ' + _sanitizeInput(payload.name) +
                  (payload.id ? ' (' + _sanitizeInput(payload.id) + ')' : '');
    }
    h += '<tr><td' + cls + '>' + lcDisplay + '</td>' +
              '<td' + cls + '>' + _sanitizeInput(rc) + '</td></tr>';
  }
  h += '</table></div>';
  return h;
}

function _pdfFooter(payload, now) {
  return '<div class="ftr">Token ID: ' + (payload.tokenId || '') +
         ' &nbsp;|&nbsp; ' + CONFIG.APP_NAME + ' &nbsp;|&nbsp; ' + now + '</div>';
}

function _pdfShiftTable(type, allShifts, units) {
  var meta   = CHECKLIST_META[type] || {};
  var isWeek = (meta.mode === 'week');

  var _fq = FALLBACK_QUESTIONS[type] || [];
  var _sq = (allShifts[0] && allShifts[0].questions && allShifts[0].questions.length)
            ? allShifts[0].questions : [];
  // Use whichever list is longer (FALLBACK is canonical; shift's own list may have
  // extra questions added after FALLBACK was defined)
  var questions = (_fq.length >= _sq.length) ? _fq : (_sq.length ? _sq : _fq);

  // PDF-MATCH: pool of stored shifts with both match keys + normalised
  // question index so answers survive minor question-text drift.
  var pool = (allShifts || []).map(function (s) {
    var ans = {}, rem = {};
    Object.keys((s && s.answers) || {}).forEach(function (q) { ans[_normaliseUnitName(q)] = s.answers[q]; });
    Object.keys((s && s.remarks) || {}).forEach(function (q) { rem[_normaliseUnitName(q)] = s.remarks[q]; });
    return {
      full: _normaliseUnitName(s ? s.shiftName : ''),
      base: _shiftBaseName(s ? s.shiftName : ''),
      ans:  ans, rem: rem, used: false
    };
  });

  // Assign exactly one stored shift to each column header.
  var colShift = units.map(function (u) {
    var uf = _normaliseUnitName(u), ub = _shiftBaseName(u), hit = null, i;
    for (i = 0; i < pool.length; i++) { if (!pool[i].used && pool[i].full === uf) { hit = pool[i]; break; } }
    if (!hit) for (i = 0; i < pool.length; i++) { if (!pool[i].used && pool[i].base === ub) { hit = pool[i]; break; } }
    if (hit) hit.used = true;
    return hit;
  });
  // RECOVERY: unmatched saved shifts fill the next still-empty column.
  var leftovers = pool.filter(function (p) { return !p.used; });
  for (var ci = 0, li = 0; ci < colShift.length && li < leftovers.length; ci++) {
    if (!colShift[ci]) { colShift[ci] = leftovers[li]; leftovers[li].used = true; li++; }
  }

  var shiftColPct  = Math.max(5, Math.floor(40 / units.length));
  var remarkColPct = 14;
  var qColPct      = 100 - 6 - (shiftColPct * units.length) - remarkColPct;
  if (qColPct < 18) {
    shiftColPct = Math.max(4, Math.floor(30 / units.length));
    qColPct     = 100 - 6 - (shiftColPct * units.length) - remarkColPct;
  }

  var h = '<table class="grid"><thead>';
  if (isWeek) {
    h += '<tr><th style="width:6%">अ. क्र.</th>'
       + '<th style="width:' + qColPct + '%">कामाचा तपशील</th>';
    units.forEach(function (u) { h += '<th style="width:' + shiftColPct + '%">' + u + '</th>'; });
    h += '<th style="width:' + remarkColPct + '%">शेरा</th></tr>';
  } else {
    h += '<tr>'
       + '<th rowspan="2" style="width:6%">अ. क्र.</th>'
       + '<th style="width:' + qColPct + '%">वारंवारिता</th>';
    units.forEach(function (u) {
      h += '<th rowspan="2" style="width:' + shiftColPct + '%">'
         + u.replace('(Shift)', '').trim() + '</th>';
    });
    h += '<th rowspan="2" style="width:' + remarkColPct + '%">शेरा</th></tr>'
       + '<tr><th>कामाचा तपशील</th></tr>';
  }
  h += '</thead><tbody>';

  questions.forEach(function (q, qi) {
    var qNorm = _normaliseUnitName(q);

    var seen = [];
    colShift.forEach(function (cs, ui) {
      if (!cs) return;
      var rVal = cs.rem[qNorm] || '';
      if (rVal) {
        seen.push({
          shift: units[ui].replace('(Shift)', '').replace('आठवडा', '').trim(),
          text:  String(rVal).trim()
        });
      }
    });
    var rcell = '';
    if (seen.length) {
      var unique = seen.map(function (x) { return x.text; })
                       .filter(function (t, i, arr) { return arr.indexOf(t) === i; });
      rcell = (unique.length === 1)
        ? unique[0]
        : seen.map(function (x) { return x.shift + ': ' + x.text; }).join('<br>');
    }

    h += '<tr><td class="cc">' + _mn(qi + 1) + '</td><td>' + q + '</td>';
    colShift.forEach(function (cs) {
      var a = cs ? (cs.ans[qNorm] || '') : '';
      h += '<td class="' + _ansCls(a) + '">' + a + '</td>';
    });
    h += '<td class="rmk">' + rcell + '</td></tr>';
  });

  h += '</tbody></table>';
  return h;
}

function _pdfSingleTable(type, allShifts) {
  var qs   = FALLBACK_QUESTIONS[type] || [];
  var unit = (allShifts[0] && allShifts[0].answers) ? allShifts[0] : null;
  var h = '<table class="grid"><thead><tr>' +
    '<th style="width:7%">अ. क्र.</th><th>कामाचा तपशील</th>' +
    '<th style="width:20%">काम केले आहे /नाही</th>' +
    '<th style="width:16%">शेरा</th></tr></thead><tbody>';
  qs.forEach(function (q, qi) {
    var a = (unit && unit.answers) ? (unit.answers[q] || '') : '';
    if (!a && unit && unit.answers) a = unit.answers[_normaliseUnitName(q)] || '';
    var r = (unit && unit.remarks && unit.remarks[q]) ? unit.remarks[q] : '';
    h += '<tr><td class="cc">' + _mn(qi + 1) + '</td><td>' + q + '</td>' +
         '<td class="' + _ansCls(a) + '">' + a + '</td>' +
         '<td class="rmk">' + r + '</td></tr>';
  });
  h += '</tbody></table>';
  return h;
}

function _pdfBusTable(type, buses) {
  var qs = FALLBACK_QUESTIONS[type] || [];

  var remarkPct  = 9;
  var srPct      = 5;
  var busPct     = 16; 
  var qTotalPct  = 100 - srPct - busPct - remarkPct;
  var colW       = Math.max(5, Math.floor(qTotalPct / Math.max(1, qs.length)));
  var totalCheck = srPct + busPct + (colW * qs.length) + remarkPct;
  if (totalCheck > 100) {
    colW = Math.max(4, Math.floor((qTotalPct - 5) / Math.max(1, qs.length)));
  }
  var busLong = (qs.length >= 10); 

  function wrapHeader(txt, maxChars) {
    maxChars = maxChars || 10;
    if (!txt || txt.length <= maxChars) return txt;
    var lines = [], cur = '';
    txt.split('').forEach(function (ch) {
      cur += ch;
      if (cur.length >= maxChars && /[\s,।]/.test(ch)) { lines.push(cur.trim()); cur = ''; }
    });
    if (cur.trim()) lines.push(cur.trim());
    return lines.join('<br>');
  }
  var maxHdrChars = Math.max(6, Math.floor(colW * 1.2));

  var head = '<thead><tr>'
    + '<th style="width:' + srPct  + '%">अ. क्र.</th>'
    + '<th style="width:' + busPct + '%">बस क्रमांक</th>';
  qs.forEach(function (q) {
    head += '<th style="width:' + colW + '%;font-size:7px;line-height:1.3">'
          + wrapHeader(q, maxHdrChars) + '</th>';
  });
  head += '<th style="width:' + remarkPct + '%">शेरा</th></tr></thead>';

  var body   = '<tbody>';
  var PAD    = buses.length === 0 ? 10 : (buses.length < 12 ? 3 : 0);
  var total  = buses.length + PAD;
  var seen   = {};

  for (var i = 0; i < total; i++) {
    body += '<tr><td class="cc">' + _mn(i + 1) + '</td>';
    if (i < buses.length) {
      var b      = buses[i];
      var rparts = [];
      var bn     = _sanitizeInput(b.busNumber);
      seen[bn]   = (seen[bn] || 0) + 1;
      var label  = bn + (seen[bn] > 1 ? ' (पुन्हा ' + _mn(seen[bn]) + ')' : '');
      // REPLACE:
      body += '<td class="cc" style="font-weight:bold;font-size:11px;letter-spacing:0.5px">' + label + '</td>';
      qs.forEach(function (q, qi) {
        var a = (b.answers || {})[q] || '';
        if (!a) a = (b.answers || {})[_normaliseUnitName(q)] || '';
        body += '<td class="' + _ansCls(a) + '">' + a + '</td>';
        if ((b.remarks || {})[q]) rparts.push(_mn(qi + 1) + ': ' + b.remarks[q]);
      });
      body += '<td class="rmk">' + rparts.join('<br>') + '</td>';
    } else {
      body += '<td style="height:22px"></td>';
      qs.forEach(function () { body += '<td></td>'; });
      body += '<td></td>';
    }
    body += '</tr>';
  }
  body += '</tbody>';

  return '<table class="grid' + (busLong ? ' bus-long' : '') + '">' + head + body + '</table>';
}

/* =====================================================================
   PDF DESTINATION FOLDERS (self-contained)
   Tree:  MSRTC_Cleaning_Reports /
             पूर्ण चेकलिस्ट (Completed) / <District> / <Station> /
             अपूर्ण चेकलिस्ट (Pending)  / <District> / <Station> /
   ===================================================================== */
var PDF_TOP_COMPLETED = 'पूर्ण चेकलिस्ट (Completed)';
var PDF_TOP_PENDING   = 'अपूर्ण चेकलिस्ट (Pending)';
var _PDF_FCACHE = {};   // per-execution folder cache

/* Write a tiny text marker into the Pending tree (no PDF render). */
function _pdfWritePendingMarker(payload, doneCount, totalCount) {
  try {
    var folder = _pdfDestFolder(true, payload.dist || '', payload.stn || '');
    var name   = 'PENDING_' + (payload.tokenId || payload.sessionId || 'NA') + '.txt';
    var it = folder.getFilesByName(name);
    while (it.hasNext()) it.next().setTrashed(true);
    var prog = totalCount ? (doneCount + '/' + totalCount) : (doneCount + ' bus');
    var body = 'MSRTC अपूर्ण चेकलिस्ट (PENDING)\n' +
      'Token: ' + (payload.tokenId || '-') + '\n' +
      'District: ' + (payload.dist || '-') + '\nStation: ' + (payload.stn || '-') + '\n' +
      'Supervisor: ' + (payload.name || '-') + '\nProgress: ' + prog + '\n' +
      'पूर्ण झाल्यावर PDF "पूर्ण चेकलिस्ट (Completed)" मध्ये दिसेल.\n';
    folder.createFile(name, body, MimeType.PLAIN_TEXT);
  } catch (e) { Logger.log('_pdfWritePendingMarker: ' + e); }
}

/* Remove a session's pending marker (called when it completes). */
function _pdfClearPendingMarker(district, station, tokenId, sessionId) {
  try {
    var folder = _pdfDestFolder(true, district || '', station || '');
    var name = 'PENDING_' + (tokenId || sessionId || 'NA') + '.txt';
    var it = folder.getFilesByName(name);
    while (it.hasNext()) it.next().setTrashed(true);
  } catch (e) { Logger.log('_pdfClearPendingMarker: ' + e); }
}

function _pdfChildFolder(parent, name) {
  var clean = String(name || '').trim() || '(अज्ञात-Unknown)';
  var ck = parent.getId() + '|' + clean;
  if (_PDF_FCACHE[ck]) return _PDF_FCACHE[ck];

  var cacheKey = 'pdffolder_id:' + ck;
  var cachedId = _cacheGet(cacheKey);
  if (cachedId) {
    try {
      var byId = DriveApp.getFolderById(cachedId);
      _PDF_FCACHE[ck] = byId;
      return byId;
    } catch (eStale) {
      Logger.log('[_pdfChildFolder] cached folder id stale, re-resolving: ' + eStale);
    }
  }

  var it = parent.getFoldersByName(clean);
  var f  = it.hasNext() ? it.next() : parent.createFolder(clean);
  _PDF_FCACHE[ck] = f;
  _cacheSet(cacheKey, f.getId(), 21600);   // 6 hours — CacheService's max
  return f;
}

/* Leaf folder for a given tree (pending/completed) + district + station. */
function _pdfDestFolder(isPending, district, station) {
  var root = getFolder(CONFIG.PDF_FOLDER);              // MSRTC_Cleaning_Reports
  var top  = _pdfChildFolder(root, isPending ? PDF_TOP_PENDING : PDF_TOP_COMPLETED);
  var dist = _pdfChildFolder(top, district);
  return _pdfChildFolder(dist, station);
}

/* Trash any existing copy of fname in BOTH trees for this district/station. */
function _pdfTrashExisting(district, station, fname) {
  try {
    [true, false].forEach(function (pendingFlag) {
      var folder = _pdfDestFolder(pendingFlag, district, station);
      var it = folder.getFilesByName(fname);
      while (it.hasNext()) it.next().setTrashed(true);
    });
  } catch (e) { Logger.log('_pdfTrashExisting: ' + e); }
}

function generateCombinedPDF(payload) {
  try {
    var displayDate = payload.date;
    if (displayDate && /^\d{4}-\d{2}-\d{2}$/.test(String(displayDate))) {
      var _nd = displayDate.split('-');
      displayDate = _nd[2] + '/' + _nd[1] + '/' + _nd[0];   // yyyy-MM-dd → dd/MM/yyyy
    }
    if (displayDate) payload.date = displayDate;
    var type  = payload.checklistKey || 'bs';
    var meta  = CHECKLIST_META[type] || { mode: 'shift' };
    var isBus = (meta.mode === 'bus');
    var now   = Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy hh:mm a');

    // Resolve date from payload first; only hit the Sheet if truly missing.
    if (!payload.date && payload.sessionId && !payload._dataReady) {
      try {
        var _ploc = _locateSession(payload.sessionId);
        if (_ploc) {
          var _m   = _headerMap(_ploc.sheet);
          var _row = _ploc.sheet.getRange(_ploc.row, 1, 1, _ploc.sheet.getLastColumn()).getValues()[0];
          var _datePart = (_normalizeCreated(_row[_m['Created Time']]) || '').split(' ')[0];
          if (_datePart) payload.date = _datePart;
        }
      } catch (_de) {}
    }

    // Reconcile payload + sheet so no saved shift/bus is dropped.
    var allShifts = payload.completedShifts || [];
    if (!isBus && payload.sessionId && !payload._dataReady) {
      try {
        var sheetShifts = loadPreviousShifts(payload.sessionId);
        allShifts = _mergeShiftLists(allShifts, sheetShifts);
      } catch (e) { Logger.log('shift reconcile: ' + e); }
    }
    if (!isBus && meta.mode !== 'single' && !allShifts.length) {
      Logger.log('[PDF WARN] No shifts found for session: ' + (payload.sessionId || 'none'));
    }
    var allBuses = payload.completedBuses || [];
    if (isBus && payload.sessionId && !payload._dataReady) {
      try { var sb = loadPreviousBuses(payload.sessionId); if (sb.length >= 1) allBuses = sb; } catch (e) {}
    }

    // Government print format: shift PDFs always show all 6 shift columns;
    // week mode shows its 4 fixed week columns.
    var pdfUnits = (meta.mode === 'week') ? WEEKS : SHIFTS;

    var html = '<!DOCTYPE html><html><head><meta charset="UTF-8"><style>'
      + _pdfCss(isBus) + '</style></head><body>';
    html += _pdfHeaderOpen(payload) + _pdfTitle(type);

    if (isBus) {
      html += _pdfBusTable(type, allBuses);
      if (allBuses.length === 0)
        html += '<div style="text-align:center;padding:12px;border:1px solid #000;border-top:none">कोणतीही बस नोंदवली नाही.</div>';
    } else if (meta.mode === 'single') {
      html += _pdfSingleTable(type, allShifts);
    } else {
      html += _pdfShiftTable(type, allShifts, pdfUnits);
      if (allShifts.length === 0)
        html += '<div style="text-align:center;padding:12px;border:1px solid #000;border-top:none">कोणताही युनिट पूर्ण झाला नाही.</div>';
    }
    html += _pdfPenalty(type) + _pdfSig(type) + '</div>' + _pdfFooter(payload, now) + '</body></html>';

    var fname = 'MSRTC_' + type.toUpperCase() + '_' + (payload.tokenId || 'NA') + '.pdf';
    var pdfBlob = Utilities.newBlob(html, 'text/html', fname).getAs(MimeType.PDF);
    pdfBlob.setName(fname);

    var folder = _pdfDestFolder(!!payload._pending, payload.dist || '', payload.stn || '');
    if (!payload._skipTrash) {
      _pdfTrashExisting(payload.dist || '', payload.stn || '', fname);
    }
    if (!payload._pending) {
      try { _pdfClearPendingMarker(payload.dist || '', payload.stn || '', payload.tokenId, payload.sessionId); }
      catch (e) { Logger.log('clear marker: ' + e); }
    }

    var pdfFile = folder.createFile(pdfBlob);
    pdfFile.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
    Logger.log('PDF created: ' + fname + ' shifts=' + allShifts.length + ' pending=' + (!!payload._pending));
    return pdfFile.getUrl();
  } catch (err) {
    Logger.log('[generateCombinedPDF FATAL] ' + err + ' | stack: ' + (err && err.stack));
    throw err;
  }
}

/* =====================================================================
   BULK PENDING-PDF GENERATOR (resumable, quota-safe)
   ---------------------------------------------------------------------
   Generates PDFs for Completed sessions that currently have NO PDF URL.
   Designed for the lazy-PDF model + Google's daily conversion quota:
     • Renders at most MAX_PER_RUN PDFs per invocation (default 60) so a
       single run can never exhaust the conversion quota.
     • RESUMABLE: scans newest→oldest and stops at the cap; run it again
       (or via the time trigger below) to continue with the next batch.
       Progress is implicit — each run only ever sees rows that STILL
       lack a PDF, so already-done rows naturally drop out of scope.
     • Targeted filters (all optional): date range, district, checklist
       type — so you can generate just what's needed instead of the
       entire historical backlog.
     • Chain-aware: scans every link in the session chain.
   ---------------------------------------------------------------------
   USAGE (from the editor — set opts, then run):

     generatePendingPDFs();                       // newest 60 Completed w/o PDF
     generatePendingPDFs({ max: 100 });           // larger batch (watch quota)
     generatePendingPDFs({ dateFrom:'2026-06-01', dateTo:'2026-06-24' });
     generatePendingPDFs({ district:'अमरावती' });
     generatePendingPDFs({ checklistKey:'bw' });  // only bus checklists, etc.

   For a large backlog: install the trigger (installPendingPdfTrigger)
   and let it drain a batch every 10 minutes automatically, across days.
   ===================================================================== */

function generatePendingPDFs(opts) {
  opts = opts || {};
  var MAX_PER_RUN = opts.max || 60;   // hard cap per run — keeps you under quota

  // Optional filters
  var dFrom = _ppdfDay(opts.dateFrom);   // dd/MM/yyyy or null
  var dTo   = _ppdfDay(opts.dateTo);
  var distF = opts.district ? String(opts.district).trim() : '';
  var keyF  = opts.checklistKey ? String(opts.checklistKey).trim() : '';

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) {
    var bm = 'Busy — another generator run is in progress. Try again shortly.';
    Logger.log(bm); try { SpreadsheetApp.getUi().alert(bm); } catch (e) {}
    return bm;
  }

  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  L('===== BULK PENDING-PDF GENERATOR =====');
  L('Cap this run: ' + MAX_PER_RUN +
    (dFrom||dTo ? '  | date: ' + (dFrom||'…') + ' → ' + (dTo||'…') : '') +
    (distF ? '  | district: ' + distF : '') +
    (keyF  ? '  | type: ' + keyF : '') + '\n');

  var generated = 0, failed = 0, scanned = 0, candidates = 0;
  var startMs = Date.now();
  var TIME_BUDGET = 5 * 60 * 1000;   // stay under the 6-min execution limit

  try {
    var ids = _chainIds();
    // newest link first, newest rows first (most-wanted PDFs generated soonest)
    for (var li = ids.length - 1; li >= 0 && generated < MAX_PER_RUN; li--) {
      var sh = _chainSessionsSheet(ids[li]);
      var c  = _headerMap(sh);
      if (sh.getLastRow() < 2) continue;
      if (c['Status'] === undefined || c['PDF URL'] === undefined) continue;

      var n = sh.getLastRow() - 1;
      // Read just the columns we filter on, once (cheap), newest first.
      var statusCol = sh.getRange(2, c['Status']       + 1, n, 1).getValues();
      var pdfCol    = sh.getRange(2, c['PDF URL']      + 1, n, 1).getValues();
      var sidCol    = sh.getRange(2, c['Session ID']   + 1, n, 1).getValues();
      var keyCol    = sh.getRange(2, c['Checklist Key']+ 1, n, 1).getValues();
      var distCol   = c['District']     !== undefined ? sh.getRange(2, c['District']     + 1, n, 1).getValues() : null;
      var createdCol= c['Created Time'] !== undefined ? sh.getRange(2, c['Created Time'] + 1, n, 1).getValues() : null;

      for (var i = n - 1; i >= 0 && generated < MAX_PER_RUN; i--) {
        if (Date.now() - startMs > TIME_BUDGET) { L('⏱ time budget reached — stopping (resumable).'); break; }
        scanned++;

        if (String(statusCol[i][0] || '').trim() !== STATUS.COMPLETED) continue;
        if (String(pdfCol[i][0] || '').trim()) continue;   // already has a PDF → skip

        var key = String(keyCol[i][0] || '').trim();
        if (keyF && key !== keyF) continue;
        if (distF && distCol && String(distCol[i][0] || '').trim() !== distF) continue;
        if ((dFrom || dTo) && createdCol) {
          var day = (_normalizeCreated(createdCol[i][0]) || '').split(' ')[0];
          if (dFrom && _ppdfCmp(day, dFrom) < 0) continue;
          if (dTo   && _ppdfCmp(day, dTo)   > 0) continue;
        }

        candidates++;
        var sid = String(sidCol[i][0] || '').trim();
        if (!sid) continue;

        try {
          var payload = getSessionDataForPDF(sid);
          if (!payload) { L('  ⚠️ ' + sid + ' — no data, skipped'); continue; }
          payload._pending = false;        // it's Completed
          payload._skipTrash = true;       // no prior PDF to overwrite
          var url = generateCombinedPDF(payload);
          if (url) {
            _updateSessionRecord(sid, null, null, url, null);
            _invalidateEmpCaches(String(payload.id || '').trim());
            generated++;
            if (generated % 10 === 0) L('  …' + generated + ' generated so far');
          } else {
            failed++; L('  ❌ ' + sid + ' — generator returned empty URL');
          }
        } catch (e) {
          failed++;
          var es = String(e);
          L('  ❌ ' + sid + ' — ' + es);
          // If we hit Google's hard conversion quota mid-run, STOP cleanly —
          // the rest stays pending and the next run/day continues.
          if (es.indexOf('too many times') !== -1 || es.indexOf('conversion') !== -1) {
            L('\n⛔ Google daily conversion quota reached. Stopping. ' +
              'Remaining pending PDFs will generate on the next run (after midnight PT).');
            li = -1; break;
          }
        }
      }
    }
  } catch (eOuter) {
    L('FATAL: ' + eOuter);
  } finally {
    try { lock.releaseLock(); } catch (e2) {}
  }

  L('\n--- SUMMARY ---');
  L('Rows scanned:        ' + scanned);
  L('Matched & pending:   ' + candidates);
  L('PDFs generated:      ' + generated);
  L('Failed:              ' + failed);
  L((generated >= MAX_PER_RUN)
      ? '\n⚠️ Hit the per-run cap (' + MAX_PER_RUN + '). RUN AGAIN to continue the backlog.'
      : '\n✅ No more pending PDFs matched (within filters / this run).');
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg.length > 8000 ? msg.slice(0,8000)+'\n…(see Logs)' : msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

/* yyyy-MM-dd → dd/MM/yyyy (the sheet's stored day format). null if blank. */
function _ppdfDay(iso) {
  if (!iso) return null;
  var m = String(iso).trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? (m[3] + '/' + m[2] + '/' + m[1]) : null;
}
/* Compare two dd/MM/yyyy day strings: -1, 0, 1. */
function _ppdfCmp(a, b) {
  function key(s){ var p=String(s).split('/'); return (p[2]||'')+(p[1]||'')+(p[0]||''); }
  var ka = key(a), kb = key(b);
  return ka < kb ? -1 : (ka > kb ? 1 : 0);
}

/* Auto-drain the backlog: a batch every 10 minutes until none remain.
   Install once; remove with removePendingPdfTrigger() when the backlog clears. */
function installPendingPdfTrigger() {
  _deleteTriggersByName('pendingPdfTriggerRun');
  ScriptApp.newTrigger('pendingPdfTriggerRun').timeBased().everyMinutes(10).create();
  return 'Pending-PDF trigger installed (a batch every 10 min). ' +
         'Remove it with removePendingPdfTrigger() once the backlog is cleared.';
}
function removePendingPdfTrigger() {
  _deleteTriggersByName('pendingPdfTriggerRun');
  return 'Pending-PDF trigger removed.';
}
function pendingPdfTriggerRun() {
  // Smaller batch for the unattended trigger so it never nears the quota
  // even if it fires many times in a day.
  generatePendingPDFs({ max: 30 });
}
function testPdfMinimal() {
  var url = generateCombinedPDF({
    checklistKey: 'gh', tokenId: 'TEST-PDF', dist: 'अमरावती', stn: 'धारणी',
    date: '07/06/2026', _pending: false,
    completedShifts: [{ shiftName: 'पहिली पाळी(Shift)', questions: ['विश्रांतीगृह झाडणे, पुसणे'],
                        answers: { 'विश्रांतीगृह झाडणे, पुसणे': 'होय' }, remarks: {} }],
    completedBuses: []
  });
  var msg = url ? ('✅ PDF OK:\n' + url) : '❌ empty URL — check Executions log';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return url;
}

/* =====================================================================
   CELL LIMIT DIAGNOSTICS & RELIEF
   Google Sheets caps a spreadsheet at 10,000,000 cells TOTAL, summed
   across every sheet/tab — and critically, that's the RESERVED GRID
   SIZE (rows × columns), not just cells that actually contain data.
   A sheet can silently carry a huge empty grid that counts against the
   limit even with very little real data in it. Run diagnoseCellUsage()
   FIRST (read-only, completely safe) to see exactly where the budget is
   going before doing anything else.
   ===================================================================== */

/* Shows every link in the Inspection_Sessions chain — link 1 is always
   CONFIG.SPREADSHEET_ID, links 2+ are auto-created overflow spreadsheets.
   For each link: spreadsheet ID/URL, reserved cell usage against the 10M
   limit, and how many session rows it actually holds. Run this any time
   to confirm the chain is working as expected and see how close any link
   is to triggering the next overflow. */
function diagnoseChainStatus() {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  L('===== SESSION CHAIN STATUS =====');
  try {
    var ids = _chainIds();
    var activeId = ids[ids.length - 1];
    L('\nTotal links: ' + ids.length);
    L('Currently active link (new sessions go here): #' + ids.length + '\n');
    ids.forEach(function (id, idx) {
      var ss = _chainSS(id);
      var sh = _chainSessionsSheet(id);
      var totalGrid = 0;
      ss.getSheets().forEach(function (s) { totalGrid += s.getMaxRows() * s.getMaxColumns(); });
      var dataRows = Math.max(sh.getLastRow() - 1, 0);
      var isActive = (id === activeId);
      L('Link #' + (idx + 1) + (idx === 0 ? ' (primary' : ' (overflow') +
        (isActive ? ', ACTIVE' : '') + '):');
      L('  Spreadsheet ID: ' + id);
      L('  URL: https://docs.google.com/spreadsheets/d/' + id + '/edit');
      L('  Session rows: ' + dataRows.toLocaleString());
      L('  Reserved cells (whole spreadsheet): ' + totalGrid.toLocaleString() + ' / 10,000,000' +
        (totalGrid >= SESSION_CHAIN_NEAR_LIMIT ? '  ⚠️ NEAR LIMIT — next save will create a new link' : ''));
      L('');
    });
    L('Employee_Master / DistrictBusStation / Audit_Log live ONLY in link 1');
    L('(' + CONFIG.SPREADSHEET_ID + ') — never sharded, never moved.');
  } catch (e) { L('ERROR: ' + e); }
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg.length > 8000 ? (msg.slice(0, 8000) + '\n…(truncated, see Logs)') : msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

function diagnoseCellUsage() {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  L('===== MSRTC CELL USAGE DIAGNOSTIC =====');
  try {
    var ss = _ss();
    var sheets = ss.getSheets();
    var totalGrid = 0, totalUsed = 0;
    L('\nPer-sheet breakdown (' + sheets.length + ' sheets):');
    sheets.forEach(function (sh) {
      var maxRows = sh.getMaxRows(), maxCols = sh.getMaxColumns();
      var lastRow = sh.getLastRow(), lastCol = sh.getLastColumn();
      var gridCells = maxRows * maxCols;
      var usedCells = Math.max(lastRow, 0) * Math.max(lastCol, 0);
      var wasted = gridCells - usedCells;
      totalGrid += gridCells; totalUsed += usedCells;
      L('  ' + sh.getName() + ':');
      L('    reserved grid: ' + maxRows + ' rows × ' + maxCols + ' cols = ' + gridCells.toLocaleString() + ' cells');
      L('    actual data:   ' + lastRow + ' rows × ' + lastCol + ' cols = ' + usedCells.toLocaleString() + ' cells');
      L('    WASTED (empty but reserved): ' + wasted.toLocaleString() + ' cells');
    });
    L('\n— TOTALS —');
    L('Reserved across whole spreadsheet: ' + totalGrid.toLocaleString() + ' / 10,000,000');
    L('Actually used: ' + totalUsed.toLocaleString());
    L('Wasted (empty reserved grid): ' + (totalGrid - totalUsed).toLocaleString());
    L('\nIf "Wasted" is large, run trimEmptyGridSpace() — it only removes');
    L('empty reserved rows/columns beyond a safety buffer, never touches data.');
    L('If "actual data" itself is the bulk of the total, the fix is');
    L('archiving old data instead — see archiveLegacyResponseSheets() and');
    L('confirm archiveOldSessions() has actually been running (the monthly');
    L('trigger only exists if installAllTriggers() / installArchiveTrigger()');
    L('was run at least once).');
  } catch (e) { L('ERROR: ' + e); }
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg.length > 8000 ? (msg.slice(0, 8000) + '\n…(truncated, see Logs)') : msg); }
  catch (e) { Logger.log(msg); }
  return msg;
}

/* SAFE, IMMEDIATE RELIEF: shrinks each sheet's reserved grid down to just
   past its actual data (plus a working buffer so normal appendRow() calls
   don't need their own resize). This NEVER touches any cell that has
   data — it only removes empty reserved rows/columns beyond the buffer.
   Run diagnoseCellUsage() first to see if this is even the right fix for
   your situation (it only helps if "wasted" cells are a meaningful share
   of the total). */
function trimEmptyGridSpace() {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { return 'Busy — try again in a moment.'; }
  try {
    var ROW_BUFFER = 500;   // headroom past actual data so new rows don't need a resize
    var COL_BUFFER = 5;
    var ss = _ss();
    var sheets = ss.getSheets();
    var freedTotal = 0;
    sheets.forEach(function (sh) {
      try {
        var maxRows = sh.getMaxRows(), maxCols = sh.getMaxColumns();
        var lastRow = Math.max(sh.getLastRow(), 1);
        var lastCol = Math.max(sh.getLastColumn(), 1);
        var targetRows = lastRow + ROW_BUFFER;
        var targetCols = lastCol + COL_BUFFER;
        var freedRows = 0, freedCols = 0;
        if (maxRows > targetRows) {
          sh.deleteRows(targetRows + 1, maxRows - targetRows);
          freedRows = maxRows - targetRows;
        }
        var curMaxCols = sh.getMaxColumns();   // re-read in case row delete changed anything
        if (curMaxCols > targetCols) {
          sh.deleteColumns(targetCols + 1, curMaxCols - targetCols);
          freedCols = curMaxCols - targetCols;
        }
        if (freedRows || freedCols) {
          L(sh.getName() + ': removed ' + freedRows + ' empty rows, ' + freedCols + ' empty columns');
          freedTotal += (freedRows * maxCols) + (freedCols * Math.min(maxRows, targetRows));
        }
      } catch (e) { L(sh.getName() + ': skipped — ' + e); }
    });
    L('\nApprox cells freed: ' + freedTotal.toLocaleString());
    L('Run diagnoseCellUsage() again to confirm the new totals.');
  } catch (e) { L('ERROR: ' + e); }
  finally { try { lock.releaseLock(); } catch (e2) {} }
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

/* Archives Shift_Responses / Bus_Responses rows older than
   CONFIG.ARCHIVE_KEEP_DAYS into the same archive spreadsheet
   archiveOldSessions() uses, then deletes them from the live sheet.
   These two sheets are READ-ONLY fallbacks now (the consolidated JSON
   columns on Inspection_Sessions are the live storage for everything
   created since that migration) — nothing actively writes new rows into
   them — but if this system ran in the old per-question-row mode for any
   period before that, these sheets can be carrying a large amount of
   historical data that archiveOldSessions() never looks at, since it
   only scans Inspection_Sessions. Data is preserved in the archive
   spreadsheet, not deleted outright. */
function archiveLegacyResponseSheets() {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(60000)) { return 'Busy — try again in a moment.'; }
  try {
    var cutoffMs = new Date().getTime() - (CONFIG.ARCHIVE_KEEP_DAYS * 24 * 60 * 60 * 1000);
    var props = PropertiesService.getScriptProperties();
    var archiveId = props.getProperty('ARCHIVE_SS_ID');
    var archiveSS;
    if (archiveId) { try { archiveSS = SpreadsheetApp.openById(archiveId); } catch (e) { archiveSS = null; } }
    if (!archiveSS) {
      archiveSS = SpreadsheetApp.create('MSRTC_Archive_Sessions');
      props.setProperty('ARCHIVE_SS_ID', archiveSS.getId());
    }

    ['Shift_Responses', 'Bus_Responses'].forEach(function (name) {
      var sh = _legacySheet(name);
      if (!sh) { L(name + ': sheet not found, skipping.'); return; }
      var lastRow = sh.getLastRow();
      if (lastRow < 2) { L(name + ': no data rows.'); return; }
      var lastCol = sh.getLastColumn();
      var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
      var tsCol = headers.indexOf('Timestamp');
      if (tsCol < 0) { L(name + ': no Timestamp column, skipping.'); return; }

      var data = sh.getRange(2, 1, lastRow - 1, lastCol).getValues();
      var toArchive = [];
      for (var i = 0; i < data.length; i++) {
        var ms = _parseISTDateString(_normalizeCreated(data[i][tsCol]));
        if (ms && ms < cutoffMs) toArchive.push({ rowIndex: i + 2, values: data[i] });
      }
      if (!toArchive.length) { L(name + ': nothing older than ' + CONFIG.ARCHIVE_KEEP_DAYS + ' days.'); return; }

      var archName = name + '_Archive';
      var aSheet = archiveSS.getSheetByName(archName);
      if (!aSheet) { aSheet = archiveSS.insertSheet(archName); aSheet.appendRow(headers); }
      else if (aSheet.getLastRow() === 0) { aSheet.appendRow(headers); }

      var rowsToWrite = toArchive.map(function (r) { return r.values; });
      aSheet.getRange(aSheet.getLastRow() + 1, 1, rowsToWrite.length, lastCol).setValues(rowsToWrite);

      toArchive.sort(function (a, b) { return b.rowIndex - a.rowIndex; });
      toArchive.forEach(function (r) { sh.deleteRow(r.rowIndex); });

      L(name + ': archived ' + toArchive.length + ' rows older than ' + CONFIG.ARCHIVE_KEEP_DAYS + ' days.');
    });

    L('\nDone. Run trimEmptyGridSpace() next to reclaim the freed grid space,');
    L('then diagnoseCellUsage() to confirm.');
  } catch (e) { L('ERROR: ' + e); }
  finally { try { lock.releaseLock(); } catch (e2) {} }
  var msg = out.join('\n');
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}

function diagnosePDF() {
  var out = [];
  function L(s){ out.push(s); try{Logger.log(s);}catch(e){} }
  L('===== MSRTC PDF DIAGNOSTIC =====');

  try {
    var trg = ScriptApp.getProjectTriggers();
    L('\n[1] Installed triggers: ' + trg.length);
    trg.forEach(function(t){ L('   - ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')'); });
    if (!trg.length) L('   WARNING: no triggers. If PDFs are async/queued, nothing processes the queue.');
  } catch(e){ L('[1] trigger read failed: ' + e); }

  var ss = _ss();
  var sheets = ss.getSheets(), queueSheet=null, auditSheet=null;
  L('\n[2] Sheets (' + sheets.length + '):');
  sheets.forEach(function(sh){
    var n=sh.getName(), ln=n.toLowerCase();
    L('   - ' + n + '  rows=' + sh.getLastRow());
    if(!queueSheet && (ln.indexOf('queue')>=0 || ln.indexOf('pdf')>=0)) queueSheet=sh;
    if(!auditSheet && ln.indexOf('audit')>=0) auditSheet=sh;
  });

  try {
    var q = PropertiesService.getScriptProperties().getProperty('PDF_QUEUE') || '[]';
    L('\n[3] PDF_QUEUE: ' + q.slice(0, 400));
  } catch (e) { L('\n[3] PDF_QUEUE read failed: ' + e); }

  if(auditSheet){
    var lr2=auditSheet.getLastRow(), lc2=auditSheet.getLastColumn();
    L('\n[4] "'+auditSheet.getName()+'" recent error/pdf rows:');
    if(lr2>1){ var st2=Math.max(2,lr2-40), hits=0;
      auditSheet.getRange(st2,1,lr2-st2+1,lc2).getValues().reverse().forEach(function(r){
        var line=r.join(' | ');
        if(/error|pdf|fail/i.test(line) && hits<8){ L('   - '+line.slice(0,280)); hits++; }
      });
      if(!hits) L('   (none in last 40 rows)');
    }
  } else L('\n[4] No Audit sheet found.');

  L('\n[5] Live generateCombinedPDF test:');
  try {
    if(typeof generateCombinedPDF!=='function'){ L('   FAIL: generateCombinedPDF is NOT defined in the project.'); }
    else {
      var url=generateCombinedPDF({checklistKey:'gh',tokenId:'DIAG-TEST',dist:'अमरावती',stn:'धारणी',
        date:'07/06/2026',_pending:false,
        completedShifts:[{shiftName:'पहिली पाळी(Shift)',questions:['test'],answers:{'test':'होय'},remarks:{}}],
        completedBuses:[]});
      L(url ? ('   OK PDF generated: '+url) : '   FAIL: returned empty URL');
    }
  } catch(e){ L('   THREW: '+e+'\n   stack: '+(e&&e.stack)); }

  var report=out.join('\n');
  try{ SpreadsheetApp.getUi().alert(report.slice(0,1400)); }catch(e){}
  return report;
}

/* === ADMIN UTILITIES === */

function testPdfFolderRouting() {
  var sample = {
    sessionId: 'TEST-' + Date.now(),
    tokenId:   'TEST-TOKEN',
    dist:      'चाचणी जिल्हा (TEST District)',
    stn:       'चाचणी स्थानक (TEST Station)',
    name:      'Test Supervisor',
    id:        '0000',
    date:      Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy'),
    checklistKey: 'bs',
    checklist: 'TEST',
    completedShifts: [{ shiftName: 'पहिली पाळी(Shift)',
      questions: ['चाचणी प्रश्न'], answers: { 'चाचणी प्रश्न': 'होय' }, remarks: {} }],
    completedBuses: []
  };

  sample._pending = true;
  var pUrl = generateCombinedPDF(sample);

  sample._pending = false;
  var cUrl = generateCombinedPDF(sample);

  var msg = 'Folder routing test (v' + CONFIG.VERSION + ')\n\n' +
    'PENDING PDF →\n' + pUrl + '\n\n' +
    'COMPLETED PDF →\n' + cUrl + '\n\n' +
    'Open Drive ▸ ' + CONFIG.PDF_FOLDER + ' and confirm:\n' +
    '• ' + PDF_TOP_PENDING + ' / ' + sample.dist + ' / ' + sample.stn + '\n' +
    '• ' + PDF_TOP_COMPLETED + ' / ' + sample.dist + ' / ' + sample.stn + '\n\n' +
    'If both are inside those subfolders, routing works. If they are loose in ' +
    CONFIG.PDF_FOLDER + ', the running code is old — redeploy.';
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { Logger.log(msg); }
  return msg;
}
function diagnoseSessionShifts(token) {
  var ss = getSessionsSheet();
  var rn = _findRowsByColumn(ss, 'Token ID', token);
  if (!rn.length) { Logger.log('token not found'); return; }
  var sid = String(_readRows(ss, [rn[0]])[0].values[_headerMap(ss)['Session ID']]);
  var shifts = loadPreviousShifts(sid);
  var lines = shifts.map(function (s) {
    return '"' + s.shiftName + '"  (' + Object.keys(s.answers||{}).length + ' answers)  hex=' +
      s.shiftName.split('').map(function(c){return c.charCodeAt(0).toString(16);}).join(',');
  });
  var msg = 'Session ' + sid + ' has ' + shifts.length + ' saved shifts:\n\n' + lines.join('\n\n');
  Logger.log(msg); try { SpreadsheetApp.getUi().alert(msg); } catch(e){}
}
// run: diagnoseSessionShifts('MSRTC-AMR-DHRN-0006')

function dumpSessionHeaders() {
  var sh = getSessionsSheet();
  var lastCol = sh.getLastColumn();
  var headers = sh.getRange(1, 1, 1, lastCol).getValues()[0];
  var out = headers.map(function (h, i) {
    return '[' + i + '] "' + h + '"  (length=' + String(h).length + ')';
  }).join('\n');
  Logger.log(out);
  try { SpreadsheetApp.getUi().alert(out); } catch (e) {}
  return out;
}

function oneTimeSetup() {
  try {
    getSessionsSheet();
    _ensureJsonCols();   // consolidated store: JSON columns on the sessions sheet
    // (Shift_Responses / Bus_Responses are no longer created — data is consolidated)
    getDraftSheet();
    getEmployeeMaster();
    _getOrCreateSheet(CONFIG.LOG_SHEET, ['Timestamp','Action','Session ID','Details','User Email']);
    getFolder(CONFIG.PDF_FOLDER);
    Logger.log('✅ Setup Complete! Version: ' + CONFIG.VERSION);
  } catch (e) {
    Logger.log('❌ Setup failed: ' + e);
  }
}

function RUN_FULL_SETUP() {
  var results = [];
  var errors  = [];

  function safe(name, fn) {
    try {
      var r = fn();
      results.push('✅ ' + name + (r ? ': ' + r : ''));
    } catch(e) {
      errors.push('❌ ' + name + ': ' + e.toString());
    }
  }

  // 1. Fix timezone
  safe('Timezone', function() { return fixSpreadsheetTimezone(); });

  // 2. Create all sheets
  safe('Sessions Sheet',        function() { getSessionsSheet();       return 'OK'; });
  safe('Consolidated JSON columns', function() { _ensureJsonCols(); return 'OK'; });
  safe('Draft Sheet',           function() { getDraftSheet();          return 'OK'; });
  safe('Employee Master',       function() { getEmployeeMaster();      return 'OK'; });
  safe('Audit Log', function() {
    _getOrCreateSheet(CONFIG.LOG_SHEET, ['Timestamp','Action','Session ID','Details','User Email']);
    return 'OK';
  });

  // 3. Create PDF folder
  safe('PDF Folder', function() {
    var f = getFolder(CONFIG.PDF_FOLDER);
    return 'ID: ' + f.getId();
  });

  // 4. Install all triggers (keepWarm intentionally NOT installed —
  //    it cannot keep web-app executions warm and only burns quota)
  safe('Pause Trigger',         function() { return installPauseTrigger(); });
  safe('PDF Queue Trigger',     function() { return installPDFQueueTrigger(); });
  safe('Month End Trigger',     function() { return installMonthEndTrigger(); });
  safe('Auto Finalize Trigger', function() { return installAutoFinalizeTrigger(); });
  safe('Archive Trigger',       function() { return installArchiveTrigger(); });
  safe('Delete Queue Trigger',  function() { return installDeleteQueueTrigger(); });
  safe('Folder Sort Trigger',   function() { return installFolderSortTrigger(); });
  safe('Remove keepWarm',       function() { _deleteTriggersByName('keepWarm'); return 'removed'; });

  // 5. Clear all caches
  safe('Clear Caches', function() { clearAllCaches(); return 'OK'; });

  // 6. Test PDF generation
  safe('PDF Test', function() {
    var url = generateCombinedPDF({
      checklistKey:    'bs',
      tokenId:         'SETUP-TEST',
      dist:            'पुणे',
      stn:             'स्वारगेट',
      date:            Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy'),
      _pending:        false,
      completedShifts: [{
        shiftName: 'पहिली पाळी(Shift)',
        questions: ['बसस्थानक झाडणे, पुसणे'],
        answers:   { 'बसस्थानक झाडणे, पुसणे': 'होय' },
        remarks:   {}
      }],
      completedBuses: []
    });
    return url ? 'PDF OK' : 'PDF FAILED';
  });

  // 7. Print results
  var report = '========== MSRTC FULL SETUP REPORT ==========\n\n';
  report += 'Version: ' + CONFIG.VERSION + '\n';
  report += 'Date: ' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'dd/MM/yyyy HH:mm:ss') + '\n\n';

  report += '--- RESULTS (' + results.length + ') ---\n';
  results.forEach(function(r) { report += r + '\n'; });

  if (errors.length) {
    report += '\n--- ERRORS (' + errors.length + ') ---\n';
    errors.forEach(function(e) { report += e + '\n'; });
  } else {
    report += '\n🎉 ALL STEPS COMPLETED SUCCESSFULLY!\n';
  }

  report += '\n--- TRIGGERS INSTALLED ---\n';
  ScriptApp.getProjectTriggers().forEach(function(t) {
    report += '• ' + t.getHandlerFunction() + ' (' + t.getEventType() + ')\n';
  });

  report += '\n--- SHEETS CREATED ---\n';
  _ss().getSheets().forEach(function(sh) {
    report += '• ' + sh.getName() + ' (rows: ' + sh.getLastRow() + ')\n';
  });

  Logger.log(report);

  var summary = errors.length
    ? '⚠️ Setup done with ' + errors.length + ' errors.\n\nCheck Execution log for details.'
    : '✅ Full setup complete!\n\n' +
      results.length + ' steps passed.\n' +
      '0 errors.\n\n' +
      'Triggers: ' + ScriptApp.getProjectTriggers().length + ' installed\n' +
      'Version: ' + CONFIG.VERSION;

  try {
    SpreadsheetApp.getUi().alert('MSRTC Setup', summary, SpreadsheetApp.getUi().ButtonSet.OK);
  } catch(e) {
    Logger.log('Alert skipped (run from editor): ' + summary);
  }

  return report;
}

function resetAllCounters() {
  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert('Reset Counters?', 'Reset ALL token sequences. Continue?', ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) return;
  var props = PropertiesService.getScriptProperties();
  var all   = props.getProperties();
  Object.keys(all).forEach(function (k) {
    if (k.indexOf('TOKEN_CTR_') === 0 || k === 'TOKEN_COUNTER' || k === 'SESSION_COUNTER') {
      props.deleteProperty(k);
    }
  });
  ui.alert('✅ All counters reset.');
}

function autoPauseStaleSessions() { markSessionsAsPaused(); }

/* =====================================================================
   ONE-TIME MIGRATION + ARCHIVE  (legacy rows → consolidated JSON)
   Run order (from the editor), verifying after each:
     1) migrateShiftsToJSON()
     2) migrateBusesToJSON()
     3) (check the app + a few PDFs work)
     4) archiveAndRemoveLegacyResponseSheets()   ← frees the cells
   Safe to re-run: only fills JSON cells that are still empty.
   ===================================================================== */

function migrateAllResponsesToJSON() {
  var a = migrateShiftsToJSON();
  var b = migrateBusesToJSON();
  return a + '\n' + b;
}

function migrateShiftsToJSON() {
  _ensureJsonCols();
  var ssh = getSessionsSheet(), smap = _headerMap(ssh);
  var lastRow = ssh.getLastRow();
  if (lastRow < 2) return 'Shifts: no sessions.';
  var sidCol = smap['Session ID'], jCol = smap[SHIFTS_JSON_COL];

  var grouped = _legacyGroupShifts();                       // sessionId → units[]
  var sids = ssh.getRange(2, sidCol + 1, lastRow - 1, 1).getValues();
  var cur  = ssh.getRange(2, jCol  + 1, lastRow - 1, 1).getValues();
  var wrote = 0;
  for (var r = 0; r < sids.length; r++) {
    var id = String(sids[r][0] || '');
    if (!id || cur[r][0]) continue;                         // skip already-migrated
    if (grouped[id] && grouped[id].length) { cur[r][0] = JSON.stringify(_orderShifts(grouped[id])); wrote++; }
  }
  ssh.getRange(2, jCol + 1, lastRow - 1, 1).setValues(cur);
  return 'Shifts: migrated ' + wrote + ' sessions.';
}

function migrateBusesToJSON() {
  _ensureJsonCols();
  var ssh = getSessionsSheet(), smap = _headerMap(ssh);
  var lastRow = ssh.getLastRow();
  if (lastRow < 2) return 'Buses: no sessions.';
  var sidCol = smap['Session ID'], jCol = smap[BUSES_JSON_COL];

  var grouped = _legacyGroupBuses();                        // sessionId → units[]
  var sids = ssh.getRange(2, sidCol + 1, lastRow - 1, 1).getValues();
  var cur  = ssh.getRange(2, jCol  + 1, lastRow - 1, 1).getValues();
  var wrote = 0;
  for (var r = 0; r < sids.length; r++) {
    var id = String(sids[r][0] || '');
    if (!id || cur[r][0]) continue;
    if (grouped[id] && grouped[id].length) { cur[r][0] = JSON.stringify(grouped[id]); wrote++; }
  }
  ssh.getRange(2, jCol + 1, lastRow - 1, 1).setValues(cur);
  return 'Buses: migrated ' + wrote + ' sessions.';
}

/* Group ALL legacy shift rows by session in one pass. */
function _legacyGroupShifts() {
  var sh = _legacySheet('Shift_Responses');
  if (!sh || sh.getLastRow() < 2) return {};
  var vals = sh.getDataRange().getValues();
  var h = _headerMap(sh);
  var ci = { sid: h['Session ID'], name: h['Shift Name'], q: h['Question'], a: h['Answer'], r: h['Remark'] };
  var out = {};
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    var sid = String(row[ci.sid] || ''); if (!sid) continue;
    var nm  = _normaliseUnitName(String(row[ci.name] || ''));
    var q   = String(row[ci.q] || '');   if (!nm || !q) continue;
    var bag = out[sid] || (out[sid] = {});
    var u = bag[nm] || (bag[nm] = { shiftName: nm, questions: [], answers: {}, remarks: {} });
    if (u.questions.indexOf(q) === -1) u.questions.push(q);
    u.answers[q] = String(row[ci.a] || '');
    var rem = String(row[ci.r] || ''); if (rem) u.remarks[q] = rem;
  }
  // bag(object) → array per session
  Object.keys(out).forEach(function (sid) { out[sid] = Object.keys(out[sid]).map(function (k) { return out[sid][k]; }); });
  return out;
}

/* Group ALL legacy bus rows by session (+ bus number) in one pass. */
function _legacyGroupBuses() {
  var sh = _legacySheet('Bus_Responses');
  if (!sh || sh.getLastRow() < 2) return {};
  var vals = sh.getDataRange().getValues();
  var h = _headerMap(sh);
  var ci = { sid: h['Session ID'], bn: h['Bus Number'], ts: h['Timestamp'], q: h['Question'], a: h['Answer'], r: h['Remark'] };
  var out = {};
  for (var i = 1; i < vals.length; i++) {
    var row = vals[i];
    var sid = String(row[ci.sid] || ''); if (!sid) continue;
    var bn  = String(row[ci.bn] || '').toUpperCase();
    var q   = String(row[ci.q] || '');   if (!bn || !q) continue;
    var bag = out[sid] || (out[sid] = {});
    var u = bag[bn] || (bag[bn] = { busNumber: bn, timestamp: ci.ts !== undefined ? String(row[ci.ts] || '') : '', questions: [], answers: {}, remarks: {} });
    if (u.questions.indexOf(q) === -1) u.questions.push(q);
    u.answers[q] = String(row[ci.a] || '');
    var rem = String(row[ci.r] || ''); if (rem) u.remarks[q] = rem;
  }
  Object.keys(out).forEach(function (sid) { out[sid] = Object.keys(out[sid]).map(function (k) { return out[sid][k]; }); });
  return out;
}

/* Copy the two legacy sheets to a separate archive file, then delete them
   from the live spreadsheet (this is what actually frees the cells).
   RUN ONLY AFTER migration is verified. */
function archiveAndRemoveLegacyResponseSheets() {
  var src = _ss();
  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('RESP_ARCHIVE_SS_ID');
  var arch = null;
  if (id) { try { arch = SpreadsheetApp.openById(id); } catch (e) { arch = null; } }
  if (!arch) { arch = SpreadsheetApp.create(src.getName() + '_Responses_Archive'); props.setProperty('RESP_ARCHIVE_SS_ID', arch.getId()); }

  var done = [];
  ['Shift_Responses', 'Bus_Responses'].forEach(function (name) {
    var sh = src.getSheetByName(name);
    if (!sh) { done.push(name + ': not present'); return; }
    var copy = sh.copyTo(arch);
    copy.setName(name + '_' + Utilities.formatDate(new Date(), 'Asia/Kolkata', 'yyyyMMdd'));
    src.deleteSheet(sh);
    done.push(name + ': archived + removed');
  });
  // tidy the archive's default empty sheet
  try { var def = arch.getSheetByName('Sheet1'); if (def && arch.getSheets().length > 1) arch.deleteSheet(def); } catch (e) {}
  _SHEET_CACHE = {}; _LOC_CACHE = {};
  return 'Archive file: ' + arch.getUrl() + '\n' + done.join('\n') + '\n\n' +
         (typeof reportCellUsage === 'function' ? reportCellUsage() : '');
}

/* =====================================================================
   ON-DEMAND FLAT EXPORT for MIS pivots — unpacks the JSON back into an
   answer-per-row table in a SEPARATE spreadsheet (so the live file stays
   small). Returns the export file URL.
   ===================================================================== */
function buildAnswersAnalysis() {
  var ssh = getSessionsSheet(), smap = _headerMap(ssh);
  var data = ssh.getDataRange().getValues();
  function col(n) { return smap[n] !== undefined ? smap[n] : -1; }
  var C = {
    sid: col('Session ID'), dist: col('District'), stn: col('Station'),
    sup: col('Supervisor Name'), emp: col('Employee ID'), type: col('Checklist Type'),
    date: col('Created Time'), sJson: col(SHIFTS_JSON_COL), bJson: col(BUSES_JSON_COL)
  };
  var out = [['Session ID', 'District', 'Station', 'Supervisor', 'Employee ID', 'Checklist', 'Date',
              'Unit Type', 'Unit', 'Question', 'Answer', 'Remark']];

  for (var r = 1; r < data.length; r++) {
    var row = data[r];
    var base = [row[C.sid], row[C.dist], row[C.stn], row[C.sup], row[C.emp], row[C.type], row[C.date]];
    _expandUnits(row[C.sJson], 'Shift', base, out, 'shiftName');
    _expandUnits(row[C.bJson], 'Bus',   base, out, 'busNumber');
  }

  var props = PropertiesService.getScriptProperties();
  var id = props.getProperty('ANALYSIS_SS_ID');
  var ana = null;
  if (id) { try { ana = SpreadsheetApp.openById(id); } catch (e) { ana = null; } }
  if (!ana) { ana = SpreadsheetApp.create(_ss().getName() + '_Analysis'); props.setProperty('ANALYSIS_SS_ID', ana.getId()); }

  var sh = ana.getSheetByName('Answers') || ana.insertSheet('Answers');
  sh.clear();
  sh.getRange(1, 1, out.length, out[0].length).setValues(out);
  try { var def2 = ana.getSheetByName('Sheet1'); if (def2 && ana.getSheets().length > 1) ana.deleteSheet(def2); } catch (e) {}
  return 'Analysis file: ' + ana.getUrl() + '\nRows: ' + (out.length - 1);
}

function repairAllDateColumns() {
  var sh = getSessionsSheet();
  var map = _headerMap(sh);
  var lastRow = sh.getLastRow();
  if (lastRow < 2) { Logger.log('No rows to repair.'); return; }

  var cols = {
    ct: map['Created Time'],
    lu: map['Last Updated'],
    lm: map['Last Modified']
  };

  // Read everything in one call
  var data = sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).getValues();
  var ctOut = [], luOut = [], lmOut = [];

  for (var i = 0; i < data.length; i++) {
    var row = data[i];
    ctOut.push([_normalizeCreated(cols.ct !== undefined ? row[cols.ct] : '')]);
    luOut.push([_normalizeCreated(cols.lu !== undefined ? row[cols.lu] : '')]);
    lmOut.push([_normalizeCreated(cols.lm !== undefined ? row[cols.lm] : '')]);
  }

  // Force plain text then write — order matters
  var n = data.length;
  if (cols.ct !== undefined) {
    var rct = sh.getRange(2, cols.ct + 1, n, 1);
    rct.setNumberFormat('@'); rct.setValues(ctOut);
  }
  if (cols.lu !== undefined) {
    var rlu = sh.getRange(2, cols.lu + 1, n, 1);
    rlu.setNumberFormat('@'); rlu.setValues(luOut);
  }
  if (cols.lm !== undefined) {
    var rlm = sh.getRange(2, cols.lm + 1, n, 1);
    rlm.setNumberFormat('@'); rlm.setValues(lmOut);
  }

  SpreadsheetApp.flush();
  var msg = 'repairAllDateColumns: fixed ' + n + ' rows.';
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch(e) {}
  return msg;
}

function _expandUnits(jsonStr, unitType, base, out, nameKey) {
  if (!jsonStr) return;
  var arr; try { arr = JSON.parse(jsonStr); } catch (e) { return; }
  if (!Array.isArray(arr)) return;
  arr.forEach(function (u) {
    var unitName = u[nameKey] || '';
    var qs = u.questions && u.questions.length ? u.questions : Object.keys(u.answers || {});
    qs.forEach(function (q) {
      out.push(base.concat([unitType, unitName, q, (u.answers || {})[q] || '', (u.remarks || {})[q] || '']));
    });
  });
}

function diagnoseStationDropdown() {
  var out = [];
  function L(s) { out.push(s); Logger.log(s); }
  
  L('===== STATION DROPDOWN DIAGNOSTIC =====\n');
  try {
    var ss = _ss();
    var sh = ss.getSheetByName('DistrictBusStation');
    if (!sh) { L('❌ DistrictBusStation sheet NOT FOUND'); return out.join('\n'); }
    
    L('✅ Sheet found | Rows: ' + sh.getLastRow());
    var data = sh.getDataRange().getValues();
    
    // Build map (same logic as getDistrictData)
    var map = {};
    for (var i = 1; i < data.length; i++) {
      var d = String(data[i][0] || '').trim();
      var s = String(data[i][1] || '').trim();
      if (!d || !s) continue;
      if (!map[d]) map[d] = [];
      if (map[d].indexOf(s) === -1) map[d].push(s);
    }
    
    L('\nDistricts: ' + Object.keys(map).length);
    var totalStns = 0;
    Object.keys(map).forEach(function(d) { totalStns += map[d].length; });
    L('Total stations: ' + totalStns);
    
    L('\n[First 3 districts]');
    Object.keys(map).slice(0, 3).forEach(function(d) {
      L(d + ' → ' + map[d].length + ' stations');
      map[d].slice(0, 2).forEach(function(s) { L('  • ' + s); });
    });
  } catch (e) {
    L('ERROR: ' + e);
  }
  return out.join('\n');
}

function fixStationDropdown() {
  // 1. Clear all caches
  CacheService.getScriptCache().removeAll(['district_map', 'boot_data']);
  _CACHE.districtData = null;
  _CACHE.lastFetch = 0;
  
  // 2. Force fresh read
  var fresh = getDistrictData();
  Logger.log('✅ Cache cleared. Districts: ' + Object.keys(fresh).length);
  
  return 'Cache फ्रेश झाली. App reload करा.';
}

function repairDistrictBusStationSheet() {
  var ss = _ss();
  var sh = ss.getSheetByName('DistrictBusStation');
  if (!sh) { Logger.log('Sheet not found'); return; }
  
  var data = sh.getDataRange().getValues();
  var cleaned = [data[0]];  // keep header
  
  for (var i = 1; i < data.length; i++) {
    var d = String(data[i][0] || '').trim();
    var s = String(data[i][1] || '').trim();
    if (d && s) {  // only keep valid rows
      cleaned.push([d, s]);
    }
  }
  
  // Clear & rewrite
  sh.clear();
  if (cleaned.length > 0) {
    sh.getRange(1, 1, cleaned.length, 2).setValues(cleaned);
  }
  
  clearAllCaches();
  Logger.log('✅ Repaired: ' + (cleaned.length - 1) + ' valid rows');
}

function debugResumeSession(sessionId) {
  try {
    var result = resumeSession(sessionId, Session.getActiveUser().getEmail().split('@')[0]);
    var parsed = JSON.parse(result);
    
    var msg = '📋 RESUME SESSION DEBUG\n\n' +
      'Session ID: ' + parsed.sessionId + '\n' +
      'Mode: ' + parsed.mode + '\n' +
      'Status: ' + parsed.resume + '\n\n' +
      'Completed: ' + (parsed.completedShifts ? parsed.completedShifts.length : 0) + '\n' +
      'Total Units: ' + parsed.totalUnits + '\n' +
      'Pending: ' + parsed.pendingCount + '\n' +
      'Next Shift: ' + parsed.nextShiftName + '\n' +
      'Already Complete: ' + parsed.alreadyComplete + '\n\n';
    
    if (parsed.completedShifts && parsed.completedShifts.length) {
      msg += 'Completed Shifts:\n';
      parsed.completedShifts.forEach(function(s) {
        msg += '  ✅ ' + s.shiftName + '\n';
      });
    }
    
    Logger.log(msg);
    SpreadsheetApp.getUi().alert(msg.slice(0, 1800));
    return parsed;
  } catch (e) {
    Logger.log('debugResumeSession: ' + e);
  }
}

function diagnosticPausedSessions() {
  try {
    var sh = getSessionsSheet();
    var c = _headerMap(sh);
    if (sh.getLastRow() < 2) { Logger.log('No sessions'); return; }
    
    var statuses = _colValues(sh, 'Status');
    var doneShifts = _colValues(sh, 'Completed Shifts');
    
    var stats = { completed: 0, inProcess: 0, paused: 0, emptyPaused: 0 };
    for (var i = 0; i < statuses.length; i++) {
      var s = String(statuses[i] || '').trim();
      var d = parseInt(doneShifts[i] || 0, 10) || 0;
      if (s === STATUS.COMPLETED) stats.completed++;
      else if (s === STATUS.IN_PROCESS) stats.inProcess++;
      else if (s === STATUS.PAUSED) {
        stats.paused++;
        if (d === 0) stats.emptyPaused++;
      }
    }
    
    var msg = '📊 SESSION STATUS REPORT\n\n' +
      '✅ Completed: ' + stats.completed + '\n' +
      '⏳ In Process: ' + stats.inProcess + '\n' +
      '⏸️ Paused: ' + stats.paused + '\n' +
      '  └─ Empty: ' + stats.emptyPaused + '\n\n' +
      'Total: ' + (stats.completed + stats.inProcess + stats.paused);
    
    SpreadsheetApp.getUi().alert(msg);
    Logger.log(msg);
  } catch (e) { Logger.log('diagnosticPausedSessions: ' + e); }
}

/* =====================================================================
   COMPATIBILITY ADAPTER LAYER — added because Index.html's google.script.run
   calls use an older naming convention than this Code.gs's current function
   names (Code.gs was refactored as part of the "consolidated JSON store"
   work — submitAllShifts → submitFullChecklist, saveBusEntry → saveBus,
   getMyReports → getSupervisorReports, generateSessionPdf →
   regeneratePDFForSession, getSessionDetail → getReportFullDetail,
   finalizeBusSession → finalizeInspection, updateUnitAnswers → editShift /
   editBus split by mode). Without this layer every one of these client
   actions throws "TypeError: ... is not a function" — including the main
   checklist submit button.

   These wrappers are 100% additive: they call the real, already-tested
   functions above unchanged and do not alter any existing behavior. This
   keeps the fix low-risk for a live production system — delete this whole
   block later if Index.html is ever updated to call the current names
   directly instead.
   ===================================================================== */

/* submitAllShifts(payload) → submitFullChecklist(payload)
   Index.html sends { sessionId?, tokenId?, dist, stn, name, id, date,
   checklistKey, shifts:[...] } and reads back r.ok / r.tokenId / r.pdfUrl /
   r.alreadyCompleted — all present on submitFullChecklist's response. */
function submitAllShifts(payload) {
  return submitFullChecklist(payload);
}

/* saveBusEntry(payload) → saveBus(payload). Same payload and response shape. */
function saveBusEntry(payload) {
  return saveBus(payload);
}

/* getMyReports(empId, filterDate) → getSupervisorReports(empId, filterDate).
   Identical positional signature, called as gRun('getMyReports', cb, errCb,
   G.emp.id, dateVal). */
function getMyReports(empId, filterDate) {
  return getSupervisorReports(empId, filterDate);
}

/* generateSessionPdf(sessionId, requestingEmpId) → regeneratePDFForSession(...).
   Identical positional signature and { ok, pdfUrl } response shape. */
function generateSessionPdf(sessionId, requestingEmpId) {
  return regeneratePDFForSession(sessionId, requestingEmpId);
}

/* getSessionDetail(sessionId, requestingEmpId) → getReportFullDetail(...).
   Identical positional signature and { ok, checklistKey, units } response. */
function getSessionDetail(sessionId, requestingEmpId) {
  return getReportFullDetail(sessionId, requestingEmpId);
}

/* finalizeBusSession(payload) → finalizeInspection(payload).
   Index.html's payload omits completedBuses, but finalizeInspection /
   generateCombinedPDF already fall back to loadPreviousBuses(sessionId)
   when _dataReady isn't set, so the buses saved earlier via saveBusEntry
   are still picked up correctly for the PDF. */
function finalizeBusSession(payload) {
  return finalizeInspection(payload);
}

/* updateUnitAnswers(payload) → editShift(...) / editBus(...), chosen by mode.
   Index.html sends { sessionId, unitName, mode, answers, remarks } — a
   single endpoint covering both shift-like units (shift/week/single, where
   editShift expects "shiftName") and bus units (where editBus expects
   "busNumber"). This adapter renames the field based on payload.mode so
   the underlying functions receive exactly what they already expect. */
function updateUnitAnswers(payload) {
  if (!payload) return JSON.stringify({ ok: false, msg: 'अपूर्ण डेटा (कोड: payload).' });
  // DIAGNOSTIC LOGGING (per request): unitName is the one field this adapter
  // itself depends on but never validated — if the client's G.editUnitName
  // was ever null/empty when this fires, it would silently become a missing
  // shiftName/busNumber below and surface as "अपूर्ण डेटा" even though the
  // user fully answered every question. Logging it here catches that case
  // at its actual origin instead of one level down.
  if (!payload.unitName) {
    Logger.log('[updateUnitAnswers] unitName missing/empty — mode=' + payload.mode +
               ' sessionId=' + payload.sessionId + ' id=' + payload.id +
               ' fullPayloadKeys=' + JSON.stringify(Object.keys(payload)));
  }
  if (payload.mode === 'bus') {
    payload.busNumber = payload.unitName;
    if (payload.originalUnitName && payload.originalUnitName !== payload.unitName) {
      payload.originalBusNumber = payload.originalUnitName;
    }
    return editBus(payload);
  }
  payload.shiftName = payload.unitName;
  return editShift(payload);
}



/* searchReports(token, bus, type, date, empId) → searchPastInspections(filters).
   Index.html's doSearch() calls this with 4 positional args (token, bus,
   type, date) and — in the file as originally written — does NOT send the
   employee ID, even though searchPastInspections requires filters.employeeId
   for both security (scoping results to the caller) and performance (the
   TextFinder lookup is keyed on Employee ID). A 5th argument (empId) has
   been added to this adapter; the matching one-line addition on the
   Index.html side (passing G.emp.id as that 5th gRun argument) is called
   out separately wherever Index.html is delivered alongside this file. */
function searchReports(token, bus, type, date, empId) {
  var filters = { employeeId: empId || '' };
  if (token) filters.token = token;
  if (bus)   filters.busNumber = bus;
  if (type)  filters.checklistKey = type;
  if (date)  filters.date = date;
  return searchPastInspections(filters);
}