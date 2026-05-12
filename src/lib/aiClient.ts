// ABOUTME: aiClient — shared helpers for the Gemini-backed AI surfaces (autotag, batch, suggest).
// ABOUTME: Owns blob→base64, error-message extraction, and the tag-definitions block reused across prompts.

export async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsDataURL(blob);
  });
}

export function errMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// Single source of truth for the tag-definitions text used in both the
// per-clip and holistic classification prompts. Keeping these aligned avoids
// silent drift between the two paths.
export const TAG_DEFINITIONS_BLOCK =
  "- kick: low-frequency thump or boom (mouth, chest hit, sub bass)\n" +
  "- snare: mid-frequency crack or slap (claps, tongue pops, table hits with brightness)\n" +
  "- hat: high-frequency tick or hiss (ts, sh, finger snaps)\n" +
  "- vocal: any voiced sound, word, syllable, or extended tone (yeah, uh, hm, sung note)\n" +
  "- fx: anything else or ambiguous (whooshes, weird noises, breaths)";
