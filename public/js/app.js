
/* === CHECKLIST DEFINITIONS (client-side) === */

var CHECKLIST_META_CLIENT = {
  bs:   { freq:'daily',   mode:'shift', label:'बसस्थानक स्वच्छता दैनंदिन तपासणी',   unitTotal:6 },
  bw:   { freq:'daily',   mode:'bus',   label:'बसेस स्वच्छता दैनंदिन तपासणी',        unitTotal:0 },
  gh:   { freq:'daily',   mode:'shift', label:'विश्रांतीगृह स्वच्छता दैनंदिन तपासणी', unitTotal:6 },
  wr:   { freq:'daily',   mode:'shift', label:'प्रसाधनगृह स्वच्छता दैनंदिन तपासणी',  unitTotal:6 },
  es:   { freq:'weekly',  mode:'week',  label:'बसस्थानक स्वच्छता-आठवड्यातून एकदा करावयाची स्वच्छता तपासणी',  unitTotal:4 },
  gh_w: { freq:'weekly',  mode:'week',  label:'चालक वाहक विश्रांतीगृह स्वच्छता व सोयीसुविधा -आठवड्यातून एकदा तपासणी', unitTotal:4 },
  bm:   { freq:'monthly', mode:'bus',   label:'बसेस स्वच्छता-महिन्यातून एकदा करावयाची स्वच्छता तपासणी',          unitTotal:0 },
  sm:   { freq:'monthly', mode:'single',label:'बसस्थानक स्वच्छता- महिन्यातून एकदा करावयाची स्वच्छता तपासणी',     unitTotal:1 }
};

var CHECKLIST_BY_FREQ = {
  daily:   ['bs','bw','gh','wr'],
  weekly:  ['es','gh_w'],
  monthly: ['bm','sm']
};

var SHIFTS = [
  'पहिली पाळी(Shift)','दुसरी पाळी(Shift)','तिसरी पाळी(Shift)',
  'चौथी पाळी(Shift)', 'पाचवी पाळी(Shift)', 'सहावी पाळी(Shift)'
];

var WEEKS = ['पहिला आठवडा','दुसरा आठवडा','तिसरा आठवडा','चौथा आठवडा'];

var FALLBACK_Q = {
  bs:['बसस्थानक झाडणे, पुसणे','वाहतूक नियंत्रक कक्ष, बसस्थानक प्रमुख कक्ष व इतर कक्ष स्वच्छता','फलाट स्वच्छता','मोकळी जागेची स्वच्छता','मजला (झाडलोट)','मजला (मॉपिंग)','उभे पृष्ठभाग (भिंती)','काचेचे भाग','दरवाजे व संलग्न फिटिंग्ज','खिडक्या व संलग्न फिटिंग्ज आणि फ्रेम','रेलिंग','आरसे','ग्रील्स','खांब','कॉरिडॉर / मार्गिका','जिना','कचरापेटी स्वच्छता','कचऱ्याची विल्हेवाट'],
  bw:['बस झाडने व धुणे (आतील व बाहेरील संपूर्ण बाजू)','आसनांची स्वच्छता','बसेसच्या खिडक्याच्या काचा पुसणे','दरवाजे व संलग्न फिटिंग्ज','बसवरील अनधीकृत स्टिकर पोस्टर काढणे','चालक केबिन स्वच्छता','सामान कप्प्याची स्वच्छता','समोरील बाजू मोठी काच व आरसे','कचरा उचलणे / कचरापेटी रिकामी करणे'],
  gh:['विश्रांतीगृह झाडणे, पुसणे','विश्रांतीगृहातील स्वच्छतागृहाची स्वच्छता','शौचालय, स्नानगृह व मुतारी यांची स्वच्छता','कचरापेटी स्वच्छता','कचऱ्याची विल्हेवाट','विश्रांतीगृहामध्ये गरम पाणी उपलब्ध आहे/नाही','विश्रांतीगृहामध्ये पिण्याचे पाणी उपलब्ध आहे/नाही'],
  wr:['शौचालय, स्नानगृह व मुतारी यांची स्वच्छता','वॉश बेसिन','मजला (झाडलोट)','मजला (मॉपिंग)','उभे पृष्ठभाग (भिंती)','काचेचे भाग','दरवाजे व संलग्न फिटिंग्ज','खिडक्या व संलग्न फिटिंग्ज आणि फ्रेम','रेलिंग','आरसे','ग्रील्स','कचरापेट्या स्वच्छता','कचऱ्याची विल्हेवाट'],
  es:['छताचे जाळे काढणे','टेबल, खुर्च्या, लाईट, संगणक व इतर साहित्य यांची स्वच्छता','बसस्थानकावरील कुंड्या, पाणपोई यांची स्वच्छता','बसस्थानकावरील अनधिकृत स्टिकर्स व पोस्टर्स काढणे','दरवाजे, खिडक्या व फ्रेम्स स्वच्छ करणे','जाळे काढणे व भिंती स्वच्छ करणे','कार्पेट, फर्निचर व फिटिंग्स (दिवे, पंखे इ.) स्वच्छ करणे','कंट्रोल रूम, लिफ्ट, अग्निशमन उपकरणे, सीसीटीव्ही सिस्टम स्वच्छ करणे','अनधिकृत पोस्टर्स व स्टिकर्स काढून टाकणे'],
  gh_w:['विश्रांतीगृहाची सखोल स्वच्छता','विश्रांतीगृहातील शौचालय व स्नानगृह यांची सखोल स्वच्छता','गिझर व वॉटर प्युरिफायर देखभाल','कीटकनाशक फवारणी (दोन आठवड्यातून एकदा)','कचरापेटी स्वच्छता व कचऱ्याची विल्हेवाट'],
  bm:['बस धुणे (आतील व बाहेरील संपूर्ण बाजू, चालक केबिन) सखोल स्वच्छता','बसेसच्या चेसिस व छत यांची स्वच्छता','बसवरील अनधीकृत स्टिकर पोस्टर काढणे','बसमधील पडदे बदलून स्वच्छ केलेले पडदे लावणे','सामान कप्प्याची सखोल स्वच्छता','समोरील बाजू मोठी काच, आरसे व खिडक्यांच्या काचा वॉशिंग सोडा व शाम्पू वापरून सखोल स्वच्छता'],
  sm:['टेरेस व छतांची पाण्याने स्वच्छता करणे','सर्व उपकरणांची स्वच्छता करणे','टेलिफोन, संगणक, फर्निचर, साईनबोर्ड, स्विच बोर्ड, एसी इ. स्वच्छ करणे','धूळ साफ करणे / ओला पोछा / व्हॅक्यूम क्लीनिंग करणे','सर्व लाईटिंग व इलेक्ट्रिकल फिटिंग्स स्वच्छ करणे','नाल्यांची स्वच्छता व देखभाल करणे','कचरापेटी स्वच्छता व कचऱ्याची विल्हेवाट']
};

/* === GLOBALS === */
var G = {
  sessionId:null, tokenId:null, checklistKey:null,
  freq:null, mode:null,
  unitIdx:0, doneUnits:[], doneBuses:[],
  remarks:{}, pendingQ:null, pendingIdx:null,
  shiftCount:0,                          // VAR-SHIFTS: shifts today (2-6); 0 = not chosen
  empOk:false, emp:null, employees:[], districtMap:{}, questions:{},
  DRAFT_KEY:'msrtc_v16_draft', empStatus:null,
  editMode:false, editUnitName:null,     // EDIT: when true, saves UPDATE instead of create
  _resumeLocked:false,                   // RESUME: when true, checklist is locked (read-only)
  _doneCount:{}                          // PERF: per-shift answered-count cache (avoids
                                          // rescanning every question card on every tap —
                                          // see _updateShiftStat / pickAns / cancelRemark)
};

var _saveTimer = null;
var _magilGenerating = {};
var _earlyBoot = null;

/* === single-tap guard + button lock utilities (low-end Android) === */
var _btnCooldown = {};
function _guardBtn(key, ms) {
  var now = Date.now();
  if (_btnCooldown[key] && (now - _btnCooldown[key]) < (ms || 1500)) return false;
  _btnCooldown[key] = now;
  return true;
}
function _lockBtn(id, loadingText) {
  var btn = document.getElementById(id); if (!btn) return;
  btn.disabled = true; btn._origText = btn.textContent;
  if (loadingText) btn.textContent = loadingText;
}
function _unlockBtn(id) {
  var btn = document.getElementById(id); if (!btn) return;
  btn.disabled = false; if (btn._origText) btn.textContent = btn._origText;
}

/* === INIT === */
document.addEventListener('DOMContentLoaded', function () {
  G.empStatus = document.getElementById('empStatus');
  var _todayVal = istDate();
  var _dateEl = document.getElementById('date');
  _dateEl.value = _todayVal;
  _dateEl.max   = _todayVal;   // no future dates
  document.getElementById('date').max = istDate();   // allow any PAST date, block future

  window.addEventListener('offline', function () { document.getElementById('offlineBanner').classList.add('show'); });
  window.addEventListener('online',  function () { document.getElementById('offlineBanner').classList.remove('show'); _obFailStreak=0; _obKick(300); });
  if (!navigator.onLine) document.getElementById('offlineBanner').classList.add('show');

  document.getElementById('remarkInp').addEventListener('input', function () {
    document.getElementById('remarkCnt').textContent = this.value.length;
  });

G.questions = FALLBACK_Q;

  // Helper: does a boot payload actually contain districts?
  function _bootHasDistricts(str){
    try { var b = (typeof str==='string') ? JSON.parse(str) : str; return !!(b && b.districts && Object.keys(b.districts).length); }
    catch(e){ return false; }
  }
  // Background refresh: store ONLY a good payload, and (re)paint the dropdown
  // if the screen is currently empty.
  function _bgRefreshBoot(){
    gRun('getBootData', function(res){
      if (_bootHasDistricts(res)){
        try { localStorage.setItem('msrtc_boot_v1', res); } catch(e){}
        var distEl = document.getElementById('dist');
        if (distEl && distEl.options.length <= 1) handleBootData(res);   // fill if empty
      } else {
        try { localStorage.removeItem('msrtc_boot_v1'); } catch(e){}     // purge bad cache
      }
    }, function(){ _hideSplash(); }, null);
  }

  // FAST BOOT: paint from cache instantly ONLY if it has districts.
  var _cachedBoot = null;
  try { _cachedBoot = JSON.parse(localStorage.getItem('msrtc_boot_v1') || 'null'); } catch(e){}

  if (_cachedBoot && _cachedBoot.districts && Object.keys(_cachedBoot.districts).length) {
    handleBootData(JSON.stringify(_cachedBoot));      // instant paint
    _bgRefreshBoot();                                 // refresh + re-fill if needed
  } else {
    // No usable cache → purge anything stale and fetch fresh from the server.
    try { localStorage.removeItem('msrtc_boot_v1'); } catch(e){}
    if (_earlyBoot && _earlyBoot !== 'failed' && _bootHasDistricts(_earlyBoot)) {
      handleBootData(_earlyBoot);
      try { localStorage.setItem('msrtc_boot_v1', _earlyBoot); } catch(e){}
      _bgRefreshBoot();
    } else {
      gRun('getBootData', function(res){
        handleBootData(res);
        if (_bootHasDistricts(res)) { try { localStorage.setItem('msrtc_boot_v1', res); } catch(e){} }
      }, function(e){
        _hideSplash();
        _showBootDiag('❌ सर्व्हरशी संपर्क झाला नाही.',
          'Error: '+(e&&e.message?e.message:String(e))+'  |  Deployment URL / access तपासा.');
      }, null);
    }
  }

  // HARD SAFETY NET: whatever happens with boot/network, the splash is gone
  // within 7s so the app is always usable.
// HARD SAFETY NET: whatever happens with boot/network, the splash is gone
  // within 7s so the app is always usable.
  setTimeout(_hideSplash, 7000);

  // Login screen removed — identity is established directly on the home
  // form via lookupEmpName() (ID-only, no password), same as before.

  setTimeout(checkResume, 900);
  // v17.3: resume any background saves left from a previous session/reload.
  setTimeout(function(){ _obChip(); _obKick(1200); }, 1000);

  // REQ-06: browser/hardware BACK button handling. Seed an initial history
  // entry, then intercept back: if we're on Page 2, go back to Page 1 WITHOUT
  // losing state or re-authenticating; if on Page 1, keep the user in the app.
  try {
    history.replaceState({ page: 1 }, '');
    window.addEventListener('popstate', function (ev) {
      var onPage2 = document.getElementById('page2').classList.contains('active');
      if (onPage2) {
        goBack();                       // preserves all G state
      } else {
        history.pushState({ page: 1 }, '');
      }
    });
  } catch (e) {}
});

/* === BOOT DATA HANDLER === */
function _fmtDiag(d){
  if(!d) return 'No diagnostics. बहुधा deployment/नेटवर्क समस्या — URL व access तपासा.';
  if(d.error) return '🛑 '+d.error;
  var lines=[];
  lines.push('Spreadsheet जोडलेले: '+(d.spreadsheetBound?'हो ✓':'नाही ✗'));
  lines.push('DistrictBusStation शीट: '+(d.hasDistrictSheet?('हो ✓ ('+d.districtRows+' ओळी)'):'सापडली नाही ✗'));
  if(d.sample) lines.push('नमुना: '+d.sample);
  if(d.sheets&&d.sheets.length) lines.push('उपलब्ध शीट्स: '+d.sheets.join(', '));
  if(!d.hasDistrictSheet) lines.push('▶ शीटचे नाव नक्की "DistrictBusStation" असावे (कॉलम A=जिल्हा, B=स्थानक).');
  else if(d.districtRows<2) lines.push('▶ शीटमध्ये डेटा ओळी नाहीत — कॉलम A/B मध्ये जिल्हा व स्थानक भरा.');
  return lines.join('\n');
}

function _showBootDiag(msg, raw){
  var box=document.getElementById('bootDiag');
  if(!box) return;
  box.classList.remove('hidden');
  document.getElementById('bootDiagMsg').textContent=msg||'जिल्हे लोड झाले नाहीत.';
  document.getElementById('bootDiagRaw').textContent=raw||'';
}

/* Manual, cache-busting reload of the district data. Shows exactly what the
   server returns so the cause is visible on screen (no log digging). */
function reloadBootData(){
  try { localStorage.removeItem('msrtc_boot_v1'); } catch(e){}
  _showBootDiag('🔄 सर्व्हरकडून पुन्हा डेटा घेत आहे…','');
  gRun('getBootData', function(res){
    var ok=false, n=0;
    try { var b=JSON.parse(res); n=b&&b.districts?Object.keys(b.districts).length:0; ok=n>0; } catch(e){}
    if (ok){
      handleBootData(res);
      try { localStorage.setItem('msrtc_boot_v1', res); } catch(e){}
      var bd=document.getElementById('bootDiag'); if(bd) bd.classList.add('hidden');
      toast('✅ '+n+' जिल्हे लोड झाले.','success',3000);
    } else {
      var diag=null; try{ diag=JSON.parse(res)._diag; }catch(e){}
      _showBootDiag('⚠️ सर्व्हरकडून एकही जिल्हा आला नाही.', _fmtDiag(diag));
    }
  }, function(e){
    _showBootDiag('❌ सर्व्हरशी संपर्क झाला नाही (deployment/नेटवर्क).',
      'Error: '+(e&&e.message?e.message:String(e))+'  |  URL तपासा.');
  }, null);
}

function _hideSplash() {
  var splash = document.getElementById('splash');
  if (splash) { splash.style.opacity = '0'; setTimeout(function(){ if(splash&&splash.remove) splash.remove(); }, 400); }
}

function handleBootData(resStr) {
  var boot;
  try { boot = JSON.parse(resStr); } catch(e) { boot = null; }
  if (!boot) {
    // CRITICAL: hide the splash even when boot fails, otherwise the app is
    // stuck on the loading screen forever. The form still works once the
    // user picks a district (data refreshes on next successful boot call).
    _hideSplash();
    toast('डेटा लोड अयशस्वी — रिफ्रेश करा किंवा नेटवर्क तपासा.', 'error', 6000);
    return;
  }
  G.districtMap = boot.districts || {};
  G.employees   = boot.employees || [];
  if (boot.questions) G.questions = boot.questions;

  // Populate district dropdown
  var el = document.getElementById('dist');
  el.innerHTML = '<option value="">— जिल्हा निवडा —</option>';
  Object.keys(G.districtMap).sort().forEach(function(k) {
    el.add(new Option(k, k));
  });
  if (!Object.keys(G.districtMap).length) {
    try { localStorage.removeItem('msrtc_boot_v1'); } catch(e){}   // don't keep a blank cache
    _showBootDiag('⚠️ सर्व्हरकडून एकही जिल्हा आला नाही.', _fmtDiag(boot._diag));
  } else {
    var bd0=document.getElementById('bootDiag'); if(bd0) bd0.classList.add('hidden');
  }

  // Hide splash screen
  _hideSplash();
}

