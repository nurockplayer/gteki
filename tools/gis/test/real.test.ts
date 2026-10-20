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
  it('verifies all 19 recorded SHA-256 values and byte counts',async()=>{
    for(const source of loadSources()){const stored=await getStoredSource(source.source_id);expect(stored.record.sha256).toMatch(/^[a-f0-9]{64}$/);if(source.expected_bytes!==null)expect(stored.record.bytes).toBe(source.expected_bytes);}
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
