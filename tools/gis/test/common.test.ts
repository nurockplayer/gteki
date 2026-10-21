import { describe, expect, it } from 'vitest';
import { assertRecordMatchesManifest, getGitCommit, type AcquisitionRecord, type SourceManifest } from '../src/common.js';
import { selectCatalogResource } from '../src/acquire.js';

describe('provenance', () => {
  it('records the git commit using git directly, without any wrapper executable', async () => {
    // Runs inside the repository checkout; a missing git binary or repository would return null.
    expect(await getGitCommit()).toMatch(/^[a-f0-9]{40,64}$/);
  });
});

describe('cached acquisitions follow the manifest', () => {
  const source = { source_id: 'synthetic', resolution: { kind: 'direct' }, expected_url: 'https://example.test/a.csv',
    supporting_documents: [{ id: 'terms', url: 'https://example.test/terms' }] } as unknown as SourceManifest;
  const record = { source_id: 'synthetic', resolved_url: 'https://example.test/a.csv', resolution_evidence: null,
    supporting_documents: [{ id: 'terms', url: 'https://example.test/terms', requested_url: 'https://example.test/terms', sha256: 'a'.repeat(64), bytes: 1, store_path: 'raw/x/terms' }] } as unknown as AcquisitionRecord;
  it('accepts a record that still answers the manifest', async () => {
    await expect(assertRecordMatchesManifest(record, source)).resolves.toBeUndefined();
  });
  it('rejects a changed direct URL or supporting-document list', async () => {
    await expect(assertRecordMatchesManifest(record, { ...source, expected_url: 'https://example.test/b.csv' })).rejects.toThrow(/no longer matches the manifest/);
    await expect(assertRecordMatchesManifest(record, { ...source, supporting_documents: [{ id: 'terms', url: 'https://example.test/terms-v2' }] })).rejects.toThrow(/Supporting documents/);
    await expect(assertRecordMatchesManifest(record, { ...source, supporting_documents: [] })).rejects.toThrow(/Supporting documents/);
  });
  it('rejects a catalog-resolved record bound to another catalog', async () => {
    const catalogSource = { ...source, resolution: { kind: 'plateau_catalog_api', catalog_source_id: 'catalog-b', match: 'x' } } as unknown as SourceManifest;
    await expect(assertRecordMatchesManifest({ ...record, resolution_evidence: { source_id: 'catalog-a', sha256: 'b'.repeat(64), json_pointer: '/x' } }, catalogSource)).rejects.toThrow(/not resolved from catalog catalog-b/);
  });
  it('re-runs the catalog selector, so a changed match selects a different resource', () => {
    const payload = { cities: [{ cityCode: '13104', metadataZipUrls: ['https://example.test/x_codelists.zip', 'https://example.test/x_schemas.zip'] }] };
    const selector = (match: string) => ({ source_id: 'plateau-13104-synthetic', resolution: { kind: 'plateau_catalog_api', catalog_source_id: 'catalog', match } }) as unknown as SourceManifest;
    expect(selectCatalogResource(selector('_codelists.zip'), payload)).toEqual({ value: 'https://example.test/x_codelists.zip', pointer: '/cities/0/metadataZipUrls/0' });
    expect(selectCatalogResource(selector('_schemas.zip'), payload).pointer).toBe('/cities/0/metadataZipUrls/1');
    expect(() => selectCatalogResource(selector('_missing.zip'), payload)).toThrow(/did not contain/);
  });
});