/* ID-ONLY identity: look up the supervisor name from the typed Employee ID. */
function lookupEmpName(id){
  id=String(id||'').trim();
  var show=document.getElementById('empNameShow');
  var nm=document.getElementById('name');
  if(show) show.textContent='';
  if(!id){ G.empOk=false; G.emp=null; if(nm) nm.value=''; if(typeof updateEmpStatus==='function')updateEmpStatus(); return; }
  if(!/^\d+$/.test(id)){ return; }
  // Remember which ID this lookup is for, so a stale async response can't
  // overwrite a newer one.
  G._pendingIdLookup = id;
  gRun('lookupSupervisorName', function(resStr){
    var r; try{r=JSON.parse(resStr);}catch(e){return;}
    if(G._pendingIdLookup && G._pendingIdLookup !== id) return;   // a newer ID was typed
    if(r&&r.ok){
      if(nm) nm.value=r.name;            // AUTO-FILL the name from the ID (editable after)
      G.empOk=true; G.emp={id:r.id,name:r.name};
      document.getElementById('empid').classList.add('ok');
      document.getElementById('empid').classList.remove('err');
    } else {
      G.empOk=false; G.emp=null;
      if(nm) nm.value='';
      if(show){ show.textContent='❌ हा आयडी नोंदणीकृत नाही'; show.style.color='var(--err)'; }
      document.getElementById('empid').classList.add('err');
      document.getElementById('empid').classList.remove('ok');
    }
    if(typeof updateEmpStatus==='function') updateEmpStatus();
  }, function(){ if(show){show.textContent='नेटवर्क त्रुटी — पुन्हा';show.style.color='var(--err)';} }, id);
}
/* === SERVER RUNNER via fetch (works from any static hosting) =========
   FIX: 30s timeout via AbortController so a hung request fails fast and
   retries instead of leaving the spinner forever; busy-retry backoff
   trimmed (400/800ms). Same calling contract as before.               */
var APPS_SCRIPT_URL = '/exec';   // the .../exec web-app URL

 // set just before a gRun call to extend ITS timeout
function gRun(fn, onSuccess, onFail) {
  var args = Array.prototype.slice.call(arguments, 3);
  _gRunTimeoutOverride = 0;

  if (typeof google !== 'undefined' && google.script && google.script.run) {
    var MAX_BUSY_RETRY = 2;
    var nativeAttempt = function (tryNo) {
      try {
        var _settled = false;
        // TIMEOUT: if Apps Script doesn't respond in 27s, treat as network failure
        // so the outbox can queue it for retry instead of spinning forever.
        // 27s (not 20s) because Apps Script cold-starts can legitimately take 25s.
        var _timer = setTimeout(function () {
          if (!_settled) {
            _settled = true;
            if (typeof onFail === 'function') onFail(new Error('timeout'));
            else toast('जतन होत आहे — कृपया प्रतीक्षा करा.', 'warn', 5000);
          }
        }, 27000);

        var runner = google.script.run
          .withSuccessHandler(function (res) {
            if (_settled) return;
            clearTimeout(_timer);
            var parsed = null;
            try { parsed = (typeof res === 'string' && res.charAt(0) === '{') ? JSON.parse(res) : null; } catch (e) {}
            if (parsed && parsed.busy && tryNo < MAX_BUSY_RETRY) {
              setTimeout(function () { nativeAttempt(tryNo + 1); }, 500 * (tryNo + 1));
              return;
            }
            _settled = true;
            if (typeof onSuccess === 'function') onSuccess(res);
          })
          .withFailureHandler(function (err) {
            if (_settled) return;
            clearTimeout(_timer); _settled = true;
            if (typeof onFail === 'function') onFail(err);
            else toast('सर्व्हर त्रुटी — पुन्हा प्रयत्न करा.', 'error');
          });
        runner[fn].apply(runner, args);
      } catch (e) {
        _gRunFetchFallback(fn, args, onSuccess, onFail);
      }
    };
    nativeAttempt(0);
    return;
  }

  _gRunFetchFallback(fn, args, onSuccess, onFail);
}

/* FALLBACK PATH: external static hosting (no google.script.run bridge
   available) → POST to the /exec URL. Factored out of gRun() so the
   native path above can fall through to it on a bridge exception too,
   instead of duplicating this logic. */
function _gRunFetchFallback(fn, args, onSuccess, onFail) {
  var MAX_RETRY = 2;
  var timeoutMs = 30000;
  function attempt(tryNo) {
    var ctrl = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, timeoutMs) : null;
    fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      // text/plain avoids a CORS preflight Apps Script can't answer
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ fn: fn, args: args }),
      signal: ctrl ? ctrl.signal : undefined
    })
    .then(function(r){ if (timer) clearTimeout(timer); return r.text(); })
    .then(function(res){
      try {
        var parsed = (typeof res === 'string' && res.charAt(0) === '{') ? JSON.parse(res) : null;
        if (parsed && parsed.busy && tryNo < MAX_RETRY) {
          setTimeout(function(){ attempt(tryNo+1); }, 400*(tryNo+1)); return;
        }
      } catch(e){}
      if (typeof onSuccess === 'function') onSuccess(res);
    })
    .catch(function(e){
      if (timer) clearTimeout(timer);
      if (tryNo < MAX_RETRY) { setTimeout(function(){ attempt(tryNo+1); }, 600*(tryNo+1)); return; }
      console.error(fn + ' failed:', e);
      if (typeof onFail === 'function') onFail(e);
      else toast('नेटवर्क धीमे आहे. कृपया पुन्हा प्रयत्न करा.', 'error');
    });
  }
  attempt(0);
}

function _genSessionId(){
  return 'SES-' + Date.now() + '-' + Math.random().toString(36).slice(2,8);
}
function _genTokenId(dist, stn){
  function code(s,n){ return (String(s||'').toUpperCase().replace(/[^A-Z0-9]/g,'')+'XXXX').slice(0,n); }
  var t = new Date(); var hh = ('0'+t.getHours()).slice(-2)+('0'+t.getMinutes()).slice(-2)+('0'+t.getSeconds()).slice(-2);
  return 'MSRTC-'+code(dist,3)+'-'+code(stn,4)+'-'+hh+Math.floor(Math.random()*100);
}


/* === DRAFT === */
function buildDraft() {
  return {
    sessionId:G.sessionId, tokenId:G.tokenId,
    dist:document.getElementById('dist').value,
    stn:document.getElementById('stn').value,
    name:document.getElementById('name').value,
    id:document.getElementById('empid').value,
    date:document.getElementById('date').value,
    checklistKey:G.checklistKey, freq:G.freq, mode:G.mode,
    shiftCount:G.shiftCount,
    unitIdx:G.unitIdx, doneUnits:G.doneUnits, doneBuses:G.doneBuses,
    empOk:G.empOk, emp:G.emp, ts:Date.now()
  };
}
function saveDraftLocal() { try { localStorage.setItem(G.DRAFT_KEY, JSON.stringify(buildDraft())); } catch(e){} }
function loadDraftLocal() { try { var r=localStorage.getItem(G.DRAFT_KEY); return r?JSON.parse(r):null; } catch(e){return null;} }
function clearDraftLocal() { try { localStorage.removeItem(G.DRAFT_KEY); } catch(e){} }
function scheduleSave() {
  // SPEED: local-only. The old version ALSO posted a server saveDraft ~3s
  // after every answered question — a stream of background requests that
  // competed with the real saveShift for Apps Script's per-user execution
  // slots (the #1 cause of the long "माहिती जतन होत आहे…" wait). The server
  // never reads Draft_Sessions; localStorage fully covers resume.
  clearTimeout(_saveTimer);
  _saveTimer = setTimeout(saveDraftLocal, 1000);
}

/* === RESUME === */
function checkResume() {
  var d = loadDraftLocal();
  if (!d || !d.sessionId) return;
  var info = '';
  if (d.dist)  info += '📍 ' + d.dist + ' — ' + (d.stn||'') + '\n';
  if (d.name)  info += '👤 ' + d.name + '\n';
  if (d.tokenId) info += '🎫 ' + d.tokenId + '\n';
  var meta = CHECKLIST_META_CLIENT[d.checklistKey] || {};
  if (meta.mode === 'bus') {
    info += '🚌 ' + (d.doneBuses||[]).length + ' बस पूर्ण';
  } else if (d.checklistKey) {
    var done = (d.doneUnits||[]).length;
    var tot  = d.shiftCount || meta.unitTotal || 6;
    info += '⏱ ' + done + '/' + tot + ' युनिट पूर्ण';
  }
  document.getElementById('resumeInfo').textContent = info;
  document.getElementById('resumeDlg').classList.add('show');
}

function resumeSession() {
  hideDlg('resumeDlg');
  var d = loadDraftLocal();
  if (!d) return;
  G.sessionId=d.sessionId; G.tokenId=d.tokenId; G.checklistKey=d.checklistKey;
  G.freq=d.freq; G.mode=d.mode;
  G.unitIdx=d.unitIdx||0; G.doneUnits=d.doneUnits||[]; G.doneBuses=d.doneBuses||[];
  G.shiftCount=d.shiftCount||0;
  G.empOk=d.empOk||false; G.emp=d.emp||null;

  // Returning user with a valid session — lock the identity fields exactly
  // as a fresh ID lookup would, so they aren't accidentally edited mid-session.
  if (G.empOk && G.emp && G.emp.id){
    var idf=document.getElementById('empid'), nmf=document.getElementById('name');
    if(idf){ idf.readOnly=true; idf.classList.add('ok'); }
    if(nmf){ nmf.readOnly=true; nmf.classList.add('ok'); }
  }

  function restoreFields() {
    if (G.districtMap[d.dist]) {
      document.getElementById('dist').value = d.dist;
      loadStations();
      setTimeout(function(){document.getElementById('stn').value=d.stn||'';},80);
    }
    document.getElementById('name').value  = d.name||'';
    document.getElementById('empid').value = d.id||'';
    document.getElementById('date').value  = d.date||istDate();
    if (G.empOk && G.emp) updateEmpStatus();
  }
  if (Object.keys(G.districtMap).length) { restoreFields(); } else { setTimeout(restoreFields,1200); }

  switchPage(2);
  setTimeout(function(){
    if (d.freq) setFreq(d.freq, true);
    setTimeout(function(){
      document.getElementById('ctype').value = d.checklistKey||'';
      if (d.shiftCount) _setShiftCount(d.shiftCount, !!d.sessionId);
      onChecklistChange(true);
      toast('मागील सत्र पुनर्स्थापित केले.','info',3000);
    },150);
  },200);
}

function startNewSession() { hideDlg('resumeDlg'); clearDraftLocal(); }

/* === FREQUENCY SELECTOR === */
function setFreq(freq, skipReset) {
  G.freq = freq;
  ['daily','weekly','monthly'].forEach(function(f){
    document.getElementById('fp' + f.charAt(0).toUpperCase() + f.slice(1)).classList.toggle('sel', f===freq);
  });
  var sel   = document.getElementById('ctype');
  var keys  = CHECKLIST_BY_FREQ[freq] || [];
  sel.innerHTML = '<option value="">— चेकलिस्ट निवडा —</option>';
  keys.forEach(function(k){
    var meta = CHECKLIST_META_CLIENT[k];
    if (meta) sel.add(new Option(meta.label, k));
  });
  if (!skipReset) {
    sel.selectedIndex = 0;
    G.checklistKey = null;
    document.getElementById('shiftWrap').classList.add('hidden');
    document.getElementById('busWrap').classList.add('hidden');
    document.getElementById('infoBadge').classList.add('hidden');
    document.getElementById('qWrap').innerHTML='';
    document.getElementById('qWrap').classList.add('hidden');
  }
}

/* === EMPLOYEE AUTOCOMPLETE === */
var _empDeb = null;
function onEmpIdChange(val) {
  clearTimeout(_empDeb); G.empOk=false; G.emp=null; updateEmpStatus();
  _empDeb=setTimeout(function(){_doEmpIdSearch(val);},250);
}
function onNameChange(val) {
  clearTimeout(_empDeb); G.empOk=false; G.emp=null; updateEmpStatus();
  _empDeb=setTimeout(function(){_doNameSearch(val);},250);
}
function _doEmpIdSearch(val) {
  var v=val.trim(); var list=document.getElementById('empIdAc');
  if (!list) return;
  if (!v){list.style.display='none';return;}
  var matches=G.employees.filter(function(e){return e.id.indexOf(v)!==-1;});
  var exact=G.employees.filter(function(e){return e.id===v;});
  if (exact.length===1){document.getElementById('name').value=exact[0].name;selectEmp(exact[0]);list.style.display='none';return;}
  renderAcList(list,matches,'id',v);
}
function _doNameSearch(val) {
  var v=val.trim().toLowerCase(); var list=document.getElementById('empNameAc');
  if (!list) return;
  if (!v){list.style.display='none';return;}
  var matches=G.employees.filter(function(e){return e.name.toLowerCase().indexOf(v)!==-1;});
  var exact=G.employees.filter(function(e){return e.name===val.trim();});
  if (exact.length===1){document.getElementById('empid').value=exact[0].id;selectEmp(exact[0]);list.style.display='none';return;}
  renderAcList(list,matches,'name',val.trim());
}
function renderAcList(el,matches,mode,term) {
  el.innerHTML='';
  if (!matches.length){el.innerHTML='<div class="ac-empty">❌ "'+esc(term)+'" सापडले नाही</div>';el.style.display='block';return;}
  matches.slice(0,8).forEach(function(emp){
    var item=document.createElement('div'); item.className='ac-item';
    item.innerHTML=mode==='id'?'<strong>'+esc(emp.id)+'</strong> — '+esc(emp.name):'<strong>'+esc(emp.name)+'</strong> ('+esc(emp.id)+')';
    item.addEventListener('mousedown',function(e){e.preventDefault();});
    item.addEventListener('touchstart',function(e){e.preventDefault();selectEmp(emp);},{passive:false});
    item.addEventListener('click',function(){selectEmp(emp);});
    el.appendChild(item);
  });
  el.style.display='block';
}
function selectEmp(emp) {
  document.getElementById('empid').value=emp.id;
  document.getElementById('name').value=emp.name;
  hideAcLists(); G.empOk=true; G.emp=emp;
  updateEmpStatus(); loadStats();
  toast('✅ '+emp.name+' ('+emp.id+')','success',1800);
}
function showAcList(mode) {
  if (mode==='id') _doEmpIdSearch(document.getElementById('empid').value);
  else             _doNameSearch(document.getElementById('name').value);
}
function hideAcLists() {
  var a=document.getElementById('empIdAc');   if(a) a.style.display='none';
  var b=document.getElementById('empNameAc'); if(b) b.style.display='none';
}
function updateEmpStatus() {
  var idEl=document.getElementById('empid'); var nameEl=document.getElementById('name');
  var box=G.empStatus; var idV=idEl.value.trim(); var nameV=nameEl.value.trim();
  idEl.classList.remove('ok','err'); nameEl.classList.remove('ok','err');
  box.style.display='none'; box.className='status-box';
  if (G.empOk && G.emp) {
    idEl.classList.add('ok'); nameEl.classList.add('ok');
    box.className='status-box ok';
    box.innerHTML='✅ <strong>प्रमाणित:</strong> '+esc(G.emp.name)+' ('+esc(G.emp.id)+')';
    box.style.display='block';
    document.getElementById('statsCard').classList.remove('hidden');
  } else if (idV||nameV) {
    if (idV&&nameV){idEl.classList.add('err');nameEl.classList.add('err');box.className='status-box err';box.innerHTML='❌ <strong>अप्रमाणित!</strong> डेटाबेसमधून निवडा.';}
    else{box.className='status-box warn';box.innerHTML='⚠️ शोधा आणि डेटाबेसमधून कर्मचारी निवडा.';}
    box.style.display='block';
  }
}
function loadStats() {
  if (!G.emp) return;
  gRun('getEmployeeStats', function(resStr){
    try { var r=JSON.parse(resStr); if(r.ok){document.getElementById('stTotal').textContent=r.total||0;document.getElementById('stPdf').textContent=r.withPdf||0;} } catch(e){}
  }, null, G.emp.id);
}

