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

function makeStoredZip(name: string | Buffer, content: Buffer, options: { encrypted?: boolean; symlink?: boolean; utf8?: boolean; centralExtra?: Buffer } = {}): Buffer {
  const filename = Buffer.isBuffer(name) ? name : Buffer.from(name);
  const compressedContent = options.encrypted ? Buffer.concat([Buffer.alloc(12), content]) : content;
  const crc = crc32(content);
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE((options.encrypted ? 1 : 0) | (options.utf8 ? 0x800 : 0), 6);
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
  central.writeUInt16LE((options.encrypted ? 1 : 0) | (options.utf8 ? 0x800 : 0), 8);
  central.writeUInt32LE(0, 10);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(compressedContent.length, 20);
  central.writeUInt32LE(content.length, 24);
  central.writeUInt16LE(filename.length, 28);
  const centralExtra = options.centralExtra ?? Buffer.alloc(0);
  central.writeUInt16LE(centralExtra.length, 30);
  central.writeUInt32LE(options.symlink ? (0o120777 << 16) >>> 0 : 0, 38);
  const centralRecord = Buffer.concat([central, filename, centralExtra]);

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(1, 8);
  end.writeUInt16LE(1, 10);
  end.writeUInt32LE(centralRecord.length, 12);
  end.writeUInt32LE(localRecord.length, 16);
  return Buffer.concat([localRecord, centralRecord, end]);
}

async function zipPath(name: string | Buffer, content: Buffer, options: { encrypted?: boolean; symlink?: boolean; utf8?: boolean; centralExtra?: Buffer } = {}): Promise<string> {
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
    expect(entries).toEqual([expect.objectContaining({ name: 'nested/fixture.txt', data: content, name_encoding_status: 'ASCII_ONLY', name_cp932_candidate: null })]);
    await expect(readZip(path, { maxEntryBytes: 4, maxTotalBytes: 64 })).rejects.toThrow('exceeds size limit');
  });

  // 「新宿駅周辺の施設情報.geojson」 as CP932 bytes without the UTF-8 flag (the S03 archive shape).
  const cp932Name = Buffer.from('90568f6889778efc95d382cc8e7b90dd8fee95f12e67656f6a736f6e', 'hex');
  it('keeps raw name bytes as identity and records a labelled CP932 candidate for undeclared non-ASCII names', async () => {
    const content = Buffer.from('{}');
    const [entry] = await readZip(await zipPath(cp932Name, content));
    expect(entry!.name_bytes_hex).toBe(cp932Name.toString('hex'));
    expect(entry!.name_encoding_status).toBe('CANDIDATE_CP932_UNDECLARED');
    expect(entry!.name_utf8_flag).toBe(false);
    expect(entry!.name_cp932_candidate).toBe('新宿駅周辺の施設情報.geojson');
    // Specification decoding stays the stable lookup key and is the CP437 mojibake.
    expect(entry!.name_cp437).toBe(entry!.name);
    expect(entry!.name).not.toBe(entry!.name_cp932_candidate);
    expect(entry!.name).toBe('ÉVÅhëwÄⁿò╙é╠Ä{É▌Åεò±.geojson');
    expect(entry!.data).toEqual(content);
    // Re-reading yields identical identity (hash-stable).
    const again = await readZip(await zipPath(cp932Name, content));
    expect(again[0]!.name_bytes_hex).toBe(entry!.name_bytes_hex);
    expect(again[0]!.name).toBe(entry!.name);
  });

  it('uses UTF-8 and no CP932 candidate when the UTF-8 flag is set', async () => {
    const utf8Name = Buffer.from('新宿駅.geojson', 'utf8');
    const [entry] = await readZip(await zipPath(utf8Name, Buffer.from('{}'), { utf8: true }));
    expect(entry).toMatchObject({ name: '新宿駅.geojson', name_encoding_status: 'DECLARED_UTF8', name_utf8_flag: true, name_utf8: '新宿駅.geojson', name_cp437: null, name_cp932_candidate: null, name_bytes_hex: utf8Name.toString('hex') });
  });

  /** Info-ZIP Unicode Path extra field (0x7075): version 1, CRC-32 of the raw header name, UTF-8 name. */
  const unicodePathField = (rawName: Buffer, unicodeName: string, crcOfRaw = crc32(rawName)): Buffer => {
    const utf8 = Buffer.from(unicodeName, 'utf8');
    const data = Buffer.alloc(5 + utf8.length);
    data.writeUInt8(1, 0); data.writeUInt32LE(crcOfRaw >>> 0, 1); utf8.copy(data, 5);
    const header = Buffer.alloc(4);
    header.writeUInt16LE(0x7075, 0); header.writeUInt16LE(data.length, 2);
    return Buffer.concat([header, data]);
  };

  it('records DECLARED_UNICODE_PATH_EXTRA when an Info-ZIP Unicode Path field (0x7075) matches the raw name CRC', async () => {
    const [entry] = await readZip(await zipPath(cp932Name, Buffer.from('{}'), { centralExtra: unicodePathField(cp932Name, '新宿駅周辺の施設情報.geojson') }));
    expect(entry).toMatchObject({
      name: '新宿駅周辺の施設情報.geojson', name_encoding_status: 'DECLARED_UNICODE_PATH_EXTRA', name_utf8_flag: false,
      name_utf8: '新宿駅周辺の施設情報.geojson', name_cp932_candidate: null, name_bytes_hex: cp932Name.toString('hex'),
    });
    expect(entry!.name_cp437).toBe('ÉVÅhëwÄⁿò╙é╠Ä{É▌Åεò±.geojson');
  });

  it('ignores a Unicode Path field whose CRC does not match the raw name', async () => {
    const [entry] = await readZip(await zipPath(cp932Name, Buffer.from('{}'), { centralExtra: unicodePathField(cp932Name, 'wrong.geojson', 0x12345678) }));
    expect(entry).toMatchObject({ name_encoding_status: 'CANDIDATE_CP932_UNDECLARED', name_utf8: null, name_cp932_candidate: '新宿駅周辺の施設情報.geojson' });
    expect(entry!.name).toBe(entry!.name_cp437);
  });

  it('records no candidate when undeclared bytes are not valid CP932', async () => {
    const invalid = Buffer.from('ff fe 2e 74 78 74'.replaceAll(' ', ''), 'hex');
    const [entry] = await readZip(await zipPath(invalid, Buffer.from('x')));
    expect(entry).toMatchObject({ name_encoding_status: 'UNDECLARED_UNRESOLVED', name_cp932_candidate: null, name_bytes_hex: invalid.toString('hex') });
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
