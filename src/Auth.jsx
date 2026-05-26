import { useState } from "react";
import { supabase } from "./supabase";
import { T, RADIUS, SHADOW, MOTION } from "./theme";

const FACE_ICONS = ["👦", "👧", "🧑", "👨", "👩", "🧔", "👱", "🧓", "🥸", "😎"];

// D9: Email is mandatory at signup. Signin accepts either email OR username
// (legacy users created before this migration used username-only auth).
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Gate the "Continue with Google" button on an env flag. Hidden until the
// Google Cloud OAuth client is configured AND the provider is enabled in
// Supabase Auth. Set VITE_GOOGLE_AUTH_ENABLED=true to show it.
const GOOGLE_AUTH_ENABLED = import.meta.env.VITE_GOOGLE_AUTH_ENABLED === "true";

// Legacy username → fake email shim so old accounts can still sign in.
function fakeEmail(u) {
  return `${u.toLowerCase().trim().replace(/[^a-z0-9._-]/g, "")}@tripjam.app`;
}

export default function Auth({ initialMode }) {
  // Allow caller (Root in main.jsx) to force /signup vs /signin via URL.
  const [mode, setMode] = useState(
    initialMode === "signup" ? "signup" : "signin",
  );
  // Signin accepts either: a real email OR a legacy username
  const [identifier, setIdentifier] = useState("");
  // Signup-only fields
  const [email, setEmail] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [faceIcon, setFaceIcon] = useState(0);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSignInWithGoogle() {
    setError("");
    setLoading(true);
    const { error: oauthError } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/`,
      },
    });
    if (oauthError) {
      setLoading(false);
      setError(`Google sign-in failed: ${oauthError.message}`);
    }
    // On success, the browser redirects to Google; loading stays true until then.
  }

  async function handleSignUp() {
    setError("");
    if (!email.trim()) return setError("Email is required.");
    if (!EMAIL_RE.test(email.trim())) return setError("Please enter a valid email address.");
    if (!username.trim()) return setError("Username is required.");
    if (!password) return setError("Password is required.");
    if (password.length < 6) return setError("Password must be at least 6 characters.");

    setLoading(true);
    const cleanEmail = email.trim().toLowerCase();
    const cleanUsername = username.trim();

    const { data, error: signUpError } = await supabase.auth.signUp({
      email: cleanEmail,
      password,
      options: {
        data: {
          username: cleanUsername,
          full_name: cleanUsername,
        },
      },
    });

    if (signUpError) {
      setLoading(false);
      return setError(signUpError.message);
    }

    if (data?.user?.id) {
      // The DB trigger `create_profile_on_auth_signup` already inserted a row;
      // upsert here ensures username + face_icon land correctly (the trigger
      // derives username from email if no metadata, but we have the real one).
      const { error: profileError } = await supabase.from("profiles").upsert({
        id: data.user.id,
        username: cleanUsername,
        email: cleanEmail,
        display_name: cleanUsername,
        face_icon: faceIcon + 1,
      });
      if (profileError) {
        setLoading(false);
        return setError(
          `Account created but profile failed: ${profileError.message}. Contact support.`,
        );
      }
    }
    setLoading(false);
    // If email confirmation is required (Supabase setting), user gets a confirm-email
    // prompt; otherwise they're now signed in. Either way, no further UI action here.
  }

  async function handleSignIn() {
    setError("");
    const id = identifier.trim();
    if (!id || !password) return setError("Email/username and password are required.");

    setLoading(true);
    // Detect whether identifier looks like an email or a legacy username
    const loginEmail = EMAIL_RE.test(id) ? id.toLowerCase() : fakeEmail(id);
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: loginEmail,
      password,
    });
    setLoading(false);
    if (signInError) {
      // Don't reveal whether the identifier exists — generic message
      setError("Invalid email/username or password.");
    }
  }

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.ink,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Georgia, serif",
      }}
    >
      <div
        style={{
          background: T.dusk,
          borderRadius: RADIUS.lg,
          padding: "40px 36px",
          width: "100%",
          maxWidth: 400,
          boxShadow: SHADOW.lg,
        }}
      >
        {/* Logo */}
        <div style={{ textAlign: "center", marginBottom: 28 }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>✈️</div>
          <h1
            style={{
              color: T.chalk,
              fontSize: 26,
              fontWeight: 400,
              margin: 0,
              fontFamily: "'DM Serif Display', serif",
            }}
          >
            TripJam
          </h1>
          <p style={{ color: T.mist, fontSize: 12, margin: "4px 0 0" }}>
            Plan together, travel better
          </p>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            background: T.ink,
            borderRadius: RADIUS.md,
            padding: 4,
            marginBottom: 20,
          }}
        >
          {["signin", "signup"].map((m) => (
            <button
              key={m}
              onClick={() => {
                setMode(m);
                setError("");
              }}
              style={{
                flex: 1,
                padding: "8px 0",
                borderRadius: RADIUS.sm,
                border: "none",
                cursor: "pointer",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "Georgia, serif",
                background: mode === m ? T.ocean : "transparent",
                color: mode === m ? T.chalk : T.mist,
                transition: `all ${MOTION.normal}`,
              }}
            >
              {m === "signin" ? "Sign In" : "Sign Up"}
            </button>
          ))}
        </div>

        {/* Google OAuth — D9 Part C (gated on VITE_GOOGLE_AUTH_ENABLED) */}
        {GOOGLE_AUTH_ENABLED && (
          <>
            <button
              onClick={handleSignInWithGoogle}
              disabled={loading}
              style={{
                width: "100%",
                padding: "11px 16px",
                borderRadius: RADIUS.md,
                border: "1.5px solid rgba(255,255,255,0.18)",
                background: "#FFFFFF",
                color: "#1F2937",
                fontSize: 14,
                fontWeight: 600,
                fontFamily: "Georgia, serif",
                cursor: loading ? "not-allowed" : "pointer",
                minHeight: 44,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 10,
                marginBottom: 18,
                opacity: loading ? 0.7 : 1,
                transition: `all ${MOTION.normal}`,
              }}
            >
              <svg width="18" height="18" viewBox="0 0 18 18" xmlns="http://www.w3.org/2000/svg">
                <path d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#4285F4"/>
                <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.836.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18z" fill="#34A853"/>
                <path d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#FBBC05"/>
                <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#EA4335"/>
              </svg>
              Continue with Google
            </button>

            {/* Divider */}
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
              <span style={{ fontSize: 11, color: T.mist, letterSpacing: 1 }}>OR</span>
              <div style={{ flex: 1, height: 1, background: "rgba(255,255,255,0.12)" }} />
            </div>
          </>
        )}

        {/* Fields */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {mode === "signup" ? (
            <>
              <input
                placeholder="Email"
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={inputStyle}
              />
              <input
                placeholder="Username (display name)"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                style={inputStyle}
              />
            </>
          ) : (
            <input
              placeholder="Email or username"
              autoComplete="username"
              value={identifier}
              onChange={(e) => setIdentifier(e.target.value)}
              style={inputStyle}
            />
          )}
          <input
            placeholder="Password"
            type="password"
            autoComplete={mode === "signup" ? "new-password" : "current-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) =>
              e.key === "Enter" &&
              (mode === "signin" ? handleSignIn() : handleSignUp())
            }
            style={inputStyle}
          />

          {/* Face icon picker — signup only */}
          {mode === "signup" && (
            <div>
              <p style={{ color: T.mist, fontSize: 12, margin: "4px 0 8px" }}>
                Choose your icon
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {FACE_ICONS.map((icon, i) => (
                  <button
                    key={i}
                    onClick={() => setFaceIcon(i)}
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: RADIUS.md,
                      border:
                        faceIcon === i
                          ? `2px solid ${T.sky}`
                          : `2px solid transparent`,
                      background:
                        faceIcon === i ? "rgba(74,144,217,0.15)" : T.ink,
                      fontSize: 22,
                      cursor: "pointer",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      transition: `all ${MOTION.normal}`,
                    }}
                  >
                    {icon}
                  </button>
                ))}
              </div>
            </div>
          )}

          {error && (
            <p style={{ color: T.error, fontSize: 12, margin: 0 }}>{error}</p>
          )}

          <button
            onClick={mode === "signin" ? handleSignIn : handleSignUp}
            disabled={loading}
            style={{
              marginTop: 4,
              padding: "10px 20px",
              borderRadius: RADIUS.md,
              border: "none",
              background: loading ? T.mist : T.ocean,
              color: T.chalk,
              fontSize: 14,
              fontWeight: 600,
              fontFamily: "Georgia, serif",
              cursor: loading ? "not-allowed" : "pointer",
              minHeight: 44,
              transition: `all ${MOTION.normal}`,
              opacity: loading ? 0.7 : 1,
            }}
          >
            {loading ? "..." : mode === "signin" ? "Sign In" : "Create Account"}
          </button>

          {mode === "signin" && (
            <p style={{ color: T.mist, fontSize: 11, margin: "8px 0 0", textAlign: "center" }}>
              Forgot password? Email{" "}
              <a href="mailto:achinj.work@gmail.com" style={{ color: T.sky }}>
                support
              </a>{" "}
              for a reset link.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

const inputStyle = {
  padding: "10px 14px",
  borderRadius: RADIUS.md,
  border: "1.5px solid rgba(255,255,255,0.12)",
  background: "rgba(0,0,0,0.2)",
  color: "#fff",
  fontSize: 14,
  fontFamily: "Georgia, serif",
  outline: "none",
  width: "100%",
  boxSizing: "border-box",
  minHeight: 44,
  transition: `border-color ${MOTION.normal}, box-shadow ${MOTION.normal}`,
};
