/** A deliberately separate, demo-only rail layer. It must never alter pedestrian graph truth. */
export type RailStationKey = "ikebukuro" | "shinjuku";

export interface RailDemoLink {
  readonly from: RailStationKey;
  readonly to: RailStationKey;
  readonly lineId: "jr-saikyo";
  readonly lineJa: "JR 埼京線";
  readonly platformJa: string;
}

/**
 * First cross-station journey. No promise that either current 3D station scene
 * includes a surveyed JR platform (Shinjuku's existing animated train is Toei Oedo).
 */
const LINKS: Record<RailStationKey, RailDemoLink> = {
  ikebukuro: {
    from: "ikebukuro", to: "shinjuku", lineId: "jr-saikyo",
    lineJa: "JR 埼京線", platformJa: "JR 池袋駅 1 番線（新宿方面）",
  },
  shinjuku: {
    from: "shinjuku", to: "ikebukuro", lineId: "jr-saikyo",
    lineJa: "JR 埼京線", platformJa: "JR 新宿駅 1–4 番線（列車により異なる）",
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
