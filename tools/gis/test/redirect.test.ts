import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

const curl = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({ execFile: Object.assign(curl, {
  [Symbol.for('nodejs.util.promisify.custom')]: (...args: unknown[]) => new Promise((resolve, reject) => {
    curl(...args, (error: Error | null, stdout: string, stderr: string) => error ? reject(error) : resolve({ stdout, stderr }));
  }),
}) }));
import { downloadUrl } from '../src/acquire.js';

const stores: string[] = [];
afterEach(async () => {
  vi.unstubAllGlobals(); curl.mockReset();
  await Promise.all(stores.splice(0).map(path => rm(path, { recursive: true, force: true })));
});

// SYNTHETIC responses only. No listener, DNS lookup or network request is made.
describe.each([undefined, 'curl'] as const)('%s zero-hop redirect policy', transport => {
  it.each([
    ['HTTP downgrade', 'http://public.example.invalid/file'],
    ['private IPv4', 'https://10.0.0.1/secret'],
    ['loopback', 'http://127.0.0.1/admin'],
    ['link-local metadata', 'http://169.254.169.254/latest/meta-data/'],
    ['IPv6 ULA', 'https://[fd00::1]/secret'],
    ['IPv6 loopback', 'https://[::1]/admin'],
    ['localhost', 'https://localhost/admin'],
    ['off-allowlist host', 'https://other.example.invalid/file'],
    ['same-host hop limit / loop', '/declared'],
  ])('refuses %s before any follow-up request, even when HTTP errors are captured', async (_label, location) => {
    const url = 'https://public.example.invalid/declared';
    const storeRoot = await mkdtemp(join(tmpdir(), 'gteki-gis-redirect-')); stores.push(storeRoot);
    const fetchMock = vi.fn(async () => new Response('SYNTHETIC redirect body', { status: 302, headers: { location } }));
    vi.stubGlobal('fetch', fetchMock);
    curl.mockImplementation((_command, args, _options, callback) => {
      void Promise.all([
        writeFile(args[args.indexOf('--dump-header') + 1], `HTTP/1.1 302 Found\r\nLocation: ${location}\r\n\r\n`),
        writeFile(args[args.indexOf('--output') + 1], 'SYNTHETIC redirect body'),
      ]).then(() => callback(null, `302\n${url}`, ''), callback);
    });
    await expect(downloadUrl(url, { storeRoot, transport, captureHttpErrors: true, backoffMs: 0 })).rejects.toThrow(`Location=${location}; redirect hop limit is 0`);
    expect(await readdir(join(storeRoot, 'tmp'))).toEqual([]);
    expect(await readdir(storeRoot)).toEqual(['tmp']);
    if (transport === 'curl') {
      expect(curl).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
      const args = curl.mock.calls[0][1];
      expect(args[0]).toBe('-q'); expect(args).not.toContain('--location'); expect(args).not.toContain('-L');
      expect(args[args.indexOf('--max-redirs') + 1]).toBe('0');
    } else {
      expect(fetchMock).toHaveBeenCalledTimes(1); expect(curl).not.toHaveBeenCalled();
      expect(fetchMock.mock.calls[0]).toEqual([url, expect.objectContaining({ redirect: 'manual' })]);
    }
  });
});

it.each([300, 301, 302, 303, 304, 307, 308])('also refuses HTTP %s for fixed POST without rewriting or replaying its body', async status => {
  const storeRoot = await mkdtemp(join(tmpdir(), 'gteki-gis-redirect-')); stores.push(storeRoot);
  const request = { method: 'POST' as const, content_type: 'application/json' as const, body: '{"query":"SYNTHETIC 駅"}' };
  const fetchMock = vi.fn(async () => new Response(null, { status, headers: { location: '/next' } }));
  vi.stubGlobal('fetch', fetchMock);
  await expect(downloadUrl('https://public.example.invalid/graphql', { storeRoot, request })).rejects.toThrow(`Redirect refused: HTTP ${status}`);
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith('https://public.example.invalid/graphql', expect.objectContaining({ method: 'POST', body: request.body, redirect: 'manual' }));
});

it('records an absent Location and refuses the redirect', async () => {
  const storeRoot = await mkdtemp(join(tmpdir(), 'gteki-gis-redirect-')); stores.push(storeRoot);
  const fetchMock = vi.fn(async () => new Response(null, { status: 302 })); vi.stubGlobal('fetch', fetchMock);
  await expect(downloadUrl('https://public.example.invalid/declared', { storeRoot })).rejects.toThrow('Location=(absent)');
  expect(fetchMock).toHaveBeenCalledTimes(1);
});
