/**
 * School data for the book scrutiny sampler
 * -------------------------------------------------------------
 * Reads pupil data through the Baysgarth Quest partner API, NOT from Arbor.
 * The school's data governance (CoPlanner docs/ARBOR_WAREHOUSE.md) has one
 * rule: a single governed feeder in the Baysgarth Quest backend owns the
 * Arbor credentials; every other app reads the BigQuery warehouse or the
 * Quest partner endpoints. This file follows that rule.
 *
 * ENDPOINTS USED (all POST, header x-partner-token)
 *   /api/v1/partner/learning-class  { classCode }
 *       -> every pupil in the class: name, year, flightpath, senStatus, eal.
 *          Tolerant class-code matching happens server-side. Served live,
 *          audited, never cached here.
 *   /api/v1/partner/warehouse        { table, where, limit }
 *       -> rows from school_data (students, class_memberships, staff).
 *          Capped at 2000 rows with no offset, so it is used only for
 *          targeted lookups, never to list the whole school.
 *
 * WHAT THE FEED CARRIES
 *   Flightpath, SEN status, EAL, year group, names. It does NOT carry Pupil
 *   Premium, FSM, CLA or gender: those are not in the warehouse contract.
 *   Adding them is a pipeline change on the Quest side and a DPO
 *   conversation first, never a second Arbor integration here.
 *
 * PRIVACY
 *   - Learning data is fetched live per request and never cached or written
 *     to the sheet. The response's SEN detail (category, notes,
 *     interventions, adjustments) is discarded immediately; only the status
 *     letter (K or E), EAL flag and flightpath are kept in memory.
 *   - A sample attached to a scrutiny stores initials, year and codes only,
 *     e.g. "J.S. Y8 · SEN K · EAL · FP Higher".
 *
 * SETUP (Project Settings > Script properties)
 *   QUEST_PARTNER_TOKEN  the shared PARTNER_TOKEN held in the baysgarth-quest
 *                        project's Secret Manager. Ask the Quest owner for it.
 *   QUEST_BASE_URL       optional, default https://baysgarth-quest.web.app
 */

const QUEST = {
  base: function() {
    const v = String(PropertiesService.getScriptProperties().getProperty('QUEST_BASE_URL') || '').replace(/\/+$/, '');
    return v || 'https://baysgarth-quest.web.app';
  },
  token: function() { return PropertiesService.getScriptProperties().getProperty('QUEST_PARTNER_TOKEN') || ''; },
  configured: function() { return !!QUEST.token(); },
  FLIGHTPATHS: ['Foundation', 'Intermediate', 'Higher', 'Excellence']
};

// ===================================================================
// HTTP
// ===================================================================
function questRequest_(path, body) {
  return {
    url: QUEST.base() + path,
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    headers: { 'x-partner-token': QUEST.token() },
    payload: JSON.stringify(body || {})
  };
}
function questParse_(res, label) {
  const code = res.getResponseCode();
  let data = {};
  try { data = JSON.parse(res.getContentText() || '{}'); } catch (e) {}
  if (code === 401) throw new Error('Baysgarth Quest refused the partner token. Check QUEST_PARTNER_TOKEN.');
  if (code === 404) throw new Error(data.message || data.error || (label + ' not found.'));
  if (code !== 200) throw new Error('Baysgarth Quest returned ' + code + (data.message || data.error ? ': ' + (data.message || data.error) : '') + '.');
  return data;
}
function questPost_(path, body, label) {
  if (!QUEST.configured()) throw new Error('School data is not connected. Add QUEST_PARTNER_TOKEN to Script properties.');
  return questParse_(UrlFetchApp.fetch(questRequest_(path, body).url, questRequest_(path, body)), label);
}
// Several classes at once (department sampler). Errors per class, not fatal.
function questPostAll_(path, bodies, label) {
  if (!QUEST.configured()) throw new Error('School data is not connected. Add QUEST_PARTNER_TOKEN to Script properties.');
  const reqs = bodies.map(function(b){ return questRequest_(path, b); });
  const out = [];
  for (let i = 0; i < reqs.length; i += 10) {   // small batches: the partner function is instance-capped
    const responses = UrlFetchApp.fetchAll(reqs.slice(i, i + 10));
    responses.forEach(function(res){
      try { out.push({ ok: true, data: questParse_(res, label) }); }
      catch (e) { out.push({ ok: false, error: e.message }); }
    });
  }
  return out;
}

