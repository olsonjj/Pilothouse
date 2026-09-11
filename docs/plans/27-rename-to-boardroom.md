# 27: Rename to Boardroom — de-brand for public release

**What to build:** Rebrand the app from OpenEOS to **Boardroom** and replace
EOS-branded user-facing terminology with neutral names, so the repo can be
published publicly. Product name, nav labels, page headings, route paths, and
README are in scope. **DB table/column names and internal identifiers are NOT**
(never user-facing; renaming them is migration churn with no legal benefit —
documented). Add an MIT LICENSE and a README disclaimer
("inspired by the operating system described in *Traction*; not affiliated
with or endorsed by EOS Worldwide").

**Blocked by:** None (post-25 scope addition).

**Status:** done (review pending)

- [x] Product renamed Boardroom everywhere user-facing: package.json name,
      page titles, sign-in/home headings, cookie name
      (`openeos_session` → `boardroom_session`), DB filename
      (`data/openeos.db` → `data/boardroom.db`, file MOVED so existing data
      survives; code constant + docs updated)
- [x] Nav + headings: Scorecard → **Data** (`/scorecard` → `/data`); V/TO →
      **Company** (`/vto` → `/company`); Level 10 Meeting / L10 → **Weekly
      Meeting** (`/l10` → `/meeting`); People Analyzer → **Employee
      Assessment** (route stays `/people/analyzer`); Accountability Chart →
      **Org Chart** (`/chart` → `/org-chart`)
- [x] Meeting segments renamed (labels only — DB `segment_key` CHECK values
      unchanged): Segue → **Check-in**, Scorecard → **Data**, Rocks →
      **Goals**, IDS → **Issues**; "IDS queue" → "Issue queue"
- [x] Rocks → **Goals** user-facing: nav, `/rocks` → `/goals`, headings,
      buttons ("Add company goal", "Add personal goal"), copy ("over_rock_cap"
      warning text), derived issue titles ("Rock off track: …" → "Goal off
      track: …"); internal identifiers (`rocks` table, `RockError`,
      `carried_over_from_rock_id`, state keys) unchanged — documented
- [x] Seed email domain → `owner@boardroom.local` for FRESH installs only
      (existing rows untouched; README notes the dev seed credentials)
- [x] README rewritten for public: what it is, setup, the seed credentials,
      MIT LICENSE file added, disclaimer added; QA plan updated to new names
- [x] All tests updated for renamed strings/routes and passing; no DB
      migrations added (existing data preserved; renamed ROUTES only)
- [x] Gates: pnpm test / typecheck / build green; grep for "OpenEOS",
      "Level 10", "V/TO", "People Analyzer", "Accountability Chart", "IDS",
      "Segue", "Scorecard", "Rock" in src/ returns only internal identifiers
      and comments (document each remaining hit)