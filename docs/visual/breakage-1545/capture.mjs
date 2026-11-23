// Real walker + follow camera receipt for #1545; 2026-11-24 JST.
const fs = await import('node:fs/promises');
const { spawn, execFileSync } = await import('node:child_process');
const repo = '/Users/tachikoma/Developer/gteki-wt/breakage-1545';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const graph = JSON.parse(await fs.readFile(repo + '/stations/ikebukuro/gteki/graph.json', 'utf8'));
const root = repo + '/.cache/breakage-1545/' + sourceSha;
await fs.mkdir(root, { recursive: true });
const server = spawn('nice', ['-n', '15', process.execPath, repo + '/apps/web/node_modules/vite/bin/vite.js', '--host', '127.0.0.1', '--port', '5195', '--strictPort'], {
  cwd: repo + '/apps/web', env: { ...process.env, GITHUB_SHA: sourceSha }, stdio: ['ignore', 'pipe', 'inherit'],
});
let task;
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', c => { if (c.toString().includes('Local:')) resolve(); });
    server.once('error', reject);
    server.once('exit', c => reject(new Error('Capture server exited: ' + c)));
  });
  task = await taskSpace('Breakage 1545 connector walks');
  const page = task.page('p1'), walks = [];
  for (const [device, width, height] of [['desktop', 1440, 900], ['phone', 390, 844]]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    for (const flag of ['off', 'next']) {
      await page.goto('http://127.0.0.1:5195/?station=ikebukuro&qaTimeBand=morning' + (flag === 'next' ? '&next=1' : ''));
      await page.waitForFunction(() => Boolean(window.__gteki?.scanProbe().explorer.stationScene), undefined, { timeout: 60000 });
      await page.evaluate(() => { window.__gteki.holdFrames(true); window.__gteki.simulate(2); });
      for (const exit of ['x18', 'x22', 'x37', 'x38']) {
        const edge = graph.edges.find(e => e.mode === 'stairs' && (e.from === exit || e.to === exit));
        const start = edge.from === exit ? edge.to : edge.from;
        const connector = await page.evaluate(id => window.__gteki.scanProbe().explorer.connectorRoutePaths().get(id), edge.id);
        if (!connector) throw new Error('Missing runtime connector: ' + edge.id);
        const path = edge.from === exit ? [...connector].reverse() : connector;
        const placed = await page.evaluate(node => { window.__gteki.setCamera(null); return window.__gteki.setView({ node, headingDeg: 0 }).placed; }, start);
        const pose = await page.evaluate(() => ({ avatar: window.__gteki.avatar(), camera: window.__gteki.scanProbe().explorer.camera.position.toArray(), cameraInfo: window.__gteki.scanProbe().explorer.cameraInfo() }));
        const legs = [];
        for (const [direction, points] of [['outward', path], ['return', [...path].reverse()]]) {
          const steps = [];
          for (const p of points) steps.push(await page.evaluate(p => {
            const h = window.__gteki, e = h.scanProbe().explorer;
            const result = h.walkPath([{ x: p.x, y: p.z, z: -p.y }], { maxSeconds: 20 });
            const at = e.pos;
            const walls = result.done ? [] : e.walls.filter(w => {
              const dx = w.bx - w.ax, dz = w.bz - w.az;
              const t = Math.max(0, Math.min(1, ((at.x - w.ax) * dx + (at.z - w.az) * dz) / (dx * dx + dz * dz)));
              return Math.hypot(at.x - w.ax - t * dx, at.z - w.az - t * dz) < 0.8 && w.yMin < at.y + 1 && w.yMax > at.y + 0.3;
            });
            return { ...result, target: p, avatar: h.avatar(), camera: e.camera.position.toArray(), walls };
          }, p));
          legs.push({ direction, done: placed && steps.every(s => s.done), steps });
          await page.screenshot({ path: `${root}/${device}-${flag}-${exit}-${direction}.png` });
        }
        walks.push({ device, width, height, flag, exit, edge: edge.id, pathSource: 'runtime connectorRoutePaths (ENU)', path, placed, pose, legs, done: legs.every(l => l.done), capturedAtUTC: new Date().toISOString() });
        await fs.writeFile(root + '/walks.json', JSON.stringify({ sourceSha, walks }, null, 2) + '\n');
        console.log(`${device} ${flag} ${exit}: ${legs.map(l => l.direction + ' done=' + l.done).join(', ')}`);
      }
    }
  }
  console.log('Receipt: ' + root + '/walks.json');
} finally {
  server.kill();
  if (task) await task.finish({ keep: [] });
}
