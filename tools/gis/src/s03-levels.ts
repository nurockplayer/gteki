/** Private-tier level regions: the footprint polygons of each S03 floor the public scene does not model. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { StationManifestFile } from '../../../packages/schema/src/index.js';
import { repoRoot } from './common.js';
import { privateOutput, renderElevationFor } from './s03-private-seam.js';
import { compatibleFloors, loadS03Inputs, S03_FLOOR_ORDINALS, type Point2, type Project, type S03Inputs, type S03Level } from './s03-transform.js';

const sourceId = 'tokyo-s03-zip';
export interface S03OnlyLevel { floorId: string; ordinal: number; renderElevationM: number; level: S03Level }

/**
 * Levels a public station does not model: an S03 ordinal that matches no public floor exactly once. Same rule as
 * buildPrivateSeam's floor assignment, so a level lands on a private floor exactly when a seamed node would.
 */
export function s03OnlyLevels(levels: readonly S03Level[], manifest: StationManifestFile): S03OnlyLevel[] {
  const only: S03OnlyLevel[] = [];
  for (const level of levels) {
    const ordinal: number | null = S03_FLOOR_ORDINALS[level.label] ?? null;
    if (ordinal === null) continue;
    if (manifest.floors.filter(floor => floor.ordinal !== null && compatibleFloors(floor.ordinal, ordinal)).length === 1) continue;
    only.push({ floorId: `p:sjk:s03:f:${level.id}`, ordinal, renderElevationM: renderElevationFor(manifest.floors, ordinal), level });
  }
  return only;
}

export interface S03LevelFeature { featureId: number | null; facility: string | null; polygons: Point2[][][] }
export interface S03LevelRegion { floorId: string; ordinal: number; renderElevationM: number; features: S03LevelFeature[] }

/** Footprint polygons in station ENU, rounded to 0.01 m. Features excluded by a source-defect ruling are already absent. */
export function buildS03Levels(inputs: S03Inputs, manifest: StationManifestFile, project: Project): S03LevelRegion[] {
  const round = (v: number): number => Math.round(v * 100) / 100;
  return s03OnlyLevels(inputs.levels, manifest).map(({ floorId, ordinal, renderElevationM, level }) => ({ floorId, ordinal, renderElevationM,
    features: level.features.map(feature => ({ featureId: feature.featureId, facility: inputs.facilities.get(`${level.id}:${feature.featureId}`) ?? null,
      polygons: feature.polygons.map(polygon => polygon.map(ring => ring.map(([lon, lat]) => {
        const [east, north] = project(lat, lon);
        return [round(east), round(north)] as const;
      }))) })) }));
}

/** Reads the checked S03 ZIP and the public manifest; writes only the requested private levels file, with no public receipt. */
export async function s03Levels(options: { out: string; privateTier: boolean }) {
  if (!options.privateTier) throw new Error('S03 levels: refusing without the explicit --private-tier flag');
  const out = privateOutput(options.out);
  const { inputs, project } = await loadS03Inputs();
  const manifest = JSON.parse(await readFile(join(repoRoot, 'stations/shinjuku/gteki/station.json'), 'utf8')) as StationManifestFile;
  const levels = buildS03Levels(inputs, manifest, project);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify({ policy: 's03-levels-v1', sourceId, levels }, null, 2)}\n`);
  // Counts only: floor ids, heights and the numbers of features and rings, never coordinates or labels.
  return levels.map(level => ({ floorId: level.floorId, ordinal: level.ordinal, renderElevationM: level.renderElevationM,
    features: level.features.length, rings: level.features.reduce((sum, feature) => sum + feature.polygons.reduce((n, polygon) => n + polygon.length, 0), 0) }));
}
