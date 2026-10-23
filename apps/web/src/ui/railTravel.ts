/** A deliberately separate, demo-only rail layer. It must never alter pedestrian graph truth. */
export type RailStationKey = "ikebukuro" | "shinjuku";

export interface RailDemoLink {
  readonly from: RailStationKey;
  readonly to: RailStationKey;
  readonly lineId: "jr-saikyo";
  readonly lineJa: "JR 埼京線";
  /** Platform numbers are JR East's published information, not a survey of this scene; say so in both languages. */
  readonly platformJa: string;
  readonly platformEn: string;
}

/**
 * First cross-station journey. No promise that either current 3D station scene
 * includes a surveyed JR platform (Shinjuku's existing animated train is Toei Oedo).
 * Platform numbers come from JR East's published station pages, cited in #235
 * (https://www.jreast.co.jp/estation/stations/108.html and .../866.html); neither station's
 * platform has been surveyed on site, so every label says so in both languages.
 */
const LINKS: Record<RailStationKey, RailDemoLink> = {
  ikebukuro: {
    from: "ikebukuro", to: "shinjuku", lineId: "jr-saikyo",
    lineJa: "JR 埼京線",
    platformJa: "JR 池袋駅 1 番線（新宿方面）、JR 東日本公表（未調査）",
    platformEn: "JR Ikebukuro Station platform 1 (toward Shinjuku), per JR East, not surveyed",
  },
  shinjuku: {
    from: "shinjuku", to: "ikebukuro", lineId: "jr-saikyo",
    lineJa: "JR 埼京線",
    platformJa: "JR 新宿駅 1–4 番線（列車により異なる）、JR 東日本公表（未調査）",
    platformEn: "JR Shinjuku Station platforms 1–4 (varies by train), per JR East, not surveyed",
  },
};

export function railDemoLink(stationKey: string): RailDemoLink | null {
  if (stationKey !== "ikebukuro" && stationKey !== "shinjuku") return null;
  return LINKS[stationKey];
}

export function railStationName(station: RailStationKey, lang: "ja" | "en"): string {
  return lang === "ja"
    ? (station === "ikebukuro" ? "池袋" : "新宿")
    : (station === "ikebukuro" ? "Ikebukuro" : "Shinjuku");
}
