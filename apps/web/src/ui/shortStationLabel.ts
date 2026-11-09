export function shortStationLabel(label: string): string {
  return label.split(/\s+—\s+|\s+·\s+|\s+\(|（|\s+\(/u, 1)[0]!;
}
