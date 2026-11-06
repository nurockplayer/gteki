import { expect, test } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

for (const avatar of ["human", "cat"] as const) {
  test(`${avatar} can interact with the simulated bakery @phone`, async ({ page, isMobile }, info) => {
    await openStation(page, "ikebukuro", avatar === "cat" ? "&avatar=cat" : "&avatar=procedural");
    expect(await hooks.walkFromNode(page, "n_e")).toBe(true);
    const spec = await page.evaluate(() => (window as any).__gteki.interactables().specs[0]);
    expect(spec.id).toBe("ph-ikb-b1e-12");
    const walk = await page.evaluate((anchor) => (window as any).__gteki.walkPath([anchor], { maxSeconds: 30 }), spec.anchor);
    expect(walk.done).toBe(true);
    await hooks.simulate(page, 0.1);
    const prompt = page.locator(".interaction-prompt");
    const button = prompt.locator("button");
    await expect(button).toBeVisible();
    await expect(prompt).toContainText(/Simulated shop \(not a real store\)|模擬店（実在の店舗ではありません）/);
    const before = await hooks.avatar(page);
    const route = await hooks.route(page);
    await page.screenshot({ path: info.outputPath(`${avatar}-idle.png`) });
    // Drive the interaction with simulate() so screenshots do not advance its clock.
    await page.evaluate(() => { window.requestAnimationFrame = () => 0; });
    const frameDraws = () => page.evaluate(() => { const q = (window as any).__qa; const a = q.cur; (window as any).__gteki.simulate(0); return q.cur - a; });
    const trigger = async () => { if (isMobile) await button.tap(); else await page.keyboard.press("KeyE"); };
    if (isMobile) {
      const rects = await page.evaluate(() => {
        const box = (e: Element) => { const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
        const visible = (e: Element) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
        return { button: box(document.querySelector(".interaction-prompt button")!), others: [...document.querySelectorAll(".hud-row button, .minimap, .joystick.active")].filter(visible).map(box) };
      });
      console.log(`phoneRects=${JSON.stringify(rects)}`);
      for (const r of rects.others) expect(rects.button.x < r.x + r.width && rects.button.x + rects.button.width > r.x && rects.button.y < r.y + r.height && rects.button.y + rects.button.height > r.y).toBe(false);
    }
    await trigger();
    await hooks.simulate(page, 0.1, ["KeyW"]);
    expect((await page.evaluate(() => (window as any).__gteki.interaction())).items).toEqual([]);
    await hooks.walkFromNode(page, "n_e");
    await page.evaluate((anchor) => (window as any).__gteki.walkPath([anchor], { maxSeconds: 30 }), spec.anchor);
    await hooks.simulate(page, 0.1);
    const idle = await frameDraws();
    console.log(`stand=${JSON.stringify(spec.anchor)} idleDraws=${idle}`);
    expect(idle).toBeGreaterThan(1);
    await trigger();
    for (const [phase, seconds] of [["look", 0.1], ["sit", 1.2], ["react", 1.5], ["give", 1.2]] as const) {
      await hooks.simulate(page, seconds);
      expect((await page.evaluate(() => (window as any).__gteki.interaction())).step).toBe(phase);
      await page.screenshot({ path: info.outputPath(`${avatar}-${phase}.png`) });
      if (phase === "react") {
        // Same frame and camera, reaction hidden then shown, so only the reaction's own draws differ.
        const { off, on } = await page.evaluate(() => {
          const g = (window as any).__gteki, q = (window as any).__qa, visual = g.interactables().visual;
          const draws = () => { const a = q.cur; g.simulate(0); return q.cur - a; };
          visual.visible = false;
          const off = draws();
          visual.visible = true;
          return { off, on: draws() };
        });
        console.log(`reactionOff=${off} reactionOn=${on}`);
        expect(on).toBeGreaterThan(off);
        // High tier draws the reaction once more in GTAO's scene pass (#626: measured +2, the extra pass is inferred).
        expect(on - off).toBeLessThanOrEqual(isMobile ? 1 : 2);
      }
    }
    await hooks.simulate(page, 1.1);
    await expect(prompt).toContainText(/paper bag|紙袋/);
    await expect(button).toBeDisabled();
    expect(await hooks.route(page)).toEqual(route);
    const after = await hooks.avatar(page);
    expect(Math.hypot(after.x - before.x, after.y - before.y, after.z - before.z)).toBeLessThan(0.5);
    await page.screenshot({ path: info.outputPath(`${avatar}-done.png`) });
  });
}
