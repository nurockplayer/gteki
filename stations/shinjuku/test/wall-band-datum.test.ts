import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import planJson from "../data/plan.json" with { type: "json" };
import { cladWallGeometry } from "../scene/build.ts";
import { buildLayout, type Plan, type WallSeg } from "../scene/layout.ts";

it("aligns the envelope and source-wall bands in the B3 corridor at 453ea111", () => {
  const { bundle } = loadShinjukuBundle();
  const node = bundle.nodes.find((n) => n.id === "n:453ea111f1524cef8f3ac139bbf2e26b")!;
  const layout = buildLayout(bundle, planJson as unknown as Plan);
  const level = layout.levels.find((lv) => lv.floorId === node.floorId)!;
  const { x, y } = node.position;
  const distance = ({ a, b }: WallSeg) => {
    const dx = b.x - a.x, dy = b.y - a.y;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (y - a.y) * dy) / (dx * dx + dy * dy)));
    return Math.hypot(x - a.x - t * dx, y - a.y - t * dy);
  };
  const nearby = level.walls.filter((w) => w.kind === "wall" && distance(w) < 6)
    .sort((a, b) => distance(a) - distance(b));
  const envelope = nearby.find((w) => w.finish === "shaft" && w.zMax === level.ceilingZ &&
    w.profile?.bottomA === level.z - 0.2 && w.profile.bottomB === w.profile.bottomA);
  const source = nearby.find((w) => !w.finish && w.zMin === level.z && w.zMax === level.ceilingZ);
  const heights = (wall: WallSeg) => {
    const geometry = cladWallGeometry([wall])!;
    const datum = geometry.attributes.position!.getY(0) - 3.2 * geometry.attributes.uv!.getY(0);
    geometry.dispose();
    // World heights of the top edges of the stripe and kick in the wall texture.
    return { stripe: datum + 2.35, kick: datum + 1.05 };
  };
  const a = heights(envelope!), b = heights(source!);
  expect(Math.max(Math.abs(a.stripe - b.stripe), Math.abs(a.kick - b.kick)),
    `Band tops (m ENU): envelope ${JSON.stringify(a)}, source wall ${JSON.stringify(b)}`).toBeLessThanOrEqual(0.01);
}, 120_000);
