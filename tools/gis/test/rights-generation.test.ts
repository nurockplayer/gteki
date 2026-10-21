import { beforeEach, describe, expect, it, vi } from 'vitest';

const fixture = vi.hoisted(() => ({
  writes: new Map<string, unknown>(),
  json: new Map<string, unknown>(),
  sources: [] as unknown[],
  records: new Map<string, unknown>(),
  report: {} as any,
  researchError: false,
  metadataText: '',
  priorFiles: new Map<string,string>(),
  fingerprint: 'f'.repeat(64),
  archiveUrl: 'https://assets.example/assets/b5/dd5300/shinjuku_2023_citygml_2_op.zip',
}));

vi.mock('../src/acquire.js', () => ({ loadSources: () => fixture.sources }));
vi.mock('../src/zip.js', () => ({ readZip: async () => [{name:'metadata.xml',data:Buffer.from(`<useLimitation>${fixture.metadataText}</useLimitation>`)}] }));
vi.mock('../src/provenance.js', () => ({ toolFingerprint: async () => fixture.fingerprint }));
vi.mock('../src/vintage.js', () => ({ verifyVintageEvidence: async () => ({ status: 'PASS', errors: [] }) }));
vi.mock('../src/poi-research.js', () => ({ buildPoiResearch: async () => {if(fixture.researchError)throw new Error('Research preparation failed');return {path:'/virtual/docs/gis/research/poi-rights-and-vintages.md',content:'research'};} }));
vi.mock('../src/report-transaction.js', () => ({ commitReportFiles: async (files: Array<{path:string;content:string|null}>) => {for(const file of files){fixture.writes.set(file.path,file.content===null?null:file.path.endsWith('.json')?JSON.parse(file.content):file.content);if(file.content===null)fixture.priorFiles.delete(file.path);else fixture.priorFiles.set(file.path,file.content);}} }));
vi.mock('../src/common.js', async importOriginal => {
  const actual = await importOriginal<typeof import('../src/common.js')>();
  return {
    ...actual,
    docsRoot: '/virtual/docs',
    getStoreRoot: () => '/virtual/store',
    getStoredSource: async (sourceId: string) => {
      const record = fixture.records.get(sourceId) as any;
      if (!record) throw new Error(`missing fixture source ${sourceId}`);
      return { record, source: {}, path: `/virtual/source/${sourceId}` };
    },
    readJson: async (path: string) => {
      const value = fixture.json.get(path);
      if (value === undefined) throw new Error(`missing fixture JSON ${path}`);
      return value;
    },
    writeJson: async (path: string, value: unknown) => { fixture.writes.set(path, value); },
    assertPathWithinStore: async () => undefined,
    verifyStoredFile: async () => undefined,
  };

});
vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof import('node:fs/promises')>();
  return { ...actual, readdir: async (path:string) => [...fixture.priorFiles.keys()].filter(file=>file.slice(0,file.lastIndexOf('/'))===path).map(file=>file.slice(file.lastIndexOf('/')+1)), mkdir: async () => undefined, writeFile: async () => undefined, readFile: async (path:string) => {if(fixture.priorFiles.has(path))return fixture.priorFiles.get(path)!;if(path.endsWith('/real-run.json'))throw Object.assign(new Error('missing'),{code:'ENOENT'});return '<html>公共データ利用規約（第1.0版） コンテンツを利用する際は出典を記載してください。 編集・加工等を行ったことを記載してください。</html>';} };
});

import { generateRights } from '../src/rights.js';

const memberSha = 'a'.repeat(64);
const packageSha = 'b'.repeat(64);
const policySha = 'c'.repeat(64);
const memberId = `vintage-member-${memberSha.slice(0, 16)}`;
const reportPath = '/virtual/docs/gis/vintages/shinjuku-2023.json';
const acquisitionPath = `/virtual/docs/gis/acquisitions/vintages/${memberId}.json`;
const packagePath = '/virtual/source/plateau-13104-package-2023';

