import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const previewDir = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(previewDir, '../../..');
const libraryDir = path.resolve(process.env.GTEKI_LIBRARY_DIR || path.join(repositoryRoot, 'assets/library'));

function serveLibrary() {
  return {
    name: 'gteki-library-files',
    configureServer(server) {
      server.middlewares.use('/library', (request, response, next) => {
        if (request.method !== 'GET' && request.method !== 'HEAD') return next();
        let pathname;
        try {
          pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
        } catch {
          response.statusCode = 400;
          return response.end('Bad request');
        }
        const target = path.resolve(libraryDir, `.${pathname}`);
        if (target !== libraryDir && !target.startsWith(`${libraryDir}${path.sep}`)) {
          response.statusCode = 403;
          return response.end('Forbidden');
        }
        fs.stat(target, (error, stat) => {
          if (error || !stat.isFile()) {
            response.statusCode = 404;
            return response.end('Not found');
          }
          const ext = path.extname(target).toLowerCase();
          response.setHeader('Content-Type', ext === '.json' ? 'application/json' : ext === '.glb' ? 'model/gltf-binary' : 'application/octet-stream');
          response.setHeader('Content-Length', stat.size);
          if (request.method === 'HEAD') return response.end();
          fs.createReadStream(target).pipe(response);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [serveLibrary()],
  server: {
    fs: { allow: [previewDir, repositoryRoot, libraryDir] },
  },
});
