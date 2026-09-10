# Quality Assurance Dashboard

Google Apps Script web app for lesson drop-ins and book scrutinies, with a Deep Dives view to follow. Backed by a Google Sheet.

## Files

| File | Purpose |
|------|---------|
| `Code.gs` | Server side: setup, permissions, submissions, dashboard data, drafts, criteria management, Gemini calls |
| `index.html` | Single-page client: observation form, book scrutiny form and overview, master dashboard, department views, coaching view, criteria editor |

## Book scrutiny

- Any member of staff can record a scrutiny from the Book Scrutiny tab. Each criterion is judged Met or Not met, with a justification box underneath for context (for example handwriting that reflects a known SEN need).
- Whole-school criteria are seeded by `setup()` into the `Book_Criteria` tab and managed by SLT on the Criteria tab. The SPaG code key sits in the `Hint` column and shows under the marking criterion.
- Heads of department can add faculty-specific book criteria under Departments, What we look for. Add these only where the faculty can judge them consistently.
- The subject-specific findings box is faculty data. It is stored in the `Book_Scrutiny` tab but is only ever returned to a head of that faculty viewing that faculty. It never appears in the SLT master view, the coaching view or an all-faculties CSV export.
- Results are stored long-format in `Book_Scores` (one row per criterion per scrutiny, with the comment).
- SLT and heads of department get an Overview sub-tab: criteria most often not met, staff needing support, per-faculty met rate, and recent scrutinies with comments.
- Coaches see each teacher's book scrutiny history under their drop-in history on the Coaching tab.

## Deploying

1. Create a Google Sheet and copy its ID into `SS_ID` at the top of `Code.gs`.
2. In the Apps Script editor, create a file called `index` (HTML) and paste `index.html` into it.
3. Run `setup()` once from the editor to create the tabs and seed the core criteria.
4. Fill the `Staff`, `Admins`, `Leads` and `Coaches` tabs in the sheet.
5. Optional: add a Script Property named `GEMINI_API_KEY` to switch on AI suggestions and themes.
6. Deploy as a web app, executing as the owner, accessible to anyone in the school Workspace domain.

## What is kept out of this repository

The spreadsheet ID and the seeded admin and coach email addresses are placeholders here. Set them in the live sheet rather than in the code.
