import { useEffect, useRef, useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";
import {
  useCredits,
  refreshCredits,
  displayCredits,
  CREDITS_UI_ENABLED,
  getCredits,
} from "./credits";
import { CouponModal } from "./CreditsOverlay";
import ProfileSheet from "./ProfileSheet";

// Modest fixed palette for username-hashed avatar circles. Each username
// deterministically maps to one of these so the avatar is stable across
// sessions but visually distinct across users (lightweight personalization
// without the legacy face_icon emoji picker).
const AVATAR_PALETTE = [T.ocean, T.terra, T.moss, T.gold, T.sky];

function hashStringToInt(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

// Exported for reuse by member avatars (MemberAvatar.jsx).
export function avatarColorFor(name) {
  if (!name) return T.ocean;
  return AVATAR_PALETTE[hashStringToInt(name) % AVATAR_PALETTE.length];
}

export function avatarInitial(name) {
  if (!name) return "?";
  // First alphanumeric character, uppercased. Falls back to '?' so we never
  // render an empty circle.
  const m = name.match(/[A-Za-z0-9]/);
  return (m ? m[0] : "?").toUpperCase();
}

/** Collision-aware initials: single letter normally, but when another name in
 *  the group shares the same first initial, expand to two characters —
 *  word initials for multi-word names ("qa-tester" → QT), first two letters
 *  otherwise ("tripman" → TR). */
export function avatarInitials(name, allNames = []) {
  const single = avatarInitial(name);
  const collides = allNames.some(
    (n) => n && n !== name && avatarInitial(n) === single,
  );
  if (!collides) return single;
  const tokens = (name || "").split(/[^A-Za-z0-9]+/).filter(Boolean);
  if (tokens.length >= 2) return (tokens[0][0] + tokens[1][0]).toUpperCase();
  const word = tokens[0] || "";
  return word.length >= 2 ? word.slice(0, 2).toUpperCase() : single;
}

// D20: top-right avatar is the single entry point for balance + top up + sign out.
// Mounted globally in main.jsx for every authenticated view.
export default function Avatar({ session }) {
  const [profile, setProfile] = useState(null);
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const credits = useCredits();
  const ref = useRef(null);

  useEffect(() => {
    if (!session?.user?.id) return;
    supabase
      .from("profiles")
      .select("username, display_name, is_admin, created_at")
      .eq("id", session.user.id)
      .maybeSingle()
      .then(({ data }) => setProfile(data));
    if (CREDITS_UI_ENABLED && getCredits() === null)
      refreshCredits(session.user.id);
  }, [session?.user?.id]);

  // Close dropdown when clicking outside
  useEffect(() => {
    if (!open) return;
    function onClick(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, [open]);

  if (!session?.user?.id) return null;

  const username =
    profile?.username || session.user.email?.split("@")[0] || "you";
  const initial = avatarInitial(username);
  const avatarBg = avatarColorFor(username);
  const isAdmin = !!profile?.is_admin;
  const balance = credits == null ? null : displayCredits(credits);
  const balanceDecimal =
    credits != null && Number.isFinite(Number(credits))
      ? Number(credits).toFixed(2)
      : null;

  async function signOut() {
    setOpen(false);
    await supabase.auth.signOut();
    // PostHog reset is handled in main.jsx auth listener
  }

  function goToTrips() {
    setOpen(false);
    if (window.location.pathname === "/") return;
    window.history.pushState(null, "", "/");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  // Hide "Your trips" when we're already on the home / trips list.
  const onTripsList =
    typeof window !== "undefined" && window.location.pathname === "/";

  return (
    <>
      <div
        ref={ref}
        style={{
          position: "fixed",
          top: 12,
          right: 12,
          zIndex: 1000,
          fontFamily: "Georgia, serif",
          // Wrapper is pointer-events:none so it doesn't intercept clicks
          // on the page beneath; the avatar button below restores auto.
          pointerEvents: "none",
        }}
      >
        <button
          aria-label="Account menu"
          onClick={() => setOpen((o) => !o)}
          style={{
            width: 36,
            height: 36,
            borderRadius: 999,
            border: "none",
            background: avatarBg,
            color: T.chalk,
            cursor: "pointer",
            fontSize: 15,
            fontWeight: 700,
            fontFamily: "Georgia, serif",
            letterSpacing: 0.2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            boxShadow: SHADOW?.sm || "0 1px 3px rgba(0,0,0,0.08)",
            transition: `transform ${MOTION?.normal || "180ms"}`,
            transform: open ? "scale(0.96)" : "scale(1)",
            pointerEvents: "auto",
          }}
        >
          {initial}
        </button>

        {open && (
          <div
            style={{
              position: "absolute",
              top: 44,
              right: 0,
              minWidth: 240,
              background: "white",
              borderRadius: RADIUS?.md || 12,
              border: `1px solid ${T.line || "#E2DDD5"}`,
              boxShadow: SHADOW?.lg || "0 12px 32px rgba(0,0,0,0.16)",
              overflow: "hidden",
              animation: `dropdown ${MOTION?.fast || "120ms"} ease-out`,
              pointerEvents: "auto",
            }}
          >
            <div
              style={{
                padding: "12px 14px",
                borderBottom: `1px solid ${T.line || "#F0EBE3"}`,
              }}
            >
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 700,
                  color: T.ink || "#0F1923",
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 999,
                    background: avatarBg,
                    color: T.chalk,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontSize: 11,
                    fontWeight: 700,
                  }}
                >
                  {initial}
                </span>
                <span>{profile?.display_name || `@${username}`}</span>
                {isAdmin && (
                  <span
                    style={{
                      fontSize: 9,
                      letterSpacing: 0.8,
                      padding: "2px 6px",
                      borderRadius: 4,
                      background: T.ocean || "#2563A8",
                      color: "white",
                      textTransform: "uppercase",
                    }}
                  >
                    Admin
                  </span>
                )}
              </div>
              {/* Kept minimal — full account details live in Edit profile. */}
              {profile?.display_name && (
                <div
                  style={{
                    marginTop: 4,
                    fontSize: 11.5,
                    color: T.mist || "#587284",
                  }}
                >
                  @{username}
                </div>
              )}
            </div>

            {CREDITS_UI_ENABLED && (
              <div
                style={{
                  padding: "12px 14px",
                  borderBottom: `1px solid ${T.line || "#F0EBE3"}`,
                }}
              >
                <div
                  style={{
                    fontSize: 10,
                    textTransform: "uppercase",
                    letterSpacing: 0.8,
                    color: T.muted || "#8BA5BB",
                    marginBottom: 4,
                  }}
                >
                  Credits
                </div>
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: 10,
                  }}
                >
                  <div
                    style={{
                      fontFamily: "'DM Serif Display', Georgia, serif",
                      fontSize: 26,
                      color:
                        balance == null
                          ? T.muted
                          : balance <= 10
                            ? T.error || "#DC2626"
                            : T.ink || "#0F1923",
                    }}
                    title={
                      isAdmin && balanceDecimal
                        ? `Exact: ${balanceDecimal}`
                        : undefined
                    }
                  >
                    {balance == null ? "…" : balance}
                  </div>
                  {isAdmin && balanceDecimal && (
                    <div style={{ fontSize: 10, color: T.muted || "#8BA5BB" }}>
                      ({balanceDecimal})
                    </div>
                  )}
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    setShowPicker(true);
                  }}
                  style={{
                    width: "100%",
                    padding: "8px 12px",
                    borderRadius: RADIUS?.sm || 8,
                    border: "none",
                    background: T.ocean || "#2563A8",
                    color: "white",
                    fontSize: 12,
                    fontWeight: 600,
                    fontFamily: "Georgia, serif",
                    cursor: "pointer",
                    minHeight: 36,
                  }}
                >
                  Top up
                </button>
                {/* R12 mitigation: brief pricing hint so users know what consumes credits */}
                <div
                  style={{
                    marginTop: 8,
                    fontSize: 10,
                    color: T.muted || "#8BA5BB",
                    lineHeight: 1.5,
                  }}
                >
                  AI uses 1-30 credits per call. Magazine ~1 credit per city.
                  Route &amp; itinerary 5-30 credits each.
                </div>
              </div>
            )}

            <button
              onClick={() => {
                setOpen(false);
                setShowProfile(true);
              }}
              style={menuItemStyle(T)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = T.warm || "#FAF6F0")
              }
              onMouseLeave={(e) =>
                (e.currentTarget.style.background = "transparent")
              }
            >
              Edit profile
            </button>

            {!onTripsList && (
              <button
                onClick={goToTrips}
                style={menuItemStyle(T)}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.background = T.warm || "#FAF6F0")
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.background = "white")
                }
              >
                Your trips
              </button>
            )}
            <button
              onClick={signOut}
              style={menuItemStyle(T)}
              onMouseEnter={(e) =>
                (e.currentTarget.style.background = T.warm || "#FAF6F0")
              }
              onMouseLeave={(e) => (e.currentTarget.style.background = "white")}
            >
              Sign out
            </button>
          </div>
        )}

        <style>{`@keyframes dropdown { from { opacity: 0; transform: translateY(-4px) } to { opacity: 1; transform: translateY(0) } }`}</style>
      </div>
      <CouponModal
        open={showPicker}
        onClose={() => setShowPicker(false)}
        session={session}
      />
      {showProfile && (
        <ProfileSheet
          session={session}
          profile={profile}
          onClose={() => setShowProfile(false)}
          onSaved={(p) => setProfile((prev) => ({ ...prev, ...p }))}
        />
      )}
    </>
  );
}

// Shared style for the bottom-of-menu action buttons (Your trips, Sign out).
function menuItemStyle(T) {
  return {
    display: "block",
    width: "100%",
    padding: "12px 14px",
    background: "white",
    border: "none",
    textAlign: "left",
    fontSize: 13,
    color: T.muted || "#8BA5BB",
    cursor: "pointer",
    fontFamily: "Georgia, serif",
    transition: `background 120ms`,
  };
}
