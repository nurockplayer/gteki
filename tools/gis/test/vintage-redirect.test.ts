import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchRange } from '../src/vintage.js';

// Mirrors main's acquisition rule (see redirect.test.ts): a fixed URL has a zero-hop redirect budget.
const URL_A = 'https://assets.example.invalid/archive.zip';
const response = (status: number, headers: Record<string, string>, body: Buffer | null, finalUrl = URL_A) => {
  const result = new Response(body ? new Uint8Array(body) : null, { status, headers });
  Object.defineProperty(result, 'url', { value: finalUrl });
  return result;
};
afterEach(() => vi.unstubAllGlobals());

describe('vintage range fetcher', () => {
  it('requests with redirect "manual" and the Range / If-Range / identity headers', async () => {
    const fetched = vi.fn(async () => response(206, { 'content-range': 'bytes 0-3/10' }, Buffer.alloc(4)));
    vi.stubGlobal('fetch', fetched);
    const result = await fetchRange(URL_A, 0, 3, '"strong"');
    expect(result.bytes).toHaveLength(4);
    const init = (fetched.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect(init.redirect).toBe('manual');
    expect(init.headers).toMatchObject({ Range: 'bytes=0-3', 'If-Range': '"strong"', 'Accept-Encoding': 'identity' });
  });
  it.each([301, 302, 307, 308])('refuses an HTTP %s redirect instead of following it', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => response(status, { location: 'https://cdn.example.invalid/other.zip' }, null)));
    await expect(fetchRange(URL_A, 0, 3, null)).rejects.toThrow(/Redirect refused: HTTP \d+ from .*redirect hop limit is 0/);
  });
  it('rejects a response whose final URL is not the pinned resource URL', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(206, { 'content-range': 'bytes 0-3/10' }, Buffer.alloc(4), 'https://cdn.example.invalid/other.zip')));
    await expect(fetchRange(URL_A, 0, 3, null)).rejects.toThrow('differs from the pinned resource URL');
  });
  it('rejects 200 and oversize bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => response(200, {}, Buffer.alloc(4))));
    await expect(fetchRange(URL_A, 0, 3, null)).rejects.toThrow('Expected HTTP 206');
    vi.stubGlobal('fetch', vi.fn(async () => response(206, { 'content-range': 'bytes 0-3/10' }, Buffer.alloc(9))));
    await expect(fetchRange(URL_A, 0, 3, null)).rejects.toThrow('exceeded requested range');
  });
});
