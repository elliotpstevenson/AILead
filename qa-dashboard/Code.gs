/**
 * Baysgarth Lesson Drop-In Tracker
 * -------------------------------------------------------------
 * Staff open the web app, complete a drop-in observation, save.
 * SLT (admins) see every result collated on a single dashboard:
 * RAG per criterion, staff who need the most support, weakest
 * criteria across the school (CPD priorities), and free-text
 * next steps.
 *
 * Criteria are stored dynamically so Heads of Faculty can add
 * bespoke criteria without breaking anything. Scores are stored
 * long-format (one row per criterion per observation).
 *
 * DEPLOYMENT (important):
 *   Deploy > New deployment > Web app
 *   - Execute as:      Me  (the owner)
 *   - Who has access:  Anyone within <your Workspace domain>
 * This lets staff submit without direct sheet access, while still
 * capturing their real email via Session.getActiveUser().
 *
 * FIRST RUN: paste the spreadsheet ID below, then run setup() once.
 */

// Paste the ID of the backing Google Sheet here (the long string in its URL).
// Kept as a placeholder in the repository so the live sheet is not exposed.
const SS_ID = 'PASTE_SPREADSHEET_ID_HERE';

const TAB = {
  OBS:      'Observations',
  SCORES:   'Obs_Scores',
  CRITERIA: 'Criteria',
  STAFF:    'Staff',
  ADMINS:   'Admins',
  LEADS:    'Leads',
  CONFIG:   'Config',
  DRAFTS:   'Drafts',
  COACHES:  'Coaches'
};

const RAG = ['Green', 'Amber', 'Red'];

// Staff emails follow first.last@DOMAIN. Derived from the name unless an
// Email column is present in the Staff tab.
const STAFF_DOMAIN = 'baysgarthschool.co.uk';

function emailFromName_(first, last) {
  first = String(first || '').trim().toLowerCase();
  last = String(last || '').trim().toLowerCase();
  if (!first || !last) return '';
  // keep hyphens, drop spaces and other punctuation (e.g. "El Amin" -> "elamin")
  var clean = function(s){ return s.replace(/\s+/g, '').replace(/[^a-z0-9\-]/g, ''); };
  return clean(first) + '.' + clean(last) + '@' + STAFF_DOMAIN;
}

// Accepts either {Name, Email, Faculty} or {Legal First Name, Legal Last Name, Faculties}.
function normalizeStaff_(s) {
  var first = s['Legal First Name'] || s['First Name'] || '';
  var last  = s['Legal Last Name']  || s['Last Name']  || '';
  var name  = s.Name || (String(first).trim() + ' ' + String(last).trim()).trim();
  var faculty = s.Faculty || s.Faculties || '';
  var email = s.Email || emailFromName_(first, last);
  return { Name: name, Email: String(email).toLowerCase(), Faculty: String(faculty).trim() };
}

// A staff member can belong to more than one faculty, e.g. "MFL and Geography".
function splitFaculties_(v) {
  return String(v || '').split(/\s+and\s+|[,;/&]/i).map(function(x){ return x.trim(); }).filter(String);
}

const OBS_HEADERS = ['ObsID','Timestamp','ObserverEmail','ObserverName','TeacherName',
  'Faculty','ObsDate','OverallRAG','Notes','DevelopmentQuestion'];

const SCORE_HEADERS = ['ObsID','CriterionID','CriterionLabel','Faculty','RAG'];
const CRIT_HEADERS  = ['CriterionID','Label','Type','Faculty','Active','SortOrder'];
const STAFF_HEADERS = ['Name','Email','Faculty'];
const DRAFT_HEADERS = ['DraftID','OwnerEmail','UpdatedAt','PayloadJSON'];

// Development questions are stored as a JSON array in the single cell, so up to
// three travel together. Older single-string rows are still read correctly.
function parseQuestions_(v) {
  v = v == null ? '' : String(v).trim();
  if (!v) return [];
  if (v.charAt(0) === '[') {
    try { var a = JSON.parse(v); if (Array.isArray(a)) return a.map(function(x){ return String(x).trim(); }).filter(String); } catch (e) {}
  }
  return [v];
}

