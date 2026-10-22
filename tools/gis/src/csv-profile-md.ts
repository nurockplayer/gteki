import type { StationWindow, Profile, CsvProfile, ZipProfile, PackageFacts, Verdict } from './csv-profile.js';

type Result = { spec: string; catalog_id: string | null; sha256: string; bytes: number; profile: Profile | null; error: string | null; package: PackageFacts | null; verdict: Verdict };

const fmt = (n: number): string => n.toLocaleString('en-US');
const num = (n: number): string => String(Math.round(n * 1e6) / 1e6);
let blocked: ReadonlySet<string> = new Set();
/** A column name that contains a guarded literal (a controlled-vocabulary or POI value elsewhere in the store) is described, not quoted. */
const colName = (name: string, index: number): string => (name.startsWith('(') || ![...blocked].some((b) => name.includes(b)) ? name : `(column ${index + 1}: name withheld by the literal guard, ${name.length} characters)`);
const cols = (names: string[]): string => names.map((c, i) => `\`${colName(c, i)}\``).join(', ');
const cell = (v: string): string => v.replace(/\|/gu, '\\|');
const bbox = (b: CsvProfile['coordinates']['bbox']): string => (b ? `lon ${num(b.lon_min)} to ${num(b.lon_max)}, lat ${num(b.lat_min)} to ${num(b.lat_max)}` : 'none');

/**
 * ZIP member details carry text that never passed the CSV column guard: DBF `field_names`, a `.prj` CRS
 * name, error strings. Every string (and object key) goes through `colName` before serialisation, so a
 * guarded literal cannot be written to docs/gis through a ZIP member.
 */
function guardDetail(value: unknown, counter: { n: number }): unknown {
  if (typeof value === 'string') return colName(value, counter.n++);
  if (Array.isArray(value)) return value.map((v) => guardDetail(v, counter));
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[colName(k, counter.n++)] = guardDetail(v, counter);
    return out;
  }
  return value;
}

function csvSection(r: Result, p: CsvProfile): string[] {
  const out: string[] = [];
  out.push(`### ${r.spec}${r.catalog_id ? ` (${r.catalog_id})` : ''}`, '');
  out.push(`- File: ${fmt(r.bytes)} bytes, SHA-256 \`${r.sha256}\`.`);
  out.push(`- Encoding: ${p.encoding}; delimiter: ${p.delimiter}; data rows: ${fmt(p.rows)}; rows with a different cell count from the header: ${p.ragged_rows}.`);
  out.push(`- Columns (${p.columns.length}): ${cols(p.columns)}.`);
  out.push(`- Latitude columns: ${p.lat_columns.length ? p.lat_columns.map((c) => `\`${c}\``).join(', ') : 'none'}; longitude columns: ${p.lon_columns.length ? p.lon_columns.map((c) => `\`${c}\``).join(', ') : 'none'}.`);
  if (p.crs_columns.length) {
    for (const c of p.crs_values) out.push(`- CRS column \`${c.column}\`: ${c.distinct === 0 ? 'every row blank, so no CRS is declared' : c.values ? `distinct values ${c.values.map((v) => `\`${v.value}\` (${v.rows} rows)`).join(', ')}` : `${c.distinct} distinct values (not listed)`}.`);
  } else out.push('- CRS column: none; the file declares no CRS (UNKNOWN).');
  out.push(`- Coordinates: ${fmt(p.coordinates.valid_rows)} valid rows, ${fmt(p.coordinates.blank_rows)} blank, ${fmt(p.coordinates.invalid_rows)} invalid. Bbox (as labelled by the columns): ${bbox(p.coordinates.bbox)}.`);
  out.push(`- Axis check: ${p.axis_swap.verdict} (${p.axis_swap.as_is_in_japan} rows inside the Japan box as labelled, ${p.axis_swap.swapped_in_japan} only if the columns are swapped, ${p.axis_swap.as_is_in_tokyo_box} inside the Tokyo sanity box).`);
  out.push('');
  out.push('| Station window | Rows in window | Rows in origin disc | Rows within 500 m of origin | Rows within 1,000 m of origin | Rows in window if axes were swapped |', '| --- | --- | --- | --- | --- | --- |');
  for (const w of p.windows) out.push(`| ${w.station} | ${w.in_window} | ${w.in_origin_disc} | ${w.within_500m_of_origin} | ${w.within_1000m_of_origin} | ${w.in_window_if_axes_swapped} |`);
  out.push('');
  return out;
}

