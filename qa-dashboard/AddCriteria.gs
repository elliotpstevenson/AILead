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
  'Health & Social Care': [
    'All students are active and engaged in the task.',
    'All lessons are well sequenced and follow the BLM.',
    'Live marking is evident during apply tasks.'
  ],
  'Child Development': [
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

  /* Which departments exist, so the log can say when one does not. The
     Faculties tab is the list; the Staff tab still counts, for a department
     named there and not in the tab. A department in neither is the only one
     whose criteria have nowhere to appear. */
  const known = {};
  facultyRows_(ss).forEach(function(r){ known[r.name.toLowerCase()] = r.name; });
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
    Logger.log('Not a department yet: ' + unknown.join(', ') +
      '. Their criteria are saved but cannot appear until each is a row on the Faculties tab, or is named in the Staff tab.');
  }
  // Separate matter, and not a problem: a department exists but nobody teaches
  // it yet, so no observation can be filed against it.
  const staffed = {};
  readObjects_(ss, TAB.STAFF).map(normalizeStaff_).forEach(function(s){
    splitFaculties_(s.Faculty).forEach(function(f){ staffed[f.toLowerCase()] = true; });
  });
  const unstaffed = Object.keys(DEPT_CRITERIA).filter(function(f){ return !staffed[f.toLowerCase()]; });
  if (unstaffed.length) {
    Logger.log('No member of staff is filed under: ' + unstaffed.join(', ') +
      '. The criteria will still show on the form. Filing their teachers on the Staff tab is what makes their drop-ins count towards the department.');
  }
  return 'Added ' + rows.length + ', skipped ' + skipped.length + '.';
}

// Same wording for the same faculty is the same criterion, whatever the case
// or spacing, so a second run does not double anything up.
function critKey_(label, faculty) {
  return String(label || '').toLowerCase().replace(/\s+/g, ' ').trim() +
    '|' + String(faculty || '').toLowerCase().trim();
}


/* ===================================================================
   THE DEPARTMENT LIST

   Run addDepartments() once. It fills the Faculties tab: one row per
   subject, with Parent naming the department it sits under where it sits
   under one. A department with subjects gets an All toggle in the
   department view, then one pill per subject, so a head of faculty can look
   at the whole thing or at Drama on its own.

   Parents are marked below. Anything with '' stands on its own. Change a
   Parent here and run again, or edit the tab directly: both are read the
   same way, and a row already there is left alone unless its parent is
   blank and this list gives it one.
   =================================================================== */
const DEPARTMENTS = [
  // subject,                      parent
  ['Creative Arts',                ''],
  ['Art',                          'Creative Arts'],
  ['Graphics',                     'Creative Arts'],
  ['Photography',                  'Creative Arts'],

  ['Performing Arts',              ''],
  ['Music',                        'Performing Arts'],
  ['Drama',                        'Performing Arts'],
  ['Dance',                        'Performing Arts'],

  ['Science',                      ''],
  ['Biology',                      'Science'],
  ['Chemistry',                    'Science'],
  ['Physics',                      'Science'],

  ['MFL',                          ''],
  ['French',                       'MFL'],
  ['German',                       'MFL'],
  ['Spanish',                      'MFL'],
  ['Geography',                    'MFL'],

  ['Maths',                        ''],
  ['Statistics',                   'Maths'],

  ['PE',                           ''],
  ['Sport',                        'PE'],
  ['Sport Science',                'PE'],
  ['Health & Social Care',         'PE'],
  ['Child Development',            'PE'],
  ['Travel and Tourism',           'PE'],
  ['Resilience',                   'PE'],

  ['DT',                           ''],
  ['Engineering',                  'DT'],
  ['Food',                         'DT'],
  ['Hospitality & Catering',       'DT'],
  ['Horticulture',                 'DT'],
  ['Hair & Beauty',                'DT'],
  ['Textiles',                     'DT'],

  ['Business & ICT',               ''],
  ['Business Studies',             'Business & ICT'],
  ['ICT',                          'Business & ICT'],
  ['Computing',                    'Business & ICT'],
  ['Media Literacy',               'Business & ICT'],

  ['ICE',                          ''],
  ['Religious Studies',            'ICE'],

  ['Inclusion',                    ''],
  ['SEND',                         'Inclusion'],
  ['EAL',                          'Inclusion'],
  ['UAS',                          'Inclusion'],

  ['English',                      ''],
  ['History',                      '']
];