// ===================================================================
// WEB APP ENTRY
// ===================================================================
function doGet() {
  return HtmlService.createHtmlOutputFromFile('index')
    .setTitle('Lesson Drop-In Tracker')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ===================================================================
// ONE-OFF SETUP  (run this once from the editor)
// ===================================================================
function setup() {
  const ss = SpreadsheetApp.openById(SS_ID);

  ensureSheet_(ss, TAB.OBS, OBS_HEADERS);
  ensureSheet_(ss, TAB.SCORES, SCORE_HEADERS);
  const crit = ensureSheet_(ss, TAB.CRITERIA, CRIT_HEADERS);
  const staff = ensureSheet_(ss, TAB.STAFF, STAFF_HEADERS);
  const admins = ensureSheet_(ss, TAB.ADMINS, ['Email']);
  ensureSheet_(ss, TAB.LEADS, ['Email','Faculty']);
  const config = ensureSheet_(ss, TAB.CONFIG, ['Key','Value']);
  ensureSheet_(ss, TAB.DRAFTS, DRAFT_HEADERS);
  const coaches = ensureSheet_(ss, TAB.COACHES, ['Email']);

  // Seed the coaching team (plus SLT, who are coaches implicitly). Fresh install only.
  // Real addresses are kept out of the repository: edit the Coaches tab in the
  // sheet directly, or replace these placeholders before running setup().
  if (coaches.getLastRow() < 2) {
    coaches.getRange(2, 1, 1, 1).setValues([
      ['coach.one@' + STAFF_DOMAIN]
    ]);
  }

  // Seed Charlotte's core criteria (shared across all faculties)
  if (crit.getLastRow() < 2) {
    const core = [
      'Start of the lesson is in line with our Baysgarth expectations',
      'Targeted strategies to support the Focus 5 students are actively implemented during the lesson',
      'Effective application tasks are implemented, with scaffolding used appropriately and only when needed to promote independence',
      'The needs of all students have been met, including SEND',
      'Supports reading effectively (e.g. reciprocal reading, scaffolded reading, teacher modelling)',
      'Explicitly teaches key vocabulary',
      'Accurate and precise assessment used across the three checkpoints',
      'Pace of learning is good'
    ];
    const rows = core.map(function(label, i) {
      return ['C' + (i + 1), label, 'core', '', true, (i + 1) * 10];
    });
    crit.getRange(2, 1, rows.length, CRIT_HEADERS.length).setValues(rows);
  }

  if (config.getLastRow() < 2) {
    config.getRange(2, 1, 1, 2).setValues([['SchoolName', 'Baysgarth School']]);
  }

  // Seed the master-dashboard admins (SLT). On a fresh install only.
  // Real addresses are kept out of the repository: edit the Admins tab in the
  // sheet directly, or replace these placeholders before running setup().
  if (admins.getLastRow() < 2) {
    admins.getRange(2, 1, 1, 1).setValues([
      ['slt.member@' + STAFF_DOMAIN]
    ]);
  }

  // A couple of example staff rows so the dropdown is not empty
  if (staff.getLastRow() < 2) {
    staff.getRange(2, 1, 2, 3).setValues([
      ['Example Teacher A', '', 'English'],
      ['Example Teacher B', '', 'Science']
    ]);
  }

  SpreadsheetApp.flush();
  return 'Setup complete. Core criteria seeded. Add your staff, admin emails and department leads (Leads tab), then deploy.';
}

// ===================================================================
// BOOTSTRAP  (called once when the page loads)
// ===================================================================
function getBootstrap() {
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  const staff = readObjects_(ss, TAB.STAFF).map(normalizeStaff_)
    .filter(function(s){ return s.Name; });
  const facList = [];
  staff.forEach(function(s){ splitFaculties_(s.Faculty).forEach(function(f){ facList.push(f); }); });
  const faculties = unique_(facList).sort(facSort_);
  const cfg = configMap_(ss);

  // Pre-fill observer name from the staff list if their email matches
  let observerName = '';
  for (let i = 0; i < staff.length; i++) {
    if (String(staff[i].Email || '').toLowerCase() === email) { observerName = staff[i].Name; break; }
  }

  return {
    email: email,
    observerName: observerName,
    isMaster: isAdmin_(email),
    isHOD: isHOD_(email),
    isCoach: isCoach_(email),
    homeFaculties: getLeadFaculties_(email),
    schoolName: cfg.SchoolName || 'School',
    staff: staff,
    faculties: faculties,
    rag: RAG
  };
}

// Active core + faculty criteria, ordered. Called when a faculty is chosen.
function getCriteriaForFaculty(faculty) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const all = readObjects_(ss, TAB.CRITERIA);
  faculty = String(faculty || '').trim().toLowerCase();
  return all.filter(function(c){
    if (String(c.Active).toUpperCase() === 'FALSE' || c.Active === false) return false;
    const type = String(c.Type || 'core').toLowerCase();
    if (type === 'core') return true;
    return String(c.Faculty || '').trim().toLowerCase() === faculty;
  }).sort(function(a, b){
    return (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0);
  }).map(function(c){
    return { id: c.CriterionID, label: c.Label, type: String(c.Type || 'core').toLowerCase(), faculty: c.Faculty || '' };
  });
}

