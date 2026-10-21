// pnpm check:access [step=0.1]: the fence outline and the walker seal of scene/access_fences.json (see access_seal.ts).
import { checkOutline, checkSeal } from "./access_seal.ts";

const step = Number(process.argv[2] ?? 0.1);
const gaps = await checkOutline();
for (const g of gaps.slice(0, 20)) console.log(`GAP in the outline fences at ${g}`);
console.log(`outline: ${gaps.length} gap(s)`);
const r = await checkSeal(step);
console.log(`step ${step} m: ${r.flooded} points flooded from ${r.seeds} graph nodes`);
for (const e of r.escapes) console.log(`ESCAPE outside the routable areas at ${JSON.stringify(e)}`);
const fail = gaps.length > 0 || r.escapes.length > 0;
console.log(fail ? "FAIL" : "ok: the outline is fenced and the walker stays on routable floor");
process.exit(fail ? 1 : 0);
