/**
 * Neutral decorative wall props (#858 item 12): vending machines and kiosks standing against a wall.
 *
 * They are presentation only: never a POI, never in routing data, no brand, logo or readable text. The whole
 * station's props are one merged mesh in one draw call; each interactive prop gets an empty marker object
 * (a child of the mesh) carrying `userData.gtekiInteractionId`, and its reaction boxes are appended last in
 * the merged index. The station keeps the mesh at `setDrawRange(0, idle)` and extends the range while the
 * marker is visible, so the reaction adds no draw call. Shading is faked in the vertex colours (Ikebukuro has
 * no scene lights).
 */
import type * as THREE_NS from "three";

export interface WallPropPlacement {
  /** Unique within the station; names the prop's mesh part and its collider. */
  id: string;
  kind: "vending" | "kiosk";
  /** The wall face the prop stands against, ENU metres (x east, y north). */
  wall: readonly [number, number];
  /** Outward unit normal of that wall face. */
  n: readonly [number, number];
  /** Floor height at the prop, ENU metres. */
  z: number;
  /** Width along the wall, metres. */
  w: number;
  /** Depth outward from the wall, metres. */
  d: number;
  /** Set on the interactive prop: the id shared by its interactable, marker and reaction boxes. */
  interaction?: string;
}

const VENDING_H = 1.85;
const KIOSK_H = 2;
/** The prop's back face sits this far inside the wall. */
const BACK_INSET_M = 0.02;
/** The base stands this much wider and deeper than the body, so their faces are not coplanar and never z-fight. */
const BASE_PROUD_M = 0.01;

const COLOUR = {
  body: 0xd7d7d0,
  base: 0x4c4c48,
  window: 0xfff3d0,
  slot: 0x2b2b2a,
  frame: 0xffffff,
  kioskBody: 0xcfcfc8,
  kioskHeader: 0xfff0c8,
  shelf: 0x8d8880,
  blocks: [0xb85c4a, 0x4a76b8, 0xc9a03e, 0x5a9a70, 0x8a6ab0],
} as const;

type ThreeNs = typeof THREE_NS;
type V3 = { x: number; y: number; z: number };

/** Fake directional shading: top brightest, front flat, sides darker, back and bottom darkest. */
function paint(THREE: ThreeNs, geometry: THREE_NS.BufferGeometry, colour: number): void {
  const c = new THREE.Color(colour);
  const normals = geometry.getAttribute("normal");
  const colours = new Float32Array(normals.count * 3);
  for (let i = 0; i < normals.count; i++) {
    const nx = Math.abs(normals.getX(i)), ny = normals.getY(i), nz = normals.getZ(i);
    const shade = ny > 0.5 ? 1.12 : ny < -0.5 ? 0.52 : nx > 0.5 ? 0.86 : nz < -0.5 ? 0.64 : 1;
    colours[i * 3] = c.r * shade;
    colours[i * 3 + 1] = c.g * shade;
    colours[i * 3 + 2] = c.b * shade;
  }
  geometry.setAttribute("color", new THREE.BufferAttribute(colours, 3));
}

/** A box part in the prop's local frame (x along the wall, y up, z outward from the back face). */
function box(THREE: ThreeNs, parts: THREE_NS.BufferGeometry[], w: number, h: number, d: number, x: number, y: number, z: number, colour: number): void {
  const geometry = new THREE.BoxGeometry(w, h, d);
  geometry.translate(x, y, z);
  paint(THREE, geometry, colour);
  parts.push(geometry);
}

/** Body, base, lit display window with three rows of plain blocks, and a low pickup slot. */
function vendingParts(THREE: ThreeNs, parts: THREE_NS.BufferGeometry[], p: WallPropPlacement): void {
  const { w, d } = p;
  const front = d - BACK_INSET_M;
  box(THREE, parts, w, VENDING_H, d, 0, VENDING_H / 2, d / 2 - BACK_INSET_M, COLOUR.body);
  box(THREE, parts, w + BASE_PROUD_M, 0.18, d + BASE_PROUD_M, 0, 0.09, d / 2 - BACK_INSET_M, COLOUR.base);
  box(THREE, parts, w - 0.16, 0.88, 0.008, 0, 1.28, front + 0.004, COLOUR.window);
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 3; col++) {
      box(THREE, parts, 0.18, 0.16, 0.008, (col - 1) * 0.3, 0.98 + row * 0.26, front + 0.012, COLOUR.blocks[(row * 3 + col) % COLOUR.blocks.length]!);
    }
  }
  box(THREE, parts, 0.4, 0.14, 0.008, 0, 0.42, front + 0.004, COLOUR.slot);
}

/** Brighter window frame, drawn only while the prop reacts. Appended last in the merged index. */
function vendingReaction(THREE: ThreeNs, parts: THREE_NS.BufferGeometry[], p: WallPropPlacement): void {
  const { w, d } = p;
  const front = d - BACK_INSET_M;
  const half = (w - 0.16) / 2;
  box(THREE, parts, w - 0.12, 0.03, 0.01, 0, 1.735, front + 0.005, COLOUR.frame);
  box(THREE, parts, w - 0.12, 0.03, 0.01, 0, 0.825, front + 0.005, COLOUR.frame);
  box(THREE, parts, 0.03, 0.94, 0.01, -(half + 0.015), 1.28, front + 0.005, COLOUR.frame);
  box(THREE, parts, 0.03, 0.94, 0.01, half + 0.015, 1.28, front + 0.005, COLOUR.frame);
}