// ===================================================================
// SUBMIT AN OBSERVATION
// ===================================================================
function submitObservation(payload) {
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);

  // Identity and time are stamped server-side, never trusted from the client
  const obsId = Utilities.getUuid();
  const now = new Date();

  const scores = (payload.scores || []).filter(function(s){ return s && s.rag; });
  const questions = (payload.devQuestions && payload.devQuestions.length
      ? payload.devQuestions
      : (payload.devQuestion ? [payload.devQuestion] : []))
    .map(function(q){ return String(q || '').trim(); }).filter(String).slice(0, 3);

  if (!payload.teacherName) throw new Error('Please select the teacher observed.');
  if (!payload.faculty) throw new Error('Please select a faculty.');
  if (!payload.overallRAG) throw new Error('Please give an overall RAG for progress.');
  if (scores.length === 0) throw new Error('Please RAG-rate at least one criterion.');
  if (questions.length === 0) throw new Error('Please add a development question.');

  const obsSheet = ss.getSheetByName(TAB.OBS);
  obsSheet.appendRow([
    obsId,
    now,
    email,
    payload.observerName || '',
    payload.teacherName || '',
    payload.faculty || '',
    payload.obsDate || '',
    payload.overallRAG || '',
    payload.notes || '',
    JSON.stringify(questions)
  ]);

  const scoreSheet = ss.getSheetByName(TAB.SCORES);
  const rows = scores.map(function(s){
    return [obsId, s.id, s.label, payload.faculty || '', s.rag];
  });
  if (rows.length) scoreSheet.getRange(scoreSheet.getLastRow() + 1, 1, rows.length, SCORE_HEADERS.length).setValues(rows);

  // A completed observation clears its draft, if it came from one.
  if (payload.draftId) { try { deleteDraft(payload.draftId); } catch (e) {} }

  return { ok: true, obsId: obsId };
}

// ===================================================================
// DASHBOARD  (SLT see everything; a department lead sees their faculty)
// ===================================================================
function getDashboardData(filters) {
  filters = filters || {};
  const email = currentEmail_();
  const admin = isAdmin_(email);
  if (!admin) {
    const fac = String(filters.faculty || '').trim();
    if (!fac) throw new Error('Open a department first.');
    if (!isHOD_(email)) throw new Error('Department views are for heads of department.');
    // Any head of department may view any department.
  }
  const ss = SpreadsheetApp.openById(SS_ID);

  let obs = readObjects_(ss, TAB.OBS);
  const scores = readObjects_(ss, TAB.SCORES);

  // --- filters ---
  const fFac = String(filters.faculty || '').trim().toLowerCase();
  const from = filters.from ? new Date(filters.from) : null;
  const to   = filters.to   ? new Date(filters.to)   : null;
  if (to) to.setHours(23, 59, 59, 999);

  obs = obs.filter(function(o){
    if (fFac && String(o.Faculty || '').trim().toLowerCase() !== fFac) return false;
    const d = o.ObsDate ? new Date(o.ObsDate) : (o.Timestamp ? new Date(o.Timestamp) : null);
    if (from && d && d < from) return false;
    if (to && d && d > to) return false;
    return true;
  });

  const keptIds = {};
  obs.forEach(function(o){ keptIds[o.ObsID] = o; });
  const keptScores = scores.filter(function(s){ return keptIds[s.ObsID]; });

  // --- headline RAG (overall progress) ---
  const overall = ragCounts_();
  obs.forEach(function(o){ bump_(overall, o.OverallRAG); });

  // --- per criterion (keyed by ID so identical labels across departments never merge) ---
  const critMeta = {};
  readObjects_(ss, TAB.CRITERIA).forEach(function(c){
    critMeta[c.CriterionID] = {
      label: c.Label,
      type: String(c.Type || 'core').toLowerCase() === 'faculty' ? 'faculty' : 'core',
      faculty: c.Faculty || ''
    };
  });
  const byCrit = {};
  keptScores.forEach(function(s){
    const id = s.CriterionID || s.CriterionLabel;
    const meta = critMeta[s.CriterionID] || {};
    if (!byCrit[id]) byCrit[id] = {
      label: meta.label || s.CriterionLabel || s.CriterionID,
      type: meta.type || 'core',
      faculty: meta.faculty || '',
      counts: ragCounts_()
    };
    bump_(byCrit[id].counts, s.RAG);
  });
  const criteria = Object.keys(byCrit).map(function(k){
    const c = byCrit[k];
    const total = c.counts.Green + c.counts.Amber + c.counts.Red;
    // concern score weights reds heavily so the worst criteria float up
    const concern = total ? (c.counts.Red * 2 + c.counts.Amber) / total : 0;
    return { label: c.label, type: c.type, faculty: c.faculty, green: c.counts.Green, amber: c.counts.Amber, red: c.counts.Red, total: total, concern: concern };
  }).sort(function(a, b){ return b.concern - a.concern; });

  // --- per teacher (who needs support) ---
  const teacherMap = {};
  obs.forEach(function(o){
    const t = o.TeacherName || 'Unknown';
    if (!teacherMap[t]) teacherMap[t] = { teacher: t, faculty: o.Faculty || '', count: 0, red: 0, amber: 0, green: 0, lastDate: '' };
    const rec = teacherMap[t];
    rec.count++;
    rec.faculty = o.Faculty || rec.faculty;
    const d = o.ObsDate || o.Timestamp;
    if (d && (!rec.lastDate || new Date(d) > new Date(rec.lastDate))) rec.lastDate = d;
  });
  keptScores.forEach(function(s){
    const t = keptIds[s.ObsID].TeacherName || 'Unknown';
    const rec = teacherMap[t];
    if (!rec) return;
    if (s.RAG === 'Red') rec.red++;
    else if (s.RAG === 'Amber') rec.amber++;
    else if (s.RAG === 'Green') rec.green++;
  });
  const teachers = Object.keys(teacherMap).map(function(k){ return teacherMap[k]; })
    .sort(function(a, b){
      if (b.red !== a.red) return b.red - a.red;
      return b.amber - a.amber;
    })
    .map(function(t){ return { teacher: t.teacher, faculty: t.faculty, count: t.count,
      red: t.red, amber: t.amber, green: t.green, lastDate: fmtDate_(t.lastDate) }; });

  // --- per faculty ---
  const facMap = {};
  obs.forEach(function(o){
    const f = o.Faculty || 'Unassigned';
    if (!facMap[f]) facMap[f] = { faculty: f, count: 0, counts: ragCounts_() };
    facMap[f].count++;
    bump_(facMap[f].counts, o.OverallRAG);
  });
  const faculties = Object.keys(facMap).map(function(k){
    const f = facMap[k];
    const tot = f.counts.Green + f.counts.Amber + f.counts.Red;
    const concern = tot ? (f.counts.Red * 2 + f.counts.Amber) / tot : 0;
    return { faculty: f.faculty, count: f.count, green: f.counts.Green, amber: f.counts.Amber, red: f.counts.Red, concern: concern };
  }).sort(function(a, b){ return b.concern - a.concern; });

  // --- recent observations + free-text next steps ---
  const recent = obs.slice().sort(function(a, b){
    return new Date(b.Timestamp) - new Date(a.Timestamp);
  }).slice(0, 50).map(function(o){
    return {
      date: fmtDate_(o.ObsDate || o.Timestamp),
      teacher: o.TeacherName, faculty: o.Faculty, observer: o.ObserverName || o.ObserverEmail,
      overall: o.OverallRAG, notes: o.Notes, devQuestions: parseQuestions_(o.DevelopmentQuestion)
    };
  });

  // Flat rows for CSV export
  const exportRows = [OBS_HEADERS.slice()].concat(obs.map(function(o){
    return OBS_HEADERS.map(function(h){ return o[h] instanceof Date ? fmtDate_(o[h]) : (o[h] == null ? '' : o[h]); });
  }));

  return {
    totals: { observations: obs.length, teachers: Object.keys(teacherMap).length,
      observers: unique_(obs.map(function(o){ return o.ObserverEmail; })).length },
    overall: overall,
    criteria: criteria,
    teachers: teachers,
    faculties: faculties,
    recent: recent,
    exportRows: exportRows
  };
}

