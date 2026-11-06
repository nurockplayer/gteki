/**
 * Neutral decorative wall props in the Shinjuku scene (#858 item 12), ENU metres. Presentation only:
 * no POI, no routing, no brand or readable text. Each prop is at most WALKER_BODY.radiusM deep and flush to
 * a built wall, so the wall already keeps the walker's centre out of it: no collider is added.
 * `test/wall-props.test.ts` checks both against buildLayout's walls.
 */
import type { WallPropPlacement } from "@gteki/scene-api";

const wallProps: WallPropPlacement[] = [
  // B1 concourse wall. The interactive machine stands here.
  { id: "sjk-vending-w", kind: "vending", wall: [-61.41, 175.5], n: [0.385, -0.923], z: -7.8, w: 1.1, d: 0.28, interaction: "sjk-vending-1" },
  { id: "sjk-vending-e", kind: "vending", wall: [-48.14, 169.53], n: [-0.383, 0.924], z: -7.8, w: 1.1, d: 0.28 },
  { id: "sjk-kiosk-s", kind: "kiosk", wall: [-87.175, 164.55], n: [0.413, -0.911], z: -7.8, w: 2.1, d: 0.28 },
];

export default wallProps;
