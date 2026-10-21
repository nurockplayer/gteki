import * as THREE from "three";

/**
 * A thin overlay line drawn in two passes so it reads as part of the scene instead of x-ray:
 * a depth-tested solid pass where the line is in front of geometry, and a faint dashed pass drawn
 * only where it is behind geometry (still discoverable, clearly "behind"). `setXray(true)` restores
 * the old always-on-top look for overview: solid pass ignores depth, occluded pass is off.
 * GTAOPass hides every `isLine` object in its depth/normal render, so neither pass casts AO.
 */
export interface OccludedLineStyle {
  visible: THREE.LineBasicMaterial;
  occluded: THREE.LineDashedMaterial;
  /** Both lines for `geometry` (occluded first, one renderOrder below the visible one). */
  lines(geometry: THREE.BufferGeometry, renderOrder: number): THREE.Line[];
  setXray(on: boolean): void;
}

export function occludedLineStyle(color: number, opacity: number, occludedOpacity = 0.2): OccludedLineStyle {
  const visible = new THREE.LineBasicMaterial({ color, transparent: true, opacity, depthTest: true, depthWrite: false, toneMapped: false });
  const occluded = new THREE.LineDashedMaterial({ color, transparent: true, opacity: occludedOpacity, dashSize: 0.5, gapSize: 0.4, depthTest: true, depthFunc: THREE.GreaterDepth, depthWrite: false, toneMapped: false });
  return {
    visible,
    occluded,
    lines(geometry, renderOrder) {
      const solid = new THREE.Line(geometry, visible);
      solid.renderOrder = renderOrder;
      const dashed = new THREE.Line(geometry, occluded);
      dashed.renderOrder = renderOrder - 1;
      dashed.computeLineDistances();
      return [dashed, solid];
    },
    setXray(on) {
      visible.depthTest = !on;
      occluded.visible = !on;
    },
  };
}
