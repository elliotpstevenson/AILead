# Quality Assurance Dashboard

Google Apps Script web app for lesson drop-ins and book scrutinies, with a Deep Dives view to follow. Backed by a Google Sheet.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Server side: setup, permissions, submissions, dashboard data, drafts, criteria management, Gemini calls |
| `SchoolData.gs` | Student sampler: reads pupil data through the Baysgarth Quest partner API (never Arbor directly) and builds stratified book samples |
| `AddCriteria.gs` | One-off: loads a batch of department criteria into the `Criteria` tab. Run `addFacultyCriteria()` from the editor; safe to run twice, and the file can be deleted once the criteria are in |
| `index.html` | Single-page client: observation form, book scrutiny form and overview, master dashboard, department views, coaching view, criteria editor |

The tab bar is in two groups: everyday tabs on the left, and the leadership set (Master, Coaching, Criteria) held apart in a rounded panel on the right, so it is clear at a glance what is normal for staff to see.

## Departments

The `Faculties` tab is the list of departments: `Faculty`, `Parent`, `Active`. `Parent` is blank for a department that stands on its own, and names the department a subject sits under otherwise, so Music, Drama and Dance sit under Performing Arts.

- A department with subjects under it gets a second row of pills in the department view: **All of [department]**, then one per subject. All is the whole department, a subject is that subject alone, and the drop-in and book scrutiny figures below follow the choice.
- A subject **inherits its department's criteria**: a Drama drop-in carries what Performing Arts looks for as well as anything specific to Drama. It does not work the other way, so a Drama-only criterion never lands on a Music lesson.
- A subject **inherits its department's head**: the head of Performing Arts manages Drama's criteria and sees its data without a `Leads` row of their own. A lead of one subject leads only that subject.
- The faculty dropdowns on both forms group subjects under their department, so an observer picks Drama and the record still resolves to Performing Arts for the whole-department view.
- The department sampler covers a department's subjects when the department is chosen.
- The `Staff` tab still counts: a faculty named there and not in the `Faculties` tab still appears, on its own. The tab adds to the Staff list rather than replacing it, so nothing breaks before it is filled in.
- Run `setUpDepartments()` from `AddCriteria.gs` to do the lot: rename departments recorded under an older name, fill the `Faculties` tab, then load the criteria. The renames have to come first, or the criteria arrive twice, once under each name. Safe to run more than once. `addDepartments()`, `setStaffFaculties()`, `addFacultyCriteria()` and `renameFaculty(old, new)` can each be run on their own. `STAFF_FACULTIES` in that file is the list of staff to file under a department: it only writes the `Faculties` cell of someone already on the `Staff` tab, and names anyone it cannot find rather than adding them. It never moves a subject somebody has deliberately reparented, and the log names any faculty used on the Staff tab or on a criterion that is not in the list.

## Book scrutiny

