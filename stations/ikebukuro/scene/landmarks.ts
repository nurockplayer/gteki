// Phase-one exterior landmarks, 2026-11-22 JST. Only built for ctx.previewNext.
import type * as Three from "three";
import type { SceneContext } from "@gteki/scene-api";
import { createContextMaterial } from "./context.ts";
import { LANDMARK_FACADE, LANDMARK_FLOOR_JOINT_M, LANDMARK_PIER_SPACING_M, LANDMARK_STREET_BAND, LANDMARK_SIGN, LANDMARK_MAX_TEXTURE_PX } from "./landmark-style.ts";
import ranges from "./landmark-ranges.json";

const stores = [
  { id: "seibu", ja: "西武", en: "SEIBU", facade: "F1_stoneBeige", exit: "x38", target: [70, 62, 60], cap: LANDMARK_SIGN.maxJaLetterM / 2 },
  { id: "tobu", ja: "東武", en: "TOBU", facade: "F2_warmGrey", exit: "x17", target: [-110, 81, -75], cap: LANDMARK_SIGN.maxJaLetterM / 2 },
  { id: "lumine", ja: "ルミネ池袋", en: "LUMINE IKEBUKURO", facade: "F2_warmGrey", exit: "x4f", target: [-150, 72, 100], cap: LANDMARK_SIGN.maxJaLetterM / 2 },
  { id: "esola", ja: "エソラ池袋", en: "ESOLA IKEBUKURO", facade: "F4_darkBronze", exit: "x4f", target: [-150, 74, -5], cap: LANDMARK_SIGN.maxJaLetterM / 2 },
  { id: "parco", ja: "パルコ", en: "PARCO", facade: "F3_coolGrey", exit: "x22", target: [80, 65, -120], cap: LANDMARK_SIGN.maxJaLetterM / 2 },
  { id: "sunshine", ja: "サンシャイン60", en: "SUNSHINE 60", facade: "F3_coolGrey", exit: "x35", target: [610, 268, 25], cap: LANDMARK_SIGN.maxJaLetterSunshine60M / 2 },
] as const;

/** Remove only the source features replaced by the LOD2 landmark meshes, before stair cuts change triangle indices. */
export function removeLandmarkContext(THREE: typeof Three, root: Three.Object3D, quality: "low" | "high"): void {
  for (const name of new Set(ranges[quality].map(r => r.mesh))) {
    const mesh = root.getObjectByName(name) as Three.Mesh;
    const geometry = mesh.geometry;
    const count = geometry.index?.count ?? geometry.getAttribute("position").count;
    const kept: number[] = [];
    // All ranges for one mesh are removed together, in the original triangle order.
    const cuts = ranges[quality].filter(r => r.mesh === name);
    for (let i = 0; i < count; i++) if (!cuts.some(r => i >= r.start * 3 && i < (r.start + r.count) * 3)) kept.push(geometry.index ? geometry.index.getX(i) : i);
    const copy = geometry.clone();
    copy.setIndex(new THREE.BufferAttribute(new Uint32Array(kept), 1));
    mesh.geometry = copy;
    geometry.dispose();
  }
}

