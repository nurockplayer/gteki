import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, rename, writeFile } from 'node:fs/promises';
import { existsSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

export const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const repoRoot = resolve(packageRoot, '../..');
export const docsRoot = join(repoRoot, 'docs');
export const TOOL_VERSION = '0.1.0';

export type RightsStatus = 'yes' | 'no' | 'conditional' | 'unknown';
export type SourceManifest = {
  source_id: string;
  title: string;
  station_ids: string[];
  publisher: string;
  official_url: string;
  resolution: { kind: 'direct' } | { kind: 'plateau_catalog_api'; catalog_source_id: string; match: string };
  expected_url: string;
  expected_bytes: number | null;
  expected_url_match: boolean | null;
  license_name: string;
  license_url: string | null;
  attribution_text: string;
  commercial_use: { status: RightsStatus; evidence: string };
  modification_allowed: { status: RightsStatus; evidence: string };
  redistribution_allowed: { status: RightsStatus; evidence: string };
  content_year: number | null;
  availability_deadline: string | null;
  notes: string;
  publish_gate: string;
};

export type ResolutionEvidence = null | { source_id: string; sha256: string; json_pointer: string };
export type AcquisitionRecord = {
  source_id: string;
  resolved_url: string;
  resolution_evidence: ResolutionEvidence;
  requested_at: string;
  completed_at: string;
  http_status: number;
  response_headers: Record<string, string | null>;
  bytes: number;
  sha256: string;
  store_path: string;
  tool_version: string;
  git_commit: string | null;
  expected_bytes: number | null;
  expected_url_match: boolean | null;
  size_check: 'MATCH' | 'MISMATCH' | 'NOT_SPECIFIED';
  mode: 'online' | 'offline';
  last_offline_check?: { requested_at: string; completed_at: string; tool_version: string; sha256: string; bytes: number; status: 'PASS' };
};

export function getStoreRoot(): string {
  return resolveStoreRoot(process.env.GTEKI_GIS_STORE || join(homedir(), '.gteki', 'gis-store'));
}

function canonicalPathAllowMissing(path: string): string {
  let current = resolve(path);
  const tail: string[] = [];
  while (!existsSync(current)) {
    const parent = dirname(current);
    if (parent === current) break;
    tail.unshift(current.slice(parent.length + 1));
    current = parent;
  }
  const existingRealPath = realpathSync.native(current);
  return resolve(existingRealPath, ...tail);
}

function isWithin(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel));
}

export function resolveStoreRoot(storePath: string): string {
  const candidate = canonicalPathAllowMissing(storePath);
  const canonicalRepoRoot = canonicalPathAllowMissing(repoRoot);
  if (isWithin(canonicalRepoRoot, candidate)) {
    throw new Error(`GIS store must be outside the repository: ${candidate}`);
  }
  for (let ancestor=candidate;;ancestor=dirname(ancestor)) {
    if (existsSync(join(ancestor,'.git'))) throw new Error(`GIS store must be outside any Git repository: ${candidate}`);
    if (dirname(ancestor)===ancestor) break;
  }
  return candidate;
}

export async function assertPathWithinStore(storeRoot: string, path: string): Promise<void> {
  const [canonicalRoot, canonicalPath] = await Promise.all([realpath(storeRoot), realpath(path)]);
  if (!isWithin(canonicalRoot, canonicalPath)) {
    throw new Error(`GIS store path resolves outside its root: ${path}`);
  }
}

export async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temp = `${path}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  await rename(temp, path);
}

export function safeSourceId(sourceId: string): string {
  if (!/^[a-z0-9][a-z0-9-]*$/.test(sourceId)) throw new Error(`Invalid source_id: ${sourceId}`);
  return sourceId;
}

function safeStorePath(storeRoot: string, relativePath: string): string {
  if (!relativePath || isAbsolute(relativePath) || relativePath.split(/[\\/]/).some((part) => part === '..' || part === '')) {
    throw new Error(`Unsafe store-relative path: ${relativePath}`);
  }
  const full = resolve(storeRoot, relativePath);
  const rel = relative(storeRoot, full);
  if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) throw new Error(`Store path escapes root: ${relativePath}`);
  return full;
}

export async function getStoredSource(sourceId: string): Promise<{ record: AcquisitionRecord; source: SourceManifest; path: string }> {
  safeSourceId(sourceId);
  const record = await readJson<AcquisitionRecord>(join(docsRoot, 'gis', 'acquisitions', `${sourceId}.json`));
  if (record.source_id !== sourceId) throw new Error(`Acquisition record source_id mismatch for ${sourceId}`);
  if (record.size_check === 'MISMATCH') throw new Error(`Acquisition size mismatch recorded for ${sourceId}`);
  const source = (await import('./acquire.js')).loadSources().find((item) => item.source_id === sourceId);
  if (!source) throw new Error(`Unknown source_id: ${sourceId}`);
  const path = safeStorePath(getStoreRoot(), record.store_path);
  await assertPathWithinStore(getStoreRoot(), dirname(path));
  await assertPathWithinStore(getStoreRoot(), path);
  await verifyStoredFile(path, record.sha256, record.bytes);
  return { record, source, path };
}

export async function verifyStoredFile(path: string, expectedSha256: string, expectedBytes: number): Promise<void> {
  const { createReadStream } = await import('node:fs');
  const hash = createHash('sha256');
  let bytes = 0;
  for await (const chunk of createReadStream(path)) {
    hash.update(chunk);
    bytes += chunk.length;
  }
  if (hash.digest('hex') !== expectedSha256 || bytes !== expectedBytes) throw new Error(`Stored source integrity check failed: ${path}`);
}

export function storeRelativePath(sha256: string, filename: string): string {
  if (!/^[a-f0-9]{64}$/.test(sha256)) throw new Error('Invalid SHA-256');
  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  if (!safeName || safeName === '.' || safeName === '..') throw new Error(`Invalid filename: ${filename}`);
  return `raw/${sha256}/${safeName}`;
}

export async function getGitCommit(): Promise<string | null> {
  try {
    const execFileAsync = promisify(execFile);
    const { stdout } = await execFileAsync('rtk', ['git', 'rev-parse', 'HEAD'], { cwd: repoRoot });
    const commit = stdout.trim();
    return /^[a-f0-9]{40,64}$/.test(commit) ? commit : null;
  } catch { return null; }
}
