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
