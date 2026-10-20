// Station-local inspection harness (not the product shell). Orbit around the
// PLATEAU B1 model with debug colours, or ?mode=top for an orthographic plan.
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

const params = new URLSearchParams(location.search);
const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
document.body.appendChild(renderer.domElement);
// Cutaway: hide everything above ?clip=<TP height m> (default 29.6 m) for plan inspection.
const clip = new THREE.Plane(new THREE.Vector3(0, -1, 0), Number(params.get("clip") ?? 29.6));
renderer.clippingPlanes = params.get("clip") === "off" ? [] : [clip];
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0d10);
const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 2000);
camera.position.set(Number(params.get("cx") ?? 0), Number(params.get("cy") ?? 60), Number(params.get("cz") ?? 0) + 80);
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(Number(params.get("tx") ?? 0), 28, -Number(params.get("ty") ?? 60));
camera.position.set(controls.target.x + 40, 90, controls.target.z + 60);
scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 1.6));
const sun = new THREE.DirectionalLight(0xffffff, 1.5);
sun.position.set(50, 100, 30);
scene.add(sun);

const COLORS: Record<string, number> = {
  floor: 0xc9c2b6, wall: 0x8fa3b8, ceiling: 0x555555, stairs_ramps: 0xffc400, transport: 0xff3dbb,
  barriers: 0x6c7a89, floor_elements: 0x2ecc71, doors: 0x2f80ff, windows: 0x6fe3ff, portals: 0xff2020,
};
const hidden = new Set((params.get("hide") ?? "ceiling").split(","));
new GLTFLoader().load(params.get("glb") ?? "/build/test_b1.glb", (g) => {
  g.scene.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const role = (m.userData.gteki_role as string) ?? m.name;
    m.material = new THREE.MeshStandardMaterial({
      color: COLORS[role] ?? 0xffffff, side: THREE.DoubleSide, roughness: 0.8,
      transparent: role === "portals", opacity: role === "portals" ? 0.45 : 1,
    });
    m.visible = !hidden.has(role);
  });
  scene.add(g.scene);
  (window as any).gltf = g;
});
const hud = document.getElementById("hud")!;
function frame() {
  controls.update();
  renderer.render(scene, camera);
  const t = controls.target;
  hud.textContent = `target ENU x=${t.x.toFixed(1)} y=${(-t.z).toFixed(1)} z=${t.y.toFixed(1)}`;
  requestAnimationFrame(frame);
}
frame();
addEventListener("resize", () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});
(window as any).cam = { camera, controls, THREE, clip };
