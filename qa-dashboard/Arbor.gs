/**
 * Arbor integration: book scrutiny student sampler
 * -------------------------------------------------------------
 * Pulls the student population from Arbor's REST API (v2) and builds a
 * stratified sample of students for a class, or for every class in a
 * department, tagged with their codes: SEN, PP, FSM, CLA and flightpath.
 *
 * PRIVACY
 *   - Student data is fetched on demand and held only in CacheService
 *     (six hours). It is never written to the spreadsheet.
 *   - When a sample is attached to a scrutiny, only initials, year group
 *     and codes are stored (e.g. "J.S. Y8 · SEN K · PP · FP 5").
 *   - arborProbe() redacts names and contact fields before logging.
 *
 * SETUP (Project Settings > Script properties)
 *   ARBOR_SUBDOMAIN   e.g. "baysgarth"  (from https://baysgarth.uk.arbor.sc)
 *   ARBOR_USER        email of the Arbor API user
 *   ARBOR_KEY         that user's API key / password
 *   ARBOR_FLIGHTPATH  optional: where flightpath lives. One of:
 *                       udf:<user defined field name>   (default: udf:Flightpath)
 *                       tag:<tag name prefix>           e.g. tag:Flightpath
 *                       group:<custom group name prefix> e.g. group:Flightpath
 *                       none
 *   ARBOR_CLASS_RESOURCE  optional, default "teaching-groups"
 *
 * FIRST RUN: set the properties, then run arborProbe() from the editor and
 * read the log (View > Logs). It prints the shape of each resource so the
 * field mappings in ARBOR_MAP below can be corrected if your tenancy differs.
 */

const ARBOR = {
  base: function() {
    const p = PropertiesService.getScriptProperties();
    const sub = p.getProperty('ARBOR_SUBDOMAIN');
    return sub ? 'https://' + sub + '.uk.arbor.sc/rest-v2/' : '';
  },
  // Resource names. Change here if the probe shows a 404 for any of them.
  res: {
    students:        'students',
    persons:         'persons',
    academicYears:   'academic-years',
    yearGroups:      'academic-levels',
    yearMemberships: 'academic-level-memberships',
    classes:         null, // resolved from ARBOR_CLASS_RESOURCE, default teaching-groups
    classMemberships:null, // <classes singular>-memberships
    subjects:        'subjects',
    senStatuses:     'sen-statuses',
    senAssignments:  'sen-status-assignments',
    eligibilities:   'eligibilities',
    eligibilityRecs: 'eligibility-records',
    inCare:          'in-care-status-assignments',
    udfs:            'user-defined-fields',
    udfRecords:      'user-defined-records',
    tags:            'tags',
    taggings:        'taggings',
    customGroups:    'custom-groups',
    customGroupMems: 'custom-group-memberships'
  },
  // Paging. If the probe shows every page returning the same items, change
  // these parameter names to what your API expects.
  paging: { sizeParam: 'pageSize', indexParam: 'pageIndex', size: 200, first: 1, maxPages: 80 },
  cacheKey: 'arbor_snapshot_v1',
  cacheSeconds: 21600
};

// Candidate field names, tried in order. The first present wins.
const ARBOR_MAP = {
  firstName: ['legalFirstName', 'preferredFirstName', 'firstName'],
  lastName:  ['legalLastName', 'preferredLastName', 'lastName'],
  gender:    ['gender', 'sex'],
  udfValue:  ['value', 'content', 'textValue', 'stringValue', 'selectValue', 'optionValue', 'valueText'],
  label:     ['shortName', 'displayName', 'name', 'code', 'title'],
  startDate: ['startDate', 'startDatetime', 'effectiveDate'],
  endDate:   ['endDate', 'endDatetime']
};

function classResource_() {
  return PropertiesService.getScriptProperties().getProperty('ARBOR_CLASS_RESOURCE') || 'teaching-groups';
}
function classMembershipResource_() {
  const r = classResource_();
  return r.replace(/s$/, '') + '-memberships';
}