// ===================================================================
// NORMALISE  (keep the minimum; discard SEN detail straight away)
// ===================================================================
function senLetter_(status) {
  const s = String(status || '').trim();
  if (!s) return '';
  if (/ehc|education,? health/i.test(s)) return 'E';
  if (/^e$/i.test(s)) return 'E';
  return 'K';   // "SEN Support", "K", or any other genuine SEN status
}
function flightpathBand_(v) {
  const s = String(v || '').trim();
  if (!s) return '';
  for (let i = 0; i < QUEST.FLIGHTPATHS.length; i++) {
    if (s.toLowerCase().indexOf(QUEST.FLIGHTPATHS[i].toLowerCase()) === 0) return QUEST.FLIGHTPATHS[i];
  }
  return s;
}
function pupilFromPartner_(p, idx) {
  const name = String(p.name || '').trim();
  const parts = name.split(/\s+/);
  return {
    id: String(p.email || (name + '|' + idx)),
    name: name,
    initials: initials_(parts[0], parts.length > 1 ? parts[parts.length - 1] : ''),
    year: p.year != null && p.year !== '' ? 'Y' + p.year : '',
    sen: senLetter_(p.senStatus),
    eal: !!p.eal,
    fp: flightpathBand_(p.flightpath)
  };
}
function initials_(first, last) {
  const f = String(first || '').trim(), l = String(last || '').trim();
  return (f ? f.charAt(0).toUpperCase() + '.' : '') + (l ? l.charAt(0).toUpperCase() + '.' : '');
}

// Class members with the fields above, plus the resolved class code.
function fetchClass_(classCode) {
  const d = questPost_('/api/v1/partner/learning-class', { classCode: String(classCode || '').trim() }, 'Class');
  return {
    classCode: d.classCode || classCode, typed: d.typed || classCode, matchedBy: d.matchedBy || 'exact',
    size: Number(d.classSize) || (d.pupils || []).length,
    pupils: (d.pupils || []).map(pupilFromPartner_)
  };
}

// ===================================================================
// CLASS LIST  (Classes tab: ClassCode, Faculty; optional Teacher)
//   The warehouse gateway cannot enumerate classes (2000-row cap, no
//   offset), so departments keep a short list here. Faculty is inferred
//   from the code where the tab leaves it blank, via the Arbor_Subjects
//   tab (Subject abbreviation or name -> Faculty).
// ===================================================================
function subjectOfCode_(code) {
  const c = String(code || '').trim();
  let m = c.match(/\/([A-Za-z]+)\d*[A-Za-z]?$/);        // 10X/En1 -> En
  if (m) return m[1];
  m = c.match(/^\d{1,2}[A-Za-z]?\d*\s+(.+)$/);           // 10X1 Science -> Science
  if (m) return m[1].trim();
  return '';
}
function facultyOfCode_(code, map) {
  const subj = subjectOfCode_(code).toLowerCase();
  return (subj && map[subj]) || '';
}
function subjectFacultyMap_(ss) {
  const m = {};
  readObjects_(ss, TAB.ARBOR_SUBJECTS).forEach(function(r){
    if (r.Subject) m[String(r.Subject).trim().toLowerCase()] = String(r.Faculty || '').trim();
  });
  return m;
}
function knownClasses_(ss) {
  const map = subjectFacultyMap_(ss);
  return readObjects_(ss, TAB.CLASSES).map(function(r){
    const code = String(r.ClassCode || r.Code || '').trim();
    return { code: code, faculty: String(r.Faculty || '').trim() || facultyOfCode_(code, map), teacher: String(r.Teacher || '').trim() };
  }).filter(function(c){ return c.code; });
}

// ===================================================================
// SAMPLER
//   Stratified: SEN, EAL and each flightpath band first (lowest and highest
//   before the middle), one pupil with no flags for contrast, then random.
// ===================================================================
function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function codesOf_(st) {
  const c = [];
  if (st.sen) c.push('SEN ' + st.sen);
  if (st.eal) c.push('EAL');
  if (st.fp) c.push('FP ' + st.fp);
  return c;
}
function studentView_(st) {
  return { id: st.id, name: st.name, initials: st.initials, year: st.year, sen: st.sen, eal: st.eal, fp: st.fp, codes: codesOf_(st) };
}
function sampleFrom_(pool, n, exclude) {
  const ex = {}; (exclude || []).forEach(function(id){ ex[String(id)] = 1; });
  const cands = shuffle_(pool.filter(function(s){ return !ex[s.id]; }));
  const chosen = [], have = {};
  function take(pred) {
    for (let i = 0; i < cands.length && chosen.length < n; i++) {
      if (!have[cands[i].id] && pred(cands[i])) { have[cands[i].id] = 1; chosen.push(cands[i]); return true; }
    }
    return false;
  }
  const present = QUEST.FLIGHTPATHS.filter(function(b){ return cands.some(function(s){ return s.fp === b; }); });
  const bandOrder = [];
  if (present.length) { bandOrder.push(present[0]); if (present.length > 1) bandOrder.push(present[present.length - 1]); present.slice(1, -1).forEach(function(b){ bandOrder.push(b); }); }
  cands.forEach(function(s){ if (s.fp && QUEST.FLIGHTPATHS.indexOf(s.fp) === -1 && bandOrder.indexOf(s.fp) === -1) bandOrder.push(s.fp); });

  take(function(s){ return s.sen === 'E'; });
  take(function(s){ return s.sen === 'K'; });
  take(function(s){ return s.eal; });
  bandOrder.forEach(function(b){ take(function(s){ return s.fp === b; }); });
  take(function(s){ return !s.sen && !s.eal; });
  while (chosen.length < n && take(function(){ return true; })) {}
  return chosen.map(studentView_);
}

