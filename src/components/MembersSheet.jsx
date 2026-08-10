// Members sheet — Phase 1.
// Opened from the trip-header affordance (＋ Invite when solo, avatar stack when
// shared). Lists members, shares/revokes the invite link, and handles
// remove / leave / transfer-ownership. Matches collab-members-design.html.

import { useEffect, useState } from "react";
import { T, RADIUS, SHADOW, MOTION } from "../theme";
import { showToast, confirmSheet } from "../dialogs.jsx";
import MemberAvatar from "../MemberAvatar.jsx";
import {
  fetchMembers,
  fetchTripInvites,
  getInviteUrl,
  revokeInvite,
  removeMember,
  transferOwnership,
  leaveTrip,
  memberName,
  inviteByHandle,
  cancelInvite,
} from "../members.js";

export default function MembersSheet({
  trip,
  session,
  onClose,
  onMembersChanged,
  onEditPreferences,
  onLeftTrip,
}) {
  const selfId = session?.user?.id;
  const isOwner = trip?.owner_id === selfId;
  const [members, setMembers] = useState([]);
  const [pending, setPending] = useState([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [transferMode, setTransferMode] = useState(false);
  const [handle, setHandle] = useState("");
  const [inviteBusy, setInviteBusy] = useState(false);
  const [notFound, setNotFound] = useState("");

  const reload = async () => {
    setLoading(true);
    const [list, invites] = await Promise.all([
      fetchMembers(trip.id),
      fetchTripInvites(trip.id),
    ]);
    // Owner first, then by join time.
    list.sort((a, b) => {
      if (a.user_id === trip.owner_id) return -1;
      if (b.user_id === trip.owner_id) return 1;
      return new Date(a.joined_at) - new Date(b.joined_at);
    });
    setMembers(list);
    setPending(invites);
    setLoading(false);
    onMembersChanged?.(list);
  };

  const doInvite = async () => {
    const h = handle.trim().replace(/^@/, "");
    if (!h || inviteBusy) return;
    setInviteBusy(true);
    setNotFound("");
    try {
      const res = await inviteByHandle(trip.id, h);
      showToast(
        res?.already_invited
          ? `Already invited @${res.username}`
          : `Invited @${res?.username || h}`,
      );
      setHandle("");
      reload();
    } catch (e) {
      const msg = e?.message || "";
      if (msg.includes("user_not_found")) {
        setNotFound(h);
      } else if (msg.includes("already_member")) {
        showToast("Already on this trip");
      } else if (msg.includes("trip_full")) {
        showToast("This trip is full");
      } else {
        showToast("Couldn't send invite");
      }
    } finally {
      setInviteBusy(false);
    }
  };

  const doCancelInvite = async (inv) => {
    const name = inv.profiles?.username || "this traveler";
    const ok = await confirmSheet({
      title: `Cancel invite to @${name}?`,
      message: "They'll no longer see this trip in their invitations.",
      confirmLabel: "Cancel invite",
      cancelLabel: "Keep",
      danger: true,
    });
    if (!ok) return;
    try {
      await cancelInvite(inv.id);
      showToast("Invite cancelled");
      reload();
    } catch {
      showToast("Couldn't cancel invite");
    }
  };

  useEffect(() => {
    reload();
  }, [trip?.id]);

  const copyInvite = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const url = await getInviteUrl(trip.id);
      await navigator.clipboard.writeText(url);
      showToast("Invite link copied");
    } catch (e) {
      if (e?.name !== "AbortError") showToast("Couldn't copy invite link");
    } finally {
      setBusy(false);
    }
  };

  const doRevoke = async () => {
    const ok = await confirmSheet({
      title: "Revoke invite link?",
      message:
        "The current link stops working. People already on the trip stay. You can generate a new link anytime.",
      confirmLabel: "Revoke",
      danger: true,
    });
    if (!ok) return;
    try {
      await revokeInvite(trip.id);
      showToast("Invite link revoked");
    } catch {
      showToast("Couldn't revoke link");
    }
  };

  const doRemove = async (m) => {
    const name = memberName(m, selfId);
    const ok = await confirmSheet({
      title: `Remove ${name} from this trip?`,
      message:
        "They lose access to the plan and chat. Credits they added to the trip stay with the trip.",
      confirmLabel: "Remove",
      cancelLabel: "Cancel",
      danger: true,
    });
    if (!ok) return;
    try {
      await removeMember(trip.id, m.user_id);
      showToast(`${name} removed`);
      reload();
    } catch {
      showToast("Couldn't remove member");
    }
  };

  const doLeave = async () => {
    const others = members.filter((m) => m.user_id !== selfId);
    // Owner with co-travelers must hand off first.
    if (isOwner && others.length > 0) {
      setTransferMode(true);
      return;
    }
    // Sole member (owner or not) → leaving deletes the trip.
    if (members.length <= 1) {
      const ok = await confirmSheet({
        title: "Delete this trip?",
        message:
          "You're the only traveler, so leaving deletes the trip for good.",
        confirmLabel: "Delete",
        danger: true,
      });
      if (!ok) return;
      await finishLeave();
      return;
    }
    // Non-owner leaving.
    const ok = await confirmSheet({
      title: "Leave this trip?",
      message: "You'll lose access. Any credits you added stay with the trip.",
      confirmLabel: "Leave",
      danger: true,
    });
    if (!ok) return;
    await finishLeave();
  };

  const finishLeave = async () => {
    try {
      const result = await leaveTrip(trip.id);
      showToast(
        result === "trip_deleted" ? "Trip deleted" : "You left the trip",
      );
      onClose?.();
      onLeftTrip?.();
    } catch {
      showToast("Couldn't leave the trip");
    }
  };

  const pickNewOwner = async (m) => {
    if (busy) return;
    setBusy(true);
    try {
      await transferOwnership(trip.id, m.user_id);
      await leaveTrip(trip.id);
      showToast(`${memberName(m, selfId)} is the new owner · you left`);
      onClose?.();
      onLeftTrip?.();
    } catch {
      showToast("Couldn't transfer ownership");
      setBusy(false);
    }
  };

  const count = members.length;

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

        {transferMode ? (
          <>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 20,
                color: T.ink,
              }}
            >
              Choose the new owner
            </div>
            <div style={{ fontSize: 12, color: T.mist, margin: "2px 0 18px" }}>
              You'll hand off ownership, then leave the trip.
            </div>
            {members
              .filter((m) => m.user_id !== selfId)
              .map((m) => (
                <div
                  key={m.user_id}
                  onClick={() => pickNewOwner(m)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: T.chalk,
                    border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.lg,
                    padding: "12px 14px",
                    marginBottom: 8,
                    cursor: busy ? "default" : "pointer",
                    opacity: busy ? 0.6 : 1,
                  }}
                >
                  <MemberAvatar name={memberName(m, selfId)} size={34} />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}
                    >
                      {memberName(m, selfId)}
                    </div>
                    <div style={{ fontSize: 11, color: T.mist }}>
                      Make owner &amp; leave →
                    </div>
                  </div>
                </div>
              ))}
            <div
              onClick={() => setTransferMode(false)}
              style={{
                textAlign: "center",
                fontSize: 13,
                color: T.mist,
                marginTop: 14,
                cursor: "pointer",
              }}
            >
              Cancel
            </div>
          </>
        ) : (
          <>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 20,
                color: T.ink,
              }}
            >
              Trip members
            </div>
            <div style={{ fontSize: 12, color: T.mist, margin: "2px 0 18px" }}>
              {loading
                ? "Loading…"
                : count === 1
                  ? "Just you so far"
                  : `${count} planning together`}
            </div>

            {members.map((m) => {
              const owner = m.user_id === trip.owner_id;
              return (
                <div
                  key={m.user_id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: T.chalk,
                    border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.lg,
                    padding: "12px 14px",
                    marginBottom: 8,
                  }}
                >
                  <MemberAvatar name={memberName(m, selfId)} size={34} />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}
                    >
                      {memberName(m, selfId)}
                    </div>
                    <div style={{ fontSize: 11, color: T.mist }}>
                      {owner ? "Owner" : "Editor"}
                      {m.user_id === selfId ? " · you" : ""}
                    </div>
                  </div>
                  {isOwner && !owner && m.user_id !== selfId && (
                    <div
                      onClick={() => doRemove(m)}
                      style={{
                        color: T.mist,
                        fontSize: 18,
                        cursor: "pointer",
                        padding: "0 4px",
                      }}
                      title="Remove from trip"
                    >
                      ⋯
                    </div>
                  )}
                </div>
              );
            })}

            {/* Pending invites (account-targeted) */}
            {pending.map((inv) => {
              const name = inv.profiles?.username || "traveler";
              return (
                <div
                  key={inv.id}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 11,
                    background: T.chalk,
                    border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.lg,
                    padding: "12px 14px",
                    marginBottom: 8,
                    opacity: 0.75,
                  }}
                >
                  <MemberAvatar name={name} size={34} />
                  <div style={{ flex: 1 }}>
                    <div
                      style={{ fontSize: 14, color: T.ink, fontWeight: 700 }}
                    >
                      {name}
                    </div>
                    <div style={{ fontSize: 11, color: T.mist }}>
                      Invited · pending
                    </div>
                  </div>
                  {isOwner && (
                    <div
                      onClick={() => doCancelInvite(inv)}
                      style={{
                        color: T.mist,
                        fontSize: 18,
                        cursor: "pointer",
                        padding: "0 4px",
                      }}
                      title="Cancel invite"
                    >
                      ⋯
                    </div>
                  )}
                </div>
              );
            })}

            {/* Add a co-traveller (account-targeted invite) */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: T.ink,
                  fontWeight: 700,
                }}
              >
                👥 Add a co-traveller
              </div>
              <div
                style={{ fontSize: 11, color: T.mist, margin: "3px 0 10px" }}
              >
                Invite by username or email — they'll see it on their trips.
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <input
                  value={handle}
                  onChange={(e) => {
                    setHandle(e.target.value);
                    if (notFound) setNotFound("");
                  }}
                  onKeyDown={(e) => e.key === "Enter" && doInvite()}
                  placeholder="@username or email"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    border: `1px solid ${T.border}`,
                    borderRadius: RADIUS.md,
                    padding: "10px 12px",
                    fontFamily: "Georgia, serif",
                    fontSize: 13,
                    color: T.ink,
                    background: T.chalk,
                  }}
                />
                <button
                  onClick={doInvite}
                  disabled={inviteBusy || !handle.trim()}
                  style={{
                    background: T.ocean,
                    color: T.chalk,
                    border: "none",
                    borderRadius: RADIUS.md,
                    padding: "10px 16px",
                    fontFamily: "Georgia, serif",
                    fontSize: 13,
                    fontWeight: 700,
                    cursor:
                      inviteBusy || !handle.trim() ? "default" : "pointer",
                    opacity: inviteBusy || !handle.trim() ? 0.6 : 1,
                    flexShrink: 0,
                  }}
                >
                  {inviteBusy ? "…" : "Invite"}
                </button>
              </div>
              {notFound && (
                <div
                  style={{ fontSize: 11, color: T.terra, margin: "7px 2px 0" }}
                >
                  No traveller found for "@{notFound}". Share a link instead ↓
                </div>
              )}
            </div>

            {/* Invite block */}
            <div style={{ marginTop: 14 }}>
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: 14,
                  color: T.ink,
                  fontWeight: 700,
                }}
              >
                🔗 Invite co-travelers
              </div>
              <div
                style={{ fontSize: 11, color: T.mist, margin: "3px 0 10px" }}
              >
                Anyone with the link can join and edit this trip.
              </div>
              <div
                onClick={copyInvite}
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  background: T.chalk,
                  border: `1.5px solid ${T.ocean}`,
                  borderRadius: RADIUS.lg,
                  padding: "12px 14px",
                  color: T.ocean,
                  fontSize: 13,
                  fontWeight: 700,
                  cursor: busy ? "default" : "pointer",
                  opacity: busy ? 0.6 : 1,
                }}
              >
                {busy ? "Preparing link…" : "Copy invite link"}
                <span style={{ fontSize: 16 }}>📋</span>
              </div>
              {isOwner && (
                <div style={{ fontSize: 11, color: T.mist, marginTop: 7 }}>
                  Link active ·{" "}
                  <span
                    onClick={doRevoke}
                    style={{ color: T.error, cursor: "pointer" }}
                  >
                    Revoke
                  </span>
                </div>
              )}
            </div>

            <div
              style={{
                height: 1,
                background: T.border,
                margin: "18px 0 14px",
              }}
            />
            {onEditPreferences && (
              <div
                onClick={onEditPreferences}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 9,
                  color: T.ink,
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: "pointer",
                  marginBottom: 14,
                }}
              >
                ✎ Your kind of trip
              </div>
            )}
            <div
              onClick={doLeave}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 9,
                color: T.error,
                fontSize: 14,
                fontWeight: 700,
                cursor: "pointer",
              }}
            >
              🚪 Leave this trip
            </div>
          </>
        )}
      </div>
    </div>
  );
}
