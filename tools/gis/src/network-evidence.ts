import { getStoredSource } from './common.js';
import { toolFingerprint } from './provenance.js';

type InputSource = { source_id: string; sha256: string };

/** Validate a saved network inspection against its live acquisition and current tool inputs.
 * A network report may supply bbox/CRS to downstream reports only when its source identity,
 * tool fingerprint and complete input lineage are all current. Kept dependency-free of the
 * POI/vintage modules so both can use it without an import cycle.
 */
export async function assertNetworkInspectionCurrent(
  report: unknown,
  expectedSourceId: string,
  options: { fingerprint?: string; linkSourceId?: string } = {},
): Promise<void> {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error(`Network inspection is malformed: ${expectedSourceId}`);
  const value = report as { source_id?: unknown; source_sha256?: unknown; tool_input_sha256?: unknown; input_sources?: unknown };
  // A node+link pair report carries a combined identity and combined acquisition hash.
  const source = await getStoredSource(expectedSourceId);
  const link = options.linkSourceId ? await getStoredSource(options.linkSourceId) : null;
  const reportSourceId = link ? `${expectedSourceId}+${link.record.source_id}` : expectedSourceId;
  const reportSha = link ? `${source.record.sha256}+${link.record.sha256}` : source.record.sha256;
  if (value.source_id !== reportSourceId) throw new Error(`Network inspection source_id mismatch: expected ${reportSourceId}`);
  if (value.source_sha256 !== reportSha) throw new Error(`Stale network inspection source SHA-256: ${expectedSourceId}`);
  const fingerprint = options.fingerprint ?? await toolFingerprint();
  if (value.tool_input_sha256 !== fingerprint) throw new Error(`Stale network inspection tool fingerprint: ${expectedSourceId}`);
  if (!Array.isArray(value.input_sources) || !value.input_sources.length) throw new Error(`Network inspection lacks acquisition lineage: ${expectedSourceId}`);
  const seen = new Set<string>();
  let hasOwnSource = false, hasLinkSource = !link;
  for (const item of value.input_sources) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`Malformed network inspection input source: ${expectedSourceId}`);
    const input = item as Partial<InputSource>;
    if (typeof input.source_id !== 'string' || typeof input.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(input.sha256)) throw new Error(`Malformed network inspection input source: ${expectedSourceId}`);
    if (seen.has(input.source_id)) throw new Error(`Duplicate network inspection input source ${input.source_id}: ${expectedSourceId}`);
    seen.add(input.source_id);
    const current = await getStoredSource(input.source_id);
    if (input.sha256 !== current.record.sha256) throw new Error(`Stale network inspection input source SHA-256: ${input.source_id}`);
    if (input.source_id === expectedSourceId) hasOwnSource = true;
    if (link && input.source_id === link.record.source_id) hasLinkSource = true;
  }
  if (!hasLinkSource) throw new Error(`Network inspection input_sources omits its link acquisition: ${expectedSourceId}`);
  if (!hasOwnSource) throw new Error(`Network inspection input_sources omits its own acquisition: ${expectedSourceId}`);
}
