# Node memory benchmark plan (#613)

This is an opt-in experiment. Build with `bash tools/bench/build-images.sh`. The three arm64 images use pnpm 12.11.2, Debian trixie, Node 24.15.0 baseline, stock Node 26.12.1 and node-caged 26.12.1. The build asserts the Node 26 versions match. Docker image IDs are recorded with each run. Host: arm64 Mac, OrbStack VM 6 CPUs and about 7.8 GiB, Linux 7.2 cgroup v2; host Node 24.15.0. CI root-test uses Node 24.

Run each suite and variant serially, coordinating with other jobs:

```sh
bash tools/bench/node-mem.sh --heavy --suite test --variant node24 --reps 3
bash tools/bench/node-mem.sh --heavy --suite heavy --variant node26 --reps 3
bash tools/bench/node-mem.sh --heavy --suite box --variant caged26 --reps 3
node tools/bench/node-mem-report.mjs .qa/bench-613
```

Repeat all combinations; `--heavy` obtains the shared heavy lock. Without it the runner records whether a heavy job is concurrent; timing and CPU are not comparable. The first rep is called cold and later reps warm, although every container installs afresh and caches can persist. Existing summary rows are skipped; move or remove the output directory to start a new batch. Test and heavy limits are 3 GiB/4 CPUs, box 2 GiB/2 CPUs with 1536 MiB V8 old-space cap. Other suites inherit the configured 3072 MiB cap. Box executes the same Vitest workload inside the limited outer container; it does not launch the nested test-box container. JSON reporters add output only. Sampler peaks are interval estimates, include cgroup file cache and miss shorter spikes; process RSS sums can double-count shared pages. Heap telemetry is per Node process and exit records can be missing after a forced kill. GC counts are best effort.

Compare stock Node 26 with caged Node 26 to isolate the runtime build difference; Node 24 comparisons also include the Node upgrade. Pointer compression concerns V8's approximately 4 GiB cage per isolate and does not imply that the 3072 MiB old-space cap is the entire process limit. GPU/VRAM, Godot, Blender, Chromium native memory and other external processes are not attributable to pointer compression. Container RSS or cgroup memory is not host savings: macOS and the OrbStack VM add overhead, and caches and shared mappings differ.

Before interpreting compatibility, inventory native addons after install inside the caged image with `find node_modules -name '*.node'`; record paths and categories (for example image processing, bundlers, database or optional platform binaries) and verify their ABI compatibility. Inventory: TODO (caged image). Do not treat absence of a successful Node 26 suite as compatibility.

## Results

TODO: counts, failures, peaks, CPU, elapsed, concurrent-load notes, variability, native addon inventory and adopt/defer/reject recommendation after representative runs. No full suites were requested for harness verification.

Rollback: nothing to roll back; the images and scripts are opt-in and do not change the default runtime or CI.
