import { describe,it,expect } from 'vitest';
import { matchAcquiredResource, embeddedMetadataRights, classifyMetadataRightsScope, exactPackageAssetFolderMatch, exactResourceUrlIndex, findPublicationPeriodNotes, findTextValue, htmlText, packageLicence, shortEvidence, urlEvidence } from '../src/rights.js';
describe('rights evidence scope',()=>{
  it('retains package scope without inventing resource coverage',()=>{
    expect(packageLicence({success:true,result:{license_id:'CC-BY-4.0',resources:[{url:'https://example.invalid/a'}]}}).value).toBe('CC-BY-4.0');
    expect(packageLicence({success:true,result:Object.create({license_id:'inherited'})}).value).toBeNull();
    expect(()=>packageLicence({success:true})).toThrow('Invalid CKAN');
  });
  it('bounds quotes and validates exact evidence hashes',()=>{
    expect(shortEvidence('source','a'.repeat(64),'/result/license_id','CC-BY-4.0','Package').scope).toBe('Package');
    expect(()=>shortEvidence('source','a'.repeat(64),'/',Array(16).fill('word').join(' '),'Package')).toThrow();
    expect(()=>shortEvidence('source','bad','/','PDL','Site')).toThrow();
  });
  it('removes scripts and styles before inspecting site content',()=>{
    expect(htmlText('<script>CC-BY-4.0</script><style>MIT</style><p>公共データ利用規約（第1.0版）</p>')).toBe('公共データ利用規約（第1.0版）');
  });
  it('matches a catalog file only under the exact acquired package asset folder',()=>{
    const resources=[{url:'https://assets.example/assets/84/48ebed/13104_shinjuku_2025_citygml_1_op.zip'}];
    expect(exactPackageAssetFolderMatch(resources,'https://assets.example/assets/84/48ebed/13104_shinjuku_2025_citygml_1_op/udx/ubld/a.gml')).toBe(0);
    expect(exactPackageAssetFolderMatch(resources,resources[0]!.url)).toBe(0);
    expect(exactPackageAssetFolderMatch(resources,'https://assets.example/assets/cc/48ebed/13104_shinjuku_2025_citygml_1_op/udx/ubld/a.gml')).toBeNull();
    expect(exactPackageAssetFolderMatch(resources,'https://assets.example/assets/84/48ebed/13104_shinjuku_2025_citygml_1_op_other/udx/ubld/a.gml')).toBeNull();
    expect(exactPackageAssetFolderMatch([...resources,...resources],'https://assets.example/assets/84/48ebed/13104_shinjuku_2025_citygml_1_op/udx/a.gml')).toBeNull();
  });
  it('requires unique exact CKAN resource membership and preserves the metadata pointer',()=>{
    const url='https://ckan.example/resource/data.zip';
    expect(exactResourceUrlIndex([{url}],url)).toBe(0);
    expect(exactResourceUrlIndex([{url:'https://other.example/data.zip'}],url)).toBeNull();
    expect(exactResourceUrlIndex([{url},{url}],url)).toBeNull();
    expect(findTextValue({result:{notes:'Available through 2027-03-12'}},/2027-03-12/)?.pointer).toBe('/result/notes');
    expect(findPublicationPeriodNotes({result:{notes:'公開期間は2027年3月12日まで',extras:[{key:'publication_period',value:'令和9年3月12日まで'}]}})).toEqual([
      {pointer:'/result/notes',text:'公開期間は2027年3月12日まで'},
      {pointer:'/result/extras/0/value',text:'令和9年3月12日まで'},
    ]);
    expect(urlEvidence('package','a'.repeat(64),'/resources/0/url','https://example.invalid/very-long/'.concat('x'.repeat(220)),'Exact URL')).toMatchObject({exact_url:'https://example.invalid/very-long/'.concat('x'.repeat(220))});
  });
  const NS='http://zgate.gsi.go.jp/ch/jmp/';
  const datasetPath=`{${NS}}MD_Metadata/{${NS}}identificationInfo/{${NS}}MD_DataIdentification/{${NS}}resourceConstraints/{${NS}}MD_Constraints/{${NS}}useLimitation`;
  /** Real PLATEAU shape: default namespace, identificationInfo/MD_DataIdentification/resourceConstraints/MD_Constraints/<element>. */
  const dataset=(element:string,text:string)=>`<MD_Metadata xmlns="${NS}"><identificationInfo><MD_DataIdentification><resourceConstraints><MD_Constraints><${element}>${text}</${element}></MD_Constraints></resourceConstraints></MD_DataIdentification></identificationInfo></MD_Metadata>`;
  const metadataRecord=(text:string)=>`<MD_Metadata xmlns="${NS}"><metadataConstraints><MD_LegalConstraints><useLimitation>${text}</useLimitation></MD_LegalConstraints></metadataConstraints></MD_Metadata>`;
  it('records only explicit metadata XML rights and leaves absent rights unknown',()=>{
    expect(embeddedMetadataRights(dataset('useLimitation','Licensed under CC BY 4.0'))).toEqual([{value:'CC BY 4.0',quote:'Licensed under CC BY 4.0',element:'useLimitation',path:datasetPath,scope:'DATASET_RESOURCE_CONSTRAINTS'}]);
    expect(embeddedMetadataRights(dataset('useLimitation','See the publisher'))).toEqual([expect.objectContaining({value:null,quote:'See the publisher',element:'useLimitation'})]);
    expect(embeddedMetadataRights(dataset('useLimitation','Not licensed under CC BY 4.0'))).toEqual([expect.objectContaining({value:null,quote:'Not licensed under CC BY 4.0'})]);
    expect(embeddedMetadataRights(dataset('abstract','CC BY 4.0'))).toEqual([]);
    expect(()=>embeddedMetadataRights('<!DOCTYPE x [<!ENTITY e "x">]><x/>')).toThrow('DOCTYPE');
  });
  it('preserves ancestor scope: metadataConstraints are metadata-record only, unscoped statements are UNKNOWN',()=>{
    // Regression: a grant under metadataConstraints was reported as a dataset declaration.
    const [record]=embeddedMetadataRights(metadataRecord('Licensed under CC BY 4.0'));
    expect(record).toMatchObject({value:'CC BY 4.0',scope:'METADATA_RECORD_ONLY',path:`{${NS}}MD_Metadata/{${NS}}metadataConstraints/{${NS}}MD_LegalConstraints/{${NS}}useLimitation`});
    expect(embeddedMetadataRights('<useLimitation>Licensed under CC BY 4.0</useLimitation>')[0]).toMatchObject({scope:'UNKNOWN',path:'useLimitation'});
    expect(embeddedMetadataRights(`<MD_Metadata xmlns="${NS}"><distributionInfo><useLimitation>Licensed under CC BY 4.0</useLimitation></distributionInfo></MD_Metadata>`)[0]!.scope).toBe('UNKNOWN');
    // Mixed namespaces along the chain and chains containing both constraint kinds fail closed.
    expect(embeddedMetadataRights(`<MD_Metadata xmlns="${NS}" xmlns:o="urn:other"><identificationInfo><MD_DataIdentification><o:resourceConstraints><o:MD_Constraints><o:useLimitation>Licensed under CC BY 4.0</o:useLimitation></o:MD_Constraints></o:resourceConstraints></MD_DataIdentification></identificationInfo></MD_Metadata>`)[0]!.scope).toBe('UNKNOWN');
    expect(classifyMetadataRightsScope(['MD_Metadata','metadataConstraints','resourceConstraints','MD_Constraints','useLimitation'].map(local=>({uri:'u',local})))).toBe('UNKNOWN');
  });
  it.each([
    'CC BY 4.0', 'PDL 1.0', 'CC BY 4.0 does not apply.', 'CC BY 4.0 は適用されません。',
    'CC BY 4.0 を除く。', 'CC BY 4.0 ではありません。',
    'If approved, licensed under CC BY 4.0.', 'CC BY 4.0 may apply.',
    'Licensed under CC BY 4.0 except third-party content.',
    'CC BY 4.0 の適用には許諾が必要です。', 'Copyright reserved.',
  ])('preserves ambiguous or negated metadata as UNKNOWN evidence: %s',text=>{
    expect(embeddedMetadataRights(dataset('useLimitation',text))).toEqual([expect.objectContaining({value:null,quote:text,element:'useLimitation'})]);
  });
  it.each(['Licensed under CC BY 4.0','This dataset is licensed under CC BY 4.0.','本データはCC BY 4.0に基づき提供されています。'])('recognizes only supported complete affirmative metadata declarations: %s',text=>{
    expect(embeddedMetadataRights(dataset('useLimitation',text))).toEqual([expect.objectContaining({value:'CC BY 4.0',quote:text,scope:'DATASET_RESOURCE_CONSTRAINTS'})]);
  });
  it('rejects unverified pre-redirect matches and genuine ambiguity without filename inference',()=>{
    const requested='https://example.invalid/original.zip',final='https://example.invalid/final-download';
    const source={source_id:'s03',expected_url:requested} as any,parent={source_id:'package',sha256:'a'.repeat(64)};
    const evidence={...parent,json_pointer:'/result/resources/0/url'};
    expect(matchAcquiredResource([{url:final}],{resolved_url:final},source,parent)).toEqual({index:0,field:'resolved_url',url:final});
    expect(matchAcquiredResource([{url:requested}],{resolved_url:final,resolution_evidence:evidence},source,parent)).toEqual({index:0,field:'expected_url',url:requested});
    for(const bad of [undefined,{...evidence,sha256:'b'.repeat(64)},{...evidence,json_pointer:'/result/resources/1/url'}]) {
      expect(()=>matchAcquiredResource([{url:requested}],{resolved_url:final,resolution_evidence:bad},source,parent)).toThrow('Unverified pre-redirect');
    }
    expect(()=>matchAcquiredResource([{url:requested},{url:final}],{resolved_url:final,resolution_evidence:evidence},source,parent)).toThrow('2 exact resource URL matches');
    expect(()=>matchAcquiredResource([{url:'https://different.example/original.zip'}],{resolved_url:final,resolution_evidence:evidence},source,parent)).toThrow('0 exact resource URL matches');
    expect(()=>matchAcquiredResource([Object.create({url:final})],{resolved_url:final},source,parent)).toThrow('0 exact resource URL matches');
  });
  it('treats the hashed resolution pointer as authoritative over a conflicting final-URL match',()=>{
    const old='https://example.invalid/old.zip',zero='https://example.invalid/resource-0.zip',one='https://example.invalid/resource-1.zip';
    const source={source_id:'s03',expected_url:old} as any,parent={source_id:'package',sha256:'a'.repeat(64)};
    const toZero={...parent,json_pointer:'/result/resources/0/url'};
    // Resolver chose resource 0, the download redirected to resource 1's URL.
    expect(()=>matchAcquiredResource([{url:zero},{url:one}],{resolved_url:one,resolution_evidence:toZero},source,parent)).toThrow('conflicts with hashed resolution pointer');
    // Agreeing pointer and final URL stay accepted; no pointer keeps the resolved_url behaviour.
    expect(matchAcquiredResource([{url:zero},{url:one}],{resolved_url:zero,resolution_evidence:toZero},source,parent)).toEqual({index:0,field:'resolved_url',url:zero});
    expect(matchAcquiredResource([{url:zero},{url:one}],{resolved_url:one},source,parent)).toEqual({index:1,field:'resolved_url',url:one});
    // A pointer into a different or re-hashed catalog snapshot is also a conflict.
    expect(()=>matchAcquiredResource([{url:zero}],{resolved_url:zero,resolution_evidence:{...toZero,sha256:'b'.repeat(64)}},source,parent)).toThrow('conflicts with hashed resolution pointer');
  });

});