- The sampler on the scrutiny form and the Department sampler do different jobs: the Department sampler plans a scrutiny, drawing lists for a whole year group or band to hand out, and saves nothing; the one on the form records the books actually looked at and is stored with the judgements, with the class named against each pupil. SLT and heads of department get a button across to the Department sampler from the form.
- Every scrutiny is one teacher's books, one class. A department-wide scrutiny is planned on the Department sampler and then recorded as the individual scrutinies it is made of. The `Scope` column stays in `Book_Scrutiny` so records saved while the whole-department option existed still read back correctly.
- Any member of staff can record a scrutiny from the Book Scrutiny tab. Each criterion is judged Met or Not met, with a justification box underneath for context (for example handwriting that reflects a known SEN need).
- Whole-school criteria are seeded by `setup()` into the `Book_Criteria` tab and managed by SLT on the Criteria tab. The SPaG code key sits in the `Hint` column and shows under the marking criterion.
- Subject-specific criteria for both drop-ins and book scrutinies are added under **Departments, Criteria (drop-ins and books)**, by that department's head or by SLT. Both forms carry a button through to it under the criteria list, so an observer who finds a criterion missing can go straight there. SLT can also add a faculty criterion from the Criteria tab by setting Type to Faculty-specific. Add these only where the faculty can judge them consistently.
- Criteria can be reworded in place (edit and Save), hidden from the form without losing their history (the Visible toggle), or deleted outright. Delete asks first, and the question says how many judgements have already been made against that criterion. Those judgements survive either way, since every score row stores the wording it was judged against, so past observations and scrutinies still read correctly; what changes is that a deleted criterion no longer appears in the dashboard totals. SLT can do this to whole-school criteria, a head of department only to their own department's.
- The subject-specific findings box is faculty data. It is stored in the `Book_Scrutiny` tab but is only ever returned to a head of that faculty viewing that faculty. It never appears in the SLT master view, the coaching view or an all-faculties CSV export.
- Results are stored long-format in `Book_Scores` (one row per criterion per scrutiny, with the comment).
- The book scrutiny overview (criteria most often not met, staff needing support, per-faculty met rate, recent scrutinies with comments) sits at the bottom of the Master tab for SLT and of each department view, on the same filters as the drop-in data above it.
- Department-specific book criteria are departmental data only. They count in that department's view and never in the whole-school master figures.
- The five whole-school criteria seed themselves the first time the form loads if the `Book_Criteria` tab is missing or empty, so `setup()` does not have to be re-run.
- Coaches see each teacher's book scrutiny history under their drop-in history on the Coaching tab.

## Student sampler (school data via Baysgarth Quest)

`SchoolData.gs` builds stratified book samples for a class, or for every listed class in a department. It reads pupil data through the **Baysgarth Quest partner API**, never from Arbor directly. That is the school's data governance rule (see CoPlanner `docs/ARBOR_WAREHOUSE.md`): one governed feeder in the Quest backend owns the Arbor credentials, and every other app reads the BigQuery warehouse or the Quest partner endpoints.

- **Endpoint used**: `POST /api/v1/partner/learning-class` with `{ classCode }` and the `x-partner-token` header. It returns every pupil in the class with name, year, flightpath (Foundation, Intermediate, Higher, Excellence), SEN status and EAL, and does tolerant class-code matching itself (typing `10yen1` resolves to `10Y/En1`).
- **What the feed carries**: year, SEN (shown as K or E), Pupil Premium, looked-after, EAL and flightpath. PP is Ever 6, read from Arbor's funding records, so it covers FSM for scrutiny purposes. Looked-after is present tense, in care now rather than ever. Gender is not in the feed. Each flag is true, false or null, and a pupil is only ever shown as PP or CLA on a true, never on a null.
- **How it samples**: ability spread is the spine. Slots are dealt across the flightpath bands in the order lower, middle, top, then the remaining bands, cycling until the sample is full, so three pupils give bottom, middle and top rather than the bottom three. Within each band the highest-need pupil is taken: an EHCP outranks everything, then SEN Support, then Pupil Premium, looked-after and EAL. An indicator the sample does not yet carry is weighted up, so those flags land on pupils who also answer a band rather than costing a slot of their own. Pupils with no flightpath are dealt after the banded ones, never excluded. Swap replaces one pupil with another from the same class.
- **Privacy**: pupil data is fetched live per request and never cached or written to the sheet. The response's SEN detail (category, notes, interventions, adjustments) is discarded on arrival; only the status letter, EAL flag and flightpath are held in memory. A sample attached to a scrutiny stores initials, year and codes only.
- **Department sampler** (SLT and heads of department): choose a department, a year group and a band, and it samples every class that matches, with CSV download and print. A whole-department scrutiny is planned by year and band rather than class by class, so there are no class codes to type; the line under the filters names the classes it will cover before you generate. Leave year or band on "All" for the whole department. Year and band are read off the class code (`10X/En1` is Year 10, band X; `10 Elevate` is Year 10 and unbanded), and only the years and bands the department actually teaches are offered.
- **The `Classes` tab takes an Arbor report as it comes.** Paste a teaching groups export straight in. Headings are matched on aliases rather than exact names, so `Teaching Group: Name`, `Group Name`, `Class Code` and `Class` all read as the class code, and `Staff: Name`, `Teacher` or `Member of staff` as the teacher; `Faculty`, `Department` or `Dept` for the faculty, `Subject` or `Course` for the subject. Columns it does not recognise are ignored, and the headings do not have to be on row 1, so a title or a blank line above them is fine. A report with a row per teacher repeats the class code; the first teacher listed is kept. Run `schoolDataProbe()` after pasting and the log names which column it took for what, which it ignored, and how many classes still have no faculty.
- The class list comes from the warehouse in one call (`distinct: "class_code"`) and is cached for six hours, so no manual list is needed. Faculty is inferred from the code via the `Arbor_Subjects` tab (Subject abbreviation or name, Faculty). The optional `Classes` tab pins a faculty or a teacher to a code where the inference is wrong. Single class codes can still be typed straight into the per-class sampler on the scrutiny form.

