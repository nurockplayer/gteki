import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

/** #858 item 12: neutral vending machines and kiosks. Measured limit: +1 phone / +2 desktop draw per station. */
const FRAMES = "/private/tmp/gteki-vending";

for (const station of ["ikebukuro", "shinjuku"] as const) {
  test(`${station} wall props draw once per station and their reaction adds no draw @phone`, async ({ page, isMobile }) => {
    mkdirSync(FRAMES, { recursive: true });
    const tier = isMobile ? "phone" : "desktop";
    const shot = (name: string) => page.screenshot({ path: join(FRAMES, `${station}-${tier}-${name}.png`) });

    await openStation(page, station);
    const info = await page.evaluate(() => {
      const g = (window as any).__gteki.interactables();
      return { specs: g.specs, hasProps: !!g.props };
    });
    expect(info.hasProps).toBe(true);
    const spec = info.specs.find((s: { kind: string }) => s.kind === "vending");
    expect(spec, "a vending interactable").toBeTruthy();

    const walk = await page.evaluate((anchor) => (window as any).__gteki.walkPath([anchor], { maxSeconds: 45 }), spec.anchor);
    expect(walk.done).toBe(true);
    await hooks.simulate(page, 0.1);
    const prompt = page.locator(".interaction-prompt");
    const button = prompt.locator("button");
    await expect(button).toBeVisible();
    await expect(prompt).toContainText(/Simulated vending machine \(not a real one\)|模擬の自動販売機（実在の設備ではありません）/);
    await shot("idle");

    // Same frame, camera and avatar: props hidden, then shown. Only the props' own draws may differ.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    const frameDraws = () => page.evaluate(() => { const q = (window as any).__qa; const a = q.cur; (window as any).__gteki.simulate(0); return q.cur - a; });
    const { hidden, shown } = await page.evaluate(() => {
      const g = (window as any).__gteki, q = (window as any).__qa, props = g.interactables().props;
      const draws = () => { const a = q.cur; g.simulate(0); return q.cur - a; };
      props.visible = false;
      const hidden = draws();
      props.visible = true;
      return { hidden, shown: draws() };
    });
    const delta = shown - hidden;
    console.log(`RESULT ${station} tier=${tier} propsHidden=${hidden} propsShown=${shown} delta=${delta}`);
    expect(delta).toBeGreaterThan(0);
    expect(delta).toBeLessThanOrEqual(isMobile ? 1 : 2);

    const idleDraws = await frameDraws();
    const trigger = async () => { if (isMobile) await button.tap(); else await page.keyboard.press("KeyE"); };
    await trigger();
    for (const step of spec.steps as { id: string; seconds: number }[]) {
      // Ninety percent of each step never reaches the next transition.
      await hooks.simulate(page, step.seconds * 0.9);
      expect((await page.evaluate(() => (window as any).__gteki.interaction())).step).toBe(step.id);
      if (step.id === "react") {
        // The reaction is the same mesh's appended index range: same draw count as idle with the props shown.
        const reactDraws = await frameDraws();
        console.log(`RESULT ${station} tier=${tier} idleDraws=${idleDraws} reactDraws=${reactDraws}`);
        expect(reactDraws).toBe(idleDraws);
        await shot("react");
      }
    }

    if (station === "ikebukuro") {
      // The prop's collider is real: walk at it and stop outside its box.
      const box = await page.evaluate((anchor) => {
        const properties = (window as any).__gteki.interactables().props;
        const positions = properties.geometry.getAttribute("position");
        const min = { x: Infinity, z: Infinity }, max = { x: -Infinity, z: -Infinity };
        for (let i = 0; i < positions.count; i++) {
          const x = positions.getX(i), z = positions.getZ(i);
          if (Math.hypot(x - anchor.x, z - anchor.z) > 3) continue;
          min.x = Math.min(min.x, x); min.z = Math.min(min.z, z);
          max.x = Math.max(max.x, x); max.z = Math.max(max.z, z);
        }
        return { min, max };
      }, spec.anchor);
      const target = { x: (box.min.x + box.max.x) / 2, z: (box.min.z + box.max.z) / 2 };
      const into = await page.evaluate((point) => (window as any).__gteki.walkPath([point], { maxSeconds: 8 }), target);
      const avatar = await hooks.avatar(page);
      const inside = avatar.x > box.min.x && avatar.x < box.max.x && avatar.z > box.min.z && avatar.z < box.max.z;
      console.log(`RESULT ikebukuro tier=${tier} wallPropCollision=${JSON.stringify({ avatar, box, walk: into, inside })}`);
      expect(inside).toBe(false);
      await shot("collision");
    }
  });
}
