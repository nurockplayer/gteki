// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
// 2026-11-22 JST: phase-1 department-store draw proof, using the live explorer.
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';

const root = process.cwd();
const output = path.join(root, 'docs/visual/shinjuku-department-stores-2026-11-22/r10');
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
fs.mkdirSync(output, { recursive: true });
const data = JSON.parse(fs.readFileSync('stations/shinjuku/data/department-stores.json', 'utf8'));
const surface = JSON.parse(fs.readFileSync('stations/shinjuku/data/surface.json', 'utf8'));
const graph = JSON.parse(fs.readFileSync('stations/shinjuku/gteki/graph.json', 'utf8'));
const pois = JSON.parse(fs.readFileSync('stations/shinjuku/gteki/pois.json', 'utf8')).pois;
const exit1 = graph.nodes.find(n => n.id === pois.find(p => p.id === 'poi:exit:1').connectorNodeIds[0]).position;
// 2026-11-24 JST: replay all 44 original poses and their matching flag-off pairs.
const frames = JSON.parse(fs.readFileSync('docs/visual/shinjuku-department-stores-2026-11-22/r8/frames.json', 'utf8')).rows.filter(row => row.next);
const settings = { ...data, frames, output, sourceSha, footprints: surface.buildings.map(b => b.rings), roads: surface.roads.map(r => r.rings), exit1: [exit1.x, exit1.y] };
const server = spawn('pnpm', ['--dir', 'apps/web', 'exec', 'vite', '--host', '127.0.0.1', '--port', '5287', '--strictPort'], { cwd: root, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
try {
  await new Promise((resolve, reject) => {
    server.stdout.on('data', chunk => { process.stdout.write(chunk); if (String(chunk).includes('http://127.0.0.1:5287')) resolve(); });
    server.once('exit', code => reject(new Error(`Vite exited ${code}`)));
  });
  const spaceName = `Shinjuku department-store r9 captures ${randomUUID()}`;
  const script = `
const settings = ${JSON.stringify(settings)};
const task = await taskSpace(${JSON.stringify(spaceName)});
try {
${fs.readFileSync('tools/qa/depato-browser.mjs', 'utf8')}
} finally {
  await task.finish({ keep: [] });
}`;
  const browser = spawn('ego-browser', ['nodejs'], { cwd: root, stdio: ['pipe', 'inherit', 'inherit'] });
  browser.stdin.end(script);
  const code = await new Promise(resolve => browser.once('exit', resolve));
  if (code !== 0) throw new Error(`ego-browser exited ${code}`);
  const receipt = JSON.parse(fs.readFileSync(path.join(output, 'frames.json'), 'utf8'));
  for (const row of receipt.rows) {
    row.sha256 = createHash('sha256').update(fs.readFileSync(path.join(output, row.image))).digest('hex');
    if (!row.next) {
      row.flagOffGoldenSha256 = createHash('sha256').update(fs.readFileSync(path.join(output, '../r8', row.image))).digest('hex');
      row.flagOffGoldenEqual = row.sha256 === row.flagOffGoldenSha256;
    }
  }
  fs.writeFileSync(path.join(output, 'frames.json'), JSON.stringify(receipt, null, 2) + '\n');

} finally {
  process.kill(-server.pid, 'SIGTERM');
}
