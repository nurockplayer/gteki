/** pnpm exec tsx stations/shinjuku/test/helpers/scene-digest-fixture.ts  (baseline origin fe8d3b6; intentional #49 / #342 visual additions) */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import planJson from "../../data/plan.json" with { type: "json" };
import type { Plan } from "../../scene/layout.ts";
import { fullDigest } from "./scene-digest.ts";
const { bundle } = loadShinjukuBundle();
const digest = await fullDigest(bundle, planJson as unknown as Plan);
writeFileSync(fileURLToPath(new URL("../fixtures/scene-digest.json", import.meta.url)), JSON.stringify(digest, null, 1) + "\n");
console.log("written", Object.keys(digest.scene.low.visual).length, "visual groups");