/* Resume a specific incomplete session → jump to remaining units */
function resumeIntoSession(sessionId){
  if (!G.emp){toast('आधी कर्मचारी निवडा.','error');return;}
  if (!_guardBtn('resume_'+sessionId,3000)) return;
  var ms=document.getElementById('magilScr'); if(ms) ms.classList.remove('show');
  showLoad(true);
  gRun('resumeSession', function(resStr){
    showLoad(false);
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    if (!r.ok){ toast(r.msg||'सुरू करता आले नाही.','error',5000); return; }
        document.getElementById('dist').value=r.dist;
    loadStations();
    setTimeout(function(){ document.getElementById('stn').value=r.stn; }, 150);
    document.getElementById('empid').value=r.id;
    document.getElementById('name').value=r.name;
    
    // Lock date to original session date
    // FIX: G._originalSessionDate must be set FROM r.date BEFORE it's used
    // to populate the field — previously the field was set first, using
    // whatever stale value was left over from a prior resume/edit (or
    // undefined on first use), and only updated afterward, too late to
    // affect what was already shown.
    G._originalSessionDate = r.date || document.getElementById('date').value;
    var dateField = document.getElementById('date');
    dateField.value = G._originalSessionDate;
    dateField.readOnly = true;  // LOCK IT
    dateField.style.opacity = '0.7';
    dateField.style.cursor = 'not-allowed';
    G.sessionId=r.sessionId; G.tokenId=r.tokenId;
    G.checklistKey=r.checklistKey; G.mode=r.mode;
    G.doneUnits=r.completedShifts||[]; G.doneBuses=r.completedBuses||[];
    G.unitIdx=r.currentShiftIdx||0; G.remarks={};
    if (r.mode==='shift'){
      _setShiftCount(r.totalUnits||0, true);
      var scF=document.getElementById('shiftCountField'); if(scF) scF.classList.remove('hidden');
    } else {
      var scF2=document.getElementById('shiftCountField'); if(scF2) scF2.classList.add('hidden');
    }

    // RESUME FIX: ensure the dropdown actually contains this checklist's option
    // before we try to select it.
    var _meta = CHECKLIST_META_CLIENT[r.checklistKey];
    if (_meta && _meta.freq){
      var _wasLocked = G._resumeLocked; G._resumeLocked=false;
      setFreq(_meta.freq, true);              // skipReset=true: don't wipe state
      G._resumeLocked=_wasLocked;
    }
    var ct=document.getElementById('ctype');
    if (ct){
      for(var i=0;i<ct.options.length;i++){ if(ct.options[i].value===r.checklistKey){ct.selectedIndex=i;break;} }
    }
    // GUARANTEE state is set even if the server value was blank for an old row:
    if (!G.checklistKey && ct && ct.value) G.checklistKey = ct.value;

    // REQ-02/03: on the resume screen the checklist is SHOWN but LOCKED.
    var ff=document.getElementById('freqField');  if(ff) ff.classList.remove('hidden');
    var cf=document.getElementById('ctypeField'); if(cf) cf.classList.remove('hidden');
    if (ct){ ct.disabled=true; ct.style.opacity='0.7'; ct.style.cursor='not-allowed'; }
    G._resumeLocked = true;
    ['fpDaily','fpWeekly','fpMonthly'].forEach(function(id){
      var p=document.getElementById(id); if(p){ p.style.pointerEvents='none'; p.style.opacity='0.6'; }
    });

    document.getElementById('shiftWrap').classList.toggle('hidden', r.mode==='bus'||r.mode==='single');
    document.getElementById('busWrap').classList.toggle('hidden', r.mode!=='bus');
    switchPage(2);
    if (r.mode==='bus'){
      var b=document.getElementById('infoBadge');
      b.classList.remove('hidden'); b.textContent='✅ '+G.doneBuses.length+' बस पूर्ण | पुढील बस क्रमांक टाका.';
      document.getElementById('busNum').value=''; renderQ(r.checklistKey);
    } else {
      // One-screen resume: render all blocks, pre-fill the saved shifts, leave
      // the rest open. Supervisor completes remaining shifts and submits again.
      renderUnitTrack(); renderUnitInfo(); renderQ(r.checklistKey);
      _prefillSavedShifts(r.completedShifts || []);
      var doneN = (r.completedShifts || []).length;
      var totN  = r.totalUnits || getUnitsForKey(r.checklistKey).length;
      var sb=document.getElementById('infoBadge');
      if(sb){ sb.classList.remove('hidden');
        sb.innerHTML='🔄 <strong>अपूर्ण नोंद सुरू ठेवली</strong> — '+doneN+'/'+totN+
          ' पाळ्या आधीच भरल्या आहेत. उरलेल्या पाळ्या भरा व <strong>✔ पूर्ण करा</strong> दाबा.'; }
    }

     document.getElementById('dist').value=r.dist;
    loadStations();
    setTimeout(function(){ document.getElementById('stn').value=r.stn; }, 150);
    document.getElementById('empid').value=r.id;
    document.getElementById('name').value=r.name;
    // DO NOT change the date field - keep the original session's date
    document.getElementById('date').value = G._originalSessionDate;
    document.getElementById('submitBtn').disabled = false;
    document.getElementById('submitBtn').style.display = 'flex';
    
    saveDraftLocal();
    var rem = (r.mode==='bus') ? 'अधिक बस जोडा' : (Math.max(0,(r.totalUnits-G.unitIdx))+' युनिट शिल्लक');
    toast('🔄 सुरू ठेवले — '+rem,'info',5000);
  }, function(){showLoad(false);toast('नेटवर्क त्रुटी.','error');}, sessionId, G.emp.id);
}

/* DELETE: confirm + permanently remove a whole checklist (own records only). */
function confirmDeleteSession(sessionId, tokenId){
  if (!G.emp){toast('आधी कर्मचारी निवडा.','error');return;}
  if (!_guardBtn('del_'+sessionId,4000)) return;
  var sure = window.confirm('🗑 हा अहवाल कायमचा हटवायचा?\n\nटोकन: '+(tokenId||'')+'\n\nही क्रिया पूर्ववत करता येणार नाही. (This cannot be undone.)');
  if (!sure) return;
  showLoad(true);
  gRun('deleteSession', function(resStr){
    showLoad(false);
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    if (!r.ok){ toast(r.msg||'हटवता आले नाही.','error',5000); return; }
    toast(r.msg||'🗑 हटवले.','success',4000);
    // Remove the card immediately, then reload the current page so server-side
    // counts and paging stay correct in the full-history view.
    var card = document.querySelector('.magil-card-actions button[onclick*="'+sessionId+'"]');
    if (card){ var c = card.closest('.magil-card'); if (c) c.remove(); }
    loadMagilReports();
  }, function(){showLoad(false);toast('नेटवर्क त्रुटी.','error');}, sessionId, (G.emp&&G.emp.id)||'');
}

/* EDIT: load a submitted record, let the user pick which unit to correct. */
function editSession(sessionId){
  if (!G.emp){toast('आधी कर्मचारी निवडा.','error');return;}
  if (!_guardBtn('edit_'+sessionId,3000)) return;
  var ms=document.getElementById('magilScr'); if(ms) ms.classList.remove('show');
  showLoad(true);
  gRun('getSessionForEdit', function(resStr){
    showLoad(false);
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    if (!r.ok){ toast(r.msg||'संपादनासाठी उघडता आले नाही.','error',5000); return; }
    G._originalSessionDate = r.date || document.getElementById('date').value;
    // Enter edit mode and restore the record's identity DIRECTLY into state.
    G.editMode=true; G.editUnitName=null;
    G.sessionId=r.sessionId; G.tokenId=r.tokenId;
    G.checklistKey=r.checklistKey; G.mode=r.mode; G.remarks={};
    G.doneUnits=r.completedShifts||[]; G.doneBuses=r.completedBuses||[];
    G._editDist=r.dist; G._editStn=r.stn; G._editName=r.name; G._editId=r.id;
    G._editChecklistText=r.checklist||'';

    var units = (r.mode==='bus')
      ? (G.doneBuses||[]).map(function(b){return b.busNumber;})
      : (G.doneUnits||[]).map(function(s){return s.shiftName;});

    if (!units.length){ toast('संपादनासाठी नोंद नाही.','error'); G.editMode=false; return; }

    if (units.length===1){
      _loadUnitForEdit(0, r.mode==='bus'?'bus':'shift');
    } else {
      _showEditPicker(units, r.mode==='bus'?'bus':'shift');
    }
  }, function(){showLoad(false);toast('नेटवर्क त्रुटी.','error');}, sessionId, G.emp.id);
}

/* Build a simple chooser dialog listing the editable units. */
function _showEditPicker(names, kind){
  var ov=document.getElementById('editPickerDlg');
  if (!ov){
    ov=document.createElement('div'); ov.id='editPickerDlg'; ov.className='dlg-ov';
    ov.innerHTML='<div class="dlg-card"><div style="font-size:34px;text-align:center;margin-bottom:4px">✏️</div>'+
      '<h3 style="color:var(--navy);font-size:17px;font-weight:900;text-align:center;margin-bottom:4px">संपादित करायचे?</h3>'+
      '<p style="color:var(--txt-mid);font-size:12px;text-align:center;margin-bottom:12px">कोणती नोंद दुरुस्त करायची ते निवडा</p>'+
      '<div id="editPickerList" class="gap-col"></div>'+
      '<button onclick="hideDlg(\'editPickerDlg\');G.editMode=false;" class="btn btn-back" style="margin-top:12px;width:100%">रद्द करा</button></div>';
    document.body.appendChild(ov);
  }
  var list=document.getElementById('editPickerList'); list.innerHTML='';
  // FIX: for bus mode, track repeated bus numbers and add occurrence labels
  // ("MH-01-1234 (पुन्हा 2)") so supervisor can tell them apart. Pass array
  // index to _loadUnitForEdit so it picks the exact entry, not just the
  // first one with a matching name.
  var seenCount={};
  names.forEach(function(nm, idx){
    var b=document.createElement('button');
    b.className='btn btn-outline'; b.style.cssText='width:100%;justify-content:flex-start';
    var displayNm=nm;
    if (kind==='bus'){
      seenCount[nm]=(seenCount[nm]||0)+1;
      if (seenCount[nm]>1) displayNm=nm+' (पुन्हा '+seenCount[nm]+')';
    }
    b.textContent=(kind==='bus'?'🚌 ':'⏱ ')+displayNm;
    (function(i){ b.onclick=function(){ hideDlg('editPickerDlg'); _loadUnitForEdit(i, kind); }; })(idx);
    list.appendChild(b);
  });
  showDlg('editPickerDlg');
}

/* Load one unit's saved answers into the question form for editing. */
function _loadUnitForEdit(unitNameOrIdx, kind){
  // FIX: accept either an array index (from _showEditPicker for repeated buses)
  // or a plain name string (from the single-unit direct path).
  var src, unitName;
  if (typeof unitNameOrIdx === 'number'){
    // Index path — exact entry by position (handles repeated bus numbers correctly)
    src = (kind==='bus') ? G.doneBuses[unitNameOrIdx] : G.doneUnits[unitNameOrIdx];
    unitName = src ? (kind==='bus' ? src.busNumber : src.shiftName) : String(unitNameOrIdx);
  } else {
    // Name path — legacy / single-unit  (no repeats possible for shifts)
    unitName = unitNameOrIdx;
    src = (kind==='bus')
      ? (G.doneBuses.filter(function(b){return b.busNumber===unitName;})[0])
      : (G.doneUnits.filter(function(s){return s.shiftName===unitName;})[0]);
  }
  G.editUnitName=unitName;   // server receives plain bus number / shift name
  if (!src){ toast('नोंद सापडली नाही.','error'); G.editMode=false; return; }

  // Populate the page-1 fields directly from the record (no dropdown re-pick).
  if (G._editDist){ document.getElementById('dist').value=G._editDist; loadStations(); }
  setTimeout(function(){ if(G._editStn) document.getElementById('stn').value=G._editStn; },120);
  if (G._editId)   document.getElementById('empid').value=G._editId;
  if (G._editName) document.getElementById('name').value=G._editName;
   if (G._originalSessionDate) {
    document.getElementById('date').value = G._originalSessionDate;
    document.getElementById('date').readOnly = true;  // LOCK IT
    document.getElementById('date').style.opacity = '0.7';
    document.getElementById('date').style.cursor = 'not-allowed';
  }
  document.getElementById('shiftWrap').classList.add('hidden');
  document.getElementById('busWrap').classList.toggle('hidden', kind!=='bus');
  // EDIT: hide the frequency + checklist selectors entirely.
  var ff=document.getElementById('freqField');  if(ff) ff.classList.add('hidden');
  var cf=document.getElementById('ctypeField'); if(cf) cf.classList.add('hidden');
  if (kind==='bus'){
    document.getElementById('busNum').value=unitName;
    document.getElementById('busNum').readOnly=false;   // allow bus number edit/rename
    document.getElementById('busNum').style.opacity='';
    document.getElementById('busNum').style.cursor='';
  }
  switchPage(2);
  renderQ(G.checklistKey);
  
  // ADD: Enable submitBtn for edit mode
  document.getElementById('submitBtn').disabled = false;
  document.getElementById('submitBtn').style.display = 'flex';
  document.getElementById('submitBtn').textContent = '✔ अद्ययावत करा'; 

  // Pre-fill answers + remarks from the stored unit, after the cards render.
  // renderQ runs in edit mode → flat block-0 ids (s0_q{i}). We set the DOM
  // directly (no remark dialog) and store remarks under the 's0::' keys that
  // getAnswers() reads back.
  G.remarks = {};
  var qs = G.questions[G.checklistKey]||FALLBACK_Q[G.checklistKey]||[];
  setTimeout(function(){
    qs.forEach(function(q,idx){
      var a=(src.answers||{})[q];
      if(!a) return;
      var qid='s0_q'+idx;
      var card=document.getElementById('qc_'+qid);
      if(!card) return;
      card.dataset.ans=a;
      card.classList.remove('ans-yes','ans-no');
      card.classList.add(a==='होय'?'ans-yes':'ans-no');
      var y=document.getElementById('opt_'+qid+'_y'), n=document.getElementById('opt_'+qid+'_n');
      if(y) y.classList.toggle('sel', a==='होय');
      if(n) n.classList.toggle('sel', a==='नाही');
      if (a==='नाही'){
        var rem=(src.remarks||{})[q]||'';
        G.remarks['s0::'+q]=rem;
        var rd=document.getElementById('rd_'+qid);
        if(rd){ rd.textContent=rem; rd.style.display=rem?'block':'none'; }
      }
    });
    var firstQ=document.getElementById('qc_s0_q0'); if(firstQ) firstQ.scrollIntoView({block:'start'});
  },140);

  var badge=document.getElementById('infoBadge');
  badge.classList.remove('hidden');
  badge.innerHTML='✏️ <strong>संपादन मोड</strong> — '+esc(G._editChecklistText||G.checklistKey)+
    ' · '+esc(unitName)+'<br>बदल करा व खाली <strong>✔ पूर्ण करा</strong> दाबा. (तीच नोंद अद्ययावत होईल)<br>' +
    '📅 <span style="color:var(--txt-lt);font-size:11px">मूळ तारीख: '+esc(G._originalSessionDate)+'</span>';  // SHOW original date
  toast('✏️ संपादन सुरू — '+unitName,'info',4000);
}

