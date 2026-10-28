// Merging saved trip_messages rows into the chat as the browser holds it.
//
// The realtime channel doesn't replay what it missed while disconnected, so on
// every reconnect the trip view refetches the whole trip chat (it is a handful
// of rows) and merges it in here. The same merge handles a live INSERT,
// including the echo of a row this browser wrote itself.
//
// Rules:
//   - A held message keeps its own fields (streaming, the local undo snapshot,
//     error, …). The server only moves it forward: it fills in created_at, and
//     flags that can only ever go one way (a change card being undone) are
//     applied, which also drops the local Undo.
//   - Nothing held is removed: undo rows, error bubbles and messages still
//     being sent are not on the server, and must survive.
//   - A row we don't hold is placed by created_at among the held rows that
//     have one. A held row without created_at (an optimistic send, a streaming
//     reply, an undo row) stays right after the message before it, so a
//     question and its reply never get split by a merge.
//   - Nothing changed → the same array comes back, so React skips the render.
//
// Pure module (no React, no I/O, no imports) — unit-tested under Deno.

const ts = (m) => {
  const t = m?.created_at ? Date.parse(m.created_at) : NaN;
  return Number.isFinite(t) ? t : null;
};

/**
 * What a saved row changes on a message we already hold, or null for nothing.
 * @param {object} held - the message in chat state
 * @param {object} row - the same message as saved (mapped, meta spread in)
 */
function forwardPatch(held, row) {
  let patch = null;
  if (!held.created_at && row.created_at)
    patch = { ...patch, created_at: row.created_at };
  if (row.undone === true && held.undone !== true)
    patch = { ...patch, undone: true, undo: null };
  return patch;
}

/**
 * Apply a saved row's forward-only fields to a held message.
 * @returns the same object when nothing changes.
 */
export function applyServerFields(held, row) {
  const patch = row ? forwardPatch(held, row) : null;
  return patch ? { ...held, ...patch } : held;
}

/**
 * Merge saved rows into the held chat.
 * @param {object[]} prev - chat state, in display order
 * @param {object[]} rows - saved rows, in created_at order, mapped like the
 *   history load (meta spread in, created_at kept)
 * @returns {object[]} `prev` itself when nothing changes
 */
export function mergeChatRows(prev, rows) {
  if (!Array.isArray(rows) || !rows.length) return prev;
  const byId = new Map();
  for (const r of rows) if (r?.id && !byId.has(r.id)) byId.set(r.id, r);

  let changed = false;
  const held = prev.map((m) => {
    const row = m?.id ? byId.get(m.id) : null;
    const next = row ? applyServerFields(m, row) : m;
    if (next !== m) changed = true;
    return next;
  });

  const heldIds = new Set(prev.map((m) => m?.id).filter(Boolean));
  const fresh = [...byId.values()].filter((r) => !heldIds.has(r.id));
  if (!fresh.length) return changed ? held : prev;

  // Held messages in blocks: a timed message plus the untimed ones after it.
  // Untimed messages before any timed one form a leading block that stays
  // first (nothing to place them against).
  const lead = [];
  const blocks = [];
  for (const m of held) {
    const t = ts(m);
    if (t != null) blocks.push({ t, items: [m] });
    else if (blocks.length) blocks[blocks.length - 1].items.push(m);
    else lead.push(m);
  }
  // Stable sort: rows without created_at go last, in the order given.
  const order = fresh
    .map((r, i) => ({ r, i, t: ts(r) }))
    .sort((a, b) =>
      a.t == null || b.t == null
        ? (a.t == null) - (b.t == null) || a.i - b.i
        : a.t - b.t || a.i - b.i,
    )
    .map((x) => x.r);

  const out = [...lead];
  let i = 0;
  for (const block of blocks) {
    while (i < order.length && ts(order[i]) != null && ts(order[i]) < block.t)
      out.push(order[i++]);
    out.push(...block.items);
  }
  while (i < order.length) out.push(order[i++]);
  return out;
}