/** Neutral body, lit header band with no text, and two shelves of plain blocks. */
function kioskParts(THREE: ThreeNs, parts: THREE_NS.BufferGeometry[], p: WallPropPlacement): void {
  const { w, d } = p;
  const front = d - BACK_INSET_M;
  box(THREE, parts, w, KIOSK_H, d, 0, KIOSK_H / 2, d / 2 - BACK_INSET_M, COLOUR.kioskBody);
  box(THREE, parts, w + BASE_PROUD_M, 0.15, d + BASE_PROUD_M, 0, 0.075, d / 2 - BACK_INSET_M, COLOUR.base);
  box(THREE, parts, w - 0.1, 0.35, 0.008, 0, 1.72, front + 0.004, COLOUR.kioskHeader);
  for (const y of [0.72, 1.12]) box(THREE, parts, w - 0.2, 0.03, 0.008, 0, y, front + 0.004, COLOUR.shelf);
  for (let row = 0; row < 2; row++) {
    for (let col = 0; col < 4; col++) {
      box(THREE, parts, 0.16, 0.2, 0.008, (col - 1.5) * 0.22, 0.86 + row * 0.4, front + 0.012, COLOUR.blocks[(row * 4 + col) % COLOUR.blocks.length]!);
    }
  }
}

/**
 * Builds one merged mesh for a station's wall props, in the renderer frame. `THREE` and `mergeGeometries` are
 * passed in so this package gains no runtime three import; `toRenderer` maps an ENU point to the same frame.
 * The mesh starts at the idle draw range; `userData.gtekiWallPropsIdleCount` / `...FullCount` are the two ranges.
 */
export function buildWallProps(
  THREE: ThreeNs,
  mergeGeometries: (geometries: THREE_NS.BufferGeometry[]) => THREE_NS.BufferGeometry | null,
  toRenderer: (x: number, y: number, z: number) => V3,
  placements: readonly WallPropPlacement[],
  tag: string,
): THREE_NS.Mesh {
  const idle: THREE_NS.BufferGeometry[] = [];
  const reaction: THREE_NS.BufferGeometry[] = [];
  const markers: { id: string; at: V3 }[] = [];
  for (const p of placements) {
    const parts: THREE_NS.BufferGeometry[] = [];
    if (p.kind === "vending") vendingParts(THREE, parts, p);
    else kioskParts(THREE, parts, p);
    // Bake the placement into world space: local +z is the outward normal, so rotate then move to the wall face.
    const rotate = Math.atan2(p.n[0], -p.n[1]);
    const at = toRenderer(p.wall[0], p.wall[1], p.z);
    for (const geometry of parts) {
      geometry.rotateY(rotate);
      geometry.translate(at.x, at.y, at.z);
    }
    idle.push(...parts);
    if (p.interaction) {
      const react: THREE_NS.BufferGeometry[] = [];
      vendingReaction(THREE, react, p);
      for (const geometry of react) {
        geometry.rotateY(rotate);
        geometry.translate(at.x, at.y, at.z);
      }
      reaction.push(...react);
      const face = toRenderer(p.wall[0] + p.n[0] * p.d, p.wall[1] + p.n[1] * p.d, p.z + VENDING_H / 2);
      markers.push({ id: p.interaction, at: face });
    }
  }
  const indexCount = (list: THREE_NS.BufferGeometry[]) => list.reduce((n, g) => n + (g.index?.count ?? g.getAttribute("position").count), 0);
  const idleCount = indexCount(idle);
  const fullCount = idleCount + indexCount(reaction);
  const geometry = mergeGeometries([...idle, ...reaction]);
  for (const g of [...idle, ...reaction]) g.dispose();
  if (!geometry) throw new Error("wall props: merged geometry is empty");
  geometry.computeBoundingSphere();
  geometry.computeBoundingBox();
  geometry.setDrawRange(0, idleCount);
  const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true }));
  mesh.name = `wall-props:${tag}`;
  mesh.userData.gtekiWallProps = true;
  mesh.userData.gtekiWallPropsIdleCount = idleCount;
  mesh.userData.gtekiWallPropsFullCount = fullCount;
  for (const marker of markers) {
    const object = new THREE.Object3D();
    object.name = `wall-props-interaction:${marker.id}`;
    object.position.set(marker.at.x, marker.at.y, marker.at.z);
    object.visible = false;
    object.userData.gtekiInteractionId = marker.id;
    mesh.add(object);
  }
  return mesh;
}

/** The ranges a station's update toggles: idle excludes the interaction's reaction boxes, full includes them. */
export function wallPropDrawRanges(mesh: THREE_NS.Mesh): { idle: number; full: number } {
  return { idle: mesh.userData.gtekiWallPropsIdleCount as number, full: mesh.userData.gtekiWallPropsFullCount as number };
}
