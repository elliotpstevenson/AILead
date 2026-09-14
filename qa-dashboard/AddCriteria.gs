/**
 * ONE-OFF: add a batch of department criteria to the Criteria tab.
 *
 * Run addFacultyCriteria() once from the editor and read the log. It is safe to
 * run twice: a criterion whose wording already exists for that faculty is
 * skipped, so nothing is duplicated if a run is interrupted or repeated.
 *
 * Nothing else calls this. Once the criteria are in, the file can be deleted,
 * or kept and edited the next time a batch arrives. Departments manage their
 * own criteria in the app; this is only for loading a list in bulk.
 */

// Faculty -> the criteria it is judged on. The faculty must be spelt as the
// Staff tab spells it, or the criteria attach to a department the app does not
// know it has. The run warns about any that do not match.
const DEPT_CRITERIA = {
  'PE': [
    'All students are active and engaged in the task.',
    'Adaptive teaching is evident within lessons.',
    'Assessment is frequent, with reference made to the PE assessment grades (core).'
  ],
  'Sport': [
    'All students are active and engaged in the task.',
    'All lessons are well sequenced and follow the BLM.',
    'Live marking is evident during apply tasks.'
  ],
  'Health and Social Care': [
    'All students are active and engaged in the task.',
    'All lessons are well sequenced and follow the BLM.',
    'Live marking is evident during apply tasks.'
  ],
  'Childcare and Development': [
    'All students are active and engaged in the task.',
    'All lessons are well sequenced and follow the BLM.',
    'Live marking is evident during apply tasks.'
  ],
  'Resilience': [
    'All students are active and engaged in the task.',
    'The individual 7c’s are referred to and are specific to the task.',
    'The delivery of the lesson is in line with the principles of the curriculum by allowing students to experience difficulty and failure.'
  ],
  // Departments that group several subjects. The subjects are mapped onto the
  // department in the Arbor_Subjects tab, so a class code reaches these.
  'Creative Arts': [                       // Photography, Graphics, Art
    'Group Dynamics are implemented effectively',
    'BLM is used effectively'
  ],
  'Performing Arts': [                     // Music, Drama, Dance
    'Group Dynamics are implemented effectively',
    'BLM is used effectively',
    'Students are actively engaged in the task through effective behaviour management strategies and clear expectations'
  ],
  'Business Studies': [
    'All students are active and engaged in the lesson',
    'Adaptive teaching is evident within lessons',
    'Reciprocal reading & numeracy strategies are embedded within lessons',
    'Regular assessment for learning is embedded into lessons to check for pupil understanding and build student confidence'
  ],
  'ICT': [
    'All students are active and engaged in the lesson',
    'Adaptive teaching is evident within lessons',
    'Reciprocal reading & numeracy strategies are embedded within lessons',
    'Regular assessment for learning is embedded into lessons to check for pupil understanding and build student confidence'
  ]
};

// The whole-school criteria to make sure are present, added only if missing.
const CORE_CRITERIA_TO_ADD = [
  'Kagan and Oracy (ECCHO) structures are used to give every student a turn at talking and thinking'
];

function addFacultyCriteria() {
  requireAdmin_();
  const ss = ss_();
  const sheet = ss.getSheetByName(TAB.CRITERIA);
  if (!sheet) throw new Error('The ' + TAB.CRITERIA + ' tab is missing. Run setup() once first.');

  const existing = readObjects_(ss, TAB.CRITERIA);
  const seen = {};
  existing.forEach(function(c){ seen[critKey_(c.Label, c.Faculty)] = true; });
  let sort = existing.reduce(function(m, c){ return Math.max(m, Number(c.SortOrder) || 0); }, 0);
  let n = existing.length;

  // Which departments actually exist, so the log can say when one does not.
  const known = {};
  readObjects_(ss, TAB.STAFF).map(normalizeStaff_).forEach(function(s){
    splitFaculties_(s.Faculty).forEach(function(f){ known[f.toLowerCase()] = f; });
  });

  const rows = [], skipped = [], unknown = [];
  CORE_CRITERIA_TO_ADD.forEach(function(label){
    if (seen[critKey_(label, '')]) { skipped.push('whole-school: ' + label); return; }
    seen[critKey_(label, '')] = true;
    sort += 10; n += 1;
    rows.push(['C' + n + '_' + Utilities.getUuid().slice(0, 6), label, 'core', '', true, sort]);
  });
  Object.keys(DEPT_CRITERIA).forEach(function(faculty){
    if (!known[faculty.toLowerCase()]) unknown.push(faculty);
    DEPT_CRITERIA[faculty].forEach(function(label){
      const key = critKey_(label, faculty);
      if (seen[key]) { skipped.push(faculty + ': ' + label); return; }
      seen[key] = true;
      sort += 10; n += 1;
      rows.push(['F' + n + '_' + Utilities.getUuid().slice(0, 6), label, 'faculty', faculty, true, sort]);
    });
  });

  if (rows.length) {
    sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, CRIT_HEADERS.length).setValues(rows);
  }
  Logger.log('Added ' + rows.length + ' criteria.' + (skipped.length ? ' Skipped ' + skipped.length + ' already there.' : ''));
  skipped.forEach(function(s){ Logger.log('  already there - ' + s); });
  if (unknown.length) {
    Logger.log('No member of staff is filed under: ' + unknown.join(', ') +
      '. Their criteria are saved but will not appear until someone in the Staff tab has that faculty in the Faculties column.');
  }
  return 'Added ' + rows.length + ', skipped ' + skipped.length + '.';
}

// Same wording for the same faculty is the same criterion, whatever the case
// or spacing, so a second run does not double anything up.
function critKey_(label, faculty) {
  return String(label || '').toLowerCase().replace(/\s+/g, ' ').trim() +
    '|' + String(faculty || '').toLowerCase().trim();
}