### Connecting the school data feed

1. Ask the Baysgarth Quest owner for the `PARTNER_TOKEN` value (it lives in the `baysgarth-quest` project's Secret Manager). This app keeps its own copy in a Script property, so treat the Apps Script project as holding a credential.
2. Add Script property `QUEST_PARTNER_TOKEN`. Optional: `QUEST_BASE_URL` (default `https://baysgarth-quest.web.app`).
3. Run `schoolDataProbe('10Y/En1')` from the editor with a real class code and read the log. It lists the warehouse tables and confirms one class resolves.
4. Fill `Arbor_Subjects` with subject abbreviation to faculty (for example `En`, `English`; `Ma`, `Maths`; `Science`, `Science`). The status line under the sampler names any subject codes it could not map. The `Classes` tab is optional.
5. Every partner call is audited on the Quest side (`partnerAudit`).

### Data protection

There is no signed DPIA for the Arbor pipeline. The Quest repository's own notes record every reference to one as an unticked to-do, and that was established when Pupil Premium and looked-after were added to the warehouse in September 2026. This app inherits that position: it reads pupil data through the governed feed and stores only initials, year and codes, but the underlying flow of pupil data out of Arbor is not yet covered by a completed assessment. That is a decision for the DPO and SLT, not a code change.

## Deploying

1. Create a Google Sheet. In the Apps Script editor, open Project Settings and add a Script property `SPREADSHEET_ID` holding the long id from the sheet's URL. The id lives there rather than in the code so that pasting a new `Code.gs` cannot wipe it; a script bound to its own sheet needs neither. `SS_FALLBACK_ID` at the top of `Code.gs` is a last resort and stays a placeholder here.
2. In the Apps Script editor, create a file called `index` (HTML) and paste `index.html` into it.
3. Run `setup()` once from the editor to create the tabs and seed the core criteria.
4. Fill the `Staff`, `Admins`, `Leads` and `Coaches` tabs in the sheet.

### Giving a head of department access

Add a row to the **`Leads`** tab: `Email` (their school address, exactly as they sign in to Google) and `Faculty`. One row can name more than one department, separated by commas, semicolons or slashes (`MFL, Geography`), or use a row each. Only those separate: a department whose own name contains "and" or "&" (Health & Social Care, Childcare and Development) stays whole, in the `Staff` tab as well, so two departments need a comma between them rather than the word "and". That is the whole change; nothing in the code holds names or permissions. They then see the Departments tab, their own department marked, and can add and edit that department's drop-in and book scrutiny criteria there. Case, spacing and punctuation in the faculty name do not matter, but the name itself must be one the `Staff` tab uses, since the department list is built from that tab's `Faculties` column: writing `ICT` where staff are filed under `Computing` will not match, and a department no member of staff is filed under does not exist at all. The same name should also be what the `Arbor_Subjects` tab maps that subject's classes to, or the department sampler will find no classes for it.
5. Optional: add a Script Property named `GEMINI_API_KEY` to switch on AI suggestions and themes.
6. Deploy as a web app, executing as the owner, accessible to anyone in the school Workspace domain.

## What is kept out of this repository

The spreadsheet ID and the seeded admin and coach email addresses are placeholders here. The spreadsheet ID belongs in the `SPREADSHEET_ID` script property, the addresses in the live sheet's own tabs.
