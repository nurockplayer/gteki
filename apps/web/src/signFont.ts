import fontUrl from "./fonts/GTEkiSignJP-subset.woff2?url";

export const SIGN_FONT_FAMILY = "GTEki Sign JP";
export const SIGN_FONT_TIMEOUT_MS = 5000;
let pending: Promise<void> | undefined;

/** One load for both quality tiers, before scene canvases are painted. Failure
 * is cached too: don't delay every station switch or repeatedly log a warning. */
export function loadSignFont(): Promise<void> {
  if (typeof document === "undefined") return Promise.resolve();
  return pending ??= register();
}

async function register(): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let face: FontFace | undefined;
  try {
    if (typeof FontFace === "undefined" || !document.fonts) throw new Error("FontFace API unavailable");
    face = new FontFace(SIGN_FONT_FAMILY, `url("${fontUrl}") format("woff2")`, { weight: "500 800", style: "normal", display: "swap" });
    await Promise.race([
      face.load(),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Sign font load timed out")), SIGN_FONT_TIMEOUT_MS); }),
    ]);
    // A late download after timeout must not change the font halfway through
    // subsequent atlas generation.
    document.fonts.add(face);
  } catch (error) {
    if (face && document.fonts) document.fonts.delete(face);
    console.warn("[gteki] sign font unavailable; using system font stack", error);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
