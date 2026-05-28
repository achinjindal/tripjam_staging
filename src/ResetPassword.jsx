import { useState, useEffect } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

// Eye / eye-slash icon for the password show-hide toggle.
function EyeIcon({ open }) {
  return open ? (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  ) : (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M17.94 17.94A10.07 10.07 0 0 1 12 19c-7 0-10-7-10-7a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 7 10 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
      <line x1="1" y1="1" x2="23" y2="23" />
    </svg>
  );
}

// Landing page for the Supabase password-reset email link. Supabase
// auto-signs the user in (PASSWORD_RECOVERY auth state) when they hit the
// page with a valid recovery token in the URL hash. We then call
// `auth.updateUser({ password })` to actually change it.
export default function ResetPassword() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [done, setDone] = useState(false);
  // recoveryReady is true after Supabase fires PASSWORD_RECOVERY with a
  // valid session derived from the email-link token. If the link is expired
  // or tampered with, we never see this event and show an error state.
  const [recoveryReady, setRecoveryReady] = useState(false);
  const [linkError, setLinkError] = useState(false);

  useEffect(() => {
    // Wait up to 4s for Supabase to process the recovery hash; otherwise
    // assume the link is bad / expired.
    let timeoutId;
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") {
        clearTimeout(timeoutId);
        setRecoveryReady(true);
      }
    });
    // Also check if there's already a session (refresh after PASSWORD_RECOVERY)
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        clearTimeout(timeoutId);
        setRecoveryReady(true);
      } else {
        timeoutId = setTimeout(() => setLinkError(true), 4000);
      }
    });
    return () => {
      data.subscription.unsubscribe();
      clearTimeout(timeoutId);
    };
  }, []);

  async function handleSubmit() {
    setError("");
    if (!password) return setError("Password is required.");
    if (password.length < 6)
      return setError("Password must be at least 6 characters.");
    if (password !== confirmPassword)
      return setError("Passwords do not match.");

    setLoading(true);
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
    // After 2s, redirect home so the user lands signed-in on their trips list
    setTimeout(() => {
      window.history.pushState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    }, 2000);
  }

  return (
    <div style={pageStyle}>
      <div style={cardStyle}>
        <div style={{ textAlign: "center", marginBottom: 24 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>
            {done ? "✅" : "🔑"}
          </div>
          <h1
            style={{
              color: T.ink,
              fontSize: 22,
              fontWeight: 400,
              margin: 0,
              fontFamily: "'DM Serif Display', serif",
            }}
          >
            {done
              ? "Password updated"
              : linkError
                ? "Reset link expired"
                : "Set a new password"}
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
            {done
              ? "Redirecting you to your trips…"
              : linkError
                ? "Your reset link is invalid or has expired. Please request a new one."
                : "Pick a new password to finish resetting your account."}
          </p>
        </div>

        {linkError ? (
          <button
            onClick={() => {
              window.history.pushState(null, "", "/forgot-password");
              window.dispatchEvent(new PopStateEvent("popstate"));
            }}
            style={primaryBtnStyle()}
          >
            Request a new link
          </button>
        ) : !done && recoveryReady ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <div style={{ position: "relative" }}>
              <input
                placeholder="New password"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
                style={{ ...inputStyle, paddingRight: 42 }}
              />
              <button
                type="button"
                onClick={() => setShowPassword((p) => !p)}
                aria-label={showPassword ? "Hide password" : "Show password"}
                style={eyeBtnStyle}
              >
                <EyeIcon open={showPassword} />
              </button>
            </div>
            <input
              placeholder="Confirm new password"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
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
              style={primaryBtnStyle(loading)}
            >
              {loading ? "Updating..." : "Update password"}
            </button>
          </div>
        ) : !done ? (
          <p
            style={{
              color: T.mist,
              fontSize: 13,
              textAlign: "center",
              fontStyle: "italic",
              margin: 0,
            }}
          >
            Verifying reset link…
          </p>
        ) : null}
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

const eyeBtnStyle = {
  position: "absolute",
  right: 10,
  top: "50%",
  transform: "translateY(-50%)",
  background: "none",
  border: "none",
  color: T.mist,
  cursor: "pointer",
  padding: 4,
  display: "flex",
  alignItems: "center",
};

function primaryBtnStyle(loading = false) {
  return {
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
    width: "100%",
  };
}
