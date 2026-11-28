import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import { discoverRailLanes, mountRailChunks, type RailBuilder, type RailLane } from "@gteki/scene-api/rail-registry";
import type { Edge, Node, Poi, StationBundle } from "@gteki/schema";

type Position = [number, number, number];
type IkebukuroRailLane = RailLane & {
  serviceNames?: Record<string, RailLane["line"]>;
  platforms: (RailLane["platforms"][number] & { arrival?: [number, number] })[];
  connectors: (RailLane["connectors"][number] & { paid?: boolean; deferredScene?: boolean })[];
};

const lanes = import.meta.glob<RailLane>("../data/rail/*.json", { eager: true, import: "default" });
const builders = import.meta.glob<RailBuilder>(["./rail/*.ts", "!./rail/*.test.ts"], { import: "default" });
const entries = discoverRailLanes(lanes, builders);
const edgeId = (name: string, from: string, to: string) => `rail:${name}:${from}__${to}`;

/** Merge the preview before search and routing. Positions on evidence-only rows may be absent. */
export function railBundle(bundle: StationBundle): StationBundle {
  const floors = new Map(bundle.floors.map(floor => [floor.id, floor]));
  const nodes = new Map(bundle.nodes.map(node => [node.id, node]));
  const pois = new Map(bundle.pois.map(poi => [poi.id, poi]));
  const sources = new Map(bundle.sources.map(source => [source.id, source]));
  const edges = [...bundle.edges];

  for (const { lane, prefix, load } of entries) {
    if (!load) continue;
    const { serviceNames, platforms, connectors } = lane as IkebukuroRailLane;
    const evidence = (id: string) => ({
      sourceIds: [id],
      method: `Ikebukuro rail preview (${lane.status})`,
      checkedDate: lane.sources.find(source => source.id === id)!.read_date.slice(0, 10),
    });
    for (const source of lane.sources) {
      if (sources.has(source.id)) continue;
      sources.set(source.id, {
        id: source.id, title: source.id, publisher: source.path ? "GTEki" : lane.operator,
        url: source.url ?? `https://github.com/nurockplayer/gteki/blob/main/${source.path}`,
        license: null, rights: "REFERENCE_ONLY", attribution: source.id, modified: false,
        retrievedAt: source.read_date.slice(0, 10), datasetDate: null, notes: source.terms_ref,
      });
    }
    for (const level of lane.levels) {
      if (floors.has(level.id)) continue;
      floors.set(level.id, {
        id: level.id, operatorId: lane.operator, sourceLabels: [], ordinal: null, intermediate: false,
        elevationM: null, elevationSource: "unknown", renderElevationM: level.z_m,
        displayNames: [{ lang: "ja", text: level.label }, { lang: "en", text: level.label }],
      });
    }
    const aliases = new Map<string, string>();
    const place = (id: string, floorId: string, [x, y, z]: Position, kind: Node["kind"], sourceId: string) => {
      const node: Node = { id, floorId, position: { x, y, z }, kind, inOut: "inside", sourceRefs: [{ sourceId, featureId: id }] };
      nodes.set(id, node);
      return node;
    };
    for (const gate of lane.gates) {
      const poi = gate.poiId ? pois.get(gate.poiId) : undefined;
      const existing = poi?.connectorNodeIds[0];
      if (gate.side === "public" && existing) {
        aliases.set(gate.id, existing);
      } else if (gate.position) {
        const level = gate.level ?? lane.levels.find(level => level.z_m === gate.position![2])!.id;
        const node = place(gate.id, level, gate.position, "ticket_gate", gate.source);
        if (poi && gate.side === "public") pois.set(poi.id, {
          ...poi, floorId: level, displayPosition: node.position, connectorNodeIds: [node.id],
          evidence: evidence(gate.source), notes: [
            { lang: "ja", text: "改札の位置はプレビュー用の参考配置です。" },
            { lang: "en", text: "Illustrative fare gate placement." },
          ],
        });
      }
    }
    for (const point of lane.waypoints ?? []) place(point.id, point.level, point.position, "junction", point.source);
    for (const platform of platforms) {
      if (!platform.centerline) continue;
      const [[ax, ay], [bx, by]] = platform.centerline;
      const floor = floors.get(platform.level)!;
      const [x, y] = platform.arrival ?? [(ax + bx) / 2, (ay + by) / 2];
      const node = place(platform.id, floor.id, [x, y, floor.renderElevationM], "platform", platform.source);
      const line = serviceNames?.[platform.services[0]!] ?? lane.line;
      const names: Poi["names"] = platform.number === null
        ? [{ lang: "ja", text: `${line.ja} ホーム` }, { lang: "en", text: `${line.en} platform` }]
        : [{ lang: "ja", text: `${line.ja} ${platform.number}番線` }, { lang: "en", text: `${line.en} platform ${platform.number}` }];
      const previous = pois.get(platform.id);
      pois.set(platform.id, {
        id: platform.id, category: "platform", names,
        aliases: [...new Set([lane.lineCode, ...platform.services])].map(text => ({ lang: "en", text })),
        ...previous, floorId: floor.id, displayPosition: node.position, connectorNodeIds: [node.id], paid: true,
        evidence: evidence(platform.source),
        ...(lane.status === "representative" ? { notes: [
          { lang: "ja", text: "ホームと改札内通路はプレビュー用の参考配置です。" },
          { lang: "en", text: "Illustrative platform and paid access layout." },
        ] } : {}),
      });
    }
    for (const connector of connectors) {
      const from = nodes.get(aliases.get(connector.from) ?? connector.from);
      const to = nodes.get(aliases.get(connector.to) ?? connector.to);
      if (!from || !to) continue;
      const mode = connector.kind === "lift" ? "elevator" : connector.kind;
      const steps = mode === "stairs" || mode === "escalator";
      const source = evidence(connector.source);
      const geometry = [from.position, ...(connector.via ?? []).map(([x, y, z]) => ({ x, y, z })), to.position];
      let lengthM = 0;
      for (let i = 1; i < geometry.length; i++) {
        const a = geometry[i - 1]!, b = geometry[i]!;
        lengthM += Math.hypot(b.x - a.x, b.y - a.y, b.z! - a.z!);
      }
      edges.push({
        id: edgeId(prefix, from.id, to.id), from: from.id, to: to.id, direction: "both", mode,
        lengthM, geometry, paid: connector.paid ?? true, crossesFareBoundary: mode === "gate",
        steps, wheelchair: steps ? false : prefix === "jr" ? true : null,
        hours: null, closed: false, verification: "verified", geometryEvidence: source, accessEvidence: source,
        attributes: { deferredScene: connector.deferredScene ?? true },
      });
    }
  }
  return { ...bundle, floors: [...floors.values()], nodes: [...nodes.values()], edges, pois: [...pois.values()], sources: [...sources.values()] };
}