function zipSection(r: Result, p: ZipProfile): string[] {
  const out: string[] = [];
  out.push(`### ${r.spec}${r.catalog_id ? ` (${r.catalog_id})` : ''}`, '');
  out.push(`- File: ${fmt(r.bytes)} bytes, SHA-256 \`${r.sha256}\`.`);
  out.push(`- Members by format: ${Object.entries(p.formats).map(([k, v]) => `${k} x ${v}`).join(', ')}. Holds vector data (shapefile or GeoJSON): ${p.holds_vector_data}. Coordinate tables (CSV with valid lon/lat rows): ${p.coordinate_tables}.`);
  out.push('', '| Member format | Bytes | Facts |', '| --- | --- | --- |');
  for (const m of p.members) {
    const d = m.detail as Record<string, unknown> | null;
    let facts = '';
    if (d?.profile) {
      const c = d.profile as CsvProfile;
      facts = `${c.encoding}; ${fmt(c.rows)} rows; ${c.columns.length} columns; valid coordinates ${c.coordinates.valid_rows}; bbox ${bbox(c.coordinates.bbox)}; axis ${c.axis_swap.verdict}; rows in window ${c.windows.map((w) => `${w.station} ${w.in_window}`).join(', ')}; within 1,000 m ${c.windows.map((w) => `${w.station} ${w.within_1000m_of_origin}`).join(', ')}; columns: ${cols(c.columns)}`;
    } else if (d) facts = cell(JSON.stringify(guardDetail(d, { n: 0 })));
    out.push(`| ${m.format} | ${fmt(m.bytes)} | ${cell(facts)} |`);
  }
  out.push('');
  return out;
}

export function renderProfileMarkdown(results: Result[], windows: StationWindow[], blockedLiterals: ReadonlySet<string> = new Set()): string {
  blocked = blockedLiterals;
  const L: string[] = [];
  L.push('# Municipal and R9 evidence profile (generated)', '');
  L.push('Generated by `gis csv-profile` from the hashed bytes in the private store, offline. Evidence only: every source has publish gate HOLD, nothing is converted or placed. This file holds counts, column names, CRS declarations, bbox numbers and hashes only; no row value, facility, station, shelter or road name, address or code appears in it. A header longer than 40 characters is described, not quoted.', '');
  L.push('## Station windows used', '');
  L.push('| Station | Origin lat, lon (station.json) | Window basis |', '| --- | --- | --- |');
  for (const w of windows) L.push(`| ${w.station} | ${w.origin.lat}, ${w.origin.lon} | ${w.basis} |`);
  L.push('', 'A CSV row is in the window when its point lies inside any disc; a vector feature is in it when any segment meets a disc (so a road crossing the disc with both ends outside counts) or a polygon ring encloses a disc, in the station ENU frame. "Origin disc" counts only the disc around the station origin. Counts "within 500 m / 1,000 m" are plain distance from the origin and are context, not a window rule. Both stations use their `profile.window`: one 700 m origin disc (the director\'s decision, the same radius as the context overlay clip). The building `window` spec is unchanged and not used here.', '');
  L.push('## Licence evidence in the snapshots', '');
  L.push('| Source | Dataset-level licence_id | Resource licence values | Portal terms snapshot (bytes, SHA-256) | Terms state CC BY 4.0 | Terms is a closure notice | Terms carry the note-exclusion clause |', '| --- | --- | --- | --- | --- | --- | --- |');
  for (const r of results) if (r.package) L.push(`| ${r.spec} | ${r.package.license_id ?? 'absent'} | ${r.package.resource_licenses.map((x) => x ?? 'null').join(', ')} | ${r.package.terms_bytes === null ? 'not snapshotted' : `${fmt(r.package.terms_bytes)}, \`${r.package.terms_sha256}\``} | ${r.package.terms_states_cc_by_4_0 ?? 'n/a'} | ${r.package.terms_is_closure_notice ?? 'n/a'} | ${r.package.terms_has_exclusion_note_clause ?? 'n/a'} |`);
  L.push('', '## Per-file profiles', '');
  for (const r of results) {
    if (r.error) { L.push(`### ${r.spec}`, '', `- Not readable: ${r.error}.`, ''); continue; }
    if (!r.profile) continue;
    L.push(...(r.profile.kind === 'csv' ? csvSection(r, r.profile) : zipSection(r, r.profile)));
  }
  L.push('## Verdicts (rule: reassessment note section 7.5 item 5, sections 4.5 and 4.6)', '');
  L.push('`CLEAN_CANDIDATE` needs the dataset-level CC BY 4.0 in the snapshot (and the portal terms), lat/lon columns or vector members, a stated CRS or a passing bbox sanity check with the CRS recorded as UNKNOWN, and a window count above 0. Every verdict is evidence-only; the publish gate stays HOLD.', '');
  L.push('| Source | Verdict | Reason |', '| --- | --- | --- |');
  for (const r of results) L.push(`| ${r.spec} | ${r.verdict.verdict} | ${cell(r.verdict.reasons.join('; '))} |`);
  L.push('');
  return L.join('\n');
}
