import type { SceneContext, StationScene } from "@gteki/scene-api";
import type { RailLane } from "@gteki/scene-api/rail-registry";
import { stairProfile } from "../stairProfile.ts";

/** An authored, shortened platform and its west-gate approach. No operator plan was traced. */
export default function buildYamanote(ctx: SceneContext, lane: RailLane): StationScene {
  const T = ctx.THREE, platform = lane.platforms[0]!;
  const [entry, end] = platform.centerline!;
  const [x, start] = entry, finish = end[1];
  const z = lane.levels.find(level => level.id === platform.level)!.z_m;
  const half = platform.width_m! / 2;
  const publicGate = lane.gates[0]!.position!, [sx, sy, sz] = lane.gates[1]!.position!;
  const seam = lane.openings![0]!.position[1] - 0.25;
  const root = new T.Group();
  root.name = "rail:jr-yamanote";
  const walkable: StationScene["walkable"] = [], colliders: NonNullable<StationScene["colliders"]> = [];
  const unit = new T.BoxGeometry();
  const concrete = new T.MeshStandardMaterial({ color: 0xb9b7af });
  const steel = new T.MeshStandardMaterial({ color: 0x637078 });
  const ballast = new T.MeshStandardMaterial({ color: 0x423d37 });
  const tactile = new T.MeshStandardMaterial({ color: 0xe5bd38 });
  const green = new T.MeshStandardMaterial({ color: 0x86b835 });
  const box = (material: import("three").Material, cx: number, cy: number, cz: number, width: number, length: number, height: number, target?: StationScene["walkable"]) => {
    const mesh = new T.Mesh(unit, material);
    mesh.position.set(...ctx.enuToRenderer({ x: cx, y: cy, z: cz }));
    mesh.scale.set(width, height, length);
    root.add(mesh);
    target?.push(mesh);
  };
  const length = finish - start, middle = (start + finish) / 2;
  // Overlap the top tread so a ground ray on the landing seam hits a surface.
  box(concrete, x, middle - 0.05, z - 0.18, 2 * half, length + 0.1, 0.36, walkable);
  box(concrete, sx, (seam + sy) / 2, sz - 0.18, 3.5, sy - seam, 0.36, walkable);
  const { steps, rise, tread, treadTop } = stairProfile({ x: sx, y: sy, z: sz }, { x, y: start, z });
  const stairs = new T.InstancedMesh(unit, concrete, steps);
  const matrix = new T.Matrix4();
  for (let i = 0; i < steps; i++) {
    matrix.makeScale(3.5, rise + 0.2, tread);
    matrix.setPosition(...ctx.enuToRenderer({ x, y: sy + (i + 0.5) * tread, z: treadTop(i) - (rise + 0.2) / 2 }));
    stairs.setMatrixAt(i, matrix);
  }
  root.add(stairs);
  walkable.push(stairs);

  for (const side of [-1, 1]) {
    box(steel, x + side * 1.15, (publicGate[1] + sy) / 2, sz + 0.48, 0.45, 1.3, 0.96, colliders);
    box(green, x + side * 1.15, (publicGate[1] + sy) / 2, sz + 0.98, 0.36, 1.1, 0.04);
    box(tactile, x + side * (half - 0.42), middle, z + 0.014, 0.32, length, 0.028);
    box(steel, x + side * (half - 0.06), middle, z + 0.58, 0.12, length, 1.16, colliders);
    box(steel, x + side * (half - 0.55), start + 12, z + 1.55, 0.2, 0.2, 3.1, colliders);
  }
  box(ballast, x + half + 1.6, middle, z - 0.55, 3.2, length, 0.3);
  for (const offset of [0.85, 2.3]) box(steel, x + half + offset, middle, z - 0.32, 0.09, length, 0.12);
  box(steel, x, finish - 0.08, z + 0.58, 2 * half, 0.16, 1.16, colliders);
  box(steel, x - 2.6, start, z + 0.58, 1.7, 0.16, 1.16, colliders);
  box(steel, x + 2.6, start, z + 0.58, 1.7, 0.16, 1.16, colliders);
  box(steel, x, start + 13, z + 3.13, 7, 12, 0.18);

  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 128;
  const ink = canvas.getContext("2d")!;
  ink.fillStyle = "#f7f8f4";
  ink.fillRect(0, 0, 512, 128);
  ink.fillStyle = "#83b432";
  ink.fillRect(0, 0, 92, 128);
  ink.fillStyle = "#162222";
  ink.font = "bold 54px sans-serif";
  ink.fillText(String(platform.number), 12, 80);
  ink.font = "bold 39px sans-serif";
  ink.fillText(`${lane.line.ja} 内回り`, 112, 54);
  ink.font = "25px sans-serif";
  ink.fillText(`${lane.line.en} · Preview`, 112, 97);
  const texture = new T.CanvasTexture(canvas);
  texture.colorSpace = T.SRGBColorSpace;
  const signMaterial = new T.MeshBasicMaterial({ map: texture });
  const signGeometry = new T.PlaneGeometry(3.4, 0.85);
  const sign = new T.Mesh(signGeometry, signMaterial);
  sign.position.set(...ctx.enuToRenderer({ x, y: start + 12, z: z + 2.63 }));
  root.add(sign);
  return { root, walkable, colliders, dispose() {
    stairs.dispose();
    for (const resource of [unit, concrete, steel, ballast, tactile, green, texture, signMaterial, signGeometry]) resource.dispose();
  } };
}