/* === NAVIGATION === */
function goToPage2() {
  if (!_guardBtn('goToPage2',1000)) return;
  var checks=[{id:'dist',msg:'जिल्हा निवडा.'},{id:'stn',msg:'बस स्थानक निवडा.'},{id:'empid',msg:'कर्मचारी आयडी टाका.'},{id:'name',msg:'सुपरवायझर नाव टाका.'},{id:'date',msg:'तारीख निवडा.'}];
  for (var i=0;i<checks.length;i++){
    var el=document.getElementById(checks[i].id);
    if (!el.value.trim()){toast(checks[i].msg,'error');el.focus();return;}
  }
  var entId=document.getElementById('empid').value.trim();
  var entName=document.getElementById('name').value.trim();
  if (!/^\d+$/.test(entId)){toast('❌ कर्मचारी आयडी फक्त संख्या असावा.','error',4000);document.getElementById('empid').focus();return;}
  // Identity = typed ID + name. No login required for entry.
  G.emp = { id: entId, name: entName }; G.empOk = true;
  updateEmpStatus();
  switchPage(2);
  // REQ-06: if a checklist is already in progress, restore the same unit.
  if (G.checklistKey && (G.doneUnits.length || G.doneBuses.length || G.unitIdx > 0)) {
    try {
      if (typeof renderUnitTrack === 'function') renderUnitTrack();
      if (typeof renderUnitInfo  === 'function') renderUnitInfo();
    } catch (e) {}
  }
}
function goBack() {
  // REQ-06: return to Page 1 WITHOUT losing any state.
  if (G.editMode) {
    G.editMode = false; G.editUnitName = null;
  }
  switchPage(1);
  toast('मागे आलात — माहिती जतन आहे. / Back — your data is preserved.', 'info', 2500);
}

/* REQ-06: re-enter Page 2 restoring the in-progress checklist exactly. */
function returnToChecklist() {
  switchPage(2);
  try {
    if (typeof renderUnitTrack === 'function') renderUnitTrack();
    if (typeof renderUnitInfo  === 'function') renderUnitInfo();
  } catch (e) {}
}
function switchPage(n) {
  document.getElementById('page1').classList.toggle('active',n===1);
  document.getElementById('page2').classList.toggle('active',n===2);
  document.querySelector('.content').scrollTop=0;
  setProgress(n);
  document.getElementById('backBtn').style.display   = n===2?'':'none';
  document.getElementById('nextBtn').style.display   = n===1?'':'none';
  document.getElementById('submitBtn').style.display = n===2?'flex':'none';  // CHANGED: always show on page 2
  try {
    if (window.history && history.pushState) {
      history.pushState({ page: n }, '');
    }
  } catch (e) {}
}
function setProgress(step) {
  document.getElementById('progFill').style.width=step===1?'33%':step===2?'66%':'100%';
  ['pl1','pl2','pl3'].forEach(function(id,i){
    var el=document.getElementById(id);
    el.className='prog-lbl'+(i+1<step?' done':i+1===step?' active':'');
  });
}
function loadStations() {
  var dist=document.getElementById('dist').value;
  var el=document.getElementById('stn');
  el.innerHTML='<option value="">— स्थानक निवडा —</option>';
  if (G.districtMap[dist]) {
    G.districtMap[dist].slice().sort().forEach(function(s){el.add(new Option(s,s));});
  }
}

/* === CHECKLIST LOGIC === */
function getUnitsForKey(key) {
  var meta = CHECKLIST_META_CLIENT[key];
  if (!meta) return SHIFTS;
  if (meta.mode==='shift'){
    // VAR-SHIFTS: exactly the number of shifts the supervisor selected.
    var n = (G.shiftCount>=1 && G.shiftCount<=SHIFTS.length) ? G.shiftCount : SHIFTS.length;
    return SHIFTS.slice(0, n);
  }
  if (meta.mode==='week')   return WEEKS;
  if (meta.mode==='single') return ['एकदा'];
  return [];
}

/* Lock/unlock the shift-count dropdown (locked once the session exists,
   so the count cannot change mid-checklist). */
function _setShiftCount(n, lock){
  n = parseInt(n,10)||0;
  G.shiftCount = n;
  var sel=document.getElementById('shiftCount');
  if (sel){
    if (n>=2 && n<=6) sel.value=String(n);
    else if (n>0){ // server says e.g. 6 (legacy session) — show it read-only
      if (!sel.querySelector('option[value="'+n+'"]')){
        var o=document.createElement('option'); o.value=String(n);
        o.textContent=n+' पाळ्या'; sel.appendChild(o);
      }
      sel.value=String(n);
    }
    sel.disabled=!!lock;
    sel.style.opacity=lock?'0.7':'';
  }
}

/* User picked the day's shift count → render exactly that many units. */
function onShiftCountChange(){
  if (G.sessionId){ _setShiftCount(G.shiftCount,true); return; }
  var v=parseInt(document.getElementById('shiftCount').value,10)||0;
  /* FIXED: only allow 4 or 6 */
  if (v !== 4 && v !== 6) {
    G.shiftCount = 0;
    toast('फक्त ४ किंवा ६ पाळ्या निवडा.', 'error', 3000);
    document.getElementById('shiftCount').value = '';
    return;
  }
  G.shiftCount=v;
  if (!v){
    document.getElementById('shiftWrap').classList.add('hidden');
    document.getElementById('qWrap').classList.add('hidden');
    document.getElementById('infoBadge').classList.add('hidden');
    return;
  }
  renderUnitTrack(); renderUnitInfo(); renderQ(G.checklistKey);
  scheduleSave();
  _peekResume();
}


/* onChecklistChange() must NEVER create a session — it only renders UI.
   The session is created lazily on the first "✔ पूर्ण करा". */
function onChecklistChange(restoring) {
  if (G.editMode || G._resumeLocked) { return; }

  var type = document.getElementById('ctype').value;
  if (!type) return;

  if (!restoring) {
    G.checklistKey  = null;
    G.sessionId     = null;
    G.tokenId       = null;
    G.unitIdx       = 0;
    G.doneUnits     = [];
    G.doneBuses     = [];
    G.remarks       = {};
    G.shiftCount    = 0;                                  // VAR-SHIFTS reset
    var scSel=document.getElementById('shiftCount');
    if (scSel){ scSel.value=''; scSel.disabled=false; scSel.style.opacity=''; }
  }

  G.checklistKey = type;
  var meta = CHECKLIST_META_CLIENT[type];
  G.mode = meta ? meta.mode : 'shift';

  var isBus = (G.mode === 'bus');
  document.getElementById('shiftWrap').classList.toggle('hidden', isBus || G.mode === 'single');
  document.getElementById('busWrap').classList.toggle('hidden', !isBus);
  document.getElementById('busNumErr').style.display = 'none';

  if (isBus) {
    document.getElementById('busNum').value = '';
    document.getElementById('submitBtn').textContent = '✔ बस जतन करा';
    // Show the end-bus button in the action bar (hidden for non-bus modes)
    var ebb = document.getElementById('endBusBtn');
    if (ebb) ebb.style.display = G.doneBuses.length > 0 ? '' : 'none';
    _refreshBusDashPanel();
    var done  = G.doneBuses.length;
    var badge = document.getElementById('infoBadge');
    if (done > 0) {
      badge.classList.remove('hidden');
      badge.textContent = '✅ ' + done + ' बस पूर्ण | पुढील बस क्रमांक टाका.';
    } else {
      badge.classList.add('hidden');
    }
  }

  // VAR-SHIFTS: shift checklists need the day's shift count BEFORE any
  // questions appear. Week/single/bus modes have fixed structures.
  var scField=document.getElementById('shiftCountField');
  if (G.mode==='shift'){
    scField.classList.remove('hidden');
    if (!G.shiftCount){
      // Wait for the supervisor to pick the count (2-6) — questions stay hidden.
      document.getElementById('shiftWrap').classList.add('hidden');
      document.getElementById('qWrap').classList.add('hidden');
      var bd=document.getElementById('infoBadge');
      bd.classList.remove('hidden');
      bd.textContent='👆 आधी आजच्या पाळ्यांची संख्या निवडा.';
      scheduleSave();
      if (!restoring) _peekResume();   // a same-day session sets the count itself
      return;
    }
  } else {
    scField.classList.add('hidden');
  }

  // Only render UI — DO NOT create a session here.
  renderUnitTrack();
  renderUnitInfo();
  renderQ(type);
  scheduleSave();

  // REGULAR SELECTION RESUME: if this station+checklist already has an
  // in-progress session, jump straight to the last-updated shift.
  if (!restoring) _peekResume();
}

/* Check for an incomplete session for the current station+checklist. */
function _peekResume() {
  // One-screen / one-shot model: shift checklists complete on submit, so
  // there is no in-progress shift session to resume. Skip entirely.
  return;
  /* eslint-disable no-unreachable */
  if (G.editMode || G._resumeLocked) return;
  if (G.sessionId) return;                         // already in a session
  var type = document.getElementById('ctype').value;
  if (!type) return;
  var meta = CHECKLIST_META_CLIENT[type];
  var mode = meta ? meta.mode : 'shift';
  if (mode === 'bus' || mode === 'single') return; // multi-unit resume = shift OR week
  var stnVal = document.getElementById('stn').value;
  if (!stnVal) return;

  gRun('peekContinuationSession', function (resStr) {
    var p; try { p = JSON.parse(resStr); } catch (e) { return; }
    if (!p || !p.found) return;
    if (G.sessionId) return;                        // a session started meanwhile
    G.sessionId = p.sessionId;
    G.tokenId   = p.tokenId;
    G.doneUnits = p.completedShifts || [];
    G.unitIdx   = p.currentShiftIdx || 0;
    G.remarks   = {};
    if (p.totalUnits) _setShiftCount(p.totalUnits, true);   // session's count rules
    renderUnitTrack(); renderUnitInfo(); renderQ(type);
    var b = document.getElementById('infoBadge');
    if (b) {
      b.classList.remove('hidden');
      b.innerHTML = '🔄 <strong>मागील सत्र आढळले</strong> — पूर्ण: ' + G.unitIdx +
        '/' + p.totalUnits + '. पुढील: ' + (p.nextShiftName || '') +
        ' पासून सुरू ठेवा. (पूर्ण पाळ्या लॉक)';
    }
    toast('🔄 मागील अपूर्ण सत्र — ' + (p.nextShiftName || '') + ' पासून सुरू', 'info', 5000);
  }, function () { /* silent fallback to normal flow */ }, stnVal, type, G.emp ? G.emp.id : '');
}

/* Show completed-today notification (used by the lazy create path) */
function _showCompletedModal(info){
  var m=document.getElementById('completedModal');
  var hasDetail = (info.date != null && info.unitsDone != null && info.unitsTotal != null);
  document.getElementById('completedMsg').innerHTML = hasDetail
    ? ('ही चेकलिस्ट आज ('+esc(info.date)+') आधीच पूर्ण झाली आहे.<br>'+
       '<strong>'+esc(info.unitsDone)+'/'+esc(info.unitsTotal)+' युनिट पूर्ण</strong>'+
       (info.tokenId?'<br><span style="font-family:monospace;font-size:11px">🎫 '+esc(info.tokenId)+'</span>':''))
    : esc(info.msg || 'ही चेकलिस्ट आधीच पूर्ण झाली आहे.');
  var pl=document.getElementById('completedPdfLink');
  if (info.pdfUrl){ pl.href=info.pdfUrl; pl.style.display=''; } else { pl.style.display='none'; }
  G._completedPdf=info.pdfUrl||'';
  showModal('completedModal');
}

/* Dismiss completed notification → clear the dropdown */
function completedDismiss(){
  hideModal('completedModal');
  var ct=document.getElementById('ctype');
  if (ct) ct.value='';
  G.checklistKey=null;
  document.getElementById('shiftWrap').classList.add('hidden');
  document.getElementById('busWrap').classList.add('hidden');
  var qw=document.getElementById('qWrap'); if(qw) qw.innerHTML='';
}

function resetChecklistUI() {
  document.getElementById('ctype').selectedIndex=0; G.checklistKey=null;
  G._doneCount = {};
  document.getElementById('shiftWrap').classList.add('hidden');
  document.getElementById('infoBadge').classList.add('hidden');
  document.getElementById('qWrap').classList.add('hidden');
  document.getElementById('busWrap').classList.add('hidden');
  // Hide bus dashboard panel + action-bar end button
  var bdp = document.getElementById('busDashPanel'); if (bdp) bdp.style.display = 'none';
  var ebb = document.getElementById('endBusBtn');    if (ebb) ebb.style.display = 'none';
}

function renderUnitTrack() {
  // One-screen model: the per-shift pill tracker is redundant (all shifts
  // are visible as blocks). Keep it hidden.
  var sw=document.getElementById('shiftWrap'); if(sw) sw.classList.add('hidden');
  return;
  /* eslint-disable no-unreachable */
  var wrap=document.getElementById('shiftTrack');
  wrap.innerHTML='';
  if (G.mode==='single'){
    document.getElementById('shiftWrap').classList.add('hidden'); return;
  }
  document.getElementById('shiftWrap').classList.remove('hidden');
  var units=getUnitsForKey(G.checklistKey);
  /* PERF: single innerHTML write — one reflow instead of one per pill. */
  var ph=[];
  units.forEach(function(u,idx){
    var cls='s-pill'+(idx<G.unitIdx?' done':idx===G.unitIdx?' active':'');
    var mark=(idx<G.unitIdx?'✓ ':idx===G.unitIdx?'● ':'○ ');
    ph.push('<div class="'+cls+'">'+mark+esc(u)+'</div>');
  });
  wrap.innerHTML=ph.join('');
  setTimeout(function(){var a=wrap.querySelector('.s-pill.active');if(a)a.scrollIntoView({inline:'center',block:'nearest'});},80);
}

/* Show a neutral "ready" badge when no session exists yet */
function renderUnitInfo() {
  var badge = document.getElementById('infoBadge');
  var units = getUnitsForKey(G.checklistKey);
  var tot   = units.length;
  var submitBtn = document.getElementById('submitBtn');

  if (G.mode === 'bus') { badge.classList.add('hidden'); return; }

  if (!G.sessionId) {
    badge.classList.remove('hidden');
    badge.textContent = '● सुरुवात: ' + (units[0] || '') + ' | ✔ पूर्ण करा दाबल्यावर सुरू होईल.';
    submitBtn.disabled = false;  // ENABLE for new sessions
    return;
  }

  if (G.unitIdx >= tot && G.mode !== 'single') {
    badge.classList.remove('hidden');
    badge.textContent = '✅ सर्व ' + G.doneUnits.length + ' युनिट पूर्ण झाले.';
    submitBtn.disabled = false;  // ENABLE when all done - ready to finalize
    document.getElementById('qWrap').classList.add('hidden');
  } else {
    badge.classList.remove('hidden');
    var curLabel = G.mode === 'single' ? 'एकदा' : units[G.unitIdx];
    badge.textContent = '● सद्यस्थित: ' + curLabel + ' | पूर्ण: ' + G.doneUnits.length + (tot ? '/' + tot : '');
    submitBtn.disabled = false;  // ENABLE for in-process checklists
  }
}