// ===================================================================
// HTTP
// ===================================================================
function arborConfigured_() {
  const p = PropertiesService.getScriptProperties();
  return !!(p.getProperty('ARBOR_SUBDOMAIN') && p.getProperty('ARBOR_USER') && p.getProperty('ARBOR_KEY'));
}

function arborGet_(resource, params) {
  const p = PropertiesService.getScriptProperties();
  const base = ARBOR.base();
  if (!base) throw new Error('Arbor is not configured. Add ARBOR_SUBDOMAIN, ARBOR_USER and ARBOR_KEY to Script properties.');
  const qs = Object.keys(params || {}).map(function(k){ return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); }).join('&');
  const url = base + resource + (qs ? '?' + qs : '');
  const res = UrlFetchApp.fetch(url, {
    method: 'get',
    muteHttpExceptions: true,
    headers: {
      Accept: 'application/json',
      Authorization: 'Basic ' + Utilities.base64Encode(p.getProperty('ARBOR_USER') + ':' + p.getProperty('ARBOR_KEY'))
    }
  });
  const code = res.getResponseCode();
  if (code === 401 || code === 403) throw new Error('Arbor refused the request (' + code + '). Check ARBOR_USER / ARBOR_KEY and that the API user has read access.');
  if (code === 404) throw new Error('Arbor resource not found: ' + resource + '. Adjust ARBOR.res in Arbor.gs.');
  if (code !== 200) throw new Error('Arbor returned ' + code + ' for ' + resource + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText() || '{}');
}

// Pull the array of entities out of a list response, whatever its root key.
function arborItems_(data) {
  if (Array.isArray(data)) return data;
  if (!data || typeof data !== 'object') return [];
  const keys = Object.keys(data);
  for (let i = 0; i < keys.length; i++) {
    if (Array.isArray(data[keys[i]])) return data[keys[i]];
  }
  return [];
}

// Fetch every page of a resource. Stops when a page is short, empty, or repeats.
function arborList_(resource, filters) {
  const out = [], seen = {};
  const pg = ARBOR.paging;
  for (let i = 0; i < pg.maxPages; i++) {
    const params = {};
    Object.keys(filters || {}).forEach(function(k){ params[k] = filters[k]; });
    params[pg.sizeParam] = pg.size;
    params[pg.indexParam] = pg.first + i;
    const items = arborItems_(arborGet_(resource, params));
    let fresh = 0;
    items.forEach(function(it){
      const k = it.href || it.id || JSON.stringify(it);
      if (!seen[k]) { seen[k] = 1; out.push(it); fresh++; }
    });
    if (!items.length || !fresh || items.length < pg.size) break;
  }
  return out;
}

// ===================================================================
// SMALL HELPERS
// ===================================================================
function idFrom_(x) {
  if (x == null) return '';
  if (typeof x === 'number') return String(x);
  if (typeof x === 'string') { const m = x.match(/\/(\d+)\/?$/); return m ? m[1] : x; }
  if (x.id != null) return String(x.id);
  if (x.href) return idFrom_(x.href);
  return '';
}
function pick_(obj, names) {
  if (!obj) return '';
  for (let i = 0; i < names.length; i++) {
    const v = obj[names[i]];
    if (v != null && v !== '') return (typeof v === 'object') ? pick_(v, ARBOR_MAP.label) : v;
  }
  return '';
}
function isCurrent_(rec, today) {
  const s = pick_(rec, ARBOR_MAP.startDate), e = pick_(rec, ARBOR_MAP.endDate);
  if (s && new Date(s) > today) return false;
  if (e && new Date(e) < today) return false;
  return true;
}
function initials_(first, last) {
  const f = String(first || '').trim(), l = String(last || '').trim();
  return (f ? f.charAt(0).toUpperCase() + '.' : '') + (l ? l.charAt(0).toUpperCase() + '.' : '');
}
function lookupByHref_(items) {
  const m = {};
  (items || []).forEach(function(it){ m[idFrom_(it)] = it; });
  return m;
}

