import { createRouter, DEFAULT_PROFILE } from "@gteki/navigation";
import { expect, it } from "vitest";
import { loadShinjukuBundle } from "../data/bundle.ts";
import { previewBundle } from "../gteki/scene.ts";

it("connects the next-only Yamanote platform to the north B1 concourse through a fare gate", async () => {
  const { bundle } = loadShinjukuBundle();
  const north = "n:9ff85d09ae4e40469ec227099d95c775";
  const platform = "rail:jr-yamanote:14";
  expect(createRouter(bundle).route([north], [platform], DEFAULT_PROFILE)).toMatchObject({ ok: false, reason: "unknown_goal" });
  const router = createRouter(await previewBundle(bundle));
  expect(router.route([north], [platform], DEFAULT_PROFILE)).toMatchObject({
    ok: true,
    steps: expect.arrayContaining([expect.objectContaining({ mode: "gate" })]),
  });
  expect(router.route([north], [platform], { ...DEFAULT_PROFILE, fare: "unpaid_only" })).toMatchObject({ ok: false, reason: "no_path" });
});
