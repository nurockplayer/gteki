import fs from 'node:fs';
import path from 'node:path';
const dir = process.argv[2] || '.qa/bench-613';
const runs = fs.readFileSync(path.join(dir, 'runs.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
const median = a => { a = a.filter(Number.isFinite).sort((x,y)=>x-y); return a.length ? (a[(a.length-1)>>1]+a[a.length>>1])/2 : null; };
const max = a => a.length ? Math.max(...a) : null;
const fmt = (v, scale=1) => v == null ? '—' : (v/scale).toFixed(1);
const mib = 1048576;
function heap(r) { try { return fs.readFileSync(path.join(dir, `${r.id}.heap.jsonl`),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse); } catch { return []; } }
const groups = new Map();
for (const r of runs) { const key = `${r.concurrent_heavy}|${r.suite}|${r.variant}`; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(r); }
console.log('Medians and deltas include only successful runs with valid reports and samples; deltas are withheld when test counts differ. Worker RSS sums concurrent workers; worker heap is the maximum of individual workers.');
for (const concurrent of [0,1]) {
 console.log(`\n## ${concurrent ? 'Concurrent heavy job' : 'No concurrent heavy job'}\n`);
 if (concurrent) console.log('與 #156 並行，時間僅供參考\n');
 console.log('| Suite | Variant | n | Pass | Tree peak RSS median / max MiB | cgroup anon peak median / max MiB | cgroup current peak median / max MiB (incl. page cache: repo copy + node_modules) | Worker RSS sum peak MiB | Max per-worker heapUsed MiB | Max main heapUsed MiB | heapTotal MiB | external MiB | elapsed median s | CPU median s | Δ tree RSS vs node24 | Δ tree RSS caged vs node26 |');
 console.log('| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |');
 for (const [key, rows] of groups) {
  const [c,s,v] = key.split('|'); if (Number(c)!==concurrent) continue;
  const measured = rows.filter(r => r.exit_code === 0 && r.valid_report && r.valid_measurement);
  const counts = new Set([...groups.entries()].filter(([k]) => k.split('|').slice(0,2).join('|') === `${c}|${s}`).flatMap(([,rs]) => rs.filter(r => r.exit_code === 0 && r.valid_report && r.valid_measurement).map(r => r.vitest.numTotalTests)));
  const heaps = measured.flatMap(heap); const h = (role, field) => max(heaps.filter(x=>!role || x.role===role).map(x=>x.max?.[field]).filter(Number.isFinite));
  const peak = median(measured.map(r=>r.peaks_bytes.total));
  const ref = variant => median((groups.get(`${c}|${s}|${variant}`)||[]).filter(r=>r.exit_code===0 && r.valid_report && r.valid_measurement).map(r=>r.peaks_bytes.total));
  const delta = (a,b) => counts.size === 1 && a != null && b ? `${((a/b-1)*100).toFixed(1)}%` : '—';
  console.log(`| ${s} | ${v} | ${rows.length} | ${measured.length}/${rows.length} | ${fmt(peak,mib)} / ${fmt(max(measured.map(r=>r.peaks_bytes.total).filter(Number.isFinite)),mib)} | ${fmt(median(measured.map(r=>r.peaks_bytes.cgroup_anon)),mib)} / ${fmt(max(measured.map(r=>r.peaks_bytes.cgroup_anon).filter(Number.isFinite)),mib)} | ${fmt(median(measured.map(r=>r.peaks_bytes.cgroup_current)),mib)} / ${fmt(max(measured.map(r=>r.peaks_bytes.cgroup_current).filter(Number.isFinite)),mib)} | ${fmt(max(measured.map(r=>r.peaks_bytes['vitest-worker']).filter(v=>Number.isFinite(v) && v>0)),mib)} | ${fmt(h('worker','heapUsed'),mib)} | ${fmt(h('main','heapUsed'),mib)} | ${fmt(h(null,'heapTotal'),mib)} | ${fmt(h(null,'external'),mib)} | ${fmt(median(measured.map(r=>r.elapsed_s)))} | ${fmt(median(measured.map(r=>r.cpu_usec.usage_usec)),1e6)} | ${delta(peak,ref('node24'))} | ${v==='caged26' ? delta(peak,ref('node26')) : '—'} |`);
 }
}
