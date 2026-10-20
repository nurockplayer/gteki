import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream, readFileSync } from 'node:fs';
import { mkdir, rename, stat, unlink } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { parse } from 'yaml';
import {
  assertPathWithinStore, docsRoot, getGitCommit, getStoreRoot, packageRoot, readJson, resolveStoreRoot, safeSourceId,
  storeRelativePath, TOOL_VERSION, writeJson,
  type AcquisitionRecord, type ResolutionEvidence, type SourceManifest,
} from './common.js';

const MANIFEST_PATH = join(packageRoot, 'sources', 'sources.yaml');
const USER_AGENT = `gteki-gis-tools/${TOOL_VERSION} (+https://github.com/nurockplayer/gteki)`;
const MAX_DOWNLOAD_BYTES = 128 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 120_000;

export function loadSources(): SourceManifest[] {
  const records = parse(readFileSync(MANIFEST_PATH, 'utf8')) as unknown;
  if (!Array.isArray(records)) throw new Error('Source manifest must be a YAML sequence');
  const ids = new Set<string>();
  for (const item of records as SourceManifest[]) {
    safeSourceId(item.source_id);
    if (ids.has(item.source_id)) throw new Error(`Duplicate source_id: ${item.source_id}`);
    ids.add(item.source_id);
    if (!['yes', 'no', 'conditional', 'unknown'].includes(item.commercial_use.status)
      || !['yes', 'no', 'conditional', 'unknown'].includes(item.modification_allowed.status)
      || !['yes', 'no', 'conditional', 'unknown'].includes(item.redistribution_allowed.status)) {
      throw new Error(`Invalid rights status in ${item.source_id}`);
    }
  }
  return records as SourceManifest[];
}

