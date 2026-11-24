// Source-backed exterior geometry, 2026-11-22 JST. Run with pnpm exec tsx.
import { createRequire } from 'node:module';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { buildContextGlb } from '../../../tools/gis/src/context.ts';
const require = createRequire(new URL('../../../tools/gis/package.json', import.meta.url));
const { Document, NodeIO } = require('@gltf-transform/core');
const readJson = async (p) => JSON.parse(await readFile(p, 'utf8'));
const root = new URL('../../../', import.meta.url).pathname;
const highReceipt = 'context-ikebukuro-r250-x120-ikebukuro-station-enu-v0-high-tiles380-015891c342423501b9d1';
const lowReceipt = 'context-ikebukuro-r250-x120-ikebukuro-station-enu-v0-low-tiles380-daebc9ca51cbeea3c90a';
const high = await readJson(join(root, 'docs/gis/context', highReceipt + '.json'));
const low = await readJson(join(root, 'docs/gis/context', lowReceipt + '.json'));
const acquisition = await readJson(join(root, 'docs/gis/acquisitions/plateau-13116-bldg-53394577.json'));
const sourcePath = join(homedir(), '.gteki/gis-store', acquisition.store_path);
if (createHash('sha256').update(await readFile(sourcePath)).digest('hex') !== acquisition.sha256) throw Error('PLATEAU source hash mismatch');
const skylinePath = join(homedir(), '.gteki/gis-store/out/depato-sunshine-2026-11.glb');
const skyline = await buildContextGlb({ frame: high.frame, radiusM: 1100, inputs: [{ sourceId: acquisition.source_id, sourceSha256: acquisition.sha256, kind: 'bldg', path: sourcePath, attributionText: high.attribution_text }], outputPath: skylinePath, merge: { mode: 'kind' }, variant: 'high', kinds: ['bldg'] });
const io = new NodeIO();
const near = await io.read(join(root, 'stations/ikebukuro/gteki/assets/ikebukuro_context_high.glb'));
const far = await io.read(skylinePath);
const output = new Document(), scene = output.createScene('landmarks-next'), buffer = output.createBuffer();
const east = 'bldg_b42ec24e-73aa-4359-893c-3c1662d7d8b2';
const west = 'bldg_fb241b42-14ae-4785-bb97-134d2714d3a3';
const pparco = 'bldg_e4d518a9-7b83-49f1-8970-af38da31ecb8';
const esola = 'bldg_24c06550-4a51-4a0e-9fa0-1401ebd17b32';
const sunshine = ['bldg_ac8d4b0e-6f5b-4caf-b9c8-9af3a82685ac', 'bldg_cdf8cbf9-0191-4792-ba8b-e63090cddedd'];
const groups = new Map(['seibu', 'parco', 'pparco', 'tobu', 'lumine', 'esola', 'sunshine'].map(id => [id, []]));
function extract(doc, row, classify) {
  const node = doc.getRoot().listNodes().find(n => n.getName() === row.mesh);
  const primitive = node.getMesh().listPrimitives()[0], positions = primitive.getAttribute('POSITION'), indices = primitive.getIndices();
  const matrix = node.getWorldMatrix();
  for (let t = row.tri_start; t < row.tri_start + row.tri_count; t++) {
    const triangle = [];
    for (let k = 0; k < 3; k++) {
      const v = positions.getElement(indices.getScalar(t * 3 + k), []);
      triangle.push(matrix[0]*v[0]+matrix[4]*v[1]+matrix[8]*v[2]+matrix[12], matrix[1]*v[0]+matrix[5]*v[1]+matrix[9]*v[2]+matrix[13], matrix[2]*v[0]+matrix[6]*v[1]+matrix[10]*v[2]+matrix[14]);
    }
    groups.get(classify(triangle)).push(...triangle);
  }
}
const nearRows = high.feature_table.rows.filter(r => [east, west, esola, pparco].includes(r[0]));
for (const r of nearRows) extract(near, {mesh:r[3],tri_start:r[4],tri_count:r[5]}, tri => r[0] === pparco ? 'pparco' : r[0] === esola ? 'esola' : r[0] === east ? (-(tri[2]+tri[5]+tri[8])/3 > 65 ? 'parco' : 'seibu') : (-(tri[2]+tri[5]+tri[8])/3 < -70 ? 'lumine' : 'tobu'));
for (const r of skyline.per_feature.filter(r => sunshine.includes(r.gml_id))) extract(far, r, () => 'sunshine');
const bounds = {};
for (const [id, vertices] of groups) {
  if (!vertices.length) throw Error(`No geometry for ${id}`);
  const pos = output.createAccessor().setBuffer(buffer).setType('VEC3').setArray(new Float32Array(vertices));
  const primitive = output.createPrimitive().setAttribute('POSITION', pos);
  const mesh = output.createMesh(id).addPrimitive(primitive);
  scene.addChild(output.createNode(id).setMesh(mesh).setExtras({gteki_role:'context',visual_only:true,navigation_use:'NOT_FOR_ROUTING',attribution_text:high.attribution_text,lod:'LOD2'}));
  bounds[id] = {min:pos.getMin([]),max:pos.getMax([]),triangles:vertices.length/9};
}
const path = join(root, 'stations/ikebukuro/gteki/assets/ikebukuro_landmarks_next.glb');
await io.write(path, output);
const ranges = receipt => receipt.feature_table.rows.filter(r => [east,west,esola,pparco].includes(r[0])).map(r => ({mesh:r[3],start:r[4],count:r[5]}));
await writeFile(join(root,'stations/ikebukuro/scene/landmark-ranges.json'), JSON.stringify({low:ranges(low),high:ranges(high)}, null, 2)+'\n');
const receipt = { recordedAt:'2026-11-22 JST', sourceIds:[...high.sources.filter(s=>s.kind==='bldg').map(s=>({id:s.source_id,sha256:s.source_sha256})),{id:acquisition.source_id,sha256:acquisition.sha256}], sourceAcquisition:'docs/gis/acquisitions/plateau-13116-bldg-53394577.json', acquisition:'Reused existing acquired PLATEAU source; no new download', frame:high.frame.frame_id, heightBasis:'Published EPSG:6697 TP heights, unchanged', lod:'LOD2', selectedBuildings:{east,west,esola,pparco,sunshine}, split:'Shared east feature: north of ENU N=65 m PARCO, remainder Seibu. Shared west feature: south of N=-70 m Lumine, remainder Tobu. Triangle-centroid material partition only; no geometry moved.', bounds, attribution:high.attribution_text, license:'CC BY 4.0', output:'stations/ikebukuro/gteki/assets/ikebukuro_landmarks_next.glb', outputSha256:createHash('sha256').update(await readFile(path)).digest('hex'), navigationUse:'NOT_FOR_ROUTING' };
await writeFile(join(root,'docs/gis/context/ikebukuro-landmarks-next.json'),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify({output:path,bounds}));
