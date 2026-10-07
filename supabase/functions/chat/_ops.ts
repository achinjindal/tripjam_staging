// Chat v3 itinerary edits: small operations against specific activities
// instead of whole-day rewrites.
//
//   1. itineraryContext() lists every activity with a short ref ("D3.2" = day
//      3, item 2). Refs are cheap tokens; real uuids would cost ~20 each.
//   2. The model returns operations naming refs (vocabulary in the chat
//      prompt, OPS_INSTRUCTIONS in index.ts).
//   3. resolveOps() validates them against the context and turns refs into
//      real ids, folding them into ONE `activity_ops` action that the browser
//      applies atomically through the apply_activity_ops RPC.
//
// Pure module (no I/O) so it is unit-tested in _ops.test.ts.

// deno-lint-ignore no-explicit-any
type Any = any;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const ACTIVITY_TYPES = ["sight", "food", "shop", "transit", "hotel"];
export const OP_TYPES = new Set([
  "replace_activity",
  "insert_activity",
  "remove_activity",
  "move_activity",
  "set_time",
]);
// apply_activity_ops refuses larger batches.
const MAX_OPS = 60;

type RefInfo = { id: string; dayIdx: number; order: number; title: string };
export type OpsContext = {
  text: string;
  refs: Map<string, RefInfo>;
  dayIds: string[]; // by day index; "" when the day has no saved id
  dayLabels: string[];
};

// ── Context ──────────────────────────────────────────────────────────────────
export function itineraryContext(days: Any[]): OpsContext {
  const refs = new Map<string, RefInfo>();
  const dayIds: string[] = [];
  const dayLabels: string[] = [];
  const lines: string[] = [];
  (days || []).forEach((d: Any, di: number) => {
    const dayRef = `D${di + 1}`;
    dayIds.push(typeof d?.id === "string" && UUID_RE.test(d.id) ? d.id : "");
    dayLabels.push(String(d?.label || `Day ${di + 1}`));
    lines.push(`${dayRef} · ${d?.label || `Day ${di + 1}`} · ${d?.city || ""}`);
    const acts = [...(d?.activities || [])].sort(
      (a: Any, b: Any) => (a?.position ?? 0) - (b?.position ?? 0),
    );
    let n = 0;
    for (const a of acts) {
      const saved = typeof a?.id === "string" && UUID_RE.test(a.id);
      const meta = [a?.type, a?.duration].filter(Boolean).join(", ");
      const tail = `${a?.time || "--:--"} ${a?.title || ""}${meta ? ` (${meta})` : ""}${a?.confirmed ? " [booked]" : ""}`;
      if (saved) {
        n++;
        const ref = `${dayRef}.${n}`;
        refs.set(ref, {
          id: a.id,
          dayIdx: di,
          order: n,
          title: String(a.title || ""),
        });
        lines.push(`  ${ref} ${tail}`);
      } else {
        // Not saved yet: shown for context, but it can't be edited by ref.
        lines.push(`  -- ${tail}`);
      }
    }
    const gems = (d?.wishlist || [])
      .filter((w: Any) => w && !w.dismissed && w.title)
      .map((w: Any) => w.title);
    if (gems.length) lines.push(`  Local gems: ${gems.join(", ")}`);
  });
  return { text: lines.join("\n"), refs, dayIds, dayLabels };
}

// ── Resolution ───────────────────────────────────────────────────────────────
export type Dropped = { type: string; reason: string };

const clip = (v: unknown, n: number) =>
  typeof v === "string" ? v.trim().slice(0, n) : "";

function cleanActivity(a: Any) {
  if (!a || typeof a !== "object") return null;
  const title = clip(a.title, 140);
  if (!title) return null;
  const type = ACTIVITY_TYPES.includes(a.type) ? a.type : "sight";
  return {
    time: clip(a.time, 10),
    title,
    geocode: clip(a.geocode, 200) || title,
    geocode_end: type === "transit" ? clip(a.geocode_end, 200) : "",
    type,
    duration: clip(a.duration, 20),
    note: clip(a.note, 300),
    icon: clip(a.icon, 8),
  };
}

const normRef = (r: unknown) =>
  typeof r === "string" ? r.trim().toUpperCase().replace(/\s+/g, "") : "";

/**
 * Validates the model's operations against the context and resolves refs to
 * ids. Non-op actions pass through untouched, in order; all ops collapse into
 * one `{type:"activity_ops", ops, dropped}` action at the position of the
 * first op. Invalid ops are dropped (and counted) rather than failing the
 * rest — the client says so in the reply.
 */
