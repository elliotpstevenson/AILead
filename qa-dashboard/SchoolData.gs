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
 *   /api/v1/partner/warehouse        { table, distinct } / { table, where }
 *       -> rows from school_data (students, class_memberships, staff).
 *          distinct: "class_code" lists the school's class codes in one call.
 *          Row queries are capped at 2000 with no offset, so they are used
 *          only for targeted lookups, never to walk the whole school.
 *
 * WHAT THE FEED CARRIES
 *   Year group, flightpath, SEN status, EAL, Pupil Premium and looked-after.
 *   Pupil Premium is Ever 6 (the funded cohort, read from Arbor's recipient
 *   records), so it already covers FSM for scrutiny purposes. Looked-after is
 *   present tense: in care now, not ever. Gender is not in the feed.
 *   Each flag is true, false or null, and null means "not known" rather than
 *   "no": a pupil is only ever shown as PP or CLA on a true.
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
    // Strictly true. The feed distinguishes false from null ("not known"),
    // and a pupil must never be shown as disadvantaged on a null.
    pp: p.pupilPremium === true,
    cla: p.lookedAfter === true,
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
/* Every class code in the school, from the warehouse in one call. Class codes
   are not pupil data, so the list is cached for six hours rather than fetched
   on every page load. Returns [] if the call fails, so the Classes tab and
   typed codes still work.

   class_memberships_current is preferred where the warehouse has it: the plain
   table carries previous cohorts too, and a sampler offering last year's
   classes sends an observer to a register that no longer exists. Falls back to
   class_memberships so this keeps working on a warehouse without the view. */
const CLASS_TABLES = ['class_memberships_current', 'class_memberships'];

function warehouseClassCodes_(force) {
  const cache = CacheService.getScriptCache();
  if (!force) {
    const hit = cache.get('qa_class_codes');
    if (hit) { try { return JSON.parse(hit); } catch (e) {} }
  }
  let codes = [];
  for (let i = 0; i < CLASS_TABLES.length && !codes.length; i++) {
    try {
      const d = questPost_('/api/v1/partner/warehouse', { table: CLASS_TABLES[i], distinct: 'class_code', limit: 2000 }, 'Warehouse');
      codes = (d.rows || []).map(function(r){ return String(r.class_code || '').trim(); }).filter(String);
    } catch (e) { /* table missing or query refused: try the next one */ }
  }
  if (!codes.length) return [];
  cache.put('qa_class_codes', JSON.stringify(codes), 21600);
  return codes;
}

// The class list offered in the app: every warehouse code, with the Classes
// tab layered on top so a department can pin a faculty or a teacher to a code.
function knownClasses_(ss, force) {
  const map = subjectFacultyMap_(ss);
  const pinned = {};
  readObjects_(ss, TAB.CLASSES).forEach(function(r){
    const code = String(r.ClassCode || r.Code || '').trim();
    if (code) pinned[code] = { faculty: String(r.Faculty || '').trim(), teacher: String(r.Teacher || '').trim() };
  });
  const codes = unique_(warehouseClassCodes_(force).concat(Object.keys(pinned)));
  return codes.map(function(code){
    const p = pinned[code] || {};
    return { code: code, faculty: p.faculty || facultyOfCode_(code, map), teacher: p.teacher || '' };
  });
}

// ===================================================================
/* SAMPLER

   The ability spread is the spine of the sample; need decides who fills it.

   Slots are dealt across the flightpath bands in the order lower, middle, top,
   then any remaining bands, cycling until the sample is full. So a scrutiny
   always sees work from across the range rather than from wherever the flags
   happen to sit, and a sample of three is still bottom, middle and top.

   Within each band the pupil with the greatest need is taken: EHCP first, then
   SEN support, then the disadvantage and language indicators. An indicator the
   sample does not yet carry is worth more than one it already has, so PP, CLA
   and EAL land on pupils who are also answering the band rather than costing a
   slot of their own. They are covered where they can be, not guaranteed: if
   the only EAL pupil in a class sits in a band already filled by an EHCP
   pupil, the EHCP pupil is the right answer and EAL is missed.

   Pupils with no flightpath are dealt last in each round, so they are still
   sampled without displacing the spread.
   =================================================================== */

// Need weighting. EHCP outranks everything; the indicators stack beneath it.
const NEED_SEN = { E: 100, K: 60 };
const NEED_IND = { pp: 25, cla: 20, eal: 15 };
// What an indicator is worth when the sample does not carry it yet. Sized to
// beat any single indicator but never to outrank an EHCP.
const NEED_UNCOVERED = 40;
function shuffle_(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); const t = a[i]; a[i] = a[j]; a[j] = t; }
  return a;
}
function codesOf_(st) {
  const c = [];
  if (st.sen) c.push('SEN ' + st.sen);
  if (st.pp) c.push('PP');
  if (st.cla) c.push('CLA');
  if (st.eal) c.push('EAL');
  if (st.fp) c.push('FP ' + st.fp);
  return c;
}
function studentView_(st) {
  return { id: st.id, name: st.name, initials: st.initials, year: st.year,
    sen: st.sen, pp: st.pp, cla: st.cla, eal: st.eal, fp: st.fp, codes: codesOf_(st) };
}
// The indicators a pupil carries, for coverage. SEN counts as one whether it
// is an EHCP or SEN support; the difference is in the weighting, not here.
function indicatorsOf_(s) {
  const out = [];
  if (s.sen) out.push('sen');
  if (s.pp) out.push('pp');
  if (s.cla) out.push('cla');
  if (s.eal) out.push('eal');
  return out;
}
function needScore_(s, covered) {
  let score = NEED_SEN[s.sen] || 0;
  if (s.pp) score += NEED_IND.pp;
  if (s.cla) score += NEED_IND.cla;
  if (s.eal) score += NEED_IND.eal;
  indicatorsOf_(s).forEach(function(k){ if (!covered[k]) score += NEED_UNCOVERED; });
  return score;
}

