# E2E Test Scenarios

The precise, per-test reference for the SevenOne Housekeeping end-to-end suite:
for every test — its **flow** through the system and exactly **what it verifies**.

Use this to understand a test before changing it, to find whether a behavior is
already covered, or to see at a glance what a red test was proving. It mirrors the
actual `tests/*.spec.ts` files; keep it in sync when you add or change a test.

**Conventions used below**

- *Setup* = data created through the real API before the browser work (the
  `hotel` fixture already gives you an admin, a manager, a housekeeper, and a
  dirty room unless noted).
- *Flow* = the ordered UI/API actions the test performs.
- *Verifies* = the assertions — what must be true for the test to pass.
- **Authoritative check** = an assertion made back through the API/DB, not just
  the screen, so a pass means the whole stack agreed.
- Apps by origin: **login** `:5174`, **web** `:5173`, **admin** `:5175`, **api**
  `:8000`.

Related: the product-level path catalogue lives in
`sevenone-docs/housekeeping/testing/user-paths.md`.

---

## AUTH — authentication & session (`auth.spec.ts`)

The cross-cutting seam every other journey rides on: sign-in routing, the SSO
cookie handoff, the forced first-login change, forgot/reset, logout, and the
defensive redirects.

### AUTH-01 — admin signs in, lands in the console
- **Flow:** go to login `:5174`; enter admin email/password; submit.
- **Verifies:** the browser ends on `admin:5175` (role → app routing for admin).

### AUTH-02 — manager signs in, lands on the dashboard
- **Flow:** log in as the manager.
- **Verifies:** lands on `web:5173/dashboard`.

### AUTH-03 — housekeeper signs in, lands on mobile My Tasks
- **Flow:** log in as the housekeeper.
- **Verifies:** lands on `web:5173/my-tasks` (the mobile shell).

### AUTH-04 — forced password change on first login
- **Setup:** a hotel provisioned with `clearForcedChange: false`, so the manager
  still carries `must_change_password=true` and only knows the temp password.
- **Flow:** log in with the temp password → the "Set a new password" card appears
  → set a new password → get redirected into the app. Then, in a fresh browser
  context, try to sign in again with the **old temp** password.
- **Verifies:** the new password lands the user on `/dashboard`; the original temp
  password is now **rejected** (change was enforced and persisted).

### AUTH-05 — forgot-password gives no account enumeration
- **Flow:** on login → "Forgot password?", submit a **real** account email; then
  repeat with an **unknown** email.