// ===================================================================
// SNAPSHOT  (students + classes, cached six hours, never written to the sheet)
// ===================================================================
function buildArborSnapshot_() {
  const today = new Date();
  const res = ARBOR.res;
  const classRes = classResource_();
  const memRes = classMembershipResource_();

  // Current academic year (used to filter classes if they carry one)
  let currentYearId = '';
  try {
    arborList_(res.academicYears).forEach(function(y){ if (isCurrent_(y, today)) currentYearId = idFrom_(y); });
  } catch (e) {}

  // People and students
  const persons = lookupByHref_(arborList_(res.persons));
  const students = {};
  arborList_(res.students).forEach(function(s){
    const sid = idFrom_(s);
    const person = persons[idFrom_(s.person)] || s.person || s;
    students[sid] = {
      id: sid,
      first: pick_(person, ARBOR_MAP.firstName) || pick_(s, ARBOR_MAP.firstName),
      last:  pick_(person, ARBOR_MAP.lastName)  || pick_(s, ARBOR_MAP.lastName),
      gender: String(pick_(person, ARBOR_MAP.gender) || '').charAt(0).toUpperCase(),
      year: '', sen: '', pp: false, fsm: false, cla: false, fp: ''
    };
  });

  // Year groups
  try {
    const levels = lookupByHref_(arborList_(res.yearGroups));
    arborList_(res.yearMemberships).forEach(function(m){
      if (!isCurrent_(m, today)) return;
      const st = students[idFrom_(m.student)]; if (!st) return;
      const lvl = levels[idFrom_(m.academicLevel)] || m.academicLevel;
      st.year = String(pick_(lvl, ARBOR_MAP.label) || '').replace(/^Year\s+/i, 'Y');
    });
  } catch (e) {}

  // SEN status (K = SEN support, E = EHCP)
  try {
    const statuses = lookupByHref_(arborList_(res.senStatuses));
    arborList_(res.senAssignments).forEach(function(a){
      if (!isCurrent_(a, today)) return;
      const st = students[idFrom_(a.student)]; if (!st) return;
      const s = statuses[idFrom_(a.senStatus)] || a.senStatus || {};
      const code = String(s.code || s.senStatusCode || pick_(s, ARBOR_MAP.label) || '').trim();
      if (code && !/^N/i.test(code)) st.sen = code.length <= 2 ? code.toUpperCase() : (/EHC/i.test(code) ? 'E' : 'K');
    });
  } catch (e) {}

  // Pupil Premium and FSM (eligibility records)
  try {
    const elig = lookupByHref_(arborList_(res.eligibilities));
    arborList_(res.eligibilityRecs).forEach(function(r){
      if (!isCurrent_(r, today)) return;
      const st = students[idFrom_(r.student)]; if (!st) return;
      const e = elig[idFrom_(r.eligibility)] || r.eligibility || {};
      const name = String(pick_(e, ARBOR_MAP.label) || e.code || '');
      if (/pupil\s*premium|\bPP\b/i.test(name)) st.pp = true;
      if (/free\s*school\s*meal|\bFSM\b/i.test(name)) st.fsm = true;
    });
  } catch (e) {}

  // Children looked after
  try {
    arborList_(res.inCare).forEach(function(a){
      if (!isCurrent_(a, today)) return;
      const st = students[idFrom_(a.student)]; if (st) st.cla = true;
    });
  } catch (e) {}

  // Flightpath
  const fpCfg = String(PropertiesService.getScriptProperties().getProperty('ARBOR_FLIGHTPATH') || 'udf:Flightpath');
  const fpKind = fpCfg.split(':')[0].toLowerCase(), fpName = fpCfg.split(':').slice(1).join(':').trim();
  try {
    if (fpKind === 'udf' && fpName) {
      const fields = arborList_(res.udfs).filter(function(f){ return String(pick_(f, ARBOR_MAP.label)).toLowerCase() === fpName.toLowerCase(); });
      const fieldIds = {}; fields.forEach(function(f){ fieldIds[idFrom_(f)] = 1; });
      arborList_(res.udfRecords).forEach(function(r){
        if (!fieldIds[idFrom_(r.userDefinedField)]) return;
        const target = r.student || r.entity || r.object || r.person;
        const st = students[idFrom_(target)]; if (!st) return;
        st.fp = String(pick_(r, ARBOR_MAP.udfValue) || '').trim();
      });
    } else if (fpKind === 'tag' && fpName) {
      const tags = arborList_(res.tags).filter(function(t){ return String(pick_(t, ARBOR_MAP.label)).toLowerCase().indexOf(fpName.toLowerCase()) === 0; });
      const tagName = {}; tags.forEach(function(t){ tagName[idFrom_(t)] = String(pick_(t, ARBOR_MAP.label)).slice(fpName.length).replace(/^[\s:\-]+/, ''); });
      arborList_(res.taggings).forEach(function(tg){
        const nm = tagName[idFrom_(tg.tag)]; if (nm == null) return;
        const st = students[idFrom_(tg.student || tg.entity || tg.object)]; if (st) st.fp = nm;
      });
    } else if (fpKind === 'group' && fpName) {
      const groups = arborList_(res.customGroups).filter(function(g){ return String(pick_(g, ARBOR_MAP.label)).toLowerCase().indexOf(fpName.toLowerCase()) === 0; });
      const gName = {}; groups.forEach(function(g){ gName[idFrom_(g)] = String(pick_(g, ARBOR_MAP.label)).slice(fpName.length).replace(/^[\s:\-]+/, ''); });
      arborList_(res.customGroupMems).forEach(function(m){
        if (!isCurrent_(m, today)) return;
        const nm = gName[idFrom_(m.customGroup)]; if (nm == null) return;
        const st = students[idFrom_(m.student)]; if (st) st.fp = nm;
      });
    }
  } catch (e) {}

  // Classes and their members
  const subjects = {};
  try { arborList_(res.subjects).forEach(function(s){ subjects[idFrom_(s)] = String(pick_(s, ARBOR_MAP.label)); }); } catch (e) {}
  const classes = {};
  arborList_(classRes).forEach(function(c){
    if (currentYearId && c.academicYear && idFrom_(c.academicYear) !== currentYearId) return;
    const subj = c.subject ? (subjects[idFrom_(c.subject)] || pick_(c.subject, ARBOR_MAP.label)) :
      (c.academicUnit && c.academicUnit.subject ? (subjects[idFrom_(c.academicUnit.subject)] || pick_(c.academicUnit.subject, ARBOR_MAP.label)) : '');
    classes[idFrom_(c)] = { id: idFrom_(c), name: String(pick_(c, ARBOR_MAP.label)), subject: String(subj || ''), students: [] };
  });
  arborList_(memRes).forEach(function(m){
    if (!isCurrent_(m, today)) return;
    const cls = classes[idFrom_(m.teachingGroup || m.academicUnit || m.group || m.parent)];
    const sid = idFrom_(m.student);
    if (cls && students[sid] && cls.students.indexOf(sid) === -1) cls.students.push(sid);
  });

  return {
    builtAt: today.toISOString(),
    students: students,
    classes: Object.keys(classes).map(function(k){ return classes[k]; }).filter(function(c){ return c.students.length; })
      .sort(function(a, b){ return a.name.localeCompare(b.name); })
  };
}

