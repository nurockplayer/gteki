import { relatedIdentity } from '../src/related.js';
import { createHash } from 'node:crypto';
import { RIGHTS_SOURCES } from '../src/poi.js';
import { verifyEvidence, evaluateRightsRecords } from '../src/rights.js';
import { projectRights, rightsScopeMarkdown } from '../src/rights-view.js';
import { readJson } from '../src/common.js';
import { execFileSync } from 'node:child_process';
import { r1GeoEvidence,compareNetworkRepresentations } from '../src/r1.js';
import { parseCsv } from '../src/network.js';
import { codebooks } from '../src/attributes.js';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { describe,expect,it } from 'vitest';
import { loadSources } from '../src/acquire.js';
import { docsRoot,getStoredSource,getStoreRoot } from '../src/common.js';
import { inspectCityGml } from '../src/citygml.js';
import { citygmlToGlb } from '../src/convert.js';
import { smallestRoom } from '../src/selection.js';
const available=loadSources().every(s=>existsSync(join(docsRoot,'gis','acquisitions',`${s.source_id}.json`)))&&existsSync(join(getStoreRoot(),'raw'));
describe.skipIf(!available)('real acquired sources (optional external store)',()=>{
  it('verifies all recorded SHA-256 values and byte counts',async()=>{
    for(const source of loadSources()){const stored=await getStoredSource(source.source_id);if(source.catalog_resource_url){expect(stored.record.resolved_url).toBe(source.expected_url);expect(stored.record.sha256).toBe(source.catalog_resource_sha256);}expect(stored.record.sha256).toMatch(/^[a-f0-9]{64}$/);if(source.expected_bytes!==null)expect(stored.record.bytes).toBe(source.expected_bytes);}
  },120000);
  it('checks every rights clause against its hash-verified stored source or terms snapshot',async()=>{
    for(const id of RIGHTS_SOURCES){const report=await readJson<any>(join(docsRoot,'gis','rights',`${id}.json`));for(const row of report.records)for(const e of row.evidence)await verifyEvidence(e);}
    for(const id of ['tokyo-s03-zip']){const report=await readJson<any>(join(docsRoot,'gis','poi',`${id}.json`));for(const e of report.context_evidence)await verifyEvidence(e);}
  },120000);
  it('recomputes all fourteen real feature identities and their attached catalog origins',async()=>{
    let jsonEqual=0,featuresEqual=0;
    for(const id of ['plateau-13104-related','plateau-13116-related']){
      const actual=await relatedIdentity(id),report=await readJson<any>(join(docsRoot,'gis','rights',`${id}.json`));
      const poi=await readJson<any>(join(docsRoot,'gis','poi',`${id}.json`));
      expect(actual).toHaveLength(7); expect(report.identity_checks).toEqual(actual);expect(poi.identity_checks).toEqual(actual);
      expect(report.records[0].verdict).toBe('UNKNOWN');
      for(const row of actual){
        expect(row.comparison).not.toBe('different');expect(row.origin?.date).toBeTruthy();expect(row.origin?.creator).toBeTruthy();
        if(row.comparison==='JSON-equal')jsonEqual++;else{featuresEqual++;expect(row.top_level_differences).toEqual(['name']);}
        const record=report.records.find((r:any)=>r.layer===row.member);expect(record.origin).toEqual(row.origin);
        expect(record.publish_gate).toBe('HOLD');expect(record.routable).toBe(false);
        const expected=/_(?:shelter|park|emergency_route)\.geojson$/.test(row.member)?'RESTRICTED':row.member.endsWith('_landmark.geojson')?'UNKNOWN':'CLEARED_WITH_CONDITIONS';
        expect(record.verdict).toBe(expected);
      }
    }
    expect({jsonEqual,featuresEqual}).toEqual({jsonEqual:8,featuresEqual:6});
  },120000);
  it('verifies the acquired fixed POST body hash and conservative S03 field split',async()=>{
    const graph=await getStoredSource('plateau-related-provenance'),request=graph.record.request!;
    expect(request.body_sha256).toBe(createHash('sha256').update(request.body,'utf8').digest('hex'));
    expect(request.body).toBe(graph.source.request?.body);
    const report=await readJson<any>(join(docsRoot,'gis','rights','tokyo-s03-zip.json'));
    expect(report.records[0].verdict).toBe('UNKNOWN');expect(report.records[0].layer).toBeNull();expect(report.records[0].format_provenance_clue.format).toBe('HERE Venues Community');
    const factual=report.records.find((r:any)=>r.layer?.startsWith('geometry and factual fields only'));
    expect(factual.verdict).toBe('CLEARED_WITH_CONDITIONS');expect(factual.scope).toContain('No promotional description prose');
    const field=report.records.find((r:any)=>r.field_scope);expect(field.verdict).toBe('UNKNOWN');
    expect(field.field_scope).toMatchObject({description_rows:147,url_rows:169});
  },120000);
  it('audits whole-resource verdicts and preserves every scope/exclusion in generated rights and gap projections',async()=>{
    const reports=await Promise.all(RIGHTS_SOURCES.map(id=>readJson<any>(join(docsRoot,'gis','rights',`${id}.json`))));
    const readme=await readFile(join(docsRoot,'gis','rights','README.md'),'utf8');
    const research=await readFile(join(docsRoot,'gis','research','poi-rights-s10-s03-related.md'),'utf8');
    for(const report of reports){
      expect(evaluateRightsRecords(report.records).map(row=>row.verdict)).toEqual(report.records.map((row:any)=>row.verdict));
      for(const row of report.records){expect(readme).toContain(rightsScopeMarkdown(row));expect(research).toContain(rightsScopeMarkdown(row));}
    }
    const reference=reports.find(report=>report.source_id==='tokyo-s03-reference');
    expect(reference.records.map((row:any)=>row.verdict)).toEqual(['UNKNOWN','CLEARED_WITH_CONDITIONS','UNKNOWN']);
    for(const station of ['shinjuku','ikebukuro']){
      const gap=await readJson<any>(join(docsRoot,'gis','gaps',`${station}.json`));
      const markdown=await readFile(join(docsRoot,'gis','gaps',`${station}.md`),'utf8');
      const expected=reports.filter(report=>report.station_ids.includes(station)).flatMap(report=>report.records.map((row:any)=>projectRights(report,row)));
      expect(gap.resource_rights).toEqual(expected);
      for(const row of expected)expect(markdown).toContain(rightsScopeMarkdown(row));
    }
  },120000);
  for(const book of codebooks)it(`checks every literal codebook label against acquired ${book.version} PDF text`,async()=>{
    const source=await getStoredSource(book.spec_source_id);expect(source.record.sha256).toBe(book.spec_sha256);
    const text=execFileSync(process.env.GTEKI_GIS_PDFTOTEXT||'pdftotext',['-raw',source.path,'-'],{encoding:'utf8',maxBuffer:8*1024*1024});
    const normalize=(value:string)=>value.replace(/\s/gu,'');
    const normalized=normalize(text);
    const visit=(value:any):void=>{
      if(Array.isArray(value)){value.forEach(visit);return;}
      if(!value||typeof value!=='object')return;
      if(Object.hasOwn(value,'label')){
        if(value.transcription_check==='MANUAL'){expect(value.reason?.length).toBeGreaterThan(20);}
        else if(typeof value.label==='string')expect(normalized,`Missing literal label: ${value.label}`).toContain(normalize(value.label));
      }
      for(const rule of value.rule_labels??[])expect(normalized,`Missing rule: ${rule}`).toContain(normalize(rule));
      for(const child of Object.values(value))visit(child);
    };
    visit(book);
  });
  it('compares R1 representations and applies the strict real-distance threshold without identifying a datum',async()=>{
    const r1=await r1GeoEvidence(),node=await getStoredSource('hokonavi-ikebukuro-walk-node-csv'),link=await getStoredSource('hokonavi-ikebukuro-walk-link-csv');
    const comparison=compareNetworkRepresentations(parseCsv(await readFile(node.path)).rows,parseCsv(await readFile(link.path)).rows,r1.nodes.features,r1.links.features);
    expect(comparison.nodes.equal_coordinates).toBe(r1.nodes.features.length);
    expect(comparison.nodes.different_shared_attribute_rows).toBe(0);expect(comparison.links.different_shared_attribute_rows).toBe(0);
    expect(r1.distance.comparable_links).toBe(r1.links.features.length);expect(r1.distance.above_threshold).toBe(30);expect(r1.distance.result).toBe('NO_VERDICT');
    expect(r1.crs.status).toBe('INFERRED_FROM_SPEC');
  });
  for(const [source,frame] of [['plateau-13116-ubld-53394576','ikebukuro-plateau-ubld-v0'],['plateau-13104-ubld-53394536','shinjuku-plateau-ubld-v0']]){
    it(`generates identical inventory bytes twice and converts a bounded Room for ${source}`,async()=>{
      await inspectCityGml(source);const file=join(docsRoot,'gis','inventory',`${source}.inventory.json`),first=await readFile(file);
      const inventory=await inspectCityGml(source);expect(await readFile(file)).toEqual(first);
      const room=smallestRoom(inventory);expect(room).toBeDefined();
      const conversion=await citygmlToGlb(source,frame,{ids:[room!.gml_id],maxPolygons:50});
      // This bounded check is not a real-run step: drop its docs receipt so it never mixes with real-run receipts.
      await rm(join(docsRoot,'gis','conversions',`${conversion.run_id}.json`),{force:true});
      expect(conversion.validation.status).toBe('PASS');expect(conversion.validation.bbox_max_error_m).toBeLessThanOrEqual(0.001);expect(conversion.totals.polygons_converted).toBeGreaterThan(0);expect(conversion.totals.polygons_converted).toBeLessThanOrEqual(50);
    },120000);
  }
});
