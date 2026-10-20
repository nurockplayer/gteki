// Dev-only: POST /__capture?name=<id> saves a canvas frame to build/captures/<id>.jpg
// (evidence screenshots for reviews and the GitHub Handoff). Not part of any build output.
import { defineConfig } from "vite";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [
    {
      name: "gteki-capture",
      configureServer(server) {
        server.middlewares.use("/__capture", (req, res) => {
          const name = new URL(req.url ?? "", "http://x").searchParams.get("name") ?? "frame";
          if (req.method !== "POST" || !/^[\w.-]{1,80}$/.test(name)) {
            res.statusCode = 400;
            res.end();
            return;
          }
          const chunks: Buffer[] = [];
          req.on("data", (c: Buffer) => chunks.push(c));
          req.on("end", () => {
            const dir = resolve(__dirname, "build/captures");
            mkdirSync(dir, { recursive: true });
            writeFileSync(resolve(dir, `${name}.jpg`), Buffer.concat(chunks));
            res.end("ok");
          });
        });
      },
    },
  ],
});
