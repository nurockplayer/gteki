import { createHash } from 'node:crypto';
import { inflateRawSync } from 'node:zlib';
import { mkdir } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import { assertPathWithinStore, docsRoot, ensurePrivateStore, getGitCommit, getStoredSource, getStoreRoot, readJson, storeRelativePath, verifyStoredFile, TOOL_VERSION } from './common.js';
import { bboxMeshes, meshBounds } from './mesh.js';
import { toolFingerprint } from './provenance.js';
import { crsName, geographicCrs } from './crs-declaration.js';
import { isIncompleteBboxStatus } from './geo-bbox.js';
import { assertNetworkInspectionCurrent } from './network-evidence.js';
import { describeZipName, type ZipNameInfo } from './zip-names.js';
import { inspectCityGmlPath, type CityInventory } from './citygml.js';
import { commitReportFiles, type ReportFile } from './report-transaction.js';

const PACKAGE_ID = 'plateau-13104-package-2023';
const DIR_BUDGET = 16 * 1024 * 1024;
const MEMBER_COMPRESSED_BUDGET = 32 * 1024 * 1024;
const MEMBER_UNCOMPRESSED_BUDGET = 64 * 1024 * 1024;
const MEMBER_TOTAL_BUDGET = 128 * 1024 * 1024;
const MAX_SELECTED_MEMBERS = 16;
const TAIL_BYTES = 65_557;
const REPORT_DIR = join(docsRoot, 'gis', 'vintages');
/** The only origin the live fetcher accepts for 2023 archives; the CKAN package URL is used verbatim and redirects are refused. */
const PLATEAU_ASSET_ORIGIN = 'https://assets.cms.plateau.reearth.io';

export type VintageZipMember = {
  name: string; name_bytes: number; compressed_size: number; size: number; crc32: string; method: number; flags: number;
  local_header_offset: number; mesh: string | null; category: 'udx' | 'ubld' | null;
} & ZipNameInfo;
/** Geometry-reference completeness of one inspected CityGML member; a bbox from partial geometry is not a coverage claim. */
export type GeometryCoverage = { total_references: number; resolved: number; unresolved: number; unsupported_external: number; unsupported_reference_records: number; unconsumed_coordinate_elements: number; complete: boolean };
export function geometryCoverage(inventory: Pick<CityInventory, 'geometry_reference_summary' | 'unsupported_geometry_references' | 'totals' | 'geometry_coverage_gaps'>): GeometryCoverage {
  const summary = inventory.geometry_reference_summary, records = inventory.unsupported_geometry_references.length;
  // Missing gap evidence is treated as unconsumed: fail closed.
  const gaps = inventory.geometry_coverage_gaps?.unconsumed_coordinate_elements;
  const unconsumed = typeof gaps === 'number' && Number.isInteger(gaps) && gaps >= 0 ? gaps : Number.MAX_SAFE_INTEGER;
  return { total_references: summary.total, resolved: summary.resolved, unresolved: summary.unresolved, unsupported_external: summary.unsupported_external, unsupported_reference_records: records, unconsumed_coordinate_elements: unconsumed,
    complete: unconsumed === 0 && summary.unresolved === 0 && summary.unsupported_external === 0 && records === 0 && summary.total === summary.resolved && inventory.totals.bbox_lat_lon_height !== null };
}
/** Why a member's bbox cannot support INTERSECTS/DISJOINT, or null when geometry coverage is complete. */
export function coverageUnknownReason(inspection: { geometry_coverage?: GeometryCoverage } | null): string | null {
  const coverage = inspection?.geometry_coverage;
  if (!coverage) return 'CityGML geometry coverage evidence is missing';
  if (coverage.complete) return null;
  return `CityGML geometry coverage is incomplete (${coverage.unresolved} unresolved, ${coverage.unsupported_external} unsupported external, ${coverage.unsupported_reference_records} unsupported reference records of ${coverage.total_references} references; ${coverage.unconsumed_coordinate_elements} coordinate-bearing geometry elements the bbox scanner did not consume); the bbox covers only the geometry that resolved`;
}

export type VintageRange = { start: number; end: number; bytes: number; final_url: string; requested_at: string; completed_at: string; sha256?: string; store_path?: string };
export type VintageValidatorType = 'STRONG_ETAG';
export type VintageArchiveInspection = {
  archive: string; url: string; final_url: string; total_bytes: number; etag: string | null; last_modified: string | null; validator_type: VintageValidatorType;
  directory_ranges: VintageRange[]; members: VintageZipMember[]; total_entry_count: number; sha256: string;
  central_directory_store_path?: string; central_directory_bytes?: number;
  member_inventory?: { sha256: string; bytes: number; store_path: string; entry_count: number };
};
export type VintageReport = {
  source_id: typeof PACKAGE_ID; verification: 'UNVERIFIED'; routable: false;
  rights: 'HOLD'; status: 'PENDING_PACKAGE' | 'INSPECTED' | 'PARTIAL';
  generated_at: string; package_sha256: string | null; archives: VintageArchiveInspection[];
  input_sources: Array<{ source_id: string; sha256: string }>;
  tool_input_sha256: string;
  selected_member_records: Array<{ archive: string; final_url: string; member: string; sha256: string; bytes: number; store_path: string; ranges: VintageRange[]; etag: string | null; last_modified: string | null; validator_type: VintageValidatorType; crc32: string; size: number; inspection: { verification: 'UNVERIFIED'; feature_count: number; polygon_count: number; envelope: { lower: number[]; upper: number[]; srsName: string | null; axis_order: 'latitude,longitude,height' } | null; bbox_lat_lon_height: unknown; unknowns: string[]; geometry_coverage?: GeometryCoverage } | null; inspection_error: string | null }>;
  comparison: { current_catalog_source_id: string; target_mesh: string; bbox_meshes: string[]; current_2025_ubld: Array<{ code: string; url: string; file_size: number | null }>; meshes_2023: string[]; meshes_2025: string[]; only_2023: string[]; only_2025: string[]; touching_target_2023: string[]; bbox_relations: Array<{ archive: string; layer: string; source_crs: string | null; layer_crs: string | null; layer_crs_status: 'DECLARED_NAME' | 'UNKNOWN'; layer_bbox_status: string | null; unknown_reason: string | null; relation: 'INTERSECTS' | 'DISJOINT' | 'UNKNOWN'; intersection_bbox_lat_lon: number[] | null }>; note: string };
  byte_totals: { directory_range_bytes: number; member_range_bytes: number; extracted_member_bytes: number; requested_http_bytes: number };
  limitations: string[];
};

