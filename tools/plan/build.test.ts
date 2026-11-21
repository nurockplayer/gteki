// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from 'node:fs';
import { parse } from 'yaml';
import { expect, it } from 'vitest';
import { validatePlan } from './build.mjs';

it('rejects PASS when its judge, date or evidence is missing', () => {
  for (const field of ['judge', 'verified_at', 'verified_sha', 'evidence']) {
    const plan = parse(fs.readFileSync(new URL('../../docs/release/plan.yaml', import.meta.url), 'utf8'));
    const row = plan.workstreams[0].criteria.find((row: { status: string }) => row.status === 'PASS');
    row[field] = field === 'evidence' ? [] : null;
    expect(() => validatePlan(plan)).toThrow();
  }
});
