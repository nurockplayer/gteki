import type { BuildScene, SceneContext, StationScene } from "@gteki/scene-api";
import type { Edge, Node, Poi, StationBundle } from "@gteki/schema";
import type { Camera } from "three";

type Position = [number, number, number];
interface RailLane {
  line: { ja: string; en: string };
  operator: string;
  lineCode: string;
  status: "evidence" | "representative" | "sourced";
  levels: { id: string; label: string; z_m: number; source: string }[];
  gates: { id: string; poiId?: string; side: "public" | "paid"; level?: string; position: Position | null; source: string }[];
  platforms: { id: string; number: number | string | null; track: number | string | null; services: string[]; level: string; centerline: [[number, number], [number, number]] | null; width_m: number | null; length_m: number | null; source: string }[];
  waypoints?: { id: string; level: string; position: Position; source: string }[];
  connectors: { from: string; to: string; kind: "walk" | "stairs" | "escalator" | "lift" | "gate"; via?: Position[]; source: string }[];
  sources: { id: string; url?: string; path?: string; read_date: string; terms_ref: string }[];
  gaps: string[];
}

type RailGeometry = Pick<StationScene, "root" | "walkable" | "colliders" | "cameraBlockers" | "dispose">;
type BuildRailGeometry = (ctx: SceneContext) => RailGeometry;

const lanes = import.meta.glob<RailLane>("../data/rail/*.json", { eager: true, import: "default" });
const builders = import.meta.glob<BuildRailGeometry>(["./rail/*.ts", "!./rail/*.test.ts"], { import: "default" });
const entries = Object.entries(lanes).map(([path, lane]) => {
  const name = path.slice("../data/rail/".length, -".json".length);
  return { lane, name, build: builders[`./rail/${name}.ts`] };
});
const edgeId = (name: string, from: string, to: string) => `rail:${name}:${from}__${to}`;

/** Merge the preview before search and routing. Positions on evidence-only rows may be absent. */
export function railBundle(bundle: StationBundle): StationBundle {
  const floors = new Map(bundle.floors.map(floor => [floor.id, floor]));
  const nodes = new Map(bundle.nodes.map(node => [node.id, node]));
  const pois = new Map(bundle.pois.map(poi => [poi.id, poi]));
  const sources = new Map(bundle.sources.map(source => [source.id, source]));
  const edges = [...bundle.edges];

  for (const { lane, name, build } of entries) {
    if (!build) continue;
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
        if (poi && gate.side === "public") pois.set(poi.id, { ...poi, floorId: level, displayPosition: node.position, connectorNodeIds: [node.id] });
      }
    }
    for (const point of lane.waypoints ?? []) place(point.id, point.level, point.position, "junction", point.source);
    for (const platform of lane.platforms) {
      if (!platform.centerline) continue;
      const [[ax, ay], [bx, by]] = platform.centerline;
      const floor = floors.get(platform.level)!;
      const node = place(platform.id, floor.id, [(ax + bx) / 2, (ay + by) / 2, floor.renderElevationM], "platform", platform.source);
      const names: Poi["names"] = platform.number === null
        ? [{ lang: "ja", text: `${lane.line.ja} ホーム` }, { lang: "en", text: `${lane.line.en} platform` }]
        : [{ lang: "ja", text: `${lane.line.ja} ${platform.number}番線` }, { lang: "en", text: `${lane.line.en} platform ${platform.number}` }];
      const previous = pois.get(platform.id);
      pois.set(platform.id, {
        id: platform.id, category: "platform", names, aliases: [{ lang: "en", text: lane.lineCode }],
        ...previous, floorId: floor.id, displayPosition: node.position, connectorNodeIds: [node.id], paid: true,
        evidence: evidence(platform.source),
        ...(lane.status === "representative" ? { notes: [
          { lang: "ja", text: "ホームと改札内通路はプレビュー用の参考配置です。" },
          { lang: "en", text: "Illustrative platform and paid access layout." },
        ] } : {}),
      });
    }
    for (const connector of lane.connectors) {
      const from = nodes.get(aliases.get(connector.from) ?? connector.from);
      const to = nodes.get(aliases.get(connector.to) ?? connector.to);
      if (!from || !to) continue;
      const mode = connector.kind === "lift" ? "elevator" : connector.kind;
      const source = evidence(connector.source);
      const geometry = [from.position, ...(connector.via ?? []).map(([x, y, z]) => ({ x, y, z })), to.position];
      let lengthM = 0;
      for (let i = 1; i < geometry.length; i++) {
        const a = geometry[i - 1]!, b = geometry[i]!;
        lengthM += Math.hypot(b.x - a.x, b.y - a.y, b.z! - a.z!);
      }
      edges.push({
        id: edgeId(name, from.id, to.id), from: from.id, to: to.id, direction: "both", mode,
        lengthM, geometry, paid: true, crossesFareBoundary: mode === "gate",
        steps: mode === "stairs" || mode === "escalator", wheelchair: mode === "stairs" || mode === "escalator" ? false : null,
        hours: null, closed: false, verification: "verified", geometryEvidence: source, accessEvidence: source,
      });
    }
  }
  return { ...bundle, floors: [...floors.values()], nodes: [...nodes.values()], edges, pois: [...pois.values()], sources: [...sources.values()] };
}

/** Load each lane's geometry once its public gate or platform is within approach distance. */
export async function buildRailScene(ctx: SceneContext, base: BuildScene): Promise<StationScene> {
  const scene = await base(ctx);
  const lazyEdgeIds = new Set(ctx.bundle.edges.filter(edge => edge.id.startsWith("rail:")).map(edge => edge.id));
  const slices = entries.flatMap(({ name, build }) => {
    if (!build) return [];
    const nodeIds = new Set(ctx.bundle.edges.filter(edge => edge.id.startsWith(`rail:${name}:`)).flatMap(edge => [edge.from, edge.to]));
    const anchors = ctx.bundle.nodes.filter(node => nodeIds.has(node.id))
      .map(node => new ctx.THREE.Vector3(...ctx.enuToRenderer({ ...node.position, z: node.position.z! })));
    return [{ anchors, build, geometry: null as RailGeometry | null, started: false }];
  });
  const focus = new ctx.THREE.Vector3();
  let disposed = false;
  return {
    ...scene,
    lazyEdgeIds,
    update(dt: number, elapsed: number, camera?: Camera) {
      scene.update?.(dt, elapsed, camera);
      if (!camera) return;
      camera.getWorldPosition(focus);
      for (const slice of slices) {
        if (slice.started || !slice.anchors.some(anchor => anchor.distanceToSquared(focus) < 12 ** 2)) continue;
        slice.started = true;
        void slice.build().then(build => {
          if (disposed) return;
          const geometry = slice.geometry = build(ctx);
          scene.root.add(geometry.root);
          geometry.root.updateMatrixWorld(true);
          ctx.addCollision?.(geometry);
        });
      }
    },
    dispose() {
      disposed = true;
      for (const slice of slices) slice.geometry?.dispose();
      scene.dispose();
    },
  };
}