function getObservationsForTeacher(teacherName, faculty) {
  const email = currentEmail_();
  const admin = isAdmin_(email);
  let scopeFac = null;
  if (!admin) {
    if (!faculty) throw new Error('Open a department first.');
    if (!isHOD_(email)) throw new Error('Department views are for heads of department.');
    scopeFac = String(faculty).trim().toLowerCase();
  } else if (faculty) {
    scopeFac = String(faculty).trim().toLowerCase();
  }
  const ss = SpreadsheetApp.openById(SS_ID);
  let obs = readObjects_(ss, TAB.OBS).filter(function(o){ return o.TeacherName === teacherName; });
  if (scopeFac) obs = obs.filter(function(o){ return String(o.Faculty || '').trim().toLowerCase() === scopeFac; });
  const scores = readObjects_(ss, TAB.SCORES);
  const byObs = {};
  scores.forEach(function(s){ (byObs[s.ObsID] = byObs[s.ObsID] || []).push({ label: s.CriterionLabel, rag: s.RAG }); });
  return obs.sort(function(a, b){ return new Date(b.Timestamp) - new Date(a.Timestamp); }).map(function(o){
    return {
      date: fmtDate_(o.ObsDate || o.Timestamp), observer: o.ObserverName || o.ObserverEmail,
      overall: o.OverallRAG, notes: o.Notes, devQuestions: parseQuestions_(o.DevelopmentQuestion),
      scores: byObs[o.ObsID] || []
    };
  });
}