/** Load each lane's geometry once its public gate or platform is within approach distance. */
export async function buildRailScene(ctx: SceneContext, base: BuildScene): Promise<StationScene> {
  const scene = await base(ctx);
  // The public corridor generator omits end walls where it meets existing floor.
  const northGate = ctx.bundle.nodes.find(node => node.id === "jr-north-public")!.position;
  const { THREE } = ctx;
  const seam = new THREE.Mesh(new THREE.BoxGeometry(3, 0.16, 2.6), new THREE.MeshBasicMaterial({ color: 0xb6b1a2 }));
  seam.position.set(...ctx.enuToRenderer({ ...northGate, z: northGate.z! - 0.08 }));
  scene.root.add(seam);
  scene.walkable.push(seam);
  const queued = entries.flatMap(({ lane, prefix, load }) => {
    if (!load) return [];
    const nodeIds = new Set(ctx.bundle.edges.filter(edge => edge.id.startsWith(`rail:${prefix}:`)).flatMap(edge => [edge.from, edge.to]));
    const anchors = ctx.bundle.nodes.filter(node => nodeIds.has(node.id))
      .map(node => new ctx.THREE.Vector3(...ctx.enuToRenderer({ ...node.position, z: node.position.z! })));
    return [{ anchors, lane, load }];
  });
  const mounted = mountRailChunks(ctx, scene, queued, 12);
  return {
    ...mounted,
    dispose() {
      seam.geometry.dispose();
      seam.material.dispose();
      mounted.dispose();
    },
  };
}
