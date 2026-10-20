export type BboxLocal = [number, number, number, number];

/** Validate at the API boundary as well as the CLI; never coerce blank coordinates. */
export function assertBboxLocal(value: unknown): asserts value is BboxLocal {
  if (!Array.isArray(value) || value.length !== 4 || !value.every(v => typeof v === 'number' && Number.isFinite(v)))
    throw new Error('bboxLocal requires exactly four finite numeric coordinates');
  if (value[0] > value[2] || value[1] > value[3]) throw new Error('bboxLocal minimum must not exceed maximum');
}

export function parseBboxLocal(value: string): BboxLocal {
  const tokens = value.split(',');
  if (tokens.length !== 4 || tokens.some(token => token.trim() === ''))
    throw new Error('--bbox-local requires exactly four nonblank finite coordinates');
  const result = tokens.map(Number);
  assertBboxLocal(result);
  return result;
}
