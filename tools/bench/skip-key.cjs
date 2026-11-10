const fs = require('node:fs');

function shouldSkip(rows, { suite, variant, rep, memory, files, wallS }) {
  return rows.some(row => row.suite === suite && row.variant === variant && row.rep === rep
    && row.memory_limit === memory && (row.files ?? '') === files
    && (row.wall_s ?? null) === wallS && row.timedOut !== true);
}

function nextAttempt(rows, id) {
  const count = rows.filter(row => row?.id === id || row?.id?.startsWith(`${id}-a`)).length;
  return count ? count + 1 : null;
}

module.exports = { shouldSkip, nextAttempt };

if (require.main === module) {
  const args = process.argv.slice(2);
  const attemptMode = args[0] === '--attempt';
  if (attemptMode) args.shift();
  const [path, suite, variant, rep, memory, files, wallS] = args;
  let rows = [];
  try {
    rows = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {}
  if (attemptMode) {
    const attempt = nextAttempt(rows, suite);
    if (attempt !== null) console.log(attempt);
  } else {
    const wall = wallS ? Number(wallS) : null;
    process.exitCode = shouldSkip(rows, { suite, variant, rep: Number(rep), memory, files, wallS: wall }) ? 0 : 1;
  }
}