// ===================================================================
// PUBLIC (called from the web app)
// ===================================================================
function schoolDataStatus() {
  currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  const classes = knownClasses_(ss);
  return { configured: QUEST.configured(), source: 'Baysgarth Quest partner API', classes: classes,
    fields: ['Year', 'SEN (K/E)', 'EAL', 'Flightpath'], missing: ['PP', 'FSM', 'CLA', 'Gender'] };
}

// One class, sampled live. exclude = ids to leave out when swapping.
function sampleClass(classCode, n, exclude) {
  currentEmail_();
  if (!String(classCode || '').trim()) throw new Error('Type a class code, for example 10Y/En1.');
  n = Math.max(1, Math.min(20, Number(n) || 6));
  const cls = fetchClass_(classCode);
  return { classCode: cls.classCode, typed: cls.typed, matchedBy: cls.matchedBy, size: cls.size, students: sampleFrom_(cls.pupils, n, exclude) };
}

// Every listed class in a faculty (or the codes supplied), sampled live.
// SLT and heads of department only.
function departmentSamples(faculty, codes, n) {
  const email = currentEmail_();
  if (!isAdmin_(email) && !isHOD_(email)) throw new Error('The department sampler is for SLT and heads of department.');
  n = Math.max(1, Math.min(20, Number(n) || 6));
  let list = (codes || []).map(function(c){ return String(c || '').trim(); }).filter(String);
  if (!list.length && faculty) {
    const want = String(faculty).trim().toLowerCase();
    list = knownClasses_(SpreadsheetApp.openById(SS_ID)).filter(function(c){ return c.faculty.toLowerCase() === want; }).map(function(c){ return c.code; });
  }
  list = unique_(list).slice(0, 60);
  if (!list.length) throw new Error('No class codes for ' + (faculty || 'that department') + '. Add them to the Classes tab or type them in.');
  const results = questPostAll_('/api/v1/partner/learning-class', list.map(function(c){ return { classCode: c }; }), 'Class');
  return list.map(function(code, i){
    const r = results[i];
    if (!r || !r.ok) return { classCode: code, error: (r && r.error) || 'No response', size: 0, students: [] };
    const d = r.data;
    const pupils = (d.pupils || []).map(pupilFromPartner_);
    return { classCode: d.classCode || code, typed: code, size: Number(d.classSize) || pupils.length, students: sampleFrom_(pupils, n, []) };
  });
}

// Compact, low-identifiability text stored with a scrutiny record.
function sampleSummary_(students) {
  return (students || []).map(function(s){
    return [s.initials, s.year].filter(String).join(' ') + (s.codes && s.codes.length ? ' · ' + s.codes.join(' · ') : '');
  }).join('\n');
}

// ===================================================================
// DIAGNOSTIC  (run from the editor after setting the token)
// ===================================================================
function schoolDataProbe(classCode) {
  const tables = questPost_('/api/v1/partner/warehouse', { table: '_list' }, 'Warehouse');
  Logger.log('Warehouse tables: ' + JSON.stringify(tables.tables || tables));
  const cls = fetchClass_(classCode || '10Y/En1');
  Logger.log('Class ' + cls.classCode + ' (typed ' + cls.typed + ', matched ' + cls.matchedBy + '): ' + cls.size + ' pupils; first pupil fields kept: ' +
    JSON.stringify(cls.pupils[0] ? { year: cls.pupils[0].year, sen: cls.pupils[0].sen, eal: cls.pupils[0].eal, fp: cls.pupils[0].fp } : null));
  return 'ok';
}
