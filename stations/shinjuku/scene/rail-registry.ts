import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { Edge, EvidenceRef, Node, Poi, StationBundle } from "@gteki/schema";
import { stableHypot } from "./stable-hypot.ts";

type XY = [number, number];
type XYZ = [number, number, number];
type Names = { ja: string; en: string };

export interface RailLane {
  line: Names;
  operator: string;
  lineCode: string;
  status: "evidence" | "representative" | "sourced";
  levels: { id: string; label: string; z_m: number; source: string }[];
  gates: { id: string; poiId?: string | null; side: "public" | "paid"; position: XYZ | null; source: string }[];
  platforms: { id: string; poiId?: string; number: number | string; track: number | string; services: string[]; level: string; centerline: [XY, XY] | null; width_m: number; length_m: number; source: string }[];
  paidConcourseNodes?: { id: string; level: string; position: XY }[];
  connectors: { from: string; to: string; kind: "walk" | "stairs" | "escalator" | "lift" | "gate"; source: string }[];
  openings?: { position: XYZ; along: XY; width_m: number; depth_m: number; height_m: number }[];
  sources: { id: string; url?: string; path?: string; read_date: string; terms_ref: string }[];
  gaps: string[];
}

const B1 = "toei-nwd-m1";
const laneFiles = import.meta.glob<RailLane>("../data/rail/*.json", { eager: true, import: "default" });
const sceneFiles = import.meta.glob<(ctx: SceneContext, lane: RailLane) => StationScene | Promise<StationScene>>("./rail/*.ts", { import: "default" });
const lanes = Object.entries(laneFiles).map(([path, lane]) => ({
  prefix: path.slice(path.lastIndexOf("/") + 1, -5),
  lane,
}));

const names = (text: Names) => [{ lang: "ja", text: text.ja }, { lang: "en", text: text.en }];
const previewNote = names({ ja: "プレビュー用の参考経路です。実際の場所や通行を確認したものではありません。", en: "Representative preview. Placement and access have not been surveyed." });

