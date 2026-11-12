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
      const root = e.stationScene?.root;
      if (!root) return { decision: 'Station root unavailable' };
      const objects: any[] = [], meshes: any[] = [];
      scene.traverse((o: any) => { objects.push(o); if (o.isMesh) meshes.push(o); });
      const levels = root.children.filter((o: any) => o.isGroup && o.name.startsWith('level-'));
      // buildStation names its level groups and legacy street pad; shared ceiling identity
      // comes from the shell soffit/hood, rather than guessing from unnamed materials.
      const ceiling = meshes.find(o => o.name === 'escalator-shell-soffits' || o.name === 'elevator-interior-hood')?.material;
      const streetLevels = levels.filter((o: any) => o.children.some((c: any) => c.isMesh && c.name === 'walkable' && !c.visible));
      if (!levels.length || !ceiling || !streetLevels.length) return { decision: 'Cannot identify level groups / shared ceiling / hidden street level' };
      const h2 = [
        ...root.children.filter((o: any) => o.isMesh && o.name === 'walkable' && !o.visible),
        ...streetLevels.flatMap((o: any) => o.children.filter((c: any) => c.isMesh && !c.visible && (c.name === 'walkable' || c.material === ceiling))),
      ];
      if (h2.length !== 3) return { decision: `Expected three H2 meshes, found ${h2.length}` };
      // UUIDs vary between loads; retain the prior-run UUID as a label and locate by identity.
      const singles = new Map([
        ['H2:3abdf4ba', h2.find(o => o.name === 'walkable' && o.parent === root)],
        ['H2:79568654', h2.find(o => o.name === 'walkable' && streetLevels.includes(o.parent))],
        ['H2:c4826c12', h2.find(o => o.material === ceiling && streetLevels.includes(o.parent))],
      ]);
      if ([...singles.values()].some(o => !o) || new Set(singles.values()).size !== 3) return { decision: 'Cannot identify each H2 mesh uniquely' };
      const originalBefore = scene.onBeforeRender;
      const savedVisibility = new Map<any, boolean>(objects.map(o => [o, o.visible]));
      let mode = 'baseline', renderVisibility: Map<any, boolean> | undefined;
      const hookFrames: any[] = [];
      scene.onBeforeRender = function (...args: any[]) {
        originalBefore.apply(this, args);
        const hiddenLevels = levels.filter((o: any) => !o.visible).map((o: any) => o.name);
        if (mode === 'H1' || mode === 'H1+H2') for (const o of levels) o.visible = true;
        if (mode === 'H2' || mode === 'H1+H2') for (const o of h2) o.visible = true;
        if (singles.has(mode)) singles.get(mode).visible = true;
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
          for (const [o, visible] of savedVisibility) o.visible = visible;
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
        const h2Targets = h2.map(describe);
        const toggles: Record<string, number> = {};
        let h2Frame: ReturnType<typeof capture> | undefined, h2Visibility: Map<any, boolean> | undefined;
        for (const toggle of [...singles.keys(), 'H2']) {
          mode = toggle;
          const frame = capture(); toggles[toggle] = frame.voidRatio;
          images[`${toggle.replace(':', '-')}-shown`] = png(frame.pixels);
          if (toggle === 'H2') {
            h2Frame = frame; h2Visibility = renderVisibility;
            images['H2-mask'] = png(frame.pixels, true);
          }
        }
        renderVisibility = h2Visibility!;
        const mask = Array.from({ length: 64000 }, (_, i) => i).filter(i => magenta(h2Frame!.pixels, i));
        const samples: any[] = [], groups = new Map<string, any>();
        let noVisibleHit = 0, noHiddenHit = 0;
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
        // Attribute every remaining H2 void pixel, with independent visible and hidden hits.
        for (const index of mask) {
          const x = index % 320, y = Math.floor(index / 320);
          ray.setFromCamera({ x: (x + 0.5) / 160 - 1, y: (y + 0.5) / 100 - 1 }, camera);
          const hits = ray.intersectObjects(stationMeshes, false).filter((hit: any) => hit.distance >= 0.05).map(hitInfo);
          const firstVisible = hits.find((hit: any) => hit.effectiveVisible) ?? null;
          const firstHidden = hits.find((hit: any) => !hit.effectiveVisible) ?? null;
          if (!firstVisible) noVisibleHit++;
          if (!firstHidden) noHiddenHit++;
          samples.push({ x, y: 199 - y, firstVisible, firstHidden, hitCount: hits.length });
          for (const [visibility, info] of [['visible', firstVisible], ['hidden', firstHidden]] as const) {
            if (!info) continue;
            const key = JSON.stringify([visibility, info.uuid, info.materialUuid, info.hiddenBy]);
            const group = groups.get(key) ?? { visibility, ...info, count: 0 };
            group.count++; groups.set(key, group);
          }
        }
        mode = 'baselineAfter';
        const baselineAfter = capture().voidRatio;
        return { baseline, baselineAfter, baselineDelta: baselineAfter - baseline, toggles, groups: [...groups.values()], attributionMode: 'H2', sampledVoidRays: samples.length, totalVoidPixels: mask.length, baselineVoidPixels: Array.from({ length: 64000 }, (_, i) => i).filter(i => magenta(first.pixels, i)).length, noVisibleHit, noHiddenHit, samples, images, hookFrames, h2Targets, singleTargets: [...singles].map(([label, o]) => ({ label, ...describe(o) })), levelGroups: levels.map((o: any) => o.name), camera: { near: camera.near, far: camera.far, position: camera.position.toArray() } };
      } finally {
        scene.onBeforeRender = originalBefore;
        for (const [o, visible] of savedVisibility) o.visible = visible;
      }
    });
    const { images, samples, ...summary } = result as any;
    if (images) for (const [name, b64] of Object.entries(images)) fs.writeFileSync(path.join(out, `${name}.png`), Buffer.from(b64 as string, 'base64'));
    const timestamp = new Date().toISOString();
    fs.writeFileSync(path.join(out, 'diagnosis.json'), JSON.stringify({ timestamp, ...summary, samples }, null, 2));
    console.log(JSON.stringify({ timestamp, kind: 'summary', ...summary }));
    for (const sample of samples ?? []) console.log(JSON.stringify({ timestamp, kind: 'sample', ...sample }));
    if (summary.decision) throw new Error(`DECISION: ${summary.decision}`);
  } finally { await page.evaluate(() => (window as any).__gteki.holdFrames(false)); }
});
