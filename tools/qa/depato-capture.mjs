// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// 2026-11-22 JST: phase-1 department-store draw proof, using the live explorer.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const root = process.cwd();
const output = path.join(root, 'docs/visual/shinjuku-department-stores-2026-11-22/r8');
fs.mkdirSync(output, { recursive: true });
const data = JSON.parse(fs.readFileSync('stations/shinjuku/data/department-stores.json', 'utf8'));
const surface = JSON.parse(fs.readFileSync('stations/shinjuku/data/surface.json', 'utf8'));
const graph = JSON.parse(fs.readFileSync('stations/shinjuku/gteki/graph.json', 'utf8'));
const pois = JSON.parse(fs.readFileSync('stations/shinjuku/gteki/pois.json', 'utf8')).pois;
const exit1 = graph.nodes.find(n => n.id === pois.find(p => p.id === 'poi:exit:1').connectorNodeIds[0]).position;
const settings = { ...data, output, footprints: surface.buildings.map(b => b.rings), roads: surface.roads.map(r => r.rings), exit1: [exit1.x, exit1.y] };
const server = spawn('pnpm', ['--dir', 'apps/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5287', '--strictPort'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { process.stdout.write(chunk); if (String(chunk).includes('http://127.0.0.1:5287')) resolve(); });
    server.once('exit', code => reject(new Error(`Vite exited ${code}`)));
  });
  const script = 'const settings = ' + JSON.stringify(settings) + ';\n' + fs.readFileSync('tools/qa/depato-browser.mjs', 'utf8');
  const browser = spawn('ego-browser', ['nodejs'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  browser.stdin.end(script);
  const code = await new Promise(resolve => browser.once('exit', resolve));
  if (code !== 0) throw new Error(`ego-browser exited ${code}`);
  const spaceId = JSON.parse(fs.readFileSync(path.join(output, 'browser-space.json'), 'utf8')).spaceId;
  const finish = spawn('ego-browser', ['nodejs'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  finish.stdin.end(`const task = await taskSpace(${spaceId}); await task.finish({ keep: [] });`);
  const finishCode = await new Promise(resolve => finish.once('exit', resolve));
  if (finishCode !== 0) throw new Error(`ego-browser finish exited ${finishCode}`);
} finally {
  process.kill(-server.pid, 'SIGTERM');
}