function setup(exact = true) {
  fixture.researchError=false;fixture.metadataText='';fixture.priorFiles.clear();fixture.writes.clear();fixture.json.clear();fixture.sources=[];fixture.records.clear();
  const archiveUrl=fixture.archiveUrl;
  fixture.sources.push({source_id:'fixture-source',title:'Fixture',station_ids:['shinjuku'],publisher:'fixture',official_url:'https://example.invalid',resolution:{kind:'direct'},expected_url:'https://example.invalid/source',expected_bytes:null,expected_url_match:null,license_name:'unknown',license_url:null,attribution_text:'unknown',commercial_use:{status:'unknown',evidence:''},modification_allowed:{status:'unknown',evidence:''},redistribution_allowed:{status:'unknown',evidence:''},content_year:null,availability_deadline:null,notes:'',publish_gate:'HOLD'});
  fixture.records.set('fixture-source',{source_id:'fixture-source',sha256:'d'.repeat(64),resolved_url:'https://example.invalid/source'});
  fixture.records.set('plateau-13104-package-2023',{source_id:'plateau-13104-package-2023',sha256:packageSha,bytes:10,store_path:'raw/package/data',resolved_url:'https://example.invalid/package'});
  fixture.records.set('plateau-site-policy',{source_id:'plateau-site-policy',sha256:policySha,bytes:10,store_path:'raw/policy/data',resolved_url:'https://example.invalid/policy'});
  fixture.records.set(memberId,{source_id:memberId,sha256:memberSha,bytes:5,store_path:`raw/${memberSha}/member.gml`,resolved_url:archiveUrl,package_source:{source_id:'plateau-13104-package-2023',sha256:packageSha,json_pointer:'/result/resources/0/url'}});
  const report={source_id:'plateau-13104-package-2023',package_sha256:packageSha,tool_input_sha256:fixture.fingerprint,input_sources:[{source_id:'plateau-13104-package-2023',sha256:packageSha}],archives:[{archive:'citygml_2_op.zip',url:archiveUrl}],selected_member_records:[{archive:'citygml_2_op.zip',member:'udx/ubld/member.gml',sha256:memberSha,bytes:5,store_path:`raw/${memberSha}/member.gml`,ranges:[],etag:'"strong"',last_modified:null,validator_type:'STRONG_ETAG',crc32:'00000000',size:5,inspection:null,inspection_error:null}]};
  fixture.json.set(reportPath,report);
  fixture.json.set(acquisitionPath,fixture.records.get(memberId));
  fixture.json.set(packagePath,{success:true,result:{license_id:'plateau',license_url:'https://www.mlit.go.jp/plateau/site-policy/',resources:[{url:exact?archiveUrl:`${archiveUrl}.different`}]}});
}

