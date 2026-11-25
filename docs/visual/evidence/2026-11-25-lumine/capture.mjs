// 2026-11-25 JST. Run through job-run + tachi-run --heavy --host.
import { createServer } from '../../../../apps/web/node_modules/vite/dist/node/index.js';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const out = process.argv[2];
const sourceHead = execFileSync('rtk', ['git', '-C', repo, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
const space = 'depato-G2-lumine';
const receiptPath = join(out, 'receipt.json');

process.chdir(join(repo, 'apps/web'));
const server = await createServer({ server: { host: '127.0.0.1', port: 5301, strictPort: true } });
try {
  await server.listen();
  execFileSync('ego-browser', ['nodejs'], {
    input: browser.toString() + '\nawait browser(' + JSON.stringify({ out, repo, sourceHead, space, receiptPath }) + ');',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
} finally {
  try {
    execFileSync('ego-browser', ['nodejs', '-e', `const s = (await listTaskSpaces()).find(s => s.name === '${space}'); if (s) await (await taskSpace(s.id)).finish({ keep: [] });`], { stdio: 'inherit' });
  } finally {
    await server.close();
  }
}

const receipt = JSON.parse(readFileSync(receiptPath, 'utf8'));
for (const profile of receipt.profiles) {
  for (const frame of profile.frames) {
    const { width, height, data } = PNG.sync.read(readFileSync(join(out, frame.file)));
    if (width !== profile.device.width || height !== profile.device.height) receipt.failures.push(frame.file + ' viewport');
    if (frame.name !== 'street-door-inside') continue;
    let black = 0;
    for (let i = 0; i < data.length; i += 4) if (Math.max(data[i], data[i+1], data[i+2]) <= 16) black++;
    frame.blackPixelPct = 100 * black / (width * height);
    if (frame.blackPixelPct > 0.1) receipt.failures.push(frame.file + ' black pixels ' + frame.blackPixelPct + '%');
  }
}
writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
console.log(JSON.stringify({ failures: receipt.failures, profiles: receipt.profiles.map(p => ({
  device: p.device.id, frames: p.frames.length, legs: p.legs.length, passed: p.legs.filter(l => l.done).length,
  black: p.frames.find(f => f.name === 'street-door-inside')?.blackPixelPct,
  triangles: Math.max(0, ...p.frames.map(f => f.triangles)), draws: Math.max(0, ...p.frames.map(f => f.draws)),
  atlasPx: Math.max(0, ...p.frames.map(f => f.atlasPx)),
})) }));
if (receipt.failures.length) process.exitCode = 1;

async function browser({ out, repo, sourceHead, space, receiptPath }) {
  const fs = await import('node:fs/promises');
  const entry = (await listTaskSpaces()).find(s => s.name === space);
  const task = await taskSpace(entry?.id ?? space), page = task.page('p1');
  const receipt = { sourceHead, capturedAt: new Date().toISOString(), timeZone: 'UTC', profiles: [], failures: [] };
  const exit = 'x15', prefix = 'depato-lumine-ikebukuro', rootName = 'depato-interior:lumine-ikebukuro';
  const devices = [{ id: 'desktop', width: 1440, height: 900, mobile: false }, { id: 'phone', width: 390, height: 844, mobile: true }];

  for (const device of devices) {
    const profile = { device, frames: [], legs: [] };
    receipt.profiles.push(profile);
    const open = async next => {
      await page.goto('http://127.0.0.1:5301/?station=ikebukuro&qaTimeBand=morning' + (next ? '&next=1' : ''));
      await page.waitForFunction(() => window.__gteki?.phase() === 'ready', undefined, { timeout: 120000 });
      await page.evaluate(async () => {
        const g = window.__gteki;
        await g.scanProbe().explorer.stationScene.settled?.();
        g.holdFrames(true);
      });
    };
    const walk = async (name, ...points) => {
      for (const point of points) {
        const leg = await page.evaluate(point => {
          const g = window.__gteki;
          g.setCamera(null);
          return { ...g.walkPath([point], { speed: 'walk', dt: 1 / 30, maxSeconds: 55 }), avatar: g.avatar() };
        }, point);
        profile.legs.push({ name, target: point, ...leg });
        if (!leg.done) throw Error(name + ': ' + JSON.stringify(leg));
      }
    };
    const frame = async (name, yaw, pose, pitch = 0.06) => {
      const state = await page.evaluate(({ yaw, pitch, pose, rootName, exit }) => {
        const g = window.__gteki, e = g.scanProbe().explorer;
        if (pose) {
          g.setView({ node: exit, headingDeg: -yaw * 180 / Math.PI });
          e.pos.set(pose.x, pose.z, -pose.y);
          e.lastAvatarPos.copy(e.pos);
          e.teleported = true;
        }
        g.setCamera({ yaw, pitch, distance: 2.25 });
        g.goldenFrame(); g.goldenFrame();
        const root = e.stationScene.root.getObjectByName(rootName);
        const draws = new Map(), restore = [];
        root?.traverseVisible(mesh => {
          if (!mesh.isMesh) return;
          const previous = mesh.onBeforeRender;
          restore.push(() => { mesh.onBeforeRender = previous; });
          mesh.onBeforeRender = function (renderer, scene, camera, geometry, material, group) {
            if (camera === e.camera) draws.set(mesh.id + ':' + (group?.start ?? 0),
              (group?.count ?? geometry.index?.count ?? geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1));
            previous.apply(this, arguments);
          };
        });
        try { g.goldenFrame(); } finally { restore.forEach(fn => fn()); }
        const loaded = e.stationScene.root.children.filter(o => o.name.startsWith('depato-interior:') && o.children.length).map(o => o.name);
        return {
          avatar: g.avatar(), camera: g.camera(), eye: e.camera.position.toArray(), loaded,
          triangles: [...draws.values()].reduce((sum, count) => sum + count, 0), draws: draws.size,
          atlasPx: root?.children.length ? root.userData.depato.atlasPx : 0,
          shaderErrors: e.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length,
        };
      }, { yaw, pitch, pose, rootName, exit });
      const file = device.id + '-' + name + '.png';
      await page.screenshot({ path: out + '/' + file });
      profile.frames.push({ name, file, sourceHead, yaw, pitch, ...state });
      if (state.loaded.length > 1 || state.shaderErrors || (device.mobile && (state.triangles > 60000 || state.draws > 30 || state.atlasPx > 1024))) throw Error(file + ': ' + JSON.stringify(state));
      return state;
    };

    try {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: device.width, height: device.height, screenWidth: device.width, screenHeight: device.height,
        deviceScaleFactor: 1, mobile: device.mobile,
      });
      await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: device.mobile });
      await open(true);
      const { route, approach, street, door, lower, top, bottom } = await page.evaluate(async ({ repo, exit, prefix }) => {
        const g = window.__gteki, bundle = g.scanProbe().explorer.station.bundle;
        const { createRouter } = await import('/@fs' + repo + 'packages/navigation/src/index.ts');
        const position = ({ position: { x, y, z } }) => ({ x, y: z, z: -y });
        const node = id => position(bundle.nodes.find(n => n.id === id));
        const goal = bundle.pois.find(p => p.id === 'shop-ikb-lumine').connectorNodeIds;
        const route = createRouter(bundle).route(exit, goal);
        if (!g.setView({ node: exit, headingDeg: 180 }).placed) throw Error('Could not place at Exit 15');
        return {
          route: route.ok ? route.steps.map(s => s.edgeId) : route,
          approach: bundle.nodes.filter(n => n.id.startsWith('depato-lumine-approach-')).map(position),
          street: node('depato-lumine-street'), door: node(prefix + '-1F-door0'),
          lower: node(prefix + '-1F-lower'), top: node(prefix + '-1F-landing'), bottom: node(prefix + '-B1-down-end'),
        };
      }, { repo, exit, prefix });
      profile.route = route;
      if (!Array.isArray(route) || route[0] !== 'x15__depato-lumine-approach-0' || !route.some(id => id.includes('-1F-down-start__'))) throw Error('Street route: ' + JSON.stringify(route));

      const nx = (door.x - street.x) / 7, nz = (door.z - street.z) / 7;
      const threshold = d => ({ x: door.x + nx * d, y: door.y, z: door.z + nz * d });
      const yaw = Math.atan2(-nx, -nz);
      const x = lower.x, from = lower.z + 2, to = top.z, y = door.y, b1 = bottom.y;
      const pos = (x, y, z) => ({ x, y, z });
      for (const [i, p] of approach.entries()) {
        await walk('street-outbound', p);
        if (i === 11) await frame('street-first-sight', Math.atan2(p.x - door.x, p.z - door.z), undefined, 0);
      }
      await walk('approach-apron', street, threshold(-5));
      const outside = await frame('street-door-outside', yaw, undefined, 0);
      profile.doorDistanceM = Math.hypot(outside.eye[0] - door.x, outside.eye[2] - door.z);
      if (profile.doorDistanceM < 6 || profile.doorDistanceM > 8) throw Error('Door lens distance: ' + profile.doorDistanceM);
      const inside = threshold(3);
      await walk('enter-1F', inside);
      await frame('first-interior', yaw);
      await walk('top-landing', pos(x - 4, y, inside.z), pos(x - 4, y, from - 2), lower);
      await frame('escalator-top', Math.PI);
      await walk('down-to-B1', pos(x + 0.95, y, from), pos(x + 0.95, b1, to + 0.6), pos(x, b1, to + 2));
      await frame('escalator-bottom', 0);
      await walk('B1-aisle', pos(x - 4, b1, to + 2), pos(x - 4, b1, from - 2));
      await frame('main-aisle', Math.PI);
      await walk('up-to-1F', pos(x, b1, from - 2), pos(x - 0.95, b1, from - 0.4), pos(x - 0.95, y, to + 0.6), pos(x, y, to + 2));
      await walk('return-to-door', pos(x - 4, y, to + 2), pos(x - 4, y, inside.z), inside);
      await frame('street-door-inside', yaw + Math.PI);
      await walk('street-return', street, ...approach.reverse(), pos(-117.5, 33.146, -137));
      const loaded = await page.evaluate(name => window.__gteki.scanProbe().explorer.stationScene.root.getObjectByName(name).children.length, rootName);
      profile.unloadedOnReturn = loaded === 0;
      if (loaded) throw Error('Lumine remained loaded at Exit 15');
    } catch (error) {
      receipt.failures.push(device.id + ': ' + error.message);
    }

    try {
      await open(false);
      for (const name of ['street-first-sight', 'street-door-outside']) {
        const match = profile.frames.find(f => f.name === name);
        if (match) await frame('flag-off-' + name, match.yaw, match.avatar, match.pitch);
      }
    } catch (error) {
      receipt.failures.push(device.id + ' flag-off: ' + error.message);
    }
    await fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  }
}
