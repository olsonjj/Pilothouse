# 02: People & account linking

**What to build:** Admin manages the company's people: create/edit people, and link (or unlink) a login account to each person. People are the identity every later module assigns things to.

**Blocked by:** 01: Scaffold, auth & test seam.

**Status:** ready-for-agent

- [ ] Admin can create, edit, and list people (name, optional email, optional start date)
- [ ] A person can be linked to a user account; unlinked people are allowed
- [ ] Person emails are unique when present
- [ ] Members can view but not edit people
- [ ] Tests through the server-function seam cover CRUD and permission denial