function renderQ(type) {
  // VAR-SHIFTS one-screen model: render ALL selected shifts stacked, each
  // with the full question set. q-ids are namespaced per shift: s{S}_q{I}.
  var qs = (G.questions[type] || FALLBACK_Q[type] || []);
  var empty = document.getElementById('qEmpty');
  var wrap  = document.getElementById('qWrap');
  empty.classList.add('hidden');
  if (!qs.length) { wrap.innerHTML=''; wrap.classList.add('hidden'); empty.classList.remove('hidden'); return; }

  wrap.classList.remove('hidden');

  // ── BUS or EDIT mode → ONE flat question set (per-bus entry, or the single
  //    unit being edited). Uses block-0 ids (s0_q{i}) read by getAnswers(). ──
  if (G.mode === 'bus' || G.editMode) {
    if (!G.editMode) G.remarks = {};   // fresh remarks for a new bus; edit prefills after
    var fp = [];
    for (var fi = 0; fi < qs.length; fi++) {
      var fqid = 's0_q'+fi;
      fp.push(
        '<div class="q-card" id="qc_'+fqid+'">'+
        '<p class="q-text"><span class="q-num">'+(fi+1)+'.</span> '+esc(qs[fi])+'</p>'+
        '<div class="radio-row">'+
          '<div class="r-opt r-yes" id="opt_'+fqid+'_y" onclick="pickAns(\''+fqid+'\',\'होय\',0,'+fi+')" role="button" tabindex="0"><span class="r-dot"></span> होय ✓</div>'+
          '<div class="r-opt r-no" id="opt_'+fqid+'_n" onclick="pickAns(\''+fqid+'\',\'नाही\',0,'+fi+')" role="button" tabindex="0"><span class="r-dot"></span> नाही ✗</div>'+
        '</div>'+
        '<div id="rd_'+fqid+'" class="q-remark" style="display:none"></div>'+
        '</div>');
    }
    wrap.innerHTML = fp.join('');
    return;
  }

  G.remarks = {};                 // remarks keyed "s{S}::{question}"
  var units = getUnitsForKey(type);   // exactly the chosen count (shift mode) or week/single
  var parts = [];
  for (var s = 0; s < units.length; s++) {
    parts.push(
      '<div class="shift-block" id="sb_'+s+'" style="margin-bottom:14px;border:1.5px solid var(--line-md);border-radius:var(--r);overflow:hidden">'+
        '<div class="shift-block-hd" onclick="toggleShiftBlock('+s+')" style="background:var(--navy);color:var(--gold);font-weight:800;font-size:13px;padding:11px 13px;display:flex;justify-content:space-between;align-items:center;cursor:pointer">'+
          '<span>'+esc(units[s])+'</span>'+
          '<span id="sbstat_'+s+'" style="font-size:11px;color:rgba(255,255,255,.7)">० / '+qs.length+'</span>'+
        '</div>'+
        '<div class="shift-block-body" id="sbb_'+s+'" style="padding:10px;background:var(--paper)">');
    for (var i = 0; i < qs.length; i++) {
      var qid = 's'+s+'_q'+i;
      parts.push(
        '<div class="q-card" id="qc_'+qid+'">'+
        '<p class="q-text"><span class="q-num">'+(i+1)+'.</span> '+esc(qs[i])+'</p>'+
        '<div class="radio-row">'+
          '<div class="r-opt r-yes" id="opt_'+qid+'_y" onclick="pickAns(\''+qid+'\',\'होय\','+s+','+i+')" role="button" tabindex="0"><span class="r-dot"></span> होय ✓</div>'+
          '<div class="r-opt r-no" id="opt_'+qid+'_n" onclick="pickAns(\''+qid+'\',\'नाही\','+s+','+i+')" role="button" tabindex="0"><span class="r-dot"></span> नाही ✗</div>'+
        '</div>'+
        '<div id="rd_'+qid+'" class="q-remark" style="display:none"></div>'+
        '</div>');
    }
    parts.push('</div></div>');
  }
  wrap.innerHTML = parts.join('');
  // Collapse all but the first shift to reduce scrolling.
  for (var c = 1; c < units.length; c++) {
    var b = document.getElementById('sbb_'+c); if (b) b.style.display='none';
  }
  _updateAllShiftStats();
}

function toggleShiftBlock(s) {
  var b = document.getElementById('sbb_'+s); if (!b) return;
  b.style.display = (b.style.display === 'none') ? 'block' : 'none';
}

function _mn2(n){ var d='०१२३४५६७८९'; return String(n).split('').map(function(c){return /[0-9]/.test(c)?d[+c]:c;}).join(''); }

function _updateShiftStat(s) {
  var qs = G.questions[G.checklistKey] || FALLBACK_Q[G.checklistKey] || [];
  var done = 0;
  for (var i = 0; i < qs.length; i++) {
    var card = document.getElementById('qc_s'+s+'_q'+i);
    if (card && card.dataset.ans) done++;
  }
  G._doneCount[s] = done;   // PERF: keep the O(1) hot-path counter in sync with ground truth
  var el = document.getElementById('sbstat_'+s);
  if (el) el.textContent = _mn2(done)+' / '+_mn2(qs.length);
  var hd = document.querySelector('#sb_'+s+' .shift-block-hd');
  if (hd) hd.classList.toggle('stamped', done===qs.length && qs.length>0);
  return done;
}
function _updateAllShiftStats() {
  var units = getUnitsForKey(G.checklistKey);
  for (var s = 0; s < units.length; s++) _updateShiftStat(s);
}

function pickAns(qid, val, s, i) {
  var card = document.getElementById('qc_'+qid);
  if (!card) return;
  var wasAnswered = !!card.dataset.ans;   // PERF: capture before overwrite, see below
  var y = document.getElementById('opt_'+qid+'_y');
  var n = document.getElementById('opt_'+qid+'_n');
  if (y) y.classList.toggle('sel', val==='होय');
  if (n) n.classList.toggle('sel', val==='नाही');
  card.dataset.ans = val;
  card.classList.remove('ans-yes','ans-no');
  card.classList.add(val==='होय'?'ans-yes':'ans-no');

  var qs = G.questions[G.checklistKey] || FALLBACK_Q[G.checklistKey] || [];
  var q  = qs[i];
  var rkey = 's'+s+'::'+q;
  if (val==='नाही') {
    G.pendingQ = rkey; G.pendingIdx = qid; G.pendingDisp = q;
    document.getElementById('remarkQ').textContent = (i+1)+'. '+q;
    var ex = G.remarks[rkey] || '';
    document.getElementById('remarkInp').value = ex;
    document.getElementById('remarkCnt').textContent = ex.length;
    showDlg('remarkDlg');
    setTimeout(function(){ document.getElementById('remarkInp').focus(); }, 180);
  } else {
    delete G.remarks[rkey];
    var rd = document.getElementById('rd_'+qid);
    if (rd) { rd.style.display='none'; rd.textContent=''; }
  }

  // PERF: O(1) update instead of _updateShiftStat(s)'s full qs.length rescan
  // on every tap. In bus/edit (flat) mode there's no sbstat_/shift-block-hd
  // element at all, so the old rescan ran purely for nothing — skip it.
  if (G.mode !== 'bus' && !G.editMode) {
    if (!wasAnswered) G._doneCount[s] = (G._doneCount[s]||0) + 1;
    var elS = document.getElementById('sbstat_'+s);
    if (elS) elS.textContent = _mn2(G._doneCount[s]||0)+' / '+_mn2(qs.length);
    var hdS = document.querySelector('#sb_'+s+' .shift-block-hd');
    if (hdS) hdS.classList.toggle('stamped', (G._doneCount[s]||0)===qs.length && qs.length>0);
  }
  scheduleSave();
}

function submitRemark() {
  var text = document.getElementById('remarkInp').value.trim();
  if (!text) { toast('शेरा लिहिणे आवश्यक आहे!','error'); return; }
  G.remarks[G.pendingQ] = text;
  var rd = document.getElementById('rd_'+G.pendingIdx);
  if (rd) { rd.textContent = text; rd.style.display='block'; }
  hideDlg('remarkDlg'); G.pendingQ=null; G.pendingIdx=null;
  scheduleSave();
}

function cancelRemark() {
  if (G.pendingIdx) {
    if (!G.remarks[G.pendingQ]) {
      var card = document.getElementById('qc_'+G.pendingIdx);
      if (card) {
        card.classList.remove('ans-yes','ans-no');
        delete card.dataset.ans;
        var y = document.getElementById('opt_'+G.pendingIdx+'_y');
        var n = document.getElementById('opt_'+G.pendingIdx+'_n');
        if (y) y.classList.remove('sel');
        if (n) n.classList.remove('sel');
        // PERF: this reverts an answer back to "unanswered" — keep the O(1)
        // counter (and its displayed stat) in sync with that, same as pickAns.
        if (G.mode !== 'bus' && !G.editMode) {
          var m = G.pendingIdx.match(/^s(\d+)_/);
          if (m) {
            var sIdx = parseInt(m[1], 10);
            G._doneCount[sIdx] = Math.max(0, (G._doneCount[sIdx]||0) - 1);
            var qsArr = G.questions[G.checklistKey] || FALLBACK_Q[G.checklistKey] || [];
            var elC = document.getElementById('sbstat_'+sIdx);
            if (elC) elC.textContent = _mn2(G._doneCount[sIdx])+' / '+_mn2(qsArr.length);
            var hdC = document.querySelector('#sb_'+sIdx+' .shift-block-hd');
            if (hdC) hdC.classList.remove('stamped');
          }
        }
      }
    }
  }
  hideDlg('remarkDlg'); G.pendingQ=null; G.pendingIdx=null;
}

function _normName(s){ try { return String(s||'').normalize('NFC').replace(/\s+/g,' ').trim(); } catch(e){ return String(s||'').replace(/\s+/g,' ').trim(); } }

/* RESUME: pre-fill already-saved shifts into their one-screen blocks so the
   supervisor sees what's done and just completes the remaining shifts. */
function _prefillSavedShifts(savedShifts){
  if (!savedShifts || !savedShifts.length) return;
  var type=G.checklistKey;
  var qs=G.questions[type]||FALLBACK_Q[type]||[];
  var units=getUnitsForKey(type);
  savedShifts.forEach(function(sv, ord){
    if (!sv || !sv.shiftName) return;
    var s=-1;
    for (var u=0; u<units.length; u++){ if (_normName(units[u])===_normName(sv.shiftName)){ s=u; break; } }
    if (s<0 && ord < units.length) s=ord;   // fallback: fill in saved order
    if (s<0) return;
    for (var i=0;i<qs.length;i++){
      var q=qs[i];
      var val=(sv.answers||{})[q];
      if (!val) continue;
      var qid='s'+s+'_q'+i;
      var card=document.getElementById('qc_'+qid);
      if (!card) continue;
      card.dataset.ans=val;
      card.classList.remove('ans-yes','ans-no');
      card.classList.add(val==='होय'?'ans-yes':'ans-no');
      var y=document.getElementById('opt_'+qid+'_y'), n=document.getElementById('opt_'+qid+'_n');
      if (y) y.classList.toggle('sel', val==='होय');
      if (n) n.classList.toggle('sel', val==='नाही');
      if (val==='नाही'){
        var rem=(sv.remarks||{})[q]||'';
        G.remarks['s'+s+'::'+q]=rem;
        var rd=document.getElementById('rd_'+qid);
        if (rd && rem){ rd.textContent=rem; rd.style.display='block'; }
      }
    }
  });
  if (typeof _updateAllShiftStats==='function') _updateAllShiftStats();
}

/* Gather every shift's answers. Returns {ok, shifts:[{shiftName,answers,remarks}]}
   or {ok:false, msg, jumpTo} pointing at the first missing card. */
function gatherAllShifts() {
  var type = G.checklistKey;
  var qs   = G.questions[type] || FALLBACK_Q[type] || [];
  var units = getUnitsForKey(type);
  var out = [];
  for (var s = 0; s < units.length; s++) {
    // Count how many questions in this shift are answered.
    var answered = 0;
    for (var k = 0; k < qs.length; k++) {
      var c = document.getElementById('qc_s'+s+'_q'+k);
      if (c && c.dataset.ans) answered++;
    }
    if (answered === 0) continue;   // shift not started → skip (fill it later)
    // Started → must be FULLY answered (no half-done column).
    var answers = {}, remarks = {};
    for (var i = 0; i < qs.length; i++) {
      var qid  = 's'+s+'_q'+i;
      var card = document.getElementById('qc_'+qid);
      var val  = card ? card.dataset.ans : '';
      if (!val) return { ok:false, msg:esc(units[s])+': ही पाळी सुरू केली आहे — सर्व प्रश्नांची उत्तरे द्या (किंवा सर्व रिकामे ठेवा).', jumpTo:qid, blockIdx:s };
      answers[qs[i]] = val;
      var rkey = 's'+s+'::'+qs[i];
      if (val==='नाही') {
        if (!G.remarks[rkey]) return { ok:false, msg:esc(units[s])+': "नाही" साठी शेरा द्या.', jumpTo:qid, blockIdx:s };
        remarks[qs[i]] = G.remarks[rkey];
      }
    }
    out.push({ shiftName: units[s], answers: answers, remarks: remarks });
  }
  if (!out.length) return { ok:false, msg:'किमान एक पाळी पूर्ण भरा.', jumpTo:'s0_q0', blockIdx:0 };
  return { ok:true, shifts: out, filled: out.length, total: units.length, allDone: (out.length >= units.length) };
}

/* === COMPLETE UNIT === */
function completeUnit() {
  if (!_guardBtn('completeUnit',2000)) return;
  if (G.editMode){ _saveEdit(); return; }
  // Trust resume/edit state — the dropdown is intentionally locked in those modes.
  var key = G.checklistKey || (document.getElementById('ctype') && document.getElementById('ctype').value) || '';
  if (!key){ toast('चेकलिस्ट निवडा.','error'); return; }
  G.checklistKey = key;                 // lock it in so downstream code has it
  if (G.mode==='shift' && !G.shiftCount){
    toast('आधी आजच्या पाळ्यांची संख्या निवडा (२-६).','error',4000);
    var sc=document.getElementById('shiftCount'); if(sc) sc.focus();
    return;
  }
  if (G.mode==='bus') { completeBus(); return; }
  submitAllShifts();
}

/* Poll the server for the background-rendered PDF and drop the link onto
   the success screen when it is ready. Up to ~12 tries over ~60s, then a
   gentle note pointing to माघील अहवाल. No UI blocking — the success screen
   is already shown. */
/* SPEED: fires generatePdfNow in parallel with _pollSessionPdf right after
   a successful save. The queue+trigger path (which the poll is watching)
   has its own dispatch latency on top of its debounce; this direct call
   skips that entirely and usually wins the race, often showing the PDF
   link within a couple of seconds. If it's slow or fails for any reason,
   the poll loop (already running alongside it) is the fallback — nothing
   waits on this call, and nothing breaks if it never returns. */
function _tryDirectPdf(sessionId){
  if (!sessionId) return;
  gRun('generatePdfNow', function(resStr){
    var r; try { r = JSON.parse(resStr); } catch(e){ r = {}; }
    if (r && r.ok && r.pdfUrl && G._pollTimer === sessionId) {
      var pl = document.getElementById('pdfLink');
      if (pl) { pl.href = r.pdfUrl; pl.style.display=''; }
      var note = document.getElementById('noPdfNote'); if (note) note.classList.add('hidden');
      toast('✅ PDF तयार!','success',2500);
      G._pollTimer = null;   // stop the parallel poll loop, we already have the link
    }
  }, function(){ /* silent — the poll loop already running is the fallback */ }, sessionId, (G.emp && G.emp.id) || '');
}
function _pollSessionPdf(sessionId, tries) {
  if (!sessionId) return;
  if (tries > 0 && G._pollTimer === null) return;
  if (tries === 0) {
    G._pollTimer = sessionId;
    var note = document.getElementById('noPdfNote');
    if (note) {
      note.classList.remove('hidden');
      note.innerHTML = '⏳ PDF तयार होत आहे… <strong>तुम्ही पुढे जाऊ शकता</strong> — ' +
                       'PDF नेहमी <strong>"माघील अहवाल"</strong> मध्ये उपलब्ध असेल. ✅ डेटा जतन झाला आहे.';
    }
    var pl = document.getElementById('pdfLink'); if (pl) pl.style.display='none';
  }
  // Poll for up to ~90 seconds: 3×1.5s + 15×5s = 79.5s — covers the 1-min queue trigger.
  if (tries > 18) {
    var n2 = document.getElementById('noPdfNote');
    if (n2) n2.innerHTML = '📄 PDF प्रक्रियेत आहे — <strong>"माघील अहवाल"</strong> मधून उघडा.';
    G._pollTimer = null;
    return;
  }
  var elapsed = tries < 3 ? '' : (' (~' + Math.round((4500 + (tries-3)*5000)/1000) + 'से)');
  var dots = '.'.repeat((tries % 3) + 1);
  var n3 = document.getElementById('noPdfNote');
  if (n3 && !n3.classList.contains('hidden'))
    n3.innerHTML = '⏳ PDF तयार होत आहे' + dots + elapsed +
      ' — <strong>"माघील अहवाल"</strong> मधून केव्हाही उघडता येईल.';
  var nextDelay = (tries < 3) ? 1500 : 5000;
  gRun('getSessionPdf', function(resStr){
    var r; try { r = JSON.parse(resStr); } catch(e){ r = {}; }
    if (r && r.ok && r.pdfUrl) {
      var pl = document.getElementById('pdfLink');
      if (pl) { pl.href = r.pdfUrl; pl.style.display=''; }
      var note = document.getElementById('noPdfNote'); if (note) note.classList.add('hidden');
      G._pollTimer = null;
      toast('✅ PDF तयार झाली!','success',3000);
    } else {
      setTimeout(function(){
        if (G._pollTimer === sessionId) _pollSessionPdf(sessionId, tries + 1);
      }, nextDelay);
    }
  }, function(){
    setTimeout(function(){
      if (G._pollTimer === sessionId) _pollSessionPdf(sessionId, tries + 1);
    }, nextDelay);
  }, sessionId);
}

/* ONE-SHOT SUBMIT: gather every shift on screen, send once, get COMPLETED
   + PDF back. No per-shift round trips, no pending, no resume. */
