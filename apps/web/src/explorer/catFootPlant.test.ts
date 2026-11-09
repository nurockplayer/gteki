import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { loadGlbAvatar } from "./avatarGlb.ts";
import { CAT_AVATAR_HEIGHT_M } from "./avatarSelection.ts";

const names = ["forepaw_L", "forepaw_R", "hindpaw_L", "hindpaw_R"];
const dt = 1 / 60;

describe("real cat world-space foot plant", () => {
  // 2026-11-09 16:39 JST, drift / bone dip in mm (fore L, fore R, hind L, hind R):
  // 0.9 m/s: 14.38/1.31, 11.56/1.50, 11.25/1.94, 17.92/1.42
  // 1.4 m/s: 16.81/1.31, 16.89/1.50, 16.88/1.94, 16.90/1.42
  // 2.6 m/s: 18.16/7.01, 36.40/4.07, 18.41/4.90, 40.18/4.92
  it.fails("keeps planted paws still and above the floor", async () => {
    const data = readFileSync(new URL("../../public/avatars/cat.glb", import.meta.url));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
    const rows: { speed: number; paw: string; drift: number; penetration: number; stretches: number }[] = [];
    for (const speed of [0.9, 1.4, 2.6]) {
      const gltf = await new Promise<import("three/examples/jsm/loaders/GLTFLoader.js").GLTF>((resolve, reject) =>
        new GLTFLoader().parse(buffer, "", resolve, reject));
      const rig = await loadGlbAvatar("/cat.glb", { quality: "low", loader: { loadAsync: async () => gltf }, heightM: CAT_AVATAR_HEIGHT_M, cat: true });
      const parent = new THREE.Group();
      parent.add(rig.root);
      const paws = names.map((name) => {
        const paw = rig.root.getObjectByName(name);
        expect(paw, name).toBeDefined();
        return paw!;
      });
      const rest = paws.map((paw) => paw.getWorldPosition(new THREE.Vector3()).y);
      for (let i = 0; i < 180; i++) rig.update(dt, speed);
      const samples = paws.map(() => [] as THREE.Vector3[]);
      for (let i = 0; i < 240; i++) {
        parent.position.z -= speed * dt;
        rig.update(dt, speed);
        paws.forEach((paw, j) => samples[j]!.push(paw.getWorldPosition(new THREE.Vector3())));
      }
      paws.forEach((_, j) => {
        let first: THREE.Vector3 | undefined;
        let last: THREE.Vector3 | undefined;
        let count = 0, drift = 0, penetration = 0, stretches = 0;
        const finish = () => {
          if (count >= 3) {
            stretches++;
            drift = Math.max(drift, Math.hypot(last!.x - first!.x, last!.z - first!.z));
          }
          first = last = undefined;
          count = 0;
        };
        for (const point of samples[j]!) {
          penetration = Math.max(penetration, rest[j]! - point.y);
          if (point.y < rest[j]! + 0.01) {
            first ??= point;
            last = point;
            count++;
          } else finish();
        }
        finish();
        rows.push({ speed, paw: names[j]!, drift, penetration, stretches });
      });
      rig.dispose();
    }
    console.table(rows);
    for (const row of rows) {
      expect(row.stretches, `${row.speed} ${row.paw} planted stretches`).toBeGreaterThan(0);
      expect(row.drift, `${row.speed} ${row.paw} drift`).toBeLessThanOrEqual(0.010);
      expect(row.penetration, `${row.speed} ${row.paw} penetration`).toBeLessThanOrEqual(0.005);
    }
  });
});
