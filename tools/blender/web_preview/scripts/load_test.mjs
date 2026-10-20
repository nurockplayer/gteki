import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LoadingManager } from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const previewDir = path.resolve(scriptDir, '..');
const repositoryRoot = path.resolve(previewDir, '../../..');
const libraryDir = path.resolve(process.env.GTEKI_LIBRARY_DIR || path.join(repositoryRoot, 'assets/library'));
const glbDir = path.join(libraryDir, 'glb');

// GLTFLoader needs browser image APIs for embedded textures. This verifies the
// PNG/JPEG container and dimensions, but deliberately does not decode pixels.
function imageDimensions(bytes) {
  const png = bytes.length >= 24 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  if (png) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const width = view.getUint32(16, false), height = view.getUint32(20, false);
    if (!width || !height) throw new Error('embedded PNG has invalid dimensions');
    return { width, height };
  }
  if (bytes.length >= 4 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 < bytes.length) {
      if (bytes[offset++] !== 0xff) continue;
      let marker = bytes[offset++];
      while (marker === 0xff) marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      if (marker >= 0xd0 && marker <= 0xd7) continue;
      const length = (bytes[offset] << 8) | bytes[offset + 1];
      if (length < 2 || offset + length > bytes.length) break;
      const isFrame = [0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker);
      if (isFrame && length >= 7) {
        const height = (bytes[offset + 3] << 8) | bytes[offset + 4];
        const width = (bytes[offset + 5] << 8) | bytes[offset + 6];
        if (width && height) return { width, height };
      }
      offset += length;
    }
    throw new Error('embedded JPEG has no valid frame dimensions');
  }
  throw new Error('embedded image is not PNG or JPEG');
}

if (typeof globalThis.createImageBitmap !== 'function') {
  globalThis.createImageBitmap = async blob => {
    if (!blob?.size) throw new Error('embedded image is empty');
    return { ...imageDimensions(new Uint8Array(await blob.arrayBuffer())), close() {} };
  };
}
globalThis.self ??= globalThis;
globalThis.ProgressEvent ??= class ProgressEvent extends Event {
  constructor(type, init = {}) {
    super(type);
    this.lengthComputable = Boolean(init.lengthComputable);
    this.loaded = Number(init.loaded) || 0;
    this.total = Number(init.total) || 0;
  }
};

function loadGLB(bytes, name) {
  const manager = new LoadingManager();
  const loadErrors = [];
  manager.onError = url => loadErrors.push(url);
  const loader = new GLTFLoader(manager);
  return new Promise((resolve, reject) => {
    loader.parse(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), '', gltf => {
      if (loadErrors.length) {
        reject(new Error(`${name}: failed to load embedded resource(s): ${loadErrors.join(', ')}`));
        return;
      }
      resolve(gltf);
    }, error => reject(new Error(`${name}: ${error?.message || error}`)));
  });
}

const files = (await fs.readdir(glbDir)).filter(name => name.toLowerCase().endsWith('.glb')).sort();
if (!files.length) {
  console.error(`No .glb files found in ${glbDir}`);
  process.exit(1);
}

// The library is what its manifest lists: a GLB missing from glb/ (or one the manifest does not
// know) must fail here too, not only in the validator that `build.sh all` runs first.
const manifestPath = path.resolve(process.env.GTEKI_MANIFEST || path.join(libraryDir, 'manifest.json'));
let listed;
try {
  const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
  listed = manifest.assets.map(asset => path.basename(asset.file)).sort();
} catch (error) {
  console.error(`FAIL manifest ${manifestPath}: ${error.message}`);
  process.exit(1);
}
const missing = listed.filter(name => !files.includes(name));
const unlisted = files.filter(name => !listed.includes(name));
if (missing.length || unlisted.length) {
  if (missing.length) console.error(`FAIL listed in the manifest but missing from ${glbDir}: ${missing.join(', ')}`);
  if (unlisted.length) console.error(`FAIL in ${glbDir} but not in the manifest: ${unlisted.join(', ')}`);
  process.exit(1);
}

let failures = 0;
for (const filename of files) {
  const fullPath = path.join(glbDir, filename);
  try {
    const bytes = await fs.readFile(fullPath);
    const gltf = await loadGLB(bytes, filename);
    let nodes = 0;
    const collisions = [];
    gltf.scene.traverse(node => {
      nodes++;
      const index = gltf.parser.associations.get(node)?.nodes;
      const originalName = index === undefined ? node.name : gltf.parser.json.nodes[index]?.name || node.name;
      if (originalName.endsWith('-colonly')) collisions.push(originalName);
    });
    console.log(`PASS ${filename}: ${nodes} scene nodes; collisions=${collisions.length ? collisions.join(',') : 'none'}`);
  } catch (error) {
    failures++;
    console.error(`FAIL ${filename}: ${error.message}`);
  }
}
console.log(`Load test: ${files.length - failures}/${files.length} GLBs parsed`);
if (failures) process.exitCode = 1;
