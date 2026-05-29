import { useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

// D9: Email is mandatory at signup. Signin still accepts either email OR a
// legacy username (pre-D9 accounts were created username-only).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Google OAuth button always rendered. Supabase Google provider must be
// configured (Auth → Providers → Google → Client ID + Secret) for it to work.

// Legacy username → fake email shim so pre-D9 accounts can still sign in.
function fakeEmail(u) {
  return `${u
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]/g, "")}@tripjam.app`;
}

// Derive a username from the email local part: "Jane.Doe+travel@gmail.com" →
// "jane.doe". Strips characters the profile constraint won't accept.
function baseUsernameFromEmail(email) {
  const local = (email.split("@")[0] || "").toLowerCase();
  const sanitized = local
    .replace(/\+.*$/, "") // drop +tags
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 30);
  return sanitized || `user${Math.random().toString(36).slice(2, 8)}`;
}

// Try the base username; if profiles.username UNIQUE collides, suffix -2,
// -3, … up to 10 attempts before falling back to a random id.
async function pickAvailableUsername(base) {
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const { data, error } = await supabase
      .from("profiles")
      .select("id")
      .eq("username", candidate)
      .maybeSingle();
    if (error && error.code !== "PGRST116") {
      // Unexpected error — give up gracefully with the base + random suffix
      return `${base}-${Math.random().toString(36).slice(2, 5)}`;
    }
    if (!data) return candidate;
  }
  return `${base}-${Math.random().toString(36).slice(2, 5)}`;
}

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

