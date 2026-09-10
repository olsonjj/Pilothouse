# Scorecard

## Purpose (EOS context)

The Scorecard is 5–15 high-level weekly metrics per team that predict the company's
health. Each metric has an owner and a **weekly numeric target**; a week is judged
on whether the number hit the target (traffic light: green = on/above, red = off).
EOS emphasizes *activity measurables* and weekly cadence over vanity annual numbers.

## What it is

A per-week, per-metric data-entry grid with traffic-light rendering and trend
history.

### Metrics

- Metric definition: name, owner (person), weekly target (number), optional
  comparison direction (`>=` target is good, default; `<` supported for metrics
  like "errors" where lower is better), optional unit suffix for display
  (e.g., "%", "$", "leads").
- Definitions can change over time (rename, re-target); history rows keep the
  week's actual vs the target **as it was that week**? — No: keep it simple.
  Targets live on the metric definition with an effective quarter (change targets
  at quarter boundaries; history rows store the target value at entry time for
  accurate retro rendering).
- Metrics are team-scoped in the schema but in v1 all belong to the single team.

### Weekly entry

- The grid: metrics as rows, recent weeks as columns. The owner (or any admin)
  enters the actual number per week; green/red color derives automatically from
  target comparison.
- Entry is per-week, once: entering again overwrites. No decimal-hell — plain
  numbers, stored as real/int.
- **Trend view:** per metric, a simple bar/spark display of the last 8–12 weeks
  colored by pass/fail. No chart library in v1; CSS bars suffice.
- **Rollup:** a simple "weeks on-track %" per metric and per owner over the
  trailing quarter. No weighted scoring, no composites.

### Level 10 integration

- The L10 Scorecard segment renders the previous week's column with
  pass/fail flags and a "make this an issue" button per red cell (feeds the
  Issues module).

## What it is not

- **Not a BI tool.** No SQL exploration, no custom dashboards, no chart editor, no
  exports beyond copy/paste.
- **No automatic data feeds.** Metrics are typed in by humans. Integrations with
  Stripe/CRM/etc. are explicitly out of scope, forever until someone argues hard
  for one.
- **Not daily tracking.** Weekly granularity only; daily/annual metrics are out of
  scope.
- **Not the same as rock measurables.** A rock's number is progress toward done;
  a scorecard metric is a weekly pulse. Separate storage.

## Data concepts

- `metrics`: id, name, owner_person_id, team_id, target, direction enum,
  unit, active flag, quarter-effective fields.
- `metric_entries`: metric_id, week (date of week start), value, entered_by,
  target_at_entry.
- Weeks are derived from a single helper (same as rocks' weekly statuses) — one
  week-convention utility shared by Scorecard, Rocks status, and To-Do due dates.

## v1 vs later

- **v1:** metric CRUD, weekly grid entry, traffic lights, 8–12 week trend bars,
  L10 red-cell issue push.
- **Later:** quarterly rollup summary view, per-owner view filtering.

## Decided

1. **Week convention** — Monday-start weeks, displayed as "Week of Mar 3". The
   shared week utility derives week starts as Mondays; Scorecard, Rock statuses,
   and To-Do due dates all consume it.

---

*Historical open question (now decided above):* week convention was pending
before the shared week utility was specified.