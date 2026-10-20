import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawn, execFileSync } from 'node:child_process';
import { validateOutput, terminateGroup } from './build.mjs';

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gteki-pages-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'index.html'), '<script type="module" src="./assets/app.js"></script>');
  fs.writeFileSync(path.join(dir, 'assets/app.js'), 'console.log("synthetic demo");');
  return dir;
}

test('fingerprints a self-contained relative-base Vite artifact', (t) => {
  const files = validateOutput(fixture(t));
  assert.equal(files.length, 2);
  assert.ok(files.every((f) => f.bytes > 0 && /^[a-f0-9]{64}$/.test(f.sha256)));
});
test('accepts the existing inline SVG favicon with embedded single quotes', (t) => {
  const dir = fixture(t);
  fs.appendFileSync(path.join(dir, 'index.html'), '<link rel="icon" href="data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\'%3E%3C/svg%3E">');
  assert.equal(validateOutput(dir).length, 2);
});
test('refuses a file exceeding the Pages limit before reading its bytes', (t) => {
  const dir = fixture(t);
  const file = path.join(dir, 'assets/too-large.glb');
  fs.closeSync(fs.openSync(file, 'w'));
  fs.truncateSync(file, 25 * 1024 * 1024 + 1);
  assert.throws(() => validateOutput(dir), /25 MiB/);
});
test('refuses missing assets and absolute base paths', (t) => {
  const dir = fixture(t);
  fs.unlinkSync(path.join(dir, 'assets/app.js'));
  assert.throws(() => validateOutput(dir), /Missing\/escaping/);
  fs.writeFileSync(path.join(dir, 'index.html'), '<script src="/assets/app.js"></script>');
  assert.throws(() => validateOutput(dir), /relative Vite asset/);
});
test('refuses symlinked output and accidental Worker runtime output', (t) => {
  const dir = fixture(t);
  const link = path.join(dir, 'linked.js');
  fs.symlinkSync('assets/app.js', link);
  assert.throws(() => validateOutput(dir), /symlink/);
  fs.unlinkSync(link);
  fs.writeFileSync(path.join(dir, '_worker.js'), 'export default {}');
  assert.throws(() => validateOutput(dir), /executable\/secret/);
});
test('refuses reserved directory components before recursing', (t) => {
  for (const name of ['_worker.js', '.git', '.env.production', 'functions']) {
    const dir = fixture(t);
    fs.mkdirSync(path.join(dir, name));
    fs.writeFileSync(path.join(dir, name, 'hidden.txt'), 'must not publish');
    assert.throws(() => validateOutput(dir), /executable\/secret/);
  }
});
test('waits for SIGKILL when the process group ignores SIGTERM', async () => {
  const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM",()=>{}); console.log("ready"); setInterval(()=>{},1000)'], { detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
  await new Promise((resolve) => child.stdout.once('data', resolve));
  await terminateGroup(child.pid);
  assert.throws(() => process.kill(-child.pid, 0), { code: 'ESRCH' });
});
test('unapproved station content and core cannot pass publication preflight', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gteki-publication-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'apps/web'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'stations/held/gteki'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'packages'));
  fs.writeFileSync(path.join(dir, 'packages/fixture.txt'), 'fixture');
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ packageManager: 'pnpm@12.11.2' }));
  fs.writeFileSync(path.join(dir, 'apps/web/package.json'), '{}');
  fs.writeFileSync(path.join(dir, 'pnpm-lock.yaml'), '');
  fs.writeFileSync(path.join(dir, 'stations/held/gteki/station.json'), '{}');
  const git = (...args) => execFileSync('git', args, { cwd: dir, stdio: 'pipe' });
  git('init', '-q'); git('add', '.');
  git('-c', 'user.name=Deployment test', '-c', 'user.email=deployment-test@example.invalid', 'commit', '-qm', 'fixture');
  assert.throws(() => execFileSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname, '--preflight'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CF_PAGES: '', GTEKI_STATION_ROOTS: '' } }), (error) => /no exact-tree content-publication approval for held/.test(error.stderr));
  const sha = git('rev-parse', 'HEAD').toString().trim();
  assert.throws(() => execFileSync(process.execPath, [new URL('./build.mjs', import.meta.url).pathname, '--preflight'], { cwd: dir, encoding: 'utf8', stdio: 'pipe', env: { ...process.env, CF_PAGES: '1', CF_PAGES_BRANCH: 'main', CF_PAGES_COMMIT_SHA: sha, GTEKI_STATION_ROOTS: '' } }), (error) => /core has no exact-tree content-publication approval/.test(error.stderr));
});
