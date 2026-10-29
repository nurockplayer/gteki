import type * as THREE from "three";

type Source="plateau"|"kit"|"merchant"|"procedural"|"greybox"|"boundary"|"shopfront"|"unknown";
/** Classify explicit object and ancestor tags or names; untagged assets remain unknown. */
export function objectSource(object:THREE.Object3D):Source {
  const names:string[]=[]; let o:THREE.Object3D|null=object;
  while(o) { if(o.userData.greybox) return "greybox"; names.push(o.name,JSON.stringify(o.userData.gtekiAsset ?? ""),String(o.userData.gteki_bundle ?? ""),String(o.userData.gteki_role ?? "")); o=o.parent; }
  // Ikebukuro tags its PLATEAU meshes with gteki_role; its synthetic blockers carry derived roles.
  const role=String(object.userData.gteki_role ?? "");
  if (role==="portal_beyond") return "boundary";
  if (role==="doors_solid" || role==="windows_solid") return "shopfront";
  if (["wall","barriers","transport","ceiling","floor","stairs_ramps"].includes(role)) return "plateau";
  const text=names.join(" ").toLowerCase();
  if (/merchant|tenant|shopkit|shop[-_ ]?kit/.test(text)) return "merchant";
  if (/plateau|3d[-_ ]?tiles|citygml/.test(text)) return "plateau";
  if (/gteki[-_ ]?kit|kit[-_ /]|kitbundle|kit_swap/.test(text)) return "kit";
  if (/wall collider|ceiling collider|walk proxies|walk_bridges|procedural/.test(text)) return "procedural";
  return "unknown";
}

export function objectNames(object:THREE.Object3D) {
  const parents:string[]=[]; for(let p=object.parent;p;p=p.parent) parents.push(p.name || "");
  return {name:object.name || "",role:String(object.userData.gteki_role ?? ""),parents,source:objectSource(object)};
}
