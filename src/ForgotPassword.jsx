import { useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Sends a password-reset email via Supabase. The email contains a link back
// to /reset-password where the user picks a new password.
export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSubmit() {
    setError("");
    const clean = email.trim().toLowerCase();
    if (!clean) return setError("Email is required.");
    if (!EMAIL_RE.test(clean))
      return setError("Please enter a valid email address.");

    setLoading(true);
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      clean,
      { redirectTo: `${window.location.origin}/reset-password` },
    );
    setLoading(false);
    if (resetError) {
      setError(resetError.message);
      return;
    }
    // Always report "sent" regardless of whether the email exists — avoids
    // leaking which emails are registered. Supabase already does this server-
    // side, but we mirror the behavior in the UI.
    setSent(true);
  }

  function goToSignIn(e) {
    e.preventDefault();
    window.history.pushState(null, "", "/signin");
    window.dispatchEvent(new PopStateEvent("popstate"));
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>🔑</div>
          <h1
            style={{
              color: T.ink,
              fontSize: 22,
              fontWeight: 400,
              margin: 0,
              fontFamily: "'DM Serif Display', serif",
            }}
          >
            {sent ? "Check your email" : "Reset your password"}
          </h1>
          <p
            style={{
              color: T.mist,
              fontSize: 13,
              margin: "8px 0 0",
              fontStyle: "italic",
              lineHeight: 1.5,
            }}
          >
            {sent
              ? "If an account exists for that email, we sent a reset link. It expires in 1 hour."
              : "Enter your email and we'll send you a link to reset your password."}
          </p>
        </div>

        {!sent && (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <input
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
              style={inputStyle}
            />

            {error && (
              <p
                style={{
                  color: T.error,
                  fontSize: 12,
                  margin: 0,
                  background: T.errorLight,
                  border: `1px solid ${T.errorBorder}`,
                  padding: "8px 10px",
                  borderRadius: RADIUS.sm,
                }}
              >
                {error}
              </p>
            )}

            <button
              onClick={handleSubmit}
              disabled={loading}
              style={{
                marginTop: 4,
                padding: "12px 20px",
                borderRadius: RADIUS.md,
                border: "none",
                background: loading ? T.disabled : T.ocean,
                color: T.chalk,
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "Georgia, serif",
                cursor: loading ? "not-allowed" : "pointer",
                minHeight: 46,
                transition: `all ${MOTION.normal}`,
                opacity: loading ? 0.7 : 1,
              }}
            >
              {loading ? "Sending..." : "Send reset link"}
            </button>
          </div>
        )}

        <p
          style={{
            margin: "24px 0 0",
            textAlign: "center",
            fontSize: 13,
            color: T.mist,
            fontFamily: "Georgia, serif",
          }}
        >
          <a href="/signin" onClick={goToSignIn} style={linkStyle}>
            ← Back to log in
          </a>
        </p>
      </div>
    </div>
  );
}

const pageStyle = {
  minHeight: "100vh",
  background: T.bgPage,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  fontFamily: "Georgia, serif",
  padding: 20,
};

const cardStyle = {
  background: T.chalk,
  borderRadius: RADIUS.lg,
  padding: "36px 32px",
  width: "100%",
  maxWidth: 380,
  boxShadow: SHADOW.md,
  border: `1px solid ${T.border}`,
};

const inputStyle = {
  padding: "12px 14px",
  borderRadius: RADIUS.md,
  border: `1.5px solid ${T.border}`,
  background: T.chalk,
  color: T.ink,
  fontSize: 14,
  fontFamily: "Georgia, serif",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  transition: `border-color ${MOTION.normal}, box-shadow ${MOTION.normal}`,
};

const linkStyle = {
  color: T.ocean,
  textDecoration: "none",
  fontFamily: "Georgia, serif",
  fontWeight: 600,
};
