# 26: Admin user management — create logins, reset passwords, set roles

**What to build:** Admins manage login accounts from the UI: create a user
(email + name + initial password + role), reset a password, and change a
role. Basics only — no self-service password change, no email flows, no
deletion (users are referenced by sessions/issues/to-dos/ratings and are
permanent like everything else in the app). The seeded-owner account and any
account's *link* to a person remain managed where they are today (seed /
People page). All actions are admin-only at the seam; creation logs the user
in nowhere (no auto-session).

**Blocked by:** None beyond the completed build (01–25).

**Status:** done (reviewer sign-off; unauth pin trio + insert-catch mapping applied)

- [x] Admin can create a user (email, name, initial password, role
      admin/member) from a User Management page; duplicate email rejected;
      weak/empty password rejected (minimum 8 chars — pin the boundary)
- [x] Admin can reset any user's password (new password, same 8-char minimum);
      existing sessions of that user are invalidated (pin: old cookie stops
      working)
- [x] Admin can flip a user's role admin↔member; the seeded owner cannot
      demote themselves (guard: an admin cannot change their own role — pin)
- [x] Admin can see the user list (email, name, role, linked person) — reuse
      the aliasing pattern; list is admin-only
- [x] *(member)* all four operations denied at the seam; UI shows nothing
- [x] No delete path for users (permanent records, consistent with the app)
- [x] Seam tests: create round-trip, duplicate email, password boundary
      (7 rejected / 8 accepted), reset invalidates sessions, role flip +
      self-demotion guard, permission matrix, unauth denial
- [x] Documented in data-model.md (user-management section + the no-delete and
      no-self-service decisions)