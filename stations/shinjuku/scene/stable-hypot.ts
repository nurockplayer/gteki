/**
 * V8's hypot, portable: scale by the largest magnitude, Kahan-sum the squares, `Math.sqrt`,
 * rescale. The arithmetic is exactly rounded by the spec. `Math.sqrt` is implementation-approximated
 * there, but engines use the correctly rounded IEEE operation, so every engine returns the bytes V8
 * returns (#1012).
 *
 * The engine's own hypot is not correctly rounded and differs by an ulp between V8 and
 * JavaScriptCore. On a 2.800 m design width that ulp decides 7 pieces or 8, which moves the
 * Shinjuku stairwell fascia by up to 0.29 m on WebKit; the committed stairwell recipes are baked
 * from V8, so the mesh key rejects them there and WebKit falls back to the live cut.
 *
 * Edge cases follow V8 13.6 as measured: an infinity wins over a NaN, a NaN with no infinity is
 * NaN, and a zero maximum (including -0) is +0.
 */
export function stableHypot(a: number, b: number, c?: number): number {
  // Written out, not over a rest array: scene builds call this millions of times, and the array made it 6x slower than the engine's hypot.
  const x = Math.abs(a), y = Math.abs(b), z = c === undefined ? 0 : Math.abs(c);
  if (x === Infinity || y === Infinity || z === Infinity) return Infinity;
  if (x !== x || y !== y || z !== z) return NaN;
  const max = x > y ? (x > z ? x : z) : (y > z ? y : z);
  if (max === 0) return 0;
  const rx = x / max, ry = y / max;
  const sumX = rx * rx, sy = ry * ry, sum = sumX + sy;
  if (c === undefined) return Math.sqrt(sum) * max;
  const comp = (sum - sumX) - sy, rz = z / max;
  return Math.sqrt(sum + (rz * rz - comp)) * max;
}
