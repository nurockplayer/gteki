// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// Injected into ego-browser nodejs by depato-capture.mjs; settings is supplied there.
const fs = await import('node:fs/promises');
const entry = (await listTaskSpaces()).find(s => s.id === 47);
const task = !entry ? await taskSpace('Shinjuku department-store r8 captures')
  : entry.ownership === 'user' ? await claimTaskSpace(47)
  : entry.ownership === 'agentDelegatedToUser' ? await takeOverTaskSpace(47)
  : await taskSpace(47);
console.log({ taskSpaceId: task.spaceId });
await fs.writeFile(settings.output + '/browser-space.json', JSON.stringify({ spaceId: task.spaceId }));
const page = (await task.pages())[0] ?? await task.adopt((await task.tabs())[0].page);
const rows = [];
for (const viewport of [{ width: 1440, height: 900, mobile: false, name: 'desktop' }, { width: 390, height: 844, mobile: true, name: 'phone' }]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', { width: viewport.width, height: viewport.height, deviceScaleFactor: 1, mobile: viewport.mobile });
  const plans = [];
  for (const next of [true, false]) {
    await page.goto('http://127.0.0.1:5287/?station=shinjuku&qaCrowd=off&qaTimeBand=morning&qaEscalatorPhase=0' + (next ? '&next=1' : ''));
    await page.waitForFunction(() => window.__gteki?.phase() === 'ready', undefined, { timeout: 180000 });
    await page.waitForSelector('.boot-card', { state: 'hidden', timeout: 30000 });
    await page.evaluate(async () => { await document.fonts.ready; window.__gteki.holdFrames(true); });
    await page.evaluate(({ stores, buildings, footprints, roads, exit1 }) => {
      const qa = window.__gteki, e = qa.scanProbe().explorer;
      e.setMode('walk');
      e.camera.fov = 50;
      e.camera.aspect = e.renderer.domElement.clientWidth / e.renderer.domElement.clientHeight;
      e.camera.updateProjectionMatrix();
      const vector = () => e.camera.position.clone();
      const point = a => vector().fromArray(a);
      const meshes = [];
      let Basic;
      e.scene.traverse(o => { if (o.isMesh) { meshes.push(o); for (const m of Array.isArray(o.material) ? o.material : [o.material]) if (m.isMeshBasicMaterial) Basic = m.constructor; } });
      if (!Basic) throw new Error('No basic material constructor in explorer');
      const panel = (mesh, offset) => {
        const corners = [0, 1, 2, 3].map(i => vector().fromBufferAttribute(mesh.geometry.attributes.position, offset + i).applyMatrix4(mesh.matrixWorld));
        return { corners, center: corners.reduce((p, v) => p.add(v), vector().set(0, 0, 0)).multiplyScalar(.25), normal: vector().fromBufferAttribute(mesh.geometry.attributes.normal, offset).transformDirection(mesh.matrixWorld) };
      };
      const render = () => { e.renderer.render(e.scene, e.camera); e.stationScene.update(0, 0, e.camera); e.renderer.render(e.scene, e.camera); };
      const read = () => { const gl = e.renderer.getContext(), w = gl.drawingBufferWidth, h = gl.drawingBufferHeight, pixels = new Uint8Array(w * h * 4); gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, pixels); return { pixels, w, h }; };
      const luminance = (pixels, i) => { const c = [0, 1, 2].map(j => { const v = pixels[i + j] / 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return .2126 * c[0] + .7152 * c[1] + .0722 * c[2]; };
      const mean = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
      const measure = (mesh, face, atlas) => {
        render(); const shown = read(), old = mesh.material;
        let texture;
        if (atlas) {
          const canvas = document.createElement('canvas'); canvas.width = old.map.image.width; canvas.height = old.map.image.height;
          const ctx = canvas.getContext('2d'); ctx.drawImage(old.map.image, 0, 0); const im = ctx.getImageData(0, 0, canvas.width, canvas.height);
          for (let i = 0; i < im.data.length; i += 4) {
            const letter = im.data[i] > 150, y = Math.floor(i / 4 / canvas.width), ja = y < atlas.top + atlas.ja * 1.10 && y >= atlas.top;
            im.data[i] = letter && ja ? 255 : 0; im.data[i + 1] = letter && !ja ? 255 : 0; im.data[i + 2] = letter ? 0 : 255;
          }
          ctx.putImageData(im, 0, 0); texture = old.map.clone(); texture.source = new old.map.source.constructor(canvas); texture.needsUpdate = true;
        }
        const mask = new Basic({ color: 0xffffff, map: texture ?? null, fog: false, toneMapped: false, side: old.side });
        mesh.material = mask; e.renderer.render(e.scene, e.camera); const id = read(); mesh.material = old; mask.dispose(); texture?.dispose();
        const projected = face.corners.map(p => p.clone().project(e.camera));
        const box = { x0: Math.max(0, Math.floor(Math.min(...projected.map(p => (p.x + 1) * id.w / 2)))), x1: Math.min(id.w, Math.ceil(Math.max(...projected.map(p => (p.x + 1) * id.w / 2)))), y0: Math.max(0, Math.floor(Math.min(...projected.map(p => (p.y + 1) * id.h / 2)))), y1: Math.min(id.h, Math.ceil(Math.max(...projected.map(p => (p.y + 1) * id.h / 2)))) };
        const letters = [], band = [], all = [], jaRows = [];
        for (let y = box.y0; y < box.y1; y++) for (let x = box.x0; x < box.x1; x++) {
          const i = (y * id.w + x) * 4, [r, g, b] = id.pixels.slice(i, i + 3), value = luminance(shown.pixels, i);
          if (!atlas ? r > 245 && g > 245 && b > 245 : Math.max(r, g, b) > 220 && Math.min(r, g, b) < 25) {
            all.push(value);
            if (atlas && r > 220 && g < 25 && b < 25) { letters.push(value); jaRows.push(y); }
            if (atlas && b > 220 && r < 25 && g < 25) band.push(value);
          }
        }
        const letterY = mean(letters), bandY = mean(band);
        const expectedArea = Math.abs(projected.reduce((sum, p, i) => { const q = projected[[1, 3, 0, 2][i]]; return sum + p.x * q.y - q.x * p.y; }, 0)) * id.w * id.h / 8;
        e.renderer.render(e.scene, e.camera);
        return { contrast: letters.length && band.length ? (letterY + .05) / (bandY + .05) : null, letterY, bandY, meanY: mean(all), jaCapPx: jaRows.length ? Math.max(...jaRows) - Math.min(...jaRows) + 1 : 0, letterPixels: letters.length, signPixels: all.length, coverage: expectedArea ? all.length / expectedArea : 0, fullSignInFrame: projected.every(p => Math.abs(p.x) < .95 && Math.abs(p.y) < .9 && p.z < 1), projected: projected.map(p => p.toArray()) };
      };
      const inside = (p, ring) => { let yes = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const a = ring[i], b = ring[j]; if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < (b[0] - a[0]) * (p[1] - a[1]) / (b[1] - a[1]) + a[0]) yes = !yes; } return yes; };
      const outsideBuildings = position => !footprints.some(rings => inside([position.x, -position.z], rings[0]) && !rings.slice(1).some(r => inside([position.x, -position.z], r)));
      const pavement = position => {
        if (!outsideBuildings(position)) return false;
        const ground = e.scene.getObjectByName('surface-ground');
        e.ray.set(position.clone().setY(2), vector().set(0, -1, 0)); e.ray.near = 0; e.ray.far = 3;
        return e.ray.intersectObject(ground, false).length > 0;
      };
      const apply = pose => { e.camera.position.fromArray(pose.camera); e.camera.lookAt(point(pose.target)); e.camera.updateMatrixWorld(); render(); };
      window.__depato = {
        capture(store, kind, saved) {
          const group = e.scene.getObjectByName('department-store:' + store.buildingId);
          if (!group) { if (!saved) throw new Error(store.poiId + ': missing next store'); apply(saved); return { ...saved, metrics: { contrast: null, jaCapPx: 0, reason: 'Landmark sign absent with flag off' }, drawProof: { present: false } }; }
          const sign = group.children.find(m => m.name.endsWith(':sign'));
          const siblings = stores.filter(s => s.buildingId === store.buildingId), siblingIndex = siblings.findIndex(s => s.poiId === store.poiId);
          const offset = siblings.slice(0, siblingIndex).reduce((n, s) => n + s.signs.length, 0) * 4;
          const ja = 512 / (store.ja.length + 1), top = siblings.slice(0, siblingIndex).reduce((n, s) => n + 512 * 4.5 / ((s.ja.length + 1) * (4.5 / 1.85)), 0);
          const atlas = { ja, top };
          let best, nearestCheckedM = null;
          const accepted = candidate => candidate?.metrics.fullSignInFrame && candidate.metrics.letterPixels >= 8 && candidate.metrics.coverage > .95;
          // 2026-11-22 JST: r8 permits the nearest checked pavement/road pose when
          // no unobstructed 25–60 m walk view exists. Search distances in order.
          const standard = kind === 'walk' ? [25, 30, 35, 40, 45, 50, 55] : [75, 100, 125];
          const exception = Array.from({ length: 40 }, (_, i) => 5 + i * 5);
          search: for (const exceptional of [false, true]) for (const distance of exceptional ? exception : standard) for (let index = 0; index < store.signs.length; index++) {
            const face = panel(sign, offset + index * 4), tangent = face.corners[1].clone().sub(face.corners[0]).normalize();
            for (const angle of [0, -15, 15, -30, 30, -45, 45, -60, 60, -75, 75]) {
              const radians = angle * Math.PI / 180;
              const camera = face.center.clone().addScaledVector(face.normal, distance * Math.cos(radians)).addScaledVector(tangent, distance * Math.sin(radians)).setY(1.6);
              const onPavement = pavement(camera);
              const onRoad = outsideBuildings(camera) && roads.some(rings => inside([camera.x, -camera.z], rings[0]) && !rings.slice(1).some(r => inside([camera.x, -camera.z], r)));
              if (exceptional ? !onPavement && !onRoad : !onPavement) continue;
              const target = face.center.clone(); if (kind === 'look') target.y /= 2;
              const pitch = Math.atan2(target.y - 1.6, Math.hypot(target.x - camera.x, target.z - camera.z)) * 180 / Math.PI;
              const distanceM = camera.distanceTo(face.center);
              if (kind === 'walk' && (Math.abs(pitch) > 15 || (!exceptional && distanceM > 60))) continue;
              nearestCheckedM = Math.min(nearestCheckedM ?? Infinity, distanceM);
              const pose = { camera: camera.toArray(), target: target.toArray(), pitchDeg: pitch, distanceM, signFace: index, signCenter: face.center.toArray(), signCorners: face.corners.map(p => p.toArray()), pavement: onPavement, poseSurface: onPavement ? 'public pavement' : 'capture-only road', exception: exceptional, eyeHeightM: 1.6 };
              apply(pose); const metrics = measure(sign, face, atlas);
              const candidate = { ...pose, metrics };
              if (!best || metrics.signPixels > best.metrics.signPixels) best = candidate;
              if (accepted(candidate)) { best = candidate; break search; }
            }
          }
          if (!best) throw new Error(store.poiId + ': no outside-building eye-level pose within 200 m');
          best.accepted = accepted(best);
          best.nearestCheckedM = nearestCheckedM;
          if (!best.accepted) best.reason = 'No whole unobstructed sign in the checked pavement/road poses; diagnostic frame only';
          apply(best);
          const callbacks = group.children.map(mesh => { const old = mesh.onAfterRender; mesh.onAfterRender = () => { calls[mesh.name] = (calls[mesh.name] ?? 0) + 1; }; return [mesh, old]; });
          const calls = {}; e.renderer.render(e.scene, e.camera); for (const [mesh, old] of callbacks) mesh.onAfterRender = old;
          const drawProof = { present: true, calls, source: group.userData.source };
          const visibleMean = mesh => {
            e.renderer.render(e.scene, e.camera); const shown = read(), old = mesh.material;
            const mask = new Basic({ color: 0xffffff, fog: false, toneMapped: false, side: old.side });
            mesh.material = mask; e.renderer.render(e.scene, e.camera); const id = read(); mesh.material = old; mask.dispose();
            const values = [];
            for (let i = 0; i < id.pixels.length; i += 4) if (id.pixels[i] > 250 && id.pixels[i + 1] > 250 && id.pixels[i + 2] > 250) values.push(luminance(shown.pixels, i));
            return mean(values);
          };
          const facadeY = visibleMean(group.children.find(m => m.name.endsWith(':facade')));
          const skyY = visibleMean(e.scene.getObjectByName('surface-sky'));
          const referenceMesh = e.scene.getObjectByName('surface-signs');
          const referencePanels = Array.from({ length: referenceMesh.geometry.attributes.position.count / 4 }, (_, i) => panel(referenceMesh, i * 4));
          const reference = referencePanels.sort((a, b) => Math.hypot(a.center.x - exit1[0], a.center.z + exit1[1]) - Math.hypot(b.center.x - exit1[0], b.center.z + exit1[1]))[0];
          const visibility = meshes.map(mesh => [mesh, mesh.visible]); for (const mesh of meshes) mesh.visible = mesh === referenceMesh;
          const camera = reference.center.clone().addScaledVector(reference.normal, best.distanceM).setY(1.6);
          e.camera.position.copy(camera); e.camera.lookAt(reference.center); e.camera.updateMatrixWorld();
          const ref = measure(referenceMesh, reference);
          for (const [mesh, visible] of visibility) mesh.visible = visible;
          apply(best);
          return { ...best, drawProof, facadeY, skyY, facadeSkyRatio: skyY ? facadeY / skyY : null, signWayfindingRatio: ref.meanY ? best.metrics.meanY / ref.meanY : null, wayfinding: { id: 'poi:exit:1', mode: 'isolated rendered reference at same distance and lighting', distanceM: best.distanceM, meanY: ref.meanY } };
        },
      };
    }, settings);
    for (const store of settings.stores) for (const kind of ['walk', 'look']) {
      const saved = next ? null : plans.find(p => p.store === store.poiId && p.kind === kind);
      const row = await page.evaluate(({ store, kind, saved }) => window.__depato.capture(store, kind, saved), { store, kind, saved });
      if (next) plans.push({ ...row, store: store.poiId, kind });
      const filename = `${viewport.name}-${store.poiId.replace('shop-sjk-', '')}-${kind}-${next ? 'next' : 'off'}.png`;
      await page.screenshot({ path: settings.output + '/' + filename });
      rows.push({ store: store.poiId, kind, next, viewport, image: filename, ...row });
      await fs.writeFile(settings.output + '/frames.json', JSON.stringify({ capturedAt: new Date().toISOString(), timezone: 'UTC', rows }, null, 2));
      console.log(JSON.stringify({ image: filename, contrast: row.metrics.contrast, cap: row.metrics.jaCapPx, pitch: row.pitchDeg, distance: row.distanceM, pixels: row.metrics.signPixels, coverage: row.metrics.coverage, drawn: row.drawProof }));
    }
  }
}
console.log('2026-11-22 JST: completed all desktop/phone next/off captures');
