# Accountability Chart

## Purpose (EOS context)

The Accountability Chart replaces the org chart. It defines **seats** (roles), not
people: each seat has a clearly defined set of responsibilities, and people are
matched to seats by GWC — do they **G**et it (capability), **W**ant it (passion),
and have the **C**apacity to do it. A seat may be empty; that is a feature (it
surfaces hiring needs).

## What it is

A visual chart of seats with reporting lines, plus per-seat and per-person detail
pages. For ~10 people this is one screen, not a zoomable enterprise chart.

### Seats

- Seat name (e.g., "Visionary", "Integrator", "Ops", "Sales") and an optional
  short description.
- The seat's responsibilities — EOS suggests a handful of bullet points ("5 major
  roles"); we store an ordered list of short strings, not free-form prose only.
- Reporting line: exactly one parent seat, or the top seat.
- A seat can exist unoccupied; a person can occupy **up to two seats** (small
  company — people wear multiple hats; the two-seat cap keeps the chart honest).

### People

- Person profile: name, photo (optional, skipped in v1 — no uploads in v1), email
  when the person has a login, start date (optional).
- A person is linked to zero, one, or two seats. Unlinked people (future hires) can exist
  without accounts.

### GWC ratings

- Per person-in-seat, three booleans: Get it / Want it / Capacity, plus a free-text
  note. Editable by admins; GWC is about the seat, not global traits, so a person
  who leaves a seat's ratings go with the person-seat link.

### People Analyzer

- A per-person, per-quarter scoring against each of the company's Core Values:
  `+` (exemplifies), `−/0` (mostly/needs work), `−−` (does not exemplify) — stored
  as a small enum per value.
- A second column for GWC summary (the three booleans rolled up) and the classic
  "right person / right seat" verdict.
- Viewable and editable by admins only (decided: scores are sensitive).

### Views

- **Chart view** — seats as cards in reporting-line layout; empty seats visually
  distinct; click through to seat detail.
- **Seat detail** — responsibilities, current occupant, GWC, history of occupants.
- **Person detail** — seat, GWC, People Analyzer row, their rocks/measurables
  (links into other modules once those exist).

## What it is not

- **Not an HR system.** No compensation, benefits, PTO, performance-review
  workflows, or personnel documents.
- **Not recruiting** — no candidate pipeline. An empty seat is just empty.
- **Not a permissions system for the app.** App roles (`admin`/`member`) are
  separate from seat hierarchy; the Integrator seat does not automatically grant
  admin rights.
- **No drag-and-drop reorganization tooling in v1** — restructuring happens at
  the quarterly cadence and can be done via simple move forms. DnD is a later nicety.

## Data concepts

- `seats`: id, name, description, responsibilities (ordered list), parent seat id,
  display order among siblings.
- `people`: id, name, email (nullable, unique when present), account link (nullable).
- `seat_assignments`: person ↔ seat with date range (so history survives moves).
- `gwc_ratings`: per assignment, get/want/capacity + note.
- `people_analyzer_scores`: per person, per quarter, per core value → enum score.
  Core values themselves live in the V/TO module (`core_values` table).

## v1 vs later

- **v1:** seats, chart view, seat/person detail, GWC, People Analyzer entry +
  display.
- **Later:** drag-and-drop chart editing, assignment history timeline UI,
  "structure review" prompts at quarter start.

## Decided

1. **Chart rendering:** hand-rolled nested tree with Tailwind until it doesn't
   hold up (depth is at most 2–3 at this size; revisit only if it breaks).
2. **Multiple seats:** yes — a person can hold up to two seats (small company,
   multiple hats). Schema and UI allow a second seat assignment explicitly.