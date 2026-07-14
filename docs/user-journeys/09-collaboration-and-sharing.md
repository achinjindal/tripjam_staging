# 09 — Collaboration & Sharing

TripJam's collaboration story is currently **schema-ready but UI-absent**: the database has a full multi-member model (`trip_members`, `invite_links`, `comments`, role-aware RLS policies), but the frontend never exposes any invite or member-management UI — the only row ever written to `trip_members` is the creator themselves, always with `role = 'edit'`. What ships today is (a) single-owner trips whose access is enforced by RLS through the membership table, and (b) a read-only public share link (`/share/:token`) backed by a `share_token` UUID on `trips` and anon RLS policies. There is **no realtime sync** and **no comments feature** in the app code, despite both having DB scaffolding.

---

## 1. Inviting companions — does not exist (yet)

There is no invite flow anywhere in `src/` or `supabase/functions/`:

- Searching the frontend for `invite` yields zero hits. The `invite_links` table (`schema.sql:3160-3168` — `trip_id`, `created_by`, `role` default `'edit'`, unique `token`, `expires_at`) is never queried by any app code or edge function.
- Chat was explicitly scoped down: `src/App.jsx:7148-7149` — `// chatFilter removed — no group features in phase 1` and `// mention/tagging removed — phase 1 is AI-only chat`.
- Vestigial multi-user affordances remain in the chat UI: a message authored by another user (`m.role === "user" && m.user_id !== session.user.id`, `src/App.jsx:13964-13965`) renders with a name label from `getMemberName()` (`src/App.jsx:8668-8671`), which looks up `trip.trip_members[].profiles.username` and falls back to `"Traveler"`. In practice this always falls back — the app never fetches `trip_members` with a `profiles` join; the only place `trip.trip_members` is populated is a hardcoded self-entry with `profiles: null` after IG completes (`src/App.jsx:8487-8489`).

### The membership table

`trip_members` (`schema.sql:3200-3206`):

```sql
CREATE TABLE public.trip_members (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    trip_id uuid,
    user_id uuid,
    role text DEFAULT 'edit'::text NOT NULL,
    joined_at timestamp with time zone DEFAULT now()
);
```

- `UNIQUE (trip_id, user_id)` (`schema.sql:4102-4103`); FKs cascade from `trips` and `profiles` (`schema.sql:5264-5273`).
- **Roles:** `role` is free text. The only value ever written by the app is `"edit"` (`src/App.jsx:7670`, `src/App.jsx:8376-8380`). RLS policies distinguish `role = 'edit'` for write access vs. plain membership for reads (implying a future viewer/comment role), but no other role name appears anywhere in code or migrations — there is no "comment" or "read-only" role in existence today.

### How the creator becomes a member

Membership is self-inserted right after the trip row is created, in two places:

- Draft trip creation (pre-RG): `src/App.jsx:7646-7670` — insert into `trips` with a client-generated `draftId`, then `insert({ trip_id: draftId, user_id: session.user.id, role: "edit" })` into `trip_members`.
- IG save path (new trips only): `src/App.jsx:8368-8384` — same pattern; a failed member insert aborts the save ("Failed to add you as trip member").

**Why trip IDs are client-generated** (`crypto.randomUUID()` at `src/App.jsx:7612` and `src/App.jsx:8273`): the app needs the trip ID _before_ the insert returns so it can (1) write the `trip_members` row and child rows without a `insert().select()` round-trip, and (2) avoid the RLS chicken-and-egg where reading back a just-inserted trip via member-based SELECT policies would fail before the membership row exists. With the ID known up front, inserts are fire-and-check-error only.

### Why you couldn't invite someone even via SQL from the client

The `trip_members` RLS policies only allow **self**-management:

