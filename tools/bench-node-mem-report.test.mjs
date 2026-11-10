import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

const tempDirs = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('node-mem-report', () => {
  it('groups configurations and pairs deltas only with the matching configuration', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'node-mem-report-'));
    tempDirs.push(dir);
    const run = (id, variant, files, total) => ({
      id, concurrent_heavy: 1, suite: 'heavy', variant, memory_limit: '3g', files, wall_s: 5400,
      rep: 1, valid_measurement: true, valid_report: true, exit_code: 0,
      peaks_bytes: { total }, vitest: { numPassedTests: 1 }, elapsed_s: 1,
      cpu_usec: { usage_usec: 1 },
    });
    fs.writeFileSync(path.join(dir, 'runs.jsonl'), [
      run('a24', 'node24', 'a.test.ts', 100),
      run('b24', 'node24', 'b.test.ts', 300),
      run('a26', 'node26', 'a.test.ts', 200),
    ].map(row => JSON.stringify(row)).join('\n'));

    const report = execFileSync(process.execPath, [
      path.resolve('tools/bench/node-mem-report.mjs'), dir,
    ], { encoding: 'utf8' });
    const rows = report.split('\n').filter(line => line.startsWith('| heavy ('));
    const node24 = rows.filter(line => line.includes('| node24 |'));
    const node26 = rows.find(line => line.includes('| node26 |'));
    expect(node24).toHaveLength(2);
    expect(node24.some(line => line.includes('files: a.test.ts'))).toBe(true);
    expect(node24.some(line => line.includes('files: b.test.ts'))).toBe(true);
    expect(node26).toContain('files: a.test.ts');
    expect(node26).toContain('100.0% (n=1)');
  });
});