// Collated rundown of ONE staff member's drop-ins, across every faculty.
// Available to coaches (and SLT). Used by the Coaching search.
function getCoachSummary(teacherName) {
  const email = currentEmail_();
  if (!isCoach_(email)) throw new Error('The coaching view is for coaches and SLT.');
  if (!teacherName) throw new Error('Choose a staff member to view.');

  const ss = SpreadsheetApp.openById(SS_ID);
  const obs = readObjects_(ss, TAB.OBS).filter(function(o){ return o.TeacherName === teacherName; });

  const critMeta = {};
  readObjects_(ss, TAB.CRITERIA).forEach(function(c){
    critMeta[c.CriterionID] = { label: c.Label, type: String(c.Type || 'core').toLowerCase() === 'faculty' ? 'faculty' : 'core', faculty: c.Faculty || '' };
  });

  const obsIds = {};
  obs.forEach(function(o){ obsIds[o.ObsID] = true; });
  const scores = readObjects_(ss, TAB.SCORES).filter(function(s){ return obsIds[s.ObsID]; });

  const overall = ragCounts_();
  obs.forEach(function(o){ bump_(overall, o.OverallRAG); });
  const counted = overall.Green + overall.Amber + overall.Red;

  const byCrit = {};
  scores.forEach(function(s){
    const id = s.CriterionID || s.CriterionLabel;
    const meta = critMeta[s.CriterionID] || {};
    if (!byCrit[id]) byCrit[id] = { label: meta.label || s.CriterionLabel || s.CriterionID, type: meta.type || 'core', faculty: meta.faculty || '', counts: ragCounts_() };
    bump_(byCrit[id].counts, s.RAG);
  });
  const byCriterion = Object.keys(byCrit).map(function(k){
    const c = byCrit[k];
    const total = c.counts.Green + c.counts.Amber + c.counts.Red;
    const concern = total ? (c.counts.Red * 2 + c.counts.Amber) / total : 0;
    return { label: c.label, type: c.type, faculty: c.faculty, green: c.counts.Green, amber: c.counts.Amber, red: c.counts.Red, concern: concern };
  }).sort(function(a, b){ return b.concern - a.concern; });

  const byObs = {};
  scores.forEach(function(s){ (byObs[s.ObsID] = byObs[s.ObsID] || []).push({ label: s.CriterionLabel, rag: s.RAG }); });
  const observations = obs.slice().sort(function(a, b){ return new Date(b.Timestamp) - new Date(a.Timestamp); }).map(function(o){
    return {
      date: fmtDate_(o.ObsDate || o.Timestamp), faculty: o.Faculty || '', observer: o.ObserverName || o.ObserverEmail,
      overall: o.OverallRAG, notes: o.Notes, devQuestions: parseQuestions_(o.DevelopmentQuestion), scores: byObs[o.ObsID] || []
    };
  });

  return {
    teacher: teacherName,
    totalObs: obs.length,
    faculties: unique_(obs.map(function(o){ return o.Faculty || ''; }).filter(String)),
    overall: overall,
    greenPct: counted ? Math.round(overall.Green / counted * 100) : 0,
    lastSeen: observations.length ? observations[0].date : '',
    byCriterion: byCriterion,
    observations: observations
  };
}

// ===================================================================
// AI THEMES  (Gemini 2.5 Flash, opt-in)
//   Clusters the mandatory development questions into recurring CPD
//   themes. The API key lives in Script Properties (GEMINI_API_KEY),
//   so it is never sent to the browser. Only question text, faculty and
//   the overall RAG are sent - never teacher names or pupil data.
// ===================================================================
function getDevelopmentThemes(filters) {
  filters = filters || {};
  const email = currentEmail_();
  const admin = isAdmin_(email);
  if (!admin) {
    const fac = String(filters.faculty || '').trim();
    if (!fac) throw new Error('Open a department first.');
    if (!isHOD_(email)) throw new Error('Themes are for heads of department.');
  }

  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, reason: 'no_key' };

  const ss = SpreadsheetApp.openById(SS_ID);
  let obs = readObjects_(ss, TAB.OBS);
  const fFac = String(filters.faculty || '').trim().toLowerCase();
  const from = filters.from ? new Date(filters.from) : null;
  const to   = filters.to   ? new Date(filters.to)   : null;
  if (to) to.setHours(23, 59, 59, 999);

  const items = [];
  obs.forEach(function(o){
    if (fFac && String(o.Faculty || '').trim().toLowerCase() !== fFac) return;
    const d = o.ObsDate ? new Date(o.ObsDate) : (o.Timestamp ? new Date(o.Timestamp) : null);
    if (from && d && d < from) return;
    if (to && d && d > to) return;
    parseQuestions_(o.DevelopmentQuestion).forEach(function(q){
      items.push({ q: q, faculty: o.Faculty || '', rag: o.OverallRAG || '' });
    });
  });

  if (items.length < 3) {
    return { ok: true, themes: [], count: items.length, note: 'At least 3 development questions are needed before themes are worth generating.' };
  }

  try {
    const themes = callGeminiThemes_(key, items);
    return { ok: true, themes: themes, count: items.length };
  } catch (e) {
    return { ok: false, reason: 'api', message: String(e && e.message ? e.message : e) };
  }
}