function submitAllShifts() {
  if (G.mode==='shift' && !G.shiftCount) {
    toast('आधी आजच्या पाळ्यांची संख्या निवडा (२-६).','error',4000);
    var sc=document.getElementById('shiftCount'); if(sc) sc.focus();
    return;
  }
  var g = gatherAllShifts();
  if (!g.ok) {
    toast(g.msg, 'error', 4500);
    var card = document.getElementById('qc_'+g.jumpTo);
    if (card) { card.scrollIntoView({behavior:'smooth',block:'center'}); }
    if (typeof g.blockIdx === 'number') {
      var b = document.getElementById('sbb_'+g.blockIdx); if (b) b.style.display='block';
    }
    return;
  }
  if (!g.allDone) {
    var units = getUnitsForKey(G.checklistKey);
    var missing = [];
    for (var s=0;s<units.length;s++){
      var found=false;
      for (var k=0;k<g.shifts.length;k++){ if (g.shifts[k].shiftName===units[s]) { found=true; break; } }
      if (!found) missing.push(units[s]);
    }
    toast('⚠️ या पाळ्या रिकाम्या आहेत आणि वगळल्या जातील: '+missing.join(', ')+'\nपूर्ण करण्यासाठी पुन्हा दाबा.', 'error', 6000);
    if (!G._confirmSkip) { G._confirmSkip = true; setTimeout(function(){ G._confirmSkip=false; }, 6000); return; }
  }
  G._confirmSkip = false;

  _lockBtn('submitBtn','जतन होत आहे…');
  showLoad(true);

  if (!G.sessionId) G.sessionId = _genSessionId();
  if (!G.tokenId)   G.tokenId   = _genTokenId(document.getElementById('dist').value, document.getElementById('stn').value);

  var payload = {
    sessionId: G.sessionId, tokenId: G.tokenId,
    dist: document.getElementById('dist').value,
    stn:  document.getElementById('stn').value,
    name: document.getElementById('name').value,
    id:   document.getElementById('empid').value,
    date: document.getElementById('date').value,
    checklistKey: G.checklistKey,
    shifts: g.shifts
  };

  gRun('submitAllShifts', function(resStr){
    showLoad(false); _unlockBtn('submitBtn');
    var r; try { r = JSON.parse(resStr); } catch(e){ toast('पार्स त्रुटी.','error'); return; }
    if (!r.ok) {
      // Data already saved on server → show completion modal, don't re-queue
      if (r.alreadyCompleted) { _showCompletedModal(r); return; }
      if (r.completedToday && r.info) { _showCompletedModal(r.info); return; }
      // FIX: any other failure (busy, server error, session not found, etc.)
      // → queue to outbox for automatic retry. Previously only busy showed a
      // toast, other errors silently lost the data. Now everything is safe.
      console.error('[submitAllShifts] server rejected:', r);
      _obStore({type:'allShifts', payload: payload});
      if (r.busy) {
        toast('🔄 सर्व्हर व्यस्त — आपोआप पुन्हा पाठवले जाईल.', 'warn', 5000);
      } else {
        toast('⚠️ जतन करताना समस्या — पार्श्वभूमीत पुन्हा प्रयत्न होईल. ' + (r.msg || ''), 'warn', 6000);
      }
      return;
    }
    clearDraftLocal();
    G.tokenId = r.tokenId || G.tokenId;
    document.getElementById('tokenDisplay').textContent = G.tokenId;
    document.getElementById('successMsg').textContent = (g.shifts.length)+' पाळी यशस्वीरीत्या जतन झाल्या.';
    var summary = document.getElementById('successSummary');
    var lines = g.shifts.map(function(sh){
      var yes=0,no=0;
      Object.keys(sh.answers).forEach(function(q){ if(sh.answers[q]==='होय') yes++; else no++; });
      return '• '+esc(sh.shiftName)+' — ✅ '+yes+' | ❌ '+no;
    });
    summary.innerHTML = lines.join('<br>');
    if (r.pdfUrl) {
      document.getElementById('pdfLink').href = r.pdfUrl;
      document.getElementById('pdfLink').style.display='';
      document.getElementById('noPdfNote').classList.add('hidden');
    } else {
      document.getElementById('pdfLink').style.display='none';
      G._pollTimer = null;
      _tryDirectPdf(G.sessionId);
      _pollSessionPdf(G.sessionId, 0);
    }
    document.getElementById('successScr').classList.add('show');
    toast('✅ चेकलिस्ट पूर्ण झाली!','success',3000);
  }, function(e){
    showLoad(false); _unlockBtn('submitBtn');
    // queue for background sync if the network failed
    _obStore({type:'allShifts', payload: payload});
    toast('नेटवर्क समस्या — डेटा स्थानिक जतन झाला, आपोआप पाठवले जाईल.', 'warn', 5000);
  }, payload);
}

/* EDIT: push a corrected single unit back to the server (UPDATE not INSERT). */
function _saveEdit(){
  if (!_guardBtn('saveEdit',2000)) return;
  var qs = G.questions[G.checklistKey]||FALLBACK_Q[G.checklistKey]||[];
  var answers={}, remarks={};
  for (var i=0;i<qs.length;i++){
    var qid='s0_q'+i;
    var card=document.getElementById('qc_'+qid);
    var val=card?card.dataset.ans:'';
    if (!val){ toast('सर्व प्रश्नांची उत्तरे द्या.','error',4000); card&&card.scrollIntoView({behavior:'smooth',block:'center'}); return; }
    answers[qs[i]]=val;
    if (val==='नाही'){
      var rem=G.remarks['s0::'+qs[i]];
      if (!rem){ toast('"नाही" साठी शेरा द्या — '+qs[i],'error',4500); return; }
      remarks[qs[i]]=rem;
    }
  }
  _lockBtn('submitBtn','अद्ययावत होत आहे…');
  showLoad(true);

  // FIX 1: for bus mode, read the new bus number from the input field —
  // previously G.editUnitName was always used (the ORIGINAL bus number),
  // so any change the supervisor typed was silently ignored.
  var newUnitName = G.editUnitName;
  if (G.mode === 'bus') {
    var busInput = document.getElementById('busNum');
    var typedBus = busInput ? busInput.value.trim().toUpperCase() : '';
    if (typedBus && typedBus.length >= 4 && typedBus.length <= 10) {
      newUnitName = typedBus;
    } else if (typedBus && typedBus.length > 10) {
      toast('बस क्रमांक जास्तीत जास्त 10 अक्षरे असावा.', 'error', 4000);
      showLoad(false); _unlockBtn('submitBtn'); return;
    }
  }

  var payload = {
    sessionId: G.sessionId, unitName: newUnitName, mode: G.mode,
    id: document.getElementById('empid').value,
    answers: answers, remarks: remarks
  };
  // Pass the ORIGINAL bus number so server finds and updates the right entry
  // (handles rename: old bus number to find it, new bus number to update it)
  if (G.mode === 'bus' && newUnitName !== G.editUnitName) {
    payload.originalUnitName = G.editUnitName;
  }
  gRun('updateUnitAnswers', function(resStr){
    showLoad(false); _unlockBtn('submitBtn');
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    if (!r.ok){
      console.error('[updateUnitAnswers] server rejected:', r, 'sent payload was:', payload);
      toast(r.msg||'अद्ययावत करता आले नाही.','error',5000); return;
    }
    toast('✅ नोंद अद्ययावत झाली!','success',3500);
    G.editMode=false; G.editUnitName=null;
    document.getElementById('submitBtn').textContent='✔ पूर्ण करा';
    var dF=document.getElementById('date');
    dF.readOnly=false; dF.style.opacity=''; dF.style.cursor='';
    var ff=document.getElementById('freqField');  if(ff) ff.classList.remove('hidden');
    var cf=document.getElementById('ctypeField'); if(cf) cf.classList.remove('hidden');
    document.getElementById('tokenDisplay').textContent=G.tokenId||'';
    document.getElementById('successMsg').textContent='नोंद यशस्वीरीत्या अद्ययावत झाली.';
    document.getElementById('successSummary').innerHTML='';
    if (r.pdfUrl){
      document.getElementById('pdfLink').href=r.pdfUrl;
      document.getElementById('pdfLink').style.display='';
      document.getElementById('noPdfNote').classList.add('hidden');
    } else {
      document.getElementById('pdfLink').style.display='none';
      G._pollTimer = null;
      _tryDirectPdf(G.sessionId);
      _pollSessionPdf(G.sessionId, 0);
    }
    document.getElementById('successScr').classList.add('show');
  }, function(){ showLoad(false); _unlockBtn('submitBtn'); toast('नेटवर्क त्रुटी.','error'); }, payload);
}

/* legacy per-shift completion path retained for the bus-repeat / single-unit
   background-sync queue helpers below. */
function completeShift(){ submitAllShifts(); }
function _createSessionThenSaveShift(){ submitAllShifts(); }

/* ============================================================
   BACKGROUND SYNC OUTBOX (v17.3)
   Queues failed submissions in localStorage and retries them
   automatically (on 'online' event, periodic timer, and manual
   tap on the sync chip). Keeps the UI from being blocked by a
   single bad network moment in the field.
   ============================================================ */
var OUTBOX_KEY = 'msrtc_outbox_v1';
var _obTimer = null;
var _obBusy  = false;
var _obFailStreak = 0;

function _obLoad(){
  try { return JSON.parse(localStorage.getItem(OUTBOX_KEY)||'[]'); } catch(e){ return []; }
}
function _obStore(item){
  var q = _obLoad();
  item._id = 'ob_'+Date.now()+'_'+Math.random().toString(36).slice(2,8);
  item._ts = Date.now();
  q.push(item);
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); } catch(e){}
  _obChip();
  _obKick(800);
}
function _obPush(q){
  try { localStorage.setItem(OUTBOX_KEY, JSON.stringify(q)); } catch(e){}
  _obChip();
}
function _obKick(delay){
  clearTimeout(_obTimer);
  _obTimer = setTimeout(_obProcess, delay||500);
}
function _obProcess(){
  if (_obBusy) return;
  var q = _obLoad();
  if (!q.length) { _obChip(); return; }
  if (!navigator.onLine) { _obChip(); _obKick(4000); return; }
  _obBusy = true;
  var item = q[0];
  _obChip('sync');
  function done(ok){
    _obBusy = false;
    if (ok) {
      _obFailStreak = 0;
      var remain = _obLoad().filter(function(x){return x._id!==item._id;});
      _obPush(remain);
      if (remain.length) { _obKick(400); } else { _obChip('ok'); setTimeout(_obChip, 2500); }
    } else {
      _obFailStreak++;
      _obChip(_obFailStreak>3?'err':'warn');
      var backoff = Math.min(30000, 1500*Math.pow(1.6,_obFailStreak));
      _obKick(backoff);
    }
  }
  if (item.type === 'allShifts') {
    gRun('submitAllShifts', function(resStr){
      var r; try{r=JSON.parse(resStr);}catch(e){r={ok:false};}
      // r.busy = lock contention → retry; alreadyCompleted/completedToday → treat as success (already saved)
      if (r && r.busy) { done(false); return; }
      done(!!(r && (r.ok || r.alreadyCompleted || r.completedToday)));
    }, function(){ done(false); }, item.payload);
  } else if (item.type === 'bus') {
    gRun('saveBusEntry', function(resStr){
      var r; try{r=JSON.parse(resStr);}catch(e){r={ok:false};}
      if (r && r.busy) { done(false); return; }   // retry on lock contention
      done(!!(r && r.ok));
    }, function(){ done(false); }, item.payload);
  } else {
    done(true);   // unknown type — drop it rather than loop forever
  }
}
function _obOnConfirm(){ /* reserved */ }
function _obFlush(){ _obKick(50); }
/* How many bus entries are still queued locally (not yet confirmed on the
   server). Finalize must wait until this is 0, otherwise the server generates
   the PDF from an incomplete set and those buses "vanish" from the report. */
function _obPendingBusCount(){
  try { return _obLoad().filter(function(x){ return x && x.type==='bus'; }).length; }
  catch(e){ return 0; }
}
function _obChip(state){
  var chip = document.getElementById('syncChip');
  if (!chip) return;
  var q = _obLoad();
  if (!state) {
    if (!q.length) { chip.classList.add('hide'); return; }
    state = 'warn';
  }
  chip.classList.remove('hide');
  chip.className = 'sync-chip ' + state;
  if (state==='sync') chip.textContent = '🔄 पाठवत आहे… ('+q.length+')';
  else if (state==='ok') chip.textContent = '✅ सर्व पाठवले';
  else if (state==='err') chip.textContent = '⚠️ '+q.length+' प्रलंबित — टॅप करा';
  else chip.textContent = '⏳ '+q.length+' प्रलंबित';
}

/* Optimistic local-first save helpers (kept for API compatibility with any
   inline callers); both simply route into the outbox/queue machinery. */
function _optimisticSaveShift(payload){ _obStore({type:'allShifts', payload: payload}); }
function _optimisticSaveBus(payload){ _obStore({type:'bus', payload: payload}); }
function _legacyCreateThenSave(){ submitAllShifts(); }
function _doSaveShift(){ submitAllShifts(); }

/* === BUS CHECKLIST === */
function completeBus() {
  var busNum = document.getElementById('busNum').value.trim();
  if (!busNum) { toast('बस क्रमांक टाका.','error'); document.getElementById('busNum').focus(); return; }
  if (busNum.length < 4) {
    document.getElementById('busNumErr').textContent='⚠️ वैध बस क्रमांक टाका (किमान 4 अक्षरे).';
    document.getElementById('busNumErr').style.display='block'; return;
  }
  if (busNum.length > 10) {
    document.getElementById('busNumErr').textContent='⚠️ बस क्रमांक जास्तीत जास्त 10 अक्षरे (उदा. MH40BP9101).';
    document.getElementById('busNumErr').style.display='block'; return;
  }
  var alreadyDone = G.doneBuses.some(function(b){ return b.busNumber===busNum; });
  if (alreadyDone) { askBusRepeat(busNum); return; }
  _proceedBus(busNum);
}
function askBusRepeat(busNum){
  G._repeatBusNum = busNum;
  document.getElementById('busRepeatMsg').textContent = 'बस '+busNum+' आधीच तपासली आहे. पुन्हा धुलाई/तपासणी नोंदवायची आहे का?';
  showModal('busRepeatModal');
}
function confirmBusRepeat(){
  hideModal('busRepeatModal');
  if (G._repeatBusNum) _proceedBus(G._repeatBusNum, true);
}
function _proceedBus(busNum, isRepeat){
  var ans = getAnswers('s0');
  if (!ans.ok) { toast(ans.msg,'error',4000); scrollToCard(ans.jumpTo); return; }

  _lockBtn('submitBtn','जतन होत आहे…');
  showLoad(true);
  if (!G.sessionId) G.sessionId = _genSessionId();
  if (!G.tokenId)   G.tokenId   = _genTokenId(document.getElementById('dist').value, document.getElementById('stn').value);

  var payload = {
    sessionId: G.sessionId, tokenId: G.tokenId,
    dist: document.getElementById('dist').value,
    stn:  document.getElementById('stn').value,
    name: document.getElementById('name').value,
    id:   document.getElementById('empid').value,
    date: document.getElementById('date').value,
    checklistKey: G.checklistKey,
    busNumber: busNum, isRepeat: !!isRepeat,
    answers: ans.answers, remarks: ans.remarks
  };

  gRun('saveBusEntry', function(resStr){
    showLoad(false); _unlockBtn('submitBtn');
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    if (!r.ok){
      if (r.busy){
        // Lock contention — treat exactly like a network failure:
        // push locally and queue for automatic retry via outbox.
        G.doneBuses.push({ busNumber:busNum, answers:ans.answers, remarks:ans.remarks });
        saveDraftLocal();
        _obStore({type:'bus', payload: payload});
        _refreshBusDashPanel();
        toast('🔄 '+busNum+' स्थानिक जतन — आपोआप पाठवले जाईल.','info',4000);
        showModal('busModal'); return;
      }
      console.error('[saveBusEntry] server rejected:', r, 'sent payload was:', payload);
      toast(r.msg||'जतन करता आले नाही.','error',5000); return;
    }
    G.sessionId = r.sessionId || G.sessionId;
    G.tokenId   = r.tokenId   || G.tokenId;
    G.doneBuses.push({ busNumber:busNum, answers:ans.answers, remarks:ans.remarks });
    saveDraftLocal();
    // Update busModal content
    document.getElementById('busModalTitle').textContent = '✅ नोंद झाली!';
    document.getElementById('busModalMsg').textContent =
      '🚌 ' + busNum + ' — एकूण ' + G.doneBuses.length + ' बस आज धुतल्या.';
    showModal('busModal');
    // NO auto-dismiss — supervisor must explicitly tap one of the 3 action buttons:
    //  1. पुढील बस जोडा   2. हीच बस पुन्हा धुतली   3. बस धुणे समाप्त करा
    _refreshBusDashPanel();
  }, function(){
    showLoad(false); _unlockBtn('submitBtn');
    G.doneBuses.push({ busNumber:busNum, answers:ans.answers, remarks:ans.remarks });
    saveDraftLocal();
    _obStore({type:'bus', payload: payload});
    _refreshBusDashPanel();
    document.getElementById('busModalTitle').textContent = '📶 नेटवर्क नाही';
    document.getElementById('busModalMsg').textContent = '🚌 '+busNum+' स्थानिक जतन — नेटवर्क उपलब्ध झाल्यावर आपोआप पाठवले जाईल. एकूण: '+G.doneBuses.length+' बस.';
    showModal('busModal');
  }, payload);
}

