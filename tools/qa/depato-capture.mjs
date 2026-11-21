// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// 2026-11-22 JST: phase-1 department-store draw proof, using the live explorer.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, 'tests/e2e/artifacts/depato-r6/proof');
fs.mkdirSync(output, { recursive: true });
const stores = JSON.parse(fs.readFileSync('stations/shinjuku/data/department-stores.json', 'utf8')).stores;
const server = spawn('pnpm', ['--dir', 'apps/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5281', '--strictPort'], { cwd: root, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { process.stdout.write(chunk); if (String(chunk).includes('http://127.0.0.1:5281')) resolve(); });
    server.once('exit', code => reject(new Error(`Vite exited ${code}`)));
  });
  const script = `
const fs = await import('node:fs/promises');
const task = await taskSpace('Shinjuku department stores r6');
console.log({ taskSpaceId: task.spaceId });
const page = task.page('p1');
await page.cdp('Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
await page.goto('http://127.0.0.1:5281/?station=shinjuku&next=1&qaCrowd=off&qaTimeBand=morning&qaEscalatorPhase=0');
await page.waitForFunction(() => window.__gteki?.phase() === 'ready', undefined, { timeout: 180000 });
await page.waitForSelector('.boot-card', { state: 'hidden', timeout: 30000 });
await page.evaluate(async () => { await document.fonts.ready; window.__gteki.holdFrames(true); });
const proof = [];
for (const store of ${JSON.stringify(stores)}) {
  const row = await page.evaluate(store => {
    const qa = window.__gteki, e = qa.scanProbe().explorer;
    const group = e.scene.getObjectByName('department-store:' + store.buildingId);
    if (!group) throw new Error(store.poiId + ': store group absent from next scene');
    const sign = group.children.find(m => m.name.endsWith(':sign'));
    const siblings = ${JSON.stringify(stores)}.filter(s => s.buildingId === store.buildingId);
    const offset = siblings.slice(0, siblings.findIndex(s => s.poiId === store.poiId)).reduce((n, s) => n + s.signs.length, 0) * 4;
    const position = sign.geometry.attributes.position, normal = sign.geometry.attributes.normal;
    const vertex = i => e.camera.position.clone().fromBufferAttribute(position, offset + i).applyMatrix4(sign.matrixWorld);
    const corners = [0, 1, 2, 3].map(vertex);
    const center = corners.reduce((v, p) => v.add(p), e.camera.position.clone().set(0, 0, 0)).multiplyScalar(.25);
    const facing = e.camera.position.clone().fromBufferAttribute(normal, offset).transformDirection(sign.matrixWorld);
    e.setMode('walk'); e.world.visible = true;
    e.camera.position.copy(center).addScaledVector(facing, 100).setY(1.6);
    e.camera.lookAt(center.clone().setY(Math.max(2, center.y / 2)));
    e.camera.updateMatrixWorld();
    const calls = {};
    const callbacks = group.children.map(mesh => { const old = mesh.onAfterRender; mesh.onAfterRender = (...args) => { calls[mesh.name] = (calls[mesh.name] ?? 0) + 1; old.apply(mesh, args); }; return [mesh, old]; });
    // The production viewer probe and surface lifecycle see this exact camera.
    e.renderer.render(e.scene, e.camera);
    e.stationScene.update(0, 0, e.camera);
    for (const key of Object.keys(calls)) delete calls[key];
    e.renderer.render(e.scene, e.camera);
    for (const [mesh, old] of callbacks) mesh.onAfterRender = old;
    const hierarchy = []; for (let object = group; object; object = object.parent) hierarchy.push({ name: object.name, visible: object.visible });
    return { store: store.poiId, camera: e.camera.position.toArray(), signCenter: center.toArray(), signNormal: facing.toArray(), signCorners: corners.map(p => p.toArray()), projectedCorners: corners.map(p => p.clone().project(e.camera).toArray()), hierarchy, calls, totalDraws: e.renderer.info.render.calls, source: group.userData.source };
  }, store);
  const image = ${JSON.stringify(output)} + '/' + store.poiId.replace('shop-sjk-', '') + '.png';
  await page.screenshot({ path: image });
  proof.push({ ...row, image });
  await fs.writeFile(${JSON.stringify(output)} + '/draw-proof.json', JSON.stringify({ capturedAt: new Date().toISOString(), timezone: 'UTC', rows: proof }, null, 2));
  console.log(JSON.stringify(row));
}
await task.finish({ keep: [] });
`;
  const browser = spawn('ego-browser', ['nodejs'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  browser.stdin.end(script);
  const code = await new Promise(resolve => browser.once('exit', resolve));
  if (code !== 0) throw new Error(`ego-browser exited ${code}`);
} finally {
  server.kill('SIGTERM');
}
