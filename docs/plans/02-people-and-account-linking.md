# 02: People & account linking

**What to build:** Admin manages the company's people: create/edit people, and link (or unlink) a login account to each person. People are the identity every later module assigns things to.

**Blocked by:** 01: Scaffold, auth & test seam.

**Status:** ready-for-agent

- [x] Admin can create, edit, and list people (name, optional email, optional start date)
- [x] A person can be linked to a user account; unlinked people are allowed
- [x] Person emails are unique when present
- [x] Members can view but not edit people
- [x] Tests through the server-function seam cover CRUD and permission denial
