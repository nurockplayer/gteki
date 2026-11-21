// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { renderJourney, validatePlan } from './build.mjs';

it('rejects PASS when its judge, date or evidence is missing', () => {
  for (const field of ['judge', 'verified_at', 'verified_sha', 'evidence']) {
    const plan = parse(fs.readFileSync(new URL('../../docs/release/plan.yaml', import.meta.url), 'utf8'));
    const row = plan.workstreams[0].criteria.find((row: { status: string }) => row.status === 'PASS');
    row[field] = field === 'evidence' ? [] : null;
    expect(() => validatePlan(plan)).toThrow();
  }
});

it('generates statuses and preserves everything outside the journey table', () => {
  const before = 'Intro\n| # | When | old |\n|---|---|---|\n| J1 | old | old |\nProse immediately after\n';
  const rows = [{ id: 'J1', context: 'now', requirement: 'first\nsecond', judge: 'person', status: 'FAIL', status_detail: 'Evidence' }];
  const result = renderJourney(before, rows);
  expect(result).toContain('| J1 | now | first second | person | FAIL | Evidence |');
  expect(result.startsWith('Intro\n')).toBe(true);
  expect(result.endsWith('\nProse immediately after\n')).toBe(true);
  expect(renderJourney(result, rows)).toBe(result);
  expect(renderJourney(result.replace('| FAIL |', '| PASS |'), rows)).not.toBe(result.replace('| FAIL |', '| PASS |'));
});
