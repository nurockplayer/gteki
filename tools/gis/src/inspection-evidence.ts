import { getStoredSource } from './common.js';
import { verifyPoiEvidence } from './poi.js';
import { toolFingerprint } from './provenance.js';
import { verifyVintageEvidence, type VintageReport } from './vintage.js';

type InputSource = { source_id: string; sha256: string };
type InspectionReport = {
  source_id?: unknown;
  source_sha256?: unknown;
  tool_input_sha256?: unknown;
  input_sources?: unknown;
};

const FACILITIES_ZIP = 'tokyo-shinjuku-facilities-zip';
const FACILITIES_SPEC = 'tokyo-shinjuku-facilities-spec-pdf';
const VINTAGE_PACKAGE = 'plateau-13104-package-2023';

/** Gap packets may use a persisted overlap only with current tool/acquisition lineage. */
export async function assertOverlapReportCurrent(report: unknown, stationId: string, options: { fingerprint?: string } = {}): Promise<void> {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('Malformed overlap report');
  const value = report as { station_id?: unknown; tool_input_sha256?: unknown; input_sources?: unknown };
  if (value.station_id !== stationId) throw new Error('Overlap station identity mismatch');
  if (value.tool_input_sha256 !== (options.fingerprint ?? await toolFingerprint())) throw new Error('Stale overlap tool fingerprint');
  if (!Array.isArray(value.input_sources) || !value.input_sources.length) throw new Error('Overlap report lacks acquisition lineage');
  const seen = new Set<string>();
  for (const input of value.input_sources) {
    if (!input || typeof input.source_id !== 'string' || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256) || seen.has(input.source_id)) throw new Error('Malformed overlap acquisition lineage');
    seen.add(input.source_id);
    if ((await getStoredSource(input.source_id)).record.sha256 !== input.sha256) throw new Error(`Stale overlap input SHA-256: ${input.source_id}`);
  }
}

/** Validate a saved POI receipt against its live acquisition and current tool inputs. */
export async function assertPoiInspectionCurrent(
  report: unknown,
  expectedSourceId: string,
  options: { fingerprint?: string } = {},
): Promise<void> {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error(`POI inspection is malformed: ${expectedSourceId}`);
  const value = report as InspectionReport;
  if (value.source_id !== expectedSourceId) throw new Error(`POI inspection source_id mismatch: expected ${expectedSourceId}`);
  const source = await getStoredSource(expectedSourceId);
  if (value.source_sha256 !== source.record.sha256) throw new Error(`Stale POI inspection source SHA-256: ${expectedSourceId}`);

  const fingerprint = options.fingerprint ?? await toolFingerprint();
  if (value.tool_input_sha256 !== fingerprint) throw new Error(`Stale POI inspection tool fingerprint: ${expectedSourceId}`);

  if (!Array.isArray(value.input_sources)) throw new Error(`POI inspection has no input_sources: ${expectedSourceId}`);
  const seen = new Set<string>();
  let hasOwnSource = false;
  let hasRequiredSpec = false;
  for (const item of value.input_sources) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Malformed POI inspection input source: ${expectedSourceId}`);
    const input = item as Partial<InputSource>;
    if (typeof input.source_id !== 'string' || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) {
      throw new Error(`Malformed POI inspection input source: ${expectedSourceId}`);
    }
    if (seen.has(input.source_id)) throw new Error(`Duplicate POI inspection input source ${input.source_id}: ${expectedSourceId}`);
    seen.add(input.source_id);
    const current = await getStoredSource(input.source_id);
    if (input.sha256 !== current.record.sha256) throw new Error(`Stale POI inspection input source SHA-256: ${input.source_id}`);
    if (input.source_id === expectedSourceId && input.sha256 === source.record.sha256) hasOwnSource = true;
    if (input.source_id === FACILITIES_SPEC && input.sha256 === current.record.sha256) hasRequiredSpec = true;
  }
  if (!hasOwnSource) throw new Error(`POI inspection input_sources omits its own acquisition: ${expectedSourceId}`);
  if (expectedSourceId === FACILITIES_ZIP && !hasRequiredSpec) throw new Error(`POI inspection input_sources omits required S03 specification: ${expectedSourceId}`);

  const evidence = await verifyPoiEvidence(report);
  if (evidence.status !== 'PASS') throw new Error(`POI inspection evidence failed verification: ${expectedSourceId}: ${evidence.errors.join('; ')}`);
}

/** Validate the 2023 vintage receipt's package identity, current inputs, and stored range evidence. */
export async function assertVintageResearchCurrent(
  report: unknown,
  options: { fingerprint?: string } = {},
): Promise<void> {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error('2023 vintage report is malformed');
  const value = report as VintageReport;
  if (value.source_id !== VINTAGE_PACKAGE) throw new Error(`2023 vintage report source_id mismatch: expected ${VINTAGE_PACKAGE}`);
  const packageSource = await getStoredSource(VINTAGE_PACKAGE);
  if (value.package_sha256 !== packageSource.record.sha256) throw new Error('Stale 2023 vintage package SHA-256');

  const fingerprint = options.fingerprint ?? await toolFingerprint();
  if (value.tool_input_sha256 !== fingerprint) throw new Error('Stale 2023 vintage tool fingerprint');
  if (!Array.isArray(value.input_sources) || !value.input_sources.some(input => input?.source_id === VINTAGE_PACKAGE && input.sha256 === packageSource.record.sha256)) {
    throw new Error('2023 vintage input_sources omits its current package acquisition');
  }
  let evidence: { status: 'PASS' | 'FAIL'; errors: string[] };
  try {
    evidence = await verifyVintageEvidence(value);
  } catch (error) {
    throw new Error(`2023 vintage evidence failed verification: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (evidence.status !== 'PASS') throw new Error(`2023 vintage evidence failed verification: ${evidence.errors.join('; ')}`);
}
