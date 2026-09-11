# Quality Assurance Dashboard

Google Apps Script web app for lesson drop-ins and book scrutinies, with a Deep Dives view to follow. Backed by a Google Sheet.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Server side: setup, permissions, submissions, dashboard data, drafts, criteria management, Gemini calls |
| `SchoolData.gs` | Student sampler: reads pupil data through the Baysgarth Quest partner API (never Arbor directly) and builds stratified book samples |
| `index.html` | Single-page client: observation form, book scrutiny form and overview, master dashboard, department views, coaching view, criteria editor |

## Book scrutiny

- SLT and heads of department can switch a scrutiny to "Whole department": no named teacher, and the result counts in the department and whole-school figures but never against an individual. Stored in the `Scope` column.
- Any member of staff can record a scrutiny from the Book Scrutiny tab. Each criterion is judged Met or Not met, with a justification box underneath for context (for example handwriting that reflects a known SEN need).
- Whole-school criteria are seeded by `setup()` into the `Book_Criteria` tab and managed by SLT on the Criteria tab. The SPaG code key sits in the `Hint` column and shows under the marking criterion.
- Heads of department can add faculty-specific book criteria under Departments, What we look for. Add these only where the faculty can judge them consistently.
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
- **How it samples**: EHCP, SEN Support, Pupil Premium, the lowest and highest flightpath bands, looked-after, EAL, the middle bands, then one pupil with no flags for contrast, then random fill. Each group is filled only if nobody already chosen covers it, so a sample of six typically covers every need group and all four bands. Swap replaces one pupil with another from the same class.
- **Privacy**: pupil data is fetched live per request and never cached or written to the sheet. The response's SEN detail (category, notes, interventions, adjustments) is discarded on arrival; only the status letter, EAL flag and flightpath are held in memory. A sample attached to a scrutiny stores initials, year and codes only.
- **Department sampler** (SLT and heads of department): samples every class in a department, with CSV download and print. The class list comes from the warehouse in one call (`distinct: "class_code"`) and is cached for six hours, so no manual list is needed. Faculty is inferred from the code via the `Arbor_Subjects` tab (Subject abbreviation or name, Faculty). The optional `Classes` tab pins a faculty or a teacher to a code where the inference is wrong, and codes can always be typed straight into the sampler.

### Connecting the school data feed

1. Ask the Baysgarth Quest owner for the `PARTNER_TOKEN` value (it lives in the `baysgarth-quest` project's Secret Manager). This app keeps its own copy in a Script property, so treat the Apps Script project as holding a credential.
2. Add Script property `QUEST_PARTNER_TOKEN`. Optional: `QUEST_BASE_URL` (default `https://baysgarth-quest.web.app`).
3. Run `schoolDataProbe('10Y/En1')` from the editor with a real class code and read the log. It lists the warehouse tables and confirms one class resolves.
4. Fill `Arbor_Subjects` with subject abbreviation to faculty (for example `En`, `English`; `Ma`, `Maths`; `Science`, `Science`). The status line under the sampler names any subject codes it could not map. The `Classes` tab is optional.
5. Every partner call is audited on the Quest side (`partnerAudit`).

### Data protection

There is no signed DPIA for the Arbor pipeline. The Quest repository's own notes record every reference to one as an unticked to-do, and that was established when Pupil Premium and looked-after were added to the warehouse in September 2026. This app inherits that position: it reads pupil data through the governed feed and stores only initials, year and codes, but the underlying flow of pupil data out of Arbor is not yet covered by a completed assessment. That is a decision for the DPO and SLT, not a code change.

## Deploying

1. Create a Google Sheet and copy its ID into `SS_ID` at the top of `Code.gs`.
2. In the Apps Script editor, create a file called `index` (HTML) and paste `index.html` into it.
3. Run `setup()` once from the editor to create the tabs and seed the core criteria.
4. Fill the `Staff`, `Admins`, `Leads` and `Coaches` tabs in the sheet.
5. Optional: add a Script Property named `GEMINI_API_KEY` to switch on AI suggestions and themes.
6. Deploy as a web app, executing as the owner, accessible to anyone in the school Workspace domain.

## What is kept out of this repository

The spreadsheet ID and the seeded admin and coach email addresses are placeholders here. Set them in the live sheet rather than in the code.