// CacheService values are capped at 100KB, so the snapshot is chunked.
function cachePut_(key, str, secs) {
  const cache = CacheService.getScriptCache();
  const size = 90000, n = Math.ceil(str.length / size), payload = {};
  for (let i = 0; i < n; i++) payload[key + '_' + i] = str.slice(i * size, (i + 1) * size);
  payload[key + '_n'] = String(n);
  cache.putAll(payload, secs);
}
function cacheGet_(key) {
  const cache = CacheService.getScriptCache();
  const n = Number(cache.get(key + '_n') || 0);
  if (!n) return null;
  let s = '';
  for (let i = 0; i < n; i++) { const part = cache.get(key + '_' + i); if (part == null) return null; s += part; }
  return s;
}

function getArborSnapshot_(force) {
  if (!force) { const c = cacheGet_(ARBOR.cacheKey); if (c) return JSON.parse(c); }
  const snap = buildArborSnapshot_();
  cachePut_(ARBOR.cacheKey, JSON.stringify(snap), ARBOR.cacheSeconds);
  return snap;
}

// ===================================================================
// SUBJECT -> FACULTY MAPPING  (Arbor_Subjects tab: Subject, Faculty)
// ===================================================================
function subjectFacultyMap_(ss) {
  const m = {};
  readObjects_(ss, TAB.ARBOR_SUBJECTS).forEach(function(r){
    if (r.Subject) m[String(r.Subject).trim().toLowerCase()] = String(r.Faculty || '').trim();
  });
  return m;
}
function facultyOfClass_(cls, map) {
  const key = String(cls.subject || '').trim().toLowerCase();
  if (map[key]) return map[key];
  return cls.subject || '';   // unmapped: fall back to the subject name itself
}

