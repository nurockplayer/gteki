import type { Poi, StationBundle } from "@gteki/schema";
import { pick, type Lang, type Strings } from "../i18n.ts";

/**
 * An exit reached at the foot of its stairs (its connector is a `stair_end`): the label says so, because the
 * street level is above the connector. Only the connector kind the data records is used.
 */
function isStairFoot(bundle: StationBundle, poi: Poi): boolean {
  return poi.category === "exit" && poi.connectorNodeIds.some((id) => bundle.nodes.find((n) => n.id === id)?.kind === "stair_end");
}

/** A POI's label, with the stair-foot fact for such an exit (#203 B11). */
export function poiLabel(bundle: StationBundle, poi: Poi, lang: Lang, t: Strings): string {
  const name = pick(poi.names, lang) || t.unnamedPoint;
  return isStairFoot(bundle, poi) ? t.stairFootLabel(name) : name;
}

/**
 * A node's label: the POI reached from it, else a generic localized one. A raw graph id (`c_e1`) is never a
 * label — it names nothing a traveller could recognise (#203 B11).
 */
export function nodeLabel(bundle: StationBundle, nodeId: string, lang: Lang, t: Strings): string {
  const poi = bundle.pois.find((p) => p.connectorNodeIds.includes(nodeId));
  return poi ? poiLabel(bundle, poi, lang, t) : t.unnamedPoint;
}