describe('rights generation for vintage members',()=>{
  beforeEach(()=>setup());
  it('generates a rights record from the hashed member acquisition and exact package URL',async()=>{
    const records=await generateRights();
    const record=records.find(item=>item.source_id===memberId)!;
    expect(fixture.writes.has(`/virtual/docs/gis/rights/${memberId}.json`)).toBe(true);
    expect(record.licence).toMatchObject({value:'plateau',status:'PACKAGE_LEVEL_DECLARED',scope:'PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE'});
    expect(record.evidence.some(item=>item.exact_url===fixture.archiveUrl)).toBe(true);
    expect(record.resource_licence.status).toBe('UNKNOWN');
    expect(record.publish_gate).toBe('HOLD');
  });
  it('leaves member rights UNKNOWN when the archive URL does not match its package pointer',async()=>{
    setup(false);
    const records=await generateRights();
    const record=records.find(item=>item.source_id===memberId)!;
    expect(record.licence.value).toBeNull();
    expect(record.licence.status).toBe('UNKNOWN');
    expect(record.caveats.some(note=>note.includes('No exact package resource URL or pointer matched'))).toBe(true);
  });
  it('fails closed when the derived acquisition hash or archive URL drifts from the vintage report',async()=>{
    fixture.json.set(acquisitionPath,Object.assign({},fixture.records.get(memberId),{sha256:'e'.repeat(64)}));
    await expect(generateRights()).rejects.toThrow('Vintage member acquisition does not match report entry');
    expect(fixture.writes.size).toBe(0);
    setup();
    fixture.json.set(acquisitionPath,Object.assign({},fixture.records.get(memberId),{resolved_url:'https://assets.example/other.zip'}));
    await expect(generateRights()).rejects.toThrow('resolved URL does not match its archive');
    expect(fixture.writes.size).toBe(0);
  });
  it.each([true,false])('inherits a 2025 package declaration only for an exact acquired asset folder (%s)',async exact=>{
    const id='plateau-13104-ubld-synthetic',pkgId='plateau-13104-package-2025';
    const url='https://assets.example/assets/84/unique/13104_synthetic_2025_citygml_1_op/udx/ubld/a.gml';
    fixture.sources.push({...fixture.sources[0] as object,source_id:id,resolution:{kind:'plateau_catalog_api'},expected_url:'https://example.invalid/stale-manifest-url'});
    fixture.records.set(id,{source_id:id,sha256:'1'.repeat(64),resolved_url:url});
    fixture.records.set(pkgId,{source_id:pkgId,sha256:packageSha});
    const archiveUrl=`https://assets.example/assets/84/${exact?'unique':'other'}/13104_synthetic_2025_citygml_1_op.zip`;
    fixture.json.set(`/virtual/source/${pkgId}`,{success:true,result:{license_id:'plateau',license_url:'https://www.mlit.go.jp/plateau/site-policy/',resources:[{url:archiveUrl}]}});
    const record=(await generateRights()).find(r=>r.source_id===id)!;
    expect(record.licence.value).toBe(exact?'plateau':null);
    if(exact)expect(record.licence.scope).toBe('PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE');
    else expect(record.caveats.some(c=>c.includes('No exact package asset-folder match'))).toBe(true);
    expect(record.evidence.some(e=>e.source_id===pkgId&&e.sha256===packageSha)).toBe(true);
    expect(record.resource_licence.status).toBe('UNKNOWN');
    expect(record.publish_gate).toBe('HOLD');
  });
  it('derives both E27 licences and the actual period from the dedicated hashed package snapshot',async()=>{
    const networkId='hokonavi-oedo-shinjuku-network-geojson',mapId='hokonavi-oedo-shinjuku-stationmap-geojson';
    const urls=['https://ckan.example/network.zip','https://ckan.example/stationmap.zip'];
    for(const [i,id] of [networkId,mapId].entries()){
      fixture.sources.push({...fixture.sources[0] as object,source_id:id,expected_url:'https://example.invalid/stale-manifest-url'});
      fixture.records.set(id,{source_id:id,sha256:String(i+1).repeat(64),resolved_url:urls[i],});
    }
    fixture.records.set('hokonavi-oedo-shinjuku-package',{source_id:'hokonavi-oedo-shinjuku-package',sha256:'e'.repeat(64)});
    fixture.json.set('/virtual/source/hokonavi-oedo-shinjuku-package',{success:true,result:{license_id:'pdl-jp-1.0',license_url:'https://example.invalid/pdl',notes:'公開期間は2027年3月12日まで',resources:urls.map(url=>({url,license:null}))}});
    const records=await generateRights();
    for(const id of [networkId,mapId]){
      const record=records.find(r=>r.source_id===id)!;
      expect(record.licence).toMatchObject({value:'pdl-jp-1.0',status:'PACKAGE_LEVEL_DECLARED'});
      expect(record.publication_period_notes).toEqual([{source_id:'hokonavi-oedo-shinjuku-package',sha256:'e'.repeat(64),location:'/result/notes',text:'公開期間は2027年3月12日まで'}]);
      expect(record.resource_licence.status).toBe('UNKNOWN');expect(record.publish_gate).toBe('HOLD');
    }
  });
  it('writes nothing when research preparation fails after all rights records are computed',async()=>{
    fixture.researchError=true;
    await expect(generateRights()).rejects.toThrow('Research preparation failed');
    expect(fixture.writes.size).toBe(0);
  });
  it('matches the exact pre-redirect S03 URL using its hashed acquisition pointer',async()=>{
    const id='tokyo-shinjuku-facilities-reference-pdf',parent='tokyo-shinjuku-facilities-package';
    const requested='https://www.toshiseibi.metro.tokyo.lg.jp/kiban/shinjuku_terminal/pdf/shisetsu_siryou.pdf';
    const resolved='https://www.toshiseibi.metro.tokyo.lg.jp/documents/d/toshiseibi/pdf_siryou';
    fixture.sources.push({...fixture.sources[0] as object,source_id:id,expected_url:requested,resolution:{kind:'ckan_resource',catalog_source_id:parent}});
    fixture.records.set(id,{source_id:id,sha256:'1'.repeat(64),resolved_url:resolved,resolution_evidence:{source_id:parent,sha256:packageSha,json_pointer:'/result/resources/0/url'}});
    fixture.records.set(parent,{source_id:parent,sha256:packageSha});
    fixture.json.set(`/virtual/source/${parent}`,{success:true,result:{license_id:'CC-BY-4.0',resources:[{url:requested}]}});
    const record=(await generateRights()).find(r=>r.source_id===id)!;
    expect(record.evidence).toContainEqual(expect.objectContaining({location:'/result/resources/0/url',exact_url:requested,scope:expect.stringContaining('expected_url')}));
    expect(record.licence.status).toBe('PACKAGE_LEVEL_DECLARED');
    expect(record.resource_licence.status).toBe('UNKNOWN');
    fixture.writes.clear();
    (fixture.json.get(`/virtual/source/${parent}`) as any).result.resources.push({url:requested});
    await expect(generateRights()).rejects.toThrow('2 exact resource URL matches');
    expect(fixture.writes.size).toBe(0);
  });

  it.each(['CC BY 4.0 does not apply.','CC BY 4.0 は適用されません。','Licensed under CC BY 4.0'])('keeps the exact metadata quote without promoting non-affirmative rights: %s',async text=>{
    const id='plateau-13104-metadata',pkgId='plateau-13104-package-2025';
    fixture.metadataText=text;
    fixture.sources.push({...fixture.sources[0] as object,source_id:id,resolution:{kind:'plateau_catalog_api'}});
    fixture.records.set(id,{source_id:id,sha256:'1'.repeat(64),resolved_url:'https://assets.example/metadata.zip'});
    fixture.records.set(pkgId,{source_id:pkgId,sha256:packageSha});
    fixture.json.set(`/virtual/source/${pkgId}`,{success:true,result:{license_id:'plateau',resources:[]}});
    const record=(await generateRights()).find(r=>r.source_id===id)!;
    const affirmative=text==='Licensed under CC BY 4.0';
    expect(record.file_embedded_licence).toMatchObject({value:affirmative?'CC BY 4.0':null,status:affirmative?'FILE_EMBEDDED':'UNKNOWN'});
    expect(record.evidence).toContainEqual(expect.objectContaining({quote:text,location:'ZIP:metadata.xml:useLimitation'}));
    expect(record.declarations.some(d=>d.status==='FILE_EMBEDDED')).toBe(affirmative);
    expect(record.publish_gate).toBe('HOLD');
  });
  it('archives superseded vintage rights and acquisitions in the same prepared bundle',async()=>{
    const obsoleteId='vintage-member-eeeeeeeeeeeeeeee';
    const rightsPath=`/virtual/docs/gis/rights/${obsoleteId}.json`;
    const oldAcquisition=`/virtual/docs/gis/acquisitions/vintages/${obsoleteId}.json`;
    const oldRights=JSON.stringify({source_id:obsoleteId,source_sha256:'e'.repeat(64)});
    const oldReceipt=JSON.stringify({source_id:obsoleteId,sha256:'e'.repeat(64)});
    fixture.priorFiles.set(rightsPath,oldRights);fixture.priorFiles.set(oldAcquisition,oldReceipt);
    const records=await generateRights();
    expect(records.some(r=>r.source_id===obsoleteId)).toBe(false);
    expect(fixture.writes.get(rightsPath)).toBeNull();
    expect(fixture.writes.get(oldAcquisition)).toBeNull();
    expect([...fixture.writes.keys()].filter(p=>p.includes('/history/rights/')&&p.endsWith(`-${obsoleteId}.json`))).toHaveLength(1);
    expect([...fixture.writes.keys()].filter(p=>p.includes('/history/acquisitions/vintages/')&&p.endsWith(`-${obsoleteId}.json`))).toHaveLength(1);
    expect(fixture.writes.has(`/virtual/docs/gis/rights/${memberId}.json`)).toBe(true);
    fixture.writes.clear();await generateRights();
    expect([...fixture.writes.keys()].some(p=>p.includes('/history/'))).toBe(false);
  });
});
