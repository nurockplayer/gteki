import type * as THREE from "three";

/**
 * The meshes a list of scene objects stands for when ray-tested. A scene's `walkable` / `colliders` are
 * `Object3D[]`, so floors and walls may arrive nested inside a `THREE.Group`. A listed Mesh stands for
 * itself only (a GLB's classified lists name every physical mesh, so a "visual" child under a floor stays
 * visual); a listed non-mesh stands for every Mesh below it. Nothing else counts (sprites, lines, helpers
 * and labels never do; a three.js helper and everything below it is pruned, even though some helpers are
 * meshes, and so is a listed object inside one), and a subtree the scene filed in the other list keeps that classification.
 */
export function castTargets(objects: readonly THREE.Object3D[], filedElsewhere: readonly THREE.Object3D[] = []): THREE.Object3D[] {
  const own = new Set(objects);
  const other = new Set(filedElsewhere.filter((o) => !own.has(o)));
  const out = new Set<THREE.Object3D>();
  const visit = (o: THREE.Object3D) => {
    if (other.has(o) || isHelper(o)) return;
    if ((o as THREE.Mesh).isMesh) out.add(o);
    for (const child of o.children) visit(child);
  };
  for (const o of objects) {
    // A listed mesh may be part of a helper (an ArrowHelper's cone that a GLB role pass picked up).
    if (insideHelper(o)) continue;
    if ((o as THREE.Mesh).isMesh) out.add(o);
    else visit(o);
  }
  return [...out];
}

/**
 * three.js helpers, core and addons: their `type` names a Helper (PointLightHelper is a Mesh, ArrowHelper
 * holds one, LightProbeGridHelperWebGL is an InstancedMesh), or they flag themselves (`isViewHelper`).
 */
function isHelper(o: THREE.Object3D): boolean {
  if (o.type.includes("Helper")) return true;
  const flags = o as unknown as Record<string, unknown>;
  return Object.keys(o).some((k) => /^is\w*Helper$/.test(k) && flags[k] === true);
}

function insideHelper(o: THREE.Object3D): boolean {
  for (let x: THREE.Object3D | null = o; x; x = x.parent) if (isHelper(x)) return true;
  return false;
}

/** Hits against precomputed `castTargets` (each target tested on its own, never its descendants). */
export function castAll(ray: THREE.Raycaster, targets: readonly THREE.Object3D[]): THREE.Intersection[] {
  return ray.intersectObjects(targets as THREE.Object3D[], false);
}
