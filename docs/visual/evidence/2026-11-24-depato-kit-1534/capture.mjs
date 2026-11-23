// 2026-11-24 JST. Run under job-run + tachi-run --heavy --host, after pnpm install --frozen-lockfile.
import { readFile, writeFile, mkdir, copyFile } from 'node:fs/promises';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const out = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(out, '../../../..');
const base = '/tmp/gteki-depato-kit-1534';
const sourceSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repo, encoding: 'utf8' }).trim();
const { createServer } = await import(path.join(repo, 'apps/web/node_modules/vite/dist/node/index.js'));
const original = await readFile(path.join(repo, 'docs/visual/evidence/2026-11-23-depato-interior/walk.mjs'), 'utf8');
const budget = `(()=>{
  let triangles=0,draws=0;
  root?.traverseVisible(o=>{
    if(!o.isMesh)return;
    const count=o.isInstancedMesh?o.count:1;
    triangles+=(o.geometry.index?.count??o.geometry.getAttribute('position').count)/3*count;
    draws+=Array.isArray(o.material)?o.material.length:1;
  });
  return {triangles,draws,atlasPx:root?.userData.depato.atlasPx};
})()`;
const driver = original
  .replaceAll('/tmp/gteki-depato-1539-ad', base)
  .replaceAll('depato-interior-1534', 'depato-kit-1534')
  .replaceAll('127.0.0.1:5286', '127.0.0.1:5294')
  .replace('depato:root?.userData.depato,', `kitBudget:${budget},depato:root?.userData.depato,`);
await mkdir(base, { recursive: true });
await writeFile(base + '/walk.mjs', driver);
process.chdir(path.join(repo, 'apps/web'));
const server = await createServer({ server: { host: '127.0.0.1', port: 5294, strictPort: true } });
try {
  await server.listen();
  const code = await new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject);
    child.once('exit', resolve);
    child.stdin.end(driver);
  });
  const receipt = JSON.parse(await readFile(base + '/acceptance.json', 'utf8'));
  receipt.sourceSha = sourceSha;
  receipt.timeZone = 'UTC';
  for (const profile of receipt.profiles) {
    for (const frame of profile.frames) {
      frame.sourceSha = sourceSha;
      frame.file = `${profile.device.name}-${frame.name}.png`;
      await copyFile(base + '/frames/' + frame.file, path.join(out, frame.file));
      if (profile.device.name === 'phone' && frame.name !== 'flag-off') {
        const b = frame.kitBudget;
        if (b.triangles > 60000 || b.draws > 30 || b.atlasPx > 1024)
          receipt.failures.push(`phone ${frame.name}: kit budget ${JSON.stringify(b)}`);
      }
    }
  }
  await writeFile(path.join(out, 'receipt.json'), JSON.stringify(receipt, null, 2) + '\n');
  console.log(JSON.stringify({ sourceSha, frames: receipt.profiles.reduce((n,p)=>n+p.frames.length,0), failures: receipt.failures }));
  process.exitCode = code || (receipt.failures.length ? 1 : 0);
} finally {
  await server.close();
  const cleanup = `const entry=(await listTaskSpaces()).find(s=>s.name==='depato-kit-1534');if(entry&&entry.ownership!=='user'&&entry.ownership!=='agentDelegatedToUser'){const task=await taskSpace(entry.id);await task.finish({keep:[]});}`;
  await new Promise((resolve, reject) => {
    const child = spawn('ego-browser', ['nodejs'], { stdio: ['pipe', 'inherit', 'inherit'] });
    child.once('error', reject); child.once('exit', resolve); child.stdin.end(cleanup);
  });
}