- **Verifies:** both show the identical "if that email exists…" confirmation (an
  attacker can't tell which emails are real).

### AUTH-06 — reset password via an emailed token
- **Setup:** mint a reset token directly in the DB (`mintResetToken`), since the
  reset email is a no-op in dev.
- **Flow:** open `/reset-password?token=…`; set and confirm a new password; submit.
- **Verifies:** the success message shows; **authoritative:** the token is marked
  used (single-use), and an API login with the new password succeeds.

### AUTH-07 — logout clears the session
- **Flow:** signed in as manager → click Logout.
- **Verifies:** bounced back to the login app (cookie cleared).

### AUTH-08 — unauthenticated deep link is bounced, then returned
- **Flow:** with no cookie, open a protected `web` URL → bounced to login with
  `?redirect=` → sign in.
- **Verifies:** after login the user is returned to the originally requested URL.

### AUTH-10 — the login password field can be shown and hidden
- **Flow:** on the login page, type a password; click the eye toggle; click it again.
- **Verifies:** the field starts `type=password`, becomes `type=text` (revealed),
  then `type=password` again (re-masked).

### AUTH-01-N — a wrong password is rejected
- **Flow:** valid email, wrong password, submit.
- **Verifies:** "Incorrect email or password" shows; still on the login app; no session.

### AUTH-08-N — cross-app redirect is refused (no open redirect)
- **Flow:** open login carrying a **hotel-app** `?redirect=` URL; sign in as **admin**.
- **Verifies:** the admin still lands on the **admin** app — a redirect pointing at
  another app is ignored (prevents open-redirect / cross-app misrouting).

### AUTH-09-N — losing the session mid-use bounces to login
- **Flow:** signed in as manager; clear the cookie; navigate to a `web` route.
- **Verifies:** the resulting 401 makes the API client redirect back to the login app.

---

## ADM — admin console (`admin.spec.ts`)

Provisioning hotels, editing them, and working the global access-request queue.

### ADM-01 — provision a hotel manually
- **Flow:** New-hotel wizard → enter name → add a room → add a housekeeper →
  Review → Create.
- **Verifies:** the one-time shared temp password is shown; the new hotel appears
  in the list.

### ADM-02 — provision a hotel via CSV import
- **Flow:** wizard → upload a rooms CSV (2 rows) → upload a staff CSV (2 rows) →
  Review → Create.
- **Verifies:** the parsed counts ("2 rooms", "2 staff members") show; the hotel
  is created and the temp password shown.

### ADM-03 — edit a hotel's settings
- **Flow:** open the hotel → rename → Save.
- **Verifies:** "Hotel updated" confirmation.

### ADM-04 — edit a staff member
- **Flow:** open the housekeeper's edit modal → wait for the form to populate
  (email is the stable signal) → rename → Save.
- **Verifies:** "Staff updated"; the new name appears in the list.

### ADM-05 — edit a room
- **Flow:** open a room's edit modal → change status to Out of service → Save.
- **Verifies:** "Room updated".

### ADM-06 — approve an access request (creates the staff member)
- **Setup:** a manager files a staff-add request via the API.
- **Flow:** admin opens the Requests queue, finds the request, clicks Approve.
- **Verifies:** a **confirmation popup** appears titled "Staff member added",
  names the new user's email, and states a welcome email was sent; after "Done"
  the card clears from the queue; **authoritative:** the new user now exists in
  the hotel's staff.

### ADM-07 — reject an access request
- **Setup:** a manager files a staff-add request via the API.
- **Flow:** admin opens the queue → Reject → confirm in the dialog.
- **Verifies:** "Request rejected"; the card clears (no user created).

### ADM-08 — the account page enforces the current password
- **Flow:** admin → Account → submit a **wrong** current password with a new one.
- **Verifies:** "Current password is incorrect" on the field; nothing changes.
  (The happy path is proven by MGR-10 against an isolated user, so the shared e2e
  admin's password is never rotated.)

### ADM-09 — admin sets a UI preference (theme)
- **Flow:** Preferences menu → Dark.
- **Verifies:** the `html.dark` class is applied.

---

## MGR — manager, hotel app (`manager.spec.ts`)

### MGR-01 — read the dashboard at a glance
- **Flow:** sign in → land on `/dashboard`.
- **Verifies:** the Rooms grid and Open-tasks sections render; the seeded room shows.

### MGR-02 & MGR-03 — room status + dirty-room prompt
- **Flow:** `/rooms` → change the room Dirty→Clean, then Clean→Dirty; the
  "Schedule cleaning?" prompt appears → accept it.
- **Verifies:** the status control reflects each change; accepting the prompt
  opens `/tasks/new?room=<id>` with the room prefilled.

### MGR-04 & MGR-04-N — create/assign a task; room required
- **Flow:** `/tasks/new` → save with no room (negative) → then pick room + assignee → Save.
- **Verifies:** the empty save shows a "Select a room" validation error and does
  **not** navigate; the valid save returns to `/tasks`; **authoritative:** one
  task exists, assigned, to the housekeeper.

### MGR-05 — edit / reassign a task
- **Setup:** an unassigned task seeded via the API.
- **Flow:** open the card from the board → assign to the housekeeper → Save.
- **Verifies:** **authoritative:** the task now belongs to the housekeeper.

### MGR-06, MGR-07 & MGR-09 — view staff, file a staff-add request, track it
- **Flow:** `/staff` (read-only list + "Request staff") → file an add request →
  `/requests`.
- **Verifies:** the team shows read-only; the filed request appears on the
  Requests page as **Pending**.

### MGR-08 — file a room-add request
- **Flow:** `/rooms` → "Request room" → submit → `/requests`.
- **Verifies:** the requested room shows as **Pending**.

### MGR-13 — pending add-requests show inline on Staff & Rooms
- **Setup:** the manager files a staff-add and a room-add request via the API.
- **Flow:** open `/staff`, then `/rooms`.
- **Verifies:** the requested staff appears on the Staff page flagged **Pending**;
  the requested room appears on the Rooms page flagged **Pending** (not only in
  the Requests tab).

### MGR-14 — a pending removal flags the existing row
- **Setup:** the manager files remove requests for the housekeeper and the room.
- **Flow:** open `/staff`, then `/rooms`.
- **Verifies:** the housekeeper's row and the room's row each show **Pending
  removal**.

### MGR-15 — auto-approve skips sign-off
- **Setup:** a task assigned to the housekeeper.
- **Flow:** manager turns on "Auto-approve completed tasks" on `/tasks` (waits for
  the toggle to reflect the persisted flag); the housekeeper completes the task
  via the API.
- **Verifies:** the task goes **straight to completed**; **authoritative:** the
  room is now `clean` (no manager approval needed).

### MGR-16 — reassign a housekeeper's whole workload (call-in)
- **Setup:** a hotel with a **second** housekeeper; two open tasks assigned to the
  first one.
- **Flow:** manager → `/tasks` → **Move workload** → pick who's out → reassign to
  the covering housekeeper → Move tasks.
- **Verifies:** toast "2 tasks moved"; **authoritative:** the first housekeeper
  now has 0 open tasks, the covering one has 2, all `assigned`.

### MGR-17 — clear completed tasks off the board
- **Setup:** a completed task.
- **Flow:** manager → `/tasks` → **Clear completed** → confirm in the alert dialog.
- **Verifies:** toast "1 completed task cleared"; **authoritative:** the default
  task list no longer returns it (soft-archived, not deleted).

### MGR-10 — manager changes their own password
- **Flow:** `/account` → current + new password → Change password.
- **Verifies:** "Password changed"; **authoritative:** an API login with the new
  password succeeds.

### MGR-11-N — bounced from admin-only hotel settings
- **Flow:** deep-link `/settings/hotel` as the manager.
- **Verifies:** redirected to `/dashboard` (role guard).

### MGR-12-N — tenant isolation
- **Setup:** a second, unrelated hotel.
- **Flow:** the manager's API client requests the other hotel's rooms.
- **Verifies:** **403/404** — a manager can never read another tenant (cross-tenant
  reads 404).

---

## FD — front desk, hotel app (`front-desk.spec.ts`)

Front desk = the manager's operational powers **minus** the request workflow.
These provision a hotel `withFrontDesk: true`.

### FD-01 — sign in, run room status, no Requests tab
- **Flow:** front desk signs in; check the nav; `/rooms` → change a room's status.
- **Verifies:** lands on `/dashboard`; the nav shows Rooms and Tasks but **not
  Requests**; the inline room-status control works (a manager-level power).

### FD-02-N — walled out of the requests workflow (UI + API)
- **Flow:** deep-link `/requests`; then file an access request via the API.
- **Verifies:** `/requests` bounces to `/dashboard`; the API `POST
  /access-requests` returns **403** (the `require_requester` guard admits only
  manager/admin).

### FD-03 — approve a task pending sign-off (manager-equivalent)
- **Setup:** a housekeeper completes a task via the API (→ `pending_approval`).
- **Flow:** front desk signs in → `/tasks` → Approve.
- **Verifies:** "Task approved"; **authoritative:** the task is `completed` and the
  room is `clean` — front desk has the approval power a manager does.

---

## HK — housekeeper, mobile hotel app (`housekeeper.spec.ts`)

### HK-01 — sees only their assigned task
- **Setup:** a task assigned to the housekeeper.
- **Flow:** sign in → `/my-tasks`.
- **Verifies:** the card shows the room, an **Assigned** badge, and a **Start** button.

### HK-02 & HK-03 — start, then submit for approval (room stays dirty)
- **Setup:** an assigned task.
- **Flow:** tap **Start** → then **Mark complete**.
- **Verifies:** Start moves the task to **In progress**; Mark complete moves it to
  **Pending approval** with "Awaiting manager approval" and no more action button;
  **authoritative:** the task is `pending_approval` and the room is **still
  dirty** — approval (not completion) is what cleans it.

### HK-04 — a new assignment appears on refetch
- **Flow:** sign in with no tasks ("no tasks assigned to you"); a manager assigns
  one via the API; reload.
- **Verifies:** the new task card appears.

### HK-06-N — walled out of manager screens
- **Flow:** deep-link `/rooms`, `/staff`, `/tasks`, `/settings/hotel`.
- **Verifies:** each bounces to `/my-tasks` (role guard).

### HK-07-N — cannot change status on a task that isn't theirs
- **Setup:** a task assigned to the **manager**.
- **Flow:** the housekeeper's API client PATCHes that task's status.
- **Verifies:** **403** — only the assignee may change a task's status.

---

## X-ROLE — the flagship end-to-end journey (`cross-role.spec.ts`)

### X-ROLE-01 — one task across admin → manager → housekeeper → manager
The single test that proves all the pieces work together. Uses two browser
contexts (manager and housekeeper are different identities → separate cookie jars).
- **Flow:**
  1. Manager signs in (`web`), lands on `/dashboard`.
  2. Manager creates a task and assigns it to the housekeeper.
  3. In a **separate context**, the housekeeper signs in, sees the task, taps
     **Start** → **Mark complete** → the task shows **Pending approval**.
  4. **Authoritative:** the task is `pending_approval` and the room is still `dirty`.
  5. Back as manager: `/tasks` → **Approve**.
  6. **Authoritative:** the task is `completed` and the room is `clean`.
  7. Manager's dashboard shows the room as **Clean**.
  8. Manager logs out → back at the login app.
- **Verifies (together, in one run):** role-based login routing, the cross-origin
  session cookie, tenant scoping, the approval sign-off, and the task→room
  side-effect.

---

## Boundary / negative paths (`boundaries.spec.ts`)

Cheap guard checks grouped in one file.

### ADM-05-N — duplicate room number rejected (409)
- **Setup:** a hotel with rooms 301 and 302.
- **Flow:** the admin API client PUTs room 302's number to `301`.
- **Verifies:** **409** conflict (no two rooms share a number in a hotel).

### ADM-04-N — duplicate staff email rejected (409)
- **Flow:** the admin API client PUTs the housekeeper's email to the manager's
  existing email.
- **Verifies:** **409** (emails are globally unique).

### HK-STAFF-N — a housekeeper cannot list staff (403)
- **Flow:** the housekeeper's API client `GET`s the hotel's `/users`.
- **Verifies:** **403** (housekeepers are execution-only; no staff visibility).

### API-401-N — an unauthenticated API call is rejected (401)
- **Flow:** call `GET /auth/me` with no session.
- **Verifies:** **401**.

### NAV-404-N — an unknown route renders the not-found page
- **Flow:** sign in as manager first (so an unauthenticated 401 bounce doesn't
  race the render), then navigate to a bogus `web` URL.
- **Verifies:** the "This page could not be found." page renders.
