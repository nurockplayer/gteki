import { describe, expect, it } from 'vitest';
import { getGitCommit } from '../src/common.js';

describe('provenance', () => {
  it('records the git commit using git directly, without any wrapper executable', async () => {
    // Runs inside the repository checkout; a missing git binary or repository would return null.
    expect(await getGitCommit()).toMatch(/^[a-f0-9]{40,64}$/);
  });
});
