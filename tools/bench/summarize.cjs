const fs = require('node:fs');
const e = process.env, dir = e.BENCH_OUT, id = e.BENCH_ID;
const read = suffix => fs.readFileSync(`${dir}/${id}.${suffix}`, 'utf8');
const stats = suffix => Object.fromEntries(read(suffix).trim().split('\n').map(s => s.split(/\s+/)).map(([k, v]) => [k, Number(v)]));
const before = stats('cpu-before'), after = stats('cpu-after'), eb = stats('events-before'), ea = stats('events-after');
const lines = read('samples.tsv').trim().split('\n'); const names = lines.shift().split('\t'); const peaks = {};
for (const line of lines) line.split('\t').forEach((v, i) => { if (i) peaks[names[i]] = Math.max(peaks[names[i]] || 0, Number(v)); });
let vitest = null; try { const v = JSON.parse(read('vitest.json')); vitest = Object.fromEntries(['numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numPendingTestSuites','numTotalTests','numPassedTests','numFailedTests','numPendingTests'].map(k => [k,v[k]])); } catch {}
const cpu = {}; for (const k of ['usage_usec','user_usec','system_usec']) cpu[k] = (after[k] || 0) - (before[k] || 0);
const heapPrefix = `${id}.heap.`;
const heapRows = fs.readdirSync(dir).filter(name => name.startsWith(heapPrefix) && /^\d+\.json$/.test(name.slice(heapPrefix.length))).flatMap(name => { try { return [JSON.parse(fs.readFileSync(`${dir}/${name}`, 'utf8'))]; } catch { return []; } });
fs.writeFileSync(`${dir}/${id}.heap.jsonl`, heapRows.map(row => JSON.stringify(row)).join('\n') + (heapRows.length ? '\n' : ''));
for (const name of fs.readdirSync(dir).filter(name => name.startsWith(heapPrefix) && /^\d+\.json$/.test(name.slice(heapPrefix.length)))) fs.unlinkSync(`${dir}/${name}`);
const row = { id, variant:e.BENCH_VARIANT, image_digest:e.BENCH_IMAGE_DIGEST, node:process.version, arch:process.arch, suite:e.BENCH_SUITE, rep:Number(e.BENCH_REP), temperature:Number(e.BENCH_REP)===1?'cold':'warm', memory_limit:e.BENCH_MEMORY, cpus:Number(e.BENCH_CPUS), concurrent_heavy:Number(e.BENCH_CONCURRENT_HEAVY), started_at_utc:new Date(Date.now()-Number(e.BENCH_ELAPSED)*1000).toISOString(), elapsed_s:Number(e.BENCH_ELAPSED), exit_code:Number(e.BENCH_EXIT), valid_report:!!vitest && Number.isFinite(vitest.numTotalTests) && vitest.numTotalTests > 0, valid_measurement:lines.length > 0 && peaks.total > 0 && peaks.cgroup_current > 0, cgroup_baseline_bytes:Number(e.BENCH_BASE), memory_peak_reset:e.BENCH_PEAK_RESET==='true', peak_source:'sampler', peaks_bytes:peaks, cpu_usec:cpu, oom_kill_delta:(ea.oom_kill||0)-(eb.oom_kill||0), vitest };
fs.appendFileSync(`${dir}/runs.jsonl`, JSON.stringify(row)+'\n');

if (!vitest || !Number.isFinite(vitest.numTotalTests) || vitest.numTotalTests < 1) { console.error('Invalid or empty Vitest report'); process.exitCode = 1; }
if (!row.valid_measurement) { console.error('Missing process or cgroup samples'); process.exitCode = 1; }
