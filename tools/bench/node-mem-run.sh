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
printf 'epoch_s\tvitest-main\tvitest-worker\tesbuild\tpython3\tchromium\tgodot\tother\ttotal\tcgroup_current\tcgroup_anon\n' > "$out/$id.samples.tsv"
root=$$
(
  while :; do
    awk -v procs="$out/$id.procs.raw" -v root="$root" -v sampler="$BASHPID" '
      BEGIN {
        while (("ls -d /proc/[0-9]* 2>/dev/null" | getline path)>0) {
          pid=path; sub("/proc/", "", pid); ppid[pid]=0; rss[pid]=0; name[pid]="";
          while ((getline line < (path "/status"))>0) { if (line ~ /^PPid:/) {split(line,a); ppid[pid]=a[2]} if (line ~ /^VmRSS:/) {split(line,a); rss[pid]=a[2]*1024} }
          close(path "/status"); cmd=""; exe=""; script=""; n=0;
          pipe="tr \"\\000\" \"\\012\" 2>/dev/null < " path "/cmdline";
          while ((pipe | getline x)>0) { n++; if(n==1) exe=x; else if(script=="" && x ~ /\.(mjs|cjs|js)$/) script=x; cmd=cmd (n>1 ? " " : "") x; } close(pipe);
          sub(/^.*\//,"",exe); count=split(script,parts,"/"); script=(count>1 ? parts[count-1] "/" : "") parts[count]; name[pid]=cmd; executable[pid]=exe; scripts[pid]=script;
        }
        for (pid in ppid) { p=pid; depth=0; excluded=0; while (p && p != root && depth++ < 100) {if (p==sampler) {excluded=1; break} p=ppid[p]} if (p!=root || excluded || pid==root) continue;
          exe=executable[pid]; script=scripts[pid];
          if (exe ~ /^node([0-9]+)?$/ && script == "workers/forks.js") k=2;
          else if (exe ~ /^node([0-9]+)?$/ && script ~ /(^|\/)vitest\.mjs$/) k=1;
          else if (exe == "esbuild") k=3; else if (exe ~ /^python3/) k=4; else if (exe ~ /^(chrome|chromium|playwright)/) k=5; else if (exe ~ /^godot/) k=6; else k=7;
          sums[k]+=rss[pid]; total+=rss[pid]; labels[1]="vitest-main"; labels[2]="vitest-worker"; labels[3]="esbuild"; labels[4]="python3"; labels[5]="chromium"; labels[6]="godot"; labels[7]="other"; if (name[pid]!="") print labels[k] "\t" name[pid] >> procs;
        }
        getline cg < "/sys/fs/cgroup/memory.current"; anon=0; while ((getline st < "/sys/fs/cgroup/memory.stat")>0) if (st ~ /^anon /) {split(st,a," "); anon=a[2]}
        printf "%d", systime(); for(i=1;i<=7;i++) printf "\t%.0f", sums[i]; printf "\t%.0f\t%s\t%s\n", total, cg, anon;
      }' >> "$out/$id.samples.tsv"
    sleep 0.5
  done
) &
sampler=$!
start=$(date +%s)
args=(--reporter=default --reporter=json "--outputFile=$out/$id.vitest.json")
if [[ ${BENCH_SMOKE:-0} == 1 ]]; then args=(tools/box-idle.test.mjs "${args[@]}"); fi
case $suite in
 test) pnpm run test "${args[@]}" ; code=$? ;;
 heavy) pnpm run test:heavy "${args[@]}" ; code=$? ;;
 box) GTEKI_TEST_HEAP_MB=1536 pnpm exec vitest run --mode heavy --maxWorkers=1 --passWithNoTests "${args[@]}"; code=$? ;;
esac
elapsed=$(( $(date +%s) - start ))
kill "$sampler" 2>/dev/null || :; wait "$sampler" 2>/dev/null || :
cp /sys/fs/cgroup/cpu.stat "$out/$id.cpu-after"
cp /sys/fs/cgroup/memory.events "$out/$id.events-after"
unset NODE_OPTIONS
BENCH_BASE=$base BENCH_PEAK_RESET=$peak_reset BENCH_ELAPSED=$elapsed BENCH_EXIT=$code BENCH_ID=$id BENCH_SUITE=$suite BENCH_REP=$rep BENCH_VARIANT=$variant BENCH_OUT=$out node tools/bench/summarize.cjs || code=1
sort -u "$out/$id.procs.raw" > "$out/$id.procs.txt" 2>/dev/null; rm -f "$out/$id.procs.raw"
gzip -f "$out/$id.samples.tsv" || code=1
rm -f "$out/$id.cpu-before" "$out/$id.cpu-after" "$out/$id.events-before" "$out/$id.events-after"
exit "$code"
