// Reusable member avatar circle (initials on a username-hashed color).
// Shares the deterministic color/initial helpers with the global Avatar.

import { avatarColorFor, avatarInitial } from "./Avatar";
import { T } from "./theme";

export default function MemberAvatar({ name, size = 34, ring = null }) {
  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: 9999,
        background: avatarColorFor(name),
        color: T.chalk,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "Georgia, serif",
        fontWeight: 700,
        fontSize: size * 0.4,
        flexShrink: 0,
        ...(ring
          ? { border: `${Math.max(1.5, size * 0.05)}px solid ${ring}` }
          : {}),
      }}
    >
      {avatarInitial(name)}
    </div>
  );
}

// Overlapping avatar stack (for the shared-trip header affordance).
export function AvatarStack({
  names = [],
  size = 22,
  max = 3,
  ring = "#23384c",
}) {
  const shown = names.slice(0, max);
  return (
    <div style={{ display: "inline-flex", alignItems: "center" }}>
      {shown.map((n, i) => (
        <div key={i} style={{ marginLeft: i === 0 ? 0 : -size * 0.32 }}>
          <MemberAvatar name={n} size={size} ring={ring} />
        </div>
      ))}
    </div>
  );
}
