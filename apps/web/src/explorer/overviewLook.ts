import * as THREE from "three";

/**
 * Presentation of the overview (orbit) camera, which sits hundreds of metres from the station:
 * - No fog: a station's fog is tuned for walking (tens of metres) and would black the whole model out.
 * - Cutaway: double-sided surfaces draw front faces only, so ceilings and slabs seen from above (their
 *   back faces) drop away and the lit floors, columns and people inside read like a dollhouse.
 * Both are restored exactly when the camera returns to walking, or before the station is cleared.
 */
export class OverviewLook {
  private active = false;
  private fog: THREE.Scene["fog"] = null;
  private readonly sides = new Map<THREE.Material, THREE.Side>();

  get isActive(): boolean {
    return this.active;
  }

  set(scene: THREE.Scene, root: THREE.Object3D, on: boolean): void {
    if (on === this.active) return;
    this.active = on;
    if (on) {
      this.fog = scene.fog;
      scene.fog = null;
      root.traverse((o) => {
        const m = (o as THREE.Mesh).material;
        if (!(o as THREE.Mesh).isMesh || !m) return;
        for (const mat of Array.isArray(m) ? m : [m]) {
          if (mat.side !== THREE.DoubleSide || this.sides.has(mat)) continue;
          this.sides.set(mat, mat.side);
          mat.side = THREE.FrontSide;
        }
      });
    } else {
      scene.fog = this.fog;
      this.fog = null;
      for (const [mat, side] of this.sides) mat.side = side;
      this.sides.clear();
    }
  }
}