function addDepartments() {
  requireAdmin_();
  const ss = ss_();
  const sheet = ensureSheet_(ss, TAB.FACULTIES, ['Faculty', 'Parent', 'Active']);
  const existing = readObjects_(ss, TAB.FACULTIES);
  const at = {};
  existing.forEach(function(r, i){ at[String(r.Faculty || '').trim().toLowerCase()] = i + 2; });

  const added = [], parented = [];
  DEPARTMENTS.forEach(function(d){
    const key = d[0].toLowerCase();
    if (at[key]) {
      // Already there. Only fill in a parent that is missing; never move a
      // subject somebody has deliberately put somewhere else.
      const row = existing[at[key] - 2];
      if (d[1] && !String(row.Parent || '').trim()) {
        sheet.getRange(at[key], 2).setValue(d[1]);
        parented.push(d[0] + ' -> ' + d[1]);
      }
      return;
    }
    sheet.appendRow([d[0], d[1], true]);
    at[key] = sheet.getLastRow();
    added.push(d[1] ? d[0] + ' (under ' + d[1] + ')' : d[0]);
  });

  Logger.log('Departments added: ' + added.length + (added.length ? ' - ' + added.join(', ') : ''));
  if (parented.length) Logger.log('Given a parent: ' + parented.join(', '));
  // A faculty used on the Staff tab or on a criterion but not in the list is
  // worth knowing about: it still works, it just sits on its own.
  const known = {};
  DEPARTMENTS.forEach(function(d){ known[d[0].toLowerCase()] = true; });
  const loose = [];
  readObjects_(ss, TAB.STAFF).map(normalizeStaff_).forEach(function(s){
    splitFaculties_(s.Faculty).forEach(function(f){ if (f && !known[f.toLowerCase()]) loose.push(f); });
  });
  readObjects_(ss, TAB.CRITERIA).forEach(function(c){
    const f = String(c.Faculty || '').trim();
    if (f && !known[f.toLowerCase()]) loose.push(f);
  });
  if (loose.length) Logger.log('Named elsewhere but not in this list: ' + unique_(loose).join(', '));
  return 'Added ' + added.length + ' departments.';
}


/* Renaming a department everywhere it is written down.

   A department's name is data, not an id: it is written into criteria, into
   every observation and scrutiny, and into the Leads, Staff and Classes tabs.
   Renaming it in one place leaves the rest pointing at a department that no
   longer exists, and the observations quietly stop counting.

   renameFaculty('Old name', 'New name') changes it in all of them. Call it
   with just the old name to see what would change without changing anything. */
const FACULTY_COLUMNS = [
  ['FACULTIES', 'Faculty'], ['FACULTIES', 'Parent'],
  ['CRITERIA', 'Faculty'], ['BOOK_CRITERIA', 'Faculty'],
  ['OBS', 'Faculty'], ['SCORES', 'Faculty'],
  ['BOOKS', 'Faculty'], ['BOOK_SCORES', 'Faculty'],
  ['LEADS', 'Faculty'], ['CLASSES', 'Faculty'], ['ARBOR_SUBJECTS', 'Faculty']
];

function renameFaculty(from, to) {
  requireAdmin_();
  const want = String(from || '').trim().toLowerCase();
  if (!want) throw new Error('Which department? renameFaculty("Old name", "New name").');
  const dry = !String(to || '').trim();
  const ss = ss_();
  let changed = 0;

  FACULTY_COLUMNS.forEach(function(pair){
    const sheet = ss.getSheetByName(TAB[pair[0]]);
    if (!sheet || sheet.getLastRow() < 2) return;
    const data = sheet.getDataRange().getValues();
    const col = data[0].map(String).indexOf(pair[1]);
    if (col === -1) return;
    let hits = 0;
    for (let r = 1; r < data.length; r++) {
      if (String(data[r][col] || '').trim().toLowerCase() !== want) continue;
      hits++;
      if (!dry) sheet.getRange(r + 1, col + 1).setValue(to);
    }
    if (hits) {
      changed += hits;
      Logger.log((dry ? 'Would change ' : 'Changed ') + hits + ' in ' + TAB[pair[0]] + '.' + pair[1]);
    }
  });

  // The Staff tab holds a list per person, so it is edited a name at a time.
  const staff = ss.getSheetByName(TAB.STAFF);
  if (staff && staff.getLastRow() > 1) {
    const data = staff.getDataRange().getValues();
    const col = data[0].map(String).map(function(h){ return h.toLowerCase(); }).indexOf('faculties');
    const col2 = col === -1 ? data[0].map(String).map(function(h){ return h.toLowerCase(); }).indexOf('faculty') : col;
    if (col2 !== -1) {
      for (let r = 1; r < data.length; r++) {
        const parts = splitFaculties_(data[r][col2]);
        if (!parts.some(function(p){ return p.toLowerCase() === want; })) continue;
        changed++;
        if (!dry) {
          staff.getRange(r + 1, col2 + 1).setValue(parts.map(function(p){
            return p.toLowerCase() === want ? to : p;
          }).join(', '));
        }
      }
    }
  }

  const verb = dry ? 'Would change ' : 'Changed ';
  Logger.log(verb + changed + ' in total.' + (dry ? ' Pass the new name to do it.' : ''));
  return verb + changed + '.';
}