// Exposed for deterministic local-server tests and other bounded acquisition clients.
export async function downloadUrl(
  url: string,
  options: { storeRoot?: string; expectedBytes?: number | null; userAgent?: string; retries?: number; backoffMs?: number } = {},
): Promise<{ finalUrl: string; httpStatus: number; headers: Record<string, string | null>; bytes: number; sha256: string; path: string; storePath: string; sizeCheck: AcquisitionRecord['size_check'] }> {
  const root = resolveStoreRoot(options.storeRoot ?? getStoreRoot());
  await mkdir(join(root, 'tmp'), { recursive: true, mode: 0o700 });
  await assertPathWithinStore(root, join(root, 'tmp'));
  const headers: Record<string, string | null> = { 'content-type': null, 'content-length': null, etag: null, 'last-modified': null, date: null };
  const retries = Math.min(2, Math.max(0, options.retries ?? 2));
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    const tempPath = join(root, 'tmp', `${randomUUID()}.download`);
    try {
      const response = await fetch(url, { headers: { 'user-agent': options.userAgent ?? USER_AGENT }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
      for (const name of Object.keys(headers)) headers[name] = response.headers.get(name);
      if (!response.ok || !response.body) {
        await response.body?.cancel();
        throw new Error(`HTTP ${response.status} while downloading ${url}`);
      }
      const hash = createHash('sha256');
      let bytes = 0;
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          bytes += chunk.length;
          if (bytes > MAX_DOWNLOAD_BYTES) {
            callback(new RangeError(`Download exceeded ${MAX_DOWNLOAD_BYTES} byte limit: ${url}`));
            return;
          }
          hash.update(chunk);
          callback(null, chunk);
        },
      });
      await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(tempPath, { flags: 'wx', mode: 0o600 }));
      const sha256 = hash.digest('hex');
      const filename = basename(new URL(response.url || url).pathname) || 'download.bin';
      const storePath = storeRelativePath(sha256, filename);
      const path = join(root, storePath);
      await mkdir(dirname(path), { recursive: true, mode: 0o700 });
      await assertPathWithinStore(root, dirname(path));
      try {
        const existing = await stat(path);
        let existingHash = createHash('sha256');
        let existingBytes = 0;
        for await (const chunk of createReadStream(path)) { existingHash.update(chunk); existingBytes += chunk.length; }
        if (existing.isFile() && existingBytes === bytes && existingHash.digest('hex') === sha256) await unlink(tempPath);
        else { await unlink(path); await rename(tempPath, path); }
      } catch { await rename(tempPath, path); }
      const sizeCheck = options.expectedBytes == null
        ? 'NOT_SPECIFIED'
        : bytes === options.expectedBytes ? 'MATCH' : 'MISMATCH';
      return { finalUrl: response.url || url, httpStatus: response.status, headers: { ...headers }, bytes, sha256, path, storePath, sizeCheck };
    } catch (error) {
      lastError = error;
      await unlink(tempPath).catch(() => undefined);
      if (attempt < retries && !(error instanceof RangeError)) await new Promise((resolve) => setTimeout(resolve, (options.backoffMs ?? 500) * (attempt + 1)));
      else if (error instanceof RangeError) break;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

type Resolved = { url: string; evidence: ResolutionEvidence };
function collectStrings(value: unknown, path = ''): Array<{ value: string; pointer: string }> {
  if (typeof value === 'string') return [{ value, pointer: path || '/' }];
  if (Array.isArray(value)) return value.flatMap((child, index) => collectStrings(child, `${path}/${index}`));
  if (value && typeof value === 'object') return Object.entries(value).flatMap(([key, child]) => collectStrings(child, `${path}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`));
  return [];
}

async function resolveCatalogSource(source: SourceManifest): Promise<Resolved> {
  const resolution = source.resolution;
  if (resolution.kind === 'direct') return { url: source.expected_url, evidence: null };
  const catalog = loadSources().find((item) => item.source_id === resolution.catalog_source_id);
  if (!catalog) throw new Error(`Missing catalog source ${resolution.catalog_source_id}`);
  let record: AcquisitionRecord;
  let path: string;
  try { ({ record, path } = await import('./common.js').then((m) => m.getStoredSource(catalog.source_id))); }
  catch {
    const result = await performAcquisition(catalog, { retryDelayMs: 500 });
    if (!result.ok || !result.record || !result.path) throw new Error(`Could not acquire required catalog: ${result.error ?? 'size mismatch'}`);
    record = result.record;
    path = result.path;
  }
  const payload = await readJson<unknown>(path);
  const match = resolution.match;
  const cityCode = /^plateau-(13116|13104)-/.exec(source.source_id)?.[1];
  if (!cityCode || !payload || typeof payload !== 'object' || !Array.isArray((payload as { cities?: unknown }).cities)) {
    throw new Error(`Catalog response has no cities array or source city code for ${source.source_id}`);
  }
  const cities = (payload as { cities: unknown[] }).cities;
  const cityIndex = cities.findIndex((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const city = entry as Record<string, unknown>;
    const codePattern = new RegExp(`(^|[^0-9])${cityCode}([^0-9]|$)`);
    return ['cityCode', 'city_code', 'code', 'municipalityCode', 'municipality_code', 'city', 'id']
      .some((key) => {
        const value = city[key];
        return (typeof value === 'string' || typeof value === 'number') && codePattern.test(String(value));
      });
  });
  if (cityIndex < 0) throw new Error(`Catalog has no city ${cityCode} for ${source.source_id}`);
  const city = cities[cityIndex] as Record<string, unknown>;
  const cityPath = `/cities/${cityIndex}`;
  const isGml = match.endsWith('.gml');
  const resourceField = isGml ? 'files' : 'metadataZipUrls';
  const resourceValue = isGml
    ? (city.files && typeof city.files === 'object' ? (city.files as Record<string, unknown>).ubld : undefined)
    : city.metadataZipUrls;
  if (resourceValue == null) throw new Error(`Catalog city ${cityCode} has no ${isGml ? 'files.ubld' : 'metadataZipUrls'} for ${source.source_id}`);
  const candidates = collectStrings(resourceValue, `${cityPath}/${resourceField}${isGml ? '/ubld' : ''}`)
    .filter(({ value }) => value.startsWith('https://') || value.startsWith('http://'));
  const selected = candidates.find(({ value }) => {
    try { return decodeURIComponent(new URL(value).pathname).endsWith(match); }
    catch { return false; }
  });
  if (!selected) throw new Error(`Catalog did not contain expected resource ${match} for ${source.source_id}`);
  return { url: selected.value, evidence: { source_id: catalog.source_id, sha256: record.sha256, json_pointer: selected.pointer } };
}

export type AcquisitionResult = { source_id: string; ok: boolean; record?: AcquisitionRecord; path?: string; error?: string };
export function acquisitionResultFromDownload(
  source_id: string,
  result: { sizeCheck: AcquisitionRecord['size_check']; path: string; bytes: number; expectedBytes?: number | null },
): AcquisitionResult {
  if (result.sizeCheck === 'MISMATCH') {
    return { source_id, ok: false, path: result.path, error: `Expected ${result.expectedBytes} bytes, received ${result.bytes}` };
  }
  return { source_id, ok: true, path: result.path };
}

export function acquisitionExitCode(results: AcquisitionResult[]): number {
  return results.every((result) => result.ok) ? 0 : 1;
}

async function performAcquisition(source: SourceManifest, options: { retryDelayMs?: number } = {}): Promise<AcquisitionResult> {
  const requestedAt = new Date().toISOString();
  try {
    const resolved = await resolveCatalogSource(source);
    const downloaded = await downloadUrl(resolved.url, { expectedBytes: source.expected_bytes, backoffMs: options.retryDelayMs });
    const record: AcquisitionRecord = {
      source_id: source.source_id,
      resolved_url: downloaded.finalUrl,
      resolution_evidence: resolved.evidence,
      requested_at: requestedAt,
      completed_at: new Date().toISOString(),
      http_status: downloaded.httpStatus,
      response_headers: downloaded.headers,
      bytes: downloaded.bytes,
      sha256: downloaded.sha256,
      store_path: downloaded.storePath,
      tool_version: TOOL_VERSION,
      git_commit: await getGitCommit(),
      expected_bytes: source.expected_bytes,
      expected_url_match: source.resolution.kind === 'direct' ? downloaded.finalUrl === source.expected_url : downloaded.finalUrl === source.expected_url,
      size_check: downloaded.sizeCheck,
      mode: 'online',
    };
    await writeJson(join(docsRoot, 'gis', 'acquisitions', `${source.source_id}.json`), record);
    return { ...acquisitionResultFromDownload(source.source_id, { sizeCheck: record.size_check, path: downloaded.path, bytes: record.bytes, expectedBytes: record.expected_bytes }), record };
  } catch (error) {
    return { source_id: source.source_id, ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

export async function acquireSources(ids: string[], options: { offline?: boolean } = {}): Promise<AcquisitionResult[]> {
  const sources = loadSources();
  const byId = new Map(sources.map((source) => [source.source_id, source]));
  for (const id of ids) if (!byId.has(safeSourceId(id))) throw new Error(`Unknown source_id: ${id}`);
  if (options.offline) {
    const output: AcquisitionResult[] = [];
    for (const id of ids) {
      try {
        const { record, path } = await import('./common.js').then((m) => m.getStoredSource(id));
        // Compare against the current (fingerprinted) manifest, not the expectation stored in the old record.
        const expectedBytes = byId.get(id)!.expected_bytes ?? null;
        const sizeCheck = expectedBytes == null ? 'NOT_SPECIFIED' : record.bytes === expectedBytes ? 'MATCH' : 'MISMATCH';
        const fresh: AcquisitionRecord = { ...record, expected_bytes: expectedBytes, size_check: sizeCheck, last_offline_check: { requested_at: new Date().toISOString(), completed_at: new Date().toISOString(), tool_version: TOOL_VERSION, sha256: record.sha256, bytes: record.bytes, status: 'PASS' } };
        await writeJson(join(docsRoot, 'gis', 'acquisitions', `${id}.json`), fresh);
        output.push({ source_id: id, ok: sizeCheck !== 'MISMATCH', record: fresh, path, ...(sizeCheck === 'MISMATCH' ? { error: 'Stored byte count does not match expected_bytes' } : {}) });
      } catch (error) { output.push({ source_id: id, ok: false, error: error instanceof Error ? error.message : String(error) }); }
    }
    return output;
  }
  const output: AcquisitionResult[] = [];
  const catalogId = 'plateau-catalog-ubld-13116-13104';
  const needsCatalog = ids.some((id) => byId.get(id)?.resolution.kind === 'plateau_catalog_api');
  let catalogFreshResult: AcquisitionResult | null = null;
  if (needsCatalog) {
    // Every online resolution starts from a fresh API snapshot, even if a prior
    // acquisition record exists. The snapshot is archived and hashed first.
    catalogFreshResult = await performAcquisition(byId.get(catalogId)!);
    if (ids.includes(catalogId)) output.push(catalogFreshResult);
  }
  for (const id of ids) {
    if (needsCatalog && id === catalogId) continue;
    const source = byId.get(id)!;
    if (source.resolution.kind === 'plateau_catalog_api' && catalogFreshResult && !catalogFreshResult.ok) {
      output.push({ source_id: id, ok: false, error: `Fresh catalog acquisition failed: ${catalogFreshResult.error ?? 'unknown error'}` });
      continue;
    }
    const result = await performAcquisition(source);
    output.push(result);
  }
  return output;
}
