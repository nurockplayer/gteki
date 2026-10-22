# G-5 performance

**Not measured yet.** This table is written only from a windowed capture on the machine it names, and the G-5b capture
and performance work has not had a GPU slot since it landed. There are no headless, estimated or carried-over numbers
here on purpose: a frame time nobody rendered is not a measurement.

To fill it, the lead runs the commands in `packages/godot/README.md` ("GPU slot runbook") — both stations, both looks
and one `--gi=sdfgi` run, in that order — and then:

```sh
godot --headless --path packages/godot --script res://tests/perf_report.gd -- \
  packages/godot/docs/evidence/g5-performance.md packages/godot/.cache/g5/*/report.json
```

The generator (`packages/godot/tests/perf_report.gd`) prints each run's own `report.json`: the machine, renderer,
driver and adapter it recorded, and per pose the frame-time p50/p95/max, the engine's process-time p50/p95/max, draw
calls, primitives and video memory.
