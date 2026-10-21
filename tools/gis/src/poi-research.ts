import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { docsRoot, getStoredSource, readJson } from './common.js';
import { htmlText, type RightsRecord } from './rights.js';

/** Generate the lane packet from acquired evidence and current inspections, never from remembered source claims. */
export async function generatePoiResearch(rights:RightsRecord[]):Promise<void> {
  const root=join(docsRoot,'gis');
  const pois=await Promise.all(['toei-stores-shinjuku-csv','toei-stores-shinjuku-nishiguchi-csv','tokyo-shinjuku-facilities-zip','tokyo-shinjuku-facilities-spec-pdf','plateau-13104-related-2025','plateau-13116-related-2025'].map(id=>readJson<any>(join(root,'poi',`${id}.json`))));
  const vintage=await readJson<any>(join(root,'vintages','shinjuku-2023.json'));
  const landing=await getStoredSource('tokyo-shinjuku-facilities-landing'),text=htmlText(await readFile(landing.path,'utf8'));
  const basis='令和２年３月に公開したデータをもとに',publication='令和５年２月２８日（火曜日）';
  if(!text.includes(basis)||!text.includes(publication))throw new Error('S03 landing date evidence changed');
  const lines=[
    '# POI, facility rights and PLATEAU vintage evidence','',
    `Tool-input SHA-256: \`${rights[0]?.tool_input_sha256}\`. Generated from integrity-checked acquisitions and current inspection reports. All candidates remain UNVERIFIED / routable:false.`,
    '', '## Scope and station identity','',
    '新宿 (S01/E27) and 新宿西口 (E01) are separate sources and identities. 新宿三丁目 is excluded. No text location was geocoded; no height, floor, accessibility, connectivity or feature correspondence was inferred.',
    '', '## Acquisition and rights decisions','',
    'The original 19 manifest entries are preserved. Fourteen bounded sources add the two S10 CSVs, five CKAN package snapshots, S03 ZIP/specification/reference/landing, two 2025 related ZIPs, and PLATEAU site policy. CKAN resource selection records the acquired package hash and exact JSON pointer. S03 catalog sizes and redirected final URLs are observations, separate from the actual acquired byte counts.',
    '', '| Source | Licence observation | Scope | Publish gate | Evidence |', '| --- | --- | --- | --- | --- |',
    ...rights.map(r=>`| ${r.source_id} | ${r.licence.value??'UNKNOWN'}${r.file_embedded_licence.value?`; embedded ${r.file_embedded_licence.value}`:''} | ${r.licence.scope} (${r.licence.status})${r.file_embedded_licence.scope?`; ${r.file_embedded_licence.scope}`:''} | ${r.publish_gate} | ${r.evidence.filter(e=>e.quote).slice(0,2).map(e=>`${e.source_id} SHA-256 ${e.sha256}, ${e.location}, “${e.quote}”`).join('; ')||'No acquired declaration establishes resource rights'} |`),
    '', 'Package licence declarations are not resource-level declarations. PLATEAU package value `plateau` points to site policy; the acquired §3 is titled “コンテンツの利用”. Site defaults preserve alternate rights and municipal copyright. CC BY compatibility is not a file-embedded licence. Related-data source/原典 fields are checked literally; absent fields do not establish the original data sources or their permissions. Every exact-resource publish gate is HOLD. Each rights JSON records attribution/modification obligations, caveats and the evidence needed to clear it.',
    '', '## Literal POI and facility inspection','',
    '| Source | Format | Rows | Members | Coordinates |', '| --- | --- | ---: | ---: | --- |',
    ...pois.map(p=>`| ${p.source_id} | ${p.format} | ${p.row_count??'n/a'} | ${p.members?.length??'n/a'} | ${JSON.stringify(p.coordinate_fields??'See member geometry and declared/assumed CRS')} |`),
    '', ...pois.filter(p=>p.members).flatMap(p=>[
      `### ${p.source_id}`,'',
      ...p.members.map((m:any)=>`- ${m.file}: ${m.feature_count??'metadata'} features; geometry ${JSON.stringify(m.geometry_type_counts??null)}; bbox ${JSON.stringify(m.bbox??null)}; CRS ${JSON.stringify(m.crs??null)} (${m.crs_status??'UNKNOWN'}).`),
      `- Matched original-data fields: ${p.source_attributions?.flatMap((a:any)=>Object.keys(a.fields??{})).join(', ')||'none found in inspected property/metadata fields; original sources UNKNOWN'}. Full inventory: ../poi/${p.source_id}.json.`,
      `- Source route inspection: ${JSON.stringify(p.topology?.status??'INVENTORY_ONLY')}; exact candidate details, if any, remain outside the routing graph.`,''
    ]),
    'S03 specification fields/code tables are transcribed with physical PDF page references in ../poi/tokyo-shinjuku-facilities-spec-pdf.json. These are literal definitions; they do not establish current-world access or a graph join.',
    '', `S03 landing source ${landing.record.source_id}, SHA-256 ${landing.record.sha256}, introduction: “${basis}”; publication section: “${publication}”. This establishes a March 2020 published-data basis and publication on 2023-02-28, not a complete survey date.`,
    '', '## Bbox overlap and 2023 vintage','',
    'The generated overlap reports include the S03 and related-data members beside E27 and the acquired 2025 ubld layers. Unsupported or undeclared CRS leaves established metrics UNKNOWN. Conditional raw longitude/latitude rectangle tests are labelled separately; RFC 7946 is an assumption for undeclared GeoJSON, not an identified datum. Bbox overlap does not establish a feature match or connection.',
    '', `2023 vintage status: ${vintage.status}. See ../vintages/shinjuku-2023.json for all ubld member meshes, 2025 differences, exact HTTP ranges, total archive lengths, validators, timestamps and hashes.`,
    ...vintage.archives.map((a:any)=>`- ${a.archive}: archive ${a.total_bytes} bytes; directory ranges ${a.directory_ranges?.reduce((n:number,r:any)=>n+r.bytes,0)??'UNKNOWN'} bytes; directory SHA-256 ${a.sha256??'see acquisition record'}; ubld members ${a.members?.filter((m:any)=>m.category==='ubld').length??'UNKNOWN'}.`),
    `- 2023 mesh sets and actual E27 bbox relations: ${JSON.stringify(vintage.comparison)}.`,
    `- Total bytes read by HTTP ranges: ${vintage.byte_totals?.requested_http_bytes??'UNKNOWN'} (directory ${vintage.byte_totals?.directory_range_bytes??'UNKNOWN'}, member ${vintage.byte_totals?.member_range_bytes??'UNKNOWN'}).`,
    ...vintage.selected_member_records.map((m:any)=>`- Acquired exact member ${m.member}: ${m.bytes} uncompressed bytes, SHA-256 ${m.sha256}, CRC32 ${m.crc32}; actual bbox ${JSON.stringify(m.inspection?.bbox_lat_lon_height??null)}. No GLB conversion or routing graph was created.`),
    '', '## Not established','',
    '- Exact resource-level and third-party-original licence coverage; all publish gates HOLD.',
    '- Final required attribution parties and complete modification statements for a proposed release.',
    '- Applicability or satisfaction of Survey Act and other individual-law requirements.',
    '- Current facility/store existence, opening hours, accessibility, operator boundaries or fare boundaries.',
    '- Coordinates for text-only CSV locations, floor heights, elevations, connectors or graph edges beyond literal source candidates.',
    '- Datum identification for undeclared GeoJSON, feature correspondence, topology or connectivity from bbox overlap.',
    '- Coverage of uninspected vintages or archive members; nominal mesh filenames do not prove actual geometry coverage.',
    '', 'Raw acquisitions, extracted text and detailed candidates remain in the external store; Git contains bounded receipts and inventories.',''
  ];
  await mkdir(join(root,'research'),{recursive:true});await writeFile(join(root,'research','poi-rights-and-vintages.md'),lines.join('\n'));
}
