import { it } from "vitest";
import * as THREE from "three";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import type { Plan } from "../scene/layout.ts";
import { buildStation } from "../scene/build.ts";
import { withCanvasStub } from "./helpers/scene-digest.ts";

it("lists level-B6 meshes", () => {
  const { bundle } = loadShinjukuBundle();
  const built = withCanvasStub(() => buildStation(bundle, planJson as unknown as Plan, { quality: "low" }));
  const g = built.root.getObjectByName("level-B6")!;
  const rows = g.children.map((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return `group: ${o.name || o.type}`;
    const material = Array.isArray(m.material) ? m.material.map((x) => x.name).join("+") : m.material.name;
    return `${m.name || "(mesh)"} | ${material} | inst=${m instanceof THREE.InstancedMesh} count=${m instanceof THREE.InstancedMesh ? m.count : "-"} | tight=${!!o.userData.tightCulling}`;
  });
  console.log("B6 CHILDREN (" + rows.filter((r) => !r.startsWith("group:")).length + " meshes)\n" + rows.join("\n"));
  built.dispose();
}, 120_000);
