// ?dpr=<n> lowers the pixel ratio for QA runs (#1392); the 1.5 cap stays the default (#42).
export function pixelRatioCap(params: URLSearchParams): number {
  const n = Number(params.get("dpr"));
  return params.has("dpr") && Number.isFinite(n) && n > 0 ? Math.min(1.5, Math.max(0.5, n)) : 1.5;
}