/* The order bands are dealt in: lower, middle, top, then any bands left over.
   Stated in that order because it is the order that survives a small sample —
   at three pupils it gives bottom, middle and top rather than the bottom three. */
function bandOrder_(present) {
  if (present.length < 3) return present.slice();
  const middles = present.slice(1, -1);
  return [present[0], middles[0], present[present.length - 1]].concat(middles.slice(1));
}

function sampleFrom_(pool, n, exclude) {
  const ex = {}; (exclude || []).forEach(function(id){ ex[String(id)] = 1; });
  const cands = shuffle_(pool.filter(function(s){ return !ex[s.id]; }));
  if (!cands.length) return [];

  // Bands actually present in this class, lowest first in the school's order.
  const present = QUEST.FLIGHTPATHS.filter(function(b){ return cands.some(function(s){ return s.fp === b; }); });
  cands.forEach(function(s){ if (s.fp && present.indexOf(s.fp) === -1) present.push(s.fp); });
  const order = bandOrder_(present);
  // Pupils with no flightpath are dealt after the banded ones, not excluded.
  if (cands.some(function(s){ return !s.fp; })) order.push('');

  const chosen = [], taken = {}, covered = {};
  // Highest need in this band that is not already in the sample. cands is
  // shuffled and the comparison is strict, so equal need breaks randomly.
  function bestIn(band) {
    let best = null, bestScore = -1;
    for (let i = 0; i < cands.length; i++) {
      const s = cands[i];
      if (taken[s.id] || s.fp !== band) continue;
      const score = needScore_(s, covered);
      if (score > bestScore) { best = s; bestScore = score; }
    }
    return best;
  }

  // Deal a pupil per band, round by round, until the sample is full or the
  // class runs out. A round that takes nobody ends it, so this always stops.
  let dealt = true;
  while (chosen.length < n && dealt) {
    dealt = false;
    for (let i = 0; i < order.length && chosen.length < n; i++) {
      const s = bestIn(order[i]);
      if (!s) continue;
      taken[s.id] = 1;
      chosen.push(s);
      indicatorsOf_(s).forEach(function(k){ covered[k] = 1; });
      dealt = true;
    }
  }
  return chosen.map(studentView_);
}

// ===================================================================
// PUBLIC (called from the web app)
// ===================================================================
function schoolDataStatus(force) {
  currentEmail_();
  if (!QUEST.configured()) return { configured: false, classes: [] };
  const ss = SpreadsheetApp.openById(SS_ID);
  const classes = knownClasses_(ss, force === true);
  const unmapped = unique_(classes.filter(function(c){ return !c.faculty; }).map(function(c){ return subjectOfCode_(c.code); }).filter(String));
  return { configured: true, source: 'Baysgarth Quest partner API', classes: classes,
    fields: ['Year', 'SEN (K/E)', 'PP', 'CLA', 'EAL', 'Flightpath'], missing: ['Gender'],
    unmappedSubjects: unmapped.sort() };
}

// Admin only: drop the cached class list and fetch it again.
function refreshClassList() {
  requireAdmin_();
  const codes = warehouseClassCodes_(true);
  return { ok: true, classes: codes.length };
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
    list = knownClasses_(SpreadsheetApp.openById(SS_ID)).filter(function(c){ return String(c.faculty).toLowerCase() === want; }).map(function(c){ return c.code; });
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
  const listed = questPost_('/api/v1/partner/warehouse', { table: '_list' }, 'Warehouse');
  const tables = listed.tables || [];
  Logger.log('Warehouse tables: ' + JSON.stringify(tables));
  Logger.log('Class list source: ' + (CLASS_TABLES.filter(function(t){ return tables.indexOf(t) !== -1; })[0] || 'none found'));
  const codes = warehouseClassCodes_(true);
  Logger.log('Class codes from the warehouse: ' + codes.length + (codes.length ? ' (e.g. ' + codes.slice(0, 5).join(', ') + ')' : ''));

  // Setup detail, kept out of the app itself: which subject codes still need
  // a row in Arbor_Subjects before their classes group under a faculty.
  const unmapped = schoolDataStatus().unmappedSubjects || [];
  Logger.log('Subject codes with no faculty (Arbor_Subjects tab): ' + (unmapped.length ? unmapped.length + ' — ' + unmapped.join(', ') : 'none'));

  const cls = fetchClass_(classCode || codes[0] || '10Y/En1');
  // Counts only. Nothing here identifies a pupil, so the log stays safe to paste.
  const n = cls.pupils.length;
  const count = function(pred){ return cls.pupils.filter(pred).length; };
  Logger.log('Class ' + cls.classCode + ' (typed ' + cls.typed + ', matched ' + cls.matchedBy + '): ' + cls.size + ' on roll, ' + n + ' returned.');
  Logger.log('Flags present: SEN ' + count(function(p){ return !!p.sen; })
    + ', PP ' + count(function(p){ return p.pp; })
    + ', CLA ' + count(function(p){ return p.cla; })
    + ', EAL ' + count(function(p){ return p.eal; })
    + ', with a flightpath ' + count(function(p){ return !!p.fp; })
    + ', bands seen: ' + (unique_(cls.pupils.map(function(p){ return p.fp; }).filter(String)).join(', ') || 'none'));
  return 'ok';
}
