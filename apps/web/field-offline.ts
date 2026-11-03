import type { Plugin } from "vite";

/** Cache just the field entry and its built dependencies, including a deployment below a subpath. */
export function fieldOffline(): Plugin {
  return {
    name: "gteki-field-offline",
    enforce: "post",
    generateBundle(_, bundle) {
      const html = bundle["field.html"];
      if (!html || html.type !== "asset") return;
      const files = new Set(["field.html"]);
      const add = (file: string) => {
        file = file.replace(/^\.\//, "");
        if (files.has(file)) return;
        files.add(file);
        const chunk = bundle[file];
        if (chunk?.type === "chunk") for (const dependency of [...chunk.imports, ...chunk.dynamicImports]) add(dependency);
      };
      for (const match of String(html.source).matchAll(/(?:src|href)="(\.\/assets\/[^\"]+)"/g)) add(match[1]!);
      const cacheName = `gteki-field-${[...files].join("-")}`;
      this.emitFile({ type: "asset", fileName: "field-sw.js", source: `
const CACHE = ${JSON.stringify(cacheName)};
const URLS = ${JSON.stringify([...files])}.map(file => new URL(file, self.registration.scope).href);
self.addEventListener('install', event => event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(URLS)).then(() => self.skipWaiting())));
self.addEventListener('activate', event => event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key.startsWith('gteki-field-') && key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', event => {
  const url = new URL(event.request.url); url.search = '';
  if (event.request.method === 'GET' && URLS.includes(url.href)) event.respondWith(caches.open(CACHE).then(cache => cache.match(url.href)).then(cached => cached || fetch(event.request)));
});
` });
    },
  };
}