export type RangeResponse = { status: number; final_url: string; headers: Headers; bytes: Buffer };
export type RangeFetcher = (url: string, start: number, end: number, ifRange: string | null) => Promise<RangeResponse>;
export const fetchRange: RangeFetcher = async (url, start, end, ifRange) => {
  const headers: Record<string, string> = { Range: `bytes=${start}-${end}`, 'Accept-Encoding': 'identity' };
  if (ifRange) headers['If-Range'] = ifRange;
  // Main's acquisition rule: a fixed URL has a zero-hop redirect budget. The final URL must be the pinned resource URL.
  const response = await fetch(url, { headers, redirect: 'manual', signal: AbortSignal.timeout(30_000) });
  if (response.status >= 300 && response.status < 400) {
    await response.body?.cancel();
    throw new RangeError(`Redirect refused: HTTP ${response.status} from ${url}; Location=${response.headers.get('location') ?? '(absent)'}; redirect hop limit is 0. Pin the final URL in the source manifest.`);
  }
  if (response.status !== 206) { await response.body?.cancel(); throw new Error(`Expected HTTP 206 for ZIP range, got ${response.status}`); }
  const maximum = end - start + 1;
  if (!response.body) throw new Error('ZIP range response has no body');
  const chunks: Buffer[] = []; let received = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    received += bytes.length;
    if (received > maximum) { await response.body.cancel().catch(() => undefined); throw new Error(`ZIP server exceeded requested range by sending more than ${maximum} bytes`); }
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks, received);
  if (response.url !== url) throw new Error(`ZIP range final URL ${response.url} differs from the pinned resource URL ${url}`);
  return { status: response.status, final_url: response.url, headers: response.headers, bytes };
};

function parseContentRange(value: string | null): { start: number; end: number; total: number } {
  const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(value ?? '');
  if (!match) throw new Error(`Invalid or missing Content-Range: ${value}`);
  const result = { start: Number(match[1]), end: Number(match[2]), total: Number(match[3]) };
  if (!Object.values(result).every(Number.isSafeInteger) || result.start > result.end || result.end >= result.total) throw new Error('Invalid Content-Range bounds');
  return result;
}

function isStrongEtag(value: string | null): value is string {
  return value !== null && /^"[\x21\x23-\x7e\x80-\xff]*"$/.test(value);
}

function isHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string' || !value) return false;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:'; } catch { return false; }
}

/** Only strong ETags establish byte identity. No Last-Modified or unvalidated fallback is used. */
export class BoundedZipReader {
  private total: number | null = null;
  private etag: string | null = null;
  private lastModified: string | null = null;
  private finalUrl: string | null = null;
  private directoryBytes = 0;
  readonly ranges: VintageRange[] = [];
  readonly directoryRanges: VintageRange[] = [];
  readonly rangePayloads: Buffer[] = [];
  constructor(readonly url: string, readonly fetcher: RangeFetcher = fetchRange, readonly budget = DIR_BUDGET) {}

  async read(start: number, end: number, purpose: 'directory' | 'member' = 'directory', memberCap = MEMBER_COMPRESSED_BUDGET): Promise<Buffer> {
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || end < start) throw new Error('Invalid ZIP byte range');
    const size = end - start + 1;
    if (purpose === 'directory') {
      if (this.directoryBytes + size > this.budget) throw new Error(`ZIP directory range budget exceeded (${this.budget} bytes)`);
    } else if (size > memberCap) throw new Error(`ZIP member range exceeds ${memberCap} byte cap`);
    const requestedAt = new Date().toISOString();
    const validator = this.etag;
    const response = await this.fetcher(this.url, start, end, validator);
    const completedAt = new Date().toISOString();
    if (response.status !== 206) throw new Error(`Expected HTTP 206 for ZIP range, got ${response.status}`);
    const contentRange = parseContentRange(response.headers.get('content-range'));
    if (contentRange.start !== start || contentRange.end !== end || response.bytes.length !== size) throw new Error('ZIP response does not match requested range');
    if (this.total !== null && this.total !== contentRange.total) throw new Error('ZIP total size changed between ranges');
    const etag = response.headers.get('etag');
    const lastModified = response.headers.get('last-modified');
    const encoding = response.headers.get('content-encoding');
    if (encoding && encoding.toLowerCase() !== 'identity') throw new Error(`Unexpected ZIP Content-Encoding: ${encoding}`);
    if (!isStrongEtag(etag)) throw new Error('ZIP range identity requires a strong ETag; weak, missing or malformed ETags cannot combine ranges (no re-read fallback implemented)');
    if (this.etag !== null && etag !== this.etag) throw new Error('ZIP ETag changed between ranges');
    if (this.lastModified !== null && lastModified !== this.lastModified) throw new Error('ZIP Last-Modified changed between ranges');
    if (!isHttpUrl(response.final_url)) throw new Error('ZIP range identity requires a valid final URL');
    if (this.finalUrl !== null && response.final_url !== this.finalUrl) throw new Error('ZIP final URL changed between ranges');
    this.total = contentRange.total;
    this.finalUrl = response.final_url;
    if (this.etag === null) this.etag = etag;
    if (this.lastModified === null && lastModified !== null) this.lastModified = lastModified;
    this.ranges.push({ start, end, bytes: response.bytes.length, final_url: response.final_url, requested_at: requestedAt, completed_at: completedAt });
    this.rangePayloads.push(response.bytes);
    if (purpose === 'directory') { this.directoryBytes += size; this.directoryRanges.push(this.ranges.at(-1)!); }
    return response.bytes;
  }
  get totalBytes(): number { if (this.total === null) throw new Error('ZIP length is not known'); return this.total; }
  get identity(): { etag: string | null; lastModified: string | null; final_url: string | null; validator_type: VintageValidatorType } { return { etag: this.etag, lastModified: this.lastModified, final_url: this.finalUrl, validator_type: 'STRONG_ETAG' }; }
  async readSuffix(length: number): Promise<Buffer> {
    if (this.total === null) await this.read(0, 0);
    const size = Math.min(length, this.totalBytes);
    return this.read(this.totalBytes - size, this.totalBytes - 1);
  }
}

