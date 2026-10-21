import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { packageRoot,getStoredSource } from './common.js';
import { decimalNumber,literalIdentifier,literalText,ownValue } from './values.js';

type Label={label:string|null;transcription_check:string;reason?:string};
type Field={spec_source_id:string;spec_sha256:string;table:string;printed_page:number;codes:Record<string,Label>;encoding?:string;numeric_rule?:unknown};
type RankComponent='width'|'vtcl_slope'|'lev_diff';
type RankState='consistent'|'inconsistent'|'not_checkable'|'method_unknown';
type RankReading={code_to_letters:Record<string,Record<string,string[]>>;not_checkable_letters:Record<string,string[]>};
export type Codebook={version:string;spec_source_id:string;spec_sha256:string;status:string;node:Record<string,Field>;link:Record<string,Field>;rank_cross_check?:{method_digit_order:RankComponent[];method_rules:Record<string,RankReading>;note:string}};
export const codebooks:Codebook[]=['2018-03','2024-07'].map(version=>JSON.parse(readFileSync(join(packageRoot,'codebooks',`mlit-walk-network-${version}.json`),'utf8')) as Codebook);
export async function codebookInputs():Promise<Array<{source_id:string;sha256:string}>> {
  return Promise.all(codebooks.map(async book=>{const source=await getStoredSource(book.spec_source_id);if(source.record.sha256!==book.spec_sha256)throw new Error(`Codebook specification hash mismatch: ${book.version}`);return {source_id:book.spec_source_id,sha256:book.spec_sha256};}));
}
type Row=Record<string,unknown>;
const blank=(v:unknown)=>v==null||typeof v==='string'&&v.trim()==='';
const literal=(v:unknown)=>literalText(v)??(blank(v)?'(blank)':'(unavailable)');
const counts=(values:string[])=>Object.fromEntries([...new Set(values)].sort().map(value=>[value,values.filter(v=>v===value).length]));
function codeLabel(field:Field,value:string):Label|undefined {
  const entry=ownValue(field.codes,value);
  return entry&&typeof entry==='object'&&!Array.isArray(entry)&&Object.hasOwn(entry,'label')&&(entry.label===null||typeof entry.label==='string')?entry:undefined;
}
function rankLetters(value:unknown):string[]|undefined {
  return Array.isArray(value)&&value.length>0&&value.every(letter=>typeof letter==='string'&&/^[SABCZX]$/.test(letter))?value:undefined;
}
function defined(field:Field|undefined,value:string):boolean {
  if(!field)return false;
  switch(field.encoding){
    case 'numeric_floor':return /^-?\d+(?:\.\d+)?$/.test(value)&&Number.isFinite(Number(value))&&Math.abs(Number(value)*10-Math.round(Number(value)*10))<1e-8;
    case 'rank_triplet':return /^[SACZX][SABCZX]{2}$/.test(value);
    case 'method_triplet':return /^[12]{3}$/.test(value);
    case 'weekday_digits':return value==='99'||/^[1-7]+$/.test(value)&&[...value].every((v,i)=>i===0||v>value[i-1]!);
    default:return codeLabel(field,value)!==undefined;
  }
}
function label(field:Field,value:string):string|null {
  if(field.encoding==='numeric_floor')return '階層数';
  if(field.encoding==='rank_triplet')return [...value].join(' / ');
  if(field.encoding==='method_triplet'||field.encoding==='weekday_digits'&&value!=='99'){const labels=[...value].map(v=>codeLabel(field,v)?.label??null);return labels.every(v=>v!==null)?labels.join(' / '):null;}
  return codeLabel(field,value)?.label??null;
}
export function rankCrossCheck(links:Row[]) {
  const book=codebooks.find(b=>b.version==='2024-07')!.rank_cross_check!;
  const counters=()=>({consistent:0,inconsistent:0,not_checkable:0,method_unknown:0,
    inconsistent_link_ids:[] as string[],inconsistent_link_ids_truncated:0,inconsistent_link_ids_unavailable:0,
    not_checkable_link_ids:[] as string[],not_checkable_link_ids_truncated:0,not_checkable_link_ids_unavailable:0});
  const result={spec_version:'2024-07',...counters(),component_counts:Object.fromEntries(book.method_digit_order.map(f=>[f,counters()])),
    link_state_precedence:['not_checkable','inconsistent','method_unknown','consistent'],link_id_limit:100,note:book.note};
  const record=(target:ReturnType<typeof counters>,state:RankState,row:Row)=>{
    target[state]++;
    if(state!=='inconsistent'&&state!=='not_checkable')return;
    const id=literalIdentifier(ownValue(row,'link_id'));
    if(id===null)target[`${state}_link_ids_unavailable`]++;
    else if(target[`${state}_link_ids`].length<result.link_id_limit)target[`${state}_link_ids`].push(id);
    else target[`${state}_link_ids_truncated`]++;
  };
  for(const row of links){
    const rank=literalText(ownValue(row,'rank'))??'',method=literalText(ownValue(row,'r_method'))??'';
    const states=book.method_digit_order.map((field,i):RankState=>{
      const code=literalText(ownValue(row,field));
      // Each digit is independent: an absent/other digit never supplies another component's method.
      const digit=method[i],knownMethod=digit==='1'||digit==='2';
      const readings=(knownMethod?[digit]:['1','2']).map(d=>ownValue(book.method_rules,d));
      const sets=readings.map(reading=>code===null?undefined:rankLetters(ownValue(ownValue(reading?.code_to_letters,field),code)));
      const expected=sets.some(set=>set!==undefined)?[...new Set(sets.flatMap(set=>set??[]))]:undefined;
      const undefinedReading=knownMethod&&rankLetters(ownValue(readings[0]?.not_checkable_letters,field))?.includes(rank[i]!);
      const state:RankState=!expected||undefinedReading||!defined(ownValue(codebooks[1]!.link,'rank'),rank)?'not_checkable':
        !expected.includes(rank[i]!)?'inconsistent':knownMethod?'consistent':'method_unknown';
      record(result.component_counts[field]!,state,row);return state;
    });
    // A fully comparable triplet is needed for a link-level judgement; partial evidence stays partial.
    record(result,states.includes('not_checkable')?'not_checkable':states.includes('inconsistent')?'inconsistent':states.includes('method_unknown')?'method_unknown':'consistent',row);
  }
  return result;
}
export function literalCooccurrences(nodes:Row[],links:Row[]) {
  const byId=new Map<string,Row[]>();
  for(const node of nodes){const id=literalIdentifier(ownValue(node,'node_id'));if(id===null)continue;byId.set(id,[...(byId.get(id)??[]),node]);}
  const floor=(value:unknown)=>{const id=literalIdentifier(value),rows=id===null?undefined:byId.get(id);return rows?.length===1?literalText(ownValue(rows[0]!,'floor'))??'(unknown)':'(unknown)';};
  const nonzero=nodes.filter(n=>{const value=decimalNumber(ownValue(n,'floor'));return value!==null&&value!==0;});
  const tuples=links.filter(l=>['5','7'].includes(literalText(ownValue(l,'rt_struct'))??'')).map(l=>JSON.stringify({rt_struct:literalText(ownValue(l,'rt_struct')),start_floor:floor(ownValue(l,'start_id')??ownValue(l,'start_node_id')),end_floor:floor(ownValue(l,'end_id')??ownValue(l,'end_node_id'))}));
  return {nonzero_floor_nodes:nonzero.length,nonzero_floor_nodes_by_in_out:counts(nonzero.map(n=>literal(ownValue(n,'in_out')))),unknown_floor_nodes:nodes.filter(n=>decimalNumber(ownValue(n,'floor'))===null).length,rt_struct_5_7_by_endpoint_floors:Object.entries(counts(tuples)).map(([tuple,count])=>({...JSON.parse(tuple),count})),note:'Literal co-occurrence counts only; missing or duplicate endpoint identifiers have unknown floor. No floor equivalence or connectivity is inferred.'};
}
export function attributeDecoding(nodes:Row[],links:Row[]) {
  const roles={node:nodes,link:links};
  const fields:Record<string,any>={node:{},link:{}};
  for(const role of ['node','link'] as const){
    const names=[...new Set(codebooks.flatMap(book=>Object.keys(book[role])))].sort();
    for(const name of names){
      if(!roles[role].some(row=>Object.hasOwn(row,name)))continue;
      const values=roles[role].map(row=>ownValue(row,name)).filter(value=>!blank(value)).map(literal);
      fields[role][name]={literal_value_distribution:counts(roles[role].map(row=>literal(ownValue(row,name)))),present:roles[role].some(row=>Object.hasOwn(row,name)),versions:Object.fromEntries(codebooks.map(book=>{
        const field=ownValue(book[role],name),undefinedCodes=[...new Set(values.filter(value=>!defined(field,value)))].sort();
        const decoded=field?values.filter(value=>defined(field,value)).map(value=>label(field,value)):[];
        return [book.version,{compatible:undefinedCodes.length===0,defined_in_spec:!!field,undefined_codes:undefinedCodes,decoded_label_counts:counts(decoded.filter((v):v is string=>v!==null)),defined_codes_without_label_count:decoded.filter(v=>v===null).length,...(field?{evidence:{spec_source_id:field.spec_source_id,spec_sha256:field.spec_sha256,table:field.table,printed_page:field.printed_page},status:`DECODED_UNDER_SPEC_${book.version}`}:{})}];
      }))};
    }
  }
  const compatibility=Object.fromEntries(codebooks.map(book=>{const incompatible=Object.entries(fields).flatMap(([role,fs])=>Object.entries(fs).filter(([,v]:[string,any])=>!v.versions[book.version].compatible).map(([field])=>`${role}.${field}`));return [book.version,{compatible:incompatible.length===0,incompatible_fields:incompatible}];}));
  return {status:'LITERAL_LABEL_LOOKUP_ONLY',fields,spec_version_compatibility:compatibility,applicable_spec_version:{value:null,status:'UNKNOWN',candidates:codebooks.filter(book=>compatibility[book.version]!.compatible).map(book=>book.version),note:'Compatibility checks observed non-blank coded values only, not schema completeness, provenance, currency or truth on the ground. CKAN date and specification citation do not establish an applicable version.'},rank_cross_check_2024:rankCrossCheck(links),literal_cooccurrences:literalCooccurrences(nodes,links)};
}
