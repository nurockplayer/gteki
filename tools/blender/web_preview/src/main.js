import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const libraryBase = '/library/';
const viewer = document.querySelector('#viewer');
const status = document.querySelector('#library-status');
const assetList = document.querySelector('#asset-list');
const filter = document.querySelector('#filter');
const gridToggle = document.querySelector('#show-grid');
const collisionToggle = document.querySelector('#show-collision');
const socketToggle = document.querySelector('#show-sockets');
const statsNode = document.querySelector('#stats');
const notice = document.querySelector('#message');
const loader = new GLTFLoader();
const scene = new THREE.Scene();
scene.background = new THREE.Color('#182127');

const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 1000);
camera.position.set(5, 4, 6);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
viewer.appendChild(renderer.domElement);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.target.set(0, 1, -1);
const pmrem = new THREE.PMREMGenerator(renderer);
const environment = new RoomEnvironment();
scene.environment = pmrem.fromScene(environment).texture;
environment.dispose();
pmrem.dispose();
const key = new THREE.DirectionalLight(0xfff1d7, 4.2);
key.position.set(-4, 8, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -18; key.shadow.camera.right = 18;
key.shadow.camera.top = 18; key.shadow.camera.bottom = -18;
key.shadow.bias = -0.0003;
scene.add(key, new THREE.HemisphereLight(0xd3e6ff, 0x5d4c3d, 1.2));

const grid = new THREE.GridHelper(40, 40, 0x60716f, 0x38464a);
grid.position.y = 0.001;
scene.add(grid);
const ground = new THREE.Mesh(new THREE.PlaneGeometry(200, 200), new THREE.ShadowMaterial({ opacity: 0.2 }));
ground.rotation.x = -Math.PI / 2; ground.position.y = -0.004; ground.receiveShadow = true;
scene.add(ground);

let assets = [];
let activeRoot = null;
let currentAsset = null;
let currentBytes = 0;
let currentMetrics = { triangles: 0, materials: 0, textures: 0 };
let loadGeneration = 0;
let errorTimer;

function showMessage(message) {
  notice.textContent = message;
  notice.classList.add('visible');
  clearTimeout(errorTimer);
  errorTimer = setTimeout(() => notice.classList.remove('visible'), 3000);
}

function assetPath(asset) {
  return `${libraryBase}${asset.file.split('/').map(encodeURIComponent).join('/')}`;
}

function frameObject(object, target = controls.target) {
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) return;
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const radius = Math.max(size.length() * 0.5, 0.5);
  const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.1));
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
  const distance = radius / Math.sin(limitingHalfFov) * 1.15;
  target.copy(center);
  camera.position.copy(center).add(new THREE.Vector3(1, 0.62, 1.15).normalize().multiplyScalar(distance));
  camera.near = Math.max(radius / 1000, 0.01);
  camera.far = Math.max(radius * 100, 100);
  camera.updateProjectionMatrix();
  controls.update();
}

function isCollision(node) { return node.name.endsWith('-colonly'); }
function isSocket(node) { return node.name.startsWith('SOCKET_'); }

function setHelpers(root, parser) {
  const nodes = [];
  root.traverse(node => {
    const association = parser?.associations.get(node);
    const original = association?.nodes === undefined ? node.name : parser.json.nodes[association.nodes]?.name || node.name;
    node.userData.gtekiOriginalName = original;
    if (isCollision({ name: original }) || isSocket({ name: original })) nodes.push({ node, original });
  });
  for (const { node, original } of nodes) {
    if (isCollision({ name: original })) {
      node.userData.gtekiCollision = true;
      node.visible = collisionToggle.checked;
      node.traverse(child => {
        if (!child.isMesh) return;
        child.userData.gtekiOriginalMaterials = (Array.isArray(child.material) ? child.material : [child.material]).filter(Boolean);
        child.userData.gtekiCollision = true;
        const wire = new THREE.MeshBasicMaterial({ color: 0xff8a62, wireframe: true, transparent: true, opacity: 0.8 });
        child.material = wire;
      });
    }
    if (isSocket({ name: original })) {
      const helper = new THREE.AxesHelper(0.25);
      helper.name = `__socket_helper_${original}`;
      node.add(helper);
    }
  }
  applyHelperVisibility(root);
  root.traverse(node => {
    if (node.isMesh && !isCollision(node)) {
      node.castShadow = true;
      node.receiveShadow = true;
    }
  });
}

