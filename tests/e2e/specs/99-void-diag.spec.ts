// Temporary diagnosis, 2026-11-13 JST.
import { test, expect } from '@playwright/test';
import { PROBE_SCRIPT, settleFrames } from '../lib/gteki.ts';

test('sj-stair-2-bottom surface diagnosis', async ({ page }) => {
  test.setTimeout(700_000);
  await page.addInitScript(() => { localStorage.setItem('gteki.firstRunDone', '1'); });
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto('/?station=shinjuku&lang=en');
  await page.waitForFunction(() => (window as any).__gteki?.phase?.() === 'ready', null, { timeout: 360_000, polling: 250 });
  await settleFrames(page, 'void diagnosis station ready');
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
    const placement = await page.evaluate(() => (window as any).__gteki.setView({ node: 'n:51435d9112ba409e8ad5ab02dbbd060f', headingDeg: 60 }));
    expect(placement.placed).toBe(true);
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const result = await page.evaluate(() => {
      const g = (window as any).__gteki, e = g.scanProbe().explorer;
      const { scene, renderer, camera } = e, station = e.stationScene.root;
      const surface = station.getObjectByName('surface-render-only');
      if (!surface) throw new Error('surface root unavailable');
      const gl = renderer.getContext(), original = scene.onBeforeRender;
      let force = false, renderState: any, pixels: Uint8Array | undefined;
      scene.onBeforeRender = function (...args: any[]) {
        original.apply(this, args);
        renderState = { visible: surface.visible, diagnostic: surface.userData.diag1180, camera: camera.position.toArray() };
        if (force) surface.visible = true;
      };
      const read = gl.readPixels;
      gl.readPixels = function (...args: any[]) {
        const value = read.apply(this, args);
        if (args[2] === 320 && args[3] === 200 && args[6] instanceof Uint8Array && !pixels) pixels = args[6].slice();
        return value;
      };
      try {
        const baseline = g.goldenProbe(false).voidRatio, baselineState = renderState;
        force = true; pixels = undefined;
        const forced = g.goldenProbe(false).voidRatio, forcedState = renderState;
        if (!pixels) throw new Error('void pixels unavailable');
        const meshes: any[] = [];
        station.traverse((o: any) => {
          if (!o.isMesh) return;
          for (let p = o; p; p = p.parent) if (p.name === 'gteki:graph-overlay') return;
          meshes.push(o);
        });
        const ray = new e.ray.constructor(); ray.layers.mask = camera.layers.mask; ray.firstHitOnly = false;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const groups = new Map<string, any>(); let noVisibleHit = 0, voidPixels = 0;
        for (let i = 0; i < 64000; i++) {
          if (pixels[i * 4] !== 255 || pixels[i * 4 + 1] !== 0 || pixels[i * 4 + 2] !== 255) continue;
          voidPixels++;
          ray.setFromCamera({ x: ((i % 320) + 0.5) / 160 - 1, y: (Math.floor(i / 320) + 0.5) / 100 - 1 }, camera);
          const hit = ray.intersectObjects(meshes, false).find((h: any) => {
            if (h.distance < 0.05) return false;
            for (let o = h.object; o; o = o.parent) if (!o.visible && o !== surface) return false;
            const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
            return m?.visible !== false;
          });
          if (!hit) { noVisibleHit++; continue; }
          const o = hit.object, m = Array.isArray(o.material) ? o.material[hit.face?.materialIndex ?? 0] : o.material;
          const key = `${o.uuid}:${m.uuid}`, group = groups.get(key) ?? { name: o.name, uuid: o.uuid, material: m.name, point: hit.point.toArray(), count: 0 };
          group.count++; groups.set(key, group);
        }
        return { baseline, baselineState, forced, forcedState, voidPixels, noVisibleHit, groups: [...groups.values()] };
      } finally { gl.readPixels = read; scene.onBeforeRender = original; }
    });
    console.log(`[void-diag-1180] ${JSON.stringify(result)}`);
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
