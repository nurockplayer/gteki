import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] || '.qa/bench-613';
const runs = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const median = a => { a = a.filter(Number.isFinite).sort((x,y)=>x-y); return a.length ? (a[(a.length-1)>>1]+a[a.length>>1])/2 : null; };
const max = a => { a = a.filter(Number.isFinite); return a.length ? Math.max(...a) : null; };
const fmt = (v, scale=1) => v == null ? '—' : (v/scale).toFixed(1);
const mib = 1048576;
function heap(r) { try { return fs.readFileSync(path.join(dir, `${r.id}.heap.jsonl`),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
const groups = new Map();
for (const r of runs) { const key = `${r.concurrent_heavy}|${r.suite}|${r.variant}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
const passed = r => r.exit_code === 0 && r.valid_report;
// Peaks are kept for failed and OOM-killed runs: a run that hit the limit is a memory result, not a missing one.
const measured = rows => rows.filter(r => r.valid_measurement);
// Deltas pair runs by rep number, so a cold rep is only compared with a cold rep.
function delta(rows, refRows, field) {
  const byRep = new Map(measured(refRows).map(r => [r.rep, r]));
  const pairs = measured(rows).filter(r => byRep.has(r.rep));
  if (!pairs.length) return '—';
  const a = median(pairs.map(r => r.peaks_bytes[field])), b = median(pairs.map(r => byRep.get(r.rep).peaks_bytes[field]));
  return a != null && b ? `${((a/b-1)*100).toFixed(1)}% (n=${pairs.length})` : '—';
}
console.log('Memory columns use every run with valid samples, including failed or OOM-killed runs (see the OOM column); pass rate counts exit 0 with a valid Vitest report. Deltas pair runs by rep number. Worker RSS sums concurrent workers; worker heap is the maximum of individual workers.');
for (const concurrent of [0,1]) {
 if (![...groups.keys()].some(k => Number(k.split('|')[0]) === concurrent)) continue;
 console.log(`\n## ${concurrent ? 'Concurrent heavy job' : 'No concurrent heavy job'}\n`);
 if (concurrent) console.log('與 #156 並行，時間僅供參考\n');
 console.log('| Suite | Variant | n | Pass | OOM kills | Tests passed (median) | Tree peak RSS median / max MiB | cgroup anon peak median / max MiB | cgroup current peak median MiB (incl. page cache) | Worker RSS sum peak MiB | Max per-worker heapUsed MiB | Max main heapUsed MiB | heapTotal MiB | external MiB | elapsed median s | CPU median s | Δ tree RSS vs node24 | Δ tree RSS caged vs node26 |');
 console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
 for (const [key, rows] of groups) {
  const [c,s,v] = key.split('|'); if (Number(c)!==concurrent) continue;
  const m = measured(rows), ok = rows.filter(passed);
  const heaps = m.flatMap(heap); const h = (role, field) => max(heaps.filter(x=>!role || x.role===role).map(x=>x.max?.[field]));
  const ref = variant => groups.get(`${c}|${s}|${variant}`) || [];
  const col = f => m.map(r => r.peaks_bytes[f]);
  console.log(`| ${s} | ${v} | ${rows.length} | ${ok.length}/${rows.length} | ${rows.reduce((n,r)=>n+(r.oom_kill_delta||0),0)} | ${fmt(median(rows.map(r=>r.vitest?.numPassedTests)))} | ${fmt(median(col('total')),mib)} / ${fmt(max(col('total')),mib)} | ${fmt(median(col('cgroup_anon')),mib)} / ${fmt(max(col('cgroup_anon')),mib)} | ${fmt(median(col('cgroup_current')),mib)} | ${fmt(max(col('vitest-worker')),mib)} | ${fmt(h('worker','heapUsed'),mib)} | ${fmt(h('main','heapUsed'),mib)} | ${fmt(h(null,'heapTotal'),mib)} | ${fmt(h(null,'external'),mib)} | ${fmt(median(ok.map(r=>r.elapsed_s)))} | ${fmt(median(ok.map(r=>r.cpu_usec.usage_usec)),1e6)} | ${v==='node24' ? '—' : delta(rows, ref('node24'), 'total')} | ${v==='caged26' ? delta(rows, ref('node26'), 'total') : '—'} |`);
 }
}
