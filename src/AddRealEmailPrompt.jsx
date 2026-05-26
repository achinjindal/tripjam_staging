import { useEffect, useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

// D9 Part C: force-prompt legacy username-only users (whose email is a
// synthetic `<username>@tripjam.app`) to add a real email on next login.
// Until they do, they can still use the app but the banner stays visible.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LEGACY_EMAIL_RE = /@tripjam\.app$/i;

export default function AddRealEmailPrompt({ session }) {
  const [needsPrompt, setNeedsPrompt] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState(false);

  useEffect(() => {
    if (!session?.user?.email) {
      setNeedsPrompt(false);
      return;
    }
    setNeedsPrompt(LEGACY_EMAIL_RE.test(session.user.email));
  }, [session?.user?.email]);

  if (!needsPrompt || dismissed || success) return null;

  async function submit() {
    setError("");
    const clean = email.trim().toLowerCase();
    if (!EMAIL_RE.test(clean)) return setError("Please enter a valid email.");
    setSubmitting(true);
    // Supabase: updateUser triggers a confirmation email to the new address.
    // Per Supabase default, the email field on auth.users only changes after
    // the user clicks the confirm link. The DB trigger we added then syncs
    // profiles.email automatically.
    const { error: updateError } = await supabase.auth.updateUser({ email: clean });
    setSubmitting(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setSuccess(true);
  }

  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 9998,
        background: T.warm || "#FAF6F0",
        borderBottom: `1px solid ${T.line || "#E2DDD5"}`,
        padding: "10px 16px",
        boxShadow: SHADOW?.sm || "0 2px 6px rgba(0,0,0,0.08)",
        animation: `slideDown ${MOTION?.medium || "240ms"} ease-out`,
      }}
    >
      <div
        style={{
          maxWidth: 720,
          margin: "0 auto",
          display: "flex",
          gap: 10,
          alignItems: "center",
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            flex: "1 1 220px",
            fontSize: 13,
            color: T.ink || "#0F1923",
            fontFamily: "Georgia, serif",
            lineHeight: 1.4,
          }}
        >
          <strong>Add an email</strong> so you can recover your account or sign
          in with Google later. We'll send a confirmation link.
        </span>
        <input
          placeholder="your-email@example.com"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          style={{
            flex: "1 1 200px",
            padding: "8px 12px",
            borderRadius: RADIUS?.sm || 8,
            border: `1px solid ${T.line || "#E2DDD5"}`,
            background: "white",
            color: T.ink || "#0F1923",
            fontSize: 13,
            fontFamily: "Georgia, serif",
            outline: "none",
            minWidth: 0,
          }}
        />
        <button
          onClick={submit}
          disabled={submitting}
          style={{
            padding: "8px 14px",
            borderRadius: RADIUS?.sm || 8,
            border: "none",
            background: submitting ? T.mist : T.ocean,
            color: "white",
            fontSize: 13,
            fontWeight: 600,
            cursor: submitting ? "not-allowed" : "pointer",
            fontFamily: "Georgia, serif",
            opacity: submitting ? 0.7 : 1,
          }}
        >
          {submitting ? "..." : "Save"}
        </button>
        <button
          onClick={() => setDismissed(true)}
          aria-label="Dismiss"
          style={{
            padding: "8px 10px",
            borderRadius: RADIUS?.sm || 8,
            border: "none",
            background: "transparent",
            color: T.muted || "#8BA5BB",
            fontSize: 14,
            cursor: "pointer",
            fontFamily: "Georgia, serif",
          }}
          title="Hide for this session"
        >
          ✕
        </button>
        {error && (
          <span
            style={{
              flex: "1 1 100%",
              color: T.error || "#DC2626",
              fontSize: 12,
              fontFamily: "Georgia, serif",
            }}
          >
            {error}
          </span>
        )}
      </div>
      <style>{`@keyframes slideDown { from { transform: translateY(-100%); opacity: 0 } to { transform: translateY(0); opacity: 1 } }`}</style>
    </div>
  );
}