/* Read block-0 (s0_q{i}) answers — used by bus entries and edit-mode saves. */
function getAnswers(prefix) {
  var qs = G.questions[G.checklistKey]||FALLBACK_Q[G.checklistKey]||[];
  var answers={}, remarks={};
  for (var i=0;i<qs.length;i++){
    var qid=prefix+'_q'+i;
    var card=document.getElementById('qc_'+qid);
    var val=card?card.dataset.ans:'';
    if (!val) return { ok:false, msg:'सर्व प्रश्नांची उत्तरे द्या.', jumpTo:qid };
    answers[qs[i]]=val;
    if (val==='नाही'){
      var rem=G.remarks[prefix+'::'+qs[i]];
      if (!rem) return { ok:false, msg:'"नाही" साठी शेरा द्या — '+qs[i], jumpTo:qid };
      remarks[qs[i]]=rem;
    }
  }
  return { ok:true, answers:answers, remarks:remarks };
}
function scrollToCard(qid){
  var card=document.getElementById('qc_'+qid);
  if (card) card.scrollIntoView({behavior:'smooth',block:'center'});
}

/* === MODAL FLOW === */
function continueNextShift(){ hideModal('shiftModal'); }
function endInspection(){
  hideModal('shiftModal');
  switchPage(1); resetChecklistUI();
}
function addNextBus(){
  hideModal('busModal');
  document.getElementById('busNum').value='';
  document.getElementById('busNumErr').style.display='none';
  renderQ(G.checklistKey);
  _refreshBusDashPanel();
  document.getElementById('busNum').focus();
}

/* New — "हीच बस पुन्हा धुतली" button in busModal:
   takes the last saved bus number and pre-fills it so the repeat flow triggers */
function repeatLastBus(){
  hideModal('busModal');
  var lastBus = G.doneBuses.length ? G.doneBuses[G.doneBuses.length - 1].busNumber : '';
  document.getElementById('busNum').value = lastBus;
  document.getElementById('busNumErr').style.display='none';
  renderQ(G.checklistKey);
  _refreshBusDashPanel();
  // Immediately prompt repeat confirm if bus number already in list
  if (lastBus) askBusRepeat(lastBus);
}

function endBusInspection(){
  hideModal('busModal');
  if (!G.doneBuses.length){ switchPage(1); resetChecklistUI(); return; }
  // DATA SAFETY: never finalize while bus entries are still queued locally.
  // With many entries on a slow link some saves ride the outbox; finalizing now
  // would build the PDF without them. Flush first, ask the supervisor to wait.
  var _pend = _obPendingBusCount();
  if (_pend > 0){
    _obFlush();
    toast('⏳ '+_pend+' बस अजून सर्व्हरवर पाठवल्या जात आहेत. कृपया थांबा (अ‍ॅप बंद करू नका) व नंतर पुन्हा "समाप्त" दाबा.', 'warn', 6000);
    return;
  }
  showModal('pdfModal');
}

/* Refreshes the persistent bus dashboard panel:
   - Updates bus count badge
   - Rebuilds the list of washed buses (tap a chip to edit)
   - Shows/hides the panel and action bar end-button */
function _refreshBusDashPanel(){
  var panel    = document.getElementById('busDashPanel');
  var listEl   = document.getElementById('busDashList');
  var countEl  = document.getElementById('busDashCount');
  var endBtn   = document.getElementById('endBusBtn');
  var submitBtn= document.getElementById('submitBtn');
  var hasBuses = G.doneBuses && G.doneBuses.length > 0;

  if (!hasBuses){
    if (panel)   panel.style.display  = 'none';
    if (endBtn)  endBtn.style.display = 'none';
    return;
  }

  // Show panel + action bar end button
  if (panel)  panel.style.display  = '';
  if (endBtn) endBtn.style.display = '';

  // Shrink submit button to make room for end button in bar
  if (submitBtn) submitBtn.style.flex = '2';

  // Update count
  if (countEl) countEl.textContent = G.doneBuses.length + ' बस';

  // Build bus chip list
  if (listEl) {
    listEl.innerHTML = G.doneBuses.map(function(b, i){
      return '<span onclick="_editBusFromDash(' + i + ')" style="' +
        'display:inline-flex;align-items:center;gap:4px;padding:4px 10px;' +
        'background:var(--gold-lt);border:1px solid var(--gold);border-radius:20px;' +
        'font-size:12px;font-weight:700;color:var(--navy);cursor:pointer">' +
        '🚌 ' + esc(b.busNumber) +
        ' <span onclick="event.stopPropagation();_deleteBusFromDash(' + i + ')" style="color:var(--err);font-size:14px;cursor:pointer;margin-left:2px" title="हटवा">✕</span>' +
        '</span>';
    }).join('');
  }
}

function _deleteBusFromDash(idx){
  if(!G.sessionId || idx<0 || !G.doneBuses || idx>=G.doneBuses.length) return;
  var bus=G.doneBuses[idx];
  if(!confirm('🗑 बस '+(bus.busNumber||'')+' हटवायची?')) return;
  gRun('deleteBusEntry',function(resStr){
    var r;try{r=JSON.parse(resStr);}catch(e){return;}
    if(r.ok){
      G.doneBuses.splice(idx,1);
      _refreshBusDashPanel();
      toast(r.msg||'🗑 बस हटवली.','success',3000);
    }else{
      toast(r.msg||'हटवता आले नाही.','error');
    }
  },function(){toast('नेटवर्क त्रुटी.','error');},G.sessionId,idx,(G.emp&&G.emp.id)||'');
}

/* Tap a bus chip in the dashboard to edit that bus's answers */
function _editBusFromDash(idx){
  hideModal('busModal');
  _loadUnitForEdit(idx, 'bus');
}

function finishInspection(){
  // DATA SAFETY (defense-in-depth): block PDF/finalize while any bus entry is
  // still queued locally, so the report can never be built from a partial set.
  var _pend = _obPendingBusCount();
  if (_pend > 0){
    _obFlush();
    toast('⏳ '+_pend+' बस अजून पाठवल्या जात आहेत — PDF तयार करण्यापूर्वी सर्व नोंदी पाठवल्या जाईपर्यंत थांबा.', 'warn', 6000);
    return;   // leaves pdfModal open so they can retry once the sync chip clears
  }
  hideModal('pdfModal');
  if (!_guardBtn('finishInspection',2000)) return;
  _lockBtn('pdfConfirmBtn','तयार होत आहे…');
  showLoad(true);
  var payload = {
    sessionId: G.sessionId, tokenId: G.tokenId,
    dist: document.getElementById('dist').value,
    stn:  document.getElementById('stn').value,
    name: document.getElementById('name').value,
    id:   document.getElementById('empid').value,
    date: document.getElementById('date').value,
    checklistKey: G.checklistKey
  };
  gRun('finalizeBusSession', function(resStr){
    showLoad(false); _unlockBtn('pdfConfirmBtn');
    var r; try{r=JSON.parse(resStr);}catch(e){toast('पार्स त्रुटी.','error');return;}
    clearDraftLocal();
    document.getElementById('tokenDisplay').textContent=G.tokenId||'';
    document.getElementById('successMsg').textContent=G.doneBuses.length+' बस यशस्वीरीत्या तपासल्या.';
    document.getElementById('successSummary').innerHTML = G.doneBuses.map(function(b){return '• '+esc(b.busNumber);}).join('<br>');
    if (r && r.ok && r.pdfUrl){
      document.getElementById('pdfLink').href=r.pdfUrl;
      document.getElementById('pdfLink').style.display='';
      document.getElementById('noPdfNote').classList.add('hidden');
    } else {
      document.getElementById('pdfLink').style.display='none';
      _tryDirectPdf(G.sessionId);
      G._pollTimer=null; _pollSessionPdf(G.sessionId,0);
    }
    document.getElementById('successScr').classList.add('show');
  }, function(){
    showLoad(false); _unlockBtn('pdfConfirmBtn');
    document.getElementById('tokenDisplay').textContent=G.tokenId||'';
    document.getElementById('successMsg').textContent=G.doneBuses.length+' बस तपासल्या (नेटवर्क समस्या — PDF नंतर तयार होईल).';
    document.getElementById('successSummary').innerHTML = G.doneBuses.map(function(b){return '• '+esc(b.busNumber);}).join('<br>');
    document.getElementById('pdfLink').style.display='none';
    document.getElementById('noPdfNote').classList.remove('hidden');
    document.getElementById('successScr').classList.add('show');
  }, payload);
}
function showSuccess(){ document.getElementById('successScr').classList.add('show'); }
function newEntry(){
  document.getElementById('successScr').classList.remove('show');
  G._pollTimer = null;
  G.sessionId=null; G.tokenId=null; G.checklistKey=null; G.unitIdx=0;
  G.doneUnits=[]; G.doneBuses=[]; G.remarks={}; G.shiftCount=0;
  var bdp = document.getElementById('busDashPanel'); if (bdp) bdp.style.display = 'none';
  var ebb = document.getElementById('endBusBtn');    if (ebb) ebb.style.display = 'none';
  switchPage(1); resetChecklistUI();
}
function showDupModal(){ /* reserved for future duplicate-detection UI */ }

/* === माघील अहवाल (PAST REPORTS) === */
var MAGIL_TYPE_LABEL = {
  bs:'बसस्थानक (दैनंदिन)', bw:'बसेस (दैनंदिन)', gh:'विश्रांतीगृह (दैनंदिन)', wr:'प्रसाधनगृह (दैनंदिन)',
  es:'बसस्थानक (साप्ताहिक)', gh_w:'विश्रांतीगृह (साप्ताहिक)', bm:'बसेस (मासिक)', sm:'बसस्थानक (मासिक)'
};
// माघील अहवाल = ALL supervisors' full history, fetched from the server one page
// at a time (the full set is ~24k rows / 10 MB — too big to load at once).
var _magilStatus = 'all';       // active status chip: all|done|todo|pdf
var _magilOffset = 0;           // paging cursor
var _magilLimit = 100;          // must match server LIMIT
var _magilTotal = 0;
var _magilLoadingMore = false;
var _magilDeepLoaded = {};

function openMagilScr(){
  // Privacy: a supervisor sees only THEIR OWN history — login required.
  if (!G.emp){ toast('आधी कर्मचारी आयडी टाका.','error'); document.getElementById('empid').focus(); return; }
  var badge=document.getElementById('magilEmpBadge');
  badge.style.display='flex';
  badge.innerHTML='👤 '+esc(G.emp.name)+' ('+esc(G.emp.id)+')';
  document.getElementById('magilScr').classList.add('show');
  loadMagilReports();
}
function openMagilScrFromShiftModal(){
  hideModal('allShiftsDoneModal');
  openMagilScr();
}
function closeMagilScr(){ document.getElementById('magilScr').classList.remove('show'); }

function setMagilDateToday(){ document.getElementById('magilDateFilter').value = istDate(); loadMagilReports(); }
function clearMagilDateFilter(){ document.getElementById('magilDateFilter').value=''; loadMagilReports(); }

/* Fresh load (reset to page 0). Used by open, filters, date, refresh. */
function loadMagilReports(_retry){
  if (!G.emp) return;
  _retry = _retry || 0;
  _magilOffset = 0;
  _magilShowSkeleton();
  _magilFetch(_retry, true);
}

/* Append the next page (server paging). */
function _magilLoadMore(btn){
  if (_magilLoadingMore) return;
  _magilLoadingMore = true;
  if (btn) btn.textContent = 'लोड होत आहे…';
  _magilOffset += _magilLimit;
  _magilFetch(0, false);
}

function _magilFetch(_retry, reset){
  if (!G.emp) return;
  var dateVal   = document.getElementById('magilDateFilter').value || '';
  var searchVal = (document.getElementById('magilSearchInp')||{}).value || '';
  gRun('getMyReportsPaged', function(resStr){
    _magilLoadingMore = false;
    _magilHandleResponse(resStr, reset);
  }, function(){
    _magilLoadingMore = false;
    // Transient failure → auto-retry a couple of times with backoff.
    if (_retry < 2){ setTimeout(function(){ _magilFetch(_retry + 1, reset); }, 1200 * (_retry + 1)); return; }
    if (reset) _magilShowError('नेटवर्क त्रुटी — पुन्हा प्रयत्न करा.');
    else toast('अधिक लोड करता आले नाही — पुन्हा प्रयत्न करा.','error');
  }, G.emp.id, dateVal, _magilStatus, _magilOffset, searchVal);
}

function _magilHandleResponse(resStr, reset){
  var r; try { r = JSON.parse(resStr); } catch(e){ if(reset)_magilShowEmpty('डेटा त्रुटी.'); return; }
  if (!r || !r.ok){ if(reset)_magilShowEmpty((r&&r.msg)||'अहवाल आढळले नाहीत.'); return; }
  _magilTotal = r.total || 0;
  var c = r.counts || {all:0,done:0,todo:0,pdf:0};

  // Summary chips reflect the SERVER counts (whole filtered history, not just
  // the loaded page). Clicking one re-queries the server with that status.
  var sumEl=document.getElementById('magilSummary');
  sumEl.style.display='flex';
  sumEl.innerHTML=
    '<span class="magil-summary-chip mfc'+(_magilStatus==='all'?' sel':'')+'" data-f="all" onclick="magilFilter(\'all\')">📊 एकूण: '+c.all+'</span>'+
    '<span class="magil-summary-chip mfc ok'+(_magilStatus==='done'?' sel':'')+'" data-f="done" onclick="magilFilter(\'done\')">✅ पूर्ण: '+c.done+'</span>'+
    '<span class="magil-summary-chip mfc warn'+(_magilStatus==='todo'?' sel':'')+'" data-f="todo" onclick="magilFilter(\'todo\')">⏳ अपूर्ण: '+c.todo+'</span>'+
    '<span class="magil-summary-chip mfc'+(_magilStatus==='pdf'?' sel':'')+'" data-f="pdf" onclick="magilFilter(\'pdf\')">📄 PDF: '+c.pdf+'</span>';

  var list=document.getElementById('magilList');
  if (reset) list.innerHTML='';
  var oldMore=document.getElementById('magilMoreBtn'); if(oldMore) oldMore.remove();

  var rows = r.results || [];
  if (reset && !rows.length){ sumEl.style.display='none'; _magilShowEmpty(null); return; }
  list.insertAdjacentHTML('beforeend', rows.map(_magilCardHtml).join(''));

  var shown = (r.offset||0) + rows.length;
  if (r.hasMore){
    var more=document.createElement('button');
    more.id='magilMoreBtn';
    more.className='btn btn-outline'; more.style.cssText='width:100%;margin-top:6px';
    more.textContent='अधिक दाखवा ('+Math.max(0,(_magilTotal - shown))+' शिल्लक)';
    more.onclick=function(){ _magilLoadMore(more); };
    list.appendChild(more);
  }
}

/* Status chip → re-query the server (counts stay accurate across all pages). */
function magilFilter(f){
  _magilStatus = f;
  loadMagilReports();
}

