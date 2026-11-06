/**
 * Neutral decorative wall props in the Ikebukuro B1 scene (#858 item 12), ENU metres. Presentation only:
 * no POI, no routing, no brand or readable text. Placements were scanned against the floor, walls, edges,
 * gates and shop openings; `wall-props.test.ts` keeps every footprint (expanded by the walker's radius)
 * clear of the graph's edge polylines.
 */
import type { WallPropPlacement } from "@gteki/scene-api";

const wallProps: WallPropPlacement[] = [
  // East exit passage, south face, in the recess beside the opening. The interactive machine stands here.
  { id: "ikb-vending-w", kind: "vending", wall: [-30.46, 63.2], n: [0.395, 0.919], z: 27.91, w: 1.1, d: 0.75, interaction: "ikb-vending-1" },
  { id: "ikb-vending-e", kind: "vending", wall: [66.81, 31.07], n: [-0.395, -0.919], z: 28.49, w: 1.1, d: 0.75 },
  { id: "ikb-kiosk-s", kind: "kiosk", wall: [60.94, 113.53], n: [0.919, -0.395], z: 28.35, w: 2.1, d: 0.75 },
];

export default wallProps;
