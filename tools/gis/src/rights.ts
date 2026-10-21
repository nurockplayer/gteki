import { execFileSync } from 'node:child_process';
import { relatedIdentity, RELATED_CATALOG, type RelatedIdentity } from './related.js';
import { readZip } from './zip.js';
import { createHash } from 'node:crypto';
import { writePoiResearch } from './poi-research.js';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot, getStoreRoot, getStoredSource, readJson, writeJson } from './common.js';
import { object, RIGHTS_SOURCES } from './poi.js';
import { ownValue } from './values.js';
import { toolFingerprint } from './provenance.js';
import { rightsScopeMarkdown } from './rights-view.js';

export type ClaimLevel = 'RESOURCE' | 'DATASET' | 'SITE_POLICY' | 'ORIGIN_DATASET' | 'NONE';
export type Evidence = { id: string; source_id: string; supporting_document: string | null; sha256: string; url: string; section: string; quote: string; json_pointer?: string; zip_member?: string; member_sha256?: string; format?: 'pdf' };
const text = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;
const https = (value: unknown): boolean => { try { return text(value) && new URL(value).protocol === 'https:'; } catch { return false; } };
/** Conservative, total decision function. No data-derived key is ever looked up on a prototype. */
export function evaluateRights(input: unknown): { verdict: 'CLEARED_WITH_CONDITIONS' | 'RESTRICTED' | 'UNKNOWN'; reason: string; missing_evidence: string[] } {
  const row = object(input), get = (key: string) => ownValue(row, key), missing: string[] = [];
  const level = get('claim_level'), licence = object(get('licence_claimed')), exclusions = object(get('third_party_exclusions'));
  if (typeof level !== 'string' || !['RESOURCE', 'DATASET', 'SITE_POLICY', 'ORIGIN_DATASET', 'NONE'].includes(level)) missing.push('Valid claim level');
  if (!text(ownValue(licence, 'name')) || !text(ownValue(licence, 'version')) || !https(ownValue(licence, 'url'))) missing.push('Explicit licence name, version and URL');
  const evidence = get('evidence');
  if (!Array.isArray(evidence) || !evidence.length || evidence.some(item => {
    const e = object(item);
    return !text(ownValue(e, 'id')) || !text(ownValue(e, 'source_id')) || !text(ownValue(e, 'section')) || !https(ownValue(e, 'url'))
      || typeof ownValue(e, 'sha256') !== 'string' || !/^[a-f0-9]{64}$/.test(ownValue(e, 'sha256') as string)
      || !text(ownValue(e, 'quote')) || [...(ownValue(e, 'quote') as string)].length > 40;
  }) || get('evidence_verified') !== true) missing.push('Hash-verified snapshots and short literal clauses');
  if (get('exact_resource_covered') !== true) missing.push('Explicit coverage of the exact resource');
  if (!text(get('scope'))) missing.push('Bounded product reuse scope');
  if (!Array.isArray(ownValue(exclusions, 'items')) || !(ownValue(exclusions, 'items') as unknown[]).every(text)
    || ![true, false, 'UNKNOWN'].includes(ownValue(exclusions, 'applies_to_scope') as any)) missing.push('Third-party exclusion assessment');
  for (const field of ['commercial_use', 'redistribution', 'modification_allowed']) if (!['yes', 'no', 'conditional', 'unknown'].includes(get(field) as string)) missing.push(`Valid ${field} status`);
  if (typeof get('modification_notice_required') !== 'boolean' || !text(get('attribution_required'))) missing.push('Attribution and modification conditions');
  const supplied = get('missing_evidence');
  if (!Array.isArray(supplied) || !supplied.every(text)) missing.push('Explicit missing-evidence list');
  else missing.push(...supplied);
  if (level === 'ORIGIN_DATASET' && (get('origin_linkage_verified') !== true || !['JSON-equal', 'features-equal'].includes(get('identity_check') as string))) missing.push('Verified ZIP/direct-asset identity and exact catalog origin linkage');
  if (get('approval_scope') === 'unknown') missing.push('Downstream survey approval scope and required approval wording are unpublished');
  // A negative use term is a restriction only when its evidence and exact coverage are established.
  if (!missing.length && ['commercial_use', 'redistribution', 'modification_allowed'].some(field => get(field) === 'no'))
    return { verdict: 'RESTRICTED', reason: level === 'ORIGIN_DATASET' ? 'Verified origin product is non-commercial; old KSJ terms exclude redistribution of copies. Requested commercial/derived-data redistribution is restricted.' : 'Verified applicable terms forbid a required product use.', missing_evidence: [] };
  if (ownValue(exclusions, 'applies_to_scope') !== false) missing.push('Third-party permission or exclusion-free product subset');
  for (const field of ['commercial_use', 'redistribution', 'modification_allowed']) if (get(field) === 'unknown') missing.push(`Established ${field} permission`);
  if (level === 'ORIGIN_DATASET' && (get('derivative_licence_verified') !== true || get('origin_licence_class') !== 'CC_BY_4_0')) missing.push('Verified derivative grant and CC BY 4.0 origin permission');
  if (level !== 'RESOURCE' && level !== 'DATASET' && level !== 'ORIGIN_DATASET') missing.push('Explicit resource- or dataset-level licence; site/origin terms alone do not cover this derivative');
  const unique = [...new Set(missing)];
  return unique.length ? { verdict: 'UNKNOWN', reason: unique.join('; '), missing_evidence: unique }
    : { verdict: 'CLEARED_WITH_CONDITIONS', reason: level === 'ORIGIN_DATASET' ? 'Verified CC BY 4.0 origin plus PLATEAU PDL 1.0/CC BY alternative; retain TP+TN attribution, modifications and supplied survey notices.' : 'Exact resource listed in CC BY 4.0 dataset; bounded data reuse requires attribution, licence link and change notice.', missing_evidence: [] };
}
/** Text extraction is used only to match a short clause; full snapshots remain outside Git. */
export function snapshotText(bytes: Buffer): string {
  const html = bytes.toString('utf8').replace(/<!--[\s\S]*?-->/gu, '').replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/giu, '').replace(/<[^>]*>/gu, ' ');
  return html.replace(/&#(x[0-9a-f]+|[0-9]+);/giu, (_all, code: string) => String.fromCodePoint(code[0].toLowerCase() === 'x' ? parseInt(code.slice(1), 16) : Number(code)))
    .replaceAll('&nbsp;', ' ').replaceAll('&amp;', '&').replaceAll('&quot;', '"').replaceAll('&#39;', "'").replace(/\s/gu, '');
}
export async function evidenceBytes(e: Evidence): Promise<Buffer> {
  const stored = await getStoredSource(e.source_id);
  if (!e.supporting_document) {
    if (stored.record.sha256 !== e.sha256 || stored.record.resolved_url !== e.url) throw new Error(`Stale evidence: ${e.id}`);
    const bytes = await readFile(stored.path);
    if (!e.zip_member) return bytes;
    const entries = await readZip(stored.path, { legacyFileNameEncoding: 'shift_jis' }), member = entries.find(item => item.name === e.zip_member);
    if (!member || createHash('sha256').update(member.data).digest('hex') !== e.member_sha256) throw new Error(`Stale ZIP clause: ${e.id}`);
    return member.data;
  }
  const document = stored.record.supporting_documents?.find(item => item.id === e.supporting_document);
  if (!document || document.sha256 !== e.sha256 || document.url !== e.url || document.http_status !== undefined && document.http_status !== 200) throw new Error(`Missing/stale/unsuccessful terms document: ${e.id}`);
  return readFile(join(getStoreRoot(), document.store_path));
}
export async function verifyEvidence(e: Evidence): Promise<void> {
  let bytes = await evidenceBytes(e);
  if (e.format === 'pdf') {
    const stored = await getStoredSource(e.source_id);
    bytes = Buffer.from(execFileSync(process.env.GTEKI_GIS_PDFTOTEXT || 'pdftotext', ['-raw', stored.path, '-'], { maxBuffer: 8 * 1024 * 1024 }));
  }
  if (e.json_pointer) {
    let value: any = JSON.parse(bytes.toString('utf8'));
    for (const part of e.json_pointer.slice(1).split('/').map(v => v.replaceAll('~1', '/').replaceAll('~0', '~'))) {
      if (!value || !Object.hasOwn(value, part)) throw new Error(`Invalid evidence pointer: ${e.id}`);
      value = value[part];
    }
    bytes = Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
  }
  if (![...e.quote].length || [...e.quote].length > 40 || !snapshotText(bytes).includes(e.quote.replace(/\s/gu, ''))) throw new Error(`Literal clause not found: ${e.id}`);
}
async function evidence(sourceId: string, supportingDocument: string | null, section: string, quote: string, label: string, extras: Partial<Evidence> = {}): Promise<Evidence> {
  const stored = await getStoredSource(sourceId), document = stored.record.supporting_documents?.find(item => item.id === supportingDocument);
  const result: Evidence = { id: `${sourceId}#${label}`, source_id: sourceId, supporting_document: supportingDocument, sha256: document?.sha256 ?? stored.record.sha256,
    url: document?.url ?? stored.record.resolved_url, section, quote, ...extras };
  if (supportingDocument && !document) throw new Error(`Missing supporting document ${supportingDocument}`);
  await verifyEvidence(result); return result;
}
const outside = ['Logos, photographs, artwork and linked websites are outside the assessed data scope.', 'Store/station names are plain factual labels only. CC BY 4.0 §2(b)(2) excludes trademark rights; logos/brand artwork are not cleared.', 'Current-world accuracy, surveyed location, floor assignment, navigation and publication approval are not established.'];
const ccUrl = 'https://creativecommons.org/licenses/by/4.0/legalcode.ja';
const pdlUrl = 'https://www.digital.go.jp/resources/open_data/public_data_license_v1.0';
const term = (id: string, section: string, quote: string, label = id) => evidence(RELATED_CATALOG, id, section, quote, label);
function decide(base: any) { return { ...base, ...evaluateRights(base) }; }
/** Whole-resource clearance cannot overrule an unresolved or restricted scoped record. */
export function evaluateRightsRecords(records: any[]): any[] {
  const evaluated = records.map(decide);
  const split = evaluated.some(row => row.layer !== null && row.verdict !== 'CLEARED_WITH_CONDITIONS');
  return evaluated.map(row => row.layer === null && row.verdict === 'CLEARED_WITH_CONDITIONS' && split
    ? decide({ ...row, exact_resource_covered: false, missing_evidence: [...row.missing_evidence, 'Resource contains mixed terms; split required. At least one scoped subset is not CLEARED_WITH_CONDITIONS.'] }) : row);
}
function credit(status: string, examples: string[]) {
  return { status, examples_only: true, mandated_verbatim: false, examples, note: 'Replace placeholders and describe actual modifications. Preserve supplied creator, rights, licence and approval notices; these examples do not grant permission.' };
}
async function commonTerms(tokyo: boolean, catalogId: string): Promise<Evidence[]> {
  const clauses: Evidence[] = [];
  if (tokyo) {
    for (const [label, quote] of [['share', '営利目的も含め、どのような目的でも。'], ['credit', '適切なクレジット'], ['changes', '変更があったらその旨を示さ']])
      clauses.push(await evidence(catalogId, 'cc-by-4-deed-ja', 'CC BY 4.0 deed / freedoms and attribution', quote, label));
    clauses.push(await evidence('tokyo-s10-catalog', 'tokyo-portal-terms', '§2 知的財産権の取扱い', '商用利用も可能です。', 'tokyo-portal'));
    clauses.push(await evidence('tokyo-s10-catalog', 'tokyo-portal-terms', '§3 他のサイトの利用規約との関係', '本利用規約が優先するものとします。', 'tokyo-precedence'));
    clauses.push(await evidence('tokyo-s10-catalog', 'tokyo-portal-terms', '§2(3) ロゴ・シンボル等の別途確認', '利用条件を確認してください。', 'tokyo-exclusions'));
  } else {
    clauses.push(await term('plateau-policy', 'Terms of Use §3 コンテンツの利用', '権利表記の記載がない限り', 'policy-scope'));
    clauses.push(await term('plateau-policy', '§3 PDL1.0に関する重要事項 (1)', 'コンテンツを利用する際は出典を記載してください。', 'plateau-credit'));
    clauses.push(await term('plateau-policy', '§3 PDL1.0に関する重要事項 (3)', '利用者がCC BYに従って利用することを許諾します。', 'plateau-cc-alternative'));
    clauses.push(await term('pdl-1', '1 コンテンツの利用', '商用利用も可能です。', 'pdl-commercial'));
    clauses.push(await term('pdl-1', '1.2 第三者の権利', '第三者の権利を侵害しないようにしてください', 'pdl-third-party'));
  }
  clauses.push(await term('cc-by-4-legal-ja', 'CC BY 4.0 §2(b)(2)', '特許権および商標権は', 'trademarks-excluded'));
  clauses.push(await term('cc-by-4-legal-ja', 'CC BY 4.0 §3(a)(1)(B)', 'ライセンス対象物を改変した場合はその旨を記し', 'legal-modifications'));
  return clauses;
}

