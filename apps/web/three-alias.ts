import fs from "node:fs";
import path from "node:path";

export interface Alias { find: RegExp; replacement: string }

const escape = (s: string): string => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * Pin every `three` import specifier — including station scene modules outside this package — to the
 * explorer's single copy, honouring three's `exports` map (`three/addons/*` → `examples/jsm/*`, …).
 */
export function threeAliases(threeDir: string): Alias[] {
  const pkg = JSON.parse(fs.readFileSync(path.join(threeDir, "package.json"), "utf8")) as { exports: Record<string, string | { import?: string; default?: string }> };
  const out: Alias[] = [];
  for (const [key, value] of Object.entries(pkg.exports)) {
    const target = typeof value === "string" ? value : value.import ?? value.default;
    if (!target) continue;
    const spec = `three${key.slice(1)}`;
    if (key.endsWith("/*")) {
      out.push({ find: new RegExp(`^${escape(spec.slice(0, -1))}(.+)$`), replacement: `${path.join(threeDir, target.slice(0, -1))}$1` });
    } else {
      out.push({ find: new RegExp(`^${escape(spec)}$`), replacement: path.join(threeDir, target) });
    }
  }
  return out;
}
