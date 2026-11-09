import * as THREE from "three";

/**
 * Soft blob shadow under a character. Baked-lightmap stations have no dynamic lights, so without it a
 * walker floats over the floor; with default lighting it softens the real shadow's contact edge.
 */
export function contactShadow(radiusM = 0.5, opacity = 0.42): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const g = canvas.getContext("2d", { willReadFrequently: true })!;
  const grd = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, "rgba(0,0,0,1)");
  grd.addColorStop(0.45, "rgba(0,0,0,0.55)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, size, size);
  const map = new THREE.CanvasTexture(canvas);
  const material = new THREE.MeshBasicMaterial({ map, color: 0x000000, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(radiusM * 2, radiusM * 2).rotateX(-Math.PI / 2), material);
  mesh.position.y = 0.012;
  mesh.renderOrder = 1;
  mesh.name = "contact-shadow";
  return mesh;
}

/** Opacity of a paw contact shadow at its height above the avatar floor. */
export function pawShadowState(pawWorldY: number, floorY: number): number {
  return 0.5 * Math.max(0, Math.min(1, (0.06 - (pawWorldY - floorY)) / 0.05));
}

const pawNames = ["forepaw_L", "forepaw_R", "hindpaw_L", "hindpaw_R"];
const pawBones = new WeakMap<THREE.Object3D, (THREE.Object3D | undefined)[]>();
const pawPosition = new THREE.Vector3();

/** Place each paw shadow beneath its bone in avatar-local coordinates. */
export function placePawShadows(shadows: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>[], rigRoot: THREE.Object3D, avatar: THREE.Object3D, floorY: number): void {
  let paws = pawBones.get(rigRoot);
  if (!paws) {
    paws = pawNames.map((name) => rigRoot.getObjectByName(name));
    pawBones.set(rigRoot, paws);
  }
  for (let i = 0; i < shadows.length; i++) {
    const paw = paws[i];
    if (!paw) continue;
    const shadow = shadows[i]!;
    paw.getWorldPosition(pawPosition);
    shadow.material.opacity = pawShadowState(pawPosition.y, floorY);
    avatar.worldToLocal(pawPosition);
    shadow.position.set(pawPosition.x, 0.012, pawPosition.z);
  }
}
