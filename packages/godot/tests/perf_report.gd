extends SceneTree
## G-5b: turn windowed capture reports (`report.json`, `gteki.capture/0.1`, written by `hq/hq_capture.gd --capture --perf`)
## into `docs/evidence/g5-performance.md`. Nothing is measured here: every number is printed from a report, each run is
## labelled with the machine and adapter its own report recorded, and a run captured without `--perf` says so instead of
## showing zeroes. This is the table step of the README's "GPU slot runbook"; the captures themselves are the lead's.
## Usage: godot --headless --path packages/godot --script res://tests/perf_report.gd -- <out.md> <report.json>...

const CONTRACT := "gteki.capture/0.1"
const SLOT := "the lead's GPU slot"


func _initialize() -> void:
	call_deferred("run")


func run() -> void:
	var args: Array = Array(OS.get_cmdline_user_args())
	quit(main(args))


## Read every report first and write the table only when all of them parse: a bad path must not leave a half table where
## the committed evidence should be.
static func main(args: Array) -> int:
	if args.size() < 2:
		printerr("Usage: -- <out.md> <report.json> [<report.json>...]")
		return 2
	var reports: Array = []
	for i in range(1, args.size()):
		var report := load_report(str(args[i]))
		if report.is_empty():
			return 1
		reports.append(report)
	var out := str(args[0])
	var file := FileAccess.open(out, FileAccess.WRITE)
	if file == null:
		printerr("Cannot write %s" % out)
		return 1
	file.store_string(render(reports))
	file.close()
	print("wrote %s (%d run%s)" % [out, reports.size(), "" if reports.size() == 1 else "s"])
	return 0


static func load_report(path: String) -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary or parsed.get("contract") != CONTRACT:
		printerr("%s is not a %s report" % [path, CONTRACT])
		return {}
	return parsed


static func render(reports: Array) -> String:
	var lines: Array[String] = []
	lines.append("# G-5 performance")
	lines.append("")
	lines.append("Frame time and GPU cost of the G-5b evidence poses. Each run below is a windowed capture by")
	lines.append("`packages/godot/hq/hq_capture.gd --capture --perf`; this table is written from those `report.json` files by")
	lines.append("`tests/perf_report.gd`. Every figure is the report's own: nothing here is estimated, and a run captured")
	lines.append("without `--perf` says so instead of showing zeroes.")
	lines.append("")
	for line in machine_lines(reports):
		lines.append(line)
	lines.append("")
	for report in reports:
		lines.append_array(run_lines(report))
	return "\n".join(lines)


## One sentence per distinct machine the reports were measured on; the adapter and OS come from each report's own
## `machine` block, never from this file.
static func machine_lines(reports: Array) -> Array[String]:
	var seen: Array[String] = []
	for report in reports:
		var text := "Measured on %s in %s." % [describe_machine(report), SLOT]
		if not seen.has(text):
			seen.append(text)
	return seen


static func describe_machine(report: Dictionary) -> String:
	var machine: Dictionary = report.machine if report.get("machine") is Dictionary else {}
	var gpu := str(machine.get("gpu", report.get("adapter", ""))).strip_edges()
	var parts: Array[String] = []
	var renderer := str(report.get("renderer", "")).strip_edges()
	var driver := str(report.get("driver", "")).strip_edges()
	if not renderer.is_empty() and not driver.is_empty():
		parts.append("%s via %s" % [renderer, driver])
	elif not renderer.is_empty():
		parts.append(renderer)
	var os_name := str(machine.get("os", "")).strip_edges()
	var os_version := str(machine.get("os_version", "")).strip_edges()
	if not os_name.is_empty():
		parts.append(os_name if os_version.is_empty() else "%s %s" % [os_name, os_version])
	var processor := str(machine.get("processor", "")).strip_edges()
	if not processor.is_empty():
		parts.append(processor)
	if gpu.is_empty():
		gpu = "an unnamed adapter"
	return gpu if parts.is_empty() else "%s (%s)" % [gpu, ", ".join(parts)]


