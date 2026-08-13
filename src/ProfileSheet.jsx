// Profile editor — opened from the account menu. Edits the handle
// (profiles.username, unique, drives avatars/attribution everywhere) and the
// display name (profiles.display_name — shown in the account menu now;
// member-list surfaces adopt it as a follow-up). Email is read-only here.
//
// Legacy username-only accounts sign IN by resolving username →
// "<username>@tripjam.app" in auth — renaming the handle would strand their
// login, so the handle is locked for them until a real email is added.
import { useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW } from "./theme";
import { showToast } from "./dialogs.jsx";
import { avatarColorFor, avatarInitial } from "./Avatar";

const HANDLE_RE = /^[a-z0-9][a-z0-9._-]{2,23}$/;

export default function ProfileSheet({ session, profile, onClose, onSaved }) {
  const email = session?.user?.email || "";
  const isShimAccount = email.endsWith("@tripjam.app");
  const [handle, setHandle] = useState(profile?.username || "");
  const [displayName, setDisplayName] = useState(profile?.display_name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const cleanHandle = handle.trim().replace(/^@/, "").toLowerCase();
  const handleChanged = cleanHandle !== (profile?.username || "");
  const handleValid = HANDLE_RE.test(cleanHandle);

  const save = async () => {
    if (busy) return;
    setError("");
    if (handleChanged && !handleValid) {
      setError(
        "Handles are 3–24 characters: letters, numbers, dots, dashes, underscores.",
      );
      return;
    }
    setBusy(true);
    const updates = { display_name: displayName.trim() || null };
    if (handleChanged && !isShimAccount) updates.username = cleanHandle;
    const { error: err } = await supabase
      .from("profiles")
      .update(updates)
      .eq("id", session.user.id);
    setBusy(false);
    if (err) {
      setError(
        err.code === "23505" || /duplicate|unique/i.test(err.message || "")
          ? "That handle is already taken."
          : "Couldn't save — try again.",
      );
      return;
    }
    showToast("Profile updated");
    onSaved?.({
      username: updates.username || profile?.username,
      display_name: updates.display_name,
    });
    onClose?.();
  };

  const previewName = cleanHandle || profile?.username || "you";

  return (
    <div
      onClick={(e) => e.target === e.currentTarget && onClose?.()}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 10002,
        background: "rgba(15,25,35,0.45)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
        fontFamily: "Georgia, serif",
      }}
    >
      <div
        style={{
          background: T.warm,
          borderRadius: 22,
          padding: "24px 20px",
          width: "100%",
          maxWidth: 420,
          boxShadow: SHADOW.lg,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginBottom: 18,
          }}
        >
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 999,
              background: avatarColorFor(previewName),
              color: T.chalk,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 18,
              fontWeight: 700,
            }}
          >
            {avatarInitial(previewName)}
          </div>
          <div>
            <div
              style={{
                fontFamily: "'DM Serif Display', serif",
                fontSize: 20,
                color: T.ink,
              }}
            >
              Your profile
            </div>
            <div style={{ fontSize: 12, color: T.mist }}>
              {isShimAccount ? "Username-only account" : email}
            </div>
          </div>
        </div>

        <label style={{ fontSize: 12, color: T.mist }}>Display name</label>
        <input
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="e.g. Achin J"
          maxLength={40}
          style={{
            width: "100%",
            boxSizing: "border-box",
            margin: "5px 0 14px",
            padding: "11px 13px",
            borderRadius: RADIUS.lg,
            border: `1.5px solid ${T.sand}`,
            background: T.chalk,
            fontFamily: "Georgia, serif",
            fontSize: 13,
            color: T.ink,
            outline: "none",
          }}
        />

        <label style={{ fontSize: 12, color: T.mist }}>Handle</label>
        <div style={{ position: "relative", margin: "5px 0 4px" }}>
          <span
            style={{
              position: "absolute",
              left: 13,
              top: "50%",
              transform: "translateY(-50%)",
              color: T.mist,
              fontSize: 13,
            }}
          >
            @
          </span>
          <input
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            disabled={isShimAccount}
            maxLength={24}
            style={{
              width: "100%",
              boxSizing: "border-box",
              padding: "11px 13px 11px 28px",
              borderRadius: RADIUS.lg,
              border: `1.5px solid ${T.sand}`,
              background: isShimAccount ? T.bgPage : T.chalk,
              fontFamily: "Georgia, serif",
              fontSize: 13,
              color: isShimAccount ? T.mist : T.ink,
              outline: "none",
            }}
          />
        </div>
        <div style={{ fontSize: 11, color: T.mist, margin: "0 2px 14px" }}>
          {isShimAccount
            ? "Your handle is how you sign in — add a real email to your account to unlock renaming."
            : "Co-travellers find and see you by your handle. Changing it updates your avatar too."}
        </div>

        {error && (
          <div
            style={{
              fontSize: 12,
              color: T.error,
              marginBottom: 10,
            }}
          >
            {error}
          </div>
        )}

        <button
          onClick={save}
          disabled={busy}
          style={{
            width: "100%",
            padding: 13,
            borderRadius: RADIUS.lg,
            border: "none",
            background: `linear-gradient(135deg, ${T.ocean}, ${T.dusk})`,
            color: T.chalk,
            fontFamily: "'DM Serif Display', serif",
            fontSize: 15,
            cursor: busy ? "default" : "pointer",
            opacity: busy ? 0.7 : 1,
          }}
        >
          {busy ? "Saving…" : "Save profile"}
        </button>
      </div>
    </div>
  );
}
