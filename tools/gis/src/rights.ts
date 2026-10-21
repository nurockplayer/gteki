import { readFile, readdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { loadSources } from './acquire.js';
import { assertPathWithinStore, docsRoot, getStoredSource, getStoreRoot, readJson, verifyStoredFile, type SourceManifest } from './common.js';
import { toolFingerprint } from './provenance.js';
import { readZip } from './zip.js';
import { type VintageReport } from './vintage.js';
import { SaxesParser } from 'saxes';
import { commitReportFiles, type ReportFile } from './report-transaction.js';
import { assertPoiInspectionCurrent, assertVintageResearchCurrent } from './inspection-evidence.js';

export type LicenceStatus = 'PACKAGE_LEVEL_DECLARED' | 'RESOURCE_LEVEL_DECLARED' | 'FILE_EMBEDDED' | 'SITE_TERMS' | 'UNKNOWN';
export type RightsEvidence = {source_id:string;sha256:string;location:string;quote?:string;exact_url?:string;scope:string};
export type RightsRecord = {
  source_id:string;source_sha256:string;tool_input_sha256:string;station_ids:string[];
  licence:{value:string|null;status:LicenceStatus;scope:string};
  resource_licence:{value:string|null;status:'RESOURCE_LEVEL_DECLARED'|'UNKNOWN'};
  file_embedded_licence:{value:string|null;status:'FILE_EMBEDDED'|'UNKNOWN';scope?:string;reason?:string};
  declarations:Array<{value:string;status:LicenceStatus;evidence:RightsEvidence}>;
  evidence:RightsEvidence[];input_sources:Array<{source_id:string;sha256:string}>;
  attribution:{required:'YES'|'UNKNOWN';text_required:string|null;proposed_text:string;status:string};
  modification_notice:{required:'YES'|'UNKNOWN';text:string|null;status:string};
  caveats:string[];publish_gate:'HOLD';clearance_required:string[];
  file_rights_observations:unknown[];verification:'UNVERIFIED';routable:false;
  publication_period_notes?:Array<{source_id:string;sha256:string;location:string;text:string}>;
};
const own=(value:unknown,key:string):unknown=>value&&typeof value==='object'&&Object.hasOwn(value,key)?(value as Record<string,unknown>)[key]:undefined;
export function htmlText(html:string):string{return html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,' ').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,' ').replace(/<[^>]+>/g,' ').replace(/&nbsp;|&#160;/g,' ').replace(/\s+/gu,' ').trim();}
export function shortEvidence(source_id:string,sha256:string,location:string,quote:string,scope:string):RightsEvidence {
  const words=[...new Intl.Segmenter('ja',{granularity:'word'}).segment(quote)].filter(s=>s.isWordLike).length;
  if(!/^[a-f0-9]{64}$/.test(sha256)||words>15||quote.length>180)throw new Error('Invalid or excessive rights evidence');
  return {source_id,sha256,location,quote,scope};
}
export function urlEvidence(source_id:string,sha256:string,location:string,url:string,scope:string):RightsEvidence {
  if(!/^[a-f0-9]{64}$/.test(sha256)||!/^https:\/\//.test(url))throw new Error('Invalid URL evidence');
  return {source_id,sha256,location,exact_url:url,scope};
}
/** A package declaration never becomes a resource declaration, including inherited-looking fields. */
export function packageLicence(payload:unknown):{value:string|null;resource_fields:string[]} {
  const result=own(payload,'result');
  if(own(payload,'success')!==true||!result||typeof result!=='object')throw new Error('Invalid CKAN rights snapshot');
  const value=own(result,'license_id');
  return {value:typeof value==='string'&&value.trim()?value:null,resource_fields:['license','license_id','license_title','license_url']};
}
export function exactResourceUrlIndex(resources:unknown, url:string):number|null {
  if(!Array.isArray(resources))return null;
  const matches=resources.flatMap((resource:unknown,index:number)=>own(resource,'url')===url?[index]:[]);
  return matches.length===1?matches[0]!:null;
}
/** Match a resource against both observed final and exact acquisition-request URLs.
 * Redirects do not change CKAN membership. Never select by filename/name/index alone.
 */
export function matchAcquiredResource(resources:unknown, acquisition:{resolved_url:string;resolution_evidence?:{source_id:string;sha256:string;json_pointer:string}|null}, source:SourceManifest, parent:{source_id:string;sha256:string}):{index:number;field:'resolved_url'|'expected_url';url:string} {
  if(!Array.isArray(resources))throw new Error(`Missing CKAN resources: ${parent.source_id}`);
  const matches=resources.flatMap<{index:number;field:'resolved_url'|'expected_url';url:string}>((resource:unknown,index:number)=>{
    const url=own(resource,'url');
    if(url===acquisition.resolved_url)return [{index,field:'resolved_url' as const,url:acquisition.resolved_url}];
    if(url===source.expected_url)return [{index,field:'expected_url' as const,url:source.expected_url}];
    return [];
  });
  if(matches.length!==1)throw new Error(`Rights package does not uniquely identify ${source.source_id}: ${matches.length} exact resource URL matches`);
  const match=matches[0]!;
  // A pre-redirect match is usable only with the exact hashed resolver receipt.
  if(match.field==='expected_url') {
    const evidence=acquisition.resolution_evidence;
    if(evidence?.source_id!==parent.source_id||evidence.sha256!==parent.sha256||evidence.json_pointer!==`/result/resources/${match.index}/url`)throw new Error(`Unverified pre-redirect resource URL for ${source.source_id}`);
  }
  // A hashed resolution pointer is authoritative acquisition provenance. A final-URL
  // match that disagrees with it (for example a redirect landing on another catalog
  // resource) must fail closed instead of attributing a different resource's licence.
  const pointer=acquisition.resolution_evidence;
  if(pointer) {
    if(pointer.source_id!==parent.source_id||pointer.sha256!==parent.sha256||pointer.json_pointer!==`/result/resources/${match.index}/url`)throw new Error(`Resource URL match conflicts with hashed resolution pointer for ${source.source_id}: matched resources/${match.index} by ${match.field}, pointer ${pointer.source_id}@${pointer.sha256.slice(0,12)}${pointer.json_pointer}`);
  }
  return match;
}
/** Match only a child catalog URL nested under the exact package ZIP asset folder. */
export function exactPackageAssetFolderMatch(resources:unknown, childUrl:string):number|null {
  if(!Array.isArray(resources))return null;
  let match:number|null=null;
  for(let i=0;i<resources.length;i++) {
    const url=own(resources[i],'url');
    if(typeof url!=='string'||!url.endsWith('.zip'))continue;
    const folder=url.slice(0,-4);
    if(childUrl===url||childUrl.startsWith(`${folder}/`)) {
      if(match!==null)return null;
      match=i;
    }
  }
  return match;
}
export type MetadataRightsScope = 'DATASET_RESOURCE_CONSTRAINTS' | 'METADATA_RECORD_ONLY' | 'UNKNOWN';
/** TEXT is an element's own text; CODED is a codeList/codeListValue attribute; LINKED is an xlink:href-style reference. */
export type MetadataRightsKind = 'TEXT' | 'CODED' | 'LINKED';
export type MetadataRightsFinding = {value:string|null;quote:string;element:string;path:string;scope:MetadataRightsScope;kind:MetadataRightsKind};
/** Namespace URIs whose ISO 19115 element semantics are understood. Equal-but-unrecognized
 * namespaces (for example xmlns="urn:unrelated") never establish dataset rights.
 */
export const SUPPORTED_METADATA_NAMESPACES:ReadonlySet<string>=new Set([
  'http://zgate.gsi.go.jp/ch/jmp/', // JMP 2.0 (the acquired PLATEAU metadata)
  'http://www.isotc211.org/2005/gmd', // ISO 19139 gmd
]);
/** Scope of a rights statement from its namespace-qualified ancestor chain (Clark names).
 * Only identificationInfo/<Identification>/resourceConstraints/... describes the dataset;
 * metadataConstraints constrain the metadata record itself. Anything else stays UNKNOWN.
 */
export function classifyMetadataRightsScope(ancestors:Array<{uri:string;local:string}>):MetadataRightsScope {
  const locals=ancestors.map(a=>a.local);
  const hasMetadata=locals.includes('metadataConstraints'),hasResource=locals.includes('resourceConstraints');
  if(hasMetadata&&hasResource)return 'UNKNOWN';
  const first=ancestors[0]?.uri;
  // One consistent, recognized namespace along the whole chain; equality alone proves nothing.
  if(!first||!SUPPORTED_METADATA_NAMESPACES.has(first)||!ancestors.every(a=>a.uri===first))return 'UNKNOWN';
  if(hasMetadata&&locals[0]==='MD_Metadata'&&locals[1]==='metadataConstraints')return 'METADATA_RECORD_ONLY';
  if(locals[0]==='MD_Metadata'&&locals[1]==='identificationInfo'&&locals[2]?.endsWith('Identification')&&locals[3]==='resourceConstraints'&&locals.length>=6)return 'DATASET_RESOURCE_CONSTRAINTS';
  return 'UNKNOWN';
}
export function embeddedMetadataRights(xml:string):MetadataRightsFinding[] {
  // Parse XML structure and collect only explicit rights fields. DOCTYPE is rejected,
  // matching the downloaded CityGML/XML parser boundary.
  const parser=new SaxesParser({xmlns:true});
  const stack:Array<{element:string;uri:string;text:string;capture:boolean}>=[],found:MetadataRightsFinding[]=[];
  const keys=new Set(['useLimitation','otherConstraints','accessConstraints','useConstraints','license','licence']);
  const pathOf=(ancestors:Array<{uri:string;local:string}>)=>ancestors.map(a=>a.uri?`{${a.uri}}${a.local}`:a.local).join('/');
  parser.on('doctype',()=>{throw new Error('DOCTYPE declarations are forbidden in metadata XML');});
  parser.on('opentag',tag=>{
    const element=tag.local;
    const frame={element,uri:tag.uri,text:'',capture:keys.has(element)};
    stack.push(frame);
    // Coded (codeListValue) and linked (xlink:href) restrictions have no text but still constrain use.
    // Preserve them whenever they sit in, or inside, a rights/constraints element.
    const inConstraints=stack.some(f=>f.capture||/Constraints$/.test(f.element));
    if(!inConstraints)return;
    const ancestors=stack.map(f=>({uri:f.uri,local:f.element}));
    const attributes=Object.values(tag.attributes as Record<string,{local:string;value:string}>);
    const coded=attributes.filter(a=>a.local==='codeListValue'||a.local==='codeList');
    const linked=attributes.filter(a=>a.local==='href');
    const note=(items:typeof attributes)=>items.map(a=>`${a.local}=${JSON.stringify(a.value)}`).join(' ').slice(0,170);
    for(const [items,kind] of [[coded,'CODED'],[linked,'LINKED']] as const)
      if(items.length)found.push({value:null,quote:note(items),element,path:pathOf(ancestors),scope:classifyMetadataRightsScope(ancestors),kind});
  });
  parser.on('text',text=>{for(const frame of stack)if(frame.capture)frame.text+=text;});
  parser.on('cdata',text=>{for(const frame of stack)if(frame.capture)frame.text+=text;});
  parser.on('closetag',()=>{
    const ancestors=stack.map(frame=>({uri:frame.uri,local:frame.element}));
    const frame=stack.pop();if(!frame?.capture)return;
    const text=frame.text.replace(/\s+/g,' ').trim();
    if(!text)return;
    // A rights-field mention is evidence, not a grant. Match the entire supported
    // affirmative declaration so suffixes, negations and conditions stay UNKNOWN.
    const english=text.match(/^(?:this (?:dataset|data|work|content) is )?licensed under (CC\s*BY\s*4\.0|PDL\s*1\.0)[.!。]?$/i);
    const japanese=text.match(/^(?:本データ|本作品|本コンテンツ)は\s*(CC\s*BY\s*4\.0|PDL\s*1\.0)\s*に基づき提供されています[。.]?$/);
    const known=english?.[1]??japanese?.[1]??null;
    found.push({value:known?known.toUpperCase().replace(/\s+/g,' '):null,quote:text,element:frame.element,path:pathOf(ancestors),scope:classifyMetadataRightsScope(ancestors),kind:'TEXT'});
  });
  parser.write(xml).close();
  return found;
}
export function findTextValue(payload:unknown, pattern:RegExp):{pointer:string;value:string}|null {
  const matcher=new RegExp(pattern.source,pattern.flags.replace('g',''));
  const walk=(value:unknown,pointer:string):{pointer:string;value:string}|null=>{
    if(typeof value==='string'&&matcher.test(value))return {pointer,value};
    if(Array.isArray(value)){for(let i=0;i<value.length;i++){const found=walk(value[i],`${pointer}/${i}`);if(found)return found;}}
    else if(value&&typeof value==='object')for(const [key,child] of Object.entries(value)){const found=walk(child,`${pointer}/${key.replaceAll('~','~0').replaceAll('/','~1')}`);if(found)return found;}
    return null;
  };
  return walk(payload,'');
}
export function findPublicationPeriodNotes(payload:unknown):Array<{pointer:string;text:string}> {
  const output:Array<{pointer:string;text:string}>=[];
  const date=/(?:20\d{2}[年/-]\s*\d{1,2}[月/-]\s*\d{1,2}日?|令和\s*\d+年\s*\d{1,2}月\s*\d{1,2}日?)/;
  const periodKey=/(?:publication|publish|period|availability|deadline|公開|掲載|期間|期限)/i;
  const walk=(value:unknown,pointer:string,parentKey='')=>{
    if(typeof value==='string'&&(periodKey.test(parentKey)||periodKey.test(value))&&date.test(value))output.push({pointer,text:value});
    else if(Array.isArray(value))value.forEach((child,index)=>walk(child,`${pointer}/${index}`,parentKey));
    else if(value&&typeof value==='object') {
      const fields=value as Record<string,unknown>,label=[fields.key,fields.name,fields.title].find(item=>typeof item==='string'&&periodKey.test(item));
      for(const [key,child] of Object.entries(fields))walk(child,`${pointer}/${key.replaceAll('~','~0').replaceAll('/','~1')}`,key==='value'&&typeof label==='string'?label:key);
    }
  };
  walk(payload,'');return output;
}
const parentFor=(source:SourceManifest):string|null=>{
  if(source.resolution.kind==='ckan_resource')return source.resolution.catalog_source_id;
  if(/^hokonavi-oedo-shinjuku-(?:network|stationmap)-geojson$/.test(source.source_id))return 'hokonavi-oedo-shinjuku-package';
  return /^(tokyo-.*-package|plateau-\d+-package-\d+|hokonavi-oedo-shinjuku-package)$/.test(source.source_id)?source.source_id:null;
};
export async function generateRights():Promise<RightsRecord[]> {
  const out=join(docsRoot,'gis','rights');
  const fingerprint=await toolFingerprint(),records:RightsRecord[]=[];
  for(const source of loadSources()) {
    const stored=await getStoredSource(source.source_id),evidence:RightsEvidence[]=[],declarations:RightsRecord['declarations']=[];
    let licence:RightsRecord['licence']={value:null,status:'UNKNOWN',scope:'Exact resource rights not established by acquired evidence.'};
    let resourceLicence:RightsRecord['resource_licence']={value:null,status:'UNKNOWN'};
    let fileEmbedded:RightsRecord['file_embedded_licence']={value:null,status:'UNKNOWN',reason:'No exact file-embedded licence was established; inventory observations do not grant permission.'};
    const caveats=['No inferred permission from availability, file type, absence of notices, or a legacy manifest label.','Third-party originals, trademarks, personal rights, and individual-law restrictions require separate scope checks.'];
    let attributionRequired: 'YES'|'UNKNOWN'='UNKNOWN',modificationRequired:'YES'|'UNKNOWN'='UNKNOWN';
    let attributionText:string|null=null;
    let publicationPeriodNotes:RightsRecord['publication_period_notes']=[];
    const parent=parentFor(source);
    if(parent) {
      const p=await getStoredSource(parent),payload=await readJson<unknown>(p.path),decl=packageLicence(payload);
      if(decl.value){
        const ev=shortEvidence(parent,p.record.sha256,'/result/license_id',decl.value,'Package only; no resource or third-party scope inferred.');evidence.push(ev);
        licence={value:decl.value,status:'PACKAGE_LEVEL_DECLARED',scope:ev.scope};declarations.push({value:decl.value,status:'PACKAGE_LEVEL_DECLARED',evidence:ev});
        const title=own(own(payload,'result'),'license_title'),url=own(own(payload,'result'),'license_url');
        if(typeof title==='string'&&title.trim())evidence.push(shortEvidence(parent,p.record.sha256,'/result/license_title',title,'Package licence title only.'));
        if(typeof url==='string'&&url.startsWith('https://'))evidence.push(urlEvidence(parent,p.record.sha256,'/result/license_url',url,'Package licence link only.'));
        if(decl.value==='CC-BY-4.0'){attributionRequired='YES';modificationRequired='YES';caveats.push('CC BY obligations are conditional on applicability; exact resource coverage and required credit parties remain UNKNOWN.');}
      }
      if(source.source_id!==parent){
        const resources=own(own(payload,'result'),'resources');if(!Array.isArray(resources))throw new Error(`Missing CKAN resources: ${parent}`);
        const matched=matchAcquiredResource(resources,stored.record,source,{source_id:parent,sha256:p.record.sha256});
        const i=matched.index,r=resources[i];
        evidence.push(urlEvidence(parent,p.record.sha256,`/result/resources/${i}/url`,matched.url,`Exact catalog resource URL matched acquisition ${matched.field}${matched.field==='expected_url'?'; resolved_url differs after HTTP redirect; verified hashed resolution_evidence pointer':''}. Package membership only.`));
        const values=decl.resource_fields.flatMap(key=>{const v=own(r,key);return typeof v==='string'&&v.trim()?[{key,value:v}]:[];});
        if(values.length){const declared=values[0]!;resourceLicence={value:declared.value,status:'RESOURCE_LEVEL_DECLARED'};const ev=shortEvidence(parent,p.record.sha256,`/result/resources/${i}/${declared.key}`,declared.value,'Exact resource declaration; third-party scope still requires checking.');evidence.push(ev);licence={value:declared.value,status:'RESOURCE_LEVEL_DECLARED',scope:ev.scope};declarations.push({value:declared.value,status:'RESOURCE_LEVEL_DECLARED',evidence:ev});}
        else evidence.push({source_id:parent,sha256:p.record.sha256,location:`/result/resources/${i}`,scope:'No own nonblank license/license_id/license_title/license_url field. This absence grants no permission.'});
      }
    }
    // Only already-acquired supporting evidence is used for the original sources.
    if(parent==='hokonavi-oedo-shinjuku-package') {
      const p=await getStoredSource(parent),payload=await readJson<unknown>(p.path);
      publicationPeriodNotes=findPublicationPeriodNotes(payload).map(note=>({source_id:parent,sha256:p.record.sha256,location:note.pointer,text:note.text}));
      if(publicationPeriodNotes.length)caveats.push('Acquired publication/availability periods record source availability only; licence expiration or revocation is not inferred.');
    }
    if(source.source_id.startsWith('hokonavi-ikebukuro-walk-')) {
      const support=await getStoredSource('hokonavi-ikebukuro-walk-node-geojson');
      const doc=support.record.supporting_documents?.find(d=>d.id==='ckan-metadata');
      if(doc){const payload=await readJson<unknown>(join(getStoreRoot(),doc.store_path));const decl=packageLicence(payload);
        const result=own(payload,'result'),resources=own(result,'resources');
        // The shared package snapshot belongs to this source only through exactly one exact
        // resource URL (same discipline as matchAcquiredResource); no pointer exists for a
        // direct acquisition, so only the observed final URL can match. Otherwise UNKNOWN.
        const memberIndexes=Array.isArray(resources)?resources.flatMap((resource:unknown,index:number)=>own(resource,'url')===stored.record.resolved_url?[index]:[]):[];
        if(memberIndexes.length!==1) {
          caveats.push(`Supporting CKAN package snapshot has ${memberIndexes.length} exact resource URL matches for ${source.source_id}; package licence and availability notes are not attributed (UNKNOWN).`);
        } else if(decl.value){
          const i=memberIndexes[0]!;
          evidence.push(urlEvidence(support.record.source_id,doc.sha256,`supporting_documents/ckan-metadata:/result/resources/${i}/url`,stored.record.resolved_url,'Exact catalog resource URL matched acquisition resolved_url in the hashed supporting CKAN snapshot. Package membership only.'));
          const ev=shortEvidence(support.record.source_id,doc.sha256,'supporting_documents/ckan-metadata:/result/license_id',decl.value,'Package declaration; exact resource and third-party scope UNKNOWN.');evidence.push(ev);declarations.push({value:decl.value,status:'PACKAGE_LEVEL_DECLARED',evidence:ev});licence={value:decl.value,status:'PACKAGE_LEVEL_DECLARED',scope:ev.scope};
          const policyUrl=own(result,'license_url');if(typeof policyUrl==='string'&&policyUrl)evidence.push(shortEvidence(support.record.source_id,doc.sha256,'supporting_documents/ckan-metadata:/result/license_url',policyUrl,'Package licence URL; package scope only.'));
          publicationPeriodNotes=findPublicationPeriodNotes(payload).map(note=>({source_id:support.record.source_id,sha256:doc.sha256,location:`supporting_documents/ckan-metadata:${note.pointer}`,text:note.text}));
          for(const note of publicationPeriodNotes)evidence.push({source_id:support.record.source_id,sha256:doc.sha256,location:note.location,scope:'Acquired publication-period metadata; availability date is separate from licence duration.'});
          if(publicationPeriodNotes.length)caveats.push('Acquired Hokonavi package metadata states a publication/availability period. This records source availability only and does not establish licence expiration or revocation.');
        }
      }
    }
    const plateauCatalogSource=source.resolution.kind==='plateau_catalog_api'&&/13104|13116/.test(source.source_id);
    if(source.source_id==='plateau-site-policy'||parent?.startsWith('plateau-')||plateauCatalogSource) {
      const policy=await getStoredSource('plateau-site-policy'),text=htmlText(await readFile(policy.path,'utf8'));
      const policyApplicable=source.source_id==='plateau-site-policy'||parent?.startsWith('plateau-');
      if(policyApplicable) {
       for(const [quote,location,scope] of [
        ['公共データ利用規約（第1.0版）','HTML §3 コンテンツの利用','Site default, unless otherwise stated; package applicability is separate.'],
        ['コンテンツを利用する際は出典を記載してください。','HTML §3(1)①','Source attribution obligation under site terms.'],
        ['編集・加工等を行ったことを記載してください。','HTML §3(1)②','Modification notice under site terms.'],
        ['各地方公共団体に帰属','HTML §3','Municipal copyright for G空間 3D city model open data.'],
        ['測量法に基づく公共測量の測量成果の利用について','HTML §3(2)','Individual-law caveat.'],
        ['本利用ルールは、 クリエイティブ・コモンズ・ライセンスの表示4.0 国際ライセンス','HTML §3(3)','CC BY compatibility, not a file-embedded licence.'],
       ]) {if(!text.includes(quote!))throw new Error(`PLATEAU policy evidence changed: ${location}`);evidence.push(shortEvidence(policy.record.source_id,policy.record.sha256,location!,quote!,scope!));}
       const ev=evidence.find(e=>e.source_id==='plateau-site-policy')!;declarations.push({value:'公共データ利用規約（第1.0版）; CC BY 4.0 compatible',status:'SITE_TERMS',evidence:ev});
       if(source.source_id==='plateau-site-policy')licence={value:'PDL 1.0',status:'SITE_TERMS',scope:'PLATEAU website default; exceptions preserved.'};
       attributionRequired='YES';modificationRequired='YES';attributionText='出典：国土交通省 PLATEAUウェブサイト（当該ページのURL）';
       caveats.push('G空間 3D city model copyright belongs to the municipality; this does not establish rights in related third-party originals.','測量法: public survey results may have separate statutory constraints.','Explicit alternate rights notices override site defaults.');
      }
      if(source.resolution.kind==='plateau_catalog_api'&&source.source_id!=='plateau-site-policy') {
        const packageId=source.source_id.includes('13104')?'plateau-13104-package-2025':source.source_id.includes('13116')?'plateau-13116-package-2025':null;
        if(packageId) {
          const pkg=await getStoredSource(packageId),payload=await readJson<unknown>(pkg.path),result=own(payload,'result'),resources=own(result,'resources');
          const index=exactPackageAssetFolderMatch(resources,stored.record.resolved_url);
          if(index!==null) {
            const declared=packageLicence(payload);
            const r=(resources as unknown[])[index];
            const url=own(r,'url') as string;
            evidence.push(urlEvidence(packageId,pkg.record.sha256,`/result/resources/${index}/url`,url,'Exact parent package asset-folder membership for catalog-resolved child URL.'));
            for(const [quote,location] of [['公共データ利用規約（第1.0版）','HTML §3'],['コンテンツを利用する際は出典を記載してください。','HTML §3(1)①'],['編集・加工等を行ったことを記載してください。','HTML §3(1)②']]) {
              if(!text.includes(quote))throw new Error(`PLATEAU policy evidence changed: ${location}`);
              const ev=shortEvidence(policy.record.source_id,policy.record.sha256,location,quote,'PLATEAU Site Policy §3 linked by exact parent package declaration.');evidence.push(ev);
              if(quote==='公共データ利用規約（第1.0版）')declarations.push({value:'PLATEAU Site Policy §3; CC BY 4.0 compatible',status:'SITE_TERMS',evidence:ev});
            }
            if(declared.value) {
              const ev=shortEvidence(packageId,pkg.record.sha256,'/result/license_id',declared.value,'Package declaration applies at package scope only; resource rights remain unknown.');
              evidence.push(ev);declarations.push({value:declared.value,status:'PACKAGE_LEVEL_DECLARED',evidence:ev});licence={value:declared.value,status:'PACKAGE_LEVEL_DECLARED',scope:'PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE'};
            }
            const licenseUrl=own(result,'license_url');if(typeof licenseUrl==='string'&&licenseUrl) evidence.push(shortEvidence(packageId,pkg.record.sha256,'/result/license_url',licenseUrl,'Package licence link; see acquired PLATEAU Site Policy §3.'));
          } else {
            evidence.push(urlEvidence(packageId,pkg.record.sha256,'/result/resources',stored.record.resolved_url,'No exact parent resource URL/asset-folder match in this acquired snapshot; package declaration is not inherited.'));
            caveats.push(`No exact package asset-folder match in acquired ${packageId}; package-level declaration is not linked to this catalog-resolved file.`);
          }
        }
      }
      if(source.source_id.endsWith('-metadata')&&/^plateau-131(?:04|16)-metadata$/.test(source.source_id)) {
        const entries=await readZip(stored.path),xmlRights=entries.flatMap(entry=>entry.name.toLowerCase().endsWith('.xml')?embeddedMetadataRights(entry.data.toString('utf8')).map(found=>({entry,found})):[]);
        if(xmlRights.length) {
          const affirmative: Array<{value:string;evidence:RightsEvidence}>=[];
          for(const {entry,found} of xmlRights) {
            const scope=found.scope==='METADATA_RECORD_ONLY'?'METADATA_RECORD_ONLY: statement under metadataConstraints constrains the metadata record itself, not the described dataset; never a dataset licence.'
              :found.scope==='UNKNOWN'?'Metadata XML rights-field evidence outside identificationInfo/*/resourceConstraints; scope UNKNOWN. Licence UNKNOWN.'
              :found.kind!=='TEXT'?`Dataset-scoped ${found.kind==='CODED'?'coded (codeListValue)':'linked (href)'} restriction preserved as evidence; it is not a supported affirmative statement, so embedded rights are not unqualified.`
              :found.value===null?'Metadata XML rights-field evidence only; no supported unambiguous affirmative licence declaration. Licence UNKNOWN.':'FILE_EMBEDDED affirmative metadata XML declaration under identificationInfo/*/resourceConstraints for the described dataset; ZIP-wide applicability is not inferred.';
            const ev=shortEvidence(source.source_id,stored.record.sha256,`ZIP:${entry.name}:${found.path}${found.kind==='TEXT'?'':`#${found.kind}`}`,found.quote,scope);
            evidence.push(ev);
            if(found.value!==null&&found.scope==='DATASET_RESOURCE_CONSTRAINTS')affirmative.push({value:found.value,evidence:ev});
          }
          const relevant=xmlRights.filter(({found})=>found.scope!=='METADATA_RECORD_ONLY');
          if(!relevant.length) {
            fileEmbedded={value:null,status:'UNKNOWN',reason:'Only metadataConstraints (metadata-record) rights statements were found; they do not describe the dataset. Embedded dataset rights remain UNKNOWN.'};
            caveats.push('Metadata-record constraints (METADATA_RECORD_ONLY) are preserved as evidence but never promoted to a dataset licence.');
          } else if(affirmative.length===relevant.length) {
            const embeddedValue=[...new Set(affirmative.map(item=>item.value))].join('; ');
            fileEmbedded={value:embeddedValue,status:'FILE_EMBEDDED',scope:'Metadata XML rights statement under identificationInfo/*/resourceConstraints for the described dataset; no ZIP-wide or sibling-resource scope inferred.'};
            for(const item of affirmative)declarations.push({value:item.value,status:'FILE_EMBEDDED',evidence:item.evidence});
          } else {
            fileEmbedded={value:null,status:'UNKNOWN',reason:'Metadata rights fields include unsupported, ambiguous, conditional, negated or unscoped statements; exact quotes are preserved as evidence.'};
            caveats.push('Metadata XML rights-field mentions do not establish an affirmative licence; embedded rights remain UNKNOWN.');
          }
        } else caveats.push('Inspected acquired metadata XML in the metadata ZIP; no explicit affirmative rights field was found.');
      }
    }
    if(source.source_id.startsWith('mlit-walk-network-spec-')) {
      const owner=await getStoredSource('mlit-walk-network-spec-2018-03'),doc=owner.record.supporting_documents?.find(d=>d.id==='site-terms');
      if(doc){const text=htmlText(await readFile(join(getStoreRoot(),doc.store_path),'utf8'));const quote='公共データ利用規約（第1.0版）';if(!text.includes(quote))throw new Error('Recorded MLIT site terms changed');const ev=shortEvidence(owner.record.source_id,doc.sha256,'supporting_documents/site-terms: 著作権について',quote,'Site default; PDF-specific and third-party scope not inferred.');evidence.push(ev);declarations.push({value:'PDL 1.0',status:'SITE_TERMS',evidence:ev});licence={value:'PDL 1.0',status:'SITE_TERMS',scope:ev.scope};attributionRequired='YES';modificationRequired='YES';attributionText='出典：国土交通省ウェブサイト（当該ページのURL）';caveats.push('MLIT site terms exclude logos and explicit alternate terms and preserve Survey Act restrictions.');}
    }
    let observations:unknown[]=[];
    if(source.source_id.includes('related-2025')||source.source_id==='tokyo-shinjuku-facilities-zip'){
      const poi=await readJson<Record<string,unknown>>(join(docsRoot,'gis','poi',`${source.source_id}.json`));
      await assertPoiInspectionCurrent(poi,source.source_id,{fingerprint});
      observations=[{report:`docs/gis/poi/${source.source_id}.json`,source_sha256:stored.record.sha256,source_attributions:poi.source_attributions??null,rights_observations:poi.rights_observations??null}];
      caveats.push('Literal 原典/source properties and archive metadata are inventory evidence; they do not establish permission for originals.');
    }
    const inputs=new Map<string,string>([[source.source_id,stored.record.sha256]]);
    for(const e of evidence) {const actual=await getStoredSource(e.source_id);inputs.set(e.source_id,actual.record.sha256);if(e.sha256!==actual.record.sha256&&!actual.record.supporting_documents?.some(d=>d.sha256===e.sha256))throw new Error('Rights evidence hash lacks a verified acquisition');}
    const record:RightsRecord={source_id:source.source_id,source_sha256:stored.record.sha256,tool_input_sha256:fingerprint,station_ids:source.station_ids,licence,resource_licence:resourceLicence,file_embedded_licence:fileEmbedded,declarations,evidence,input_sources:[...inputs].map(([source_id,sha256])=>({source_id,sha256})),attribution:{required:attributionRequired,text_required:attributionText,proposed_text:source.attribution_text.replace('（当該リソースURL）',`（${stored.record.resolved_url}）`),status:attributionText?'SITE_EXAMPLE; verify exact resource credit':'EXACT_RESOURCE_CREDIT_UNKNOWN'},modification_notice:{required:modificationRequired,text:modificationRequired==='YES'?'State the actual edits and identify the source; do not imply official authorship.':null,status:modificationRequired==='YES'?'REQUIRED_IF_TERMS_APPLY':'UNKNOWN'},caveats,publish_gate:'HOLD',clearance_required:[`Acquired rights evidence explicitly covering ${source.source_id}, URL ${stored.record.resolved_url}, SHA-256 ${stored.record.sha256}, including the relevant member contents.`,'Resolve each third-party original and individual-law caveat, or exclude those contents.','Record required credit parties, source URL, licence link and actual modification notice for the proposed use.'],file_rights_observations:observations,verification:'UNVERIFIED',routable:false,...(publicationPeriodNotes.length?{publication_period_notes:publicationPeriodNotes}:{})};
    records.push(record);
  }
  // Range-extracted 2023 CityGML members keep their own rights records and point
  // back to the acquired package resource that supplied their exact bytes.
  const vintage=await readJson<VintageReport>(join(docsRoot,'gis','vintages','shinjuku-2023.json'));
  await assertVintageResearchCurrent(vintage,{fingerprint});
  if(!Array.isArray(vintage.selected_member_records))throw new Error('2023 vintage report has no selected_member_records array');
  if(vintage.selected_member_records.length) {
    const packageId='plateau-13104-package-2023',pkg=await getStoredSource(packageId),payload=await readJson<unknown>(pkg.path),result=own(payload,'result'),resources=own(result,'resources');
    const packageDecl=packageLicence(payload),policy=await getStoredSource('plateau-site-policy');
    const policyText=htmlText(await readFile(policy.path,'utf8'));
    const packageLicenseUrl=own(result,'license_url');
    for(const member of vintage.selected_member_records) {
      const sourceId=`vintage-member-${member.sha256.slice(0,16)}`;
      const acquisitionPath=join(docsRoot,'gis','acquisitions','vintages',`${sourceId}.json`);
      const acquisition=await readJson<any>(acquisitionPath);
      if(acquisition.source_id!==sourceId||acquisition.sha256!==member.sha256||acquisition.bytes!==member.bytes||acquisition.store_path!==member.store_path)throw new Error(`Vintage member acquisition does not match report entry ${sourceId}`);
      const archive=vintage.archives.find(item=>item.archive===member.archive);
      if(!archive||acquisition.resolved_url!==archive.url)throw new Error(`Vintage member resolved URL does not match its archive: ${sourceId}`);
      const packageSource=acquisition.package_source;
      if(packageSource?.source_id!==packageId||packageSource.sha256!==pkg.record.sha256||!vintage.input_sources.some(input=>input.source_id===packageId&&input.sha256===pkg.record.sha256))throw new Error(`Vintage member package source is stale: ${sourceId}`);
      const memberPath=join(getStoreRoot(),member.store_path);
      await assertPathWithinStore(getStoreRoot(),memberPath);await verifyStoredFile(memberPath,member.sha256,member.bytes);
      const index=exactResourceUrlIndex(resources,archive.url);
      const matches=index!==null&&packageSource.json_pointer===`/result/resources/${index}/url`?[index]:[];
      const exact=matches.length===1,evidence:RightsEvidence[]=[],declarations:RightsRecord['declarations']=[];
      let licence:RightsRecord['licence']={value:null,status:'UNKNOWN',scope:'No exact package resource URL establishes the source archive relationship.'};
      if(exact) {
        evidence.push(urlEvidence(packageId,pkg.record.sha256,`/result/resources/${matches[0]}/url`,archive.url,'Exact package resource URL for the archive containing this range-extracted member.'));
        if(packageDecl.value) {const ev=shortEvidence(packageId,pkg.record.sha256,'/result/license_id',packageDecl.value,'PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE');evidence.push(ev);declarations.push({value:packageDecl.value,status:'PACKAGE_LEVEL_DECLARED',evidence:ev});licence={value:packageDecl.value,status:'PACKAGE_LEVEL_DECLARED',scope:'PACKAGE_LEVEL_DECLARED_VIA_PARENT_RESOURCE'};}
        if(typeof packageLicenseUrl==='string'&&packageLicenseUrl)evidence.push(urlEvidence(packageId,pkg.record.sha256,'/result/license_url',packageLicenseUrl,'Package licence link points to PLATEAU Site Policy §3.'));
      }
      const policyQuote='公共データ利用規約（第1.0版）';
      if(exact&&policyText.includes(policyQuote)) {
        const ev=shortEvidence(policy.record.source_id,policy.record.sha256,'HTML §3 コンテンツの利用',policyQuote,'PLATEAU Site Policy §3 referenced by the package declaration.');
        evidence.push(ev);declarations.push({value:'PLATEAU Site Policy §3',status:'SITE_TERMS',evidence:ev});
      }
      const record:RightsRecord={source_id:sourceId,source_sha256:member.sha256,tool_input_sha256:fingerprint,station_ids:['shinjuku'],licence,resource_licence:{value:null,status:'UNKNOWN'},file_embedded_licence:{value:null,status:'UNKNOWN',reason:'No exact file-embedded declaration was established for the extracted member.'},declarations,evidence,input_sources:[{source_id:sourceId,sha256:member.sha256},{source_id:packageId,sha256:pkg.record.sha256},...(exact?[{source_id:policy.record.source_id,sha256:policy.record.sha256}]:[])],attribution:{required:'YES',text_required:'出典：国土交通省 PLATEAUウェブサイト（当該ページのURL）',proposed_text:'出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成',status:'SITE_EXAMPLE; verify exact resource credit'},modification_notice:{required:'YES',text:'State the actual edits and identify the source; do not imply official authorship.',status:'REQUIRED_IF_TERMS_APPLY'},caveats:['Rights remain package-level only; resource and extracted-member scope remains unverified.','G空間 3D city model copyright belongs to the municipality; third-party originals require separate review.',...(exact?[]:[`No exact package resource URL or pointer matched member archive ${archive.url}; licence remains UNKNOWN.`])],publish_gate:'HOLD',clearance_required:[`Confirm rights covering exact archive ${archive.url} and member ${member.member} SHA-256 ${member.sha256}.`,'Resolve third-party original and individual-law caveats.','Record required credit parties and actual modification notice.'],file_rights_observations:[],verification:'UNVERIFIED',routable:false};
      records.push(record);
    }
  }
  const register=['# Rights evidence register','','Generated only from integrity-checked acquisitions. A package declaration, site default and file-embedded rights are different scopes. Every exact-resource publish gate remains HOLD. Legacy manifest labels are preserved as historical inputs, not clearance.','','| Source | Licence observation | Scope | Resource licence | File-embedded rights | File-embedded scope | Publish gate |','| --- | --- | --- | --- | --- | --- | --- |',...records.map(r=>`| [${r.source_id}](${r.source_id}.json) | ${r.licence.value??'UNKNOWN'} | ${r.licence.scope} (${r.licence.status}) | ${r.resource_licence.value??'UNKNOWN'} (${r.resource_licence.status}) | ${r.file_embedded_licence.value??'UNKNOWN'} (${r.file_embedded_licence.status}) | ${r.file_embedded_licence.scope??r.file_embedded_licence.reason??'Not established'} | HOLD |`),'','All candidates are UNVERIFIED / routable:false. See each record for hashed evidence, obligations, caveats and exact clearance requirements.',''].join('\n');
  // Research reads/validation are part of preparation, before any output mutation.
  const research=await (await import('./poi-research.js')).buildPoiResearch(records);
  const files:ReportFile[]=records.map(record=>({path:join(out,`${record.source_id}.json`),content:`${JSON.stringify(record,null,2)}\n`}));
  files.push({path:join(out,'README.md'),content:register},research);
  // Hash-named vintage records from prior acquisitions must not remain active.
  // Archive exact bytes and retire them in the same rollback-capable transaction.
  const currentMembers=new Set(records.filter(record=>record.source_id.startsWith('vintage-member-')).map(record=>`${record.source_id}.json`));
  for(const directory of ['rights','acquisitions/vintages']) {
    const active=join(docsRoot,'gis',directory);
    let names:string[];
    try {names=await readdir(active);}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;names=[];}
    for(const name of names.sort()) {
      if(!/^vintage-member-[a-f0-9]{16}\.json$/.test(name)||currentMembers.has(name))continue;
      const obsolete=join(active,name),content=await readFile(obsolete,'utf8');
      const hash=createHash('sha256').update(content).digest('hex');
      files.push({path:join(docsRoot,'gis','history',directory,`${hash}-${name}`),content},{path:obsolete,content:null});
    }
  }
  // Include receipt invalidation in the same transaction; failed rights never changes it.
  if(process.env.GTEKI_GIS_REAL_RUN!=='1') {
    const path=join(docsRoot,'gis','real-run.json');
    let bytes:string|undefined;
    try {bytes=await readFile(path,'utf8');} catch(error) {if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    if(bytes!==undefined) {
      const receipt=JSON.parse(bytes);
      receipt.invalidated={at:new Date().toISOString(),by_command:'gis rights',reason:'Report-writing command run outside real-run; rerun real-run before summarizing'};
      files.push({path,content:`${JSON.stringify(receipt,null,2)}\n`});
    }
  }
  await commitReportFiles(files,join(docsRoot,'gis'));
  return records;
}
