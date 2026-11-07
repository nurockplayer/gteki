/**
 * V8's hypot, portable: scale by the largest magnitude, Kahan-sum the squares, `Math.sqrt`,
 * rescale. Every step is IEEE-exact apart from the final `sqrt`, which the spec pins, so every
 * engine returns the bytes V8 returns (#1012).
 *
 * The engine's own hypot is not correctly rounded and differs by an ulp between V8 and
 * JavaScriptCore. On a 2.800 m design width that ulp decides 7 pieces or 8, which moves the
 * Shinjuku stairwell fascia by up to 0.29 m on WebKit; the committed stairwell recipes are baked
 * from V8, so replay then applies V8's cut to geometry half a metre away.
 *
 * Edge cases follow V8 13.6 as measured: an infinity wins over a NaN, a NaN with no infinity is
 * NaN, and a zero maximum (including -0) is +0.
 */
export function stableHypot(...values: number[]): number {
  let max = 0;
  let nan = false;
  const abs = values.map((v) => {
    const n = Math.abs(v);
    if (Number.isNaN(n)) nan = true;
    else if (n > max) max = n;
    return n;
  });
  if (max === Infinity) return Infinity;
  if (nan) return NaN;
  if (max === 0) return 0;
  let sum = 0;
  let comp = 0;
  for (const n of abs) {
    const r = n / max, s = r * r - comp, p = sum + s;
    comp = (p - sum) - s;
    sum = p;
  }
  return Math.sqrt(sum) * max;
}
