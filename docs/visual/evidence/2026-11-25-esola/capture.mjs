// 2026-11-25 JST. Run via job-run + tachi-run --heavy --host.
import { createServer } from '../../../../apps/web/node_modules/vite/dist/node/index.js';
import { execFileSync, spawn } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

const repo = fileURLToPath(new URL('../../../../', import.meta.url));
const [out, baseRef] = process.argv.slice(2);
const git = (...args) => execFileSync('rtk', ['git', '-C', repo, ...args], { encoding: 'utf8' }).trim();
const head = git('rev-parse', 'HEAD'), base = git('rev-parse', baseRef);
const space = 'depato-G1-esola';
const config = JSON.parse(readFileSync(join(repo, 'stations/ikebukuro/data/depato-rollout.json'))).stores.find(s => s.id === 'esola-ikebukuro');
const devices = [{ id: 'desktop', width: 1440, height: 900, mobile: false }, { id: 'phone', width: 390, height: 844, mobile: true }];
const receiptPath = join(out, 'receipt.json');
const save = receipt => writeFileSync(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
save({ head, base, capturedAt: new Date().toISOString(), timeZone: 'UTC', profiles: [], failures: [] });

process.chdir(join(repo, 'apps/web'));
try {
  for (const baseline of [false, true]) {
    const sourceHead = baseline ? base : head;
    // Serve the parent versions of the two changed runtime modules for the flag-off golden.
    const originals = baseline ? new Map([
      'stations/ikebukuro/data/depato-rollout.json', 'stations/ikebukuro/scene/depato/pilot.ts',
    ].map(path => [join(repo, path), git('show', sourceHead + ':' + path)])) : new Map();
    const server = await createServer({
      define: { __BUILD_SHA__: JSON.stringify(sourceHead) },
      plugins: [{ name: 'esola-flag-off-baseline', enforce: 'pre', load: id => originals.get(id) }],
      server: { host: '127.0.0.1', port: baseline ? 5298 : 5297, strictPort: true },
    });
    try {
      await server.listen();
      const inputs = { out, repo, space, receiptPath, config, devices, sourceHead, baseline, url: server.resolvedUrls.local[0] };
      const run = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
      run.stdin.end(browser.toString() + '\nawait browser(' + JSON.stringify(inputs) + ');');
      const code = await new Promise((resolve, reject) => {
        run.on('error', reject);
        run.on('exit', resolve);
      });
      if (code !== 0) throw Error('Ego-lite capture exited ' + code);
    } finally {
      await server.close();
    }
  }
} finally {
  execFileSync('ego-browser', ['nodejs', '-e', `const s = (await listTaskSpaces()).find(s => s.name === ${JSON.stringify(space)}); if (s) await (await taskSpace(s.id)).finish({ keep: [] });`], { stdio: 'inherit' });
}

const receipt = JSON.parse(readFileSync(receiptPath));
for (const profile of receipt.profiles) {
  const frames = new Map();
  for (const frame of profile.frames) {
    const png = PNG.sync.read(readFileSync(join(out, frame.file)));
    frames.set(frame.name, png);
    if (png.width !== profile.device.width || png.height !== profile.device.height) receipt.failures.push(frame.file + ' viewport');
    if (frame.name === 'street-door-inside') {
      let black = 0;
      for (let i = 0; i < png.data.length; i += 4) if (Math.max(png.data[i], png.data[i + 1], png.data[i + 2]) <= 16) black++;
      frame.blackPixelPct = 100 * black / (png.width * png.height);
      if (frame.blackPixelPct > 0.1) receipt.failures.push(frame.file + ' black pixels ' + frame.blackPixelPct + '%');
    }
  }
  profile.flagOffChangedPixels = {};
  for (const [name, png] of frames) {
    if (!name.startsWith('baseline-off-')) continue;
    const candidate = frames.get(name.replace('baseline-', ''));
    let changed = 0;
    for (let i = 0; i < png.data.length; i += 4) if (png.data.readUInt32LE(i) !== candidate.data.readUInt32LE(i)) changed++;
    profile.flagOffChangedPixels[name] = changed;
    if (changed) receipt.failures.push(profile.device.id + ' ' + name + ', ' + changed + ' changed pixels');
  }
}
save(receipt);
console.log(JSON.stringify(receipt.profiles.map(p => ({
  device: p.device.id, frames: p.frames.length, passedLegs: p.legs.filter(l => l.done).length,
  changedPixels: p.flagOffChangedPixels, black: p.frames.find(f => f.name === 'street-door-inside')?.blackPixelPct,
  triangles: Math.max(...p.frames.map(f => f.triangles)), draws: Math.max(...p.frames.map(f => f.draws)),
}))));
console.log(JSON.stringify({ failures: receipt.failures }));
if (receipt.failures.length) process.exitCode = 1;

async function browser({ out, repo, space, receiptPath, config, devices, sourceHead, baseline, url }) {
  const fs = await import('node:fs/promises');
  const entry = (await listTaskSpaces()).find(s => s.name === space);
  const task = await taskSpace(entry?.id ?? space), page = task.page('p1');
  const receipt = JSON.parse(await fs.readFile(receiptPath));
  const save = () => fs.writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  const [door] = config.entrances, [dx, dz] = door.point, [nx, nz] = door.inward;
  const { aisleX: x, from, to } = config.circulation, y = config.elevations['1F'], b1 = config.elevations.B1;
  const pos = (x, y, z) => ({ x, y, z });
  const threshold = d => pos(dx + nx * d, y, dz + nz * d);
  const towardDoor = Math.atan2(-nx, -nz);
  const open = async next => {
    await page.goto(url + '?station=ikebukuro&qaTimeBand=morning' + (next ? '&next=1' : ''));
    await page.waitForFunction(() => window.__gteki?.phase() === 'ready', undefined, { timeout: 120000 });
    await page.evaluate(async () => {
      const g = window.__gteki;
      await g.scanProbe().explorer.stationScene.settled?.();
      g.holdFrames(true);
    });
    const overlay = await page.evaluate(() => document.querySelector('.minimap')?.dataset.collapsed === 'false');
    if (overlay) await page.click('button.minimap-collapse');
  };
  for (const device of devices) {
    const profile = baseline ? receipt.profiles.find(p => p.device.id === device.id) : { device, frames: [], legs: [] };
    if (!baseline) receipt.profiles.push(profile);
    const walk = async (name, ...points) => {
      for (const point of points) {
        const leg = await page.evaluate(point => {
          const g = window.__gteki;
          g.setCamera(null);
          return { ...g.walkPath([point], { dt: 1 / 30, maxSeconds: 75 }), avatar: g.avatar() };
        }, point);
        profile.legs.push({ name, target: point, ...leg });
        if (!leg.done) throw Error(name + ': ' + JSON.stringify(leg));
      }
    };
    const frame = async (name, yaw, pose) => {
      const state = await page.evaluate(({ yaw, pose }) => {
        const g = window.__gteki, e = g.scanProbe().explorer;
        if (pose) {
          g.setView({ node: 'x15', headingDeg: -yaw * 180 / Math.PI });
          e.pos.set(pose.x, pose.z, -pose.y);
          e.lastAvatarPos.copy(e.pos);
          e.teleported = true;
        }
        g.setCamera({ yaw, pitch: 0.06, distance: 2.25 });
        g.goldenFrame(); g.goldenFrame();
        const root = e.stationScene.root.getObjectByName('depato-interior:esola-ikebukuro');
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
        const loaded = [];
        e.stationScene.root.traverse(o => { if (o.name.startsWith('depato-interior:') && o.children.length) loaded.push(o.name); });
        return {
          avatar: g.avatar(), camera: g.camera(), eye: e.camera.position.toArray(), loaded,
          triangles: [...draws.values()].reduce((sum, count) => sum + count, 0), draws: draws.size,
          atlasPx: root?.children.length ? root.userData.depato.atlasPx : 0,
          shaderErrors: e.renderer.info.programs.filter(p => p.diagnostics?.runnable === false).length,
        };
      }, { yaw, pose });
      const file = device.id + '-' + name + '.png';
      await page.screenshot({ path: joinFile(file) });
      profile.frames.push({ name, file, sourceHead, yaw, ...state });
      if (state.loaded.length > 1 || state.shaderErrors || (device.mobile && (state.triangles > 60000 || state.draws > 30 || state.atlasPx > 1024))) throw Error(file + ': ' + JSON.stringify(state));
      return state;
    };
    const joinFile = file => out + '/' + file;
    try {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: device.width, height: device.height, screenWidth: device.width, screenHeight: device.height,
        deviceScaleFactor: 1, mobile: device.mobile,
      });
      await page.cdp('Emulation.setTouchEmulationEnabled', { enabled: device.mobile });
      if (!baseline) {
        await open(true);
        const route = await page.evaluate(async ({ repo, config }) => {
          const g = window.__gteki, e = g.scanProbe().explorer, { createRouter } = await import('/@fs' + repo + 'packages/navigation/src/index.ts');
          const bundle = e.station.bundle, goal = bundle.pois.find(p => p.id === config.poiId).connectorNodeIds;
          const result = createRouter(bundle).route(config.streetApproach.exitNode, goal);
          if (!g.setView({ node: config.streetApproach.exitNode, headingDeg: 180 }).placed) throw Error('Could not place at nearest modeled exit');
          return result.ok ? { ok: true, edgeIds: result.steps.map(s => s.edgeId) } : result;
        }, { repo, config });
        profile.route = route;
        if (!route.ok || !route.edgeIds.includes('x15__depato-esola-approach-0')) throw Error('Street route: ' + JSON.stringify(route));
        const approach = config.streetApproach.waypoints.map(p => pos(...p));
        for (const [i, p] of approach.entries()) {
          await walk('street-outbound', p);
          if (i === 7) await frame('street-first-sight', Math.atan2(p.x - dx, p.z - dz));
        }
        await walk('approach-apron', threshold(-7), threshold(-5));
        const outside = await frame('door-6-8m', towardDoor);
        profile.doorDistanceM = Math.hypot(outside.eye[0] - dx, outside.eye[2] - dz);
        if (profile.doorDistanceM < 6 || profile.doorDistanceM > 8) throw Error('Door lens distance: ' + profile.doorDistanceM);
        await walk('enter-1F', threshold(2));
        await frame('first-interior', towardDoor);
        await walk('main-aisle', pos(x - 4, y, threshold(2).z));
        await frame('main-aisle', Math.PI);
        await walk('top-landing', pos(x - 4, y, from - 2), pos(x, y, from - 2));
        await frame('escalator-top', Math.PI);
        await walk('down-to-B1', pos(x + 0.95, y, from), pos(x + 0.95, b1, to + 0.6), pos(x, b1, to + 2));
        await frame('escalator-bottom', 0);
        await walk('B1-aisle', pos(x - 4, b1, to + 2), pos(x - 4, b1, from - 2));
        await frame('B1-aisle', Math.PI);
        await walk('up-to-1F', pos(x, b1, from - 2), pos(x - 0.95, b1, from - 0.4), pos(x - 0.95, y, to + 0.6), pos(x, y, to + 2));
        await walk('return-to-door', pos(x - 4, y, to + 2), pos(x - 4, y, threshold(3).z), threshold(3));
        await frame('street-door-inside', towardDoor + Math.PI);
        await walk('leave-to-street', threshold(-7));
        await frame('street-door-outside', towardDoor);
        await walk('street-return', ...approach.reverse(), pos(-117.5, 33.146, -137));
        const loaded = await page.evaluate(() => window.__gteki.scanProbe().explorer.stationScene.root.getObjectByName('depato-interior:esola-ikebukuro').children.length);
        profile.unloadedOnReturn = loaded === 0;
        if (loaded) throw Error('Esola remained loaded at x15');
      }
    } catch (error) {
      receipt.failures.push(device.id + ': ' + error.message);
    }
    try {
      await open(false);
      for (const name of ['street-first-sight', 'door-6-8m', 'street-door-outside']) {
        const original = profile.frames.find(f => f.name === name);
        if (original) await frame((baseline ? 'baseline-off-' : 'off-') + name, original.yaw, original.avatar);
      }
    } catch (error) {
      receipt.failures.push(device.id + ' flag-off: ' + error.message);
    }
    await save();
  }
}
