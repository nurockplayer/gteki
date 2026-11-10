const fs = require('node:fs');

function shouldSkip(rows, { suite, variant, rep, memory, files, wallS }) {
  return rows.some(row => row.suite === suite && row.variant === variant && row.rep === rep
    && row.memory_limit === memory && (row.files ?? '') === files
    && (row.wall_s ?? null) === wallS && row.timedOut !== true);
}

module.exports = { shouldSkip };

if (require.main === module) {
  const [path, suite, variant, rep, memory, files, wallS] = process.argv.slice(2);
  let rows = [];
  try {
    rows = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {}
  const wall = wallS ? Number(wallS) : null;
  process.exitCode = shouldSkip(rows, { suite, variant, rep: Number(rep), memory, files, wallS: wall }) ? 0 : 1;
}