function applyHelperVisibility(root) {
  root.traverse(node => {
    if (node.userData.gtekiCollision) node.visible = collisionToggle.checked;
    if (node.name.startsWith('__socket_helper_')) node.visible = socketToggle.checked;
  });
}

function meshMetrics(root) {
  let triangles = 0, materialCount = 0, textureCount = 0;
  const materials = new Set(), textures = new Set();
  root.traverse(node => {
    if (!node.isMesh || node.userData.gtekiCollision || isCollision(node)) return;
    const geometry = node.geometry;
    const count = geometry.index ? geometry.index.count : geometry.attributes.position?.count ?? 0;
    triangles += Math.floor(count / 3);
    const nodeMaterials = [...(Array.isArray(node.material) ? node.material : [node.material]), ...(node.userData.gtekiOriginalMaterials || [])];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  materialCount = materials.size;
  textureCount = textures.size;
  return { triangles, materials: materialCount, textures: textureCount };
}

function showStats(root, bytes) {
  currentMetrics = meshMetrics(root);
  currentBytes = bytes;
  updateStats();
}

function updateStats() {
  const m = currentMetrics;
  statsNode.textContent = `${m.triangles.toLocaleString()} tris · ${renderer.info.render.calls} calls · ${m.materials} mats · ${m.textures} tex · ${currentBytes ? `${(currentBytes / 1024).toFixed(0)} KB` : '—'}`;
}

function resetAssets() {
  if (!activeRoot) return;
  scene.remove(activeRoot);
  const geometries = new Set(), materials = new Set(), textures = new Set();
  activeRoot.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    const nodeMaterials = [...(Array.isArray(node.material) ? node.material : [node.material]), ...(node.userData.gtekiOriginalMaterials || [])];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
  activeRoot = null;
}

function normalizeRoot(root, parser) {
  root.updateMatrixWorld(true);
  setHelpers(root, parser);
  return root;
}

async function loadGLTF(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${url}`);
  const bytes = await response.arrayBuffer();
  const basePath = new URL('.', new URL(url, location.href)).href;
  const gltf = await new Promise((resolve, reject) => loader.parse(bytes, basePath, resolve, reject));
  return { gltf, byteLength: bytes.byteLength };
}

function releaseLoaded(gltf) {
  const root = gltf.scene;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  root.traverse(node => {
    if (node.geometry) geometries.add(node.geometry);
    const nodeMaterials = [...(Array.isArray(node.material) ? node.material : [node.material]), ...(node.userData.gtekiOriginalMaterials || [])];
    for (const material of nodeMaterials) {
      if (!material) continue;
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
  for (const texture of textures) texture.dispose();
}

function loadAsset(asset) {
  const generation = ++loadGeneration;
  status.textContent = `Loading ${asset.id}…`;
  resetAssets();
  loadGLTF(assetPath(asset)).then(({ gltf, byteLength }) => {
    if (generation !== loadGeneration) { releaseLoaded(gltf); return; }
    activeRoot = normalizeRoot(gltf.scene, gltf.parser);
    scene.add(activeRoot);
    currentAsset = asset;
    showStats(activeRoot, byteLength);
    document.querySelector('#asset-name').textContent = asset.id;
    document.querySelector('#asset-family').textContent = `${asset.family || 'kit asset'} · ${asset.variant || ''}`;
    status.textContent = `${assets.length} assets`;
    frameObject(activeRoot);
    renderList();
  }).catch(error => {
    if (generation !== loadGeneration) return;
    const text = error?.message || String(error);
    status.textContent = `Could not load ${asset.id}`;
    showMessage(text);
    console.error(`Failed to load ${asset.id}`, error);
  });
}

function renderList() {
  const query = filter.value.trim().toLowerCase();
  assetList.replaceChildren();
  for (const asset of assets.filter(item => `${item.id} ${item.family || ''}`.toLowerCase().includes(query))) {
    const button = document.createElement('button');
    button.className = `asset-button${currentAsset?.id === asset.id ? ' active' : ''}`;
    button.innerHTML = `<strong></strong><small></small>`;
    button.querySelector('strong').textContent = asset.id;
    button.querySelector('small').textContent = `${asset.family || 'unknown'} · ${Number(asset.triangles || 0).toLocaleString()} tris`;
    button.addEventListener('click', () => {
      const url = new URL(location.href);
      url.searchParams.set('asset', asset.id);
      url.searchParams.delete('mode');
      history.replaceState(null, '', url);
      loadAsset(asset);
    });
    assetList.append(button);
  }
}

async function showGallery() {
  const generation = ++loadGeneration;
  resetAssets();
  const group = new THREE.Group();
  group.name = 'GTEki gallery';
  const columns = Math.ceil(Math.sqrt(assets.length));
  const loaded = await Promise.all(assets.map(async asset => {
    try {
      const { gltf, byteLength } = await loadGLTF(assetPath(asset));
      return { asset, gltf, byteLength, root: normalizeRoot(gltf.scene, gltf.parser) };
    } catch (error) {
      console.error(`Gallery load failed for ${asset.id}`, error);
      return null;
    }
  }));
  if (generation !== loadGeneration) {
    for (const item of loaded) if (item) releaseLoaded(item.gltf);
    return;
  }
  const columnWidths = Array(columns).fill(0), rowDepths = Array(Math.ceil(assets.length / columns)).fill(0);
  for (let i = 0; i < loaded.length; i++) {
    const item = loaded[i];
    if (!item) continue;
    const box = new THREE.Box3().setFromObject(item.root);
    const size = box.getSize(new THREE.Vector3());
    columnWidths[i % columns] = Math.max(columnWidths[i % columns], size.x);
    rowDepths[Math.floor(i / columns)] = Math.max(rowDepths[Math.floor(i / columns)], size.z);
  }
  const columnX = [], rowZ = [];
  let cursorX = 0;
  for (const width of columnWidths) { columnX.push(cursorX); cursorX += width + 2; }
  let cursorZ = 0;
  for (const depth of rowDepths) { rowZ.push(-cursorZ); cursorZ += depth + 2; }
  for (let i = 0; i < loaded.length; i++) {
    const item = loaded[i];
    if (!item) continue;
    const box = new THREE.Box3().setFromObject(item.root);
    const center = box.getCenter(new THREE.Vector3());
    const col = i % columns, row = Math.floor(i / columns);
    item.root.position.x += columnX[col] + columnWidths[col] * 0.5 - center.x;
    item.root.position.z += rowZ[row] - rowDepths[row] * 0.5 - center.z;
    group.add(item.root);
  }
  activeRoot = group;
  scene.add(group);
  currentAsset = null;
  showStats(group, loaded.reduce((total, item) => total + (item?.byteLength || 0), 0));
  document.querySelector('#asset-name').textContent = 'Kit gallery';
  document.querySelector('#asset-family').textContent = `${assets.length} assets`;
  frameObject(group);
  renderList();
}

function resize() {
  const width = viewer.clientWidth || 1, height = viewer.clientHeight || 1;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

gridToggle.addEventListener('change', () => { grid.visible = gridToggle.checked; });
collisionToggle.addEventListener('change', () => activeRoot && applyHelperVisibility(activeRoot));
socketToggle.addEventListener('change', () => activeRoot && applyHelperVisibility(activeRoot));
filter.addEventListener('input', renderList);
window.addEventListener('resize', resize);
resize();
renderer.setAnimationLoop(() => {
  controls.update();
  renderer.render(scene, camera);
  if (activeRoot) updateStats();
});

try {
  const response = await fetch(`${libraryBase}manifest.json`);
  if (!response.ok) throw new Error(`manifest returned HTTP ${response.status}`);
  const manifest = await response.json();
  if (!Array.isArray(manifest.assets)) throw new Error('manifest.assets must be an array');
  assets = manifest.assets;
  status.textContent = `${assets.length} assets · ${manifest.contract || 'manifest'}`;
  renderList();
  if (!assets.length) {
    document.querySelector('#asset-name').textContent = 'No assets found';
    showMessage('The library manifest contains no assets yet.');
  } else if (new URLSearchParams(location.search).get('mode') === 'gallery') {
    await showGallery();
  } else {
    const requestedId = new URLSearchParams(location.search).get('asset');
    const selected = assets.find(asset => asset.id === requestedId) || assets[0];
    loadAsset(selected);
  }
} catch (error) {
  status.textContent = 'Manifest unavailable';
  document.querySelector('#asset-name').textContent = 'Asset library unavailable';
  showMessage(error.message);
  console.error(error);
}
