// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import type { Edge, Node, StationBundle } from "@gteki/schema";
import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { Object3D, Vector3 } from "three";
import { cutRegions, disposePortalCuts, type CutRegion, type PortalCutResources } from "../../../apps/web/src/explorer/portalCut.ts";
import { depatoBundle, depatoLayout, readDepatoFloors, type PlanPoint } from "../../ikebukuro/scene/depato/layout.ts";
import { buildDepatoInterior } from "../../ikebukuro/scene/depato/interior.ts";
import floorData from "../data/depato-floors.json";
import rollout from "../data/depato-rollout.json";
import { stableHypot } from "./stable-hypot.ts";

const fullStores = new Set(["takashimaya-shinjuku", "shinjuku-marui-main", "shinjuku-marui-annex"]);
const floorStores = readDepatoFloors(floorData);
export const layouts = rollout.stores.map(row => {
  const store = floorStores.find(s => s.id === row.id)!;
  const fullStore = fullStores.has(row.id);
  const [doorX, doorZ] = row.entrance.point as PlanPoint;
  const [inwardX, inwardZ] = row.entrance.inward as PlanPoint;
  const elevations = { "1F": row.entrance.elevation };
  if (row.id === "shinjuku-marui-main") {
    // Fit the public floors below the PLATEAU roof deck.
    Object.assign(elevations, Object.fromEntries(store.floors
      .filter(f => f.order >= 2 && f.level !== "RF")
      .map(f => [f.level, row.entrance.elevation + (f.order - 1) * 4.25])), { RF: 34.4 });
  }
  const layout = depatoLayout({
    store: fullStore ? store : { ...store, floors: store.floors.filter(f => f.level === "1F" || f.level === "B1") },
    footprint: row.footprint as PlanPoint[],
    poiId: row.poiId,
    sourceId: row.sourceTile,
    elevations,
    circulation: row.circulation,
    ...(fullStore ? { lift: [row.circulation.aisleX - 8, (row.circulation.from + row.circulation.to) / 2] as PlanPoint } : {}),
    entrances: [{ ...row.entrance, point: row.entrance.point as PlanPoint, inward: row.entrance.inward as PlanPoint }],
  });
  // Clear the entry and the cross-aisle joining it to the stair bypass.
  const insideX = doorX + 4 * inwardX;
  const crossAisleZ = doorZ + 4 * inwardZ;
  const bypassX = layout.aisleX - 4;
  const crossAisleLeft = Math.min(insideX, bypassX) - 0.9;
  const crossAisleRight = Math.max(insideX, bypassX) + 0.9;
  layout.counters = layout.counters.filter(([x, z]) => {
    if (layout.input.lift) {
      const [liftX, liftZ] = layout.input.lift;
      const atDirectory = Math.abs(x - (bypassX - 2)) < 1 &&
        [layout.stair.from - 2, layout.stair.to + 2].some(stop => Math.abs(z - stop) < 4);
      if (Math.abs(x - bypassX) < 1.25 ||
        atDirectory || (x > liftX - 1.8 && x < bypassX && Math.abs(z - liftZ) < 4)) return false;
    }
    const depth = (x - doorX) * inwardX + (z - doorZ) * inwardZ;
    const across = (z - doorZ) * inwardX - (x - doorX) * inwardZ;
    const entryWidth = row.id === "shinjuku-marui-main" ? 4 : 2;
    const onEntry = depth > 0 && depth < 8 && Math.abs(across) < entryWidth;
    const onCrossAisle = x > crossAisleLeft && x < crossAisleRight && Math.abs(z - crossAisleZ) < 2.4;
    return !onEntry && !onCrossAisle;
  });
  return layout;
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
        lengthM: stableHypot(b.x - a.x, b.y - a.y, b.z! - a.z!), geometry: [a, b],
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
      // Bisect the turn so a long leg cannot flip the strip across a short one.
      const incoming = point.clone().sub(points[Math.max(i - 1, 0)]!).setY(0).normalize();
      const outgoing = points[Math.min(i + 1, points.length - 1)]!.clone().sub(point).setY(0).normalize();
      const direction = incoming.add(outgoing);
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
    if (row.id === "shinjuku-marui-main") {
      regions.push({
        key: {}, clip: null, accepts: () => true,
        bounds: new THREE.Box3(new THREE.Vector3(x! - 20, y, z! - 20), new THREE.Vector3(x! + 20, y + 5, z! + 20)),
        planes: [p => 14 - across(p), p => 14 + across(p), p => depth(p) - 0.2,
          p => 16 - depth(p), p => p.y - y, p => y + 5 - p.y],
      });
    }
    facadeCuts.set(building, regions);
    return mesh;
  });
  for (const [building, regions] of facadeCuts) cutRegions(building, regions, resources);
  await document.fonts.load('600 32px "GTEki Sign JP"', layouts.flatMap(p => [
    p.input.store.name.ja, p.input.store.name.en,
    ...p.floors.flatMap(f => [f.label.ja, f.label.en, ...f.tenants.flatMap(t => [t.ja, t.en])]),
  ]).join(""));
  const interiors = layouts.map(p => buildDepatoInterior(ctx, p, scene.generatedMeshEnvMap));
  const fullStoreFacades = rollout.stores.map(row => fullStores.has(row.id)
    ? scene.root.getObjectByName(`department-store:${row.buildingId}`)! : null);
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
      const distances = layouts.map((l, n) => {
        const facade = fullStoreFacades[n];
        const top = facade ? l.floors.at(-1)!.level : "1F";
        const inside = l.contains([p.x, p.z]) && p.y >= l.height("B1") - 1 && p.y <= l.height(top) + 4;
        // Some LOD2 roof/setback faces cross the illustrative upper-floor plates.
        if (facade) facade.visible = !inside || p.y < l.height("1F") + 2;
        return inside ? 0 : stableHypot(p.x - l.input.entrances[0]!.point[0], p.y - l.height("1F"), p.z - l.input.entrances[0]!.point[1]);
      });
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
