import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { StationBundle } from "@gteki/schema";
import { pointInRings, soffitHeight, type Layout, type WalkWorld, type XY, type XYZ } from "./layout.ts";
import { stationSpawn } from "./spawn.ts";
import { IDENTITY_ART, identityTexture } from "./textures.ts";

export const IDENTITY_SIZE = { width: 1.72, height: 0.86, depth: 0.07 } as const;
export const IDENTITY_GENERATED = "GTEki station identity board (original design; not operator signage)";
export type LocalBox = { min: [number, number, number]; max: [number, number, number] };

/** Canvas pixel rectangle → the actual plate's local coordinates (origin at its centre). */
export function identityBox(left: number, top: number, right: number, bottom: number): LocalBox {
  const { width: w, height: h, depth } = IDENTITY_SIZE;
  return { min: [(left / IDENTITY_ART.width - 0.5) * w, (0.5 - bottom / IDENTITY_ART.height) * h, -depth / 2 - 0.01],
    max: [(right / IDENTITY_ART.width - 0.5) * w, (0.5 - top / IDENTITY_ART.height) * h, depth / 2 + 0.01] };
}

/** Ink/capital bounds under IDENTITY_ART's documented font assumptions, excluding line spacing. */
export function identityGlyphBox(kind: "ja" | "en"): LocalBox {
  const row = IDENTITY_ART[kind];
  return identityBox(row.x, row.baseline - row.fontSize * row.capFraction, row.x + row.inkWidth, row.baseline);
}