- `"users can insert trip members" … WITH CHECK (user_id = auth.uid())` — you can only add yourself.
- `"users can read their own memberships" … USING (user_id = auth.uid())` — you can't even list the other members of your own trip.
- DELETE: `"Creators and members can delete memberships"` (`supabase/migrations/20260713000002_scope_service_role_policies.sql`) lets users remove their own membership and trip creators remove any member. (Before 2026-07-13 there was no DELETE policy and `src/Home.jsx`'s member-row delete was a silent no-op covered by the FK cascade.)

So a real invite feature will need either policy changes or an edge function using the service role (the `invite_links` table + its `"Edit members can create invite links"` policy at `schema.sql:5462-5464` look like the intended design).

---

## 2. Roles & permission enforcement

### In the database (real)

RLS enforces a two-tier model — _member_ (read) vs. _edit member_ (write) — even though only `'edit'` exists in practice:

| Table                                             | Read                                                                                                                          | Write                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `trips`                                           | creator (`schema.sql:5762`) OR any member (`"Trip members can view trip"`, `schema.sql:5621-5623`); anon if `share_token` set | UPDATE/DELETE: **creator only** (`schema.sql:5448`, `5455`); INSERT: `created_by = auth.uid()`                 |
| `days`                                            | members (`schema.sql:5558-5560`); anon if trip shared                                                                         | INSERT: members with `role = 'edit'` (`schema.sql:5491-5493`, plus duplicate `"trip editors can insert days"`) |
| `activities`                                      | members via day→trip join (`schema.sql:5519`); anon if trip shared                                                            | INSERT/UPDATE/DELETE: `role = 'edit'` members (`schema.sql:5471-5505`)                                         |
| `trip_todos` / `trip_bookmarks` / `trip_expenses` | creator OR member, all four verbs (`supabase/migrations/20260428000004_fix_rls_policies.sql`)                                 | same policy for INSERT/UPDATE/DELETE — **not** gated on `role = 'edit'`                                        |
| `trip_messages`                                   | members read; members insert only their own `user_id` (`schema.sql:5577-5588`)                                                | no UPDATE/DELETE policies                                                                                      |
| `brainstorm_items`                                | creator or members read (`schema.sql:5630-5634`)                                                                              | all writes: **creator only** (`"Trip owner manages brainstorm items"`)                                         |
| `profiles`                                        | any authenticated user can read any profile (`schema.sql:5737`) — the enabler for future member-name display                  | self only                                                                                                      |

Note the asymmetry: trip metadata updates (name, dates, `share_token`, `board_notes`, digests…) are creator-only, while days/activities are editable by any `'edit'` member, and Board widgets (todos/bookmarks/expenses) by _any_ member regardless of role.

### In the UI (none)

There is no permission gating in the frontend. No read-only or comment-mode rendering exists; `src/Home.jsx:83-86` fetches `trip_id, role` from `trip_members` but never uses `role`. Since the creator is the only member and holds `'edit'`, every authenticated view is fully interactive. If a second member were somehow added with a non-`edit` role, the UI would still render all edit controls and their writes would fail silently at the RLS layer (the code around `src/App.jsx:8911-8926` even has a comment acknowledging RLS-blocked deletes in the chat `update_day` path).

---

## 3. Shared editing & realtime — not implemented

There are **no Supabase Realtime subscriptions** in the app. `grep` for `channel(`, `postgres_changes`, or `removeChannel` across `src/` returns nothing. Two artifacts suggest it was planned:

- The `trip_messages` load effect in `src/App.jsx` does a one-time fetch on trip load; a comment above it used to claim a realtime subscription that never existed (corrected 2026-07-13).
- The `supabase_realtime` publication exists (`schema.sql:5923`) but no app tables are added to it, so `postgres_changes` events wouldn't fire even if the client subscribed.

Consequences: if two members did share a trip, edits would be last-write-wins with no live merge — remote changes appear only on full trip reload. Same for chat: another member's messages load once on mount and never stream in.

---

## 4. Public share link (`/share/:token`)

The one sharing feature that fully works. It is a **read-only, unauthenticated snapshot** of the itinerary.

### Token creation (lazy) and revocation

`trips.share_token` is a nullable `uuid` column (`supabase/migrations/20260406000003_add_share_token_to_trips.sql`, `schema.sql:3268`). It is generated client-side the first time the user shares, from either entry point:

- Side-menu "📤 Share trip" button: `src/App.jsx:10026-10050` — if `trip.share_token` is null, `UPDATE trips SET share_token = crypto.randomUUID()` (allowed by the creator-only UPDATE policy), then builds `${origin}/share/${token}` and hands it to `navigator.share` or the clipboard.
- The share bottom sheet (`showShare`, `src/App.jsx:12266+`): three options — "Share as image" (html2canvas PNG of a share card, `src/App.jsx:12316-12347`), "Copy as text" (plain-text day/activity list, `src/App.jsx:12377-12398`), and "Share link" (`src/App.jsx:12429-12456`, same token logic).

The share bottom sheet also offers **"🚫 Revoke share link"** (shown only when a token exists; added 2026-07-13): after a confirm dialog it sets `share_token = null`, immediately killing the existing link. Sharing again generates a fresh token.

### Routing

`src/main.jsx:76-79`: `parseUrl()` matches `/^\/share\/([a-f0-9-]{36})$/` and returns `{ page: "public", token }`. This is checked **before** any session logic — `src/main.jsx:238` renders `<TripPublicView token={...}/>` regardless of auth state. (`/trip/:id` at `src/main.jsx:100-102` is the separate authenticated namespace; the comment there notes the UUID is a trip ID, not a share token.)

### The read-only view

`src/TripPublicView.jsx` loads with the anon key via a single token-scoped RPC:

- `supabase.rpc("get_shared_trip", { p_token: token })` → `{ trip: {name, destination, start_date, end_date, summary}, days: [{id, label, city, date, activities: [{icon, time, title, note, duration, photo_url}]}] }`, or `{ trip: null }` for an unknown/revoked token.

Rendered: trip name, destination, date range, `trip.summary`, then per-day cards (first activity photo, day label/city/date, activity rows with icon/time/title/note/duration) and a "Try TripJam" CTA footer. Not exposed: todos, bookmarks, expenses, chat messages, brainstorm items — or any `trips` column beyond the five above.

### How anonymous read works

`supabase/migrations/20260713000001_share_token_rpc.sql` defines `get_shared_trip(p_token uuid)` as a `SECURITY DEFINER` SQL function granted to `anon`/`authenticated`. It matches `trips.share_token = p_token` exactly and returns only the whitelisted columns, so an anonymous client can fetch precisely one trip per known token.

History: before 2026-07-13, three `TO anon` SELECT policies (`20260406000003_add_share_token_to_trips.sql`) admitted **every** trip with a non-null token (all columns, plus its days/activities); the token comparison happened only client-side, so anonymous clients could enumerate all shared trips. That migration's policies are dropped by the RPC migration.

---

## 5. Comments — do not exist

The README-era plan left behind DB scaffolding only: `comments` (`schema.sql:3105-3111`, polymorphic `entity_type`/`entity_id` targeting trips, days, or activities), `reactions` (`schema.sql:3188+`, emoji per comment per user), `activity_log`, `forks`/`fork_members` (per-day alternate plans), each with member-scoped **SELECT-only** RLS policies (e.g. `"Members can view comments"`, `schema.sql:5538-5551` — no INSERT policy, so nobody could even write a comment under current rules). None of these tables is referenced anywhere in `src/` or `supabase/functions/`. There is no comments UI, no reactions UI, no forks UI.

---

## Key files

- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/schema.sql` — `trip_members` (3200), `invite_links` (3160), `comments` (3105), `share_token` column (3268), all RLS policies (5448-5860)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/migrations/20260406000003_add_share_token_to_trips.sql` — `share_token` column + original (since-dropped) anon policies
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/migrations/20260713000001_share_token_rpc.sql` — token-scoped `get_shared_trip` RPC
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/migrations/20260713000002_scope_service_role_policies.sql` — scoped service-role policies + `trip_members` DELETE
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/supabase/migrations/20260428000004_fix_rls_policies.sql` — todos/bookmarks/expenses member policies
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/App.jsx` — creator self-membership (7667-7670, 8376-8384), `getMemberName` (8668), share buttons (10026-10068, 12266-12470), "no group features in phase 1" (7148-7149)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/Home.jsx` — membership-driven trip list (83-100), trip delete (54-72)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/main.jsx` — `/share/:token` routing (76-79, 238)
- `/Users/achinjindal/Documents/Code/TravelPlannerAppClaude/src/TripPublicView.jsx` — anonymous read-only trip view