static func run_lines(report: Dictionary) -> Array[String]:
	var lines: Array[String] = []
	lines.append("## %s — look %s, GI %s" % [str(report.get("station", "UNKNOWN")), str(report.get("look", "UNKNOWN")), str(report.get("gi", "off"))])
	lines.append("")
	lines.append("- Window %s at capture resolution %s; renderer `%s` (runtime `%s`), driver `%s`, GPU `%s`" % [
		_size(report.get("window")), _size(report.get("resolution")),
		str(report.get("renderer", "")), str(report.get("rendering_method_runtime", "")),
		str(report.get("driver", "")), str(report.get("adapter", ""))])
	var perf_seconds := float(report.get("perf_seconds", 0.0))
	var warmup := int(report.get("perf_warmup_frames", 0))
	if perf_seconds > 0.0:
		lines.append("- Perf: %.1f s per pose after %d warm-up frames" % [perf_seconds, warmup])
	else:
		lines.append("- Perf: not sampled (this run was captured without `--perf`)")
	lines.append("- Elapsed %.1f s; timed out: %s" % [float(report.get("elapsed_s", 0.0)), "yes" if bool(report.get("timed_out", false)) else "no"])
	lines.append("")
	var poses: Array = report.get("poses", [])
	var sampled: Array = []
	var without_perf: Array[String] = []
	var failed: Array[String] = []
	for pose in poses:
		if not pose is Dictionary:
			continue
		if pose.has("error"):
			failed.append("%s (%s)" % [str(pose.get("name", "?")), str(pose.error)])
		elif pose.get("perf") is Dictionary:
			sampled.append(pose)
		else:
			without_perf.append(str(pose.get("name", "?")))
	if sampled.is_empty():
		lines.append("No frames were sampled in this run.")
	else:
		lines.append_array(table_lines(sampled))
		var worst := worst_pose(sampled)
		if not worst.is_empty():
			lines.append("")
			lines.append("Worst pose by frame-time p95: %s (%.2f ms)." % [str(worst.name), float(worst.value)])
	if not without_perf.is_empty():
		lines.append("")
		lines.append("Captured without perf: %s." % ", ".join(without_perf))
	if not failed.is_empty():
		lines.append("")
		lines.append("Failed poses: %s." % "; ".join(failed))
	var problems: Array[String] = []
	for problem in report.get("pose_problems", []):
		problems.append(str(problem))
	if not problems.is_empty():
		lines.append("")
		lines.append("Poses not taken: %s." % "; ".join(problems))
	lines.append("")
	return lines


static func table_lines(sampled: Array) -> Array[String]:
	var lines: Array[String] = [
		"| Pose | Frames | Frame ms p50 | p95 | max | Process ms p50 | p95 | max | Draw calls | Primitives | Video MB |",
		"| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
	]
	for pose in sampled:
		var perf: Dictionary = pose.perf
		var frame: Dictionary = perf.frame_ms if perf.get("frame_ms") is Dictionary else {}
		var process: Dictionary = perf.process_ms if perf.get("process_ms") is Dictionary else {}
		lines.append("| %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % [
			str(pose.get("name", "?")),
			_count(perf.get("frames")),
			_ms(frame.get("p50")), _ms(frame.get("p95")), _ms(frame.get("max")),
			_ms(process.get("p50")), _ms(process.get("p95")), _ms(process.get("max")),
			_count(perf.get("draw_calls")), _count(perf.get("primitives")), _megabytes(perf.get("video_mem_bytes")),
		])
	return lines


## The pose with the largest frame-time p95, for a one-line summary; {} when no pose has one (never a 0 ms stand-in).
static func worst_pose(sampled: Array) -> Dictionary:
	var found := {}
	for pose in sampled:
		var value: Variant = pose.perf.frame_ms.get("p95") if pose.perf.get("frame_ms") is Dictionary else null
		if value == null:
			continue
		if found.is_empty() or float(value) > float(found.value):
			found = {"name": pose.get("name", "?"), "value": value}
	return found


static func _size(value: Variant) -> String:
	if not value is Array or value.size() != 2:
		return "UNKNOWN"
	return "%dx%d" % [int(value[0]), int(value[1])]


static func _ms(value: Variant) -> String:
	return "n/a" if value == null else "%.2f" % float(value)


static func _count(value: Variant) -> String:
	return "n/a" if value == null else "%d" % int(value)


static func _megabytes(value: Variant) -> String:
	return "n/a" if value == null else "%.1f" % (float(value) / 1048576.0)
