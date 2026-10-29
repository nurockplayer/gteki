// Best-effort telemetry; never interfere with the test process.
try {
  const fs = require('node:fs');
  const v8 = require('node:v8');
  const { PerformanceObserver } = require('node:perf_hooks');
  const args = process.argv.join(' ');
  const role = /vitest.*(worker|forks)|tinypool|pool-runner/i.test(args) ? 'worker' : /vitest/i.test(args) ? 'main' : 'other';
  const max = {}; let gcCount = 0;
  const sample = () => { try { const m = process.memoryUsage(); m.heap_size_limit = v8.getHeapStatistics().heap_size_limit; for (const [k, v] of Object.entries(m)) max[k] = Math.max(max[k] || 0, v); } catch {} };
  try { const observer = new PerformanceObserver(list => { gcCount += list.getEntries().length; }); observer.observe({ entryTypes: ['gc'] }); } catch {}
  sample(); setInterval(sample, 250).unref();
  process.on('exit', () => { try { sample(); fs.appendFileSync(process.env.BENCH_HEAP_FILE, JSON.stringify({ pid: process.pid, ppid: process.ppid, role, argv: process.argv.slice(0, 3).map(a => a.slice(-120)), max, gcCount }) + '\n'); } catch {} });
} catch {}
