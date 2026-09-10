# 07: Core values

**What to build:** The company's core values as first-class rows (name, description, order, active flag), managed from the V/TO screen, with stable IDs so the People Analyzer can score against them without version churn breaking references.

**Blocked by:** 05: V/TO view & edit.

**Status:** done (reviewer sign-off; P0 edit-input fix e3d0ea7 + includeInactive admin gating applied)

- [x] Admin creates/edits/reorders/deactivates core values
- [x] Value IDs are stable across V/TO edits (edits never delete rows referenced by scores)
- [x] Core values display on the V/TO read view
- [x] Members view; only admins edit
- [x] Seam tests cover edit and deactivation flows
