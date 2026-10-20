// Load-strategy benchmark for kit layouts (Lane E evidence; not a station runtime).
//
//   /bench.html?layout=concourse_demo&strategy=per_instance|per_asset|bundle
//               [&bundle=kit_concourse.glb] [&lib=compare] [&frames=120] [&ktx2=1]
//
// per_instance  every placed item fetches and parses its own GLB (a loader
//               without a URI cache, as `ctx.loadGlb` in the shared core today)
// per_asset     each distinct GLB is fetched and parsed once, then cloned
// bundle        one kit bundle (tools/blender/bundle_kit.py), cloned per item
//
// Object3D.clone() shares geometry, material and texture objects, so clones
// cost draw calls but no extra GPU memory. Results land in window.__bench.
// ktx2=1 registers KTX2Loader (KHR_texture_basisu), which the shared core does
// not do today; it is here to measure a KTX2 variant, not as a runtime default.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const params = new URLSearchParams(location.search);
const layoutName = params.get('layout') || 'concourse_demo';
const strategy = params.get('strategy') || 'per_instance';
const libraryBase = params.get('lib') === 'compare' ? '/library-compare/' : '/library/';
const bundleName = params.get('bundle') || 'kit_concourse.glb';
const frameCount = Number(params.get('frames') || 120);
const report = document.querySelector('#report');
const useKtx2 = params.get('ktx2') === '1';

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.querySelector('#viewer').appendChild(renderer.domElement);
const scene = new THREE.Scene();
scene.background = new THREE.Color('#182127');
const pmrem = new THREE.PMREMGenerator(renderer);
const room = new RoomEnvironment();
scene.environment = pmrem.fromScene(room).texture;
room.dispose(); // keep only the environment map, so resource counters reflect the kit
pmrem.dispose();
scene.add(new THREE.HemisphereLight(0xffffff, 0x404040, 1.5));
const camera = new THREE.PerspectiveCamera(50, 1, 0.05, 200);

