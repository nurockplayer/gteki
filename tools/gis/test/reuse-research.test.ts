import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { packageRoot } from '../src/common.js';

/**
 * Pins how REUSE.toml resolves the research-data folders (gteki-1b ruling, 2026-10-24). This is a minimal reader for
 * the annotation subset REUSE.toml uses (string or string-array `path`, one identifier); the last matching annotation
 * wins, `**` matches across directories and `*` within one. `reuse lint` / `reuse spdx` stay the authority.
 */
function annotations(): Array<{ paths: string[]; licence: string }> {
  const text = readFileSync(join(packageRoot, '..', '..', 'REUSE.toml'), 'utf8');
  return text.split(/^\[\[annotations\]\]$/mu).slice(1).map((block) => {
    const pathMatch = /^path\s*=\s*(\[[\s\S]*?\]|"[^"]*")/mu.exec(block);
    const licenceMatch = /^SPDX-License-Identifier\s*=\s*"([^"]*)"/mu.exec(block);
    if (!pathMatch || !licenceMatch) throw new Error('unparsed REUSE annotation block');
    const paths = [...pathMatch[1]!.matchAll(/"([^"]*)"/gu)].map((m) => m[1]!);
    return { paths, licence: licenceMatch[1]! };
  });
}

function globToRegExp(glob: string): RegExp {
  const body = glob.split('**').map((part) => part.split('*').map((s) => s.replace(/[.+?^${}()|[\]\\]/gu, '\\$&')).join('[^/]*')).join('.*');
  return new RegExp(`^${body}$`, 'u');
}

function resolve(path: string): string | null {
  let licence: string | null = null;
  for (const a of annotations()) if (a.paths.some((g) => globToRegExp(g).test(path))) licence = a.licence;
  return licence;
}

describe('REUSE resolution of research data', () => {
  it('sends every file under the research-data folders to the facts-only marker, never Apache-2.0', () => {
    for (const path of ['docs/research/merchants/x.json', 'docs/research/lines/a/b.md', 'docs/research/facilities/y.json']) {
      expect(resolve(path)).toBe('LicenseRef-facts-only-no-licence');
    }
  });

  it('keeps exact-path dataset blocks above the fallback', () => {
    expect(resolve('docs/research/merchants/shinjuku-merchants-batch1.json')).toBe('LicenseRef-Toei-S10 AND LicenseRef-facts-only-no-licence');
    expect(resolve('docs/research/merchants/shinjuku-merchants-batch1-log.md')).toBe('LicenseRef-Toei-S10 AND LicenseRef-facts-only-no-licence');
  });

  it('leaves other research notes on the project default', () => {
    expect(resolve('docs/research/gaps/some-note.md')).toBe('Apache-2.0');
  });
});
