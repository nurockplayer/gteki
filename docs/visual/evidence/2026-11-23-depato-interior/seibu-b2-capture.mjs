// 2026-11-25 JST. Replay the pilot's 26 follow-camera poses and the B1 → B2 walk.
// Run from the worktree root through job-run + tachi-run --heavy --host.
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PNG } from 'pngjs';
import { createServer } from '../../../../apps/web/node_modules/vite/dist/node/index.js';

const output = resolve(process.argv[2]);
const origin = 'http://127.0.0.1:5296';
const spaceName = 'depato-seibu-b2';
const sourceHead = execFileSync('git', ['rev-parse', 'HEAD'], {encoding: 'utf8'}).trim();
await mkdir(output, {recursive: true});
process.chdir(resolve('apps/web'));
const server = await createServer({server: {host: '127.0.0.1', port: 5296, strictPort: true}});

const ego = script => new Promise((resolve, reject) => {
  const child = spawn('ego-browser', ['nodejs'], {stdio: ['pipe', 'inherit', 'inherit']});
  child.on('error', reject);
  child.on('exit', code => resolve(code ?? 1));
  child.stdin.end(script);
});

try {
  await server.listen();
  process.exitCode = await ego(`(${capture})(${JSON.stringify({output, origin, spaceName, sourceHead})})`);
  const receiptPath = `${output}/receipt.json`;
  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'));
  for (const profile of receipt.profiles) {
    for (const frame of profile.frames) {
      const {width, height, data} = PNG.sync.read(await readFile(`${output}/${frame.file}`));
      if (width !== profile.device.width || height !== profile.device.height) {
        receipt.failures.push(`${frame.file} measured ${width}×${height}`);
      }
      let black = 0;
      for (let pixel = 0; pixel < data.length; pixel += 4) {
        if (Math.max(data[pixel], data[pixel + 1], data[pixel + 2]) <= 16) black++;
      }
      frame.blackPixelPct = 100 * black / (width * height);
      if (frame.name === 'street-door-inside' && frame.blackPixelPct > 0.1) {
        receipt.failures.push(`${frame.file} black pixels ${frame.blackPixelPct}% > 0.1%`);
      }
    }
  }
  await writeFile(receiptPath, JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({
    sourceHead,
    profiles: receipt.profiles.map(({device, frames, legs}) => ({
      device: device.name, frames: frames.length, legs: legs.map(({name, walk}) => ({name, done: walk.done})),
      b2: frames.filter(f => f.name.startsWith('B2-')).map(({name, kit, avatar}) => ({name, kit, avatar})),
    })),
    failures: receipt.failures,
  }));
  if (receipt.failures.length) process.exitCode = 1;
} finally {
  try {
    const closeCode = await ego(`const entry = (await listTaskSpaces()).find(s => s.name === ${JSON.stringify(spaceName)});
      if (entry) await (await taskSpace(entry.id)).finish({keep: []});`);
    if (closeCode) process.exitCode = closeCode;
  } finally {
    await server.close();
  }
}

