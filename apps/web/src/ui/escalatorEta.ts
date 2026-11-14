export function escalatorEtaSuffix(remainingSeconds: number): string {
  if (remainingSeconds < 3) return "";
  return ` · ~${Math.max(5, Math.round(remainingSeconds / 5) * 5)} s`;
}
