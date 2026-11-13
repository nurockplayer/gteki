// Temporary read-only render diagnosis, 2026-11-13 JST.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PROBE_SCRIPT, settleFrames } from '../lib/gteki.ts';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test('slice-09-b3-sign void diagnosis', async ({ page }) => {
  test.setTimeout(700_000);
  const out = path.resolve(import.meta.dirname, '../artifacts/void-diag');
  fs.mkdirSync(out, { recursive: true });
  const config = JSON.parse(fs.readFileSync(new URL('../golden-cameras.json', import.meta.url), 'utf8'));
  const pose = config.cameras.find((c: any) => c.id === 'slice-09-b3-sign');
  // Same station setup as openStation, with a diagnosis-only six-minute ready budget.
  await page.addInitScript(() => { localStorage.setItem('gteki.firstRunDone', '1'); });
  await page.addInitScript(PROBE_SCRIPT);
  await page.goto(`/?station=${pose.station}&lang=en`);
  await page.waitForFunction(() => typeof (window as any).__gteki?.phase === 'function', null, { timeout: 30_000, polling: 250 });
  await page.waitForFunction(() => (window as any).__gteki.phase() === 'ready', null, { timeout: 360_000, polling: 250 });
  await expect(page.locator('.chips .chip').first()).toBeAttached();
  await settleFrames(page, 'void diagnosis station ready');
  await page.evaluate(() => (window as any).__gteki.holdFrames(true));
  try {
    const placement = await page.evaluate(p => (window as any).__gteki.setView({ node: p.node, headingDeg: p.headingDeg }), pose);
    expect(placement.placed).toBe(true);
    await page.evaluate(() => (window as any).__gteki.goldenFrame());
    const result = await page.evaluate(() => {
      const g = (window as any).__gteki, e = g.scanProbe?.().explorer;
      if (!e?.scene || !e?.renderer || !e?.camera || !e?.ray) return { decision: 'Scene/renderer/camera/Raycaster not reachable through __gteki' };
      const { scene, renderer, camera } = e, gl = renderer.getContext();
      const root = e.stationScene?.root;
      if (!root) return { decision: 'Station root unavailable' };
      const objects: any[] = [], meshes: any[] = [];
      scene.traverse((o: any) => { objects.push(o); if (o.isMesh) meshes.push(o); });
      const levels = root.children.filter((o: any) => o.isGroup && o.name.startsWith('level-'));
      const materials = [...new Set(meshes.flatMap(o => Array.isArray(o.material) ? o.material : [o.material]))];
      const originalBefore = scene.onBeforeRender;
      const savedVisibility = new Map<any, boolean>(objects.map(o => [o, o.visible]));
      const savedSides = new Map<any, number>(materials.map(m => [m, m.side]));
      const savedCulling = new Map<any, any>(objects.map(o => [o, { frustumCulled: o.frustumCulled, before: o.onBeforeRender, count: o.count }]));
      const restore = () => {
        for (const [o, visible] of savedVisibility) o.visible = visible;
        for (const [m, side] of savedSides) { if (m.side !== side) { m.side = side; m.needsUpdate = true; } }
        for (const [o, saved] of savedCulling) {
          o.frustumCulled = saved.frustumCulled; o.onBeforeRender = saved.before;
          if (saved.count !== undefined) o.count = saved.count;
        }
      };
      let mode = 'baseline', renderVisibility: Map<any, boolean> | undefined;
      const hookFrames: any[] = [];
      scene.onBeforeRender = function (...args: any[]) {
        originalBefore.apply(this, args);
        const hiddenLevels = levels.filter((o: any) => !o.visible).map((o: any) => o.name);
        if (mode === 'levels') for (const o of levels) o.visible = true;
        if (mode === 'all-visible') for (const o of objects) o.visible = true;
        if (mode === 'double-side') for (const m of materials) { m.side = 2; m.needsUpdate = true; }
        if (mode === 'no-culling') for (const o of objects) {
          o.frustumCulled = false;
          if (o.userData.tightCulling) { o.onBeforeRender = () => {}; o.count = 1; }
        }
        renderVisibility = new Map(objects.map(o => [o, o.visible]));
        hookFrames.push({ mode, hiddenLevelsBeforeToggle: hiddenLevels, hiddenLevelsAfterToggle: levels.filter((o: any) => !o.visible).map((o: any) => o.name) });
      };
      const capture = () => {
        let pixels: Uint8Array | undefined;
        const originalRead = gl.readPixels;
        gl.readPixels = function (...args: any[]) {
          const value = originalRead.apply(this, args);
          if (!pixels && args[2] === 320 && args[3] === 200 && args[6] instanceof Uint8Array) pixels = args[6].slice();
          return value;
        };
        try {
          const voidRatio = g.goldenProbe(false).voidRatio;
          if (!pixels) throw new Error('No 320x200 pixels captured');
          return { voidRatio, pixels };
        } finally {
          gl.readPixels = originalRead;
          restore();
        }
      };
      const magenta = (pixels: Uint8Array, i: number) => pixels[i * 4] === 255 && pixels[i * 4 + 1] === 0 && pixels[i * 4 + 2] === 255;
      const png = (pixels: Uint8Array, mask = false) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
        const ctx = canvas.getContext('2d')!, data = ctx.createImageData(320, 200);
        for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
          const src = y * 320 + x, dst = ((199 - y) * 320 + x) * 4;
          for (let c = 0; c < 3; c++) data.data[dst + c] = mask ? (magenta(pixels, src) ? 255 : 0) : pixels[src * 4 + c]!;
          data.data[dst + 3] = 255;
        }
        ctx.putImageData(data, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
      };
      const describe = (o: any) => {
        const ancestors: any[] = [];
        for (let p = o; p; p = p.parent) ancestors.push(p);
        const hiddenBy = ancestors.filter(p => renderVisibility!.get(p) === false).map(p => ({ name: p.name || '(unnamed)', uuid: p.uuid }));
        const level = ancestors.find(p => levels.includes(p));
        const userData = ancestors.flatMap(p => {
          const data = Object.fromEntries(Object.entries(p.userData).filter(([key]) => ['floorId', 'level', 'kind', 'role', 'gteki_role', 'goldenRole'].includes(key)));
          return Object.keys(data).length ? [{ name: p.name || '(unnamed)', uuid: p.uuid, ...data }] : [];
        });
        return { name: o.name || '(unnamed)', uuid: o.uuid, effectiveVisible: hiddenBy.length === 0, hiddenBy, levelGroup: level?.name ?? null, userData };
      };
      try {
        const first = capture(), baseline = first.voidRatio;
        const images: Record<string, string> = { 'baseline-mask': png(first.pixels, true), 'baseline-shown': png(first.pixels) };
        if (!renderVisibility) return { baseline, images, decision: 'Baseline render hook did not run' };
        const mask = Array.from({ length: 64000 }, (_, i) => i).filter(i => magenta(first.pixels, i));
        if (baseline < 0.01) {
          mode = 'baselineAfter';
          const baselineAfter = capture().voidRatio;
          return { baseline, baselineAfter, images, stopped: 'Baseline below 0.01' };
        }
        const samples: any[] = [], groups = new Map<string, any>();
        let noHit = 0, noVisibleHit = 0, noHiddenHit = 0;
        const ray = new e.ray.constructor(); ray.layers.mask = camera.layers.mask;
        ray.firstHitOnly = false;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        const stationMeshes = meshes.filter(o => {
          for (let p = o; p; p = p.parent) {
            if (p.name === 'gteki:graph-overlay') return false;
            if (p === root) return true;
          }
          return false;
        });
        const hitInfo = (hit: any) => {
          if (!hit) return null;
          const o = hit.object, material = Array.isArray(o.material) ? o.material[hit.face?.materialIndex ?? 0] : o.material;
          const info = describe(o);
          return { ...info, effectiveVisible: info.effectiveVisible && material?.visible !== false,
            material: material?.name || '(unnamed)', materialUuid: material?.uuid, materialVisible: material?.visible,
            materialSide: material?.side, instanceId: hit.instanceId ?? null, point: hit.point.toArray(), distance: hit.distance };
        };
        // Uniformly sample up to 300 baseline void pixels; retain every intersection.
        const selected = Array.from({ length: Math.min(300, mask.length) }, (_, i) => mask[Math.floor(i * mask.length / Math.min(300, mask.length))]!);
        for (const index of selected) {
          const x = index % 320, y = Math.floor(index / 320);
          ray.setFromCamera({ x: (x + 0.5) / 160 - 1, y: (y + 0.5) / 100 - 1 }, camera);
          const hits = ray.intersectObjects(stationMeshes, false).filter((hit: any) => hit.distance >= 0.05).map(hitInfo);
          const firstVisible = hits.find((hit: any) => hit.effectiveVisible) ?? null;
          const firstHidden = hits.find((hit: any) => !hit.effectiveVisible) ?? null;
          if (!hits.length) noHit++;
          if (!firstVisible) noVisibleHit++;
          if (!firstHidden) noHiddenHit++;
          samples.push({ x, y: 199 - y, firstVisible, firstHidden, hitCount: hits.length, hits });
          for (const [visibility, info] of [['visible', firstVisible], ['hidden', firstHidden]] as const) {
            if (!info) continue;
            const key = JSON.stringify([visibility, info.uuid, info.materialUuid, info.hiddenBy]);
            const group = groups.get(key) ?? { visibility, ...info, count: 0 };
            group.count++; groups.set(key, group);
          }
        }
        const toggles: Record<string, number> = {};
        for (const toggle of ['levels', 'all-visible', 'double-side', 'no-culling']) {
          mode = toggle;
          const frame = capture(); toggles[toggle] = frame.voidRatio;
          if (frame.voidRatio < baseline) {
            images[`${toggle}-mask`] = png(frame.pixels, true);
            images[`${toggle}-shown`] = png(frame.pixels);
          }
        }
        mode = 'baselineAfter';
        const baselineAfter = capture().voidRatio;
        return { baseline, baselineAfter, baselineDelta: baselineAfter - baseline, toggles,
          groups: [...groups.values()], attributionMode: 'baseline', sampledVoidRays: samples.length,
          totalVoidPixels: mask.length, noHit, noVisibleHit, noHiddenHit, samples, images, hookFrames,
          levelGroups: levels.map((o: any) => o.name),
          tightCullingMeshes: objects.filter(o => o.userData.tightCulling).length,
          camera: { near: camera.near, far: camera.far, position: camera.position.toArray() } };

      } finally {
        scene.onBeforeRender = originalBefore;
        restore();
      }
    });
    const { images, samples, ...summary } = result as any;
    if (images) for (const [name, b64] of Object.entries(images)) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(b64 as string, 'base64'));
    const timestamp = new Date().toISOString().replace('Z', ' UTC');
    fs.writeFileSync(path.join(out, 'diagnosis.json'), JSON.stringify({ timestamp, ...summary, samples }, null, 2));
    console.log(JSON.stringify({ timestamp, kind: 'summary', ...summary }));

    if (summary.decision) throw new Error(`DECISION: ${summary.decision}`);
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
