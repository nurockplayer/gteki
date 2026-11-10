const fs = require('node:fs');

function shouldSkip(rows, { suite, variant, rep, memory, files, wallS }) {
  return rows.some(row => row.suite === suite && row.variant === variant && row.rep === rep
    && row.memory_limit === memory && (row.files ?? '') === files
    && (row.wall_s ?? null) === wallS && row.timedOut !== true);
}

function nextAttempt(dir, base) {
  const names = fs.readdirSync(dir);
  if (!names.some(name => name.startsWith(`${base}.`))) return null;
  let attempt = 2;
  while (names.some(name => name.startsWith(`${base}-a${attempt}.`))) attempt++;
  return attempt;
}

module.exports = { shouldSkip, nextAttempt };

if (require.main === module) {
  const args = process.argv.slice(2);
  const attemptMode = args[0] === '--attempt';
  if (attemptMode) args.shift();
  if (attemptMode) {
    try {
      const attempt = nextAttempt(args[0], args[1]);
      if (attempt !== null) console.log(attempt);
    } catch {}
  } else {
    const [path, suite, variant, rep, memory, files, wallS] = args;
  let rows = [];
  try {
    rows = fs.readFileSync(path, 'utf8').split('\n').filter(Boolean).flatMap(line => {
      try { return [JSON.parse(line)]; } catch { return []; }
    });
  } catch {}
    const wall = wallS ? Number(wallS) : null;
    process.exitCode = shouldSkip(rows, { suite, variant, rep: Number(rep), memory, files, wallS: wall }) ? 0 : 1;
  }
}
