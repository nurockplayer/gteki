// Publish gate for the held S03 nav graph (director 2026-10-26 19:1x JST). It lists every reason the held run may not
// ship and refuses while any remains. The station-graph merge (S03↔E27 seam) is not built: a clear gate still refuses.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { repoRoot } from './common.js';
import { assertRunId, loadHeldGraph, type HeldGraphDocument } from './s03-nav-graph-route.js';
import { PATH_REASON } from './s03-paths.js';

export const S03_PUBLISH_FLAG = '--publish';
export const HOLD_SIGNOFF_PATH = 'docs/gis/s03/hold-signoff.json';
/** The data lead's HOLD sign-off for one run: a role (never a name), a +09:00 time and the PR that records it. */
export interface HoldSignoff { run_id: string; signed_by_role: string; signed_at: string; record_url: string }

export function publishBlockers(document: HeldGraphDocument & { bundle_floor_tie?: unknown }, signoff: HoldSignoff | null): string[] {
  const blockers: string[] = [];
  for (const code of Object.values(PATH_REASON)) {
    const count = document.edges.filter(edge => edge.reason_codes.includes(code)).length;
    if (count) blockers.push(`${code} on ${count} edge(s)`);
  }
  if (document.bundle_floor_tie !== 'VERIFIED') blockers.push('S03↔bundle floor tie is not VERIFIED');
  if (!signoff) blockers.push(`HOLD is not signed (${HOLD_SIGNOFF_PATH} is missing)`);
  else if (signoff.run_id !== document.run_id) blockers.push(`HOLD sign-off is for ${signoff.run_id}, not ${document.run_id}`);
  else if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?\+09:00$/.test(signoff.signed_at) || !/^[a-z][a-z-]*$/.test(signoff.signed_by_role) || !/^https:\/\//.test(signoff.record_url))
    blockers.push('HOLD sign-off is malformed (role, +09:00 time and record URL are required)');
  return blockers;
}

export async function readSignoff(root: string = repoRoot): Promise<HoldSignoff | null> {
  try { return JSON.parse(await readFile(join(root, HOLD_SIGNOFF_PATH), 'utf8')) as HoldSignoff; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw error; }
}

export async function s03NavGraphPublish(options: { run: string; publish: boolean }, storeRoot?: string, root: string = repoRoot): Promise<never> {
  if (!options.publish) throw new Error(`S03 publish: refusing without ${S03_PUBLISH_FLAG}`);
  const { document } = storeRoot === undefined
    ? await loadHeldGraph(assertRunId(options.run))
    : await loadHeldGraph(assertRunId(options.run), storeRoot);
  const blockers = publishBlockers(document as HeldGraphDocument & { bundle_floor_tie?: unknown }, await readSignoff(root));
  if (blockers.length) throw new Error(`S03 publish: refusing to publish ${document.run_id}: ${blockers.join('; ')}`);
  throw new Error(`S03 publish: every gate is clear for ${document.run_id}, but the station graph merge (S03↔E27 seam) is not built yet; ask the lead`);
}
