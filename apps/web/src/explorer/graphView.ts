import * as THREE from "three";
import type { StationBundle } from "@gteki/schema";
import type { Router } from "@gteki/navigation";
import { DEFAULT_PROFILE, nodeDisplayZ } from "@gteki/navigation";
import { occludedLineStyle } from "./occludedLine.ts";
import { R, edgePoints, ribbonGeometry } from "./geometry.ts";

/**
 * L0 "graph corridor" view built only from the station graph — no invented walls or floor
 * plates. Corridor width is symbolic; the legend says so. Walkable = corridors of edges the
 * default profile may traverse (so free walking never leaves the known graph).
 */

const MODE_WIDTH: Record<string, number> = { walk: 2.6, gate: 1.8, stairs: 2.0, escalator: 1.4, ramp: 2.2, moving_walkway: 1.6, elevator: 1.6 };

export interface GraphView {
  root: THREE.Group;
  walkable: THREE.Object3D[];
  /** Thin always-on-top overlay for use over station-provided scenes. */
  overlay: THREE.Group;
  /** Overview draws the overlay always on top; walk/guide depth-tests it (faint dashes where occluded). */
  setXray(on: boolean): void;
  dispose(): void;
}

export function buildGraphView(bundle: StationBundle, router: Router): GraphView {
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const floors = new Map(bundle.floors.map((f) => [f.id, f]));
  const root = new THREE.Group();
  root.name = "gteki:l0-graph";
  const overlay = new THREE.Group();
  overlay.name = "gteki:graph-overlay";
  const walkable: THREE.Object3D[] = [];
  const disposables: { dispose(): void }[] = [];

  const mats = {
    ok: new THREE.MeshStandardMaterial({ color: 0x3a4658, roughness: 0.85, metalness: 0.05, side: THREE.DoubleSide }),
    paid: new THREE.MeshStandardMaterial({ color: 0x4a3f5e, roughness: 0.85, side: THREE.DoubleSide }),
    vertical: new THREE.MeshStandardMaterial({ color: 0x5b6f86, roughness: 0.7, side: THREE.DoubleSide }),
    blocked: new THREE.MeshStandardMaterial({ color: 0x5a2a2a, roughness: 0.9, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
    edge: new THREE.LineBasicMaterial({ color: 0x9fb3c8, transparent: true, opacity: 0.55 }),
    edgeBlocked: new THREE.LineDashedMaterial({ color: 0xff6b6b, dashSize: 0.8, gapSize: 0.6, transparent: true, opacity: 0.9 }),
  };
  const overlayStyle = occludedLineStyle(0x9fe7ff, 0.35, 0.15);
  disposables.push(...Object.values(mats), overlayStyle.visible, overlayStyle.occluded);

  for (const edge of bundle.edges) {
    const pts = edgePoints(bundle, edge, nodes, floors);
    if (pts.length < 2) continue;
    const traversable = router.isTraversable(edge, DEFAULT_PROFILE);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(pts.map((p) => p.clone().add(new THREE.Vector3(0, 0.03, 0))));
    disposables.push(lineGeo);
    const line = new THREE.Line(lineGeo, traversable ? mats.edge : mats.edgeBlocked);
    if (!traversable) line.computeLineDistances();
    root.add(line);
    overlay.add(...overlayStyle.lines(lineGeo, 10));
    if (edge.mode === "elevator") continue; // a shaft is not a walk surface
    const geo = ribbonGeometry(pts, MODE_WIDTH[edge.mode] ?? 2);
    disposables.push(geo);
    const vertical = edge.mode === "stairs" || edge.mode === "escalator" || edge.mode === "ramp";
    const mesh = new THREE.Mesh(geo, !traversable ? mats.blocked : vertical ? mats.vertical : edge.paid === true ? mats.paid : mats.ok);
    mesh.receiveShadow = true;
    mesh.userData = { gteki_role: traversable ? "walkable" : "blocked", edgeId: edge.id };
    root.add(mesh);
    if (traversable) walkable.push(mesh);
  }

  // Junction pads so corners are walkable.
  const pad = new THREE.CircleGeometry(1.4, 20).rotateX(-Math.PI / 2);
  disposables.push(pad);
  const touched = new Set<string>();
  for (const e of bundle.edges) if (router.isTraversable(e, DEFAULT_PROFILE) && e.mode !== "elevator") { touched.add(e.from); touched.add(e.to); }
  for (const id of touched) {
    const n = nodes.get(id)!;
    const z = nodeDisplayZ(n, floors.get(n.floorId)).z;
    const m = new THREE.Mesh(pad, mats.ok);
    m.position.copy(R(n.position.x, n.position.y, z));
    m.userData = { gteki_role: "walkable", nodeId: id };
    root.add(m);
    walkable.push(m);
  }

  // Node markers by kind.
  const markerGeo = new THREE.CylinderGeometry(0.25, 0.25, 0.08, 12);
  disposables.push(markerGeo);
  const kindColor: Record<string, number> = { exit: 0x7dffa0, ticket_gate: 0xffc857, platform: 0x9b8cff, elevator: 0x5ef0ff, facility: 0xff9ad5 };
  const markerMats = new Map<number, THREE.MeshBasicMaterial>();
  for (const n of bundle.nodes) {
    const color = kindColor[n.kind];
    if (color === undefined) continue;
    let mat = markerMats.get(color);
    if (!mat) { mat = new THREE.MeshBasicMaterial({ color }); markerMats.set(color, mat); disposables.push(mat); }
    const m = new THREE.Mesh(markerGeo, mat);
    m.position.copy(R(n.position.x, n.position.y, nodeDisplayZ(n, floors.get(n.floorId)).z)).add(new THREE.Vector3(0, 0.05, 0));
    root.add(m);
  }

  return {
    root,
    walkable,
    overlay,
    setXray: (on) => overlayStyle.setXray(on),
    dispose() {
      for (const d of disposables) d.dispose();
    },
  };
}