function u16(b: Buffer, o: number): number { return b.readUInt16LE(o); }
function u32(b: Buffer, o: number): number { return b.readUInt32LE(o); }
const CP437_HIGH = 'ÇüéâäàåçêëèïîìÄÅÉæÆôöòûùÿÖÜ¢£¥₧ƒáíóúñÑªº¿⌐¬½¼¡«»░▒▓│┤╡╢╖╕╣║╗╝╜╛┐└┴┬├─┼╞╟╚╔╩╦╠═╬╧╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀αßΓπΣσµτΦΘΩδ∞φε∩≡±≥≤⌠⌡÷≈°∙·√ⁿ²■ ';
function decodeZipName(bytes: Buffer, utf8: boolean): string {
  if (utf8) return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  let result = '';
  for (const byte of bytes) result += byte < 0x80 ? String.fromCharCode(byte) : CP437_HIGH[byte - 0x80] ?? '';
  return result;
}
function safeZipName(name: string): boolean {
  const parts = name.split('/');
  if (name.endsWith('/')) parts.pop();
  return name.length > 0 && !name.includes('\0') && !name.startsWith('/') && !name.startsWith('\\') && !/^[a-zA-Z]:/.test(name)
    && !name.includes('\\') && parts.every(part => part !== '..' && part !== '.' && part !== '');
}
function zip64Values(extra: Buffer, needs: Array<'size' | 'compressed' | 'offset' | 'disk'>): Map<string, number> {
  const values = new Map<string, number>(); let cursor = 0;
  while (cursor + 4 <= extra.length) {
    const id = u16(extra, cursor), length = u16(extra, cursor + 2); cursor += 4;
    if (cursor + length > extra.length) throw new Error('Malformed ZIP extra field');
    if (id === 0x0001) {
      let p = cursor;
      for (const key of needs) {
        if (key === 'disk') { if (p + 4 > cursor + length) throw new Error('Truncated ZIP64 disk field'); values.set(key, u32(extra, p)); p += 4; }
        else { if (p + 8 > cursor + length) throw new Error('Truncated ZIP64 size field'); const n = extra.readBigUInt64LE(p); if (n > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 value exceeds safe integer'); values.set(key, Number(n)); p += 8; }
      }
      return values;
    }
    cursor += length;
  }
  if (needs.length) throw new Error('ZIP64 sentinel lacks ZIP64 extra field');
  return values;
}

function zipMembers(directory: Buffer, total: number, centralOffset: number): VintageZipMember[] {
  const result: VintageZipMember[] = []; let p = 0; const names = new Set<string>();
  while (p < directory.length) {
    if (p + 46 > directory.length || u32(directory, p) !== 0x02014b50) throw new Error('Malformed ZIP central directory entry');
    const flags = u16(directory, p + 8), method = u16(directory, p + 10), crc = u32(directory, p + 16);
    let compressed = u32(directory, p + 20), size = u32(directory, p + 24), nameLength = u16(directory, p + 28), extraLength = u16(directory, p + 30), commentLength = u16(directory, p + 32), disk = u16(directory, p + 34), offset = u32(directory, p + 42);
    const end = p + 46 + nameLength + extraLength + commentLength;
    if (end > directory.length) throw new Error('Truncated ZIP central directory entry');
    const name = decodeZipName(directory.subarray(p + 46, p + 46 + nameLength), Boolean(flags & 0x800));
    if (!safeZipName(name)) throw new Error(`Unsafe ZIP member path: ${name}`);
    if (names.has(name)) throw new Error(`Duplicate ZIP member path: ${name}`); names.add(name);
    const extra = directory.subarray(p + 46 + nameLength, p + 46 + nameLength + extraLength);
    const needs: Array<'size' | 'compressed' | 'offset' | 'disk'> = [];
    if (size === 0xffffffff) needs.push('size'); if (compressed === 0xffffffff) needs.push('compressed'); if (offset === 0xffffffff) needs.push('offset'); if (disk === 0xffff) needs.push('disk');
    const z64 = zip64Values(extra, needs);
    size = z64.get('size') ?? size; compressed = z64.get('compressed') ?? compressed; offset = z64.get('offset') ?? offset; disk = z64.get('disk') ?? disk;
    if (disk !== 0) throw new Error('Multi-disk ZIP archives are unsupported');
    if (offset + 30 > total || centralOffset + directory.length > total) throw new Error('ZIP central directory offsets exceed archive size');
    if (flags & 1) throw new Error(`Encrypted ZIP member is unsupported: ${name}`);
    if (((u32(directory,p+38)>>>16)&0o170000)===0o120000)throw new Error(`Symbolic-link ZIP member is unsupported: ${name}`);
    if (method !== 0 && method !== 8) throw new Error(`Unsupported ZIP compression method ${method}: ${name}`);
    const match = /(?:^|[^0-9])(\d{8})(?:[^0-9]|$)/.exec(name);
    const category = /(?:^|\/)ubld(?:\/|$)/i.test(name) ? 'ubld' : /(?:^|\/)udx(?:\/|$)/i.test(name) ? 'udx' : null;
    result.push({ name, ...describeZipName(directory.subarray(p + 46, p + 46 + nameLength), Boolean(flags & 0x800)), name_bytes: nameLength, compressed_size: compressed, size, crc32: crc.toString(16).padStart(8, '0'), method, flags, local_header_offset: offset, mesh: match?.[1] ?? null, category });
    p = end;
  }
  return result;
}

function crc32(bytes: Buffer): number {
  let crc = 0xffffffff;
  for (const value of bytes) { crc ^= value; for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0); }
  return (crc ^ 0xffffffff) >>> 0;
}

function meshTouches(code: string, target: [number, number, number, number]): boolean {
  if (!/^\d{8}$/.test(code)) return false;
  const bounds = meshBounds(code);
  return bounds[0] <= target[2] && bounds[2] >= target[0] && bounds[1] <= target[3] && bounds[3] >= target[1];
}

async function inspectArchive(archive: string, url: string, fetcher = fetchRange, fetchMember = false, bboxCodeList: string[] = []): Promise<{ result: VintageArchiveInspection; selected: Array<{ member: VintageZipMember; bytes: Buffer; ranges: VintageRange[] }>; allMembers: VintageZipMember[]; centralDirectory: Buffer; ranges: VintageRange[]; rangePayloads: Buffer[] }> {
  const reader = new BoundedZipReader(url, fetcher);
  // The initial suffix probe cannot know archive length, so request the bounded ZIP EOCD/comment window from the end.
  const suffix = await reader.readSuffix(TAIL_BYTES);
  const eocdAt = findSignatureBackwards(suffix, 0x06054b50);
  if (eocdAt < 0 || eocdAt + 22 > suffix.length) throw new Error('ZIP end-of-central-directory record not found');
  const commentLength = u16(suffix, eocdAt + 20);
  if (eocdAt + 22 + commentLength !== suffix.length) throw new Error('Malformed ZIP EOCD comment length');
  if (u16(suffix, eocdAt + 4) !== 0 || u16(suffix, eocdAt + 6) !== 0 || u16(suffix, eocdAt + 8) !== u16(suffix, eocdAt + 10)) throw new Error('Multi-disk ZIP EOCD is unsupported');
  let count = u16(suffix, eocdAt + 10), dirSize = u32(suffix, eocdAt + 12), dirOffset = u32(suffix, eocdAt + 16);
  let directoryEndLimit = reader.totalBytes - suffix.length + eocdAt;
  if (count === 0xffff || dirSize === 0xffffffff || dirOffset === 0xffffffff) {
    const locatorAt = eocdAt - 20;
    if (locatorAt < 0 || u32(suffix, locatorAt) !== 0x07064b50) throw new Error('ZIP64 locator missing');
    if (u32(suffix, locatorAt + 4) !== 0 || u32(suffix, locatorAt + 16) !== 1) throw new Error('Multi-disk ZIP64 locator is unsupported');
    const zOffsetBig = suffix.readBigUInt64LE(locatorAt + 8);
    if (zOffsetBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 EOCD offset exceeds safe integer');
    const zOffset = Number(zOffsetBig); const zhead = await reader.read(zOffset, zOffset + 55);
    if (u32(zhead, 0) !== 0x06064b50 || zhead.readBigUInt64LE(4) < 44n || u32(zhead, 16) !== 0 || u32(zhead, 20) !== 0) throw new Error('Malformed or multi-disk ZIP64 EOCD');
    const entriesOnDisk = zhead.readBigUInt64LE(24), countBig = zhead.readBigUInt64LE(32);
    if (entriesOnDisk !== countBig || countBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 entry count mismatch or exceeds safe integer');
    count = Number(countBig); const sizeBig = zhead.readBigUInt64LE(40), offsetBig = zhead.readBigUInt64LE(48);
    if (sizeBig > BigInt(Number.MAX_SAFE_INTEGER) || offsetBig > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('ZIP64 directory exceeds safe integer');
    dirSize = Number(sizeBig); dirOffset = Number(offsetBig);
    directoryEndLimit = zOffset;
  }
  if (dirSize > DIR_BUDGET || count > 1_000_000) throw new Error('ZIP central directory exceeds configured bounds');
  const directory = dirSize ? await reader.read(dirOffset, dirOffset + dirSize - 1) : Buffer.alloc(0);
  if (dirOffset + dirSize > directoryEndLimit) throw new Error('ZIP central directory overlaps its end record');
  const members = zipMembers(directory, reader.totalBytes, dirOffset);
  if (members.length !== count) throw new Error(`ZIP entry count mismatch (${members.length} vs ${count})`);
  const targetBounds = meshBounds('53394525');
  const touches = (code: string | null, target: [number, number, number, number]): boolean => {
    if (!code || code.length !== 8) return false;
    const [x0, y0, x1, y1] = meshBounds(code);
    return x0 <= target[2] && x1 >= target[0] && y0 <= target[3] && y1 >= target[1];
  };
  const bboxBounds = bboxCodeList.map(code => meshBounds(code));
  // Closed intersection includes edge- and corner-touching meshes.
  const selected = fetchMember ? members.filter(m => m.category === 'ubld' && (touches(m.mesh, targetBounds) || bboxBounds.some(bounds => touches(m.mesh, bounds)))) : [];
  if (selected.length > MAX_SELECTED_MEMBERS) throw new Error(`Selected ZIP member count exceeds cap (${MAX_SELECTED_MEMBERS})`);
  const memberBytes = selected.reduce((sum, member) => sum + 30 + member.name_bytes + member.compressed_size, 0);
  if (memberBytes > MEMBER_TOTAL_BUDGET) throw new Error(`Selected ZIP member ranges exceed aggregate ${MEMBER_TOTAL_BUDGET} byte cap`);
  const downloaded = [];
  for (const member of selected) {
    if (member.size > MEMBER_UNCOMPRESSED_BUDGET || member.compressed_size + 30 > MEMBER_COMPRESSED_BUDGET) throw new Error(`Selected member exceeds compressed or uncompressed cap: ${member.name}`);
    const rangeStart = reader.ranges.length;
    const header = await reader.read(member.local_header_offset, member.local_header_offset + 29, 'member', MEMBER_COMPRESSED_BUDGET);
    if (u32(header, 0) !== 0x04034b50) throw new Error(`Malformed local ZIP header: ${member.name}`);
    const localFlags = u16(header, 6), localMethod = u16(header, 8), localNameLength = u16(header, 26), localExtraLength = u16(header, 28);
    if (localFlags !== member.flags || localMethod !== member.method) throw new Error(`Local ZIP header flags or method mismatch: ${member.name}`);
    if (localNameLength !== member.name_bytes) throw new Error(`Local ZIP member name length mismatch: ${member.name}`);
    const localName = localNameLength ? await reader.read(member.local_header_offset + 30, member.local_header_offset + 29 + localNameLength, 'member', MEMBER_COMPRESSED_BUDGET) : Buffer.alloc(0);
    if (decodeZipName(localName, Boolean(localFlags & 0x800)) !== member.name) throw new Error(`Local ZIP member name mismatch: ${member.name}`);
    const start = member.local_header_offset + 30 + localNameLength + localExtraLength;
    if (start + member.compressed_size > reader.totalBytes || start + member.compressed_size > dirOffset) throw new Error(`ZIP member data overlaps or exceeds directory: ${member.name}`);
    const raw = member.compressed_size ? await reader.read(start, start + member.compressed_size - 1, 'member', MEMBER_COMPRESSED_BUDGET) : Buffer.alloc(0);
    const contents = member.method === 0 ? raw : inflateRawSync(raw, { maxOutputLength: MEMBER_UNCOMPRESSED_BUDGET });
    if (contents.length !== member.size || crc32(contents).toString(16).padStart(8, '0') !== member.crc32) throw new Error(`ZIP member size or CRC mismatch: ${member.name}`);
    downloaded.push({ member, bytes: contents, ranges: reader.ranges.slice(rangeStart) });
  }
  const ranges = [...reader.directoryRanges];
  return { result: { archive, url, final_url: reader.identity.final_url!, total_bytes: reader.totalBytes, etag: reader.identity.etag, last_modified: reader.identity.lastModified, validator_type: reader.identity.validator_type, directory_ranges: ranges, members: members.filter(member => member.category === 'ubld'), total_entry_count: members.length, sha256: createHash('sha256').update(directory).digest('hex') }, selected: downloaded, allMembers: members, centralDirectory: directory, ranges: reader.ranges, rangePayloads: reader.rangePayloads };
}

async function persistRangeEvidence(ranges: VintageRange[], payloads: Buffer[]): Promise<void> {
  if (ranges.length !== payloads.length) throw new Error('ZIP range evidence and payload count mismatch');
  const root = getStoreRoot();
  for (let i = 0; i < ranges.length; i++) {
    const range = ranges[i]!; const payload = payloads[i]!;
    const sha256 = createHash('sha256').update(payload).digest('hex');
    const storePath = storeRelativePath(sha256, `range-${range.start}-${range.end}.bin`);
    const path = join(root, storePath); await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    await assertPathWithinStore(root, dirname(path));
    try { await verifyStoredFile(path, sha256, payload.length); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      const { writeFile } = await import('node:fs/promises'); await writeFile(path, payload, { mode: 0o600, flag: 'wx' });
      await assertPathWithinStore(root, path);
    }
    range.sha256 = sha256; range.store_path = storePath;
  }
}

async function persistHashedBlob(bytes: Buffer, filename: string): Promise<{ sha256: string; bytes: number; store_path: string }> {
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const storePath = storeRelativePath(sha256, filename); const root = getStoreRoot(); const path = join(root, storePath);
  await mkdir(dirname(path), { recursive: true, mode: 0o700 }); await assertPathWithinStore(root, dirname(path));
  try { await assertPathWithinStore(root, path); await verifyStoredFile(path, sha256, bytes.length); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { writeFile } = await import('node:fs/promises'); await writeFile(path, bytes, { mode: 0o600, flag: 'wx' }); await assertPathWithinStore(root, path);
  }
  return { sha256, bytes: bytes.length, store_path: storePath };
}

async function prepareDirectoryEvidence(archive: VintageArchiveInspection, allMembers: VintageZipMember[], centralDirectory: Buffer, packageSource: { source_id: string; sha256: string; json_pointer: string }): Promise<ReportFile> {
  const central = await persistHashedBlob(centralDirectory, `${archive.archive}-central-directory.bin`);
  if (central.sha256 !== archive.sha256) throw new Error(`${archive.archive} central directory SHA-256 changed during evidence storage`);
  archive.central_directory_store_path = central.store_path; archive.central_directory_bytes = central.bytes;
  const inventoryBytes = Buffer.from(`${JSON.stringify(allMembers)}\n`, 'utf8');
  const inventory = await persistHashedBlob(inventoryBytes, `${archive.archive}-member-inventory.json`);
  archive.member_inventory = { ...inventory, entry_count: allMembers.length };
  const sourceId = `vintage-directory-${archive.archive.replaceAll('_', '-')}`;
  return jsonReport(join(docsRoot, 'gis', 'acquisitions', 'vintages', `${sourceId}.json`), {
    source_id: sourceId, acquisition_kind: 'ZIP_CENTRAL_DIRECTORY', archive: archive.archive, resolved_url: archive.url, final_url: archive.final_url,
    package_source: packageSource, central_directory: central, member_inventory: { ...inventory, entry_count: allMembers.length },
    total_archive_bytes: archive.total_bytes, etag: archive.etag, last_modified: archive.last_modified, validator_type: archive.validator_type,
    ranges: archive.directory_ranges, requested_at: archive.directory_ranges[0]?.requested_at, completed_at: archive.directory_ranges.at(-1)?.completed_at,
    tool_version: TOOL_VERSION, git_commit: await getGitCommit(), verification: 'UNVERIFIED', routable: false, publish_gate: 'HOLD', licence: { value: null, status: 'UNKNOWN' },
  });
}

/** Exposed for deterministic tests; production callers use inspectVintages(). */
export async function inspectVintageZipArchive(url: string, archive: string, fetcher: RangeFetcher, fetchMembers = false): Promise<VintageArchiveInspection> {
  return (await inspectArchive(archive, url, fetcher, fetchMembers)).result;
}

function findSignatureBackwards(buffer: Buffer, signature: number): number { for (let p = buffer.length - 22; p >= 0; p--) if (u32(buffer, p) === signature) return p; return -1; }

async function resourcesFromPackageResult(): Promise<{ sha256: string; resources: Array<{ name: string; url: string; json_pointer: string }> }> {
  const { record, path } = await getStoredSource(PACKAGE_ID);
  const payload = await readJson<{ success?: boolean; result?: { resources?: Array<{ name?: string; url?: string }> } }>(path);
  if (!payload||typeof payload!=='object'||!Object.hasOwn(payload,'success')||payload.success !== true || !Object.hasOwn(payload,'result')||!payload.result||!Object.hasOwn(payload.result,'resources')||!Array.isArray(payload.result.resources)) throw new Error(`${PACKAGE_ID} acquisition is not a valid CKAN package result.resources payload`);
  const resources = payload.result.resources.flatMap((resource, index) => {
    if(!resource||typeof resource!=='object'||!Object.hasOwn(resource,'url')||typeof resource.url!=='string')return [];
    const url = resource.url;
    if (!url.startsWith('https://')) return [];
    let filename: string;
    try { filename = new URL(url).pathname.split('/').at(-1) ?? ''; } catch { return []; }
    return /^13104_.*_2023_citygml_[12]_op\.zip$/i.test(filename) ? [{ name: filename.toLowerCase().endsWith('_2_op.zip') ? 'citygml_2_op.zip' : 'citygml_1_op.zip', url, json_pointer: `/result/resources/${index}/url` }] : [];
  });
  return { sha256: record.sha256, resources };
}

function requireUniqueArchiveResources(resources: Array<{ name: string; url: string; json_pointer: string }>): Array<{ name: string; url: string; json_pointer: string }> {
  return ['citygml_2_op.zip', 'citygml_1_op.zip'].map(name => {
    const matches = resources.filter(resource => resource.name === name);
    if (matches.length !== 1) throw new Error(`Package result.resources must contain exactly one acquired resource for ${name}; found ${matches.length}`);
    return matches[0]!;
  });
}

async function prepareMember(archive: string, url: string, item: { member: VintageZipMember; bytes: Buffer; ranges: VintageRange[] }, identity: { etag: string | null; last_modified: string | null; final_url: string; validator_type: VintageValidatorType }, packageSource: { source_id: string; sha256: string; json_pointer: string }): Promise<{ member: VintageReport['selected_member_records'][number]; receipt: ReportFile }> {
  const sha256 = createHash('sha256').update(item.bytes).digest('hex');
  const storePath = storeRelativePath(sha256, item.member.name.split('/').at(-1) || 'member.bin');
  const root = getStoreRoot(); const full = join(root, storePath); await mkdir(dirname(full), { recursive: true, mode: 0o700 });
  await assertPathWithinStore(root, dirname(full));
  try { await verifyStoredFile(full, sha256, item.bytes.length); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const { writeFile } = await import('node:fs/promises'); await writeFile(full, item.bytes, { mode: 0o600, flag: 'wx' });
    await assertPathWithinStore(root, full);
  }
  const record = { source_id: `vintage-member-${sha256.slice(0, 16)}`, archive, member: item.member.name, sha256, bytes: item.bytes.length, store_path: storePath,
    ranges: item.ranges, etag: identity.etag, last_modified: identity.last_modified, validator_type: identity.validator_type, crc32: item.member.crc32, size: item.member.size, requested_at: item.ranges[0]?.requested_at ?? new Date().toISOString(), completed_at: new Date().toISOString(),
    acquisition_kind: 'DERIVED_EXACT_ARCHIVE_MEMBER', resolved_url: url, final_url: identity.final_url, package_source: { source_id: packageSource.source_id, sha256: packageSource.sha256, json_pointer: packageSource.json_pointer },
    tool_version: TOOL_VERSION, git_commit: await getGitCommit(), verification: 'UNVERIFIED', routable: false, publish_gate: 'HOLD', licence: { value: null, status: 'UNKNOWN' } };
  let inspection: VintageReport['selected_member_records'][number]['inspection'] = null;
  let inspectionError: string | null = null;
  try {
    const inventory = await inspectCityGmlPath(full, { source_id: `vintage-member-${sha256.slice(0, 16)}`, source_sha256: sha256 });
    inspection = { verification: 'UNVERIFIED', feature_count: inventory.totals.feature_count, polygon_count: inventory.totals.polygon_count, envelope: inventory.envelope, bbox_lat_lon_height: inventory.totals.bbox_lat_lon_height, unknowns: inventory.unknowns, geometry_coverage: geometryCoverage(inventory) };
  } catch (error) { throw new Error(`Unable to inspect acquired CityGML member ${item.member.name}: ${error instanceof Error ? error.message : String(error)}`); }
  return { receipt: jsonReport(join(docsRoot, 'gis', 'acquisitions', 'vintages', `${record.source_id}.json`), record), member: { archive, final_url: identity.final_url, member: item.member.name, sha256, bytes: item.bytes.length, store_path: storePath, ranges: item.ranges, etag: identity.etag, last_modified: identity.last_modified, validator_type: identity.validator_type, crc32: item.member.crc32, size: item.member.size, inspection, inspection_error: inspectionError } };
}

export type E27Layer = { layer: string; bbox: number[] | null; crs: string | null; crs_status: 'DECLARED_NAME' | 'UNKNOWN'; bbox_status: string | null };
type NetworkInspection = { source_id?: string; source_sha256?: string; tool_input_sha256?: string; input_sources?: unknown; network_inventory?: { crs?: unknown }; members?: Array<{ file: string; bbox: number[] | null; bbox_status?: unknown; crs?: unknown }> };

function validLonLatBbox(bbox: unknown): bbox is [number, number, number, number] {
  return Array.isArray(bbox) && bbox.length === 4 && bbox.every(value => typeof value === 'number' && Number.isFinite(value))
    && bbox[0]! <= bbox[2]! && bbox[1]! <= bbox[3]! && bbox[0]! >= -180 && bbox[2]! <= 180 && bbox[1]! >= -90 && bbox[3]! <= 90;
}

type InputSourceRef = { source_id: string; sha256: string };
const E27_NETWORK_REPORTS = ['hokonavi-oedo-shinjuku-network-geojson', 'hokonavi-oedo-shinjuku-stationmap-geojson'];

function mergeInputSources(inputs: InputSourceRef[]): InputSourceRef[] {
  const merged = new Map<string, string>();
  for (const input of inputs) {
    const prior = merged.get(input.source_id);
    if (prior !== undefined && prior !== input.sha256) throw new Error(`Conflicting SHA-256 for input source ${input.source_id}`);
    merged.set(input.source_id, input.sha256);
  }
  return [...merged].map(([source_id, sha256]) => ({ source_id, sha256 }));
}

/**
 * The single rule set for the E27 network reports that feed vintage comparisons: each report must be current
 * (assertNetworkInspectionCurrent: source, tool fingerprint, complete acquisition lineage). The vintage report then
 * inherits the report's whole transitive input_sources (including walking-network specifications), so generation and
 * offline verification cannot disagree about which inputs matter.
 */
async function currentE27NetworkEvidence(fingerprint: string): Promise<{ layers: E27Layer[]; inputs: InputSourceRef[] }> {
  const layers: E27Layer[] = []; const inputs: InputSourceRef[] = [];
  for (const sourceId of E27_NETWORK_REPORTS) {
    const stored = await getStoredSource(sourceId);
    const network = await readJson<NetworkInspection>(join(docsRoot, 'gis', 'networks', `${sourceId}.json`));
    if (network.source_sha256 !== stored.record.sha256) throw new Error(`E27 network report source SHA mismatch: ${sourceId}`);
    // Source SHA alone accepts a report produced by older tools or lineage: require full currency.
    await assertNetworkInspectionCurrent(network, sourceId, { fingerprint });
    inputs.push({ source_id: sourceId, sha256: stored.record.sha256 });
    for (const item of network.input_sources as InputSourceRef[]) inputs.push({ source_id: item.source_id, sha256: item.sha256 });
    layers.push(...effectiveNetworkLayers(sourceId, network));
  }
  return { layers, inputs: mergeInputSources(inputs) };
}

/**
 * Effective CRS and bbox of each saved network layer. A layer is usable only when its own `crs` is a plain {type:"name"}
 * geographic declaration, its bbox is complete (`bbox_status` COMPUTED) and valid, and no other declaration in the same
 * report conflicts with it. Linked, typed, malformed, null, assumed, conflicting or INCOMPLETE inputs are UNKNOWN: they
 * select no mesh and compare as UNKNOWN, never DISJOINT.
 */
export function effectiveNetworkLayers(sourceId: string, network: NetworkInspection): E27Layer[] {
  const members = network.members ?? [];
  const names = members.map(member => crsName(member.crs));
  // A combined declaration which the inspector marked UNKNOWN (members disagree, or an explicit "crs": null) taints every layer.
  const combined = network.network_inventory?.crs;
  const combinedUnknown = combined !== undefined && combined !== null && typeof combined === 'object' && (combined as { status?: unknown }).status === 'UNKNOWN';
  // Every declared name counts, geographic or not: a station-map report has no combined declaration to expose a EPSG:6668 vs EPSG:6677 disagreement.
  const declared = names.filter((name): name is string => typeof name === 'string').map(name => name.trim().toUpperCase());
  const conflicting = new Set(declared).size > 1 || combinedUnknown;
  return members.map((member, index) => {
    const name = names[index];
    const bboxStatus = typeof member.bbox_status === 'string' ? member.bbox_status : null;
    const usable = typeof name === 'string' && geographicCrs(name) && !conflicting && bboxStatus === 'COMPUTED' && !isIncompleteBboxStatus(bboxStatus) && validLonLatBbox(member.bbox);
    return { layer: `${sourceId}:${member.file}`, bbox: usable ? member.bbox : null, crs: usable ? name as string : null, crs_status: usable ? 'DECLARED_NAME' as const : 'UNKNOWN' as const, bbox_status: bboxStatus };
  });
}

/** Inspect 2023 CityGML archive ZIP directories using bounded HTTP ranges. No archive is downloaded whole. */
export async function inspectVintages(options: { fetcher?: RangeFetcher; fetchMembers?: boolean; bbox?: [number, number, number, number] } = {}): Promise<VintageReport> {
  const pkg = await resourcesFromPackageResult();
  if (!pkg.resources.length) throw new Error(`Acquisition result.resources contains no exact CityGML archive URLs for ${PACKAGE_ID}`);
  // Resolve both archive identities before any range request or evidence write. Duplicate
  // resource URLs remain ambiguous because their package pointers identify separate entries.
  const resources = requireUniqueArchiveResources(pkg.resources);
  // Live fetches accept only the official PLATEAU asset origin, with the package URL used verbatim (no redirect is followed).
  if (!options.fetcher) for (const resource of resources) if (new URL(resource.url).origin !== PLATEAU_ASSET_ORIGIN) throw new Error(`Package resource ${resource.name} is outside the pinned official origin ${PLATEAU_ASSET_ORIGIN}`);
  ensurePrivateStore();
  const { record: catalogRecord, path: catalogPath } = await getStoredSource('plateau-catalog-ubld-mesh-533945');
  const catalog = await readJson<{ cities?: Array<{ cityCode?: string; year?: number; files?: { ubld?: Array<{ code?: string; url?: string; fileSize?: number }> } }> }>(catalogPath);
  const current2025 = (catalog.cities ?? []).filter(city => city.cityCode === '13104' && city.year === 2025).flatMap(city => city.files?.ubld ?? []).map(file => ({ code: file.code ?? 'unknown', url: file.url ?? '', file_size: file.fileSize ?? null }));
  const e27Fingerprint = await toolFingerprint();
  const { layers: e27Layers, inputs: e27Inputs } = await currentE27NetworkEvidence(e27Fingerprint);
  const networkBboxes = e27Layers.flatMap(layer => layer.bbox ? bboxMeshes(layer.bbox) : []);
  const currentBboxMeshes = [...new Set([...(options.bbox ? bboxMeshes(options.bbox) : []), ...networkBboxes])].sort();
  const report: VintageReport = { source_id: PACKAGE_ID, verification: 'UNVERIFIED', routable: false, rights: 'HOLD', status: 'PENDING_PACKAGE', generated_at: new Date().toISOString(), package_sha256: pkg?.sha256 ?? null, archives: [], selected_member_records: [],
    comparison: { current_catalog_source_id: 'plateau-catalog-ubld-mesh-533945', target_mesh: '53394525', bbox_meshes: currentBboxMeshes, current_2025_ubld: current2025, meshes_2023: [], meshes_2025: current2025.map(file => file.code).filter(code => /^\d{8}$/.test(code)).sort(), only_2023: [], only_2025: [], touching_target_2023: [], bbox_relations: [], note: '2023 geometry uses declared EPSG:6697 latitude,longitude axes; E27 network layers use declared EPSG:6668 longitude,latitude axes. Both are JGD2011 horizontal coordinates; intersections are bbox-only with no feature or routing claim.' },
    byte_totals: { directory_range_bytes: 0, member_range_bytes: 0, extracted_member_bytes: 0, requested_http_bytes: 0 },
    input_sources: mergeInputSources([{ source_id: PACKAGE_ID, sha256: pkg.sha256 }, { source_id: 'plateau-catalog-ubld-mesh-533945', sha256: catalogRecord.sha256 }, ...e27Inputs]),
    tool_input_sha256: await toolFingerprint(),
    limitations: ['Rights remain HOLD pending rights review.', 'Every vintage finding is UNVERIFIED and routable:false.', 'Only ZIP directory ranges and explicitly selected member bytes may be acquired.'] };
  const files = new Map<string, ReportFile>();
  for (const resource of resources) {
    const bboxCodes = [...new Set([...networkBboxes, ...(options.bbox ? bboxMeshes(options.bbox) : [])])];
    const inspected = await inspectArchive(resource.name, resource.url, options.fetcher, options.fetchMembers !== false, bboxCodes);
    await persistRangeEvidence(inspected.ranges, inspected.rangePayloads);
    const directory = await prepareDirectoryEvidence(inspected.result, inspected.allMembers, inspected.centralDirectory, { source_id: PACKAGE_ID, sha256: pkg.sha256, json_pointer: resource.json_pointer });
    files.set(directory.path, directory);
    report.archives.push(inspected.result);
    for (const member of inspected.selected) {
      const prepared = await prepareMember(resource.name, resource.url, member, inspected.result, { source_id: PACKAGE_ID, sha256: pkg.sha256, json_pointer: resource.json_pointer });
      report.selected_member_records.push(prepared.member);
      // The legacy content-addressed source ID cannot distinguish two resource origins.
      // Fail the entire preparation rather than discard either archive's provenance.
      if (files.has(prepared.receipt.path)) throw new Error(`Ambiguous vintage member receipt identity across archive resources: ${prepared.member.sha256}`);
      files.set(prepared.receipt.path, prepared.receipt);
    }
  }
  const all2023 = report.archives.flatMap(archive => archive.members).filter(member => member.category === 'ubld');
  report.comparison.meshes_2023 = [...new Set(all2023.map(member => member.mesh).filter((mesh): mesh is string => Boolean(mesh)))].sort();
  report.comparison.only_2023 = report.comparison.meshes_2023.filter(mesh => !report.comparison.meshes_2025.includes(mesh));
  report.comparison.only_2025 = report.comparison.meshes_2025.filter(mesh => !report.comparison.meshes_2023.includes(mesh));
  const target = meshBounds(report.comparison.target_mesh);
  report.comparison.touching_target_2023 = all2023.filter(member => member.mesh && meshTouches(member.mesh, target)).map(member => member.name).sort();
  report.comparison.bbox_relations = report.selected_member_records.flatMap(member => e27Layers.map(layer => {
    const vintage = member.inspection?.bbox_lat_lon_height as { min?: number[]; max?: number[] } | null;
    const sourceCrs = member.inspection?.envelope?.srsName ?? null;
    const isCode=(value:unknown,code:string):boolean=>typeof value==='string'&&[`EPSG:${code}`,`HTTP://WWW.OPENGIS.NET/DEF/CRS/EPSG/0/${code}`,`URN:OGC:DEF:CRS:EPSG::${code}`].includes(value.toUpperCase());
    const isJgd2011 = isCode(sourceCrs,'6697') && isCode(layer.crs,'6668');
    const finitePair = (value: unknown): boolean => Array.isArray(value) && value.length >= 2 && value.slice(0, 2).every(item => typeof item === 'number' && Number.isFinite(item));
    const coverageReason = coverageUnknownReason(member.inspection);
    if (coverageReason !== null || !vintage || !finitePair(vintage.min) || !finitePair(vintage.max) || !layer.bbox || !isJgd2011) return { archive: member.archive, layer: layer.layer, source_crs: sourceCrs, layer_crs: layer.crs, layer_crs_status: layer.crs_status, layer_bbox_status: layer.bbox_status, unknown_reason: coverageReason ?? 'CRS or bbox of a compared layer is not usable', relation: 'UNKNOWN' as const, intersection_bbox_lat_lon: null };
    const networkLonLat = layer.bbox;
    const vMin = vintage.min!, vMax = vintage.max!;
    const intersection: [number, number, number, number] = [Math.max(vMin[0]!, networkLonLat[1]!), Math.max(vMin[1]!, networkLonLat[0]!), Math.min(vMax[0]!, networkLonLat[3]!), Math.min(vMax[1]!, networkLonLat[2]!)];
    const intersects = intersection[0] <= intersection[2] && intersection[1] <= intersection[3];
    return { archive: member.archive, layer: layer.layer, source_crs: sourceCrs, layer_crs: layer.crs, layer_crs_status: layer.crs_status, layer_bbox_status: layer.bbox_status, unknown_reason: null, relation: intersects ? 'INTERSECTS' as const : 'DISJOINT' as const, intersection_bbox_lat_lon: intersects ? intersection : null };
  }));
  report.byte_totals.directory_range_bytes = report.archives.flatMap(archive => archive.directory_ranges).reduce((sum, range) => sum + range.bytes, 0);
  report.byte_totals.member_range_bytes = report.selected_member_records.flatMap(member => member.ranges).reduce((sum, range) => sum + range.bytes, 0);
  report.byte_totals.extracted_member_bytes = report.selected_member_records.reduce((sum, member) => sum + member.bytes, 0);
  report.byte_totals.requested_http_bytes = report.byte_totals.directory_range_bytes + report.byte_totals.member_range_bytes;
  if (report.archives.length) report.status = 'INSPECTED';
  const evidenceCheck = await verifyVintageEvidence(report);
  if (evidenceCheck.status !== 'PASS') throw new Error(`Vintage evidence failed offline verification: ${evidenceCheck.errors.join('; ')}`);
  for (const file of prepareReport(report)) files.set(file.path, file);
  await commitReportFiles([...files.values()], join(docsRoot, 'gis'));
  return report;
}

/** Offline integrity check for the saved vintage receipt and all content-addressed evidence it names. */
export async function verifyVintageEvidence(report: VintageReport): Promise<{ status: 'PASS' | 'FAIL'; errors: string[] }> {
  const errors: string[] = [];
  const root = getStoreRoot();
  try {
    const current = await toolFingerprint();
    if (typeof report.tool_input_sha256 !== 'string' || !report.tool_input_sha256) errors.push('vintage report lacks tool_input_sha256');
    else if (report.tool_input_sha256 !== current) errors.push(`vintage report tool fingerprint ${report.tool_input_sha256} differs from current ${current}`);
  } catch (error) { errors.push(`tool fingerprint unavailable: ${error instanceof Error ? error.message : String(error)}`); }
  const artifacts: Array<{ label: string; bytes: number; sha256: string; store_path: string }> = [];
  for (const archive of report.archives) for (const range of archive.directory_ranges) {
    if (!range.sha256 || !range.store_path) errors.push(`${archive.archive} range ${range.start}-${range.end} lacks a hashed store artifact`);
    else artifacts.push({ label: `${archive.archive} range ${range.start}-${range.end}`, bytes: range.bytes, sha256: range.sha256, store_path: range.store_path });
  }
  for (const archive of report.archives) {
    if (!isHttpUrl(archive.final_url) || archive.directory_ranges.some(range => range.final_url !== archive.final_url)) errors.push(`${archive.archive} lacks matching final URL range identity`);
    if (archive.validator_type !== 'STRONG_ETAG' || !isStrongEtag(archive.etag)) errors.push(`${archive.archive} lacks a strong ETag identity validator`);
    if (!archive.central_directory_store_path || !archive.central_directory_bytes) errors.push(`${archive.archive} central directory lacks a hashed store artifact`);
    else artifacts.push({ label: `${archive.archive} central directory`, bytes: archive.central_directory_bytes, sha256: archive.sha256, store_path: archive.central_directory_store_path });
    if (!archive.member_inventory) errors.push(`${archive.archive} parsed member inventory lacks a hashed store artifact`);
    else artifacts.push({ label: `${archive.archive} parsed member inventory`, bytes: archive.member_inventory.bytes, sha256: archive.member_inventory.sha256, store_path: archive.member_inventory.store_path });
  }
  for (const member of report.selected_member_records) {
    const archive = report.archives.find(a => a.archive === member.archive);
    if (!isHttpUrl(member.final_url) || member.final_url !== archive?.final_url || member.ranges.some(range => range.final_url !== member.final_url)) errors.push(`${member.member} lacks matching final URL archive identity`);
    if (member.validator_type !== 'STRONG_ETAG' || !isStrongEtag(member.etag) || member.etag !== archive?.etag) errors.push(`${member.member} lacks matching strong ETag archive identity`);
    for (const range of member.ranges) {
      if (!range.sha256 || !range.store_path) errors.push(`${member.member} range ${range.start}-${range.end} lacks a hashed store artifact`);
      else artifacts.push({ label: `${member.member} range ${range.start}-${range.end}`, bytes: range.bytes, sha256: range.sha256, store_path: range.store_path });
    }
    artifacts.push({ label: `${member.member} extracted member`, bytes: member.bytes, sha256: member.sha256, store_path: member.store_path });
  }
  try {
    const required = await currentE27NetworkEvidence(await toolFingerprint());
    const recorded = new Map((Array.isArray(report.input_sources) ? report.input_sources : []).map(item => [item?.source_id, item?.sha256]));
    for (const input of required.inputs) {
      if (!recorded.has(input.source_id)) errors.push(`vintage report lacks required network lineage input ${input.source_id}`);
      else if (recorded.get(input.source_id) !== input.sha256) errors.push(`vintage report input ${input.source_id} SHA-256 differs from the current E27 network lineage`);
    }
  } catch (error) { errors.push(`E27 network lineage: ${error instanceof Error ? error.message : String(error)}`); }
  for (const source of report.input_sources) {
    try {
      const stored = await getStoredSource(source.source_id);
      if (stored.record.sha256 !== source.sha256) errors.push(`${source.source_id} acquisition SHA-256 differs from vintage report`);
    } catch (error) { errors.push(`${source.source_id}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  for (const artifact of artifacts) {
    if (!artifact.store_path || isAbsolute(artifact.store_path) || artifact.store_path.split(/[\\/]/).some(part => !part || part === '..')) { errors.push(`${artifact.label} has unsafe store path`); continue; }
    const path = join(root, artifact.store_path);
    try { await assertPathWithinStore(root, path); await verifyStoredFile(path, artifact.sha256, artifact.bytes); }
    catch (error) { errors.push(`${artifact.label}: ${error instanceof Error ? error.message : String(error)}`); }
  }
  return { status: errors.length ? 'FAIL' : 'PASS', errors };
}

function jsonReport(path: string, value: unknown): ReportFile { return { path, content: `${JSON.stringify(value, null, 2)}\n` }; }

function prepareReport(report: VintageReport): ReportFile[] {
  const rows = report.archives.flatMap(archive => archive.members.filter(member => member.category).map(member => `| ${archive.archive} | ${member.name} | ${member.size} | ${member.crc32} | ${member.mesh ?? 'unknown'} | ${member.category} |`));
  const inspected = report.selected_member_records.map(member => `- ${member.archive} ${member.member}: ${member.bytes} bytes, SHA-256 ${member.sha256}; CityGML features ${member.inspection?.feature_count ?? 'unavailable'}, polygons ${member.inspection?.polygon_count ?? 'unavailable'}.`);
  const markdown = `# PLATEAU 2023 vintage inspection\n\nStatus: ${report.status}. Verification: UNVERIFIED. Routable: false. Rights: HOLD.\n\nPackage source: ${PACKAGE_ID}; package SHA-256: ${report.package_sha256 ?? 'pending'}.\n\nZIP directory requests are capped at ${DIR_BUDGET} bytes total per archive. Optional member acquisition has ${MEMBER_COMPRESSED_BUDGET} byte compressed-range and ${MEMBER_UNCOMPRESSED_BUDGET} byte uncompressed caps per entry.\n\n| Archive | Member | Uncompressed bytes | CRC-32 | Mesh | Type |\n|---|---|---:|---|---|---|\n${rows.join('\n')}\n\nSelected member inspections:\n\n${inspected.join('\n')}\n\n${report.limitations.map(note => `- ${note}`).join('\n')}\n`;
  return [jsonReport(join(REPORT_DIR, 'shinjuku-2023.json'), report), { path: join(REPORT_DIR, 'shinjuku-2023.md'), content: markdown }];
}

