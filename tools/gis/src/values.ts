/** Read data-derived keys without consulting an object's prototype. */
export function ownValue<T>(record: Record<string,T> | null | undefined, key: string): T | undefined {
  return record !== null && typeof record === 'object' && Object.hasOwn(record,key) ? record[key] : undefined;
}

/** Decimal syntax only: no boolean, container, hexadecimal or blank coercion. */
export function decimalNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim())) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** Preserve literal scalar text; containers and booleans carry no coded value. */
export function literalText(value: unknown): string | null {
  if (typeof value === 'string') return value.trim() === '' ? null : value;
  return typeof value === 'number' && Number.isFinite(value) ? String(value) : null;
}

export function literalIdentifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isInteger(value) && !Number.isSafeInteger(value)) return null;
  return literalText(value);
}
