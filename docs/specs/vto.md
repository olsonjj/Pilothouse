# Vision/Traction Organizer (V/TO)

## Purpose (EOS context)

The V/TO is a two-page document that answers the Eight Questions so everyone in the
company shares the same vision. In EOS it is reviewed annually (and touched
quarterly); it belongs to the leadership team but is **visible to all employees** —
that visibility is the point.

## What it is

A small set of structured forms, one per question, rendered as a two-page view.
Fields are mostly short text, with two list-shaped fields. The whole document has a
version history.

### The Eight Questions

**Page 1 — Vision (longer-term):**

1. **Core Values** — 3–7 values, each with a name and a one-two sentence
   description. (Ordered list; referenced by the People Analyzer.)
2. **Core Focus** — "Why we exist" + "What we do" (a short paragraph plus a tagline).
3. **10-Year Target** — one big measurable goal, single text field plus optional
   date.

**Page 2 — Strategy & Plan (near-term):**

4. **Marketing Strategy** — the four sub-fields EOS prescribes: target market,
   three uniques, proven process, guarantee.
5. **3-Year Picture** — date + revenue target + profit target + a handful of
   "looks like" statements (list).
6. **1-Year Plan** — year, revenue target, profit target + "looks like" statements
   (list) + a short list of 1-year priorities.
7. **1-Year Profit/Metrics** — folded into the 1-Year Plan fields.
8. **Issues List (V/TO)** — not part of this module; captured by the Issues module
   (see issues.md). The V/TO displays a link/count only.

### Behavior

- Everyone can view; only admins can edit (the vision is the owner's to set, with
  team input happening outside the tool or in L10s).
- **Versioning:** editing creates a new version (snapshot of all fields) with
  author + date; version history is viewable and restorable. Snapshot-per-save is
  acceptable at this size — no field-level diffing in v1.
- A "published as of" date is displayed on the view.
- No draft/publish split: what admins type is live (versions provide the safety net).

## What it is not

- **Not a strategy wiki** — no free-form pages, attachments, or embedded docs.
- **Not an OKR cascade** — the 1-Year Plan is a short list of priorities; it does
  not generate or link to rocks automatically. (Rocks reference the year; we do not
  build dependency trees between them.)
- **Not a presentation tool** — no slideshow export. If someone wants slides they
  print the page.
- **No per-question comments or discussion.** Vision debates happen in the L10's
  IDS, captured as issues.

## Data concepts

- `vto` versioned snapshot: all text fields, plus child tables for core values
  (`core_values`), 3-year "looks like", 1-year plan items, marketing strategy
  sub-fields.
- `core_values` is the canonical list consumed by the People Analyzer module; the
  active version's core values are the ones scored against.
- Financial figures stored as plain decimal strings/ints; no currency handling
  beyond a display setting.

## v1 vs later

- **v1:** full eight questions, read view for everyone, edit forms for admins,
  version history with restore.
- **Later:** diff view between versions, PDF/print styling.

## Decided

1. **Structured lists** — the 3-Year Picture and 1-Year Plan are ordered lists of
   short statements, not free-text textareas.
2. **No read acknowledgement** — we do not track "I've read it" from employees.

---

*Historical open questions (both decided above):* list-vs-textarea structure for
the 3-Year Picture and 1-Year Plan; per-employee acknowledgement tracking.