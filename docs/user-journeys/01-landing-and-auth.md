# User Journey 01 — Landing & Auth

An unauthenticated visitor lands on the public marketing page at `/`, signs up with email + password (or Google OAuth), and ends up with a Supabase session, a `profiles` row with an auto-derived username, and 100 free credits. Signin additionally accepts legacy usernames via a synthesized `<username>@tripjam.app` email shim. Password recovery, legal pages, and the public share view are all reachable without a session; everything else falls back to the Auth screen.

> Note: `CLAUDE.md` still says "Auth uses username + password only (no email)". That is stale — as of the D9 migration ([supabase/migrations/20260526000002_auth_migration_email_mandatory.sql](../../supabase/migrations/20260526000002_auth_migration_email_mandatory.sql)) email is mandatory at signup and username is auto-derived. The fake-email shim survives only as a signin path for pre-D9 accounts.

---

## 1. URL routing — how an unauthenticated user reaches each screen

All routing is hand-rolled in `parseUrl()` at [main.jsx:76](../../src/main.jsx#L76) — no router library. Relevant routes:

| Path                                  | Route                                                               | Auth required? |
| ------------------------------------- | ------------------------------------------------------------------- | -------------- |
| `/`                                   | `home` → `Landing` when signed out, `Home` when signed in           | no             |
| `/signin`, `/login`                   | `signin` ([main.jsx:80](../../src/main.jsx#L80))                    | no             |
| `/signup`                             | `signup`                                                            | no             |
| `/forgot-password`, `/reset-password` | password recovery ([main.jsx:82-83](../../src/main.jsx#L82-L83))    | no             |
| `/privacy`, `/terms`                  | legal pages                                                         | no             |
| `/share/:token` (36-char UUID)        | `public` → `TripPublicView` ([main.jsx:78](../../src/main.jsx#L78)) | no             |
| everything else                       | trip/create/admin routes                                            | yes            |

Render-order in `Root()` matters ([main.jsx:236-258](../../src/main.jsx#L236-L258)):

1. `public`, `privacy`, `terms`, `forgot-password`, `reset-password` render **before** the session check — always available regardless of auth state.
2. While the session is still loading (`session === undefined`) the app renders `null` ([main.jsx:250](../../src/main.jsx#L250)).
3. With no session: `/` renders `<Landing />`; `/signup` renders `<Auth initialMode="signup" />`; **any other path** (e.g. a deep link to `/trip/:id`) falls back to `<Auth initialMode="signin" />` so the user can sign in and continue ([main.jsx:251-258](../../src/main.jsx#L251-L258)).

Internal navigation between unauthenticated screens (Landing ↔ Auth ↔ ForgotPassword) uses `pushState` + a manually dispatched `PopStateEvent` (e.g. [Landing.jsx:10-14](../../src/Landing.jsx#L10-L14)); `Root` listens for `popstate` and bumps `urlVersion` to force a re-render ([main.jsx:127-129](../../src/main.jsx#L127-L129), [main.jsx:195-222](../../src/main.jsx#L195-L222)).

## 2. Landing page (`/`, signed out)

[Landing.jsx](../../src/Landing.jsx) is a single-scroll marketing page: `Header · Hero · HowItWorks · Pricing · FAQ · Footer` ([Landing.jsx:36-54](../../src/Landing.jsx#L36-L54)). Purely static — no backend calls.

- **CTAs:** "Sign in" / "Sign up free" in the header ([Landing.jsx:93-127](../../src/Landing.jsx#L93-L127)), "Start planning" in the hero ([Landing.jsx:184-201](../../src/Landing.jsx#L184-L201)) — all `navTo("/signin" | "/signup")`.
- **Pricing claims baked into copy:** free signup = 100 credits ([Landing.jsx:230](../../src/Landing.jsx#L230), [Landing.jsx:350-364](../../src/Landing.jsx#L350-L364)); $5 → 300 credits; $10 → 1000 credits. If credit economics change, this copy must be updated by hand.
- **Body-scroll unlock:** the app shell locks body scroll, so Landing releases it while mounted and restores on unmount ([Landing.jsx:18-34](../../src/Landing.jsx#L18-L34)). `LegalPage` does the same thing ([LegalPage.jsx:17-33](../../src/LegalPage.jsx#L17-L33)).
- **Footer** links to `/privacy`, `/terms`, and `mailto:` support ([Landing.jsx:761-763](../../src/Landing.jsx#L761-L763)).

## 3. Signup (`/signup`)

[Auth.jsx](../../src/Auth.jsx) renders both modes; `initialMode` comes from the URL, and the bottom link flips modes in place via `switchMode()` which also `pushState`s the URL without reload ([Auth.jsx:95-102](../../src/Auth.jsx#L95-L102)).

**What the user sees:** Google button, an "or" divider, then Email + Password fields, a "Create account" button, and Terms/Privacy links ("By creating an account, you agree…", [Auth.jsx:454-484](../../src/Auth.jsx#L454-L484)).

**Validation** ([Auth.jsx:118-125](../../src/Auth.jsx#L118-L125)): email required and must match `EMAIL_RE` (`/^[^\s@]+@[^\s@]+\.[^\s@]+$/`, [Auth.jsx:7](../../src/Auth.jsx#L7)); password required, min 6 chars. Errors render inline in a red box ([Auth.jsx:415-429](../../src/Auth.jsx#L415-L429)).

**Flow of `handleSignUp()`** ([Auth.jsx:118-167](../../src/Auth.jsx#L118-L167)):

1. Email lowercased/trimmed; a username is derived from the local part — `+tags` stripped, non-`[a-z0-9._-]` chars removed, capped at 30 chars ([Auth.jsx:22-29](../../src/Auth.jsx#L22-L29)).
2. `pickAvailableUsername()` probes `profiles.username` for collisions, suffixing `-2`, `-3`, … up to 10 tries, then falls back to a random suffix ([Auth.jsx:33-48](../../src/Auth.jsx#L33-L48)).
3. `supabase.auth.signUp({ email, password, options: { data: { username, full_name } } })` ([Auth.jsx:132-141](../../src/Auth.jsx#L132-L141)). Supabase error message shown verbatim on failure.
4. Client-side upsert of the `profiles` row ([Auth.jsx:148-165](../../src/Auth.jsx#L148-L165)) — "belt-and-braces" alongside the DB trigger (below). If the upsert fails, the user sees `Account created but profile failed: … Contact support.`

There is no "check your email to confirm" UI state in `handleSignUp()` — the code assumes signup proceeds directly to a session. Whether email confirmation is required is a Supabase dashboard setting, not visible in the repo; if confirmation were enabled, this screen would silently do nothing after signup.

**Google OAuth** ([Auth.jsx:104-116](../../src/Auth.jsx#L104-L116)): `signInWithOAuth({ provider: "google", redirectTo: origin + "/" })`. Requires the Google provider to be configured in the Supabase dashboard ([Auth.jsx:9-10](../../src/Auth.jsx#L9-L10)); on error the message is shown, on success the browser redirects away.

### Server-side new-user side effects

The DB trigger `create_profile_on_auth_signup` (defined in [20260526000002_auth_migration_email_mandatory.sql:48-86](../../supabase/migrations/20260526000002_auth_migration_email_mandatory.sql#L48-L86)) fires on every `auth.users` INSERT — covering Google OAuth signups that never run the client upsert. It derives username from `raw_user_meta_data` → email local part → `user_<id-prefix>`, and inserts `profiles (id, username, email, display_name, face_icon)` with `ON CONFLICT (id) DO UPDATE SET email` only when email was NULL.

- **100 free credits** come from the column default, not from any grant call: `ALTER TABLE profiles ALTER COLUMN credits SET DEFAULT 100` ([20260603000001_default_credits_100.sql:5](../../supabase/migrations/20260603000001_default_credits_100.sql#L5)). History: default was 50 at credits-system creation ([20260513000001_create_credits_system.sql:2](../../supabase/migrations/20260513000001_create_credits_system.sql#L2)), raised to 300 during the decimal rescale ([20260526000003_decimal_credits_rescale.sql:15](../../supabase/migrations/20260526000003_decimal_credits_rescale.sql#L15)), then cut to 100.
- A second trigger, `sync_profile_email_on_auth_change` ([20260526000002…sql:38-43](../../supabase/migrations/20260526000002_auth_migration_email_mandatory.sql#L38-L43)), keeps `profiles.email` in sync whenever `auth.users.email` changes (used by the AddRealEmailPrompt flow, §6).

## 4. Signin (`/signin`)

**What the user sees:** same card, but the first field is "Email or username" and there's a "Forgot password?" link ([Auth.jsx:394-413](../../src/Auth.jsx#L394-L413)).

**Flow of `handleSignIn()`** ([Auth.jsx:169-185](../../src/Auth.jsx#L169-L185)):

- If the identifier matches `EMAIL_RE`, it's used as-is (lowercased). Otherwise it's treated as a **legacy username** and run through `fakeEmail()`: lowercase, trim, strip non-`[a-z0-9._-]`, append `@tripjam.app` ([Auth.jsx:13-18](../../src/Auth.jsx#L13-L18)). Pre-D9 accounts were created with exactly this synthetic address, so old usernames keep working.
- `signInWithPassword({ email: loginEmail, password })`. Any error collapses to the generic `"Invalid email/username or password."` — no enumeration of which part failed.

## 5. Forgot / reset password

**`/forgot-password`** ([ForgotPassword.jsx](../../src/ForgotPassword.jsx)): user enters an email; validated against the same `EMAIL_RE`; `supabase.auth.resetPasswordForEmail(email, { redirectTo: origin + "/reset-password" })` ([ForgotPassword.jsx:23-26](../../src/ForgotPassword.jsx#L23-L26)). The UI always shows "If an account exists for that email, we sent a reset link" regardless of whether the email is registered, deliberately mirroring Supabase's server-side anti-enumeration behavior ([ForgotPassword.jsx:32-35](../../src/ForgotPassword.jsx#L32-L35)).

**Tension with legacy accounts:** a pre-D9 username-only account has `<username>@tripjam.app` as its email — an address nobody owns. The reset email is sent into the void, so **legacy accounts cannot recover a forgotten password until they attach a real email** (§6). The form also only accepts valid email syntax, so typing a bare username here is rejected client-side. Nothing in the UI explains this to a legacy user — it just looks like the email never arrives.

**`/reset-password`** ([ResetPassword.jsx](../../src/ResetPassword.jsx)): the landing page for the email link. Supabase auto-signs the user in via the recovery token in the URL hash, firing the `PASSWORD_RECOVERY` auth event. The component waits for either that event or an already-present session (page refresh case); if neither appears within 4 s it shows "Reset link expired" with a button back to `/forgot-password` ([ResetPassword.jsx:51-74](../../src/ResetPassword.jsx#L51-L74), [ResetPassword.jsx:138-147](../../src/ResetPassword.jsx#L138-L147)). On submit: min 6 chars + confirm-match validation, then `supabase.auth.updateUser({ password })` ([ResetPassword.jsx:76-97](../../src/ResetPassword.jsx#L76-L97)). Success shows "Password updated" and redirects to `/` after 2 s — the user is already signed in at that point, so they land on their trips list.

Both routes render before the session gate in `Root` ([main.jsx:242-248](../../src/main.jsx#L242-L248)), which matters for `/reset-password`: the recovery token has already created a session, and without the early return the user would be routed into the normal app instead of the reset form.

## 6. AddRealEmailPrompt — migrating legacy accounts

[AddRealEmailPrompt.jsx](../../src/AddRealEmailPrompt.jsx) is a fixed top banner mounted next to every authenticated view in `Root` (admin [main.jsx:271](../../src/main.jsx#L271), home [main.jsx:297](../../src/main.jsx#L297), trip [main.jsx:318](../../src/main.jsx#L318)).

- **When it shows:** `session.user.email` matches `/@tripjam\.app$/i` ([AddRealEmailPrompt.jsx:10](../../src/AddRealEmailPrompt.jsx#L10), [AddRealEmailPrompt.jsx:28-34](../../src/AddRealEmailPrompt.jsx#L28-L34)) — i.e. the account still has the synthetic legacy email. Dismissal is per-browser-session only (`sessionStorage` key `tripjam.addRealEmailDismissedAt`, [AddRealEmailPrompt.jsx:12](../../src/AddRealEmailPrompt.jsx#L12)), so it reappears on the next session until resolved. The app remains fully usable underneath.
- **What it does:** `supabase.auth.updateUser({ email })` ([AddRealEmailPrompt.jsx:47-49](../../src/AddRealEmailPrompt.jsx#L47-L49)). Supabase sends a confirmation link to the new address; `auth.users.email` only changes after the user clicks it, and the `sync_profile_email_on_auth_change` trigger then propagates the change to `profiles.email` (comment at [AddRealEmailPrompt.jsx:43-46](../../src/AddRealEmailPrompt.jsx#L43-L46)).
- **What it changes:** once confirmed, the account has a real email — password recovery (§5) and Google identity linking become possible, and the banner stops matching. The user can still sign in with their old username thanks to the `fakeEmail()` shim only _until_ the email changes; after confirmation the synthetic address no longer exists, so signin must use the real email. This consequence is implied by the code but not surfaced in the UI.

## 7. Session handling

All session state lives in `Root` ([main.jsx:121-163](../../src/main.jsx#L121-L163)):

- **Initial load:** `session` starts `undefined` (renders `null`). `supabase.auth.getSession()` resolves it; a **hard 8-second fallback timer** sets `session` to `null` if Supabase is unreachable (paused project, offline), so the visitor at least gets the Landing page instead of a blank screen ([main.jsx:131-144](../../src/main.jsx#L131-L144)). `onAuthStateChange` re-authenticates when connectivity returns.
- **On auth state change with a user** ([main.jsx:147-156](../../src/main.jsx#L147-L156)): `posthog.identify(user.id, { email })`; `Sentry.setUser({ id, email })` when `VITE_SENTRY_DSN` is set; `refreshCredits(user.id)` (gated on `CREDITS_UI_ENABLED`); `initRevenueCat(user.id)` (no-ops on web — [billing.js](../../src/billing.js) is platform-aware).
- **On sign-out** ([main.jsx:157-160](../../src/main.jsx#L157-L160)): `posthog.reset()` and `Sentry.setUser(null)`. The sign-out itself is triggered from the Avatar menu ([Avatar.jsx:84-88](../../src/Avatar.jsx#L84-L88)), which deliberately leaves the analytics cleanup to this listener.
- **Post-login URL resolution:** once `session` becomes truthy, an effect re-parses the URL and loads the trip for deep links (`/trip/:id`, `/trip/:id/plans`, tab URLs), falling back to `/` if the trip doesn't exist or isn't visible under RLS ([main.jsx:175-192](../../src/main.jsx#L175-L192)). This is what makes "deep link while signed out → Auth → continue to the trip" work: the path is never rewritten during signin.
- Deeper in the app, individual fetches re-read the token via `supabase.auth.getSession()` right before calling edge functions rather than caching it (e.g. the city-deep-dive call at [App.jsx:1820-1830](../../src/App.jsx#L1820-L1830)).

PostHog and Sentry themselves are initialized at module load in [main.jsx:24-72](../../src/main.jsx#L24-L72), both keyed off env vars and no-ops when unset; PostHog registers an `app_env` super-property for staging/production filtering.

## 8. Legal pages (`/privacy`, `/terms`)

[Privacy.jsx](../../src/Privacy.jsx) and [Terms.jsx](../../src/Terms.jsx) are static prose wrapped in [LegalPage.jsx](../../src/LegalPage.jsx), which provides the scrollable layout, a header with a logo button back to `/` ([LegalPage.jsx:65-77](../../src/LegalPage.jsx#L65-L77)), scroll-to-top on mount, and the same body-scroll unlock as Landing. Routed before the session gate ([main.jsx:240-241](../../src/main.jsx#L240-L241)) so the signup form's `target="_blank"` Terms/Privacy links ([Auth.jsx:464-481](../../src/Auth.jsx#L464-L481)) work for logged-out visitors.

---

## Key files

- [src/main.jsx](../../src/main.jsx) — `parseUrl()` routing, session lifecycle, auth-change side effects, 8 s getSession fallback
- [src/Landing.jsx](../../src/Landing.jsx) — public marketing page
- [src/Auth.jsx](../../src/Auth.jsx) — signup/signin, username derivation, legacy `fakeEmail()` shim, Google OAuth
- [src/ForgotPassword.jsx](../../src/ForgotPassword.jsx) / [src/ResetPassword.jsx](../../src/ResetPassword.jsx) — recovery flow
- [src/AddRealEmailPrompt.jsx](../../src/AddRealEmailPrompt.jsx) — legacy-account email migration banner
- [src/LegalPage.jsx](../../src/LegalPage.jsx), [src/Privacy.jsx](../../src/Privacy.jsx), [src/Terms.jsx](../../src/Terms.jsx) — public legal pages
- [src/supabase.js](../../src/supabase.js) — Supabase client (anon key from env)
- [supabase/migrations/20260526000002_auth_migration_email_mandatory.sql](../../supabase/migrations/20260526000002_auth_migration_email_mandatory.sql) — profile-create + email-sync triggers
- [supabase/migrations/20260603000001_default_credits_100.sql](../../supabase/migrations/20260603000001_default_credits_100.sql) — 100-credit signup default
