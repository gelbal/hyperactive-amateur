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

export function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

export function abortError(): DOMException {
  return new DOMException("Aborted", "AbortError");
}

// Race a promise against an AbortSignal. The Gemini SDK doesn't accept
// signals natively, so this is "soft cancel": the in-flight HTTP request
// may complete, but its resolved value is discarded as soon as the signal
// fires. The try/finally guarantees the abort listener is removed even
// if the racer rejects with our own abort error.
export async function runWithSignal<T>(
  promise: Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) throw abortError();
  let onAbort: (() => void) | undefined;
  const abortPromise = new Promise<never>((_, reject) => {
    onAbort = () => reject(abortError());
    signal.addEventListener("abort", onAbort);
  });
  try {
    return await Promise.race([promise, abortPromise]);
  } finally {
    if (onAbort) signal.removeEventListener("abort", onAbort);
  }
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
