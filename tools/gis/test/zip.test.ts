import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { readZip } from '../src/zip.js';

const dirs: string[] = [];

function crc32(buffer: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function makeStoredZip(name: string, content: Buffer, options: { encrypted?: boolean; symlink?: boolean } = {}): Buffer {
  const filename = Buffer.from(name);
  const compressedContent = options.encrypted ? Buffer.concat([Buffer.alloc(12), content]) : content;
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt32LE(options.encrypted ? 1 : 0, 6);
  local.writeUInt32LE(0, 8);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(compressedContent.length, 18);
  local.writeUInt32LE(content.length, 22);
  local.writeUInt16LE(filename.length, 26);
  const localRecord = Buffer.concat([local, filename, compressedContent]);

  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE((3 << 8) | 20, 4);
  central.writeUInt16LE(20, 6);
  central.writeUInt32LE(options.encrypted ? 1 : 0, 8);
  central.writeUInt32LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressedContent.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  central.writeUInt32LE(options.symlink ? (0o120777 << 16) >>> 0 : 0, 38);
  const centralRecord = Buffer.concat([central, filename]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

async function zipPath(name: string, content: Buffer, options: { encrypted?: boolean; symlink?: boolean } = {}): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-gis-zip-'));
  dirs.push(dir);
  const path = join(dir, 'fixture.zip');
  await writeFile(path, makeStoredZip(name, content, options));
  return path;
}

afterEach(async () => Promise.all(dirs.splice(0).map((path) => rm(path, { recursive: true, force: true }))));

describe('safe ZIP reader', () => {
  it('reads entries in process and enforces uncompressed limits', async () => {
    const content = Buffer.from('synthetic only');
    const path = await zipPath('nested/fixture.txt', content);
    const entries = await readZip(path, { maxEntryBytes: 64, maxTotalBytes: 64 });
    expect(entries).toEqual([{ name: 'nested/fixture.txt', data: content }]);
    await expect(readZip(path, { maxEntryBytes: 4, maxTotalBytes: 64 })).rejects.toThrow('exceeds size limit');
  });

  it.each(['../escape.txt', '/absolute.txt', 'C:\\absolute.txt'])('rejects unsafe entry name %s', async (name) => {
    const path = await zipPath(name, Buffer.from('x'));
    await expect(readZip(path)).rejects.toThrow(/path|segment/i);
  });

  it('rejects symbolic-link and encrypted entries', async () => {
    const symlink = await zipPath('linked.txt', Buffer.from('target'), { symlink: true });
    const encrypted = await zipPath('locked.txt', Buffer.from('ciphertext'), { encrypted: true });
    await expect(readZip(symlink)).rejects.toThrow('Symbolic-link ZIP entry');
    await expect(readZip(encrypted)).rejects.toThrow(/Encrypted ZIP entry|encrypted/i);
  });
});
