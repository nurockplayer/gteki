// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import type { Edge, Node, StationBundle } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { Object3D, Vector3 } from "three";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import { depatoBundle, depatoLayout, type PlanPoint } from "../../ikebukuro/scene/depato/layout.ts";
import { buildDepatoInterior } from "../../ikebukuro/scene/depato/interior.ts";
import floorData from "../data/depato-floors.json";
import rollout from "../data/depato-rollout.json";

const layouts = rollout.stores.map(row => {
  const store = floorData.stores.find(s => s.id === row.id)!;
  return depatoLayout({
    store: { ...store, floors: store.floors.filter(f => f.level === "1F" || f.level === "B1") },
    footprint: row.footprint as PlanPoint[],
    poiId: row.poiId,
    sourceId: row.sourceTile,
    elevations: { "1F": row.entrance.elevation },
    circulation: row.circulation,
    entrances: [{ ...row.entrance, point: row.entrance.point as PlanPoint, inward: row.entrance.inward as PlanPoint }],
  });
});

function approachIds(row: typeof rollout.stores[number]) {
  return row.streetApproach.waypoints.map((_, i, points) =>
    i === points.length - 1 ? row.entrance.outsideNode : `depato-${row.id}-approach-${i}`);
}

export function depatoPreviewBundle(bundle: StationBundle): StationBundle {
  return rollout.stores.reduce((current, row, index) => {
    const exit = current.nodes.find(n => n.id === row.streetApproach.exitNode)!;
    const ids = approachIds(row);
    const approach = row.streetApproach.waypoints.map(([x, y, z], i): Node => ({
      id: ids[i]!, floorId: exit.floorId, position: { x: x!, y: -z!, z: y! },
      kind: "junction", inOut: "outside", sourceRefs: [],
    }));
    const route = [{ ...exit, position: { ...exit.position, z: exit.renderZ ?? exit.position.z } }, ...approach];
    const evidence = { sourceIds: [row.sourceTile], checkedDate: row.entrance.checkedAt.slice(0, 10),
      method: "Authored preview walk at modeled street grade, fitted to PLATEAU context" };
    const edges = approach.map((to, i): Edge => {
      const from = route[i]!;
      const a = from.position, b = to.position;
      return { id: `${from.id}__${to.id}`, from: from.id, to: to.id, direction: "both", mode: "walk",
        lengthM: Math.hypot(b.x - a.x, b.y - a.y, b.z! - a.z!), geometry: [a, b],
        paid: false, crossesFareBoundary: false, wheelchair: null, steps: false, hours: null,
        closed: false, verification: "verified", geometryEvidence: evidence, accessEvidence: evidence };
    });
    const withInterior = depatoBundle({
      ...current, nodes: [...current.nodes, ...approach], edges: [...current.edges, ...edges],
    }, layouts[index]!);
    const door = withInterior.nodes.find(n => n.id === `depato-${row.id}-1F-door0`)!;
    return { ...withInterior, pois: withInterior.pois.map(p => p.id === row.poiId
      ? { ...p, floorId: door.floorId, displayPosition: { ...door.position, z: row.entrance.elevation + 1.3 },
        connectorNodeIds: [door.id] } : p) };
  }, bundle);
}