async function capture({output, origin, spaceName, sourceHead}) {
  const fs = await import('node:fs/promises');
  const task = await taskSpace(spaceName);
  const page = (await task.pages())[0] ?? await task.adopt((await task.tabs())[0].page);
  const receipt = {sourceHead, capturedAt: new Date().toISOString(), timeZone: 'UTC', profiles: [], failures: []};
  const save = () => fs.writeFile(`${output}/receipt.json`, JSON.stringify(receipt, null, 2) + '\n');
  const open = async query => {
    await page.goto(`${origin}/?station=ikebukuro${query}`);
    await page.waitForFunction(() => window.__gteki?.phase() === 'ready', undefined, {timeout: 120000});
    await page.evaluate(async () => { await window.__gteki.scanProbe().explorer.stationScene.settled?.(); });
  };
  const view = (node, headingDeg = 180, camera = null) => page.evaluate(({node, headingDeg, camera}) => {
    const game = window.__gteki;
    game.setView({node, headingDeg});
    game.setCamera(camera);
  }, {node, headingDeg, camera});

  for (const device of [
    {name: 'desktop', width: 1440, height: 900, mobile: false},
    {name: 'phone', width: 390, height: 844, mobile: true},
  ]) {
    const profile = {device, frames: [], legs: []};
    receipt.profiles.push(profile);
    const walk = async (name, points) => {
      const leg = await page.evaluate(points => {
        const game = window.__gteki;
        game.setCamera(null);
        return {walk: game.walkPath(points, {speed: 'walk', dt: 1/30, maxSeconds: 120}), avatar: game.avatar()};
      }, points);
      profile.legs.push({name, ...leg});
      if (!leg.walk.done) throw new Error(`${name}: ${JSON.stringify(leg)}`);
    };
    const frame = async (name, yaw) => {
      const state = await page.evaluate(yaw => {
        const game = window.__gteki;
        game.setCamera({yaw});
        game.holdFrames(true);
        for (let i = 0; i < 3; i++) game.goldenFrame();
        const {scene, renderer} = game.scanProbe().explorer;
        const root = scene.getObjectByName('depato-interior:seibu-ikebukuro');
        const kit = {draws: 0, triangles: 0, drawsPerFloor: root?.userData.depato?.drawCallsPerFloor};
        root?.traverseVisible(mesh => {
          if (!mesh.isMesh) return;
          const geometry = mesh.geometry;
          kit.draws++;
          kit.triangles += (geometry.index?.count ?? geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
        });
        const shaderErrors = renderer.info.programs.filter(p => p.diagnostics?.runnable === false).map(p => p.diagnostics.fragmentShader.log);
        return {avatar: game.avatar(), camera: game.camera(), kit, shaderErrors};
      }, yaw);
      const file = `${device.name}-${name}.png`;
      await page.screenshot({path: `${output}/${file}`});
      await page.evaluate(() => window.__gteki.holdFrames(false));
      profile.frames.push({name, file, sourceHead, ...state});
      if (state.shaderErrors.length) receipt.failures.push(`${file}: ${state.shaderErrors.join(' / ')}`);
      if (device.mobile && name.startsWith('B2-') && (state.kit.draws > 30 || state.kit.triangles > 60000)) {
        receipt.failures.push(`${file}: ${state.kit.draws} visible kit draws, ${state.kit.triangles} triangles`);
      }
    };
    try {
      await page.cdp('Emulation.setDeviceMetricsOverride', {
        width: device.width, height: device.height, screenWidth: device.width,
        screenHeight: device.height, deviceScaleFactor: 1, mobile: device.mobile,
      });
      await page.cdp('Emulation.setTouchEmulationEnabled', {enabled: device.mobile});
      await open('&next=1');
      await view('sp_e');
      await walk('four-metres-before', [{x: 15, z: 66}]);
      const minimapExpanded = await page.evaluate(() => document.querySelector('.minimap')?.dataset.collapsed === 'false');
      if (minimapExpanded) await page.click('button.minimap-collapse', {label: 'Collapse the station minimap'});
      await frame('entrance-before', -Math.PI);
      await walk('wayfinding-context', [{x: 8, z: 62}]);
      await frame('entrance-context', device.mobile ? -2.28 : -2.50);
      await walk('return-to-door', [{x: 15, z: 66}]);
      await walk('through-station-door', [{x: 15, z: 72, y: 27.7}]);
      await frame('entrance-inside', -Math.PI);
      await walk('food-hall-main-aisle', [{x: 22.9055, z: 72}, {x: 22.9055, z: 113.5}, {x: 26.9055, z: 113.5}, {x: 26.9055, z: 128.5}]);
      await frame('food-hall-aisle', Math.PI - 0.26);
      await walk('counter-close', [{x: 26.7, z: 131}]);
      await frame('counter', Math.PI / 2);
      await walk('escalator-board', [{x: 26.9055, z: 113.5}, {x: 22.9055, z: 113.5}, {x: 22.9055, z: 94}, {x: 26.9055, z: 94}, {x: 25.9555, z: 95.6}]);
      await frame('escalator-boarding', -Math.PI);
      await walk('ride-to-1F', [{x: 25.9555, z: 108.6, y: 32.2}, {x: 26.9055, z: 110.5, y: 32.2}]);
      await frame('arrival-1F', -Math.PI);
      await walk('wide-1F', [{x: 26.9055, z: 113.5}]);
      await frame('wide-1F', Math.PI - 0.4);
      await walk('street-door-inside', [{x: 22.9055, z: 113.5}, {x: 22.9055, z: 122.5}, {x: 45.365, z: 122.5}]);
      await frame('street-door-inside', -Math.PI / 2);
      await walk('through-street-door', [{x: 53.4, z: 122.5, y: 32.4}]);
      await frame('street-door-outside', Math.PI / 2);
      await view('depato-seibu-ikebukuro-B1-upper');
      await walk('far-end-B1', [{x: 26.9055, z: 162}]);
      await frame('far-end-B1', 0);
      await view('depato-seibu-ikebukuro-1F-upper', 0, {pitch: -0.25});
      await frame('well-from-1F', 0);
      await open('');
      await view('sp_e');
      await walk('flag-off-same-pose', [{x: 15, z: 66}]);
      await frame('flag-off', -Math.PI);
    } catch (error) {
      receipt.failures.push(`${device.name} pilot replay: ${error.message}`);
    }
    try {
      await open('&next=1');
      await view('depato-seibu-ikebukuro-B1-lower');
      await walk('B1-to-B2', [{x: 27.8555, z: 95.6, y: 27.7}, {x: 27.8555, z: 108.6, y: 23.2}, {x: 26.9055, z: 110.5, y: 23.2}]);
      await frame('B2-arrival', -Math.PI);
      await walk('B2-main-aisle', [{x: 26.9055, z: 128.5, y: 23.2}]);
      await frame('B2-main-aisle', Math.PI - 0.26);
      await walk('B2-to-B1', [{x: 26.9055, z: 113.5}, {x: 22.9055, z: 113.5}, {x: 22.9055, z: 94}, {x: 26.9055, z: 94},
        {x: 25.9555, z: 95.6, y: 23.2}, {x: 25.9555, z: 108.6, y: 27.7}, {x: 26.9055, z: 110.5, y: 27.7}]);
    } catch (error) {
      receipt.failures.push(`${device.name} B2: ${error.message}`);
    }
    await save();
  }
}
