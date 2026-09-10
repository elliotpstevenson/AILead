# Quality Assurance Dashboard

Google Apps Script web app for lesson drop-ins and book scrutinies, with a Deep Dives view to follow. Backed by a Google Sheet.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Server side: setup, permissions, submissions, dashboard data, drafts, criteria management, Gemini calls |
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

## Arbor student sampler

`Arbor.gs` connects to Arbor's REST API (v2) and builds stratified book samples for a class, or for every class in a department.

- **What it pulls**: students and names, gender, year group, SEN status (K or E), Pupil Premium and FSM eligibility, children looked after, EAL (a first or home language that is not English), and flightpath. Classes come from teaching groups in the current academic year.
- **How it samples**: SEN, PP, CLA, EAL, each flightpath band (lowest and highest first) and each gender are covered before random fill, and one student with no flags is included for contrast. Swap replaces one student with another from the same class.
- **Privacy**: student data lives only in CacheService for six hours and is never written to the sheet. When a sample is attached to a scrutiny, the record stores initials, year, gender and codes only.
- **Baysgarth Quest**: the same credentials work in both projects. `ARBOR_BASE_URL` and `ARBOR_PASS` are accepted as aliases, and `ARBOR_PAGE_PARAMS=page,per-page` switches to the paging convention Quest assumes if the probe shows that is what the API wants.
- **Department sampler** (SLT and heads of department): samples every class mapped to a department, with CSV download and print. Nothing is saved.

### Connecting Arbor

1. In Arbor, create an API user with read access and note its email and API key. Arbor may need to enable API access for the school first.
2. Add Script properties: `ARBOR_SUBDOMAIN` (the part before `.uk.arbor.sc`), `ARBOR_USER`, `ARBOR_KEY`.
3. Optional: `ARBOR_FLIGHTPATH` says where flightpath is held. Default `udf:Flightpath` (a user-defined field called Flightpath). Alternatives: `tag:<prefix>`, `group:<custom group prefix>`, or `none`.
4. Run `arborProbe()` from the editor and read the log. It prints the root keys and one redacted item from each resource. If a resource returns 404 or a field is named differently, adjust `ARBOR.res` or `ARBOR_MAP` at the top of `Arbor.gs`.
5. Open the app as SLT, go to Book Scrutiny, and click "Refresh from Arbor". The status line lists any Arbor subjects not yet mapped to a faculty.
6. Fill the `Arbor_Subjects` tab (Subject, Faculty) so classes group under the right department. Unmapped subjects fall back to their subject name.

## Deploying

1. Create a Google Sheet and copy its ID into `SS_ID` at the top of `Code.gs`.
2. In the Apps Script editor, create a file called `index` (HTML) and paste `index.html` into it.
3. Run `setup()` once from the editor to create the tabs and seed the core criteria.
4. Fill the `Staff`, `Admins`, `Leads` and `Coaches` tabs in the sheet.
5. Optional: add a Script Property named `GEMINI_API_KEY` to switch on AI suggestions and themes.
6. Deploy as a web app, executing as the owner, accessible to anyone in the school Workspace domain.

## What is kept out of this repository

The spreadsheet ID and the seeded admin and coach email addresses are placeholders here. Set them in the live sheet rather than in the code.
