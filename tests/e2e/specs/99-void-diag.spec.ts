// Temporary read-only render diagnosis, 2026-11-13 JST.
import fs from 'node:fs';
import path from 'node:path';
import { test, expect } from '@playwright/test';
import { PROBE_SCRIPT, settleFrames } from '../lib/gteki.ts';

test.use({ trace: 'off', video: 'off', screenshot: 'off' });
test('sj-stair-2-bottom void diagnosis', async ({ page }) => {
  test.setTimeout(700_000);
  const out = path.resolve(import.meta.dirname, '../artifacts/void-diag');
  fs.mkdirSync(out, { recursive: true });
  const config = JSON.parse(fs.readFileSync(new URL('../golden-cameras.json', import.meta.url), 'utf8'));
  const pose = config.cameras.find((c: any) => c.id === 'sj-stair-2-bottom');
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
      let pixels: Uint8Array | undefined;
      const originalRead = gl.readPixels;
      gl.readPixels = function (...args: any[]) {
        const value = originalRead.apply(this, args);
        if (!pixels && args[2] === 320 && args[3] === 200 && args[6] instanceof Uint8Array) pixels = args[6].slice();
        return value;
      };
      let baseline: number;
      try { baseline = g.goldenProbe(false).voidRatio; } finally { gl.readPixels = originalRead; }
      if (!pixels) return { baseline, decision: 'No 320x200 baseline pixels captured' };
      const magenta = (i: number) => pixels![i * 4] === 255 && pixels![i * 4 + 1] === 0 && pixels![i * 4 + 2] === 255;
      const png = (mask: boolean) => {
        const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 200;
        const ctx = canvas.getContext('2d')!, data = ctx.createImageData(320, 200);
        for (let y = 0; y < 200; y++) for (let x = 0; x < 320; x++) {
          const src = y * 320 + x, dst = ((199 - y) * 320 + x) * 4;
          for (let c = 0; c < 3; c++) data.data[dst + c] = mask ? (magenta(src) ? 255 : 0) : pixels![src * 4 + c]!;
          data.data[dst + 3] = 255;
        }
        ctx.putImageData(data, 0, 0); return canvas.toDataURL('image/png').split(',')[1];
      };
      const images = { mask: png(true), shown: png(false) };
      if (Math.abs(baseline - 0.0192) > 0.003) return { baseline, images, decision: 'Baseline does not reproduce approximately 0.019; stopped before toggles' };
      const objects: any[] = [], meshes: any[] = [], sides = new Map<any, number>();
      scene.traverse((o: any) => {
        objects.push(o);
        if (o.isMesh) { meshes.push(o); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m) sides.set(m, m.side); }
      });
      const doubleSide = () => { for (const [m] of sides) { m.side = 2; m.needsUpdate = true; } };
      const restoreSides = () => { for (const [m, side] of sides) { m.side = side; m.needsUpdate = true; } };
      const toggles: Record<string, number> = {};
      try { doubleSide(); toggles.doubleSide = g.goldenProbe(false).voidRatio; } finally { restoreSides(); }
      const culled = objects.map(o => o.frustumCulled);
      try { objects.forEach(o => { o.frustumCulled = false; }); toggles.frustum = g.goldenProbe(false).voidRatio; }
      finally { objects.forEach((o, i) => { o.frustumCulled = culled[i]; }); }
      const instances: any[] = [], counts = new Map<any, number>();
      for (const o of meshes.filter(o => o.isInstancedMesh)) {
        const matrix = o.matrixWorld.clone(); let nearZero = 0;
        for (let i = 0; i < o.instanceMatrix.count; i++) {
          o.getMatrixAt(i, matrix); const a = matrix.elements;
          if ([0, 4, 8].some(k => Math.hypot(a[k], a[k + 1], a[k + 2]) < 1e-6)) nearZero++;
        }
        counts.set(o, o.count);
        instances.push({ name: o.name, count: o.count, capacity: o.instanceMatrix.count, nearZero, truncated: o.count < o.instanceMatrix.count });
      }
      try { for (const [o] of counts) o.count = o.instanceMatrix.count; toggles.instancesFull = g.goldenProbe(false).voidRatio; }
      finally { for (const [o, count] of counts) o.count = count; }
      const near = camera.near, far = camera.far;
      try { camera.near *= 0.1; camera.far *= 4; camera.updateProjectionMatrix(); toggles.clip = g.goldenProbe(false).voidRatio; }
      finally { camera.near = near; camera.far = far; camera.updateProjectionMatrix(); }
      const closes = Object.entries(toggles).filter(([, v]) => v <= 0.005).map(([k]) => k);
      const samples: any[] = [], groups: Record<string, number> = {}, candidateObjects = new Map<string, any>();
      if (closes.length) {
        const mask = Array.from({ length: 64000 }, (_, i) => i).filter(magenta);
        const visible = (o: any) => { for (; o; o = o.parent) if (!o.visible) return false; return true; };
        const ray = new e.ray.constructor(); ray.layers.mask = camera.layers.mask;
        scene.updateMatrixWorld(true); camera.updateMatrixWorld(true);
        try {
          doubleSide();
          for (let k = 0; k < Math.min(40, mask.length); k++) {
            const index = mask[Math.floor((k + 0.5) * mask.length / Math.min(40, mask.length))]!, x = index % 320, y = Math.floor(index / 320);
            ray.setFromCamera({ x: (x + 0.5) / 160 - 1, y: (y + 0.5) / 100 - 1 }, camera);
            const hit = ray.intersectObjects(meshes.filter(visible), false).find((h: any) => {
              const m = Array.isArray(h.object.material) ? h.object.material[h.face?.materialIndex ?? 0] : h.object.material;
              return m?.visible !== false;
            });
            if (!hit) { samples.push({ x, y: 199 - y, miss: true }); continue; }
            const o = hit.object, parents: string[] = []; let p = o.parent;
            for (let j = 0; j < 3 && p; j++, p = p.parent) parents.push(p.name || '(unnamed)');
            const m = Array.isArray(o.material) ? o.material[hit.face?.materialIndex ?? 0] : o.material;
            const world = o.matrixWorld.clone();
            if (hit.instanceId !== undefined) { const matrix = world.clone(); o.getMatrixAt(hit.instanceId, matrix); world.multiply(matrix); }
            const dot = hit.face?.normal.dot(ray.ray.direction.clone().transformDirection(world.clone().invert()));
            const name = o.name || '(unnamed)'; groups[name] = (groups[name] ?? 0) + 1; candidateObjects.set(o.uuid, o);
            samples.push({ x, y: 199 - y, name, uuid: o.uuid, parents, materialSide: sides.get(m), instanceId: hit.instanceId ?? null, point: hit.point.toArray(), normalDotRay: dot, facing: dot < 0 ? 'front' : 'back', distance: hit.distance });
          }
        } finally { restoreSides(); }
      }
      const isolated: any[] = [];
      if (closes.includes('doubleSide')) for (const o of candidateObjects.values()) {
        // Clone only this object's materials so shared materials cannot implicate unrelated meshes.
        const original = o.material, list = Array.isArray(original) ? original : [original];
        const clones = list.map((m: any) => { const clone = m.clone(); clone.side = 2; return clone; });
        try { o.material = Array.isArray(original) ? clones : clones[0]; isolated.push({ name: o.name, uuid: o.uuid, voidRatio: g.goldenProbe(false).voidRatio }); }
        finally { o.material = original; clones.forEach((m: any) => m.dispose()); }
      }
      return { baseline, toggles, closes, instances, groups, samples, isolated, images, camera: { near, far, position: camera.position.toArray() } };
    });
    const { images, samples, instances, ...summary } = result as any;
    if (images) for (const [name, b64] of Object.entries(images)) fs.writeFileSync(path.join(out, `baseline-${name}.png`), Buffer.from(b64 as string, 'base64'));
    const timestamp = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'diagnosis.json'), JSON.stringify({ timestamp, ...summary, instances, samples }, null, 2));
    console.log(JSON.stringify({ timestamp, kind: 'summary', ...summary }));
    for (const instance of instances ?? []) console.log(JSON.stringify({ timestamp, kind: 'instance', ...instance }));
    for (const sample of samples ?? []) console.log(JSON.stringify({ timestamp, kind: 'sample', ...sample }));
    if (summary.decision) throw new Error(`DECISION: ${summary.decision}`);
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
