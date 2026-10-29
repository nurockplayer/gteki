#!/usr/bin/env bash
set -uo pipefail
suite='' rep='' variant='' out=''
while (($#)); do case $1 in --suite) suite=$2 ;; --rep) rep=$2 ;; --variant) variant=$2 ;; --out) out=$2 ;; *) exit 2 ;; esac; shift 2; done
[[ $suite =~ ^(test|heavy|box)$ && $rep =~ ^[1-9][0-9]*$ && $variant =~ ^(node24|node26|caged26)$ && $out == /w/* ]] || exit 2
mkdir -p "$out"
id="$variant-$suite-$rep"; export BENCH_HEAP_FILE="$out/$id.heap.jsonl"
: > "$BENCH_HEAP_FILE"
export NODE_OPTIONS="${NODE_OPTIONS:+$NODE_OPTIONS }--require /w/tools/bench/heap-probe.cjs"
base=$(cat /sys/fs/cgroup/memory.current)
# A reset is per open file descriptor on cgroup v2. Sampling is the portable source.
peak_reset=false
if (echo 0 > /sys/fs/cgroup/memory.peak) 2>/dev/null; then peak_reset=true; fi
cp /sys/fs/cgroup/cpu.stat "$out/$id.cpu-before"
cp /sys/fs/cgroup/memory.events "$out/$id.events-before"
printf 'epoch_s\tvitest-main\tvitest-worker\tesbuild\tpython3\tchromium\tgodot\tother\ttotal\tcgroup_current\n' > "$out/$id.samples.tsv"
root=$$
(
  while :; do
    awk -v root="$root" -v sampler="$BASHPID" '
      BEGIN {
        while (("ls -d /proc/[0-9]* 2>/dev/null" | getline path)>0) {
          pid=path; sub("/proc/", "", pid); ppid[pid]=0; rss[pid]=0; name[pid]="";
          while ((getline line < (path "/status"))>0) { if (line ~ /^PPid:/) {split(line,a); ppid[pid]=a[2]} if (line ~ /^VmRSS:/) {split(line,a); rss[pid]=a[2]*1024} }
          close(path "/status"); cmd=""; while ((getline x < (path "/cmdline"))>0) cmd=cmd x; close(path "/cmdline"); gsub(/\0/," ",cmd); name[pid]=cmd;
        }
        for (pid in ppid) { p=pid; depth=0; excluded=0; while (p && p != root && depth++ < 100) {if (p==sampler) {excluded=1; break} p=ppid[p]} if (p!=root || excluded || pid==root) continue;
          c=name[pid]; if (c ~ /esbuild/) k=3; else if (c ~ /python3/) k=4; else if (c ~ /chrom(e|ium)|playwright/) k=5; else if (c ~ /godot/) k=6; else if (c ~ /vitest.*(worker|forks)|tinypool|pool-runner/) k=2; else if (c ~ /vitest/) k=1; else k=7; sums[k]+=rss[pid]; total+=rss[pid];
        }
        getline cg < "/sys/fs/cgroup/memory.current"; printf "%d", systime(); for(i=1;i<=7;i++) printf "\t%.0f", sums[i]; printf "\t%.0f\t%s\n", total, cg;
      }' >> "$out/$id.samples.tsv"
    sleep 0.5
  done
) &
sampler=$!
start=$(date +%s)
args=(--reporter=default --reporter=json "--outputFile=$out/$id.vitest.json")
if [[ ${BENCH_SMOKE:-0} == 1 ]]; then args=(tools/box-idle.test.mjs "${args[@]}"); fi
case $suite in
 test) pnpm test -- "${args[@]}" ; code=$? ;;
 heavy) pnpm test:heavy -- "${args[@]}" ; code=$? ;;
 box) GTEKI_TEST_HEAP_MB=1536 pnpm exec vitest run --mode heavy --maxWorkers=1 --passWithNoTests "${args[@]}"; code=$? ;;
esac
elapsed=$(( $(date +%s) - start ))
kill "$sampler" 2>/dev/null || :; wait "$sampler" 2>/dev/null || :
cp /sys/fs/cgroup/cpu.stat "$out/$id.cpu-after"
cp /sys/fs/cgroup/memory.events "$out/$id.events-after"
BENCH_BASE=$base BENCH_PEAK_RESET=$peak_reset BENCH_ELAPSED=$elapsed BENCH_EXIT=$code BENCH_ID=$id BENCH_SUITE=$suite BENCH_REP=$rep BENCH_VARIANT=$variant BENCH_OUT=$out node tools/bench/summarize.cjs
gzip -f "$out/$id.samples.tsv"
rm -f "$out/$id.cpu-before" "$out/$id.cpu-after" "$out/$id.events-before" "$out/$id.events-after"
exit "$code"
