// Lane F #339: adapter for the current procedural avatar (apps/web/src/explorer/avatar.ts).
// An adapter turns one avatar implementation into what slide.ts measures: a rig it can step and the
// world-space sole probes of each foot. F1 adds an adapter for the rigged character next to this one.
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { P3 } from "../../../tests/e2e/lib/footSlide.ts";

/** The parts of a three.js Object3D the harness uses (it never imports three itself, so it shares the checkout's copy). */
export interface Obj {
  name: string;
  children: Obj[];
  position: { set(x: number, y: number, z: number): void };
  rotation: { y: number };
  matrixWorld: { elements: number[] };
  add(o: Obj): void;
  updateMatrixWorld(force?: boolean): void;
  geometry?: { attributes: { position: { count: number; getX(i: number): number; getY(i: number): number; getZ(i: number): number } } };
}

export interface Motion { yaw: number; speed: number }

export interface AvatarUnderTest {
  /** Parent group the harness moves and turns like explorer.ts does with its `avatar` group. */
  group: Obj;
  /** Same call order as Explorer.step: motion from the walker's move, then the rig, then the group transform. */
  step(dt: number, prev: { x: number; z: number }, cur: { x: number; y: number; z: number }): Motion;
  /** Per foot (left, right): world-space sole probes (heel, toe). Call after step(). */
  probes(): P3[][];
  /** Rendered triangles of the avatar (index count / 3 over its meshes), for the size baseline. */
  triangles(): number;
  dispose(): void;
}

export interface Adapter {
  name: string;
  create(root: string, quality: "high" | "low"): Promise<AvatarUnderTest>;
}

const find = (o: Obj, name: string): Obj | null => {
  if (o.name === name) return o;
  for (const c of o.children) { const f = find(c, name); if (f) return f; }
  return null;
};

/** Heel and toe on the sole's bottom plane, in the mesh's own frame (the avatar faces -Z, so the toe is min z). */
function soleProbes(mesh: Obj): P3[] {
  const a = mesh.geometry!.attributes.position;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < a.count; i++) {
    x0 = Math.min(x0, a.getX(i)); x1 = Math.max(x1, a.getX(i)); y0 = Math.min(y0, a.getY(i));
    z0 = Math.min(z0, a.getZ(i)); z1 = Math.max(z1, a.getZ(i));
  }
  const cx = (x0 + x1) / 2;
  return [{ x: cx, y: y0, z: z1 }, { x: cx, y: y0, z: z0 }];
}

const toWorld = (m: number[], p: P3): P3 => ({
  x: m[0]! * p.x + m[4]! * p.y + m[8]! * p.z + m[12]!,
  y: m[1]! * p.x + m[5]! * p.y + m[9]! * p.z + m[13]!,
  z: m[2]! * p.x + m[6]! * p.y + m[10]! * p.z + m[14]!,
});

export const procedural: Adapter = {
  name: "procedural (apps/web/src/explorer/avatar.ts)",
  async create(root, quality) {
    const src = (f: string) => pathToFileURL(path.join(root, "apps/web/src/explorer", f)).href;
    const { createAvatar } = await import(src("avatar.ts"));
    const { avatarMotion } = await import(src("avatarMotion.ts"));
    const rig = createAvatar({ quality });
    const Group = (rig.root as Obj).constructor as new () => Obj;
    const group = new Group();
    group.add(rig.root);
    const soles = ["soleL", "soleR"].map((n) => {
      const m = find(rig.root, n);
      if (!m?.geometry) throw new Error(`procedural avatar: no ${n} mesh (avatar.ts changed?)`);
      return { mesh: m, local: soleProbes(m) };
    });
    let bodyYaw = 0;
    return {
      group,
      step(dt, prev, cur) {
        const motion: Motion = avatarMotion(prev, cur, dt, bodyYaw, 0);
        bodyYaw = motion.yaw;
        rig.update(dt, motion.speed);
        group.position.set(cur.x, cur.y, cur.z);
        group.rotation.y = bodyYaw;
        group.updateMatrixWorld(true);
        return motion;
      },
      probes: () => soles.map((s) => s.local.map((p) => toWorld(s.mesh.matrixWorld.elements, p))),
      triangles() {
        let n = 0;
        const walk = (o: Obj & { index?: unknown }) => {
          const g = o.geometry as unknown as { index: { count: number } | null; attributes: { position: { count: number } } } | undefined;
          if (g) n += (g.index ? g.index.count : g.attributes.position.count) / 3;
          for (const c of o.children) walk(c);
        };
        walk(rig.root);
        return n;
      },
      dispose: () => rig.dispose(),
    };
  },
};
