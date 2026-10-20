/** Every exported verdict carries its bounded scope and exclusions with it. */
export function projectRights(report: { source_id: string; source_sha256: string }, row: any) {
  return { source_id: report.source_id, source_sha256: report.source_sha256, layer: row.layer,
    scope: row.scope, third_party_exclusions: row.third_party_exclusions, not_covered: row.not_covered,
    ...(row.field_scope ? { field_scope: row.field_scope } : {}),
    verdict: row.verdict, reason: row.reason, evidence_ids: row.evidence.map((e: any) => e.id),
    missing_evidence: row.missing_evidence, publish_gate: row.publish_gate, routable: row.routable };
}

/** Safe both in a Markdown table cell and a list item; no limitation is implicit. */
export function rightsScopeMarkdown(row: any): string {
  return `Scope: ${row.scope}. Third-party exclusions: ${JSON.stringify(row.third_party_exclusions)}. Not covered: ${JSON.stringify(row.not_covered)}.${row.field_scope ? ` Field scope: ${JSON.stringify(row.field_scope)}.` : ''}`
    .replaceAll('|', '\\|').replace(/\r?\n/gu, ' ');
}
