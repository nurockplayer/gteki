import { describe,it,expect } from 'vitest';
import { matchAcquiredResource, embeddedMetadataRights, exactPackageAssetFolderMatch, exactResourceUrlIndex, findPublicationPeriodNotes, findTextValue, htmlText, packageLicence, shortEvidence, urlEvidence } from '../src/rights.js';
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
  it('records only explicit metadata XML rights and leaves absent rights unknown',()=>{
    const xml=(element:string,text:string)=>`<gmd:${element} xmlns:gmd="http://www.isotc211.org/2005/gmd">${text}</gmd:${element}>`;
    expect(embeddedMetadataRights(xml('useLimitation','Licensed under CC BY 4.0'))).toEqual([{value:'CC BY 4.0',quote:'Licensed under CC BY 4.0',element:'useLimitation'}]);
    expect(embeddedMetadataRights(xml('useLimitation','See the publisher'))).toEqual([]);
    expect(embeddedMetadataRights(xml('useLimitation','Not licensed under CC BY 4.0'))).toEqual([]);
    expect(embeddedMetadataRights(xml('abstract','CC BY 4.0'))).toEqual([]);
    expect(()=>embeddedMetadataRights('<!DOCTYPE x [<!ENTITY e "x">]><x/>')).toThrow('DOCTYPE');
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

});
