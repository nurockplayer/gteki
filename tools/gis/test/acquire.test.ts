import { createServer, type Server } from 'node:http';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { acquisitionExitCode, acquisitionResultFromDownload, downloadCap, downloadUrl, loadSources, recordRequest, selectCatalogResource } from '../src/acquire.js';
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
  it('loads exactly the bounded 56-source manifest with explicit unknown rights', () => {
    const sources = loadSources();
    expect(sources).toHaveLength(56);
    for (const id of ['tokyo-s03-zip', 'tokyo-s03-spec', 'tokyo-s03-reference']) {
      const moved = sources.find(source => source.source_id === id)!;
      expect(moved.expected_url).toContain('/documents/d/toshiseibi/');
      expect(moved.catalog_resource_url).toContain('/kiban/shinjuku_terminal/pdf/');
      expect(moved.catalog_resource_sha256).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(sources.find((source) => source.source_id === 'plateau-catalog-ubld-13116-13104')?.resolution.kind).toBe('direct');
    expect(sources.find((source) => source.source_id === 'plateau-13116-codelists')?.commercial_use.status).toBe('unknown');
    const vintage = sources.find(source => source.source_id === 'plateau-13104-package-2023')!;
    expect(vintage).toMatchObject({ resolution: { kind: 'direct' }, content_year: 2023, publish_gate: 'HOLD', commercial_use: { status: 'unknown' }, modification_allowed: { status: 'unknown' }, redistribution_allowed: { status: 'unknown' }, license_name: 'unknown' });
    expect(vintage.expected_url).toBe(vintage.official_url);
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

  it('sends the exact fixed POST body and records its UTF-8 SHA-256 while leaving GET unchanged', async () => {
    const body = '{"query":"{ synthetic { name } }","label":"駅"}';
    let received = '', method = '', contentType = '';
    const server = createServer(async (request, response) => {
      method = request.method!; contentType = request.headers['content-type'] ?? '';
      for await (const chunk of request) received += chunk.toString();
      response.writeHead(200, { 'content-type': 'application/json' }).end('{"data":{}}');
    });
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected TCP address');
    const url = `http://127.0.0.1:${address.port}/graphql`;
    const request = { method: 'POST' as const, content_type: 'application/json' as const, body };
    const result = await downloadUrl(url, { storeRoot: await tempStore(), request });
    expect({ method, contentType, received }).toEqual({ method: 'POST', contentType: 'application/json', received: body });
    expect(result.request).toEqual({ ...request, body_sha256: createHash('sha256').update(body, 'utf8').digest('hex') });
    expect(recordRequest(request)).toEqual(result.request);
    const get = await downloadUrl(url, { storeRoot: await tempStore() });
    expect(method).toBe('GET'); expect(get).not.toHaveProperty('request');
    expect(recordRequest()).toBeUndefined();
    expect(() => recordRequest({ ...request, body: 'not JSON' })).toThrow();
    await expect(downloadUrl(url, { storeRoot: await tempStore(), request, transport: 'curl' })).rejects.toThrow('default fetch');
  });

  it('uses explicitly selected curl transport with the same hash and HTTP status checks', async () => {
    const bytes = Buffer.from('synthetic curl transport');
    const url = await serve(bytes);
    const result = await downloadUrl(url, { storeRoot: await tempStore(), transport: 'curl' });
    expect(result.httpStatus).toBe(200); expect(result.headers.etag).toBe('"fixture"');
    expect(await readFile(result.path)).toEqual(bytes);
    expect(result.sha256).toBe(createHash('sha256').update(bytes).digest('hex'));
  });

  it('declares the street-level context sources (#39) with catalog resolution, exact byte counts and conditional gates', () => {
    const sources = loadSources();
    const catalog = sources.find((source) => source.source_id === 'plateau-catalog-bldg-tran-13116-13104')!;
    expect(catalog).toMatchObject({ resolution: { kind: 'direct' }, expected_bytes: null, license_name: 'unknown', publish_gate: 'HOLD' });
    expect(catalog.expected_url).toBe('https://api.plateauview.mlit.go.jp/datacatalog/citygml/13116,13104?types=bldg,tran');
    const meshes = [['13116', '53394576', 'ikebukuro'], ['13116', '53394577', 'ikebukuro'], ['13104', '53394525', 'shinjuku'], ['13104', '53394526', 'shinjuku']] as const;
    for (const [city, mesh, station] of meshes) for (const type of ['bldg', 'tran'] as const) {
      const source = sources.find((item) => item.source_id === `plateau-${city}-${type}-${mesh}`)!;
      expect(source, `${city}-${type}-${mesh}`).toBeDefined();
      expect(source).toMatchObject({ resolution: { kind: 'plateau_catalog_api', catalog_source_id: catalog.source_id, match: `${mesh}_${type}_6697_op.gml` }, license_name: 'CC BY 4.0', publish_gate: 'CONDITIONAL', station_ids: [station] });
      expect(source.expected_url).toMatch(new RegExp(`/udx/${type}/${mesh}_${type}_6697_op\\.gml$`));
      expect(Number.isSafeInteger(source.expected_bytes)).toBe(true);
    }
    // Only the two Ikebukuro bldg meshes exceed the 128 MiB default cap; each is capped at exactly its declared size.
    expect(sources.filter((source) => (source.expected_bytes ?? 0) > 128 * 1024 * 1024).map((source) => source.source_id).sort()).toEqual(['plateau-13116-bldg-53394576', 'plateau-13116-bldg-53394577']);
    // The 2025 metadata ZIPs (lineage evidence) already exist on main and are not duplicated.
    expect(sources.filter((source) => /^plateau-(13116|13104)-metadata$/.test(source.source_id))).toHaveLength(2);
  });

  it('resolves bldg and tran mesh files from the catalog files.<type> list, leaving ubld resolution unchanged', () => {
    const payload = { cities: [{ cityCode: '13116', files: {
      ubld: [{ code: '53394576', url: 'https://example.invalid/udx/ubld/53394576_ubld_6697_op.gml' }],
      bldg: [{ code: '53394577', url: 'https://example.invalid/udx/bldg/53394577_bldg_6697_op.gml' }, { code: '53394576', url: 'https://example.invalid/udx/bldg/53394576_bldg_6697_op.gml', fileSize: 1 }],
      tran: [{ code: '53394576', url: 'https://example.invalid/udx/tran/53394576_tran_6697_op.gml' }],
    }, metadataZipUrls: ['https://example.invalid/x_metadata.zip'] }] };
    const byId = new Map(loadSources().map((source) => [source.source_id, source]));
    expect(selectCatalogResource(byId.get('plateau-13116-bldg-53394576')!, payload)).toEqual({ value: 'https://example.invalid/udx/bldg/53394576_bldg_6697_op.gml', pointer: '/cities/0/files/bldg/1/url' });
    expect(selectCatalogResource(byId.get('plateau-13116-tran-53394576')!, payload).pointer).toBe('/cities/0/files/tran/0/url');
    expect(selectCatalogResource(byId.get('plateau-13116-ubld-53394576')!, payload).pointer).toBe('/cities/0/files/ubld/0/url');
    expect(selectCatalogResource(byId.get('plateau-13116-metadata')!, payload).pointer).toBe('/cities/0/metadataZipUrls/0');
    // A bldg mesh is never satisfied from the tran list.
    expect(() => selectCatalogResource(byId.get('plateau-13116-bldg-53394577')!, { cities: [{ cityCode: '13116', files: { tran: payload.cities[0]!.files.tran } }] })).toThrow(/files\.bldg/);
  });

  it('keeps the 128 MiB cap by default and raises it only to a source\'s own declared expected_bytes', () => {
    const MIB = 1024 * 1024;
    expect(downloadCap()).toBe(128 * MIB);
    expect(downloadCap(null)).toBe(128 * MIB);
    expect(downloadCap(35_427_963)).toBe(128 * MIB); // a small declared size does not lower the default
    expect(downloadCap(128 * MIB)).toBe(128 * MIB);
    expect(downloadCap(153_213_705)).toBe(153_213_705); // cap = expected_bytes, exactly
    expect(downloadCap(168_102_762)).toBe(168_102_762);
    expect(() => downloadCap(512 * MIB + 1)).toThrow(RangeError); // a typo cannot open an unbounded download
    expect(() => downloadCap(1.5 * 200 * MIB + 0.5)).toThrow(RangeError);
  });

  it('streams a decoded body above 128 MiB only when expected_bytes declares it, and stops at exactly that size', async () => {
    const MIB = 1024 * 1024, declared = 129 * MIB;
    const serveZeros = async (total: number): Promise<string> => {
      const server = createServer((_request, response) => {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(total) });
        const chunk = Buffer.alloc(MIB);
        let sent = 0;
        const pump = (): void => {
          while (sent < total) {
            const size = Math.min(MIB, total - sent);
            sent += size;
            if (!response.write(size === MIB ? chunk : chunk.subarray(0, size))) { response.once('drain', pump); return; }
          }
          response.end();
        };
        pump();
      });
      servers.push(server);
      await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
      const address = server.address();
      if (!address || typeof address === 'string') throw new Error('Expected a TCP server address');
      return `http://127.0.0.1:${address.port}/big.gml`;
    };
    const storeRoot = join(await tempStore(), 'store');
    // Without a declaration the default cap refuses the body.
    await expect(downloadUrl(await serveZeros(declared), { storeRoot, backoffMs: 0 })).rejects.toThrow(/exceeded 134217728 byte limit/);
    // Declared exactly: accepted and size-checked.
    const ok = await downloadUrl(await serveZeros(declared), { storeRoot, expectedBytes: declared, backoffMs: 0 });
    expect(ok.bytes).toBe(declared); expect(ok.sizeCheck).toBe('MATCH');
    await unlink(ok.path);
    // One byte more than declared is a hard failure, not a quiet size mismatch.
    await expect(downloadUrl(await serveZeros(declared + 1), { storeRoot, expectedBytes: declared, backoffMs: 0 })).rejects.toThrow(new RegExp(`exceeded ${declared} byte limit`));
  }, 60_000);

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

  it('archives an explicitly requested HTTP error body as evidence without granting success terms', async () => {
    const server = createServer((_request, response) => response.writeHead(404).end('SYNTHETIC missing terms'));
    servers.push(server);
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Expected a TCP server');
    const result = await downloadUrl(`http://127.0.0.1:${address.port}/terms`, { storeRoot: await tempStore(), captureHttpErrors: true });
    expect(result.httpStatus).toBe(404);
    expect((await readFile(result.path)).toString()).toBe('SYNTHETIC missing terms');
    await expect(verifyStoredFile(result.path, result.sha256, result.bytes)).resolves.toBeUndefined();
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