// ===================================================================
// SAMPLER
//   Stratified: covers SEN, PP, CLA and each flightpath band first, then
//   fills at random. Never repeats a student. Returns codes for display.
// ===================================================================
function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function codesOf_(st) {
  const c = [];
  if (st.sen) c.push('SEN ' + st.sen);
  if (st.pp) c.push('PP');
  if (st.fsm && !st.pp) c.push('FSM');
  if (st.cla) c.push('CLA');
  if (st.fp) c.push('FP ' + st.fp);
  return c;
}
function studentView_(st) {
  return { id: st.id, name: (st.first + ' ' + st.last).trim(), initials: initials_(st.first, st.last),
    year: st.year, gender: st.gender, sen: st.sen, pp: st.pp, fsm: st.fsm, cla: st.cla, fp: st.fp, codes: codesOf_(st) };
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
  // flightpath bands present in this pool, lowest and highest first
  const bands = {}; cands.forEach(function(s){ if (s.fp) bands[s.fp] = 1; });
  const bandList = Object.keys(bands).sort(function(a, b){ return (parseFloat(a) || 0) - (parseFloat(b) || 0) || a.localeCompare(b); });
  const bandOrder = [];
  if (bandList.length) { bandOrder.push(bandList[0]); if (bandList.length > 1) bandOrder.push(bandList[bandList.length - 1]); bandList.slice(1, -1).forEach(function(b){ bandOrder.push(b); }); }

  take(function(s){ return !!s.sen; });
  take(function(s){ return s.pp; });
  take(function(s){ return s.cla; });
  bandOrder.forEach(function(b){ take(function(s){ return s.fp === b; }); });
  take(function(s){ return !s.sen && !s.pp && !s.cla; });   // one with no flags, for contrast
  while (chosen.length < n && take(function(){ return true; })) {}
  return chosen.map(studentView_);
}

// ===================================================================
// PUBLIC (called from the web app)
// ===================================================================
function arborStatus() {
  currentEmail_();
  if (!arborConfigured_()) return { configured: false };
  const cached = cacheGet_(ARBOR.cacheKey);
  if (!cached) return { configured: true, built: false };
  const snap = JSON.parse(cached);
  const ss = SpreadsheetApp.openById(SS_ID);
  const map = subjectFacultyMap_(ss);
  const unmapped = unique_(snap.classes.map(function(c){ return c.subject; }).filter(function(s){ return s && !map[s.toLowerCase()]; }));
  return { configured: true, built: true, builtAt: snap.builtAt, students: Object.keys(snap.students).length, classes: snap.classes.length, unmappedSubjects: unmapped };
}

// Admin only: rebuild the cache from Arbor now.
function arborRefresh() {
  requireAdmin_();
  const snap = getArborSnapshot_(true);
  return { ok: true, builtAt: snap.builtAt, students: Object.keys(snap.students).length, classes: snap.classes.length };
}