/** Each store uses one facade draw (including its street band), and one baked sign draw. */
export async function addLandmarks(ctx: SceneContext, parent: Three.Object3D): Promise<() => void> {
  const THREE = ctx.THREE;
  if (!document.fonts.check('600 32px "GTEki Sign JP"')) throw new Error("Landmarks require the project sign font");
  const loaded = await ctx.loadGlb("assets/ikebukuro_landmarks_next.glb");
  const materials: Three.Material[] = [], textures: Three.Texture[] = [];
  loaded.scene.name = "landmarks-next";
  for (const store of stores) {
    const mesh = loaded.scene.getObjectByName(store.id) as Three.Mesh;
    mesh.geometry.computeVertexNormals();
    const material = createContextMaterial(THREE, { color: new THREE.Color(LANDMARK_FACADE[store.facade]).getHex() });
    material.name = `landmark-facade:${store.id}`;
    // Sunshine's source geometry is 560–890 m away. The existing camera far plane is 2000 m;
    // its own daylight material must bypass the 240 m street haze to preserve the skyline.
    material.fog = store.id !== "sunshine";
    const daylight = material.onBeforeCompile;
    const bronze = new THREE.Color(LANDMARK_SIGN.band), glow = new THREE.Color(LANDMARK_STREET_BAND.glow);
    material.onBeforeCompile = (shader, renderer) => {
      daylight(shader, renderer);
      shader.vertexShader = shader.vertexShader.replace("#include <common>", "#include <common>\nvarying vec3 landmarkP;").replace("#include <begin_vertex>", "#include <begin_vertex>\nlandmarkP = (modelMatrix * vec4(transformed, 1.0)).xyz;");
      shader.fragmentShader = shader.fragmentShader.replace("#include <common>", "#include <common>\nvarying vec3 landmarkP;").replace("#include <opaque_fragment>", `
float h = landmarkP.y - 32.5;
float along = abs(vCtxN.x) > abs(vCtxN.z) ? landmarkP.z : landmarkP.x;
float joint = step(mod(h, ${LANDMARK_FLOOR_JOINT_M.toFixed(1)}), 0.08);
float pier = step(mod(along + 1000.0, ${((LANDMARK_PIER_SPACING_M[0] + LANDMARK_PIER_SPACING_M[1])/2).toFixed(1)}), 0.18);
float wall = 1.0 - step(0.5, abs(vCtxN.y));
outgoingLight *= 1.0 - wall * max(joint, pier) * 0.22;
float street = wall * step(0.0, h) * (1.0 - step(${LANDMARK_STREET_BAND.heightM[0].toFixed(1)}, h));
float mullion = step(mod(along + 1000.0, ${((LANDMARK_STREET_BAND.mullionSpacingM[0]+LANDMARK_STREET_BAND.mullionSpacingM[1])/2).toFixed(1)}), 0.08);
vec3 streetColor = mix(vec3(${glow.toArray().join(",")}) * ${LANDMARK_STREET_BAND.maxEmissive.toFixed(1)}, vec3(${bronze.toArray().join(",")}), mullion);
outgoingLight = mix(outgoingLight, streetColor, street);
#include <opaque_fragment>`);
    };
    material.customProgramCacheKey = () => "landmark-facade";
    mesh.material = material;
    mesh.name = `ctx_bldg_landmark_${store.id}`;
    materials.push(material);

    const canvas = document.createElement("canvas");
    canvas.width = LANDMARK_MAX_TEXTURE_PX;
    canvas.height = LANDMARK_MAX_TEXTURE_PX / 4;
    const g = canvas.getContext("2d")!;
    g.fillStyle = LANDMARK_SIGN.letters; g.textAlign = "center"; g.textBaseline = "middle";
    const jaPx = 62;
    g.font = `600 ${jaPx}px "GTEki Sign JP"`;
    g.fillText(store.ja, canvas.width/2, 46);
    g.font = `600 ${jaPx * LANDMARK_SIGN.enScale}px "GTEki Sign JP"`;
    g.fillText(store.en, canvas.width/2, 100);
    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    textures.push(texture);
    const signMaterial = new THREE.MeshStandardMaterial({ map: texture, roughness: LANDMARK_SIGN.bandRoughness, emissiveMap: texture, emissive: new THREE.Color(0xffffff), emissiveIntensity: LANDMARK_SIGN.letterEmissive[0], fog: material.fog, side: THREE.DoubleSide });
    signMaterial.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace("#include <map_fragment>", `#include <map_fragment>\ndiffuseColor.rgb = mix(vec3(${bronze.toArray().join(",")}), diffuseColor.rgb, diffuseColor.a);\ndiffuseColor.a = 1.0;`);
    };
    materials.push(signMaterial);
    // Locate the actual PLATEAU face at the top-floor band, rather than floating a billboard over its roof.
    const target = new THREE.Vector3(...store.target);
    const exit = ctx.bundle.nodes.find(n => n.id === store.exit)!;
    const eye = new THREE.Vector3(exit.position.x, target.y, -exit.position.y);
    const ray = new THREE.Raycaster(eye, target.clone().sub(eye).normalize());
    mesh.updateMatrixWorld(true);
    const hit = ray.intersectObject(mesh)[0];
    if (!hit) throw new Error(`No PLATEAU facade at sign anchor: ${store.id}`);
    const normal = hit.face!.normal.clone(); normal.y = 0; normal.normalize();
    if (normal.dot(eye.clone().sub(hit.point)) < 0) normal.negate();
    const signHeight = store.cap * canvas.height / jaPx;
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(signHeight * canvas.width / canvas.height, signHeight), signMaterial);
    sign.name = `landmark-sign:${store.id}`;
    sign.position.copy(hit.point).addScaledVector(normal, 0.06);
    sign.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal);
    loaded.scene.add(sign);
  }
  parent.add(loaded.scene);
  return () => { loaded.scene.removeFromParent(); loaded.scene.traverse(o => (o as Three.Mesh).geometry?.dispose()); materials.forEach(m=>m.dispose()); textures.forEach(t=>t.dispose()); };
}
