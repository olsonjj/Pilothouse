# Pilothouse — Documentation

Pilothouse is an open-source tool for small companies running a leadership
operating system (inspired by the one described in *Traction* by Gino Wickman;
not affiliated with EOS Worldwide). Built for a single company (~10 people).
Historical note: the project used the working names "Pilothouse" and "Boardroom" before the public release; the
spec sections use the original terminology (V/TO, L10, Rocks, …) — the mapping
to current user-facing names is in [`data-model.md`](./data-model.md).

## Reading order

1. [`overview.md`](./overview.md) — what this is, what it is not, global assumptions
   and decided decisions.
2. [`data-model.md`](./data-model.md) — tables, conventions, and cross-module links.
3. [`plans/pilothouse-execution-plan.md`](./plans/pilothouse-execution-plan.md) — the
   execution spec for implementing the whole build.
4. [`plans/01`…`25`](./plans/) — tickets as individual markdown files, numbered
   in dependency order (blockers first). Each declares its blockers; work the
   frontier (any ticket whose blockers are all done).
5. [`qa-testing-plan.md`](./qa-testing-plan.md) — manual QA plan for reviewing
   every module, including the two-account setup and permission matrix.
5. Tool specs, in build order:

### Tier 1 — Core

| Spec | Tool |
| --- | --- |
| [`specs/org-chart.md`](./specs/org-chart.md) | Org Chart (seats, Right Fit, Employee Assessment) |
| [`specs/company.md`](./specs/company.md) | Company (vision, core values, multi-year plan) |
| [`specs/goals.md`](./specs/goals.md) | Goals (quarterly priorities) |
| [`specs/weekly-meeting.md`](./specs/weekly-meeting.md) | Weekly Meeting (timed agenda, shared live view) |

### Tier 2 — Next

| Spec | Tool |
| --- | --- |
| [`specs/data.md`](./specs/data.md) | Data (weekly metrics) |
| [`specs/issues.md`](./specs/issues.md) | Issues Lists (long-term / short-term) |
| [`specs/todos.md`](./specs/todos.md) | To-Dos (7-day action items) |

## Shared vocabulary

- **Seat** — a role on the Accountability Chart. Seats are filled by people; a seat
  exists even when empty.
- **Person** — an employee profile; optionally linked to a login account.
- **Team** — a group of seats that meets together. Initially there is one team
  (the whole company acting as its own leadership team). The data model supports
  multiple teams but the UI does not need to expose team management in v1.
- **Quarter** — a 90-day operating quarter. Goals, Data weeks, and meeting archives
  are quarter-scoped.
- **Issue solving** — identify, discuss, solve; the method used in the Weekly Meeting's Issues segment.