export function resolveOps(
  actions: Any[],
  ctx: OpsContext,
): { actions: Any[]; dropped: Dropped[] } {
  const out: Any[] = [];
  const ops: Any[] = [];
  const dropped: Dropped[] = [];
  let slot = -1;
  // Current state as ops apply: which original refs are gone, and which day
  // each ref is on now.
  const gone = new Set<string>(); // removed or replaced
  const removed = new Set<string>();
  const dayOf = new Map<string, number>();
  for (const [ref, info] of ctx.refs) dayOf.set(ref, info.dayIdx);

  const dayIndex = (d: unknown): number => {
    const s = normRef(d);
    const m = s.match(/^D(\d+)$/);
    let idx = m ? Number(m[1]) - 1 : -1;
    if (idx < 0 && typeof d === "string") {
      const want = d.trim().toLowerCase();
      idx = ctx.dayLabels.findIndex((l) => l.trim().toLowerCase() === want);
    }
    return idx >= 0 && idx < ctx.dayIds.length && ctx.dayIds[idx] ? idx : -1;
  };
  // A removed anchor falls back to the nearest earlier original item still on
  // that day, else the start of the day.
  const anchorId = (
    after: unknown,
    day: number,
  ): { ok: boolean; id: string | null } => {
    const s = normRef(after);
    if (!s || s === "START" || s === "NULL") return { ok: true, id: null };
    let info = ctx.refs.get(s);
    if (!info) return { ok: false, id: null };
    if (removed.has(s)) {
      if (dayOf.get(s) !== day) return { ok: false, id: null };
      const prev = [...ctx.refs.entries()]
        .filter(
          ([r, i]) =>
            i.dayIdx === info!.dayIdx &&
            i.order < info!.order &&
            !removed.has(r) &&
            dayOf.get(r) === day,
        )
        .sort((a, b) => b[1].order - a[1].order)[0];
      if (!prev) return { ok: true, id: null };
      info = prev[1];
      return { ok: info.dayIdx === day, id: info.id };
    }
    return { ok: dayOf.get(s) === day, id: info.id };
  };
  const live = (ref: string) => ctx.refs.has(ref) && !gone.has(ref);

  for (const action of actions || []) {
    const type = action?.type;
    if (!OP_TYPES.has(type)) {
      out.push(action);
      continue;
    }
    if (slot < 0) {
      slot = out.length;
      out.push(null); // placeholder for the folded action
    }
    if (ops.length >= MAX_OPS) {
      dropped.push({ type, reason: "too_many_ops" });
      continue;
    }
    const ref = normRef(action.ref);
    const drop = (reason: string) => dropped.push({ type, reason });

    if (type === "remove_activity") {
      if (!live(ref)) {
        drop("unknown_ref");
        continue;
      }
      gone.add(ref);
      removed.add(ref);
      ops.push({ op: "remove", activity_id: ctx.refs.get(ref)!.id });
    } else if (type === "replace_activity") {
      const activity = cleanActivity(action.activity);
      if (!live(ref)) drop("unknown_ref");
      else if (!activity) drop("invalid_activity");
      else {
        gone.add(ref);
        ops.push({
          op: "replace",
          activity_id: ctx.refs.get(ref)!.id,
          activity,
        });
      }
    } else if (type === "insert_activity") {
      const day = dayIndex(action.day);
      const activity = cleanActivity(action.activity);
      const anchor = day >= 0 ? anchorId(action.after, day) : null;
      if (day < 0) drop("unknown_day");
      else if (!anchor!.ok) drop("bad_anchor");
      else if (!activity) drop("invalid_activity");
      else
        ops.push({
          op: "insert",
          day_id: ctx.dayIds[day],
          after_id: anchor!.id,
          activity,
        });
    } else if (type === "move_activity") {
      const day = dayIndex(action.day);
      const anchor = day >= 0 ? anchorId(action.after, day) : null;
      if (!live(ref)) drop("unknown_ref");
      else if (day < 0) drop("unknown_day");
      else if (!anchor!.ok || anchor!.id === ctx.refs.get(ref)!.id)
        drop("bad_anchor");
      else {
        dayOf.set(ref, day);
        ops.push({
          op: "move",
          activity_id: ctx.refs.get(ref)!.id,
          day_id: ctx.dayIds[day],
          after_id: anchor!.id,
        });
      }
    } else if (type === "set_time") {
      const time = clip(action.time, 10);
      if (!live(ref)) drop("unknown_ref");
      else if (!/^\d{1,2}:\d{2}$/.test(time)) drop("bad_time");
      else
        ops.push({
          op: "set_time",
          activity_id: ctx.refs.get(ref)!.id,
          time,
        });
    }
  }
  if (slot >= 0)
    out[slot] = {
      type: "activity_ops",
      ops: removeInsertToMove(ops, ctx),
      dropped: dropped.length,
    };
  return { actions: out, dropped };
}

const normTitle = (t: string) =>
  t
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();

/**
 * Models often "move" a place by removing it and inserting it again, which
 * would throw away its saved coordinates, photo, verification and booking.
 * Turn a remove followed by an insert of the same place into a move (plus a
 * set_time when the insert gave a time).
 */
function removeInsertToMove(ops: Any[], ctx: OpsContext): Any[] {
  const titleById = new Map<string, string>();
  for (const info of ctx.refs.values())
    titleById.set(info.id, normTitle(info.title));
  const out = [...ops];
  for (let i = 0; i < out.length; i++) {
    const ins = out[i];
    if (ins?.op !== "insert") continue;
    const want = normTitle(ins.activity?.title || "");
    if (!want) continue;
    const r = out.findIndex(
      (o, k) =>
        k < i && o?.op === "remove" && titleById.get(o.activity_id) === want,
    );
    if (r < 0) continue;
    const id = out[r].activity_id;
    // An insert anchored on the moved item itself can't become a move.
    if (ins.after_id === id) continue;
    const replacement: Any[] = [
      {
        op: "move",
        activity_id: id,
        day_id: ins.day_id,
        after_id: ins.after_id,
      },
    ];
    if (ins.activity?.time)
      replacement.push({
        op: "set_time",
        activity_id: id,
        time: ins.activity.time,
      });
    out.splice(i, 1, ...replacement);
    out.splice(r, 1);
    i += replacement.length - 2;
  }
  return out;
}

/** A one-line reply when the model returned ops but no message. */
export function describeOps(ops: Any[]): string {
  const n = ops.length;
  return n === 1
    ? "Updated your itinerary."
    : `Made ${n} changes to your itinerary.`;
}
