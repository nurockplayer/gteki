/** Plain snapshot data with sparse tables for the structure JSON cannot preserve (#1317). */
type Slot = [number, string];
type Reference = [number, string, number];
interface Packed {
  value: unknown;
  references: Reference[];
  undefineds: Slot[];
  negativeZeros: Slot[];
  maps: Reference[];
}

export function encodeLayoutSnapshot(snapshot: unknown): string {
  const seen = new Map<object, number>();
  const references: Reference[] = [], undefineds: Slot[] = [], negativeZeros: Slot[] = [], maps: Reference[] = [];
  const visit = (value: unknown, parent: number, key: string): unknown => {
    if (value === undefined) { undefineds.push([parent, key]); return null; }
    if (Object.is(value, -0)) { negativeZeros.push([parent, key]); return 0; }
    if (value === null || typeof value !== "object") return value;
    const previous = seen.get(value);
    if (previous !== undefined) { references.push([parent, key, previous]); return null; }
    const id = seen.size;
    seen.set(value, id);
    const input = value instanceof Map ? [...value] : value;
    if (value instanceof Map) maps.push([parent, key, id]);
    // Keep every property in its original position, including explicit undefined slots.
    return Array.isArray(input)
      ? input.map((child, i) => visit(child, id, String(i)))
      : Object.fromEntries(Object.entries(input).map(([k, child]) => [k, visit(child, id, k)]));
  };
  const value = visit(snapshot, -1, "");
  return JSON.stringify({ value, references, undefineds, negativeZeros, maps } satisfies Packed);
}

export function decodeLayoutSnapshot<T>(text: string): T {
  const packed = JSON.parse(text) as Packed;
  const nodes: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (value === null || typeof value !== "object") return;
    nodes.push(value as Record<string, unknown>);
    for (const child of Object.values(value)) visit(child);
  };
  visit(packed.value);
  for (const [id, key] of packed.undefineds) nodes[id]![key] = undefined;
  for (const [id, key] of packed.negativeZeros) nodes[id]![key] = -0;
  const entries = packed.maps.map(([, , id]) => nodes[id] as unknown as [unknown, unknown][]);
  for (const [, , id] of packed.maps) nodes[id] = new Map() as unknown as Record<string, unknown>;
  for (const [parent, key, id] of packed.maps) if (parent >= 0) nodes[parent]![key] = nodes[id];
  for (const [parent, key, id] of packed.references) nodes[parent]![key] = nodes[id];
  packed.maps.forEach(([, , id], i) => {
    const map = nodes[id] as unknown as Map<unknown, unknown>;
    for (const [key, value] of entries[i]!) map.set(key, value);
  });
  return nodes[0] as T;
}
