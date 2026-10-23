/** Content fingerprints for in-memory caches and baked tables (#72). */

/** Four independent 32-bit multiplicative hashes (128 bits) of the JSON text, plus its length. Pure integer
 * arithmetic, so the value is identical in every JS engine. Not a security boundary: it only decides whether
 * a snapshot or a baked table was made from the same inputs. */
export function contentKey(...values: unknown[]): string {
  const text = JSON.stringify(values);
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57, g1 = 0x9e3779b9, g2 = 0x85ebca6b;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
    g1 = Math.imul(g1 ^ c, 1103515245) + 12345 | 0; g2 = Math.imul(g2 ^ c, 2246822519);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  g1 = Math.imul(g1 ^ (g1 >>> 16), 2246822507) ^ Math.imul(g2 ^ (g2 >>> 13), 3266489909);
  g2 = Math.imul(g2 ^ (g2 >>> 16), 2246822507) ^ Math.imul(g1 ^ (g1 >>> 13), 3266489909);
  return `${text.length}:${(h2 >>> 0).toString(16)}${(h1 >>> 0).toString(16)}${(g2 >>> 0).toString(16)}${(g1 >>> 0).toString(16)}`;
}
