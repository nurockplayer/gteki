import { mkdtemp, mkdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateRawSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import { BoundedZipReader, inspectVintageZipArchive, verifyVintageEvidence, type RangeFetcher, type RangeResponse, type VintageReport } from '../src/vintage.js';

const crc32 = (bytes: Buffer): number => {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
};

function zip(name: string, contents = Buffer.from('vintage member'), corruptCrc = false, compress = false): Buffer {
  const filename = Buffer.from(name); const crc = (crc32(contents) + (corruptCrc ? 1 : 0)) >>> 0;
  const packed = compress ? deflateRawSync(contents) : contents; const method = compress ? 8 : 0;
  const local = Buffer.alloc(30 + filename.length + packed.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(method, 8); local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(packed.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(filename.length, 26);
  filename.copy(local, 30); packed.copy(local, 30 + filename.length);
  const central = Buffer.alloc(46 + filename.length);
  central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(20, 4); central.writeUInt16LE(20, 6); central.writeUInt16LE(method, 10); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(packed.length, 20); central.writeUInt32LE(contents.length, 24); central.writeUInt16LE(filename.length, 28);
  filename.copy(central, 46);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(central.length, 12); eocd.writeUInt32LE(local.length, 16);
  return Buffer.concat([local, central, eocd]);
}

function zip64(name: string, contents = Buffer.from('zip64 member')): Buffer {
  const filename = Buffer.from(name), crc = crc32(contents); const local = Buffer.alloc(30 + filename.length + contents.length);
  local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(45, 4); local.writeUInt32LE(crc, 14); local.writeUInt32LE(contents.length, 18); local.writeUInt32LE(contents.length, 22); local.writeUInt16LE(filename.length, 26); filename.copy(local, 30); contents.copy(local, 30 + filename.length);
  const extra = Buffer.alloc(28); extra.writeUInt16LE(1, 0); extra.writeUInt16LE(24, 2); extra.writeBigUInt64LE(BigInt(contents.length), 4); extra.writeBigUInt64LE(BigInt(contents.length), 12); extra.writeBigUInt64LE(0n, 20);
  const central = Buffer.alloc(46 + filename.length + extra.length); central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(45, 4); central.writeUInt16LE(45, 6); central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(0xffffffff, 20); central.writeUInt32LE(0xffffffff, 24); central.writeUInt16LE(filename.length, 28); central.writeUInt16LE(extra.length, 30); central.writeUInt32LE(0xffffffff, 42); filename.copy(central, 46); extra.copy(central, 46 + filename.length);
  const centralOffset = local.length, zip64Offset = centralOffset + central.length;
  const zip64eocd = Buffer.alloc(56); zip64eocd.writeUInt32LE(0x06064b50, 0); zip64eocd.writeBigUInt64LE(44n, 4); zip64eocd.writeUInt16LE(45, 12); zip64eocd.writeBigUInt64LE(1n, 24); zip64eocd.writeBigUInt64LE(1n, 32); zip64eocd.writeBigUInt64LE(BigInt(central.length), 40); zip64eocd.writeBigUInt64LE(BigInt(centralOffset), 48);
  const locator = Buffer.alloc(20); locator.writeUInt32LE(0x07064b50, 0); locator.writeBigUInt64LE(BigInt(zip64Offset), 8); locator.writeUInt32LE(1, 16);
  const eocd = Buffer.alloc(22); eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(0xffff, 8); eocd.writeUInt16LE(0xffff, 10); eocd.writeUInt32LE(0xffffffff, 12); eocd.writeUInt32LE(0xffffffff, 16);
  return Buffer.concat([local, central, zip64eocd, locator, eocd]);
}

function serverFor(archive: Buffer, overrides: Partial<RangeResponse> = {}): RangeFetcher {
  return async (_url, start, end) => ({ status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers({ 'content-range': `bytes ${start}-${end}/${archive.length}`, etag: '"stable"' }), bytes: archive.subarray(start, end + 1), ...overrides });
}

describe('bounded vintage ZIP inspection', () => {
  it('lists ZIP member metadata and fetches a selected member with size and CRC checks', async () => {
    const archive = zip('udx/ubld/53394525.gml');
    const result = await inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', serverFor(archive), true);
    expect(result.members).toEqual([expect.objectContaining({ name: 'udx/ubld/53394525.gml', size: 14, mesh: '53394525', category: 'ubld' })]);
    expect(result.validator_type).toBe('STRONG_ETAG');
    // The selected body is verified internally before the archive inspection resolves.
  });

  it('rejects traversal paths before exposing archive entries', async () => {
    const archive = zip('udx/ubld/../../outside.gml');
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', serverFor(archive))).rejects.toThrow('Unsafe ZIP member path');
  });

  it('rejects an incorrect CRC on a selected member', async () => {
    const archive = zip('udx/ubld/53394525.gml', Buffer.from('wrong crc'), true);
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', serverFor(archive), true)).rejects.toThrow('CRC mismatch');
  });

  it('parses ZIP64 entries and valid deflate members', async () => {
    const archive = zip64('udx/ubld/53394525.gml');
    const result = await inspectVintageZipArchive('https://example.invalid/archive.zip', 'v4', serverFor(archive), true);
    expect(result.members[0]).toMatchObject({ size: 12, mesh: '53394525', category: 'ubld' });
    const deflated = zip('udx/ubld/53394525.gml', Buffer.from('deflated payload'), false, true);
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', serverFor(deflated), true)).resolves.toMatchObject({ members: [expect.objectContaining({ method: 8 })] });
  });

  it('rejects malformed ZIP64 disks, counts, and unsafe offsets', async () => {
    const archive = zip64('udx/ubld/53394525.gml');
    const zip64Offset = archive.length - 22 - 20 - 56;
    const multiDisk = Buffer.from(archive); multiDisk.writeUInt32LE(1, zip64Offset + 16);
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v4', serverFor(multiDisk))).rejects.toThrow('multi-disk ZIP64');
    const badCount = Buffer.from(archive); badCount.writeBigUInt64LE(2n, zip64Offset + 24);
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v4', serverFor(badCount))).rejects.toThrow('entry count mismatch');
    const unsafeOffset = Buffer.from(archive); unsafeOffset.writeBigUInt64LE(BigInt(Number.MAX_SAFE_INTEGER) + 1n, archive.length - 22 - 20 + 8);
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v4', serverFor(unsafeOffset))).rejects.toThrow('offset exceeds safe integer');
  });

  it('rejects central/local member name and compressed-size mismatches', async () => {
    const localMismatch = Buffer.from(zip('udx/ubld/53394525.gml')); localMismatch[30] ^= 1;
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v3', serverFor(localMismatch), true)).rejects.toThrow('Local ZIP member name mismatch');
    const sizeMismatch = Buffer.from(zip('udx/ubld/53394525.gml')); const cd = sizeMismatch.readUInt32LE(sizeMismatch.length - 22 + 12); sizeMismatch.writeUInt32LE(sizeMismatch.readUInt32LE(cd + 20) + 1, cd + 20);
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v3', serverFor(sizeMismatch), true)).rejects.toThrow(/overlaps or exceeds directory|size or CRC mismatch/);
  });

  it('rejects non-206 responses, wrong Content-Range identity, and changed validators', async () => {
    const archive = zip('udx/ubld/53394525.gml');
    const non206: RangeFetcher = async (_url, start, end) => ({ status: 200, final_url: 'https://example.invalid/archive.zip', headers: new Headers(), bytes: archive.subarray(start, end + 1) });
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', non206)).rejects.toThrow('Expected HTTP 206');
    const badRange: RangeFetcher = async (_url, start, end) => ({ status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers({ 'content-range': `bytes ${start + 1}-${end + 1}/${archive.length}`, etag: '"stable"' }), bytes: archive.subarray(start, end + 1) });
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', badRange)).rejects.toThrow('does not match requested range');
    let calls = 0;
    const changedEtag: RangeFetcher = async (_url, start, end) => ({ status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers({ 'content-range': `bytes ${start}-${end}/${archive.length}`, etag: ++calls === 1 ? '"one"' : '"two"' }), bytes: archive.subarray(start, end + 1) });
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', changedEtag)).rejects.toThrow('ETag changed');
  });

  it.each([
    ['weak', 'W/"weak"'],
    ['missing', null],
  ])('rejects a %s ETag before using ZIP range bytes', async (_kind, etag) => {
    const archive = zip('udx/ubld/53394525.gml');
    const fetcher: RangeFetcher = async (_url, start, end) => ({
      status: 206, final_url: 'https://example.invalid/archive.zip',
      headers: new Headers({ 'content-range': `bytes ${start}-${end}/${archive.length}`, ...(etag === null ? {} : { etag }) }),
      bytes: archive.subarray(start, end + 1),
    });
    await expect(inspectVintageZipArchive('https://example.invalid/archive.zip', 'v3', fetcher)).rejects.toThrow('requires a strong ETag');
  });

  it('enforces the directory byte budget before issuing a range request', async () => {
    let called = false;
    const fetcher: RangeFetcher = async () => { called = true; return { status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers(), bytes: Buffer.alloc(0) }; };
    const reader = new BoundedZipReader('https://example.invalid/archive.zip', fetcher, 2);
    await expect(reader.read(0, 2)).rejects.toThrow('budget exceeded');
    expect(called).toBe(false);
  });

  it('rejects changed Last-Modified and archive total identities', async () => {
    const archive = zip('udx/ubld/53394525.gml'); let call = 0;
    const changedModified: RangeFetcher = async (_url, start, end) => ({ status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers({ 'content-range': `bytes ${start}-${end}/${archive.length}`, etag: '"stable"', 'last-modified': ++call === 1 ? 'Mon, 01 Jan 2024 00:00:00 GMT' : 'Tue, 02 Jan 2024 00:00:00 GMT' }), bytes: archive.subarray(start, end + 1) });
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v3', changedModified)).rejects.toThrow('Last-Modified changed');
    let totalCall = 0;
    const changedTotal: RangeFetcher = async (_url, start, end) => ({ status: 206, final_url: 'https://example.invalid/archive.zip', headers: new Headers({ 'content-range': `bytes ${start}-${end}/${archive.length + (totalCall++ ? 1 : 0)}`, etag: '"stable"' }), bytes: archive.subarray(start, end + 1) });
    await expect(inspectVintageZipArchive('https://example.invalid/a.zip', 'v3', changedTotal)).rejects.toThrow('total size changed');
  });

  it('rejects evidence paths that escape the private store through a symlink', async () => {
    const root = await mkdtemp(join(tmpdir(), 'vintage-store-')); const outside = await mkdtemp(join(tmpdir(), 'vintage-outside-'));
    await mkdir(join(root, 'raw'), { recursive: true }); await symlink(outside, join(root, 'raw', 'linked'));
    const previous = process.env.GTEKI_GIS_STORE; process.env.GTEKI_GIS_STORE = root;
    try {
      const report = { input_sources: [], archives: [{ archive: 'v3', directory_ranges: [], central_directory_store_path: 'raw/linked/data', central_directory_bytes: 1, sha256: 'a'.repeat(64), members: [], total_entry_count: 0, url: '', total_bytes: 1, etag: null, last_modified: null }], selected_member_records: [] } as unknown as VintageReport;
      const result = await verifyVintageEvidence(report);
      expect(result.status).toBe('FAIL'); expect(result.errors.join(' ')).toMatch(/outside its root|lacks a hashed store artifact/);
    } finally { if (previous === undefined) delete process.env.GTEKI_GIS_STORE; else process.env.GTEKI_GIS_STORE = previous; await rm(root, { recursive: true, force: true }); await rm(outside, { recursive: true, force: true }); }
  });
});

describe('vintage evidence currency and geometry coverage', () => {
  it('reports incomplete geometry coverage for a real scanned fixture with unresolved references', async () => {
    const { scanCityGml } = await import('../src/citygml.js');
    const { fileURLToPath } = await import('node:url');
    const { geometryCoverage, coverageUnknownReason } = await import('../src/vintage.js');
    const inventory = await scanCityGml(fileURLToPath(new URL('./fixtures/ownership-namespace-xlink.xml', import.meta.url)), { source_id: 'synthetic-ownership', source_sha256: 'b'.repeat(64) });
    // The fixture yields a numeric bbox while some geometry references stay unresolved.
    expect(inventory.totals.bbox_lat_lon_height).not.toBeNull();
    const coverage = geometryCoverage(inventory);
    expect(coverage.unresolved + coverage.unsupported_external + coverage.unsupported_reference_records).toBeGreaterThan(0);
    expect(coverage.complete).toBe(false);
    expect(coverageUnknownReason({ geometry_coverage: coverage })).toMatch(/incomplete/);
    expect(coverageUnknownReason({})).toMatch(/missing/);
    expect(coverageUnknownReason(null)).toMatch(/missing/);
  });

  it('fails offline verification for a missing or stale tool fingerprint', async () => {
    const base = { input_sources: [], archives: [], selected_member_records: [] } as unknown as VintageReport;
    for (const value of [undefined, '0'.repeat(64)]) {
      const result = await verifyVintageEvidence({ ...base, tool_input_sha256: value } as unknown as VintageReport);
      expect(result.status).toBe('FAIL');
      expect(result.errors.join(' ')).toMatch(/tool_input_sha256|tool fingerprint/);
    }
  });

  const gmlModel = (members: string) => `<?xml version="1.0" encoding="UTF-8"?>
<core:CityModel xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:bldg="http://www.opengis.net/citygml/building/2.0">
<gml:boundedBy><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3"><gml:lowerCorner>35.70 139.70 0</gml:lowerCorner><gml:upperCorner>35.74 139.74 10</gml:upperCorner></gml:Envelope></gml:boundedBy>
<core:cityObjectMember><bldg:Building gml:id="b1"><bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${members}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid></bldg:Building></core:cityObjectMember></core:CityModel>`;
  const linearRing = '<gml:surfaceMember><gml:Polygon gml:id="p1"><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">35.700 139.700 1 35.700 139.701 1 35.701 139.701 1 35.700 139.700 1</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:surfaceMember>';
  const scanXml = async (xml: string) => {
    const { scanCityGml } = await import('../src/citygml.js');
    const dir = await mkdtemp(join(tmpdir(), 'gteki-gis-coverage-'));
    try { const file = join(dir, 'm.gml'); await (await import('node:fs/promises')).writeFile(file, xml); return await scanCityGml(file, { source_id: 'synthetic-coverage', source_sha256: 'b'.repeat(64) }); }
    finally { await rm(dir, { recursive: true, force: true }); }
  };

  it('treats a fully ring-consumed model as complete coverage (control)', async () => {
    const { geometryCoverage } = await import('../src/vintage.js');
    const inventory = await scanXml(gmlModel(linearRing));
    expect(inventory.geometry_coverage_gaps.unconsumed_coordinate_elements).toBe(0);
    expect(geometryCoverage(inventory).complete).toBe(true);
  });

  it.each([
    ['gml:Ring/curveMember/LineString in a polygon', '<gml:surfaceMember><gml:Polygon gml:id="p2"><gml:exterior><gml:Ring><gml:curveMember><gml:LineString><gml:posList srsDimension="3">35.730 139.730 1 35.730 139.731 1 35.731 139.731 1 35.730 139.730 1</gml:posList></gml:LineString></gml:curveMember></gml:Ring></gml:exterior></gml:Polygon></gml:surfaceMember>', 'posList'],
    ['gml:Curve segments', '<gml:surfaceMember><gml:Polygon gml:id="p3"><gml:exterior><gml:Ring><gml:curveMember><gml:Curve><gml:segments><gml:LineStringSegment><gml:posList srsDimension="3">35.730 139.730 1 35.731 139.731 1</gml:posList></gml:LineStringSegment></gml:segments></gml:Curve></gml:curveMember></gml:Ring></gml:exterior></gml:Polygon></gml:surfaceMember>', 'posList'],
    ['gml:Triangle ring outside a gml:Polygon', '<gml:surfaceMember><gml:Triangle><gml:exterior><gml:LinearRing><gml:posList srsDimension="3">35.730 139.730 1 35.730 139.731 1 35.731 139.731 1 35.730 139.730 1</gml:posList></gml:LinearRing></gml:exterior></gml:Triangle></gml:surfaceMember>', 'posList'],
    ['gml:Point pos', '<gml:surfaceMember><gml:Point><gml:pos srsDimension="3">35.730 139.730 1</gml:pos></gml:Point></gml:surfaceMember>', 'pos'],
    ['gml:coordinates', '<gml:surfaceMember><gml:LineString><gml:coordinates>139.73,35.73,1 139.74,35.74,1</gml:coordinates></gml:LineString></gml:surfaceMember>', 'coordinates'],
    ['gml:coord (GML2)', '<gml:surfaceMember><gml:LineString><gml:coord><gml:X>139.73</gml:X><gml:Y>35.73</gml:Y></gml:coord></gml:LineString></gml:surfaceMember>', 'coord'],
  ])('flags coverage incomplete when %s holds coordinates the bbox scanner did not consume', async (_label, extra, element) => {
    const { geometryCoverage, coverageUnknownReason } = await import('../src/vintage.js');
    const inventory = await scanXml(gmlModel(linearRing + extra));
    // The bbox only covers the consumed LinearRing polygon; the omitted geometry must make coverage incomplete.
    expect(inventory.totals.bbox_lat_lon_height?.max[0]).toBeLessThan(35.72);
    expect(inventory.geometry_coverage_gaps.by_element[element]).toBeGreaterThan(0);
    const coverage = geometryCoverage(inventory);
    expect(coverage.complete).toBe(false);
    expect(coverageUnknownReason({ geometry_coverage: coverage })).toMatch(/did not consume/);
  });

  it('fails closed when an inventory carries no gap evidence', async () => {
    const { geometryCoverage } = await import('../src/vintage.js');
    const inventory = await scanXml(gmlModel(linearRing));
    const { geometry_coverage_gaps: _omit, ...legacy } = inventory;
    expect(geometryCoverage(legacy as unknown as typeof inventory).complete).toBe(false);
  });
});
