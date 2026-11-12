export function shortStationLabel(label: string, lang: "ja" | "en"): string {
  const parts = label.split(" · ");
  if (parts.length > 1) {
    return lang === "ja"
      ? parts[0]!.replace(/（.*$/u, "").replace(/\s+\(.*$/u, "")
      : parts.slice(1).join(" · ").replace(/\s+\(.*$/u, "");
  }
  return label.split(/\s+—\s+|\s+·\s+|\s+\(|（|\s+\(/u, 1)[0]!;
}
