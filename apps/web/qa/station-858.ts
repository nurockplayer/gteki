// TEMPORARY one-off measurement page for #870 (not committed): GL calls and triangles at the E27
// platform with a train dwelling, using the same renderer.info technique as look.ts.
import * as THREE from "three";
import { loadShinjukuBundle } from "../../../stations/shinjuku/data/bundle.ts";
import planJson from "../../../stations/shinjuku/data/plan.json" with { type: "json" };
import { buildStation as headBuild } from "../../../stations/shinjuku/scene/build.ts";
import { buildStation as baseBuild } from "../../../stations/shinjuku/scene/build-858-base.ts";
import type { Plan } from "../../../stations/shinjuku/scene/layout.ts";

const q = new URLSearchParams(location.search);
const buildStation = q.get("base") === "1" ? baseBuild : headBuild;
const quality = q.get("quality") === "low" ? "low" : "high";

function fail(e: unknown): never {
  const el = document.getElementById("err")!;
  el.hidden = false;
  el.textContent = String((e as Error)?.stack ?? e);
  throw e;
}

try {
  const { bundle } = loadShinjukuBundle();
  const built = buildStation(bundle, planJson as unknown as Plan, { quality, reuseLayout: true, verifyRestrictedInput: true, timeBand: "midday" } as never);
  const renderer = new THREE.WebGLRenderer({ antialias: false });
  renderer.setPixelRatio(1);
  renderer.setSize(1280, 720);
  document.getElementById("host")!.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x101418);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 2));
  const sun = new THREE.DirectionalLight(0xffffff, 2);
  sun.position.set(30, 60, 20);
  scene.add(sun);

  built.root.updateMatrixWorld(true);
  built.update(0, 20); // dwell (tt 20 on the gi 0 track): train in, doors opening
  built.root.updateMatrixWorld(true);
  scene.add(built.root);
  built.root.updateMatrixWorld(true);

  const meshes: THREE.Mesh[] = [];
  built.root.traverse((o) => { if ((o as THREE.Mesh).isMesh && !Array.isArray((o as THREE.Mesh).material)) meshes.push(o as THREE.Mesh); });
  const mat = (m: THREE.Mesh) => (m.material as THREE.Material).name;
  const leaves = meshes.filter((m) => m instanceof THREE.InstancedMesh && mat(m) === "mat.psdLeaf") as THREE.InstancedMesh[];
  const bodies = meshes.filter((m) => m instanceof THREE.InstancedMesh && mat(m) === "mat.trainBody") as THREE.InstancedMesh[];
  if (!leaves.length || !bodies.length) throw new Error(`missing meshes: leaves=${leaves.length} bodies=${bodies.length}`);

  const leafMesh = leaves[0]!, bodyMesh = bodies[0]!;
  const a = new THREE.Matrix4(), b = new THREE.Matrix4();
  leafMesh.getMatrixAt(0, a); leafMesh.getMatrixAt(1, b);
  const p0 = new THREE.Vector3().setFromMatrixPosition(a).applyMatrix4(leafMesh.matrixWorld);
  const p1 = new THREE.Vector3().setFromMatrixPosition(b).applyMatrix4(leafMesh.matrixWorld);
  const opening = p0.clone().add(p1).multiplyScalar(0.5);
  let best = 0, bestD = Infinity;
  for (let i = 0; i < bodyMesh.count; i++) {
    bodyMesh.getMatrixAt(i, a);
    const d = new THREE.Vector3().setFromMatrixPosition(a).applyMatrix4(bodyMesh.matrixWorld).distanceTo(opening);
    if (d < bestD) (bestD = d), (best = i);
  }
  bodyMesh.getMatrixAt(best, a);
  const car = new THREE.Vector3().setFromMatrixPosition(a).applyMatrix4(bodyMesh.matrixWorld);
  const away = opening.clone().sub(car); away.y = 0; away.normalize();
  const camera = new THREE.PerspectiveCamera(60, 1280 / 720, 0.05, 200);
  camera.position.copy(opening).addScaledVector(away, 6);
  camera.position.y = opening.y + 3;
  camera.lookAt(car.x, car.y + 2, car.z);
  camera.updateMatrixWorld();

  renderer.render(scene, camera); // warm-up (upload/compile)
  const ri = renderer.info;
  ri.autoReset = false;
  ri.reset();
  renderer.render(scene, camera);
  const result = {
    quality,
    drawCalls: ri.render.calls,
    triangles: ri.render.triangles,
    geometryMemory: ri.memory.geometries,
    textures: ri.memory.textures,
    glRenderer: (() => {
      const gl = renderer.getContext();
      const ext = gl.getExtension("WEBGL_debug_renderer_info");
      return ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
    })(),
  };
  (window as unknown as { __stationGl: unknown }).__stationGl = result;
  document.title = "done";
} catch (e) {
  fail(e);
}
