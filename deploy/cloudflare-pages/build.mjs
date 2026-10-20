import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync, spawn } from 'node:child_process';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = process.cwd();
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const json = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));
const need = (condition, message) => { if (!condition) throw new Error(message); };
const mib = 1024 * 1024;

const groupExists = (pid) => {
  try { process.kill(-pid, 0); return true; }
  catch (error) { if (error.code === 'ESRCH') return false; throw error; }
};
export async function terminateGroup(pid) {
  if (!groupExists(pid)) return;
  process.kill(-pid, 'SIGTERM');
  // Referenced waits survive the process leader's exit. Never release the heavy lock early.
  for (let i = 0; i < 20 && groupExists(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  if (groupExists(pid)) process.kill(-pid, 'SIGKILL');
  for (let i = 0; i < 20 && groupExists(pid); i++) await new Promise((resolve) => setTimeout(resolve, 100));
  need(!groupExists(pid), `HOLD: process group ${pid} termination is uncertain; heavy-operation lock retained`);
}

export function resources() {
  const entry = fs.readFileSync('/proc/self/cgroup', 'utf8').split('\n').find((s) => s.startsWith('0::'));
  need(entry, 'HOLD: cgroup v2 monitoring is unavailable');
  const cg = path.join('/sys/fs/cgroup', entry.slice(3));
  const read = (name) => fs.readFileSync(path.join(cg, name), 'utf8').trim();
  const memoryMax = Number(read('memory.max'));
  const memoryCurrent = Number(read('memory.current'));
  const cpuMax = read('cpu.max');
  const pidsCurrent = Number(read('pids.current'));
  const pidsMax = read('pids.max');
  const memoryEvents = read('memory.events');
  const cpuStat = read('cpu.stat');
  need(Number.isFinite(memoryMax) && memoryMax > 0 && Number.isFinite(memoryCurrent), 'HOLD: finite cgroup memory limit/usage unavailable');
  need(/^(max|\d+) \d+$/.test(cpuMax) && Number.isFinite(pidsCurrent), 'HOLD: cgroup CPU/PID monitoring unavailable');
  need(memoryMax - memoryCurrent > Math.max(512 * mib, memoryMax * 0.15), 'HOLD: insufficient cgroup memory headroom');
  need(pidsMax === 'max' || Number(pidsMax) - pidsCurrent > 32, 'HOLD: insufficient cgroup PID headroom');
  return { cgroup: cg, memoryMax, memoryCurrent, cpuMax, pidsCurrent, pidsMax, memoryEvents, cpuStat };
}

export function validateOutput(out) {
  const files = [];
  const visit = (dir) => {
    for (const name of fs.readdirSync(dir).sort()) {
      const file = path.join(dir, name);
      const stat = fs.lstatSync(file);
      const rel = path.relative(out, file).split(path.sep).join('/');
      need(!/(^|\/)(?:_worker\.js|_routes\.json|functions|\.env[^/]*|\.git)(?:\/|$)/.test(rel), `Refusing executable/secret output: ${rel}`);
      need(!stat.isSymbolicLink(), `Refusing output symlink: ${file}`);
      if (stat.isDirectory()) visit(file);
      else {
        need(stat.isFile(), `Refusing special output: ${file}`);
        need(stat.size <= 25 * mib, `Cloudflare Pages 25 MiB limit exceeded: ${rel}`);
        files.push({ path: rel, bytes: stat.size, sha256: hash(fs.readFileSync(file)) });
      }
    }
  };
  visit(out);
  need(files.length > 0 && files.length <= 19999, 'Cloudflare Pages file limit exceeded (reserve one for deployment receipt)');
  const index = fs.readFileSync(path.join(out, 'index.html'), 'utf8');
  need(!/<base\b/i.test(index), 'Unexpected HTML base URL');
  for (const match of index.matchAll(/(?:src|href)=(["'])(.*?)\1/g)) {
    const url = match[2];
    if (url.startsWith('data:image/svg+xml,')) continue; // Existing app favicon is self-contained.
    need(url.startsWith('./'), `Expected relative Vite asset URL: ${url}`);
    const target = path.resolve(out, decodeURIComponent(url.split(/[?#]/)[0]));
    need(target.startsWith(path.resolve(out) + path.sep) && fs.existsSync(target), `Missing/escaping HTML asset: ${url}`);
  }
  return files;
}

async function main() {
  need(process.argv.length === 2 || (process.argv.length === 3 && process.argv[2] === '--preflight'), 'Usage: node deploy/cloudflare-pages/build.mjs [--preflight]');
  need(git('rev-parse', '--show-toplevel') === root, 'Run from the repository root');
  need(git('status', '--porcelain') === '', 'HOLD: candidate source must be clean, including untracked files');
  const sha = git('rev-parse', 'HEAD');
  if (process.env.CF_PAGES === '1') {
    need(process.env.CF_PAGES_BRANCH === 'main', 'HOLD: only main may publish; disable preview deployments');
    need(process.env.CF_PAGES_COMMIT_SHA === sha, 'HOLD: Cloudflare commit does not match the checkout');
  }
  need(!process.env.GTEKI_STATION_ROOTS, 'HOLD: external station roots are forbidden in publication builds');
  need(fs.existsSync('package.json') && fs.existsSync('apps/web/package.json'), 'HOLD: main has no Web application; product PRs require their own authorized merge');
  need(json('package.json').packageManager === 'pnpm@12.11.2', 'HOLD: unexpected package manager pin');
  need(process.version === 'v24.19.0', 'HOLD: expected Node v24.19.0 (Pages NODE_VERSION)');
  need(fs.existsSync('pnpm-lock.yaml'), 'HOLD: missing root frozen lockfile');
  for (const name of ['apps/web/public', 'functions']) {
    need(!fs.existsSync(name), `HOLD: unreviewed static/runtime publication path: ${name}`);
  }
  const policyBytes = fs.readFileSync(path.join(here, 'release-policy.json'));
  const policy = JSON.parse(policyBytes);
  need(policy.schema === 1 && policy.stations && typeof policy.stations === 'object' && !Array.isArray(policy.stations), 'Invalid publication policy');
  const coreTrees = {
    web: git('rev-parse', `${sha}:apps/web`),
    packages: git('rev-parse', `${sha}:packages`),
    lockfile: git('rev-parse', `${sha}:pnpm-lock.yaml`),
    rootConfigHash: hash(git('ls-tree', sha).split('\n').filter((line) => line.includes(' blob ') && !line.endsWith('\tREADME.md')).join('\n')),
    deploymentToolHash: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
  };
  const coreApproved = policy.core?.publicationApproved === true
    && Object.entries(coreTrees).every(([key, value]) => policy.core?.trees?.[key] === value)
    && /^https:\/\/github\.com\/nurockplayer\/gteki\/(?:issues|pull)\/\d+(?:#.*)?$/.test(policy.core?.evidence ?? '')
    && typeof policy.core.expiresAt === 'string' && Date.parse(policy.core.expiresAt) > Date.now();
  if (process.env.CF_PAGES === '1') need(coreApproved, 'HOLD: core has no exact-tree content-publication approval; a code merge is not release acceptance');
  const stations = [];
  if (fs.existsSync('stations')) {
    for (const dir of fs.readdirSync('stations').sort()) {
      const stationPath = path.join('stations', dir);
      need(!fs.lstatSync(stationPath).isSymbolicLink(), `HOLD: station root symlink: ${dir}`);
      if (!fs.existsSync(path.join(stationPath, 'gteki', 'station.json'))) continue;
      const treeSha = git('rev-parse', `${sha}:stations/${dir}`);
      const approval = Object.hasOwn(policy.stations, dir) ? policy.stations[dir] : null;
      need(approval?.treeSha === treeSha && approval?.publicationApproved === true && /^https:\/\/github\.com\/nurockplayer\/gteki\/(?:issues|pull)\/\d+(?:#.*)?$/.test(approval?.evidence ?? ''), `HOLD: no exact-tree content-publication approval for ${dir} (${treeSha})`);
      need(typeof approval.expiresAt === 'string' && Number.isFinite(Date.parse(approval.expiresAt)) && Date.parse(approval.expiresAt) > Date.now(), `HOLD: missing/expired publication approval for ${dir}`);
      stations.push({ dir, treeSha, ...approval });
    }
  }
  const initial = resources();
  console.log(JSON.stringify({ sourceSha: sha, coreTrees, coreApproved, stations, resources: initial, phase: 'preflight' }));
  if (process.argv[2] === '--preflight') return;
  const lock = path.join(os.tmpdir(), 'gteki-pages-heavy.lock');
  fs.mkdirSync(lock); // Existing lock is a HOLD. Never auto-remove another operation's lock.
  let active = null;
  let lastGroup = null;
  let termination = null;
  let timer = null;
  let stopped = null;
  let samples = 0;
  let peakMemory = initial.memoryCurrent;
  const sample = () => {
    const value = resources();
    peakMemory = Math.max(peakMemory, value.memoryCurrent);
    samples++;
    return value;
  };
  const stop = (error) => {
    stopped ??= error;
    if (active?.pid && !termination) {
      termination = terminateGroup(active.pid);
      termination.catch(() => {}); // Awaited below even if the leader exits first.
    }
  };
  const onSignal = () => stop(new Error('Build interrupted'));
  const run = async (args) => {
    if (stopped) throw stopped;
    sample();
    console.log(`corepack pnpm@12.11.2 ${args.join(' ')}`);
    await new Promise((resolve, reject) => {
      active = spawn('corepack', ['pnpm@12.11.2', ...args], { cwd: root, detached: true, stdio: 'inherit', env: { ...process.env, NODE_OPTIONS: '--max-old-space-size=2048' } });
      lastGroup = active.pid;
      active.once('error', reject);
      active.once('exit', (code, signal) => { active = null; code === 0 && !stopped ? resolve() : reject(stopped ?? new Error(`pnpm exited ${code ?? signal}`)); });
    });
    if (lastGroup && groupExists(lastGroup)) {
      termination = terminateGroup(lastGroup);
      await termination;
      throw new Error('HOLD: command left child processes running');
    }
    sample();
  };
  process.on('SIGINT', onSignal);
  process.on('SIGTERM', onSignal);
  try {
    timer = setInterval(() => { try { sample(); } catch (error) { stop(error); } }, 1000);
    await run(['--version']);
    await run(['install', '--frozen-lockfile']);
    await run(['typecheck']);
    await run(['exec', 'vitest', 'run', '--maxWorkers=1']);
    await run(['build']);
    need(git('rev-parse', 'HEAD') === sha && git('status', '--porcelain') === '', 'HOLD: source changed during build');
    const output = path.join(root, 'apps/web/dist');
    const threeRoot = path.join(root, 'apps/web/node_modules/three');
    const viteRoot = path.join(root, 'apps/web/node_modules/vite');
    const threeLicense = fs.readFileSync(path.join(threeRoot, 'LICENSE'), 'utf8');
    const meshoptHeader = fs.readFileSync(path.join(threeRoot, 'examples/jsm/libs/meshopt_decoder.module.js'), 'utf8').split('\n').slice(0, 2).join('\n');
    need(json(path.join(threeRoot, 'package.json')).license === 'MIT' && /MIT License/.test(meshoptHeader), 'HOLD: bundled runtime licence changed; review notices');
    const permission = threeLicense.slice(threeLicense.indexOf('Permission is hereby granted'));
    need(permission.length > 900, 'HOLD: incomplete MIT permission notice');
    fs.writeFileSync(path.join(output, 'THIRD_PARTY_NOTICES.txt'), [
      `three.js ${json(path.join(threeRoot, 'package.json')).version}\n${threeLicense}`,
      `meshoptimizer decoder bundled with three.js\n${meshoptHeader}\n\n${permission}`,
      `Vite build/runtime notices\n${fs.readFileSync(path.join(viteRoot, 'LICENSE.md'), 'utf8')}`,
    ].join('\n\n'));
    const files = validateOutput(output);
    const receipt = {
      schema: 'gteki.pages-build/1', sourceSha: sha,
      deploymentToolSha256: hash(fs.readFileSync(fileURLToPath(import.meta.url))),
      policySha256: hash(policyBytes), node: process.version, pnpm: '12.11.2',
      publicationEligibility: coreApproved ? 'PASS for admitted core/station content only; not product acceptance' : 'HOLD: unapproved core; internal build evidence only, do not deploy',
      coreTrees, coreApproved,
      content: stations.length ? 'Approved station trees plus synthetic demo' : 'Core synthetic demo only; not a real station or real-world navigation',
      stations, builtAt: new Date().toISOString(),
      limits: { maxFileBytes: 25 * mib, maxFileCount: 20000 },
      totalBytes: files.reduce((sum, file) => sum + file.bytes, 0), files,
      monitoring: { initial, final: sample(), samples, peakMemory },
      cloudflareDeployment: 'NOT VERIFIED: this is a build receipt, not a Cloudflare deployment receipt',
      acceptance: 'NOT RUN; navigation, rights, L2 and Owner acceptance gates are unchanged',
    };
    fs.writeFileSync(path.join(output, 'deployment-build.json'), JSON.stringify(receipt, null, 2) + '\n');
    console.log(JSON.stringify(receipt, null, 2));
  } finally {
    clearInterval(timer);
    if (termination) await termination;
    need(!lastGroup || !groupExists(lastGroup), 'HOLD: process group still exists; heavy-operation lock retained');
    process.removeListener('SIGINT', onSignal);
    process.removeListener('SIGTERM', onSignal);
    fs.rmdirSync(lock);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => { console.error(error.message); process.exitCode = 1; });
}
