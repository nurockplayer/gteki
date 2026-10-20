/** Independent parity check against the actual shared transform; no app writes. */
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { EnuFrame, enuToRenderer } from '../../../../../packages/geo/src/index.ts';
const raw = resolve(homedir(), 'Developer/gteki-raw/shinjuku/w5-tokyo-join-2026-10-21');
const nodes = JSON.parse(readFileSync(resolve(raw, 'tokyo-transformed-nodes.json'), 'utf8'));
const frame = new EnuFrame({ lat:35.687, lon:139.6994, h:0 });
let maxErrorM = 0;
for (const n of nodes) {
  const got = frame.toEnu({ lat:n.lat, lon:n.lon, h:0 });
  const err = Math.hypot(got.x-n.xy[0], got.y-n.xy[1]);
  maxErrorM = Math.max(maxErrorM,err);
  if (err >= 1e-7) throw new Error(`ENU parity failed: ${n.id} ${err}`);
}
if (nodes.length !== 2506) throw new Error('Unexpected Tokyo node count');
if (JSON.stringify(enuToRenderer({x:3,y:5,z:-4})) !== '[3,-4,-5]') throw new Error('Renderer axis mismatch');
const result={nodesChecked:nodes.length,maxHorizontalDifferenceM:maxErrorM,toleranceM:1e-7,rendererAxisCheck:'PASS',status:'PASS'};
writeFileSync(resolve(raw,'enu-parity-check.json'),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
