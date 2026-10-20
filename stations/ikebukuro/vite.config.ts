// Dev-only: POST /__capture?name=<id> saves a canvas frame to build/captures/<id>.jpg
// (evidence screenshots for reviews and the GitHub Handoff). Not part of any build output.
import { defineConfig } from "vite";
import { mkdirSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    {
      name: "gteki-capture",
      apply: "serve",
      configureServer(server) {
        server.middlewares.use("/__capture", (req, res) => {
          const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "frame";
          if (req.method !== "POST" || !/^[\w.-]{1,80}$/.test(name)) {
            res.statusCode = 400;
            res.end();
            return;
          }
          const MAX = 8 * 1024 * 1024; // one JPEG frame; anything larger is refused
          const chunks: Buffer[] = [];
          let size = 0;
          req.on("data", (c: Buffer) => {
            size += c.length;
            if (size > MAX) {
              res.statusCode = 413;
              res.end();
              req.destroy();
              return;
            }
            chunks.push(c);
          });
          req.on("end", async () => {
            if (size > MAX) return;
            const dir = resolve(__dirname, "build/captures");
            mkdirSync(dir, { recursive: true });
            await writeFile(resolve(dir, `${name}.jpg`), Buffer.concat(chunks, size));
            res.end("ok");
          });
        });
      },
    },
  ],
});