// Classes, optionally limited to one faculty via the Arbor_Subjects mapping.
function arborClasses(faculty) {
  currentEmail_();
  const snap = getArborSnapshot_(false);
  const map = subjectFacultyMap_(SpreadsheetApp.openById(SS_ID));
  faculty = String(faculty || '').trim().toLowerCase();
  return snap.classes.map(function(c){
    return { id: c.id, name: c.name, subject: c.subject, faculty: facultyOfClass_(c, map), size: c.students.length };
  }).filter(function(c){ return !faculty || String(c.faculty).toLowerCase() === faculty; });
}

// One class sample. exclude = student ids to leave out when regenerating.
function arborSample(classId, n, exclude) {
  currentEmail_();
  n = Math.max(1, Math.min(20, Number(n) || 6));
  const snap = getArborSnapshot_(false);
  const cls = snap.classes.filter(function(c){ return c.id === String(classId); })[0];
  if (!cls) throw new Error('Class not found in the Arbor data. Try refreshing.');
  const pool = cls.students.map(function(id){ return snap.students[id]; }).filter(Boolean);
  return { classId: cls.id, className: cls.name, subject: cls.subject, size: pool.length, students: sampleFrom_(pool, n, exclude) };
}

// Every class in a faculty, sampled. SLT and heads of department only.
function arborDepartmentSamples(faculty, n) {
  const email = currentEmail_();
  if (!isAdmin_(email) && !isHOD_(email)) throw new Error('The department sampler is for SLT and heads of department.');
  if (!faculty) throw new Error('Choose a department.');
  n = Math.max(1, Math.min(20, Number(n) || 6));
  const snap = getArborSnapshot_(false);
  const map = subjectFacultyMap_(SpreadsheetApp.openById(SS_ID));
  const want = String(faculty).trim().toLowerCase();
  return snap.classes.filter(function(c){ return String(facultyOfClass_(c, map)).toLowerCase() === want; }).map(function(c){
    const pool = c.students.map(function(id){ return snap.students[id]; }).filter(Boolean);
    return { classId: c.id, className: c.name, subject: c.subject, size: pool.length, students: sampleFrom_(pool, n, []) };
  });
}

// Compact, low-identifiability text stored with a scrutiny record.
function sampleSummary_(students) {
  return (students || []).map(function(s){
    return [s.initials, s.year].filter(String).join(' ') + (s.codes && s.codes.length ? ' · ' + s.codes.join(' · ') : '');
  }).join('\n');
}

// ===================================================================
// DIAGNOSTIC  (run from the editor after setting the properties)
// ===================================================================
function arborProbe() {
  const out = [];
  const list = Object.keys(ARBOR.res).map(function(k){ return [k, ARBOR.res[k]]; })
    .concat([['classes', classResource_()], ['classMemberships', classMembershipResource_()]])
    .filter(function(p){ return p[1]; });
  list.forEach(function(p){
    try {
      const params = {}; params[ARBOR.paging.sizeParam] = 2; params[ARBOR.paging.indexParam] = ARBOR.paging.first;
      const data = arborGet_(p[1], params);
      const items = arborItems_(data);
      out.push('== ' + p[0] + ' (' + p[1] + '): root keys ' + JSON.stringify(Object.keys(data)) + ', ' + items.length + ' item(s) on page 1');
      if (items[0]) out.push(JSON.stringify(redact_(items[0]), null, 1).slice(0, 1500));
    } catch (e) { out.push('== ' + p[0] + ' (' + p[1] + '): ' + e.message); }
  });
  Logger.log(out.join('\n'));
  return out.join('\n');
}
function redact_(o) {
  if (Array.isArray(o)) return o.slice(0, 2).map(redact_);
  if (o && typeof o === 'object') {
    const r = {};
    Object.keys(o).forEach(function(k){
      r[k] = /name|email|phone|telephone|address|birth|upn|uln|nhs|postcode/i.test(k) && typeof o[k] === 'string' ? '<redacted>' : redact_(o[k]);
    });
    return r;
  }
  return o;
}
