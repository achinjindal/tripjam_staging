# Implementation plan — "Your kind of trip" feedback loop (Phases A + B)

Branch: `collab-tier2` (worktree `/Users/achinjindal/Documents/Code/tj-p56-wt`).
Everything gates on `INVITE_ENABLED` + shared trips (`members > 1`); solo trips stay byte-identical.
Reference design: prefs-loop-design.html artifact (approved by founder).

## Phase A — acknowledge + seeded chip (frontend only)

### A1. Toast copy (PreferencesSheet.jsx)
- In `save()`, replace `showToast("Travel style saved")` with:
  - `total > 1` → `Saved — Trippy now plans for ${total === 2 ? "both of you" : \`all ${total} of you\`}`
  - else keep "Travel style saved" (sheet currently only mounts on shared trips —
    guard anyway so a future solo mount doesn't get group copy).
- `total` already computed in the component.

### A2. Seeded suggestion chip (App.jsx)
- New App state: `const [styleChipArmed, setStyleChipArmed] = useState(false)`.
  Session-only (per approved spec: dismiss on tap or next trip open — NO localStorage).
  Reset to false in the trip-open effect (keyed on `trip?.id`).
- Arm it in the PreferencesSheet `onSaved` handler (~line 15900):
  `onSaved={() => { fetchPreferences(trip.id).then(setPreferences); setStyleChipArmed(true); }}`
- Render: in the default-chips block (~line 15038):
  - brainstorm screen: prepend `✨ Rebalance the plans for everyone's style` to the array
    when `styleChipArmed && isSharedTrip`.
  - itinerary screen (the `pills` else-branch): prepend `✨ Rebalance the itinerary for everyone's style`.
  - VERIFY: whether this default-chips block renders only on empty chat. If chat history
    hides it, additionally render a one-line seeded-chip row pinned above the chat input
    when armed (same style as existing chips, `.chip.seeded` treatment: skyLight bg + focus ring).
- Tapping the chip goes through the existing chip onClick (sends the text as a chat message);
  add `setStyleChipArmed(false)` on tap.
- No backend change; the chat function's existing PER-TRAVELER PREFERENCES block handles the rest.

## Phase B — styles reach RG + IG, rework nudge

### B1. Thread preferences into RG
- `BrainstormView` gains prop `preferences = []` (already receives `members`).
  Pass `preferences={preferences}` at both mounts (App.jsx ~11356 and ~13128).
- In `generate()` (BrainstormView, ~1969), build:
  ```js
  const stylesForLLM =
    (members || []).length > 1
      ? (preferences || [])
          .filter((p) => p?.prefs_text?.trim())
          .map((p) => ({
            name: members.find((m) => m.user_id === p.user_id)?.profiles?.username || "Traveler",
            text: p.prefs_text.trim().slice(0, 400),
          }))
      : [];
  ```
  and add `travellerStyles: stylesForLLM.length ? stylesForLLM : null` to the request body.
  (Owner's form notes already travel as `notes` — do not duplicate them here unless the
  owner saved an explicit trip_preferences row, which IS included: explicit row wins visibility.)
- `supabase/functions/generate-brainstorm/index.ts`:
  - Destructure `travellerStyles` from the body.
  - Append to `userMessage` (NOT the cached system prompt), after the notes segment:
    ```
    \n\nPER-TRAVELER STYLES (group trip — plan for everyone):
    - <Name>: <text>
    ...
    Each route's "points" MUST include at least one entry per named traveller stating
    whether the route fits their style (good: true) or conflicts with it (good: false).
    Attribute by name in the point text (e.g. "5 festival days — what tripman asked for").
    ```
  - Applies to both the anthropic and gemini paths automatically (single userMessage).

### B2. Thread preferences into IG
- In `handleGenerate` (App.jsx ~8410), App scope already has `preferences` + `members`:
  build the same `stylesForLLM` list and add `travellerStyles` to `igBody`.
- `supabase/functions/generate-itinerary/index.ts`:
  - Destructure `travellerStyles`.
  - Build `stylesNote` alongside `notesNote` (~line 221) and append to `userMessage` (~331):
    ```
    PER-TRAVELER STYLES (group trip — plan for everyone): <Name>: <text>; ...
    Balance every day across these travellers; attribute standout choices by name in
    day descriptions where natural (e.g. "quiet Siiro morning — Achin's pace").
    ```
  - Single userMessage feeds all model paths — one insertion point.

### B3. Rework nudge (BrainstormView)
- Trigger data: `preferences` prop (live via existing realtime `trip_preferences` reconcile).
- Show condition (computed in BrainstormView):
  - `members.length > 1`
  - AND tier-1 non-dismissed routes exist
  - AND `latestOtherStyle` = max `updated_at` over preference rows with `prefs_text` and
    `user_id !== session.user.id`
  - AND `latestOtherStyle > localStorage("tripjam_stylenudge_" + tripId)` (dismiss marker).
- Batched by construction: one nudge, newest style's author named:
  "«username» shared their travel style" / (2+ new) "«A» and «B» shared their travel styles".
  Sub: "These plans were drafted before it. Rework them around both travellers?"
  (3+ members: "…around everyone?")
- Actions:
  - **Rework the plans** → set dismiss marker, then `generate(false)` (full regenerate —
    body now carries `travellerStyles` via B1). Existing generating state covers UI.
  - **Keep as is** → set dismiss marker only.
- Placement: directly above the first route card, inside the pre-trip route list render;
  styling per mock B1 (skyLight bg `#F0F7FF`, skyBorder, RADIUS.lg, ocean primary pill +
  ghost secondary). Reuse T tokens.
- Dismiss marker value = the `latestOtherStyle` ISO string (re-arms only on a NEWER save).

### B4. Out of scope (explicit)
- No proactive Trippy messages on save.
- No IG-side nudge (post-IG rebalance flows through the Phase A chip / chat).
- prefs_struct unused (free-text only, per product decision).

## Verification & rollout
1. `npx prettier --check` on touched files, `npm run lint`, `npm run typecheck` (web + functions), `npm run build`.
2. Deploy `generate-brainstorm` + `generate-itinerary` to STAGING only (previews use staging).
3. Manual staging pass on the Ziro trip: save style as member B → toast copy, chip appears,
   tap → attributed reply; route list shows nudge → Rework regenerates with per-traveller points.
4. Commit on `collab-tier2`; push after founder approval (updates the preview).

## Risks / notes for reviewer
- Verify the default-chips block visibility with non-empty chat history (A2).
- Verify `profiles.username` shape on `members` rows (used for name resolution).
- Verify `generate(false)` is safe to call from the nudge (it clears + regenerates and
  is guarded by `rgInFlight`).
- generate-brainstorm on THIS branch predates the story-mode-branch changes (max_tokens
  9000 etc. already present? CHECK — if this branch's copy is older, do NOT port other
  fixes here; only add the styles block. Merge conflicts resolve at rebase time.)
- Confirm chat non-empty-history suggestions (m.suggestions on messages) don't need the
  seeded chip too — spec says default-chips placement is enough IF visible.