async function layerRecord(base: any, identity: RelatedIdentity): Promise<any> {
  const origin = identity.origin, clauses: Evidence[] = [...base.evidence];
  // Failed identity never propagates catalog provenance onto a ZIP member.
  if (!origin) return decide({ ...base, layer: identity.member, identity_check: identity.comparison, origin: null, claim_level: 'ORIGIN_DATASET', exact_resource_covered: false,
    missing_evidence: ['ZIP feature array differs from the direct catalog asset; origin is not attached.'] });
  const product = new URL(origin.url).pathname.split('/').at(-1)!;
  const doc = product === 'kibanjoho40027.html' ? 'gsi-origin' : `ksj-${product.replace('KsjTmplt-', '').replace('.html', '').toLowerCase()}`;
  const graphClause = (quote: string, label: string) => evidence(RELATED_CATALOG, null, `${identity.catalog_pointer}/description`, quote, `${identity.direct_source_id}-${label}`, { json_pointer: `${identity.catalog_pointer}/description` });
  clauses.push(await graphClause(product, 'origin'), await graphClause(`データ時点：${origin.date}`, 'date'), await graphClause(`データ作成：${origin.creator}`, 'creator'));
  if (origin.converter) clauses.push(await graphClause(`データ変換：${origin.converter}`, 'converter'));
  const restricted = ['ksj-p20', 'ksj-p13', 'ksj-n10-2024'].includes(doc), landmark = doc === 'gsi-origin';
  if (!restricted && !landmark && !['ksj-n02-2024', 'ksj-n03-2025'].includes(doc)) throw new Error(`Unassessed exact origin ${origin.url}`);
  if (restricted) {
    clauses.push(await term(doc, 'このデータの使用許諾条件', '非商用'));
    clauses.push(await term('ksj-terms', '1.3 / exception heading', '1.3 本利用ルールが適用されないコンテンツについて', 'ksj-exception-heading'));
    clauses.push(await term('ksj-terms', '1.3(2) 本利用ルールが適用されないコンテンツ / 商用可・非商用', '旧国土情報利用約款準拠版', 'ksj-old-rule'));
    clauses.push(await term('ksj-old-terms', '第1条 (b)', '非商用目的のみでの利用', 'non-commercial'));
    clauses.push(await term('ksj-old-terms', '第1条 (b)', 'ただし複製物の再配布を除く', 'no-copy-redistribution'));
    clauses.push(await term('ksj-old-terms', '第3条 / 非データベースの空間演算結果の例外', 'GISによって空間演算した結果（データベースでないもの）', 'non-database-exception'));
  } else if (landmark) {
    clauses.push(await graphClause(origin.approval_notice!, 'approval'));
    clauses.push(await term('gsi-origin', 'その他 / 複製・使用', '測量法第29条又は30条に基づく申請が必要になります。'));
    clauses.push(await term('gsi-terms', 'コンテンツの利用', '公共データ利用規約（第1.0 版）'));
    clauses.push(await term('gsi-survey', '測量成果の利用手続', '申請は不要で出典の明示だけで利用できる場合'));
    clauses.push(await term('gsi-qa', 'Q1-24 / 複製と使用承認の区別', '使用承認を得て作成した成果', 'approval-distinction'));
    clauses.push(await term('gsi-qa', 'Q5-2 / 承認書の表示文言', '承認書に記載される承認番号及び出所の明示の文言', 'approval-wording'));
  } else {
    clauses.push(await term(doc, 'このデータの使用許諾条件', 'オープンデータ（CC_BY_4.0）'));
    if (doc === 'ksj-n02-2024') clauses.push(await term(doc, 'このデータの使用許諾条件 / 年度範囲', '2020年（令和2年）以降', 'railway-year-range'));
    if (doc === 'ksj-n03-2025') clauses.push(await term(doc, '作成方法 / 承認表示', '測量法に基づく国土地理院長承認（複製）R 6JHf 503', 'border-approval'));
  }
  const tp = `出典：「3D都市モデル（Project PLATEAU）${base.ward}（2025年度）」関連データセット（${base.catalog_url}）。PLATEAU site policy §3 / PDL 1.0（${pdlUrl}、CC BY 4.0 alternative）。データ作成：${origin.creator}。${origin.converter ? `データ変換：${origin.converter}。` : ''}GTEki が［実際の編集・加工内容］を実施。`;
  const tn = `原典：国土交通省「国土数値情報（${doc === 'ksj-n03-2025' ? '行政区域・2025年' : '鉄道・2024年'}）」（${origin.url}）、CC BY 4.0（${ccUrl}）。原典をもとに作成された関連データを GTEki が［実際の編集・加工内容］。`;
  const approval = doc === 'ksj-n03-2025' ? '測量法に基づく国土地理院長承認（複製）R 6JHf 503' : origin.approval_notice;
  return decide({ ...base, layer: identity.member, direct_resource: identity.direct_url, origin, evidence: clauses, claim_level: 'ORIGIN_DATASET', exact_resource_covered: base.archive_catalog_covered,
    origin_linkage_verified: true, identity_check: identity.comparison, derivative_licence_verified: base.derivative_licence_verified, origin_licence_class: restricted ? 'KSJ_NON_COMMERCIAL' : landmark ? 'GSI_APPROVAL_SCOPE_UNKNOWN' : 'CC_BY_4_0',
    licence_claimed: { name: restricted ? 'KSJ old terms / non-commercial + PLATEAU PDL' : landmark ? 'GSI product / survey approval + PLATEAU PDL' : 'CC BY origin + PLATEAU PDL (CC BY alternative)', version: restricted ? '2020-07-01 / 1.0' : landmark ? 'approval scope UNKNOWN / 1.0' : '4.0 / 1.0', url: restricted ? 'https://nlftp.mlit.go.jp/ksj/other/agreement_02.html' : landmark ? origin.url : ccUrl },
    licence_chain: [{ claim_level: 'ORIGIN_DATASET', name: restricted ? 'KSJ old terms (non-commercial)' : landmark ? 'GSI product / survey approval scope UNKNOWN' : 'CC BY 4.0', url: restricted ? 'https://nlftp.mlit.go.jp/ksj/other/agreement_02.html' : landmark ? origin.url : ccUrl }, { claim_level: 'SITE_POLICY', name: 'PLATEAU PDL 1.0 (CC BY 4.0 alternative)', url: 'https://www.mlit.go.jp/plateau/site-policy/' }],
    approval_scope: landmark ? 'unknown' : 'no_unresolved_scope_identified', carried_survey_notice: approval,
    commercial_use: restricted ? 'no' : landmark ? 'unknown' : 'conditional', redistribution: restricted ? 'no' : landmark ? 'unknown' : 'conditional', modification_allowed: landmark ? 'unknown' : 'conditional',
    third_party_exclusions: { items: outside, applies_to_scope: landmark ? 'UNKNOWN' : false, assessment: 'Exact origin and PLATEAU grant assessed jointly for neutral geometry/factual labels only; excluded branding and expressive content are outside scope.' },
    missing_evidence: landmark ? ['Published downstream scope and required wording of 令7関公第296号; an approval number alone is not permission.'] : [],
    attribution_required: restricted ? 'Source, creator and processing credits under the old KSJ terms; separate permission is required before requested use.' : landmark ? 'Provisional origin/creator record only; obtain the approval instrument and apply its actual credit wording before reuse.' : 'TP (PLATEAU contribution) + TN (origin product), source/licence links, supplied creator/converter credits and actual modification notice; retain any carried survey approval notice.',
    attribution_templates: restricted ? credit('RESTRICTED; internal source record only, no release permission', [`原典：国土交通省「国土数値情報」（${origin.url}、旧国土情報利用約款準拠版・非商用）。データ作成：${origin.creator}。商用・複製物再配布は別途許諾が必要。`])
      : landmark ? credit('UNKNOWN; provisional source record only, no clearance', [`原典：国土地理院「数値地図（国土基本情報）」（${origin.url}）。カタログ記載の承認番号：${approval}。データ作成：${origin.creator}／データ変換：${origin.converter}。承認範囲・指定表示文言は未確認。`])
      : credit('CLEARED_WITH_CONDITIONS; examples TP + TN', [tp, tn, ...(approval ? [approval] : [])]),
  });
}

