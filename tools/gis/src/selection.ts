import { isCitySemantic, type CityInventory } from './citygml.js';
export function smallestRoom(inventory:CityInventory){
  const children=new Map<string,string[]>();for(const f of inventory.features)if(f.parent_object_key)children.set(f.parent_object_key,[...(children.get(f.parent_object_key)??[]),f.object_key]);
  const byKey=new Map(inventory.features.map(f=>[f.object_key,f]));
  return inventory.features.filter(f=>f.local_type==='Room'&&f.gml_id!==null&&isCitySemantic(f)).map(room=>{
    const definitionIds=new Set<string>();let anonymousInlineDefinitions=0;const stack=[room.object_key],seen=new Set<string>();
    while(stack.length){const key=stack.pop()!;if(seen.has(key))continue;seen.add(key);const feature=byKey.get(key);if(!feature)continue;
      for(const id of feature.polygon_definition_ids)definitionIds.add(id);
      anonymousInlineDefinitions+=Math.max(0,feature.inline_definition_count-feature.inline_polygon_definition_ids.length);
      stack.push(...children.get(key)??[]);
    }
    return {gml_id:room.gml_id!,subtree_polygon_count:definitionIds.size+anonymousInlineDefinitions,selection_rule:'Smallest positive Room subtree by unique source polygon definition IDs plus unidentified inline definitions; repeated XLink uses of one definition count once; ID tie-break'};
  }).filter(r=>r.subtree_polygon_count>0).sort((a,b)=>a.subtree_polygon_count-b.subtree_polygon_count||(a.gml_id<b.gml_id?-1:a.gml_id>b.gml_id?1:0))[0];
}
