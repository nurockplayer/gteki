import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { HOLD_SIGNOFF_PATH, publishBlockers, s03NavGraphPublish, type HoldSignoff } from '../src/s03-nav-graph-publish.js';
import { type HeldGraphDocument } from '../src/s03-nav-graph-route.js';
import { S03_NAV_GRAPH_POLICY, type S03GateTag } from '../src/s03-nav-graph.js';
import { PATH_REASON } from '../src/s03-paths.js';

const sha256 = (value: string | Buffer): string => createHash('sha256').update(value).digest('hex');
const gate = (poiId: string, operators: string[]): S03GateTag => ({ poi_id: poiId, operator_ids: operators, line: null, name: poiId });
const NODE = (sourceId: number, gateTag: S03GateTag | null) => ({
  source_id: sourceId, level_id: 11, level_label: 'B1F', level_z: -2, lon: 0, lat: 0, east_m: sourceId * 10, north_m: 0, gate: gateTag,
});
const EDGE = (linkId: number, from: number, to: number, length: number, reason_codes: string[] = [], direction = 3) =>
  ({ link_id: linkId, from_node: from, to_node: to, direction, dz_m: null, length_m: length, level_relation: 'same_level' as const, reason_codes });

const held = (override: { edges?: HeldGraphDocument['edges']; digest?: string; bundle_floor_tie?: unknown } = {}): HeldGraphDocument & { bundle_floor_tie?: unknown } => {
  const digest = override.digest ?? 'a'.repeat(20);
  return {
    policy_version: S03_NAV_GRAPH_POLICY, digest, run_id: `nav-graph-${digest}`, source_id: 'tokyo-s03-zip',
    source_record: { sha256: 'b'.repeat(64) }, publish_gate: 'CONDITIONAL', publication: { routing: 'HOLD' },
    bundle_floor_tie: override.bundle_floor_tie,
    nodes: [NODE(1, gate('poi:jreast-gate:1', ['jreast'])), NODE(2, null), NODE(3, gate('poi:keio-gate:1', ['keio']))],
    edges: override.edges ?? [EDGE(101, 1, 2, 5), EDGE(102, 2, 3, 7)],
  };
};
const signoff = (runId: string): HoldSignoff => ({ run_id: runId, signed_by_role: 'data-lead', signed_at: '2026-10-26T20:00+09:00', record_url: 'https://github.com/nurockplayer/gteki/pull/553' });

describe('S03 nav graph publish gate', () => {
  it('names each reason code and the number of edges carrying it', () => {
    const document = held({ bundle_floor_tie: 'VERIFIED', edges: [
      EDGE(101, 1, 2, 5, [PATH_REASON.CRS_UNCONFIRMED]), EDGE(102, 2, 3, 7, [PATH_REASON.CRS_UNCONFIRMED]),
    ] });
    expect(publishBlockers(document, signoff(document.run_id))).toContain(`${PATH_REASON.CRS_UNCONFIRMED} on 2 edge(s)`);
  });

  it('blocks a missing HOLD sign-off when edges and floor tie are clear', () => {
    expect(publishBlockers(held({ bundle_floor_tie: 'VERIFIED' }), null).join('; ')).toContain('HOLD is not signed');
  });

  it('blocks a sign-off recorded for another run', () => {
    const document = held({ bundle_floor_tie: 'VERIFIED' });
    expect(publishBlockers(document, signoff(`nav-graph-${'c'.repeat(20)}`)).join('; ')).toContain('HOLD sign-off is for');
  });

  it('blocks a sign-off with a bare time', () => {
    const document = held({ bundle_floor_tie: 'VERIFIED' });
    expect(publishBlockers(document, { ...signoff(document.run_id), signed_at: '2026-10-26T20:00' }).join('; ')).toContain('HOLD sign-off is malformed');
  });

  it('has no blockers for a clean document with a verified floor tie and valid sign-off', () => {
    const document = held({ bundle_floor_tie: 'VERIFIED' });
    expect(publishBlockers(document, signoff(document.run_id))).toEqual([]);
  });

  it('refuses without --publish', async () => {
    await expect(s03NavGraphPublish({ run: `nav-graph-${'a'.repeat(20)}`, publish: false })).rejects.toThrow(/refusing without --publish/);
  });

  it('still refuses to merge when every gate is clear', async () => {
    const store = await mkdtemp(join(tmpdir(), 'gteki-publish-store-'));
    const root = await mkdtemp(join(tmpdir(), 'gteki-publish-root-'));
    try {
      const document = held({ bundle_floor_tie: 'VERIFIED' });
      await mkdir(join(store, 'out/s03'), { recursive: true });
      await writeFile(join(store, 'out/s03', `${document.run_id}.json`), JSON.stringify(document));
      await mkdir(join(root, 'docs/gis/s03'), { recursive: true });
      await writeFile(join(root, HOLD_SIGNOFF_PATH), JSON.stringify(signoff(document.run_id)));
      await expect(s03NavGraphPublish({ run: document.run_id, publish: true }, store, root))
        .rejects.toThrow(/merge \(S03↔E27 seam\) is not built/);
    } finally {
      await rm(store, { recursive: true, force: true });
      await rm(root, { recursive: true, force: true });
    }
  });

  it('contains no filesystem write call', async () => {
    const source = await readFile(new URL('../src/s03-nav-graph-publish.ts', import.meta.url), 'utf8');
    expect(source).not.toMatch(/\b(?:writeFile|writeJson)\s*\(/);
  });
});
