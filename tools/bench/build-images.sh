#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/../.."
for spec in 'node24 node:24.15.0-trixie-slim' 'node26 node:26.13.0-trixie-slim' 'caged26 platformatic/node-caged@sha256:ff8c968d217922792fcadf5759993a00ec2e8dfd7a85bd35e50f00aa510923b7'; do
  read -r name base <<< "$spec"
  docker build -f tools/bench/Dockerfile.node-mem --build-arg "BASE=$base" -t "gteki-bench:$name" .
  docker run --rm "gteki-bench:$name" node -p '[process.version, process.arch, process.config.variables.v8_enable_pointer_compression].join(" ")'
done
stock=$(docker run --rm gteki-bench:node26 node -p process.version)
caged=$(docker run --rm gteki-bench:caged26 node -p process.version)
[[ $stock == "$caged" ]] || { echo "Node versions differ: $stock / $caged" >&2; exit 1; }
pc() { docker run --rm "gteki-bench:$1" node -p 'process.config.variables.v8_enable_pointer_compression'; }
[[ $(pc node26) == 0 && $(pc caged26) == 1 ]] || { echo "pointer compression must be off in node26 and on in caged26: $(pc node26) / $(pc caged26)" >&2; exit 1; }
docker image inspect platformatic/node-caged@sha256:ff8c968d217922792fcadf5759993a00ec2e8dfd7a85bd35e50f00aa510923b7 --format 'caged base: {{index .RepoDigests 0}}'
