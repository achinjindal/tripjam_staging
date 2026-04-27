---
name: Local gems redesign
description: Move wishlist/local gems from day-level to activity-level, with add/dismiss actions
type: project
---

Redesign local gems (wishlist) to be activity-level instead of day-level.

**Why:** Day-level gems are hard for users to know when/where to fit them in. Activity-level gems ("while you're at Monkey Forest, check out Ubud Art Market nearby") are contextually relevant and actionable.

**Concern:** Per-activity gems list could be overwhelming. Need to limit to 1-2 per activity max, or show as a subtle expandable hint rather than a full list.

**Approach options:**
1. Intermediate: Keep day-level AI output, render between activities by proximity matching
2. Full: Change IG prompt to generate `nearbyGems` per activity (1-2 items max)

**Add/dismiss actions:**
- Add to itinerary: promotes gem to a real activity with time slot
- Dismiss: removes from wishlist (DB update)

**How to apply:** Revisit and implement after other priorities are done.