/* ===================================================================
   RUN THIS ONE.

   setUpDepartments() does the three jobs in the order they have to happen:

     1. renames the departments that were written down under an older name,
        so what is already recorded keeps counting under the new one;
     2. fills the Faculties tab, which is the list of departments and the
        subjects under them;
     3. files the staff in STAFF_FACULTIES under their department;
     4. writes the Leads tab rows for the heads of department;
     5. adds the criteria, skipping any already there.

   Order matters only in that the renames come first: rename after the
   criteria are added and you get two of each, one under each name.

   Safe to run more than once. Nothing is deleted, and the second run of
   each step finds its work already done.
   =================================================================== */
const RENAMES = [
  ['Health and Social Care', 'Health & Social Care'],
  ['Childcare and Development', 'Child Development'],
  ['Arts', 'Creative Arts']
];

function setUpDepartments() {
  requireAdmin_();
  Logger.log('1. Renaming departments written down under an older name');
  RENAMES.forEach(function(r){
    Logger.log('   ' + r[0] + ' -> ' + r[1] + ': ' + renameFaculty(r[0], r[1]));
  });
  Logger.log('2. Filling the Faculties tab');
  Logger.log('   ' + addDepartments());
  Logger.log('3. Filing staff under their department');
  Logger.log('   ' + setStaffFaculties());
  Logger.log('4. Setting the heads of department');
  Logger.log('   ' + setLeads());
  Logger.log('5. Adding the criteria');
  Logger.log('   ' + addFacultyCriteria());
  Logger.log('Done. Deploy a new version, then check the Departments tab.');
  return 'Done - read the log above.';
}


/* ===================================================================
   FILING STAFF UNDER THEIR DEPARTMENT

   The Staff tab's Faculties column says which department a teacher belongs
   to. It decides the "isn't registered for" check on both forms, and it is
   what marks a department as someone's own.

   Put the people who need changing in STAFF_FACULTIES below: the name as
   the Staff tab writes it, then the departments, comma-separated. Two
   departments need a comma; the word "and" is part of a name now, so
   Health & Social Care stays whole.

   Nobody is added and nobody is removed. Only the Faculties cell of a
   person already on the tab is written, and only when it differs.
   =================================================================== */
const STAFF_FACULTIES = {
  'Coby Dalton': 'Creative Arts, Performing Arts'
};

function setStaffFaculties() {
  requireAdmin_();
  const ss = ss_();
  const sheet = ss.getSheetByName(TAB.STAFF);
  if (!sheet || sheet.getLastRow() < 2) throw new Error('The Staff tab is empty.');
  const data = sheet.getDataRange().getValues();
  const head = data[0].map(function(h){ return String(h || '').toLowerCase().replace(/[^a-z]/g, ''); });
  let col = head.indexOf('faculties');
  if (col === -1) col = head.indexOf('faculty');
  if (col === -1) throw new Error('The Staff tab has no Faculties column.');

  // Rows by name, however the tab spells the name across its columns.
  const rowOf = {};
  for (let r = 1; r < data.length; r++) {
    const obj = {};
    data[0].forEach(function(h, c){ obj[h] = data[r][c]; });
    const name = normalizeStaff_(obj).Name;
    if (name) rowOf[name.toLowerCase()] = r + 1;
  }

  const changed = [], already = [], missing = [];
  Object.keys(STAFF_FACULTIES).forEach(function(name){
    const row = rowOf[name.toLowerCase()];
    if (!row) { missing.push(name); return; }
    const want = STAFF_FACULTIES[name];
    if (String(data[row - 1][col] || '').trim() === want) { already.push(name); return; }
    sheet.getRange(row, col + 1).setValue(want);
    changed.push(name + ' -> ' + want);
  });

  if (changed.length) Logger.log('Filed: ' + changed.join('; '));
  if (already.length) Logger.log('Already right: ' + already.join(', '));
  if (missing.length) Logger.log('Not on the Staff tab, so not changed: ' + missing.join(', '));

  // Departments with nobody filed under them. Not a fault: the criteria still
  // show, and an observation still files correctly, because the observer picks
  // the subject on the form. It only means the "isn't registered for" check
  // has nothing to compare against for those.
  const staffed = {};
  readObjects_(ss, TAB.STAFF).map(normalizeStaff_).forEach(function(s){
    splitFaculties_(s.Faculty).forEach(function(f){ staffed[f.toLowerCase()] = true; });
  });
  const bare = facultyRows_(ss).filter(function(r){
    if (staffed[r.name.toLowerCase()]) return false;
    // A subject is covered by whoever is filed under its department.
    return !(r.parent && staffed[r.parent.toLowerCase()]);
  }).map(function(r){ return r.name; });
  if (bare.length) Logger.log('Nobody filed under, and no department above them either: ' + bare.join(', '));
  return 'Filed ' + changed.length + '.';
}


