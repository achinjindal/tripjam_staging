// Builds the model input for extract-preferences from the request body.
//
// This endpoint is UNBILLED, so input size is the only thing bounding what a
// call costs. Before these caps the body was used as sent: a scripted caller
// could put ~190k tokens into every call (~$0.19 on Haiku) at the per-minute
// rate limit — roughly $5k/day from one account, charged to nobody.
//
// The caps sit far above real use (a setup-form note is a sentence or two; a
// pre-build chat turn is a few hundred characters) and TRIM rather than
// reject: this call fills in pills on an already-open sheet and fails open,
// so a long note should still extract, never error.
export const MAX_NOTES_CHARS = 2000;
export const MAX_MESSAGE_CHARS = 1500;
export const MAX_MESSAGES = 10;
const MAX_ROLE_CHARS = 20;

const clip = (s: string, max: number) =>
  s.length > max ? `${s.slice(0, max)}…` : s;

// Returns the user-turn text, or null when there is nothing to extract from.
// Tolerates any JSON shape: non-string notes/content and a non-array
// chatHistory are ignored rather than thrown on, so junk input costs no model
// call and no error report.
export function buildPrefsInput(
  notes: unknown,
  chatHistory: unknown,
): string | null {
  const parts: string[] = [];

  const note = typeof notes === "string" ? notes.trim() : "";
  if (note) parts.push(`User notes: "${clip(note, MAX_NOTES_CHARS)}"`);

  if (Array.isArray(chatHistory)) {
    const lines = chatHistory
      .slice(-MAX_MESSAGES)
      .map((m) => {
        const content = typeof m?.content === "string" ? m.content.trim() : "";
        if (!content) return null;
        const role =
          typeof m?.role === "string" && m.role
            ? m.role.slice(0, MAX_ROLE_CHARS)
            : "user";
        return `${role}: ${clip(content, MAX_MESSAGE_CHARS)}`;
      })
      .filter((l): l is string => l !== null);
    if (lines.length) parts.push(`Chat history:\n${lines.join("\n")}`);
  }

  return parts.length ? parts.join("\n\n") : null;
}
