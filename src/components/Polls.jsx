// Phase 6 — Polls / group decisions UI.
//
// Surfaces:
//   - DecisionsView  : Board → "Decisions" sub-section (open polls + resolved history)
//   - OpenPollPin    : slim cross-tab bar so open polls don't get buried
//   - PollComposeSheet : ＋Poll compose (question + 2–4 options + mode + anchor)
//
// Voting is optimistic-then-reconcile: each mutation calls the src/polls.js data
// layer, then onChanged() (App refetches; realtime covers other members). Live
// tallies arrive via the polls channel (poll_votes writes touch polls.updated_at).
// Shared-trip only; mounted behind INVITE_ENABLED at the call sites.

import { useMemo, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { showToast } from "../dialogs.jsx";
import {
  createPoll,
  castVoteSingle,
  toggleVoteApproval,
  saveVoteNote,
} from "../polls.js";

const nameFor = (members, uid, selfId) => {
  if (uid === selfId) return "You";
  return (
    members.find((m) => m.user_id === uid)?.profiles?.username || "Traveler"
  );
};

// ── One poll ────────────────────────────────────────────────────────────────
function PollCard({ poll, session, members, trip, onChanged, onClosePoll }) {
  const selfId = session?.user?.id;
  const [busy, setBusy] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [noteText, setNoteText] = useState(
    poll.notes?.find((n) => n.user_id === selfId)?.content || "",
  );

  const resolved = poll.status !== "open";
  const canClose =
    !resolved && (selfId === poll.created_by || selfId === trip?.owner_id);
  const totalVoters = new Set((poll.votes || []).map((v) => v.user_id)).size;

  const myVotes = useMemo(
    () =>
      new Set(
        (poll.votes || [])
          .filter((v) => v.user_id === selfId)
          .map((v) => v.option_id),
      ),
    [poll.votes, selfId],
  );

  const countFor = (oid) =>
    (poll.votes || []).filter((v) => v.option_id === oid).length;
  const maxCount = Math.max(
    1,
    ...(poll.options || []).map((o) => countFor(o.id)),
  );

  const vote = async (oid) => {
    if (busy || resolved) return;
    setBusy(true);
    try {
      if (poll.mode === "approval") {
        await toggleVoteApproval(poll.id, selfId, oid, myVotes.has(oid));
      } else {
        await castVoteSingle(poll.id, selfId, oid);
      }
      onChanged?.();
    } catch {
      showToast("Couldn't record your vote — try again");
    } finally {
      setBusy(false);
    }
  };

  const submitNote = async () => {
    setBusy(true);
    try {
      await saveVoteNote(poll.id, selfId, noteText);
      setNoteOpen(false);
      onChanged?.();
    } catch {
      showToast("Couldn't save your note");
    } finally {
      setBusy(false);
    }
  };

  const suggestedBy = poll.created_by
    ? nameFor(members, poll.created_by, selfId)
    : "Trippy";
  const winnerLabel = poll.resolved_option_id
    ? poll.options?.find((o) => o.id === poll.resolved_option_id)?.label
    : null;

  return (
    <div
      style={{
        background: T.chalk,
        borderRadius: RADIUS.lg,
        border: `1px solid ${resolved ? T.sand : T.border}`,
        padding: "14px 16px",
        opacity: resolved ? 0.85 : 1,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ fontSize: 15 }}>🗳️</span>
        <div
          style={{
            flex: 1,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 16,
            color: T.ink,
          }}
        >
          {poll.question}
        </div>
      </div>
      <div style={{ fontSize: 11, color: T.mist, margin: "3px 0 12px 23px" }}>
        Suggested by {suggestedBy}
        {poll.mode === "approval" ? " · pick any" : " · pick one"}
        {resolved
          ? winnerLabel
            ? ` · ✓ ${winnerLabel}`
            : " · closed, no decision"
          : ""}
      </div>

      {(poll.options || []).map((o) => {
        const c = countFor(o.id);
        const mine = myVotes.has(o.id);
        const isWinner = resolved && poll.resolved_option_id === o.id;
        // A voter's note shows under whichever option they voted for.
        const noteRows = (poll.notes || []).filter((n) =>
          (poll.votes || []).some(
            (v) => v.user_id === n.user_id && v.option_id === o.id,
          ),
        );
        return (
          <div key={o.id} style={{ marginBottom: 8 }}>
            <div
              onClick={() => vote(o.id)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 10,
                padding: "8px 10px",
                borderRadius: RADIUS.md,
                border: `1px solid ${mine ? T.ocean : T.sand}`,
                background: isWinner ? "#EAF3EA" : mine ? "#EAF1F8" : T.warm,
                cursor: resolved ? "default" : "pointer",
              }}
            >
              <span style={{ fontSize: 14, color: mine ? T.ocean : T.mist }}>
                {poll.mode === "approval"
                  ? mine
                    ? "☑"
                    : "☐"
                  : mine
                    ? "◉"
                    : "○"}
              </span>
              <div style={{ flex: 1, fontSize: 13, color: T.ink }}>
                {o.label}
              </div>
              <div
                style={{
                  minWidth: 60,
                  height: 6,
                  borderRadius: 3,
                  background: T.sand,
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${(c / maxCount) * 100}%`,
                    height: "100%",
                    background: isWinner ? T.sage || "#6B8E6B" : T.ocean,
                    transition: `width ${MOTION.normal}`,
                  }}
                />
              </div>
              <div
                style={{
                  fontSize: 12,
                  color: T.mist,
                  width: 14,
                  textAlign: "right",
                }}
              >
                {c}
              </div>
            </div>
            {noteRows.map((n) => (
              <div
                key={n.user_id}
                style={{ fontSize: 11, color: T.mist, margin: "3px 0 0 34px" }}
              >
                🟢 {nameFor(members, n.user_id, selfId)}: “{n.content}”
              </div>
            ))}
          </div>
        );
      })}

      {!resolved && (
        <div style={{ marginTop: 8 }}>
          {noteOpen ? (
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <input
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Add a note for the group…"
                maxLength={140}
                style={{
                  flex: 1,
                  border: `1px solid ${T.border}`,
                  borderRadius: RADIUS.md,
                  padding: "7px 10px",
                  fontSize: 12,
                  fontFamily: "Georgia, serif",
                  color: T.ink,
                }}
              />
              <button
                onClick={submitNote}
                disabled={busy}
                style={{
                  border: "none",
                  borderRadius: RADIUS.md,
                  padding: "0 12px",
                  background: T.ocean,
                  color: T.chalk,
                  fontSize: 12,
                  cursor: "pointer",
                }}
              >
                Save
              </button>
            </div>
          ) : (
            <div
              onClick={() => setNoteOpen(true)}
              style={{
                fontSize: 12,
                color: T.ocean,
                cursor: "pointer",
                marginTop: 4,
              }}
            >
              ＋ {noteText ? "edit your note" : "add a note"}
            </div>
          )}
        </div>
      )}

      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 12,
        }}
      >
        <div style={{ fontSize: 11, color: T.mist }}>
          {resolved
            ? "Closed"
            : `Live · ${totalVoters} voted · anyone can change until it closes`}
        </div>
        {canClose && (
          <button
            onClick={async () => {
              setBusy(true);
              await onClosePoll?.(poll);
              setBusy(false);
            }}
            disabled={busy}
            style={{
              border: `1px solid ${T.ocean}`,
              borderRadius: RADIUS.full,
              padding: "5px 12px",
              background: "transparent",
              color: T.ocean,
              fontSize: 12,
              cursor: "pointer",
              opacity: busy ? 0.6 : 1,
            }}
          >
            Close & apply
          </button>
        )}
      </div>
    </div>
  );
}

// ── Decisions hub (Board sub-section) ─────────────────────────────────────────
export function DecisionsView({
  trip,
  session,
  members,
  polls = [],
  onChanged,
  onClosePoll,
  onCompose,
  onBack,
}) {
  const open = polls.filter((p) => p.status === "open");
  const resolved = polls.filter((p) => p.status !== "open");

  return (
    <div style={{ flex: 1, overflowY: "auto", background: T.warm }}>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          padding: "14px 16px",
          borderBottom: `1px solid ${T.sand}`,
          background: T.chalk,
        }}
      >
        <button
          onClick={onBack}
          style={{
            background: "none",
            border: "none",
            fontSize: 20,
            cursor: "pointer",
            color: T.ocean,
          }}
        >
          ←
        </button>
        <div
          style={{
            flex: 1,
            fontFamily: "'DM Serif Display',serif",
            fontSize: 18,
            color: T.ink,
          }}
        >
          Decisions
        </div>
        <button
          onClick={onCompose}
          style={{
            border: "none",
            borderRadius: RADIUS.full,
            padding: "7px 14px",
            background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
            color: T.chalk,
            fontSize: 13,
            cursor: "pointer",
          }}
        >
          ＋ Poll
        </button>
      </div>

      <div
        style={{
          padding: 16,
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {open.length === 0 && resolved.length === 0 && (
          <div
            style={{
              textAlign: "center",
              color: T.mist,
              fontFamily: "Georgia,serif",
              fontStyle: "italic",
              padding: "40px 20px",
              fontSize: 13,
            }}
          >
            No decisions yet. Start a poll when the group can't agree — a day, a
            place, or anything.
          </div>
        )}
        {open.map((p) => (
          <PollCard
            key={p.id}
            poll={p}
            session={session}
            members={members}
            trip={trip}
            onChanged={onChanged}
            onClosePoll={onClosePoll}
          />
        ))}
        {resolved.length > 0 && (
          <div
            style={{
              fontSize: 12,
              color: T.mist,
              margin: "8px 0 0",
              textTransform: "uppercase",
              letterSpacing: 0.5,
            }}
          >
            Resolved
          </div>
        )}
        {resolved.map((p) => (
          <PollCard
            key={p.id}
            poll={p}
            session={session}
            members={members}
            trip={trip}
            onChanged={onChanged}
            onClosePoll={onClosePoll}
          />
        ))}
      </div>
    </div>
  );
}

// ── Open-poll pin (slim cross-tab bar) ───────────────────────────────────────
export function OpenPollPin({ polls = [], onOpen }) {
  const open = polls.filter((p) => p.status === "open");
  if (open.length === 0) return null;
  const label =
    open.length === 1 ? open[0].question : `${open.length} open decisions`;
  return (
    <div
      onClick={onOpen}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "8px 14px",
        background: "#FFF7E6",
        borderBottom: `1px solid ${T.gold}`,
        cursor: "pointer",
      }}
    >
      <span style={{ fontSize: 14 }}>🗳️</span>
      <div
        style={{
          flex: 1,
          fontSize: 12,
          color: T.ink,
          whiteSpace: "nowrap",
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
      >
        {label}
      </div>
      <span style={{ fontSize: 12, color: T.ocean }}>Vote ›</span>
    </div>
  );
}

// ── Compose sheet (＋Poll) ────────────────────────────────────────────────────
export function PollComposeSheet({
  trip,
  session,
  days = [],
  onClose,
  onCreated,
}) {
  const [question, setQuestion] = useState("");
  const [options, setOptions] = useState(["", ""]);
  const [mode, setMode] = useState("single");
  const [anchor, setAnchor] = useState("freeform"); // freeform | day
  const [dayId, setDayId] = useState(days[0]?.id || "");
  const [busy, setBusy] = useState(false);

  const setOpt = (i, v) =>
    setOptions((prev) => prev.map((o, k) => (k === i ? v : o)));
  const addOpt = () =>
    options.length < 4 && setOptions((prev) => [...prev, ""]);
  const rmOpt = (i) =>
    options.length > 2 && setOptions((prev) => prev.filter((_, k) => k !== i));

  const clean = options.map((o) => o.trim()).filter(Boolean);
  const valid = question.trim() && clean.length >= 2;

  const submit = async () => {
    if (!valid || busy) return;
    setBusy(true);
    try {
      await createPoll({
        tripId: trip.id,
        createdBy: session.user.id,
        question: question.trim(),
        options: clean.map((label, i) => ({ id: `o${i + 1}`, label })),
        mode,
        entityType: anchor === "day" ? "day" : "freeform",
        entityId: anchor === "day" ? dayId || null : null,
      });
      showToast("Poll created");
      onCreated?.();
      onClose?.();
    } catch {
      showToast("Couldn't create the poll — try again");
      setBusy(false);
    }
  };

  const pill = (active) => ({
    padding: "6px 12px",
    borderRadius: RADIUS.full,
    border: `1px solid ${active ? T.ocean : T.sand}`,
    background: active ? "#EAF1F8" : T.warm,
    color: active ? T.ocean : T.mist,
    fontSize: 12,
    cursor: "pointer",
  });

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10001,
        background: "rgba(15,25,35,0.45)",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
      }}
    >
      <div
        style={{
          background: T.warm,
          borderRadius: "22px 22px 0 0",
          padding: "22px 18px 30px",
          width: "100%",
          maxWidth: 480,
          maxHeight: "90vh",
          overflowY: "auto",
          boxShadow: SHADOW.lg,
          animation: `slideUp ${MOTION.normal}`,
        }}
      >
        <div
          style={{
            fontFamily: "'DM Serif Display', serif",
            fontSize: 20,
            color: T.ink,
            marginBottom: 14,
          }}
        >
          New poll
        </div>

        <input
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="What should the group decide?"
          style={{
            width: "100%",
            border: `1px solid ${T.border}`,
            borderRadius: RADIUS.md,
            padding: "11px 13px",
            fontSize: 14,
            fontFamily: "Georgia, serif",
            color: T.ink,
            marginBottom: 12,
          }}
        />

        {options.map((o, i) => (
          <div key={i} style={{ display: "flex", gap: 6, marginBottom: 8 }}>
            <input
              value={o}
              onChange={(e) => setOpt(i, e.target.value)}
              placeholder={`Option ${i + 1}`}
              style={{
                flex: 1,
                border: `1px solid ${T.border}`,
                borderRadius: RADIUS.md,
                padding: "9px 12px",
                fontSize: 13,
                fontFamily: "Georgia, serif",
                color: T.ink,
              }}
            />
            {options.length > 2 && (
              <button
                onClick={() => rmOpt(i)}
                style={{
                  border: "none",
                  background: "transparent",
                  color: T.mist,
                  fontSize: 16,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {options.length < 4 && (
          <div
            onClick={addOpt}
            style={{
              fontSize: 12,
              color: T.ocean,
              cursor: "pointer",
              marginBottom: 14,
            }}
          >
            ＋ add option
          </div>
        )}

        <div style={{ fontSize: 11, color: T.mist, marginBottom: 6 }}>Mode</div>
        <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
          <div
            onClick={() => setMode("single")}
            style={pill(mode === "single")}
          >
            Pick one
          </div>
          <div
            onClick={() => setMode("approval")}
            style={pill(mode === "approval")}
          >
            Pick any
          </div>
        </div>

        <div style={{ fontSize: 11, color: T.mist, marginBottom: 6 }}>
          Apply to
        </div>
        <div
          style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}
        >
          <div
            onClick={() => setAnchor("freeform")}
            style={pill(anchor === "freeform")}
          >
            Just decide
          </div>
          {days.length > 0 && (
            <div
              onClick={() => setAnchor("day")}
              style={pill(anchor === "day")}
            >
              A specific day
            </div>
          )}
        </div>
        {anchor === "day" && days.length > 0 && (
          <select
            value={dayId}
            onChange={(e) => setDayId(e.target.value)}
            style={{
              width: "100%",
              border: `1px solid ${T.border}`,
              borderRadius: RADIUS.md,
              padding: "9px 12px",
              fontSize: 13,
              color: T.ink,
              background: T.chalk,
              marginBottom: 8,
            }}
          >
            {days.map((d, i) => (
              <option key={d.id} value={d.id}>
                Day {i + 1}
                {d.city ? ` · ${d.city}` : ""}
              </option>
            ))}
          </select>
        )}
        {anchor === "day" && (
          <div style={{ fontSize: 11, color: T.mist, marginBottom: 8 }}>
            When this closes, Trippy applies the winning option to that day.
          </div>
        )}

        <button
          onClick={submit}
          disabled={!valid || busy}
          style={{
            width: "100%",
            marginTop: 10,
            padding: 14,
            borderRadius: RADIUS.lg,
            border: "none",
            background: valid
              ? `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`
              : T.sand,
            color: valid ? T.chalk : T.mist,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 16,
            cursor: valid && !busy ? "pointer" : "default",
          }}
        >
          {busy ? "Creating…" : "Create poll"}
        </button>
        <div
          onClick={onClose}
          style={{
            textAlign: "center",
            fontSize: 12,
            color: T.mist,
            marginTop: 12,
            cursor: "pointer",
          }}
        >
          Cancel
        </div>
      </div>
    </div>
  );
}
