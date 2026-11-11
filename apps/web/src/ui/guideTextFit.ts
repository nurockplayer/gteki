/** Whether the measured text occupies more than the allowed number of lines. */
export function needsCompact(lineHeightPx: number, scrollHeightPx: number, maxLines: number): boolean {
  return scrollHeightPx > lineHeightPx * maxLines + 1;
}
