import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { getStoredSource } from './common.js';
import { loadSources } from './acquire.js';
import { object } from './poi.js';
import { readZip } from './zip.js';

export const RELATED_CATALOG = 'plateau-related-provenance';
export type Comparison = 'JSON-equal' | 'features-equal' | 'different';
export function compareFeatureCollections(left: unknown, right: unknown): Comparison {
  const a = object(left), b = object(right);
  if (a.type !== 'FeatureCollection' || b.type !== 'FeatureCollection' || !Array.isArray(a.features) || !Array.isArray(b.features) || !isDeepStrictEqual(a.features, b.features)) return 'different';
  return isDeepStrictEqual(a, b) ? 'JSON-equal' : 'features-equal';
}
export function attachVerifiedOrigin<T>(comparison: Comparison, origin: T): T | null {
  return comparison === 'JSON-equal' || comparison === 'features-equal' ? origin : null;
}
export type RelatedIdentity = {
  member: string; member_sha256: string; direct_source_id: string; direct_url: string; direct_sha256: string;
  catalog_sha256: string; catalog_pointer: string; comparison: Comparison; feature_count: number; top_level_differences: string[];
  origin: { url: string; date: string; creator: string; converter: string | null; approval_notice: string | null } | null;
};
export async function relatedIdentity(sourceId: string): Promise<RelatedIdentity[]> {
  if (!/^plateau-(13104|13116)-related$/.test(sourceId)) throw new Error('Not a bounded related ZIP');
  const city = sourceId.split('-')[1], zip = await getStoredSource(sourceId), graph = await getStoredSource(RELATED_CATALOG);
  const payload = JSON.parse(await readFile(graph.path, 'utf8'));
  if (payload.errors || !Array.isArray(payload.data?.datasets) || payload.data.datasets.length !== 14) throw new Error('Invalid related catalog');
  const sources = loadSources(), members = await readZip(zip.path), results: RelatedIdentity[] = [];
  const rows = payload.data.datasets.map((row: any, index: number) => ({ row, index })).filter(({ row }: any) => row.id.startsWith(`d_${city}_`));
  if (rows.length !== 7 || members.length !== 7) throw new Error('Expected exactly seven related layers per ZIP');
  const used = new Set<string>();
  for (const { row, index } of rows) {
    if (row.items?.length !== 1 || !row.description || !['shelter', 'park', 'landmark', 'station', 'railway', 'emergency_route', 'border'].includes(row.typeCode) || row.id !== `d_${city}_${row.typeCode}`) throw new Error('Ambiguous related dataset');
    const expectedCatalog = `https://www.geospatial.jp/ckan/dataset/plateau-${city}-${city === '13104' ? 'shinjuku' : 'toshima'}-ku-2025`;
    if (row.openDataUrl !== expectedCatalog || row.year !== 2025) throw new Error('Related origin catalog identity mismatch');
    const item = row.items[0], url = item.originalUrl ?? item.url;
    const source = sources.find(s => s.source_id === `${sourceId}-${row.typeCode.replaceAll('_', '-')}-asset` && s.expected_url === url);
    if (!source) throw new Error('Direct asset not linked by acquired catalog');
    const direct = await getStoredSource(source.source_id);
    if (direct.record.resolved_url !== url) throw new Error('Direct asset redirected away from catalog URL');
    const matches = members.filter(member => basename(member.name) === basename(new URL(url).pathname));
    if (matches.length !== 1 || used.has(matches[0].name)) throw new Error('Ambiguous ZIP member identity');
    const member = matches[0]; used.add(member.name);
    const a = JSON.parse(member.data.toString('utf8')), b = JSON.parse(await readFile(direct.path, 'utf8'));
    const comparison = compareFeatureCollections(a, b);
    const originUrl = row.description.match(/https:\/\/(?:nlftp\.mlit\.go\.jp\/ksj\/gml\/datalist\/[^\s]+|www\.gsi\.go\.jp\/kibanjoho\/[^\s]+)/u)?.[0];
    const line = (label: string): string | null => row.description.split('\n').find((v: string) => v.startsWith(label))?.slice(label.length).replace(/\(https:.*$/u, '').trim() ?? null;
    if (!originUrl || !line('データ時点：') || !line('データ作成：')) throw new Error('Missing explicit origin/date/creator');
    const origin = { url: originUrl, date: line('データ時点：')!, creator: line('データ作成：')!, converter: line('データ変換：'), approval_notice: row.description.match(/令7関公第296号/u)?.[0] ?? null };
    results.push({ member: member.name, member_sha256: createHash('sha256').update(member.data).digest('hex'), direct_source_id: source.source_id, direct_url: url, direct_sha256: direct.record.sha256,
      catalog_sha256: graph.record.sha256, catalog_pointer: `/data/datasets/${index}`, comparison, feature_count: Array.isArray(a.features) ? a.features.length : 0,
      top_level_differences: [...new Set([...Object.keys(a), ...Object.keys(b)])].filter(key => !isDeepStrictEqual(a[key], b[key])), origin: attachVerifiedOrigin(comparison, origin) });
  }
  return results;
}