/** Original render-only identity boards; no routing, collision or source-data changes. */
export function buildIdentityBoards(bundle: StationBundle, layout: Layout, world: WalkWorld, root: THREE.Group,
  track: <T extends { dispose(): void }>(value: T) => T, quality: "low" | "high",
  cases: THREE.BufferGeometry[], rods: THREE.BufferGeometry[]): THREE.Object3D[] {
  const spawn = stationSpawn(bundle, layout.nodeZ, world);
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const faces: THREE.BufferGeometry[] = [], boards: THREE.Object3D[] = [];
  const { width, height, depth } = IDENTITY_SIZE;
  const region = IDENTITY_ART.name;
  const nameBox = identityBox(region.left, region.top, region.right, region.bottom);
  const add = (name: string, nodeId: string, center: XYZ, facing: XY) => {
    const level = layout.levels.find((lv) => Math.abs(lv.z - center.z) < 0.3);
    if (!level) return;
    // 2.1 m clear below the casing; 0.12 m below the ceiling. Lower than route signs.
    const top = Math.min(center.z + 3.0, level.ceilingZ - 0.12);
    const board = new THREE.Group();
    board.name = name;
    const roofs = [...level.ceilings, ...layout.soffits];
    const clear = () => {
      board.updateMatrixWorld(true);
      for (const y of [-height / 2 - 0.02, 0, height / 2 + 0.02]) {
        const corners = [[-width / 2 - 0.04, -0.06], [width / 2 + 0.04, -0.06], [width / 2 + 0.04, 0.06], [-width / 2 - 0.04, 0.06]]
          .map(([x, z]) => board.localToWorld(new THREE.Vector3(x, y, z)));
        for (let i = 0; i < corners.length; i++) {
          const a = corners[i]!, b = corners[(i + 1) % corners.length]!;
          if (world.firstWallHit({ x: a.x, y: -a.z }, { x: b.x, y: -b.z }, a.y) < 1) return false;
        }
      }
      for (let i = 0; i <= 10; i++) for (const z of [-0.06, 0, 0.06]) {
        const p = board.localToWorld(new THREE.Vector3((-0.5 + i / 10) * (width + 0.08), height / 2 + 0.02, z));
        const enu = { x: p.x, y: -p.z };
        if (roofs.some((roof) => pointInRings(enu, roof.rings) && soffitHeight(roof, enu) > center.z + 1.8 && soffitHeight(roof, enu) - p.y < 0.08)) return false;
      }
      return true;
    };
    // Search only small offsets from the source anchor. In particular, the normal
    // spawn backs up near a wall: its board needs a little lateral clearance.
    let found = false;
    for (const along of [0, 0.3, -0.3, 0.6, -0.6, 0.9]) {
      for (const lateral of [0, 0.2, -0.2, 0.4, -0.4, 0.6, -0.6]) {
        board.position.set(center.x + facing.x * along - facing.y * lateral, top - height / 2, -(center.y + facing.y * along + facing.x * lateral));
        board.lookAt(board.position.x + facing.x, board.position.y, board.position.z - facing.y);
        if (clear()) { found = true; break; }
      }
      if (found) break;
    }
    if (!found) throw new Error(`No clear identity board placement near ${name}`);
    board.userData = { nodeId, generated: IDENTITY_GENERATED, gteki_identity: { front: [0, 0, 1], regions: [{ kind: "name", ...nameBox }] } };
    root.add(board);
    board.updateMatrix();
    board.updateMatrixWorld(true);
    boards.push(board);
    // Two outward-facing plates: the back is readable, never mirrored. Give Explorer
    // a separate local front normal/region for the paid-side face too.
    for (const side of [1, -1]) {
      const geometry = new THREE.PlaneGeometry(width, height);
      geometry.rotateY(side === 1 ? 0 : Math.PI).translate(0, 0, side * (depth / 2 + 0.002));
      // The merged meshes are root children too: bake only the board's local transform.
      geometry.applyMatrix4(board.matrix);
      faces.push(geometry);
      if (side === -1) {
        const back = new THREE.Group();
        back.name = `${name}:back`;
        back.rotation.y = Math.PI;
        back.userData = { generated: IDENTITY_GENERATED, gteki_identity: { front: [0, 0, 1], regions: [{ kind: "name", ...nameBox }] } };
        board.add(back);
        board.updateMatrixWorld(true);
      }
    }
    cases.push(new THREE.BoxGeometry(width + 0.04, height + 0.04, depth).applyMatrix4(board.matrix));
    const rodLength = level.ceilingZ - top;
    for (const x of [-width * 0.35, width * 0.35]) {
      rods.push(new THREE.CylinderGeometry(0.012, 0.012, rodLength, 6)
        .translate(x, height / 2 + rodLength / 2, 0).applyMatrix4(board.matrix));
    }
  };
  const forward = { x: Math.sin(spawn.heading), y: Math.cos(spawn.heading) };
  add("identity:spawn", spawn.nodeId,
    { x: spawn.position.x + forward.x * 0.9, y: spawn.position.y + forward.y * 0.9, z: spawn.position.z },
    { x: -forward.x, y: -forward.y });
  for (const poi of bundle.pois.filter((p) => p.category === "ticket_gate")) {
    const node = nodes.get(poi.connectorNodeIds[0] ?? "");
    if (!node || !poi.displayPosition) continue;
    const z = layout.nodeZ.get(node.id) ?? 0;
    const gate = layout.gates.filter((g) => Math.abs(g.center.z - z) < 0.3)
      .sort((a, b) => Math.hypot(a.center.x - poi.displayPosition!.x, a.center.y - poi.displayPosition!.y) - Math.hypot(b.center.x - poi.displayPosition!.x, b.center.y - poi.displayPosition!.y))[0];
    if (!gate) continue;
    // Gate POI connectors are the verified unpaid approach nodes (import-e27.ts).
    const dx = node.position.x - poi.displayPosition.x, dy = node.position.y - poi.displayPosition.y;
    const length = Math.hypot(dx, dy) || 1;
    add(`identity:gate:${poi.id}`, node.id, gate.center, { x: dx / length, y: dy / length });
  }
  if (faces.length) {
    const geometry = mergeGeometries(faces)!;
    faces.forEach((g) => g.dispose());
    const texture = track(identityTexture(quality));
    const material = track(new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
    const mesh = new THREE.Mesh(track(geometry), material);
    mesh.name = "identity-faces";
    mesh.userData.gteki_role = "sign";
    mesh.userData.generated = IDENTITY_GENERATED;
    mesh.userData.faceCount = faces.length;
    root.add(mesh);
  }
  return boards;
}
