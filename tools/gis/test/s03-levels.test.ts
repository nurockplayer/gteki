import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { Floor, StationManifestFile } from '../../../packages/schema/src/index.js';
import { repoRoot } from '../src/common.js';
import { buildS03Levels, s03Levels, s03OnlyLevels } from '../src/s03-levels.js';
import { renderElevationFor } from '../src/s03-private-seam.js';
import { S03_FLOOR_ORDINALS, type Point2, type Project, type S03FeatureGeometry, type S03Inputs, type S03Level } from '../src/s03-transform.js';

const floor = (id: string, ordinal: number, renderElevationM: number): Floor => ({ id, operatorId: 'test', sourceLabels: [], ordinal,
  intermediate: false, elevationM: null, elevationSource: 'unknown', renderElevationM });
const manifest = { floors: [floor('public-1f', 1, 0)] } as unknown as StationManifestFile;
// Synthetic positions only: the projector is supplied, so nothing here is a source coordinate.
const ring: Point2[] = [[10.001, 20.002], [10.05, 20.002], [10.05, 20.06], [10.001, 20.06], [10.001, 20.002]];
const hole: Point2[] = [[10.2, 20.2], [10.3, 20.2], [10.3, 20.3], [10.2, 20.3], [10.2, 20.2]];
const feature = (featureId: number | null, polygons: S03FeatureGeometry['polygons']): S03FeatureGeometry => ({ featureIndex: 0, featureId, polygons });
const level = (id: number, label: string, features: S03FeatureGeometry[] = []): S03Level => ({ id, label,
  ordinal: S03_FLOOR_ORDINALS[label]!, z: null, polygons: [], nonPolygonFeatures: 0, memberSha256: 'synthetic',
  featuresTotal: features.length, featuresUsed: features.length, featuresExcludedUnclosedRing: 0, featuresExcludedHoleOutsideShell: 0, features });
function inputs(levels: S03Level[], facilities: ReadonlyMap<string, string> = new Map()): S03Inputs {
  return { navTransform: [1, 0, 0, 1, 0, 0], drawingTransform: [1, 0, 0, 1, 0, 0], drawingId: 1, nodes: [], levels, links: [],
    sourceValues: new Set(), sourceDefects: [], topology: { rings_checked: 0, rings_skipped_large: 0, hole_shell_touches: 0 },
    facilities, navSha256: 'synthetic', mapSha256: 'synthetic' };
}
const project: Project = (lat, lon) => [lon / 3, lat / 7];

describe('S03-only level polygons (synthetic only)', () => {
  it('skips a level that matches exactly one public floor', () => {
    const publicLevel = level(11, '1F', [feature(501, [[ring]])]);
    expect(s03OnlyLevels([publicLevel], manifest)).toEqual([]);
    expect(buildS03Levels(inputs([publicLevel]), manifest, project)).toEqual([]);
  });

  it('gives a level with no public match its private floor id and render height', () => {
    const only = s03OnlyLevels([level(12, 'B5F')], manifest);
    expect(only).toHaveLength(1);
    expect(only[0]).toMatchObject({ floorId: 'p:sjk:s03:f:12', ordinal: -5, renderElevationM: renderElevationFor(manifest.floors, -5) });
    expect(only[0]!.renderElevationM).toBeCloseTo(-27);
  });

  it('projects every ring of every polygon through the given projector and rounds to 0.01 m', () => {
    const [region] = buildS03Levels(inputs([level(12, 'B5F', [feature(501, [[ring, hole]])])]), manifest, project);
    expect(region!.features[0]!.polygons[0]).toEqual([
      [[3.33, 2.86], [3.35, 2.86], [3.35, 2.87], [3.33, 2.87], [3.33, 2.86]],
      [[3.4, 2.89], [3.43, 2.89], [3.43, 2.9], [3.4, 2.9], [3.4, 2.89]],
    ]);
  });

  it('attaches the facility of the level-geometry feature, or null when the source has none', () => {
    const facilities = new Map([['12:501', 'SYNTH-facility-a']]);
    const [region] = buildS03Levels(inputs([level(12, 'B5F', [feature(501, [[ring]]), feature(502, [[ring]]), feature(null, [[ring]])])],
      facilities), manifest, project);
    expect(region!.features.map(entry => [entry.featureId, entry.facility])).toEqual([[501, 'SYNTH-facility-a'], [502, null], [null, null]]);
  });

  it('refuses missing opt-in and repository output before loading the source', async () => {
    await expect(s03Levels({ out: '/unused/private/levels.s03.json', privateTier: false })).rejects.toThrow(/--private-tier/);
    await expect(s03Levels({ out: join(repoRoot, 'tools/../levels.s03.json'), privateTier: true })).rejects.toThrow(/--out inside the git repo/);
  });
});
