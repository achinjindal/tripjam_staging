// Phase 5 — "Your kind of trip" sheet: free text plus quick tags (WS5 — the
// low-effort lane for passengers who won't type). Each member writes their
// own style; Trippy reads all members' styles via the group chat prompt.
// Shared trips only.
import { useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { showToast } from "../dialogs.jsx";
import {
  savePreferences,
  STYLE_TAGS,
  styleTags,
  hasStyle,
} from "../preferences.js";

export default function PreferencesSheet({
  trip,
  session,
  members = [],
  preferences = [],
  onClose,
  onSaved,
}) {
  const selfId = session?.user?.id;
  // The trip owner already described their style in the setup form (trip
  // notes) — seed their textarea with it and count them as having shared,
  // until they save an explicit preference row of their own.
  const ownerId = trip?.owner_id || trip?.created_by || null;
  const ownerNotes = (trip?.notes || "").trim();
  const myRow = preferences.find((p) => p.user_id === selfId) || null;
  const mineRow = myRow?.prefs_text || "";
  const mine =
    mineRow || (selfId && selfId === ownerId && ownerNotes ? ownerNotes : "");
  const [text, setText] = useState(mine);
  const [tags, setTags] = useState(() => styleTags(myRow));
  const [busy, setBusy] = useState(false);

  const sharedIds = new Set(
    preferences.filter((p) => hasStyle(p)).map((p) => p.user_id),
  );
  if (ownerId && ownerNotes) sharedIds.add(ownerId);
  const shared = sharedIds.size;
  const total = members.length || 1;

  const save = async () => {
    if (busy) return;
    setBusy(true);
    try {
      // Always pass the struct — the upsert overwrites it, so omitting tags
      // here would silently wipe them.
      await savePreferences(trip.id, selfId, text.trim() || null, {
        tags,
      });
      showToast(
        total > 1
          ? `Saved — Trippy now plans for ${total === 2 ? "both of you" : `all ${total} of you`}`
          : "Travel style saved",
      );
      onSaved?.();
      onClose?.();
    } catch {
      showToast("Couldn't save — try again");
      setBusy(false);
    }
  };

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(15,25,35,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
    >
      <div
        style={{
          background: T.warm,
          borderRadius: 22,
          padding: "22px 18px 24px",
          width: "100%",
          maxWidth: 480,
          maxHeight: "88vh",
          overflowY: "auto",
          boxShadow: SHADOW.lg,
          animation: `slideUp ${MOTION.normal}`,
          position: "relative",
        }}
      >
        <div
          onClick={onClose}
          style={{
            position: "absolute",
            top: 18,
            right: 18,
            fontSize: 18,
            color: T.mist,
            cursor: "pointer",
          }}
        >
          ✕
        </div>

        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 20,
            color: T.ink,
          }}
        >
          Your kind of trip
        </div>
        <div style={{ fontSize: 12, color: T.mist, margin: "2px 0 16px" }}>
          Trippy plans for everyone on the trip.
        </div>

        <div
          style={{
            display: "flex",
            flexWrap: "wrap",
            gap: 7,
            marginBottom: 10,
          }}
        >
          {STYLE_TAGS.map((tag) => {
            const on = tags.includes(tag);
            return (
              <button
                key={tag}
                onClick={() =>
                  setTags((prev) =>
                    on ? prev.filter((t) => t !== tag) : [...prev, tag],
                  )
                }
                style={{
                  padding: "6px 12px",
                  borderRadius: RADIUS.full,
                  border: `1.5px solid ${on ? "#2563A8" : "#E2DDD5"}`,
                  background: on ? "#F0F7FF" : "#FFFFFF",
                  color: on ? "#2563A8" : "#587284",
                  fontSize: 12,
                  fontFamily: "Georgia, serif",
                  cursor: "pointer",
                }}
              >
                {tag}
              </button>
            );
          })}
        </div>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Beaches and great coffee. No 6am starts. Vegetarian, and I'd love one proper onsen."
          rows={5}
          style={{
            width: "100%",
            border: `1px solid ${T.border}`,
            borderRadius: RADIUS.lg,
            padding: "12px 14px",
            fontFamily: "Georgia, serif",
            fontSize: 13,
            color: T.ink,
            lineHeight: 1.5,
            background: T.chalk,
            resize: "vertical",
          }}
        />

        <div
          onClick={save}
          style={{
            width: "100%",
            marginTop: 16,
            padding: 14,
            borderRadius: RADIUS.lg,
            textAlign: "center",
            background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
            color: T.chalk,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 16,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Saving…" : "Save"}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.mist,
            textAlign: "center",
            marginTop: 12,
          }}
        >
          {shared} of {total} traveller{total === 1 ? "" : "s"} shared their
          style
        </div>
      </div>
    </div>
  );
}