function resize() {
  const w = innerWidth, h = innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const fetched = { requests: 0, bytes: 0 };
async function fetchBytes(url) {
  // no-store: every request reaches the server, as on a cold first visit
  const response = await fetch(url, { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = await response.arrayBuffer();
  fetched.requests += 1;
  fetched.bytes += bytes.byteLength;
  return bytes;
}

let ktx2Loader = null;
async function parse(url) {
  const bytes = await fetchBytes(url);
  const loader = new GLTFLoader(); // fresh loader per call, like the shared core
  if (useKtx2) {
    ktx2Loader ||= new KTX2Loader().setTranscoderPath('/basis/').detectSupport(renderer);
    loader.setKTX2Loader(ktx2Loader);
  }
  return new Promise((resolve, reject) => loader.parse(bytes, '', resolve, reject));
}

// Showcase layouts are in Blender world coordinates (Z up): glTF/three (x, y, z) = (bx, bz, -by).
function place(object, item) {
  const [x, y, z] = item.pos || [0, 0, 0];
  object.position.set(x, z, -y);
  object.rotation.y = THREE.MathUtils.degToRad(item.yaw || 0);
  object.traverse(node => { if (node.name.includes('-colonly')) node.visible = false; });
  scene.add(object);
}

const assetId = item => item.glb.split('/').pop().replace(/\.glb$/, '');

async function load(items) {
  if (strategy === 'per_instance') {
    const roots = await Promise.all(items.map(item => parse(`${libraryBase}glb/${assetId(item)}.glb`)));
    roots.forEach((gltf, i) => place(gltf.scene, items[i]));
  } else if (strategy === 'per_asset') {
    const ids = [...new Set(items.map(assetId))];
    const loaded = new Map(await Promise.all(ids.map(async id => [id, (await parse(`${libraryBase}glb/${id}.glb`)).scene])));
    for (const item of items) place(loaded.get(assetId(item)).clone(), item);
  } else if (strategy === 'bundle') {
    const gltf = await parse(`/bundles/${bundleName}`);
    const kit = gltf.scene.children[0];
    // GLTFLoader suffixes repeated node names file-wide; bundle_kit records the original of every
    // repeated name in extras.gteki_name, which GLTFLoader exposes as userData.gteki_name
    const byId = new Map(kit.children.map(child => [child.userData.gteki_name || child.userData.name || child.name, child]));
    for (const item of items) {
      const source = byId.get(assetId(item));
      if (!source) throw new Error(`bundle has no ${assetId(item)}`);
      place(source.clone(), item);
    }
  } else {
    throw new Error(`unknown strategy ${strategy}`);
  }
}

function textureStats() {
  const textures = new Set(), materials = new Set(), geometries = new Set();
  scene.traverse(node => {
    if (!node.isMesh || !node.visible) return;
    geometries.add(node.geometry);
    for (const material of [node.material].flat()) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  let gpu = 0;
  for (const texture of textures) {
    if (texture.isCompressedTexture) {
      // GPU-compressed: the transcoded mip chain is what gets uploaded
      for (const mip of texture.mipmaps) gpu += mip.data.byteLength;
      continue;
    }
    const image = texture.image;
    if (image?.width) gpu += image.width * image.height * 4 * (texture.generateMipmaps ? 4 / 3 : 1);
  }
  return { textures: textures.size, materials: materials.size, geometries: geometries.size, gpuTextureMiB: +(gpu / 2 ** 20).toFixed(1) };
}

function setCamera(layout) {
  const cams = layout.cameras || {};
  const cam = layout.camera || cams[params.get('camera')] || Object.values(cams)[0];
  if (!cam) return;
  const p = cam.pos, t = cam.look_at;
  camera.position.set(p[0], p[2], -p[1]);
  camera.lookAt(t[0], t[2], -t[1]);
  // Blender sensor-fit AUTO: 36 mm across the longer side
  const horizontal = 2 * Math.atan(18 / (cam.lens || 24));
  camera.fov = THREE.MathUtils.radToDeg(2 * Math.atan(Math.tan(horizontal / 2) / camera.aspect));
  camera.updateProjectionMatrix();
}

// Background tabs throttle requestAnimationFrame, so time-box it.
const nextFrame = () => new Promise(resolve => {
  const timer = setTimeout(resolve, 50);
  requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
});
const pixel = new Uint8Array(4);
// Render and wait for the GPU (a 1-pixel readback blocks until the frame is done).
function renderSync() {
  renderer.render(scene, camera);
  const gl = renderer.getContext();
  gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
}

async function run() {
  const layout = await (await fetch(`/showcase/${layoutName}.json`)).json();
  setCamera(layout);
  const heap0 = performance.memory?.usedJSHeapSize;
  const t0 = performance.now();
  await load(layout.items);
  const tLoaded = performance.now();
  await renderer.compileAsync(scene, camera);
  renderSync(); // first frame uploads every texture and geometry
  const tFirstFrame = performance.now();
  const frames = [];
  for (let i = 0; i < frameCount; i++) {
    await nextFrame();
    const start = performance.now();
    renderSync();
    frames.push(performance.now() - start);
  }
  const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
  const result = {
    layout: layoutName, strategy, library: libraryBase, items: layout.items.length, ktx2: useKtx2,
    requests: fetched.requests, downloadMiB: +(fetched.bytes / 2 ** 20).toFixed(2),
    loadMs: Math.round(tLoaded - t0), firstFrameMs: Math.round(tFirstFrame - t0),
    renderer: { textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, programs: renderer.info.programs?.length },
    scene: textureStats(),
    jsHeapMiB: heap0 === undefined ? null : +(performance.memory.usedJSHeapSize / 2 ** 20).toFixed(1), // Chromium only, after load
    frameMsMedian: +median(frames).toFixed(2), frameMsP95: +[...frames].sort((a, b) => a - b)[Math.floor(frames.length * 0.95)].toFixed(2),
    visible: document.visibilityState,
  };
  window.__bench = result;
  report.textContent = JSON.stringify(result, null, 2);
  renderer.setAnimationLoop(() => renderer.render(scene, camera)); // keep the view up for screenshots
}

run().catch(error => { window.__bench = { error: String(error) }; report.textContent = `error: ${error.message}`; console.error(error); });
