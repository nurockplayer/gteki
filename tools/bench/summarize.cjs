const fs = require('node:fs');
const e = process.env, dir = e.BENCH_OUT, id = e.BENCH_ID;
const read = suffix => fs.readFileSync(`${dir}/${id}.${suffix}`, 'utf8');
const stats = suffix => Object.fromEntries(read(suffix).trim().split('\n').map(s => s.split(/\s+/)).map(([k, v]) => [k, Number(v)]));
const before = stats('cpu-before'), after = stats('cpu-after'), eb = stats('events-before'), ea = stats('events-after');
const lines = read('samples.tsv').trim().split('\n'); const names = lines.shift().split('\t'); const peaks = {};
for (const line of lines) line.split('\t').forEach((v, i) => { if (i) peaks[names[i]] = Math.max(peaks[names[i]] || 0, Number(v)); });
let vitest = null; try { const v = JSON.parse(read('vitest.json')); vitest = Object.fromEntries(['numTotalTestSuites','numPassedTestSuites','numFailedTestSuites','numTotalTests','numPassedTests','numFailedTests','numPendingTests'].map(k => [k,v[k]])); } catch {}
const cpu = {}; for (const k of ['usage_usec','user_usec','system_usec']) cpu[k] = (after[k] || 0) - (before[k] || 0);
const row = { id, variant:e.BENCH_VARIANT, image_digest:e.BENCH_IMAGE_DIGEST, node:process.version, arch:process.arch, suite:e.BENCH_SUITE, rep:Number(e.BENCH_REP), temperature:Number(e.BENCH_REP)===1?'cold':'warm', memory_limit:e.BENCH_MEMORY, cpus:Number(e.BENCH_CPUS), concurrent_heavy:Number(e.BENCH_CONCURRENT_HEAVY), started_at_utc:new Date(Date.now()-Number(e.BENCH_ELAPSED)*1000).toISOString(), elapsed_s:Number(e.BENCH_ELAPSED), exit_code:Number(e.BENCH_EXIT), cgroup_baseline_bytes:Number(e.BENCH_BASE), memory_peak_reset:e.BENCH_PEAK_RESET==='true', peak_source:'sampler', peaks_bytes:peaks, cpu_usec:cpu, oom_kill_delta:(ea.oom_kill||0)-(eb.oom_kill||0), vitest };
fs.appendFileSync(`${dir}/runs.jsonl`, JSON.stringify(row)+'\n');