export default function Auth({ initialMode }) {
  // initialMode comes from URL routing in main.jsx (/signin vs /signup).
  // We also let users flip between the two via the bottom link without a
  // full page reload — pushState updates the URL, setMode swaps the form.
  const [mode, setMode] = useState(
    initialMode === "signup" ? "signup" : "signin",
  );
  // Signin accepts either: a real email OR a legacy username.
  const [identifier, setIdentifier] = useState("");
  // Signup uses email-only; username is auto-derived.
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  function switchMode(next) {
    setMode(next);
    setError("");
    const path = next === "signup" ? "/signup" : "/signin";
    if (window.location.pathname !== path) {
      window.history.pushState(null, "", path);
    }
  }

  async function handleSignInWithGoogle() {
    setError("");
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${window.location.origin}/` },
    });
    if (oauthError) {
      setLoading(false);
      setError(`Google sign-in failed: ${oauthError.message}`);
    }
    // On success, browser redirects to Google; loading stays true until then.
  }

  async function handleSignUp() {
    setError("");
    if (!email.trim()) return setError("Email is required.");
    if (!EMAIL_RE.test(email.trim()))
      return setError("Please enter a valid email address.");
    if (!password) return setError("Password is required.");
    if (password.length < 6)
      return setError("Password must be at least 6 characters.");

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const base = baseUsernameFromEmail(cleanEmail);
    const chosenUsername = await pickAvailableUsername(base);

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          username: chosenUsername,
          full_name: chosenUsername,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      return setError(signUpError.message);
    }

    if (data?.user?.id) {
      // The DB trigger `create_profile_on_auth_signup` already inserted a row
      // using the username we passed in raw_user_meta_data. Upsert here is a
      // belt-and-braces sync in case the trigger fell through to its own
      // derivation path (collision, etc).
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: data.user.id,
        username: chosenUsername,
        email: cleanEmail,
        display_name: chosenUsername,
      });
      if (profileError) {
        setLoading(false);
        return setError(
          `Account created but profile failed: ${profileError.message}. Contact support.`,
        );
      }
    }
    setLoading(false);
  }

  async function handleSignIn() {
    setError("");
    const id = identifier.trim();
    if (!id || !password)
      return setError("Email/username and password are required.");

    setLoading(true);
    const loginEmail = EMAIL_RE.test(id) ? id.toLowerCase() : fakeEmail(id);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    setLoading(false);
    if (signInError) {
      setError("Invalid email/username or password.");
    }
  }

  const submit = mode === "signin" ? handleSignIn : handleSignUp;

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bgPage,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Georgia, serif",
        padding: 20,
      }}
    >
      <div
        style={{
          background: T.chalk,
          borderRadius: RADIUS.lg,
          padding: "36px 32px",
          width: "100%",
          maxWidth: 380,
          boxShadow: SHADOW.md,
          border: `1px solid ${T.border}`,
        }}
      >
        {/* Logo + title */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 28, marginBottom: 6 }}>✈️</div>
          <h1
            style={{
              color: T.ink,
              fontSize: 24,
              fontWeight: 400,
              margin: 0,
              fontFamily: "'DM Serif Display', serif",
            }}
          >
            {mode === "signin" ? "Welcome back" : "Create your account"}
          </h1>
          <p
            style={{
              color: T.mist,
              fontSize: 13,
              margin: "6px 0 0",
              fontStyle: "italic",
            }}
          >
            Plan together, travel better
          </p>
        </div>

        {/* Google OAuth — always rendered. */}
        <>
          <button
            onClick={handleSignInWithGoogle}
            disabled={loading}
            style={{
              width: "100%",
              padding: "11px 16px",
              borderRadius: RADIUS.full,
              border: `1.5px solid ${T.border}`,
              background: T.chalk,
              color: T.ink,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "Georgia, serif",
              cursor: loading ? "not-allowed" : "pointer",
              minHeight: 44,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              marginBottom: 14,
              opacity: loading ? 0.7 : 1,
              transition: `all ${MOTION.normal}`,
            }}
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 18 18"
              xmlns="http://www.w3.org/2000/svg"
            >
              <path
                d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z"
                fill="#4285F4"
              />
              <path
                d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z"
                fill="#34A853"
              />
              <path
                d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z"
                fill="#FBBC05"
              />
              <path
                d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z"
                fill="#EA4335"
              />
            </svg>
            {mode === "signin" ? "Continue with Google" : "Sign up with Google"}
          </button>

          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              marginBottom: 14,
            }}
          >
            <div style={{ flex: 1, height: 1, background: T.border }} />
            <span
              style={{
                fontSize: 11,
                color: T.mist,
                letterSpacing: 1,
                textTransform: "uppercase",
              }}
            >
              or
            </span>
            <div style={{ flex: 1, height: 1, background: T.border }} />
          </div>
        </>

        {/* Form fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" ? (
            <input
              placeholder="Email"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={inputStyle}
            />
          ) : (
            <input
              placeholder="Email or username"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={inputStyle}
            />
          )}

          <div style={{ position: "relative" }}>
            <input
              placeholder="Password"
              type={showPassword ? "text" : "password"}
              autoComplete={
                mode === "signup" ? "new-password" : "current-password"
              }
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && submit()}
              style={{ ...inputStyle, paddingRight: 42 }}
            />
            <button
              type="button"
              onClick={() => setShowPassword((p) => !p)}
              aria-label={showPassword ? "Hide password" : "Show password"}
              style={{
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
              }}
            >
              <EyeIcon open={showPassword} />
            </button>
          </div>

          {/* Forgot password link — only on sign-in screen */}
          {mode === "signin" && (
            <div style={{ textAlign: "right", marginTop: -4 }}>
              <a
                href="/forgot-password"
                onClick={(e) => {
                  e.preventDefault();
                  window.history.pushState(null, "", "/forgot-password");
                  window.dispatchEvent(new PopStateEvent("popstate"));
                }}
                style={{
                  fontSize: 12,
                  color: T.ocean,
                  textDecoration: "none",
                  fontFamily: "Georgia, serif",
                }}
              >
                Forgot password?
              </a>
            </div>
          )}

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
            onClick={submit}
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
            {loading ? "..." : mode === "signin" ? "Log in" : "Create account"}
          </button>

          {/* Terms acceptance baked into the button text on signup */}
          {mode === "signup" && (
            <p
              style={{
                fontSize: 11,
                color: T.mist,
                lineHeight: 1.5,
                margin: "4px 0 0",
                textAlign: "center",
              }}
            >
              By creating an account, you agree to our{" "}
              <a
                href="/terms"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: T.ocean, textDecoration: "underline" }}
              >
                Terms
              </a>{" "}
              and{" "}
              <a
                href="/privacy"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: T.ocean, textDecoration: "underline" }}
              >
                Privacy Policy
              </a>
              .
            </p>
          )}
        </div>

        {/* Mode-switch link at the bottom */}
        <p
          style={{
            margin: "24px 0 0",
            textAlign: "center",
            fontSize: 13,
            color: T.mist,
            fontFamily: "Georgia, serif",
          }}
        >
          {mode === "signin" ? (
            <>
              Don&rsquo;t have an account?{" "}
              <button
                onClick={() => switchMode("signup")}
                style={modeSwitchBtn}
              >
                Sign up
              </button>
            </>
          ) : (
            <>
              Already have an account?{" "}
              <button
                onClick={() => switchMode("signin")}
                style={modeSwitchBtn}
              >
                Log in
              </button>
            </>
          )}
        </p>
      </div>
    </div>
  );
}

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

const modeSwitchBtn = {
  background: "none",
  border: "none",
  padding: 0,
  color: T.ocean,
  fontWeight: 600,
  fontSize: 13,
  fontFamily: "Georgia, serif",
  cursor: "pointer",
  textDecoration: "underline",
};
