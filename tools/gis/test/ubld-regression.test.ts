import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, expect, it } from 'vitest';
import { NodeIO } from '@gltf-transform/core';
import { convertCityGmlFile } from '../src/convert.js';
import { CRS_6697, IX_PROJ, loadFrame, project, type Frame } from '../src/crs.js';

const dirs: string[] = [];
afterEach(async () => { for (const dir of dirs.splice(0)) await rm(dir, { recursive: true, force: true }); });
const fixture = (name: string): string => fileURLToPath(new URL(`fixtures/${name}`, import.meta.url));
const sha = 'a'.repeat(64);
const envelopeFrame = (): Frame => {
  const [E, N, H] = project([35.7, 139.7, 0]);
  return { frame_id: 'synthetic', source_id: 'synthetic', source_sha256: sha, verification: 'UNVERIFIED', origin_E: E, origin_N: N, origin_H: H,
    source_envelope: { lower: [35.7, 139.7, 0], upper: [35.701, 139.701, 3], srsName: CRS_6697 }, horizontal_crs: 'EPSG:6677', projection: IX_PROJ, vertical_datum: 'TP', axis_order: 'latitude longitude height', purpose: 'SYNTHETIC' };
};
const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

// GLB bytes below were produced by the converter BEFORE the station-enu / context changes (baseline run on main e244d20
// with the same synthetic frame); any change to envelope-frame conversion output fails here.
it.each([
  ['tiny-citygml.xml', '4e426173a7ca8721f30009f5db1ff80427729ab7663cf8460d6f021e55a3de19', 12, 5],
  ['phase2-solid-reference.xml', '012cf140c5ed3f42f3d0cec9917d40c05b6928c019da39e9c8b55169adbd2101', 2, 2],
])('leaves the existing ubld/envelope-frame GLB for %s byte-identical to the pre-#39 baseline', async (name, expectedSha, triangles, nodes) => {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-ubld-regression-')); dirs.push(dir);
  const outputPath = join(dir, 'out.glb');
  const report = await convertCityGmlFile({ path: fixture(name), sourceId: 'synthetic', sourceSha256: sha, frame: envelopeFrame(), outputPath, attributionText: 'SYNTHETIC' });
  expect(report.totals.triangles).toBe(triangles); expect(report.totals.nodes).toBe(nodes);
  expect(sha256(await readFile(outputPath))).toBe(expectedSha);
});

it('keeps the envelope-frame provenance check, but lets a station-enu frame convert any EPSG:6697 source', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'gteki-station-convert-')); dirs.push(dir);
  const base = { path: fixture('tiny-citygml.xml'), sourceId: 'some-other-source', sourceSha256: 'b'.repeat(64), attributionText: 'SYNTHETIC' };
  await expect(convertCityGmlFile({ ...base, frame: envelopeFrame(), outputPath: join(dir, 'a.glb') })).rejects.toThrow('Frame provenance does not match source bytes');
  const station = await loadFrame('ikebukuro-station-enu-v0');
  const outputPath = join(dir, 'station.glb');
  const report = await convertCityGmlFile({ ...base, frame: station, outputPath });
  expect(report.validation.status).toBe('PASS'); expect(report.totals.triangles).toBe(12);
  // Same fixture, different frame => different local coordinates (station ENU, heights as TP minus hM = 0), not the envelope offset.
  const envelopeOut = join(dir, 'envelope.glb');
  await convertCityGmlFile({ path: base.path, sourceId: 'synthetic', sourceSha256: sha, frame: envelopeFrame(), outputPath: envelopeOut, attributionText: 'SYNTHETIC' });
  expect(sha256(await readFile(outputPath))).not.toBe(sha256(await readFile(envelopeOut)));
  const document = await new NodeIO().readBinary(await readFile(outputPath));
  const extras = document.getRoot().listNodes()[0]!.getExtras();
  expect(extras.frame_id).toBe('ikebukuro-station-enu-v0');
});
