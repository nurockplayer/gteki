// Best-effort telemetry; never interfere with the test process.
try {
  const fs = require('node:fs');
  const path = require('node:path');
  const v8 = require('node:v8');
  const { PerformanceObserver } = require('node:perf_hooks');
  const script = (process.argv[1] || '').split('/').slice(-2).join('/');
  const role = script === 'workers/forks.js' ? 'worker' : path.basename(script) === 'vitest.mjs' ? 'main' : 'other';
  const max = {}; let gcCount = 0;
  const sample = () => { try { const m = process.memoryUsage(); m.heap_size_limit = v8.getHeapStatistics().heap_size_limit; for (const [k, v] of Object.entries(m)) max[k] = Math.max(max[k] || 0, v); } catch {} };
  const flush = () => { try { sample(); fs.writeFileSync(`${process.env.BENCH_HEAP_FILE.slice(0, -6)}.${process.pid}.json`, JSON.stringify({ pid: process.pid, ppid: process.ppid, role, argv: process.argv.slice(0, 3).map(a => a.slice(-120)), max, gcCount })); } catch {} };
  try { const observer = new PerformanceObserver(list => { gcCount += list.getEntries().length; }); observer.observe({ entryTypes: ['gc'] }); } catch {}
  flush(); setInterval(sample, 250).unref(); setInterval(flush, 1000).unref();
  process.on('exit', flush);
  process.on('disconnect', flush);
  process.on('SIGTERM', function onTerm() { flush(); process.removeListener('SIGTERM', onTerm); if (process.listenerCount('SIGTERM') === 0) process.kill(process.pid, 'SIGTERM'); });
} catch {}