/** Compose navigation before search/router creation, independent of the E27 plan and mesh bake. */
export function mergeRailBundle(bundle: StationBundle): StationBundle {
  const nodes = [...bundle.nodes], edges = [...bundle.edges], floors = [...bundle.floors];
  const pois = new Map(bundle.pois.map(poi => [poi.id, poi]));
  const publicNodes = new Set(bundle.edges.filter(edge => edge.mode === "walk" && edge.paid === false && edge.crossesFareBoundary === false)
    .flatMap(edge => [edge.from, edge.to]));
  const concourse = bundle.nodes.filter(node => node.floorId === B1 && publicNodes.has(node.id));
  for (const { prefix, lane } of lanes) {
    const id = (local: string) => `rail:${prefix}:${local}`;
    const deferred = sceneFiles[`./rail/${prefix}.ts`] !== undefined;
    const levelId = (level: string) => level === B1 ? B1 : id(level);
    const evidence = (sourceId: string): EvidenceRef => ({
      sourceIds: bundle.sources.some(source => source.id === sourceId) ? [sourceId] : [],
      method: `${lane.status} game preview: ${prefix} / ${sourceId}`,
      checkedDate: lane.sources.find(source => source.id === sourceId)!.read_date.slice(0, 10),
    });
    const positions = new Map<string, Node | null>();
    const paid = new Map<string, boolean>();
    const add = (local: string, kind: "ticket_gate" | "platform", floorId: string, point: XYZ | null, isPaid: boolean, source: string, label: Names, poiId = id(local)) => {
      positions.set(local, null);
      if (!point) return;
      const [x, y, z] = point;
      const node: Node = { id: id(local), floorId, position: { x, y, z: null }, renderZ: z, kind, inOut: "inside", sourceRefs: [] };
      nodes.push(node);
      positions.set(local, node);
      paid.set(node.id, isPaid);
      if (kind === "ticket_gate" && isPaid && poiId === id(local)) return;
      const existing = pois.get(poiId);
      const localized = existing?.names ?? [];
      const poi: Poi = { id: poiId, category: kind, aliases: [], ...existing,
        names: [...localized, ...names(label).filter(name => !localized.some(item => item.lang === name.lang))],
        floorId, displayPosition: node.position, connectorNodeIds: [...(existing?.connectorNodeIds ?? []), node.id],
        paid: isPaid, evidence: evidence(source), ...(lane.status === "representative" ? { notes: previewNote } : {}) };
      delete poi.approximatePosition;
      pois.set(poiId, poi);
    };
    const connect = (a: Node, b: Node, mode: Edge["mode"], source: string) => {
      const p = a.position, q = b.position;
      const isPaid = (paid.get(a.id) ?? false) && (paid.get(b.id) ?? false);
      const step = mode === "stairs" || mode === "escalator";
      edges.push({
        id: `${a.id}__${b.id}${mode === "escalator" || mode === "elevator" ? `__${mode}` : ""}`,
        from: a.id, to: b.id, direction: "both", mode,
        lengthM: stableHypot(p.x - q.x, p.y - q.y, (a.renderZ ?? 0) - (b.renderZ ?? 0)),
        geometry: [p, q], geometryZ: "symbolic", paid: isPaid, crossesFareBoundary: mode === "gate",
        wheelchair: step ? false : null, steps: step, hours: null, closed: false,
        verification: "verified", geometryEvidence: evidence(source), accessEvidence: evidence(source),
        attributes: { deferredScene: deferred },
      });
    };
    for (const level of lane.levels) {
      if (level.id === B1) continue;
      floors.push({ id: levelId(level.id), operatorId: lane.operator, sourceLabels: [], ordinal: null,
        intermediate: false, elevationM: null, elevationSource: "symbolic", renderElevationM: level.z_m,
        displayNames: names({ ja: level.label, en: level.label }) });
    }
    for (const gate of lane.gates) {
      // Public gates join B1. Place paid landings on the lane level at their height.
      const floor = gate.side === "public" ? B1 : levelId(lane.levels.find(level => level.z_m === gate.position?.[2])?.id ?? B1);
      add(gate.id, "ticket_gate", floor, gate.position, gate.side === "paid", gate.source,
        { ja: `${lane.line.ja} 改札`, en: `${lane.line.en} gate` }, gate.poiId ?? undefined);
      const node = positions.get(gate.id);
      if (gate.side !== "public" || !node) continue;
      const distance = (candidate: Node) => stableHypot(candidate.position.x - node.position.x, candidate.position.y - node.position.y);
      const nearest = concourse.reduce((a, b) => distance(a) <= distance(b) ? a : b);
      connect(nearest, node, "walk", gate.source);
    }
    for (const platform of lane.platforms) {
      const point = platform.centerline?.[0];
      const level = lane.levels.find(level => level.id === platform.level)!;
      add(platform.id, "platform", levelId(platform.level), point ? [...point, level.z_m] : null, true, platform.source,
        { ja: `${lane.line.ja} ${platform.number}番線`, en: `${lane.line.en} platform ${platform.number}` }, platform.poiId);
    }
    for (const landing of lane.paidConcourseNodes ?? []) {
      const [x, y] = landing.position;
      const level = lane.levels.find(level => level.id === landing.level)!;
      const node: Node = { id: id(landing.id), floorId: levelId(level.id), position: { x, y, z: null },
        renderZ: level.z_m, kind: "junction", inOut: "inside", sourceRefs: [] };
      nodes.push(node);
      positions.set(landing.id, node);
      paid.set(node.id, true);
    }
    for (const link of lane.connectors) {
      const a = positions.get(link.from), b = positions.get(link.to);
      if (a === undefined || b === undefined) throw new Error(`Rail lane ${prefix}: unknown connector ${link.from} → ${link.to}`);
      if (a && b) connect(a, b, link.kind === "lift" ? "elevator" : link.kind, link.source);
    }
  }
  return { ...bundle, floors, nodes, edges, pois: [...pois.values()] };
}

/** Lane modules export a default builder under the same filename stem as their JSON. */
export function attachRailScene(ctx: SceneContext, scene: StationScene): StationScene {
  const V = ctx.THREE.Vector3;
  const point = ([x, y, z]: XYZ) => new V(...ctx.enuToRenderer({ x, y, z }));
  const openings = lanes.flatMap(({ lane }) => (lane.openings ?? []).map(opening => {
    const [x, y] = opening.along;
    return { center: point(opening.position), along: new V(x, 0, -y), across: new V(y, 0, x),
      width: opening.width_m, depth: opening.depth_m, height: opening.height_m };
  }));
  const queued = lanes.flatMap(({ lane, prefix }) => {
    const load = sceneFiles[`./rail/${prefix}.ts`];
    if (!load) return [];
    const gates = lane.gates.flatMap(gate => gate.position ? [point(gate.position)] : []);
    return [{ lane, load, gates }];
  });
  const chunks: StationScene[] = [];
  let disposed = false;
  return {
    ...scene,
    openings,
    approach(position) {
      const index = queued.findIndex(entry => entry.gates.some(gate => gate.distanceToSquared(position) <= 24 ** 2));
      if (index < 0) return;
      const { lane, load } = queued.splice(index, 1)[0]!;
      void load().then(build => build(ctx, lane)).then(chunk => {
        if (disposed) { chunk.dispose(); return; }
        chunks.push(chunk);
        scene.root.add(chunk.root);
        chunk.root.updateWorldMatrix(true, true);
        ctx.mountChunk?.(chunk);
      });
    },
    dispose() {
      disposed = true;
      for (const chunk of chunks) chunk.dispose();
      scene.dispose();
    },
  };
}
