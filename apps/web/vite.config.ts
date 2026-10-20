import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import { gtekiStations } from "./stations-plugin.ts";
import { threeAliases } from "./three-alias.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const extraRoots = (process.env.GTEKI_STATION_ROOTS ?? "").split(path.delimiter).filter(Boolean).map((p) => path.resolve(p));
const roots = [path.join(repo, "stations"), ...extraRoots];

export default defineConfig({
  base: "./",
  plugins: [gtekiStations(roots)],
  resolve: {
    // Station scene modules live outside this package; give them the explorer's single three.
    alias: threeAliases(fs.realpathSync(path.join(here, "node_modules/three"))),
    dedupe: ["three"],
  },
  server: { fs: { allow: [repo, ...extraRoots] } },
  build: { target: "es2022", chunkSizeWarningLimit: 1500 },
});
