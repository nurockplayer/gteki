import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(previewDir, '../../..');
const libraryDir = path.resolve(process.env.GTEKI_LIBRARY_DIR || path.join(repositoryRoot, 'assets/library'));
// bench.html only: a second library to compare against, the showcase layouts and kit bundles
const compareDir = process.env.GTEKI_COMPARE_LIBRARY_DIR && path.resolve(process.env.GTEKI_COMPARE_LIBRARY_DIR);
const showcaseDir = path.join(repositoryRoot, 'tools/blender/showcase');
const bundleDir = path.resolve(process.env.GTEKI_BUNDLE_DIR || path.join(repositoryRoot, 'tools/blender/out/bundles'));
const basisDir = path.join(previewDir, 'node_modules/three/examples/jsm/libs/basis');

function serveLibrary() {
  return {
    name: 'gteki-library-files',
    configureServer(server) {
      const mounts = [['/library', libraryDir], ['/showcase', showcaseDir], ['/bundles', bundleDir], ['/basis', basisDir]];
      if (compareDir) mounts.push(['/library-compare', compareDir]);
      for (const [mount, root] of mounts) server.middlewares.use(mount, serveDir(root));
    },
  };
}

function serveDir(root) {
  return (request, response, next) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return next();
    let pathname;
    try {
      pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    } catch {
      response.statusCode = 400;
      return response.end('Bad request');
    }
    const target = path.resolve(root, `.${pathname}`);
    if (target !== root && !target.startsWith(`${root}${path.sep}`)) {
      response.statusCode = 403;
      return response.end('Forbidden');
    }
    fs.stat(target, (error, stat) => {
      if (error || !stat.isFile()) {
        response.statusCode = 404;
        return response.end('Not found');
      }
      const ext = path.extname(target).toLowerCase();
      const types = { '.json': 'application/json', '.glb': 'model/gltf-binary', '.js': 'text/javascript', '.wasm': 'application/wasm' };
      response.setHeader('Content-Type', types[ext] || 'application/octet-stream');
      response.setHeader('Content-Length', stat.size);
      if (request.method === 'HEAD') return response.end();
      fs.createReadStream(target).pipe(response);
    });
  };
}

export default defineConfig({
  plugins: [serveLibrary()],
  server: {
    fs: { allow: [previewDir, repositoryRoot, libraryDir] },
  },
  build: {
    rollupOptions: { input: { main: path.join(previewDir, 'index.html'), bench: path.join(previewDir, 'bench.html') } },
  },
});
