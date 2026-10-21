import { getStoredSource } from './common.js';
import { toolFingerprint } from './provenance.js';

export type RightsEvidenceRef = { source_id: string; sha256: string; where: string };

/** Every hashed evidence reference a rights report carries, including supporting-document hashes. */
export function rightsEvidenceItems(report: unknown): RightsEvidenceRef[] {
  if (!report || typeof report !== 'object') return [];
  const value = report as { evidence?: unknown; declarations?: unknown; publication_period_notes?: unknown };
  const items: RightsEvidenceRef[] = [];
  const push = (item: unknown, where: string) => {
    const ref = item as { source_id?: unknown; sha256?: unknown } | null;
    if (!ref || typeof ref.source_id !== 'string' || typeof ref.sha256 !== 'string' || !/^[a-f0-9]{64}$/.test(ref.sha256)) throw new Error(`Malformed rights evidence reference: ${where}`);
    items.push({ source_id: ref.source_id, sha256: ref.sha256, where });
  };
  if (Array.isArray(value.evidence)) value.evidence.forEach((item, index) => push(item, `evidence/${index}`));
  if (Array.isArray(value.declarations)) value.declarations.forEach((item, index) => push((item as { evidence?: unknown } | null)?.evidence, `declarations/${index}/evidence`));
  if (Array.isArray(value.publication_period_notes)) value.publication_period_notes.forEach((item, index) => push(item, `publication_period_notes/${index}`));
  return items;
}

/** A rights report is usable only while every evidence hash still names a current acquisition
 * (the acquired file itself or one of its recorded supporting documents), under the current tool.
 */
export async function assertRightsReportCurrent(report: unknown, expectedSourceId: string, options: { fingerprint?: string } = {}): Promise<void> {
  if (!report || typeof report !== 'object' || Array.isArray(report)) throw new Error(`Rights report is malformed: ${expectedSourceId}`);
  const value = report as { source_id?: unknown; source_sha256?: unknown; tool_input_sha256?: unknown };
  if (value.source_id !== expectedSourceId) throw new Error(`Rights report source_id mismatch: expected ${expectedSourceId}`);
  if (value.tool_input_sha256 !== (options.fingerprint ?? await toolFingerprint())) throw new Error(`Stale rights tool fingerprint: ${expectedSourceId}`);
  if ((await getStoredSource(expectedSourceId)).record.sha256 !== value.source_sha256) throw new Error(`Stale rights source SHA-256: ${expectedSourceId}`);
  for (const item of rightsEvidenceItems(report)) {
    const current = (await getStoredSource(item.source_id)).record;
    if (item.sha256 !== current.sha256 && !current.supporting_documents?.some((document: { sha256: string }) => document.sha256 === item.sha256))
      throw new Error(`Stale rights evidence ${item.where} for ${expectedSourceId}: ${item.source_id} no longer has SHA-256 ${item.sha256}`);
  }
}