/* ===================================================================
   HEADS OF DEPARTMENT

   The Leads tab decides who gets the Departments tab and who can change a
   department's criteria. It matches on the address they sign in to Google
   with, so an address that is close but not exact simply never matches, and
   the person is refused with no clue why.

   Each entry below is one person: the address they sign in with, the
   departments they lead, and any older address the tab might still be
   holding. Leading a department leads the subjects under it, so a head of
   PE needs PE, not its six subjects.

   setLeads() rewrites only these people's rows. Anyone else on the tab is
   left exactly as they are.
   =================================================================== */
const LEADS = [
  { email: 'ben.wilson@baysgarthschool.co.uk',        faculties: 'DT',
    was: ['benjamin.wilson@baysgarthschool.co.uk'] },
  { email: 'scott.reagan@baysgarthschool.co.uk',      faculties: 'Business & ICT',
    was: ['scott.regan@baysgarthschool.co.uk'] },
  { email: 'lauren.fisher@baysgarthschool.co.uk',     faculties: 'Maths, Statistics',
    was: ['lauren.fisher@basygarthschool.co.uk'] },
  { email: 'coby.dalton@baysgarthschool.co.uk',       faculties: 'Creative Arts, Performing Arts' },
  { email: 'ashleigh.east@baysgarthschool.co.uk',     faculties: 'MFL' },
  { email: 'billy.mcnaught@baysgarthschool.co.uk',    faculties: 'PE' },
  { email: 'sophie.roberts@baysgarthschool.co.uk',    faculties: 'Maths, Statistics' },
  { email: 'gillian.sach@baysgarthschool.co.uk',      faculties: 'English' },
  { email: 'lynsey.dolby@baysgarthschool.co.uk',      faculties: 'Science' },
  { email: 'chloe.pool@baysgarthschool.co.uk',        faculties: 'Science' },
  { email: 'megan.grant@baysgarthschool.co.uk',       faculties: 'History' },
  { email: 'hannah.jackson@baysgarthschool.co.uk',    faculties: 'ICE' },
  { email: 'elliot.stevenson@baysgarthschool.co.uk',  faculties: 'English' }
];

function setLeads() {
  requireAdmin_();
  const ss = ss_();
  const sheet = ensureSheet_(ss, TAB.LEADS, ['Email', 'Faculty']);
  const data = sheet.getDataRange().getValues();

  // Every address this run owns, new and old, so their rows can be replaced
  // rather than added to. Nobody else's row is in this set.
  const owned = {};
  LEADS.forEach(function(l){
    owned[l.email.toLowerCase()] = l;
    (l.was || []).forEach(function(old){ owned[old.toLowerCase()] = l; });
  });

  // What the tab already says for each of them, to report what changes.
  const before = {};
  for (let r = 1; r < data.length; r++) {
    const email = String(data[r][0] || '').trim().toLowerCase();
    if (!owned[email]) continue;
    const key = owned[email].email;
    (before[key] = before[key] || []).push(String(data[r][0] || '').trim() + ' - ' + String(data[r][1] || '').trim());
  }

  // Delete from the bottom, so the rows above keep their numbers.
  let removed = 0;
  for (let r = data.length - 1; r >= 1; r--) {
    if (!owned[String(data[r][0] || '').trim().toLowerCase()]) continue;
    sheet.deleteRow(r + 1);
    removed++;
  }
  LEADS.forEach(function(l){ sheet.appendRow([l.email, l.faculties]); });

  // Say what actually changed, so a wrong address is visible rather than
  // silently replaced by another wrong address.
  const known = {};
  facultyRows_(ss).forEach(function(r){ known[r.name.toLowerCase()] = true; });
  const unknown = [];
  LEADS.forEach(function(l){
    const was = (before[l.email] || []).join(' | ') || 'nothing';
    const now = l.email + ' - ' + l.faculties;
    Logger.log((was === now ? '  unchanged: ' : '  ' + was + '  ->  ') + (was === now ? now : now));
    splitFaculties_(l.faculties).forEach(function(f){
      if (!known[f.toLowerCase()]) unknown.push(l.email + ': ' + f);
    });
  });
  Logger.log('Leads: ' + LEADS.length + ' people written, ' + removed + ' old rows replaced.');
  if (unknown.length) Logger.log('Not a department on the Faculties tab: ' + unknown.join(', '));
  return LEADS.length + ' leads set.';
}
