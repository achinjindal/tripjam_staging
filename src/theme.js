// ── Core palette ──
export const T = {
  ink:    "#0F1923",
  dusk:   "#1E2D3D",
  ocean:  "#2563A8",
  oceanHover: "#1E529A",
  sky:    "#4A90D9",
  sand:   "#F0E6D3",
  warm:   "#FAF6F0",
  terra:  "#C4622D",
  gold:   "#D4A847",
  moss:   "#3D7A5C",
  mist:   "#8BA5BB",
  chalk:  "#FFFFFF",
  // Semantic states
  error:        "#C53030",
  errorLight:   "#FEE2E2",
  errorBorder:  "#FECACA",
  success:      "#16A34A",
  successLight: "#DCFCE7",
  successBorder:"#BBF7D0",
  warning:      "#92400E",
  warningLight: "#FEF3C7",
  warningBorder:"#FED7AA",
  // Neutral UI
  border:   "#E2DDD5",
  bgPage:   "#F5F0E8",
  disabled: "#C4BDB3",
};

// ── Typography ──
export const TYPE = {
  display: { fontFamily: "'DM Serif Display', serif" },
  body:    { fontFamily: "Georgia, serif" },
  h1:    { fontSize: 26, fontWeight: 400, lineHeight: 1.15 },
  h2:    { fontSize: 20, fontWeight: 400, lineHeight: 1.2 },
  h3:    { fontSize: 16, fontWeight: 400, lineHeight: 1.25 },
  body1: { fontSize: 14, fontWeight: 400, lineHeight: 1.6 },
  body2: { fontSize: 12, fontWeight: 400, lineHeight: 1.5 },
  caption: { fontSize: 11, fontWeight: 400, lineHeight: 1.4 },
};
export const heading = (level) => ({ ...TYPE.display, ...TYPE[level] });
export const text = (level) => ({ ...TYPE.body, ...TYPE[level] });

// ── Spacing (4px base) ──
export const SPACE = { xs: 4, sm: 8, md: 16, lg: 24, xl: 32, xxl: 48 };

// ── Border radius ──
export const RADIUS = { sm: 6, md: 10, lg: 14, full: 9999 };

// ── Shadows ──
export const SHADOW = {
  sm: "0 1px 3px rgba(15,25,35,0.06)",
  md: "0 4px 16px rgba(15,25,35,0.10)",
  lg: "0 8px 30px rgba(15,25,35,0.18)",
};

// ── Transitions ──
export const MOTION = { fast: "0.12s ease", normal: "0.15s ease", slow: "0.25s ease" };

// ── API ──
export const PLACES_PROXY = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/places-proxy`;
export const PLACES_HEADERS = { "Authorization": `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`, "Content-Type": "application/json" };
