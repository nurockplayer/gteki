import * as T from '../../packages/godot/node_modules/three/build/three.module.js';
/** Same camera report + next-frame update as the app's draw-nothing viewer probe. */
export function reportViewer(scene:any,camera:T.Camera) {
 const probe=scene.root.getObjectByName('viewer probe (draws nothing)') as T.Mesh;
 // Before kit LOD was introduced, scenes did not install a viewer probe.
 probe?.onBeforeRender(undefined as never,undefined as never,camera,undefined as never,undefined as never,undefined as never);
 scene.update?.(0,0);scene.root.updateMatrixWorld(true);
 const ids:string[]=[];scene.root.traverseVisible((o:any)=>{if(o.isMesh)ids.push(`${o.id}:${o.isInstancedMesh?o.count:1}`);});
 return ids.join(',');
}
