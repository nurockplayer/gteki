import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquisitionExitCode, acquisitionResultFromDownload, downloadUrl, loadSources } from '../src/acquire.js';
import { getStoredSource, getStoreRoot, repoRoot, verifyStoredFile } from '../src/common.js';

const servers: Server[] = [];
const tempDirs: string[] = [];

async function serve(body: Buffer): Promise<string> {
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/octet-stream', 'etag': '"fixture"', 'last-modified': 'Tue, 20 Oct 2026 00:00:00 GMT' });
    response.end(body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
  return `http://127.0.0.1:${address.port}/fixture.bin`;
}

async function tempStore(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'gteki-gis-acquire-'));
  tempDirs.push(path);
  return path;
}

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise<void>((resolve) => server.close(() => resolve()))));
  await Promise.all(tempDirs.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('source acquisition', () => {
  it('loads exactly the bounded 13-source manifest with explicit unknown rights', () => {
    const sources = loadSources();
    expect(sources).toHaveLength(13);
    expect(sources.find((source) => source.source_id === 'plateau-catalog-ubld-13116-13104')?.resolution.kind).toBe('direct');
    expect(sources.find((source) => source.source_id === 'plateau-13116-codelists')?.commercial_use.status).toBe('unknown');
  });

  it('streams a local response into a content-addressed object with the computed SHA-256', async () => {
    const body = Buffer.from('synthetic acquisition fixture\n');
    const url = await serve(body);
    const storeRoot = join(await tempStore(), 'private', 'store');
    const result = await downloadUrl(url, { storeRoot, expectedBytes: body.length, backoffMs: 0 });
    expect(result.bytes).toBe(body.length);
    expect(result.sha256).toBe(createHash('sha256').update(body).digest('hex'));
    expect(result.storePath).toMatch(new RegExp(`^raw/${result.sha256}/fixture\\.bin$`));
    expect(result.sizeCheck).toBe('MATCH');
    expect(result.headers.etag).toBe('"fixture"');
    expect(await readFile(result.path)).toEqual(body);
    const tmpMode = (await stat(join(storeRoot, 'tmp'))).mode & 0o777;
    expect(tmpMode & 0o077).toBe(0);
    const rootMode = (await stat(storeRoot)).mode & 0o777;
    expect(rootMode & 0o077).toBe(0);
  });

  it('marks an expected-size mismatch so the acquisition command can fail the source', async () => {
    const url = await serve(Buffer.from('short'));
    const result = await downloadUrl(url, { storeRoot: await tempStore(), expectedBytes: 99, backoffMs: 0 });
    expect(result.sizeCheck).toBe('MISMATCH');
    expect(result.bytes).toBe(5);
    const acquisition = acquisitionResultFromDownload('synthetic-source', { sizeCheck: result.sizeCheck, path: result.path, bytes: result.bytes, expectedBytes: 99 });
    expect(acquisition.ok).toBe(false);
    expect(acquisitionExitCode([acquisition])).toBe(1);
    expect(acquisitionExitCode([{ source_id: 'synthetic-source', ok: true }])).toBe(0);
  });

  it('detects a changed or truncated stored object during offline verification', async () => {
    const path = join(await tempStore(), 'stored.bin');
    const original = Buffer.from('offline verified');
    await writeFile(path, original);
    const sha = createHash('sha256').update(original).digest('hex');
    await expect(verifyStoredFile(path, sha, original.length)).resolves.toBeUndefined();
    await writeFile(path, Buffer.from('tampered'));
    await expect(verifyStoredFile(path, sha, original.length)).rejects.toThrow('integrity check failed');
  });

  it('reuses a valid content-addressed object and repairs a corrupt object at that path', async () => {
    const body = Buffer.from('repeatable local payload');
    const url = await serve(body);
    const storeRoot = await tempStore();
    const first = await downloadUrl(url, { storeRoot, backoffMs: 0 });
    const second = await downloadUrl(url, { storeRoot, backoffMs: 0 });
    expect(second.path).toBe(first.path);
    expect(await readFile(second.path)).toEqual(body);
    await writeFile(first.path, Buffer.from('corrupt'));
    const repaired = await downloadUrl(url, { storeRoot, backoffMs: 0 });
    expect(repaired.path).toBe(first.path);
    await expect(verifyStoredFile(repaired.path, repaired.sha256, repaired.bytes)).resolves.toBeUndefined();
  });

  it('makes at most two retries and sends the descriptive User-Agent', async () => {
    let attempts = 0;
    let userAgent = '';
    const server = createServer((request, response) => {
      attempts += 1;
      userAgent = request.headers['user-agent'] ?? '';
      response.writeHead(503).end('busy');
    });
    servers.push(server);
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
    await expect(downloadUrl(`http://127.0.0.1:${address.port}/unavailable`, { storeRoot: await tempStore(), backoffMs: 0 })).rejects.toThrow('HTTP 503');
    expect(attempts).toBe(3);
    expect(userAgent).toMatch(/^gteki-gis-tools\/0\.1\.0 \(\+https:\/\/github\.com\/nurockplayer\/gteki\)$/);
  });

  it('fails an offline lookup with no acquisition record without making a request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    await expect(getStoredSource('synthetic-offline-missing-record')).rejects.toThrow();
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects a repository-local store override, including one reached through a symlink', async () => {
    const previous = process.env.GTEKI_GIS_STORE;
    try {
      process.env.GTEKI_GIS_STORE = join(repoRoot, 'tools', 'gis', 'test', '.gis-store');
      expect(() => getStoreRoot()).toThrow('outside the repository');
      const temp = await tempStore();
      const link = join(temp, 'repo-link');
      await symlink(repoRoot, link, 'dir');
      process.env.GTEKI_GIS_STORE = join(link, 'test', 'store');
      expect(() => getStoreRoot()).toThrow('outside the repository');
    } finally {
      if (previous === undefined) delete process.env.GTEKI_GIS_STORE;
      else process.env.GTEKI_GIS_STORE = previous;
    }
  });
});
