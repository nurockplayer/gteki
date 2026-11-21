import type * as T from "three";
import type { SceneContext } from "@gteki/scene-api";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { LANDMARK_SIGN, LANDMARK_STREET_BAND, LANDMARK_MAX_TEXTURE_PX } from "../landmark-style.ts";
import type { DepatoLayout, PlanPoint } from "./layout.ts";

/** Collision is ready at scene load; the three visual batches and sign atlas are created on approach. */
export function buildDepatoInterior(ctx: SceneContext, plan: DepatoLayout) {
  const THREE = ctx.THREE;
  const root = new THREE.Group(); root.name = `depato-interior:${plan.input.store.id}`;
  root.visible = false;
  const walkable: T.Mesh[] = [], colliders: T.Mesh[] = [], shells: T.BufferGeometry[] = [];
  const own = new Set<T.BufferGeometry>();
  const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide });
  const collisionMaterial = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide });
  const colour = (geometry: T.BufferGeometry, hex: string) => {
    const c = new THREE.Color(hex), count = geometry.getAttribute("position").count;
    const values = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) values.set([c.r, c.g, c.b], i * 3);
    geometry.setAttribute("color", new THREE.BufferAttribute(values, 3));
    own.add(geometry); shells.push(geometry);
  };
  const physical = (g: T.BufferGeometry, list: T.Mesh[], support = false) => {
    own.add(g);
    const mesh = new THREE.Mesh(g, collisionMaterial); mesh.visible = false;
    mesh.userData.gteki_role = list === walkable ? "floor" : "collider";
    if (support) mesh.userData.gtekiStairWalkSupport = true;
    list.push(mesh); return mesh;
  };
  const box = (x: number, y: number, z: number, w: number, h: number, d: number, hex: string, solid = true) => {
    const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); colour(g, hex);
    if (solid) physical(g.clone(), colliders);
  };
  const floorGeometry = (y: number, hole: boolean) => {
    const shape = new THREE.Shape(plan.input.footprint.map(p => new THREE.Vector2(p[0], -p[1])));
    if (hole) {
      const { x, from, to, width } = plan.stair;
      const path = new THREE.Path([[x - width / 2, -from], [x + width / 2, -from], [x + width / 2, -to], [x - width / 2, -to]].map(p => new THREE.Vector2(p[0]!, p[1]!)));
      shape.holes.push(path);
    }
    const g = new THREE.ShapeGeometry(shape).toNonIndexed(); g.rotateX(-Math.PI / 2); g.translate(0, y, 0); return g;
  };
  for (const [index, f] of plan.floors.entries()) {
    const y = plan.height(f.level), ceiling = index + 1 < plan.floors.length ? plan.height(plan.floors[index + 1]!.level) : y + 4.5;
    const g = floorGeometry(y, index > 0); physical(g.clone(), walkable); colour(g, index % 2 ? "#b9afa0" : "#d2c6b4");
    for (let i = 0; i < plan.input.footprint.length; i++) {
      const a = plan.input.footprint[i]!, b = plan.input.footprint[(i + 1) % plan.input.footprint.length]!;
      const length = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const doors = plan.input.entrances.filter(e => e.level === f.level).flatMap(e => {
        const t = ((e.point[0] - a[0]) * (b[0] - a[0]) + (e.point[1] - a[1]) * (b[1] - a[1])) / length ** 2;
        const distance = Math.hypot(e.point[0] - a[0] - t * (b[0] - a[0]), e.point[1] - a[1] - t * (b[1] - a[1]));
        return distance < 0.1 && t >= 0 && t <= 1 ? [t * length] : [];
      }).sort((a, b) => a - b);
      const wall = (start: number, end: number, bottom = y, height = ceiling - y - 0.18) => {
        const geometry = new THREE.BoxGeometry(end - start, height, 0.18).toNonIndexed();
        geometry.rotateY(-Math.atan2(b[1] - a[1], b[0] - a[0]));
        const t = (start + end) / 2 / length;
        geometry.translate(a[0] + (b[0] - a[0]) * t, bottom + height / 2, a[1] + (b[1] - a[1]) * t);
        physical(geometry.clone(), colliders); colour(geometry, LANDMARK_STREET_BAND.glow);
      };
      let start = 0;
      for (const door of doors) {
        wall(start, door - 2); wall(door - 2, door + 2, y + 3, ceiling - y - 3.18); start = door + 2;
      }
      wall(start, length);
    }
    if (index) {
      const low = plan.height(plan.floors[index - 1]!.level), rise = y - low, { x, from, to, width } = plan.stair;
      const steps = Math.ceil(rise / 0.18), depth = (to - from) / steps;
      for (let i = 0; i < steps; i++) box(x, low + (i + 0.5) * rise / steps, from + (i + 0.5) * depth, width, rise / steps, depth, "#81796f", false);
      // Continuous support makes the same flight walkable with desktop keys and phone input.
      const support = new THREE.BufferGeometry();
      support.setAttribute("position", new THREE.Float32BufferAttribute([x-width/2,low,from,x+width/2,low,from,x+width/2,y,to,x-width/2,low,from,x+width/2,y,to,x-width/2,y,to], 3));
      support.computeVertexNormals(); physical(support, walkable, true);
      for (const side of [-1, 1]) {
        const rail = new THREE.BoxGeometry(0.12, 1.05, Math.hypot(to - from, rise)).toNonIndexed();
        rail.rotateX(-Math.atan2(rise, to - from)); rail.translate(x + side * (width / 2 + 0.08), (low + y) / 2 + 0.6, (from + to) / 2);
        physical(rail.clone(), colliders); colour(rail, LANDMARK_SIGN.band);
      }
    }
  }
  const top = plan.floors.at(-1)!;
  const ceiling = floorGeometry(plan.height(top.level) + 4.3, false);
  physical(ceiling.clone(), colliders); colour(ceiling, "#e4d9c8");
  const instances = plan.floors.flatMap(f => plan.counters.map(p => ({ p, y: plan.height(f.level), f })));
  const counterGeometry = new THREE.BoxGeometry(4, 1.1, 2); own.add(counterGeometry);
  const transforms = instances.map(({ p, y }) => new THREE.Matrix4().makeTranslation(p[0], y + 0.55, p[1]));
  for (const matrix of transforms) physical(counterGeometry.clone().applyMatrix4(matrix), colliders);
  const doorGeometry: T.BufferGeometry[] = [];
  // Join each supplied entrance to its existing station/street node, with source endpoint heights.
  for (const e of plan.input.entrances) {
    const outside = ctx.bundle.nodes.find(n => n.id === e.outsideNode)!;
    const a = new THREE.Vector3(...ctx.enuToRenderer({ ...outside.position, z: outside.position.z! }));
    const b = new THREE.Vector3(e.point[0], plan.height(e.level), e.point[1]);
    const perpendicular = new THREE.Vector3(b.z - a.z, 0, a.x - b.x).normalize().multiplyScalar(2);
    const corners = [a.clone().add(perpendicular), a.clone().sub(perpendicular), b.clone().sub(perpendicular), b.clone().add(perpendicular)];
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute([0,1,2,0,2,3].flatMap(i => corners[i]!.toArray()), 3)); g.computeVertexNormals();
    physical(g.clone(), walkable); colour(g, "#d2c6b4");
  }
  const shell = mergeGeometries(shells); own.add(shell);
  const counterMaterial = new THREE.MeshBasicMaterial({ color: "#928573" });
  let texture: T.CanvasTexture | null = null, signMaterial: T.MeshBasicMaterial | null = null;
  let loaded = false;
  const load = () => {
    const mesh = new THREE.Mesh(shell, material); root.add(mesh);
    const counters = new THREE.InstancedMesh(counterGeometry, counterMaterial, transforms.length);
    transforms.forEach((matrix, i) => counters.setMatrixAt(i, matrix)); counters.computeBoundingSphere(); root.add(counters);
    if (typeof document === "undefined") return;
    const labels = plan.floors.flatMap(f => [{ ja: `${plan.input.store.name.ja} ${f.level}`, en: f.label.en }, ...f.tenants]);
    labels.push({ ja: "階段", en: "Stairs" }, { ja: "駅方面 / 街路出口", en: "Station / Street" });
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = LANDMARK_MAX_TEXTURE_PX;
    const paint = canvas.getContext("2d")!; const row = canvas.height / labels.length;
    paint.fillStyle = LANDMARK_SIGN.band; paint.fillRect(0, 0, canvas.width, canvas.height);
    labels.forEach((label, i) => {
      paint.fillStyle = LANDMARK_SIGN.letters; paint.textAlign = "center";
      paint.font = `${Math.min(26, row * 0.55)}px sans-serif`; paint.fillText(label.ja, 256, i * row + row * 0.55, 495);
      paint.font = `${Math.min(12, row * 0.25)}px sans-serif`; paint.fillText(label.en, 256, i * row + row * 0.87, 495);
    });
    texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
    signMaterial = new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide });
    const board = (x: number, y: number, z: number, label: number, yaw = 0) => {
      const g = new THREE.PlaneGeometry(4, 0.75).toNonIndexed(); const uv = g.getAttribute("uv");
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (label + 1 - uv.getY(i)) / labels.length);
      g.rotateY(yaw); g.translate(x, y, z); own.add(g); doorGeometry.push(g);
    };
    let label = 0;
    for (const f of plan.floors) {
      const y = plan.height(f.level);
      for (const e of plan.input.entrances.filter(e => e.level === f.level)) board(e.point[0], y + 2.65, e.point[1], label, e.point[1] === plan.bounds.front ? 0 : Math.PI / 2);
      instances.filter(i => i.f === f).forEach(({ p }, i) => board(p[0], y + 1.65, p[1], label + (f.tenants.length ? 1 + i % f.tenants.length : 0)));
      board(plan.aisleX, y + 2.5, plan.stair.from - 1, labels.length - 2);
      label += f.tenants.length + 1;
    }
    const signs = mergeGeometries(doorGeometry); own.add(signs); root.add(new THREE.Mesh(signs, signMaterial));
  };
  return { root, walkable, colliders,
    update(camera: T.Camera) {
      const p = camera.getWorldPosition(new THREE.Vector3());
      const near = p.x > plan.bounds.left - 40 && p.x < plan.bounds.right + 40 && p.z > plan.bounds.front - 40 && p.z < plan.bounds.back + 40 && p.y < plan.height(top.level) + 12;
      if (near && !loaded) { loaded = true; load(); }
      root.visible = near;
    },
    dispose() { for (const g of own) g.dispose(); material.dispose(); counterMaterial.dispose(); collisionMaterial.dispose(); texture?.dispose(); signMaterial?.dispose(); },
  };
}
