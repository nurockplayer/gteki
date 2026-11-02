import { routeBetween, type RouteEndpoint, type Router } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import { searchKey, type SearchHit, type SearchIndex } from "@gteki/search";
import type { Lang } from "../i18n.ts";

export function isAccessibleToilet(poi: Poi): boolean {
  return poi.category === "toilet" && poi.names.some(({ text }) => /車いす|多機能|多目的|バリアフリー|accessible/i.test(text));
}

/** Search-only facilities remain visible; missing coordinates never become invented distances. */
export function barrierFreeResults(bundle: StationBundle, search: SearchIndex, router: Router | null,
  origin: RouteEndpoint | null, query: string, lang: Lang) {
  const nodes = new Map(bundle.nodes.map((node) => [node.id, node]));
  const positions = (poi: Poi) => poi.displayPosition ? [poi.displayPosition]
    : poi.connectorNodeIds.flatMap((id) => nodes.get(id) ? [nodes.get(id)!.position] : []);
  const starts = !origin ? [] : origin.kind === "poi" ? positions(origin.poi)
    : nodes.get(origin.nodeId) ? [nodes.get(origin.nodeId)!.position] : [];
  // Printed gate/exit names put the operator or line before a space; match the core name too.
  const gateKeys = origin?.kind === "poi" && ["ticket_gate", "exit"].includes(origin.poi.category)
    ? origin.poi.names.filter((name) => name.lang === "ja")
      .flatMap(({ text }) => [searchKey(text), searchKey(text.trim().replace(/^.*\s/u, ""))]).filter(Boolean)
    : [];
  const candidates: SearchHit[] = query
    ? search.search(query, { categories: ["elevator", "escalator", "toilet"], limit: bundle.pois.length, lang })
    : bundle.pois.map((poi) => ({ poi, score: 0, matched: "", routable: poi.connectorNodeIds.length > 0 }));
  return candidates.filter(({ poi }) => poi.category === "elevator" || poi.category === "escalator" || isAccessibleToilet(poi))
    .map((hit) => {
      const distances = starts.flatMap((start) => positions(hit.poi).map((end) => Math.hypot(end.x - start.x, end.y - start.y)));
      let distanceM = distances.length ? Math.min(...distances) : null;
      let distanceKind: "route" | "straight" = "straight";
      if (router && origin && hit.routable) {
        const route = routeBetween(router, origin, hit.poi, { fare: "ticketed", stepFree: true });
        if (route.ok || route.reason === "start_equals_goal") {
          distanceM = route.ok ? route.totalLengthM : 0;
          distanceKind = "route";
        }
      }
      const connectsToGate = hit.poi.names.some(({ lang, text }) => lang === "ja" &&
        gateKeys.some((key) => searchKey(text).includes(key)));
      return { ...hit, distanceM, distanceKind, connectsToGate };
    })
    .sort((a, b) => Number(b.routable) - Number(a.routable) ||
      (a.distanceM ?? Infinity) - (b.distanceM ?? Infinity) ||
      (a.distanceM === null && b.distanceM === null ? Number(b.connectsToGate) - Number(a.connectsToGate) : 0))
    .slice(0, 20);
}