// Tolerant JSON read: strips code fences and salvages whole theme objects
// even if the array was cut off mid-stream.
function parseThemesJson_(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/i, '').replace(/```$/,'').trim();
  try { return JSON.parse(t); } catch (e) {}
  const objs = [];
  const re = /\{\s*"title"[\s\S]*?"examples"\s*:\s*\[[\s\S]*?\]\s*\}/g;
  let m;
  while ((m = re.exec(t)) !== null) {
    try { objs.push(JSON.parse(m[0])); } catch (ignore) {}
  }
  if (objs.length) return { themes: objs };
  throw new Error('Could not read the themes from Gemini. Please try again.');
}

function callGeminiThemes_(key, items) {
  const lines = items.map(function(it, i){
    return (i + 1) + '. [' + (it.faculty || 'n/a') + ' | ' + (it.rag || 'n/a') + '] ' + it.q;
  }).join('\n');

  const prompt =
    'You are a UK secondary school CPD lead analysing lesson drop-in "development questions". ' +
    'Each item is a single coaching question an observer posed to a teacher, tagged with the faculty and the overall RAG for that lesson. ' +
    'Group the questions into a small number of recurring pedagogical themes (aim for 3 to 6, fewer if the data is thin). ' +
    'For each theme give: a short title (3-6 words), a one-sentence description of the teaching focus, the count of questions it covers, and up to two representative example questions copied verbatim from the list. ' +
    'Base everything strictly on the questions provided; do not invent. ' +
    'Return ONLY JSON in this exact shape: ' +
    '{"themes":[{"title":"","focus":"","count":0,"examples":[""]}]}\n\n' +
    'Development questions:\n' + lines;

  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    muteHttpExceptions: true,
    payload: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { temperature: 0.3, responseMimeType: 'application/json', maxOutputTokens: 2048, thinkingConfig: { thinkingBudget: 0 } }
    })
  });

  const code = res.getResponseCode();
  if (code !== 200) {
    let msg = 'Gemini returned ' + code + '.';
    try { const e = JSON.parse(res.getContentText()); if (e.error && e.error.message) msg = e.error.message; } catch (ignore) {}
    throw new Error(msg);
  }

  const data = JSON.parse(res.getContentText());
  const text = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '';
  if (!text) throw new Error('Gemini returned an empty response.');

  let parsed = parseThemesJson_(text);
  const themes = (parsed && parsed.themes) || [];
  return themes.slice(0, 8).map(function(t){
    return {
      title: String(t.title || 'Theme').slice(0, 80),
      focus: String(t.focus || '').slice(0, 300),
      count: Number(t.count) || 0,
      examples: (t.examples || []).slice(0, 2).map(function(x){ return String(x).slice(0, 300); })
    };
  });
}

// One AI-suggested coaching question from the lesson's RAG picture.
// Sends only faculty, RAG and criteria labels - never teacher or pupil data.
function suggestDevelopmentQuestion(ctx) {
  ctx = ctx || {};
  const key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
  if (!key) return { ok: false, reason: 'no_key' };

  const crit = (ctx.criteria || []).map(function(c){ return '- ' + c.label + ': ' + (c.rag || 'not rated'); }).join('\n');
  const target = ctx.target;
  const avoid = (ctx.avoid || []).filter(Boolean);
  const focus = (target && target.label)
    ? 'Focus the question specifically on this one criterion: "' + target.label + '" (rated ' + (target.rag || 'n/a') + '). Write about THIS area only, not the others.'
    : 'Focus on the weakest area shown by the RAG.';
  const avoidLine = avoid.length
    ? ' Do NOT write about these areas, as other questions already cover them: ' + avoid.join('; ') + '.'
    : '';

  const prompt =
    'You are an instructional coach in a UK secondary school. ' +
    'From this lesson drop-in, write ONE short coaching "development question" that moves the teacher\'s practice forward. ' +
    focus + avoidLine + ' ' +
    'It must be a single open, non-judgemental question addressed to the teacher. ' +
    'Use British English. Return ONLY the question text, with no preamble or quotation marks.\n\n' +
    'Faculty: ' + (ctx.faculty || 'n/a') + '\n' +
    'Overall progress RAG: ' + (ctx.overallRAG || 'n/a') + '\n' +
    'Criteria and RAG:\n' + (crit || '(none rated yet)') + '\n' +
    (ctx.notes ? ('Observer notes: ' + String(ctx.notes).slice(0, 600) + '\n') : '');

  try {
    return { ok: true, question: callGeminiText_(key, prompt) };
  } catch (e) {
    return { ok: false, reason: 'api', message: String(e && e.message ? e.message : e) };
  }
}

function callGeminiText_(key, prompt) {
  const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + encodeURIComponent(key);
  const res = UrlFetchApp.fetch(url, {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0.5, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 } } })
  });
  if (res.getResponseCode() !== 200) {
    let msg = 'Gemini returned ' + res.getResponseCode() + '.';
    try { const e = JSON.parse(res.getContentText()); if (e.error && e.error.message) msg = e.error.message; } catch (ignore) {}
    throw new Error(msg);
  }
  const data = JSON.parse(res.getContentText());
  const t = data && data.candidates && data.candidates[0] && data.candidates[0].content &&
    data.candidates[0].content.parts && data.candidates[0].content.parts[0] ? data.candidates[0].content.parts[0].text : '';
  if (!t) throw new Error('Gemini returned an empty response.');
  return String(t).trim().replace(/^["'\s]+|["'\s]+$/g, '');
}

// ===================================================================
// DRAFTS  (personal: each user sees only their own unfinished drop-ins)
// ===================================================================
function saveDraft(draft) {
  draft = draft || {};
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(TAB.DRAFTS);
  const id = draft.draftId || ('D' + Utilities.getUuid());
  const payload = JSON.stringify(draft.payload || {});
  const now = new Date();
  const data = sh.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (String(data[r][0]) === id && String(data[r][1]).toLowerCase() === email) {
      sh.getRange(r + 1, 3, 1, 2).setValues([[now, payload]]);
      return { ok: true, draftId: id };
    }
  }
  sh.appendRow([id, email, now, payload]);
  return { ok: true, draftId: id };
}

function listDrafts() {
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  return readObjects_(ss, TAB.DRAFTS)
    .filter(function(d){ return String(d.OwnerEmail || '').toLowerCase() === email; })
    .map(function(d){
      let p = {};
      try { p = JSON.parse(d.PayloadJSON || '{}'); } catch (e) {}
      return {
        draftId: d.DraftID,
        updatedAt: d.UpdatedAt ? fmtDateTime_(d.UpdatedAt) : '',
        sortKey: d.UpdatedAt ? new Date(d.UpdatedAt).getTime() : 0,
        teacher: p.teacherName || '', faculty: p.faculty || '', obsDate: p.obsDate || ''
      };
    })
    .sort(function(a, b){ return b.sortKey - a.sortKey; });
}

function getDraft(draftId) {
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  const rows = readObjects_(ss, TAB.DRAFTS);
  for (let i = 0; i < rows.length; i++) {
    if (String(rows[i].DraftID) === String(draftId) && String(rows[i].OwnerEmail || '').toLowerCase() === email) {
      try { return { ok: true, draftId: draftId, payload: JSON.parse(rows[i].PayloadJSON || '{}') }; }
      catch (e) { throw new Error('Could not read that draft.'); }
    }
  }
  throw new Error('Draft not found.');
}

function deleteDraft(draftId) {
  const email = currentEmail_();
  const ss = SpreadsheetApp.openById(SS_ID);
  const sh = ss.getSheetByName(TAB.DRAFTS);
  const data = sh.getDataRange().getValues();
  for (let r = data.length - 1; r >= 1; r--) {
    if (String(data[r][0]) === String(draftId) && String(data[r][1]).toLowerCase() === email) {
      sh.deleteRow(r + 1);
    }
  }
  return { ok: true };
}

function fmtDateTime_(v) {
  try { return Utilities.formatDate(new Date(v), Session.getScriptTimeZone(), 'd MMM, HH:mm'); }
  catch (e) { return String(v); }
}


// ===================================================================
// CRITERIA MANAGEMENT
//   SLT manage everything. A department lead manages only their
//   faculty's criteria; whole-school (core) criteria are read-only
//   to them. This is the per-department "amend what we look for".
// ===================================================================

// Full list for the SLT Criteria tab.
function getAllCriteria() {
  requireAdmin_();
  const ss = SpreadsheetApp.openById(SS_ID);
  return readObjects_(ss, TAB.CRITERIA).map(toCriterionObj_);
}

// Scoped list for a department lead's "What we look for" screen.
// Returns whole-school criteria (locked) plus that faculty's own (editable).
function getManagedCriteria(faculty) {
  const email = currentEmail_();
  const admin = isAdmin_(email);
  faculty = String(faculty || '').trim();
  if (!admin && (!faculty || !isLeadOf_(email, faculty))) {
    throw new Error('You can only manage your own department.');
  }
  const ss = SpreadsheetApp.openById(SS_ID);
  const all = readObjects_(ss, TAB.CRITERIA);
  const core = all.filter(function(c){ return String(c.Type || 'core').toLowerCase() === 'core'; })
    .sort(bySort_).map(toCriterionObj_);
  const fac = all.filter(function(c){
    return String(c.Type || '').toLowerCase() === 'faculty' &&
      String(c.Faculty || '').trim().toLowerCase() === faculty.toLowerCase();
  }).sort(bySort_).map(toCriterionObj_);
  return { faculty: faculty, core: core, faculty_criteria: fac };
}

function addCriterion(label, type, faculty) {
  const email = currentEmail_();
  const admin = isAdmin_(email);
  if (!label) throw new Error('A criterion needs a label.');
  type = (type === 'faculty') ? 'faculty' : 'core';
  if (type === 'core' && !admin) throw new Error('Only SLT can add whole-school criteria.');
  if (type === 'faculty') {
    if (!faculty) throw new Error('Faculty criteria need a faculty.');
    if (!admin && !isLeadOf_(email, faculty)) throw new Error('You can only add criteria for your own department.');
  }
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(TAB.CRITERIA);
  const existing = readObjects_(ss, TAB.CRITERIA);
  const maxSort = existing.reduce(function(m, c){ return Math.max(m, Number(c.SortOrder) || 0); }, 0);
  const id = (type === 'core' ? 'C' : 'F') + (existing.length + 1) + '_' + Utilities.getUuid().slice(0, 6);
  sheet.appendRow([id, label, type, type === 'faculty' ? faculty : '', true, maxSort + 10]);
  return { ok: true };
}

function updateCriterionLabel(id, label) {
  if (!label) throw new Error('A criterion needs a label.');
  return editCriterionRow_(id, function(rowIndex, sheet){
    sheet.getRange(rowIndex, 2).setValue(label);
  });
}

function setCriterionActive(id, active) {
  return editCriterionRow_(id, function(rowIndex, sheet){
    sheet.getRange(rowIndex, 5).setValue(!!active);
  });
}

// Shared permission gate + locator for editing a single criterion row.
function editCriterionRow_(id, mutate) {
  const email = currentEmail_();
  const admin = isAdmin_(email);
  const ss = SpreadsheetApp.openById(SS_ID);
  const sheet = ss.getSheetByName(TAB.CRITERIA);
  const data = sheet.getDataRange().getValues();
  for (let r = 1; r < data.length; r++) {
    if (data[r][0] === id) {
      const type = String(data[r][2] || 'core').toLowerCase();
      const fac = String(data[r][3] || '').trim();
      if (!admin) {
        if (type === 'core') throw new Error('Whole-school criteria can only be changed by SLT.');
        if (!isLeadOf_(email, fac)) throw new Error('You can only change your own department’s criteria.');
      }
      mutate(r + 1, sheet);
      return { ok: true };
    }
  }
  throw new Error('Criterion not found.');
}

// ===================================================================
// HELPERS
// ===================================================================
function currentEmail_() {
  return (Session.getActiveUser().getEmail() || '').toLowerCase();
}

function isAdmin_(email) {
  const ss = SpreadsheetApp.openById(SS_ID);
  const admins = readObjects_(ss, TAB.ADMINS).map(function(a){ return String(a.Email || '').toLowerCase(); });
  return admins.indexOf(email) !== -1;
}

function requireAdmin_() {
  if (!isAdmin_(currentEmail_())) throw new Error('Dashboard access is restricted to SLT.');
}

// A coach is anyone in the Coaches tab, plus all SLT.
function isCoach_(email) {
  if (isAdmin_(email)) return true;
  const ss = SpreadsheetApp.openById(SS_ID);
  return readObjects_(ss, TAB.COACHES).map(function(c){ return String(c.Email || '').toLowerCase(); }).indexOf(email) !== -1;
}

// Faculties this person leads (a HOF can lead more than one).
function getLeadFaculties_(email) {
  const ss = SpreadsheetApp.openById(SS_ID);
  return unique_(readObjects_(ss, TAB.LEADS)
    .filter(function(l){ return String(l.Email || '').toLowerCase() === email; })
    .map(function(l){ return String(l.Faculty || '').trim(); })
    .filter(String));
}

function isLeadOf_(email, faculty) {
  const want = String(faculty || '').trim().toLowerCase();
  return getLeadFaculties_(email).map(function(f){ return f.toLowerCase(); }).indexOf(want) !== -1;
}

// A head of department is anyone listed in the Leads tab (for any faculty).
function isHOD_(email) {
  return getLeadFaculties_(email).length > 0;
}

function bySort_(a, b) { return (Number(a.SortOrder) || 0) - (Number(b.SortOrder) || 0); }

function toCriterionObj_(c) {
  return { id: c.CriterionID, label: c.Label, type: String(c.Type || 'core').toLowerCase(),
    faculty: c.Faculty || '', active: !(String(c.Active).toUpperCase() === 'FALSE' || c.Active === false),
    sortOrder: Number(c.SortOrder) || 0 };
}

function ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  if (sh.getLastRow() === 0) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readObjects_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const data = sh.getDataRange().getValues();
  const headers = data[0];
  const out = [];
  for (let r = 1; r < data.length; r++) {
    const row = data[r];
    if (row.join('') === '') continue;
    const obj = {};
    for (let c = 0; c < headers.length; c++) obj[headers[c]] = row[c];
    out.push(obj);
  }
  return out;
}

function configMap_(ss) {
  const rows = readObjects_(ss, TAB.CONFIG);
  const m = {};
  rows.forEach(function(r){ if (r.Key) m[r.Key] = r.Value; });
  return m;
}

function unique_(arr) {
  const seen = {}, out = [];
  arr.forEach(function(x){ const k = String(x); if (x !== '' && x != null && !seen[k]) { seen[k] = 1; out.push(x); } });
  return out;
}

// English, Maths, Science first; everything else alphabetical.
const FAC_ORDER = ['English', 'Maths', 'Science'];
function facSort_(a, b) {
  const ia = FAC_ORDER.indexOf(a), ib = FAC_ORDER.indexOf(b);
  if (ia !== -1 || ib !== -1) {
    if (ia === -1) return 1;
    if (ib === -1) return -1;
    return ia - ib;
  }
  return String(a).localeCompare(String(b));
}

function ragCounts_() { return { Green: 0, Amber: 0, Red: 0 }; }
function bump_(counts, rag) { if (rag === 'Green' || rag === 'Amber' || rag === 'Red') counts[rag]++; }

function fmtDate_(d) {
  if (!d) return '';
  const date = (d instanceof Date) ? d : new Date(d);
  if (isNaN(date)) return String(d);
  return Utilities.formatDate(date, Session.getScriptTimeZone() || 'Europe/London', 'dd/MM/yyyy');
}