export async function rightsReport() {
  const fingerprint = await toolFingerprint(), results: any[] = [];
  for (const sourceId of RIGHTS_SOURCES) {
    const stored = await getStoredSource(sourceId), tokyo = sourceId.startsWith('tokyo-'), s10 = sourceId.startsWith('tokyo-s10');
    const catalogId = tokyo ? s10 ? 'tokyo-s10-catalog' : 'tokyo-s03-catalog' : sourceId.replace(/-catalog$/, '') + '-catalog';
    const catalog = await getStoredSource(catalogId), payload = object(await readJson(catalog.path)), dataset = object(payload.result);
    if (payload.success !== true || !Array.isArray(dataset.resources)) throw new Error(`Invalid CKAN package_show: ${catalogId}`);
    const catalogResourceUrl = stored.source.catalog_resource_url ?? stored.source.expected_url;
    const catalogIdentity = !stored.source.catalog_resource_url || stored.record.sha256 === stored.source.catalog_resource_sha256;
    const resources = dataset.resources.map(object), index = resources.findIndex(resource => resource.url === catalogResourceUrl), resource = index < 0 ? object(null) : resources[index];
    const resourceClaims = Object.entries(resource).filter(([key, value]) => /licen[cs]e/iu.test(key) && value !== null && value !== '');
    const cc = dataset.license_id === 'CC-BY-4.0' && dataset.license_url === 'https://creativecommons.org/licenses/by/4.0/deed.ja';
    const clauses = [await evidence(catalogId, null, '/result/license_id', tokyo ? 'CC-BY-4.0' : 'plateau', 'licence', { json_pointer: '/result/license_id' }), ...await commonTerms(tokyo, catalogId)];
    if (index >= 0) clauses.push(await evidence(catalogId, null, `/result/resources/${index}/url`, new URL(catalogResourceUrl).pathname.split('/').at(-1)!.slice(-40), 'resource', { json_pointer: `/result/resources/${index}/url` }));
    if (tokyo && !s10) clauses.push(await evidence(catalogId, 'tokyo-bureau-policy', '著作権について / general site only; does not override dataset grant', '無断で複製・転用することはできません。', 'site-reservation'));
    const exact = tokyo && index >= 0 && cc && resourceClaims.length === 0 && catalogIdentity;
    const archiveCatalogCovered = !tokyo && index >= 0 && resourceClaims.length === 0;
    const derivativeGrant = archiveCatalogCovered && dataset.license_id === 'plateau' && dataset.license_url === 'https://www.mlit.go.jp/plateau/site-policy/';
    if (!tokyo) clauses.push(await evidence(catalogId, null, '/result/license_url', 'https://www.mlit.go.jp/plateau/site-policy/'.slice(-40), 'policy-link', { json_pointer: '/result/license_url' }));
    const base: any = { resource: stored.source.expected_url, catalog_resource_url: catalogResourceUrl, catalog_resource_identity: { matches: catalogIdentity, prior_sha256: stored.source.catalog_resource_sha256 ?? null, acquired_sha256: stored.record.sha256 }, layer: null, claim_level: tokyo ? 'DATASET' : 'SITE_POLICY',
      licence_claimed: { name: tokyo ? 'Creative Commons Attribution' : 'PLATEAU site policy / Public Data License', version: tokyo ? '4.0' : '1.0', url: tokyo ? ccUrl : 'https://www.mlit.go.jp/plateau/site-policy/' },
      scope: tokyo ? s10 ? 'Commercial public Web3D/product reuse and redistribution of the factual CSV fields, including plain labels and URL strings as pointers only; no linked target content or branding rights.' : 'Commercial public Web3D/product reuse and redistribution of technical document text only; no embedded imagery, branding or linked target content.' : 'Commercial public Web3D/product reuse, modification and redistribution of this exact related layer, its factual labels/geometry and upstream data. Whole ZIP requires splitting.',
      exact_resource_covered: exact, archive_catalog_covered: archiveCatalogCovered, derivative_licence_verified: derivativeGrant, catalog_resource_id: resource.id ?? null, resource_licence_fields: resourceClaims, evidence: clauses, evidence_verified: true,
      attribution_required: tokyo ? `出典：${stored.source.publisher}「${s10 ? '駅構内のお店' : '新宿駅周辺の施設情報等'}」; preserve supplied credits, source and CC BY 4.0 links; identify actual modifications.` : 'Per-layer TP+TN attribution and approval notices; archive-wide permission is not asserted.',
      modification_notice_required: true, commercial_use: exact ? 'conditional' : 'unknown', redistribution: exact ? 'conditional' : 'unknown', modification_allowed: exact ? 'conditional' : 'unknown',
      third_party_exclusions: { items: outside, applies_to_scope: tokyo ? false : 'UNKNOWN', assessment: tokyo ? 'Dataset grant for bounded factual/technical content; general site reservation does not override it. Expressive promotional prose, linked content and branding are excluded.' : 'Mixed origin terms; assess individual layers after verified identity.' },
      missing_evidence: !catalogIdentity ? ['Final resource bytes differ from the pinned catalog-listed acquisition; exact resource identity UNKNOWN.'] : exact ? [] : tokyo || sourceId.endsWith('-catalog') ? ['No explicit self-licence for this CKAN metadata response.'] : ['Archive contains mixed origin terms; split and apply the individual layer records.'],
      attribution_templates: credit(exact ? 'CLEARED_WITH_CONDITIONS; example' : 'UNKNOWN; internal source record only', [`出典：${stored.source.publisher}「${s10 ? '駅構内のお店' : '新宿駅周辺の施設情報等'}」（${stored.source.expected_url}）。${exact ? `CC BY 4.0（${ccUrl}）。GTEki が［実際の編集・加工内容］。` : '再利用許諾は未確認。'}`]),
      not_covered: outside, publish_gate: 'HOLD', routable: false };
    if (!tokyo) { base.ward = sourceId.includes('13104') ? '新宿区' : '豊島区'; base.catalog_url = stored.source.official_url.replace('/api/3/action/package_show?id=', '/dataset/'); if (!sourceId.endsWith('-catalog')) base.catalog_url = catalog.source.official_url.replace('/api/3/action/package_show?id=', '/dataset/'); }
    if (!tokyo) base.attribution_templates = credit('UNKNOWN; internal archive/catalog record only, split required for ZIPs', [`資料：国土交通省 Project PLATEAU「${stored.source.title}」（${stored.source.expected_url}）。一括の再利用許諾は未確認。レイヤー別の記録を参照。`]);
    let records: any[] = [decide(base)];
    const identities = !tokyo && !sourceId.endsWith('-catalog') ? await relatedIdentity(sourceId) : [];
    for (const identity of identities) records.push(await layerRecord(base, identity));
    if (sourceId === 'tokyo-s03-zip') {
      const excluded = [...outside, 'S03 promotional description prose (including localized equivalents) and linked external content are UNKNOWN and outside the factual/geometry subset.'];
      const factual = { ...base, layer: 'geometry and factual fields only (all ZIP members; expressive and linked content excluded)',
        scope: 'Commercial public Web3D/product reuse, modification and redistribution of neutral geometry and factual fields only, including plain names, literal location/time fields and URL strings as pointers. No promotional description prose or linked target content.',
        third_party_exclusions: { ...base.third_party_exclusions, items: excluded }, not_covered: excluded };
      records[0] = decide({ ...base, scope: 'Whole S03 ZIP, including geometry, factual fields, promotional prose and linked content references. Mixed terms; split required.',
        exact_resource_covered: false, commercial_use: 'unknown', redistribution: 'unknown', modification_allowed: 'unknown',
        third_party_exclusions: { items: excluded, applies_to_scope: 'UNKNOWN' }, not_covered: excluded,
        missing_evidence: ['Archive contains mixed terms; split required. Promotional prose and linked content are not cleared.'],
        attribution_templates: credit('UNKNOWN; whole archive requires splitting', ['資料：東京都都市整備局「新宿駅周辺の施設情報等」。一括の再利用許諾は未確認。範囲別の記録を参照。']) });
      records.push(decide(factual));
      const entries = await readZip(stored.path, { legacyFileNameEncoding: 'shift_jis' }), member = entries.find(e => e.name.endsWith('/com-entity.geojson'))!;
      if (!member) throw new Error('Missing S03 com-entity member');
      const content = JSON.parse(member.data.toString('utf8')), rows = content.entities;
      const count = (field: string) => rows.filter((row: any) => typeof row.properties?.[field] === 'string' && row.properties[field].length > 0).length;
      const extras = { zip_member: member.name, member_sha256: createHash('sha256').update(member.data).digest('hex') };
      const fieldClauses = [await evidence(sourceId, null, 'com-entity.geojson / entities[*].properties.description', 'description', 'promotional-field', extras), await evidence(sourceId, null, 'com-entity.geojson / entities[*].properties.url', 'url', 'linked-field', extras)];
      records.push(decide({ ...base, layer: `${member.name} / properties.description + properties.url (and localized equivalents)`, scope: 'Promotional description prose and linked external content; a URL string is only a factual pointer and conveys no licence to the linked target.',
        field_scope: { excluded_fields: ['entities[*].properties*.description', 'entities[*].properties*.url -> linked target content'], description_rows: count('description'), url_rows: count('url') },
        evidence: [...clauses, ...fieldClauses], commercial_use: 'unknown', redistribution: 'unknown', modification_allowed: 'unknown', third_party_exclusions: { items: excluded, applies_to_scope: 'UNKNOWN' }, not_covered: excluded,
        missing_evidence: ['No published third-party clearance for promotional shop prose or linked external content.'], attribution_templates: credit('UNKNOWN; internal source record only', [`資料：東京都都市整備局「新宿駅周辺の施設情報等」com-entity.geojson。店舗紹介文・リンク先の権利は未確認。`]) }));
      const format = await evidence('tokyo-s03-spec', null, 'PDF printed p3 §3.1 / format only, not ownership or licence', 'HERE Venues Community', 'format-clue', { format: 'pdf' });
      records[0].format_provenance_clue = { format: 'HERE Venues Community', interpretation: 'Format/provenance clue only; neither a HERE grant nor proof of third-party ownership or clearance.', evidence_id: format.id };
      records[0].evidence.push(format);
    }
    // The reference PDF contains an embedded raster illustration. The technical-text grant
    // cannot clear that image or the complete PDF; the text-only specification has no images.
    if (sourceId === 'tokyo-s03-reference') {
      records.push(decide({ ...base, layer: 'technical document text only' }));
      records.push(decide({ ...base, layer: 'embedded illustration and linked target content', scope: 'Embedded raster illustration, any branding and linked external target content; excluded from technical-text clearance.',
        commercial_use: 'unknown', redistribution: 'unknown', modification_allowed: 'unknown', third_party_exclusions: { items: outside, applies_to_scope: 'UNKNOWN' },
        missing_evidence: ['No separate clearance established for the embedded illustration or linked target content.'], attribution_templates: credit('UNKNOWN; internal source record only', ['資料：東京都都市整備局「新宿駅周辺の施設情報等」参考資料。図版・リンク先の権利は未確認。']) }));
      records[0] = decide({ ...base, scope: 'Whole S03 reference PDF, including technical text and embedded illustration. Mixed coverage; split required.', exact_resource_covered: false,
        commercial_use: 'unknown', redistribution: 'unknown', modification_allowed: 'unknown', third_party_exclusions: { items: outside, applies_to_scope: 'UNKNOWN' },
        missing_evidence: ['Technical-text clearance does not cover the embedded illustration; split required.'], attribution_templates: credit('UNKNOWN; whole document requires splitting', ['資料：東京都都市整備局「新宿駅周辺の施設情報等」参考資料。一括の再利用許諾は未確認。']) });
    }
    records = evaluateRightsRecords(records);
    const allClauses: Evidence[] = records.flatMap(row => row.evidence);
    const inputIds = new Set([sourceId, catalogId, ...allClauses.map(e => e.source_id), ...identities.map(row => row.direct_source_id)]);
    const inputs = await Promise.all([...inputIds].map(async id => ({ source_id: id, sha256: (await getStoredSource(id)).record.sha256 })));
    const record = { source_id: sourceId, source_sha256: stored.record.sha256, station_ids: stored.source.station_ids, tool_input_sha256: fingerprint, input_sources: inputs, records, identity_checks: identities,
      terms_fetches: (await getStoredSource(RELATED_CATALOG)).record.supporting_documents, coverage_note: 'Reuse rights only; every publish gate HOLD and routable false. S03 ZIP/reference PDF and related ZIPs require scoped splits. Catalog metadata has no inferred self-licence.' };
    await writeJson(join(docsRoot, 'gis', 'rights', `${sourceId}.json`), record); results.push(record);
  }
  const lines = ['# Resource rights evidence', '', 'Generated by `gis rights-report` from our own hash-verified acquisitions. Every publish gate remains HOLD; every source remains non-routable. Short literal clauses, snapshot hashes and JSON pointers are in the JSON records.', '',
    '| Source / layer | Claim | Verdict | Scope / exclusions | Reason | Evidence IDs |', '| --- | --- | --- | --- | --- | --- |',
    ...results.flatMap(result => result.records.map((row: any) => `| ${result.source_id}${row.layer ? ` / ${row.layer}` : ''} | ${row.claim_level} | ${row.verdict} | ${rightsScopeMarkdown(row)} | ${row.reason} | ${row.evidence.map((e: Evidence) => e.id).join(', ')} |`)), '',
    '## Attribution examples', '', 'Suggested examples, not mandated verbatim. Replace placeholders and retain actual supplied notices. A credit does not clear RESTRICTED or UNKNOWN material.', '',
    ...results.flatMap(result => result.records.map((row: any) => `- ${result.source_id}${row.layer ? ` / ${row.layer}` : ''} (${row.attribution_templates.status}): ${row.attribution_templates.examples.join(' / ')}`)), '',
    '## Scope limits', '', 'TP identifies the PLATEAU contribution, ward/year catalog, PASCO creator, CMS converter where supplied and actual edits. TN identifies the exact origin product/date and its CC BY 4.0 licence. Retain the N03 R 6JHf 503 notice; it is an upstream notice, not an approval issued to GTEki. Landmark 令7関公第296号 has no published downstream scope in these snapshots and remains UNKNOWN.', '',
    'Tokyo portal terms at https://portal.data.metro.tokyo.lg.jp/terms/ remain evidence. The bureau site reservation is general-site evidence and does not override the dataset grant. S03 geometry/factual fields are assessed separately from promotional prose and linked external content. CC BY §2(b)(2) excludes trademarks: factual labels only; logos/brand artwork are not cleared.', '',
    'The provenance GraphQL response is supporting evidence with UNKNOWN self-licence. The 14 direct assets are identity inputs and are assessed only through the corresponding layer record/direct_resource URL; no blanket API, archive or branding licence is inferred.', ''];
  await writeFile(join(docsRoot, 'gis', 'rights', 'README.md'), lines.join('\n'));
  await writePoiResearch(results);
  return results;
}
