#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for spec in 'node24 node:24.15.0-trixie-slim' 'node26 node:26.12.1-trixie-slim' 'caged26 platformatic/node-caged:26-slim'; do
  read -r name base <<< "$spec"
  docker build -f tools/bench/Dockerfile.node-mem --build-arg "BASE=$base" -t "gteki-bench:$name" .
  docker run --rm "gteki-bench:$name" node -p '[process.version, process.arch, process.config.variables.v8_enable_pointer_compression].join(" ")'
done
stock=$(docker run --rm gteki-bench:node26 node -p process.version)
caged=$(docker run --rm gteki-bench:caged26 node -p process.version)
[[ $stock == "$caged" ]] || { echo "Node versions differ: $stock / $caged" >&2; exit 1; }