export async function attachDepatoPreview(ctx: SceneContext, scene: StationScene): Promise<StationScene> {
  const { THREE } = ctx;
  const resources: PortalCutResources = {
    geometries: [], materials: [], portalMeshes: new Map(), originals: new Map(), clippedMeshes: [], instances: [],
  };
  const pavementMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide, visible: false });
  const facadeCuts = new Map<Object3D, CutRegion[]>();
  const pavement = rollout.stores.map(row => {
    const exit = ctx.bundle.nodes.find(n => n.id === row.streetApproach.exitNode)!;
    const start = new THREE.Vector3(exit.position.x, exit.renderZ ?? exit.position.z!, -exit.position.y);
    const points = [start, ...row.streetApproach.waypoints.map(([x, y, z]) => new THREE.Vector3(x, y, z))];
    start.addScaledVector(start.clone().sub(points[1]!).setY(0).normalize(), 0.35);
    const end = points.at(-1)!;
    end.addScaledVector(end.clone().sub(points.at(-2)!).setY(0).normalize(), 0.35);
    const strip = points.map((point, i) => {
      const direction = points[Math.min(i + 1, points.length - 1)]!.clone().sub(points[Math.max(i - 1, 0)]!);
      const side = new THREE.Vector3(direction.z, 0, -direction.x).normalize().multiplyScalar(1.8);
      return [point.clone().add(side), point.clone().sub(side)] as const;
    });
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(strip.slice(1).flatMap(([c, d], i) => {
      const [a, b] = strip[i]!;
      return [a, b, c, b, d, c].flatMap(p => p.toArray());
    }), 3));
    geometry.computeVertexNormals();
    const mesh = new THREE.Mesh(geometry, pavementMaterial);
    mesh.name = `depato-${row.id}-street-support`;
    mesh.userData.gteki_role = "walkable";

    const building = scene.root.getObjectByName(`department-store:${row.buildingId}`)!;
    const [x, z] = row.entrance.point, [nx, nz] = row.entrance.inward;
    const y = row.entrance.elevation;
    const across = (p: Vector3) => (p.x - x!) * -nz! + (p.z - z!) * nx!;
    const depth = (p: Vector3) => (p.x - x!) * nx! + (p.z - z!) * nz!;
    const region: CutRegion = {
      key: row, clip: null, accepts: normal => Math.abs(normal.y) < 0.1,
      bounds: new THREE.Box3(new THREE.Vector3(x! - 2.6, y - 0.08, z! - 2.6),
        new THREE.Vector3(x! + 2.6, y + 2.8, z! + 2.6)),
      planes: [
        p => 2 - across(p), p => 2 + across(p),
        p => 0.6 - depth(p), p => 0.6 + depth(p),
        p => p.y - y + 0.08,
        p => y + 2.8 - p.y,
      ],
    };
    const regions = facadeCuts.get(building) ?? [];
    regions.push(region);
    facadeCuts.set(building, regions);
    return mesh;
  });
  for (const [building, regions] of facadeCuts) cutRegions(building, regions, resources);
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(p => [
    p.input.store.name.ja, p.input.store.name.en,
    ...p.floors.flatMap(f => [f.label.ja, f.label.en, ...f.tenants.flatMap(t => [t.ja, t.en])]),
  ]).join(""));
  const interiors = layouts.map(p => buildDepatoInterior(ctx, p, scene.generatedMeshEnvMap));
  scene.root.add(...pavement, ...interiors.flatMap(i => [i.root, i.connectorRoot]));
  let avatar: { x: number; y: number; z: number } | null = null;
  return {
    ...scene,
    walkable: [...scene.walkable, ...pavement, ...interiors.flatMap(i => i.walkable)],
    colliders: [...(scene.colliders ?? []), ...interiors.flatMap(i => i.colliders)],
    cameraBlockers: [...(scene.cameraBlockers ?? []), ...interiors.flatMap(i => i.cameraBlockers)],
    setCameraFocus(...args) {
      scene.setCameraFocus?.(...args);
      avatar = args[3] ?? null;
      interiors.forEach(i => i.setAvatar(avatar));
    },
    update(dt, elapsed, camera) {
      scene.update?.(dt, elapsed, camera);
      if (!camera) return;
      const p = avatar ?? camera.position;
      const distances = layouts.map(l =>
        l.contains([p.x, p.z]) && p.y >= l.height("B1") - 1 && p.y <= l.height("1F") + 4 ? 0 :
          Math.hypot(p.x - l.input.entrances[0]!.point[0], p.y - l.height("1F"), p.z - l.input.entrances[0]!.point[1]));
      const active = distances.indexOf(Math.min(...distances));
      // Keep the detail loaded for the approach and release it after leaving the storefront.
      interiors.forEach((i, n) => { if (n !== active || distances[n]! > 24) i.update(camera, dt, elapsed, false); });
      if (distances[active]! <= 24) interiors[active]!.update(camera, dt, elapsed);
    },
    dispose() {
      disposePortalCuts(resources);
      interiors.forEach(i => i.dispose());
      pavementMaterial.dispose();
      scene.dispose();
    },
  };
}
