#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
suite='' variant='' reps='' heavy=0 smoke=0
while (($#)); do case $1 in
  --suite) suite=$2; shift 2 ;; --variant) variant=$2; shift 2 ;; --reps) reps=$2; shift 2 ;;
  --heavy) heavy=1; shift ;; --smoke) smoke=1; shift ;; *) echo "unknown argument: $1" >&2; exit 2 ;;
esac; done
[[ $suite =~ ^(test|heavy|box)$ && $variant =~ ^(node24|node26|caged26)$ && $reps =~ ^[1-9][0-9]*$ ]] || { echo 'invalid suite, variant or reps' >&2; exit 2; }
[[ $smoke == 0 || $suite == test ]] || exit 2
out=.qa/bench-613; ((smoke)) && out=.qa/bench-613-smoke
mkdir -p "$out"
digest=$(docker image inspect "gteki-bench:$variant" --format '{{.Id}}')
for ((rep=1; rep<=reps; rep++)); do
  if [[ -f $out/runs.jsonl ]] && jq -e --arg s "$suite" --arg v "$variant" --argjson r "$rep" 'select(.suite==$s and .variant==$v and .rep==$r)' "$out/runs.jsonl" >/dev/null; then echo "skip $variant $suite $rep"; continue; fi
  free=$(memory_pressure | grep 'free percentage' | awk -F': ' '{print $2+0}')
  if [[ -z $free ]] || ((free < 20)); then echo 'memory pressure gate: free below 20% or unavailable' >&2; exit 3; fi
  vm=$(vm_stat -c 3 5)
  if ! awk 'NR > 2 && NF {v=$NF; multiplier=1; if (v ~ /K$/) multiplier=1000; if (v ~ /M$/) multiplier=1000000; if (++n > 1 && (v+0)*multiplier > 2000) bad=1} END {exit (n < 3 || bad)}' <<< "$vm"; then echo 'memory pressure gate: swapouts above 2000 pages or unavailable' >&2; exit 3; fi
  concurrent=0
  if orb-test --status --porcelain | grep -q $'^running\t'; then concurrent=1; fi
  memory=3g; cpus=4; [[ $suite == box ]] && { memory=2g; cpus=2; }
  opts=(); ((heavy)) && opts+=(--heavy)
  orb-test "${opts[@]}" --image "gteki-bench:$variant" --memory "$memory" --cpus "$cpus" --out "$out" --env "BENCH_IMAGE_DIGEST=$digest" --env "BENCH_CONCURRENT_HEAVY=$concurrent" --env "BENCH_MEMORY=$memory" --env "BENCH_CPUS=$cpus" --env "BENCH_SMOKE=$smoke" -- bash tools/bench/node-mem-run.sh --suite "$suite" --rep "$rep" --variant "$variant" --out "/w/$out"
done