function _magilCardHtml(x){
  var typeLbl = MAGIL_TYPE_LABEL[x.checklistKey] || x.checklistKey || '';
  var statusCls = x.status==='Completed' ? 'done':'proc';
  var statusTxt = x.status==='Completed' ? '✅ पूर्ण':'⏳ अपूर्ण';
  // FIX: the server has always sent a pre-formatted progressLabel (handles
  // shift/week/single/bus mode formatting correctly) — there is no separate
  // unitsDone/unitsTotal field, so that check always evaluated to empty.
  var unitsTxt = x.progressLabel || '';
  var pdfBtn;
  if (x.pdfUrl) {
    pdfBtn = '<a href="'+esc(x.pdfUrl)+'" target="_blank" rel="noopener" class="magil-pdf-btn">📄 PDF</a>';
  } else if (_magilGenerating[x.sessionId]) {
    pdfBtn = '<button class="magil-pdf-btn generating" disabled>⏳ तयार होत आहे</button>';
  } else if (x.status==='Completed') {
    pdfBtn = '<button class="magil-pdf-btn" onclick="magilRequestPDF(\''+x.sessionId+'\',this)">📄 तयार करा</button>';
  } else {
    pdfBtn = '<button class="magil-pdf-btn no-pdf" disabled>—</button>';
  }
  // FIX: editing was only ever offered for Completed sessions, even though
  // the server (getSessionForEdit/editShift/editBus) has never had any
  // status restriction — an in-process checklist's already-saved shifts/
  // buses were just as editable server-side, there was simply no button
  // for it. Now both actions show for in-process/paused sessions: Resume
  // to add the remaining shifts/buses, Edit to fix an already-saved one.
  // Every action now carries a visible text label rather than only an
  // icon with a title attribute, since title tooltips need hover and
  // don't appear at all on the touchscreens this app actually runs on.
  var actionBtns = '';
  if (x.status==='Completed') {
    actionBtns += '<button class="qd-btn btn-sm" onclick="editSession(\''+x.sessionId+'\')">✏️ संपादन</button>';
  } else {
    actionBtns += '<button class="qd-btn btn-sm" onclick="resumeIntoSession(\''+x.sessionId+'\')">▶️ सुरू ठेवा</button>';
    actionBtns += '<button class="qd-btn btn-sm" onclick="editSession(\''+x.sessionId+'\')">✏️ संपादन</button>';
  }
  actionBtns += '<button class="qd-btn btn-sm" onclick="confirmDeleteSession(\''+x.sessionId+'\',\''+esc(x.tokenId||'')+'\')" style="color:var(--err)">🗑️ हटवा</button>';

  return (
    '<div class="magil-card" data-type="'+esc(x.checklistKey||'')+'" data-session="'+esc(x.sessionId)+'">'+
      '<div class="magil-card-body" onclick="magilToggleDetail(this.parentElement,\''+x.sessionId+'\')">'+
        '<div class="magil-card-meta">'+
          '<div class="magil-card-title">'+esc(typeLbl)+'</div>'+
          '<div class="magil-card-sub"><strong>'+esc(x.station||'')+'</strong>'+(unitsTxt?(' · '+unitsTxt):'')+'</div>'+
          '<div class="magil-expand">▼ तपशील पाहा</div>'+
        '</div>'+
        '<div class="magil-card-right">'+
          '<span class="magil-date-chip">'+esc(x.dateDisp||'')+'</span>'+
          '<span class="magil-time-chip">'+esc(x.timeDisp||'')+'</span>'+
          '<span class="magil-status '+statusCls+'">'+statusTxt+'</span>'+
        '</div>'+
      '</div>'+
      '<div class="magil-detail" id="detail_'+x.sessionId+'"></div>'+
      '<div class="magil-card-actions">'+
        '<span class="magil-token">'+esc(x.tokenId||'')+'</span>'+
        '<div style="display:flex;gap:6px;align-items:center;flex-wrap:wrap">'+actionBtns+pdfBtn+'</div>'+
      '</div>'+
    '</div>'
  );
}

function magilToggleDetail(cardEl, sessionId){
  var det = cardEl.querySelector('.magil-detail');
  if (!det) return;
  var willShow = !det.classList.contains('show');
  det.classList.toggle('show', willShow);
  var exp = cardEl.querySelector('.magil-expand');
  if (exp) exp.textContent = willShow ? '▲ लपवा' : '▼ तपशील पाहा';
  if (willShow && !_magilDeepLoaded[sessionId]){
    det.innerHTML = '<p class="muted center">लोड होत आहे…</p>';
    gRun('getSessionDetail', function(resStr){
      var r; try{r=JSON.parse(resStr);}catch(e){det.innerHTML='<p class="muted center">त्रुटी.</p>';return;}
      if (!r || !r.ok){ det.innerHTML='<p class="muted center">तपशील आढळले नाहीत.</p>'; return; }
      _magilDeepLoaded[sessionId]=true;
      _magilRenderDeep(det, r);
    }, function(){ det.innerHTML='<p class="muted center">नेटवर्क त्रुटी.</p>'; }, sessionId, (G.emp&&G.emp.id)||'');
  }
}

function _magilRenderDeep(det, r){
  var html = '';
  var sid = r.sessionId || det.id.replace('detail_','');
  var isBus = r.mode === 'bus';
  if (r.units && r.units.length){
    r.units.forEach(function(u, idx){
      var delBtn = isBus ? ' <span onclick="event.stopPropagation();_magilDeleteBus(\''+sid+'\','+idx+',this)" style="color:var(--err);cursor:pointer;font-size:13px" title="हटवा">✕</span>' : '';
      html += '<div class="dt-sec">'+esc(u.label||'')+delBtn+'</div>';
      (u.items||[]).forEach(function(it){
        html += '<div class="dt-row"><span>'+esc(it.q)+'</span><strong style="color:'+(it.answer==='होय'?'var(--ok)':'var(--err)')+'">'+esc(it.answer)+'</strong></div>';
        if (it.answer==='नाही' && it.remark) {
          html += '<div class="dt-row" style="padding-left:8px;color:var(--err)"><span>↳ शेरा: '+esc(it.remark)+'</span></div>';
        }
      });
    });
  } else {
    html = '<p class="muted center">तपशील उपलब्ध नाहीत.</p>';
  }
  det.innerHTML = html;
}

function _magilDeleteBus(sessionId, busIdx, el){
  if(!confirm('🗑 ही बस एन्ट्री हटवायची?')) return;
  gRun('deleteBusEntry',function(resStr){
    var r;try{r=JSON.parse(resStr);}catch(e){return;}
    if(r.ok){
      toast(r.msg||'🗑 बस हटवली.','success',3000);
      delete _magilDeepLoaded[sessionId];
      var card=document.querySelector('.magil-card[data-session="'+sessionId+'"]');
      if(card){
        var det=card.querySelector('.magil-detail');
        if(det){ det.innerHTML='<p class="muted center">⏳ ताजी माहिती लोड होत आहे...</p>'; }
        var sub=card.querySelector('.magil-card-sub');
        if(sub && r.remaining!==undefined){
          sub.innerHTML=sub.innerHTML.replace(/\d+\s*बस/,''+r.remaining+' बस');
        }
        gRun('getSessionDetail',function(res2){
          var r2;try{r2=JSON.parse(res2);}catch(e){return;}
          if(r2.ok){_magilDeepLoaded[sessionId]=true;_magilRenderDeep(det,r2);}
        },function(){},sessionId,(G.emp&&G.emp.id)||'');
      }
    }else{
      toast(r.msg||'हटवता आले नाही.','error');
    }
  },function(){toast('नेटवर्क त्रुटी.','error');},sessionId,busIdx,(G.emp&&G.emp.id)||'');
}

function magilRequestPDF(sessionId, btnEl){
  if (!_guardBtn('pdf_'+sessionId,3000)) return;
  _magilGenerating[sessionId]=true;
  if (btnEl){ btnEl.disabled=true; btnEl.classList.add('generating'); btnEl.textContent='⏳ तयार होत आहे'; }
  gRun('generateSessionPdf', function(resStr){
    delete _magilGenerating[sessionId];
    var r; try{r=JSON.parse(resStr);}catch(e){ _magilPdfError(btnEl); return; }
    if (r && r.ok && r.pdfUrl){
      var card = document.querySelector('.magil-card[data-session="'+sessionId+'"]');
      if (card){
        var actions = card.querySelector('.magil-card-actions > div');
        if (actions){
          var oldBtn = actions.querySelector('.magil-pdf-btn');
          if (oldBtn) oldBtn.outerHTML = '<a href="'+esc(r.pdfUrl)+'" target="_blank" rel="noopener" class="magil-pdf-btn">📄 PDF</a>';
        }
      }
      toast('✅ PDF तयार झाली!','success',2500);
    } else {
      _magilPdfError(btnEl, r&&r.msg);
    }
  }, function(){ delete _magilGenerating[sessionId]; _magilPdfError(btnEl); }, sessionId, (G.emp&&G.emp.id)||'');
}
function _magilPdfError(btnEl, msg){
  if (btnEl){ btnEl.disabled=false; btnEl.classList.remove('generating'); btnEl.textContent='📄 तयार करा'; }
  toast(msg||'PDF तयार करता आली नाही.','error',4000);
}

function _magilShowSkeleton(){
  var list=document.getElementById('magilList');
  var sk='';
  for (var i=0;i<3;i++){
    sk += '<div class="magil-skeleton"><div class="magil-skel-line wide"></div><div class="magil-skel-line mid"></div><div class="magil-skel-line short"></div></div>';
  }
  list.innerHTML = sk;
}
function _magilShowEmpty(msg){
  var list=document.getElementById('magilList');
  list.innerHTML =
    '<div class="magil-empty">'+
      '<div class="magil-empty-icon">📂</div>'+
      '<p class="magil-empty-title">'+(msg?esc(msg):'कोणतेही अहवाल आढळले नाहीत')+'</p>'+
      '<p class="magil-empty-sub">नवीन चेकलिस्ट भरल्यावर ती इथे दिसेल.</p>'+
    '</div>';
}
/* Transport-failure state: unlike the empty state, this offers a Retry action
   so a network hiccup / cold start can be recovered without leaving the screen. */
function _magilShowError(msg){
  var list=document.getElementById('magilList');
  list.innerHTML =
    '<div class="magil-empty">'+
      '<div class="magil-empty-icon">📡</div>'+
      '<p class="magil-empty-title">'+esc(msg||'नेटवर्क त्रुटी')+'</p>'+
      '<button class="btn" style="margin-top:12px" onclick="loadMagilReports()">🔄 पुन्हा प्रयत्न करा</button>'+
    '</div>';
}

/* === SEARCH MODAL === */
function openSearchModal(){
  showModal('searchModal');
  document.getElementById('srchToken').value='';
  document.getElementById('srchBus').value='';
  document.getElementById('srchType').value='';
  document.getElementById('srchDate').value='';
  document.getElementById('srchResults').innerHTML='<p class="muted center" style="padding:24px 0">टोकन, बस क्रमांक, तारीख किंवा प्रकार टाकून शोधा</p>';
  setTimeout(function(){ document.getElementById('srchToken').focus(); },200);
}
function clearSrchDate(){ document.getElementById('srchDate').value=''; }

function doSearch(){
  var token = document.getElementById('srchToken').value.trim();
  var bus   = document.getElementById('srchBus').value.trim();
  var type  = document.getElementById('srchType').value;
  var date  = document.getElementById('srchDate').value;
  if (!token && !bus && !type && !date){ toast('किमान एक निकष टाका.','error'); return; }
  var resEl = document.getElementById('srchResults');
  resEl.innerHTML = '<p class="muted center" style="padding:24px 0">🔍 शोधत आहे…</p>';
  gRun('searchReports', function(resStr){
    var r; try{r=JSON.parse(resStr);}catch(e){ resEl.innerHTML='<p class="muted center" style="padding:24px 0">त्रुटी.</p>'; return; }
    renderSearchRes(r);
  }, function(){ resEl.innerHTML='<p class="muted center" style="padding:24px 0">नेटवर्क त्रुटी.</p>'; }, token, bus, type, date, (G.emp && G.emp.id) || '');
}

function renderSearchRes(r){
  var resEl = document.getElementById('srchResults');
  if (!r || !r.ok || !r.results || !r.results.length){
    resEl.innerHTML = '<p class="muted center" style="padding:24px 0">कोणतेही निकाल आढळले नाहीत.</p>';
    return;
  }
  var html = r.results.map(function(x){
    var typeLbl = MAGIL_TYPE_LABEL[x.checklistKey] || x.checklistKey || '';
    var statusPill = x.status==='Completed' ? '<span class="rc-pill done">✅ पूर्ण</span>' : '<span class="rc-pill proc">⏳ अपूर्ण</span>';
    var pdfBtn = x.pdfUrl ? '<a href="'+esc(x.pdfUrl)+'" target="_blank" rel="noopener" class="pdf-btn">📄 PDF पहा</a>' : '';
    // FIX: searchPastInspections returns station,
    // supervisor, employeeId, and a single createdTime string — there are
    // no separate stn/name/id/date/time/busNumber fields, so every one of
    // these was always rendering blank. createdTime is split client-side
    // ("dd/MM/yyyy HH:mm:ss") same as the server already does internally.
    var dtParts = String(x.createdTime||'').split(' ');
    var dateDisp = dtParts[0] || '', timeDisp = dtParts[1] || '';
    var busTxt = (x.totalBuses > 0) ? (' · 🚌 '+esc(String(x.totalBuses))) : '';
    return (
      '<div class="res-card">'+
        '<div class="rc-hd"><span class="rc-title">'+esc(typeLbl)+'</span><span class="rc-time">'+esc(dateDisp)+' '+esc(timeDisp)+'</span></div>'+
        '<div class="rc-meta"><strong>'+esc(x.station||'')+'</strong> · '+esc(x.supervisor||'')+' ('+esc(x.employeeId||'')+')'+busTxt+'</div>'+
        statusPill+
        '<div class="rc-token">🎫 '+esc(x.tokenId||'')+'</div>'+
        (pdfBtn?('<div class="rc-actions">'+pdfBtn+'</div>'):'')+
      '</div>'
    );
  }).join('');
  resEl.innerHTML = html;
}

/* === UTILITIES === */
function onDateChange(el) {
  var badge = document.getElementById('backdateBadge');
  if (!badge) return;
  var todayVal = istDate();
  var isBackdate = el.value && el.value < todayVal;
  badge.style.display = isBackdate ? 'block' : 'none';
  // Reset any active session when date changes (avoid stale session from previous selection)
  if (G.sessionId) {
    G.sessionId = null; G.tokenId = null;
    G.doneUnits = []; G.doneBuses = []; G.unitIdx = 0; G.shiftCount = 0;
    toast('तारीख बदलली — नवीन नोंद सुरू होईल.', 'info', 2500);
  }
}

function istDate(){
  var d = new Date();
  var ist = new Date(d.getTime() + (d.getTimezoneOffset()*60000) + (5.5*3600000));
  return ist.getFullYear()+'-'+pad(ist.getMonth()+1)+'-'+pad(ist.getDate());
}
function pad(n){ return n<10?'0'+n:''+n; }

var _ESC_MAP = {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
var _ESC_RE = /[&<>"']/g;
function esc(s){ return String(s==null?'':s).replace(_ESC_RE, function(c){ return _ESC_MAP[c]; }); }

function spinnerHtml(){ return '<div class="spinner"></div>'; }

function showLoad(on){
  var ov=document.getElementById('loadOv');
  if (on) ov.classList.add('show'); else ov.classList.remove('show');
}

var _toastTimer = null;
function toast(msg, type, dur){
  var t = document.getElementById('toast');
  clearTimeout(_toastTimer);
  t.textContent = msg;
  t.className = (type||'info');
  // force reflow so re-triggering the same class restarts the transition
  void t.offsetWidth;
  t.classList.add('show');
  _toastTimer = setTimeout(function(){ t.classList.remove('show'); }, dur||3000);
}

function showModal(id){ var el=document.getElementById(id); if (el) el.classList.add('show'); }
function hideModal(id){ var el=document.getElementById(id); if (el) el.classList.remove('show'); }
function showDlg(id){ var el=document.getElementById(id); if (el) el.classList.add('show'); }
function hideDlg(id){ var el=document.getElementById(id); if (el) el.classList.remove('show'); }

/* Close autocomplete dropdowns / dismiss-on-outside-tap behaviour */
document.addEventListener('click', function(e){
  if (!e.target.closest('.ac-wrap')) hideAcLists();
});
document.addEventListener('touchstart', function(e){
  if (!e.target.closest('.ac-wrap')) hideAcLists();
}, {passive:true});

