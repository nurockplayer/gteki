import { writeFile } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { mkdir } from 'node:fs/promises';
import { docsRoot, repoRoot } from './common.js';
import { loadLiteralAllowlistFile, storeDetailLiterals } from './poi-literals.js';
import { loadClassBMinusA } from './literals.js';
import { loadStationWindows, profileSpec } from './csv-profile.js';

export async function csvProfileCommand(specs: string[], out: string | undefined): Promise<unknown> {
  if (!specs.length) throw new Error('Provide at least one source_id[:doc_id]');
  const windows = await loadStationWindows();
  const results = [];
  for (const spec of specs) results.push(await profileSpec(spec, windows));
  if (out !== undefined) {
    const target = resolve(repoRoot, out);
    const rel = relative(join(docsRoot, 'gis'), target);
    if (rel.startsWith('..') || !target.endsWith('.md')) throw new Error('--out must be a .md path under docs/gis');
    await mkdir(dirname(target), { recursive: true });
    const { renderProfileMarkdown } = await import('./csv-profile-md.js');
    const allow = await loadLiteralAllowlistFile();
    const poi = await storeDetailLiterals();
    const classB = await loadClassBMinusA();
    const blocked = new Set([...poi.keys(), ...classB.literals.keys()].filter((k) => !allow.terms.has(k)));
    await writeFile(target, renderProfileMarkdown(results, windows, blocked));
    return { written: relative(repoRoot, target), specs: specs.length };
  }
  return { windows: windows.map((w) => ({ station: w.station, basis: w.basis })), results };
}
