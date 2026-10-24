extends SceneTree
## G-5b headless checks: the capture/perf argument rules, the percentiles, the missing-route-file failure, the G-5
## evidence pose list asked
## from the real router and placed on the real station snapshot, and the performance report generator on fixture
## reports. Nothing renders: the capture itself is windowed (the lead's GPU slot), so no frame time is measured here.
## Usage: -- <scenesDir> <stationId> [<stationId>...]

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")
const Capture = preload("res://hq/hq_capture.gd")
const Hq = preload("res://hq/hq.gd")
const Evidence = preload("res://addons/gteki/gteki_evidence.gd")
const Report = preload("res://tests/perf_report.gd")
## The evidence walk's plan, read (never run) so a capture pose can only describe a route the G-5a table walks.
const WalkPlan = preload("res://tests/run_evidence_tests.gd")

var checks := 0
var failures: Array[String] = []
var repo_root := ""


func _initialize() -> void:
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		printerr("FAIL: ", message)


func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("Usage: -- <scenesDir> <stationId> [<stationId>...]")
		quit(1)
		return
	var scenes_dir := str(args[0])
	check_arguments()
	check_percentiles()
	check_missing_route_file()
	var bridge := Bridge.new()
	repo_root = bridge.repo_root
	check(not repo_root.is_empty(), "the repository root is found above the project")
	for i in range(1, args.size()):
		await check_station(bridge, scenes_dir, str(args[i]))
	check_report_generator()
	finish()


func finish() -> void:
	if failures.is_empty():
		print("PASS: GTEki Godot capture checks (%d checks)" % checks)
		quit(0)
	else:
		printerr("FAIL: GTEki Godot capture checks (%d failures / %d checks):\n  %s" % [failures.size(), checks, "\n  ".join(failures)])
		quit(1)


# ---- arguments and statistics ---------------------------------------------------------------------------------------

## The rules the client applies before it loads anything: a perf run needs its capture directory, and a value that is not
## a positive number of seconds is an argument error, never a silent fallback to some default window.
func check_arguments() -> void:
	var both := Capture.parse_args(PackedStringArray(["--capture=.cache/g5/x", "--perf=5"]))
	check(String(both.error).is_empty() and String(both.capture) == ".cache/g5/x" and is_equal_approx(float(both.perf_s), 5.0), "self: --capture with --perf parses")
	var capture_only := Capture.parse_args(PackedStringArray(["--capture=out"]))
	check(String(capture_only.error).is_empty() and float(capture_only.perf_s) == 0.0 and String(capture_only.poses).is_empty(), "self: a capture without --perf leaves perf off")
	var with_poses := Capture.parse_args(PackedStringArray(["--capture=out", "--poses=poses.json"]))
	check(String(with_poses.poses) == "poses.json", "self: --poses is passed through")
	for bad in ["--perf=soon", "--perf=0", "--perf=-2", "--perf="]:
		check(not String(Capture.parse_args(PackedStringArray(["--capture=out", bad])).error).is_empty(), "self: %s is an argument error" % bad)
	check(String(Capture.parse_args(PackedStringArray(["--perf=5"])).error).contains("--capture"), "self: --perf without --capture names the missing flag")
	check(not String(Capture.parse_args(PackedStringArray(["--capture="])).error).is_empty(), "self: an empty --capture is an argument error")
	check(not String(Capture.parse_args(PackedStringArray(["--poses="])).error).is_empty(), "self: an empty --poses is an argument error")
	# The station-load flags (`hq.gd`): lightmap and AO default on, --ao-light-affect defaults to -1 (Godot's own value),
	# and anything else is an argument error rather than a silent fallback.
	var defaults := Hq.parse_client_args(PackedStringArray([]))
	check((defaults.errors as Array).is_empty() and bool(defaults.lightmap) and bool(defaults.ao), "self: lightmap and AO apply by default")
	check(is_equal_approx(float(defaults.light_affect), -1.0), "self: no --ao-light-affect means Godot's own value (-1)")
	var off := Hq.parse_client_args(PackedStringArray(["--lightmap=off", "--ao=off", "--ao-light-affect=0.5"]))
	check((off.errors as Array).is_empty() and not bool(off.lightmap) and not bool(off.ao) and is_equal_approx(float(off.light_affect), 0.5), "self: --lightmap=off, --ao=off and --ao-light-affect=0.5 parse")
	var bounds := Hq.parse_client_args(PackedStringArray(["--ao-light-affect=0"]))
	check(is_equal_approx(float(bounds.light_affect), 0.0), "self: --ao-light-affect=0 is a real value, not 'no value' (-1)")
	var full := Hq.parse_client_args(PackedStringArray(["--ao-light-affect=1"]))
	check(is_equal_approx(float(full.light_affect), 1.0), "self: --ao-light-affect=1 is accepted")
	var exponent := Hq.parse_client_args(PackedStringArray(["--ao-light-affect=5e-1"]))
	check(is_equal_approx(float(exponent.light_affect), 0.5), "self: --ao-light-affect=5e-1 is a complete exponent and parses")
	# String.is_valid_float accepts a trailing exponent with no digits, so the pattern must refuse these itself.
	for bad in ["--lightmap=yes", "--ao=1", "--ao-light-affect=1.5", "--ao-light-affect=-0.1", "--ao-light-affect=nan", "--ao-light-affect=inf", "--ao-light-affect=", "--ao-light-affect=1e", "--ao-light-affect=0e+", "--ao-light-affect=0e-"]:
		var parsed := Hq.parse_client_args(PackedStringArray([bad]))
		check(not (parsed.errors as Array).is_empty(), "self: %s is an argument error" % bad)


func check_percentiles() -> void:
	var series: Array[float] = []
	for i in range(1, 11):
		series.append(float(i))
	var p := Capture.percentiles(series)
	check(is_equal_approx(float(p.p50), 5.0), "self: the p50 of 1..10 is 5 (nearest rank)")
	check(is_equal_approx(float(p.p95), 10.0), "self: the p95 of 1..10 is 10, the top of the series")
	check(is_equal_approx(float(p.max), 10.0), "self: max is the largest sample")
	var none: Array[float] = []
	check(Capture.percentiles(none).is_empty(), "self: no samples reports no percentiles, never a zero")
	var single: Array[float] = [3.0]
	var one := Capture.percentiles(single)
	check(is_equal_approx(float(one.p50), 3.0) and is_equal_approx(float(one.p95), 3.0), "self: one sample is its own p50 and p95")


## A missing route file is a failed run, not a quietly shorter pose list: `route_poses` records it and the client's exit
## code follows `route_file_missing` (see `run`).
func check_missing_route_file() -> void:
	var capture := Capture.new()
	check(not capture.route_file_missing, "self: a fresh capture has not failed on the route file")
	var poses := capture.route_poses("res://.cache/routes/does-not-exist-%d.route.json" % Time.get_ticks_usec())
	check(poses.is_empty(), "self: a missing route file gives no route poses")
	check(capture.route_file_missing, "self: a missing route file marks the capture as failed")
	check(capture.pose_problems.size() == 1 and String(capture.pose_problems[0]).contains("route poses are not captured"), "self: a missing route file is stated in pose_problems (%s)" % str(capture.pose_problems))


# ---- the pose list --------------------------------------------------------------------------------------------------

## The capture covers exactly the routes the evidence walk walks, and each route's powers describe their own route: the
## start and goal are the route's polyline ends, the mid-stair point stands on a `stairs` step inside that step's span,
## and a lift's landing is where the walker's own ride rules put the feet.
func check_station(bridge: Bridge, scenes_dir: String, station_id: String) -> void:
	var plan: Dictionary = WalkPlan.PLANS.get(station_id, {})
	check(not plan.is_empty(), "%s: the evidence walk has a plan" % station_id)
	if plan.is_empty():
		return
	var golden := Evidence.load_golden(repo_root, station_id)
	check(not golden.is_empty(), "%s: the routes golden loads" % station_id)
	if golden.is_empty():
		return
	var routable: Array[String] = []
	for spec in plan.routes:
		var scenario: Variant = golden.get(str(spec.golden))
		if scenario is Dictionary and scenario.result.get("ok") == true:
			routable.append(str(spec.label))
	var covered: Array[String] = []
	for spec in Evidence.routes(station_id):
		covered.append(str(spec.label))
	check(covered == routable, "%s: the capture poses cover exactly the routes the evidence walk walks (%s vs %s)" % [station_id, str(covered), str(routable)])

	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	check(scene.load_snapshot(scenes_dir.path_join(station_id), holder), "%s: the snapshot loads (%s)" % [station_id, str(scene.issues)])
	var walker := Walker.new()
	holder.add_child(walker)
	walker.set_walls(scene.sidecar.get("walls", []))
	await physics_frame
	await physics_frame

	var capture := Capture.new()
	var poses := capture.evidence_poses(walker, station_id)
	print("%s: %d evidence poses for %d routes%s" % [station_id, poses.size(), covered.size(), "" if capture.pose_problems.is_empty() else " (%s)" % "; ".join(capture.pose_problems)])
	check(not poses.is_empty(), "%s: the evidence poses are built (%s)" % [station_id, str(capture.pose_problems)])
	var seen: Dictionary = {}
	var duplicates: Array[String] = []
	for pose in poses:
		var name := str(pose.name)
		if seen.has(name):
			duplicates.append(name)
		seen[name] = true
	check(duplicates.is_empty(), "%s: every capture pose has its own name (%s)" % [station_id, str(duplicates)])

	for spec in Evidence.routes(station_id):
		var label := str(spec.label)
		var scenario: Variant = golden.get(str(spec.golden))
		if not scenario is Dictionary:
			continue
		var routed := Evidence.route_for(bridge, station_id, scenario)
		check(routed.ok, "%s %s: the router answers %s -> %s: %s" % [station_id, label, str(scenario.from), str(scenario.to), str(routed.get("error", ""))])
		if not routed.ok:
			continue
		var guide := Guide.new()
		check(guide.load_doc(routed.doc), "%s %s: the route loads in the guide (%s)" % [station_id, label, str(guide.issues)])
		var own := poses_of_route(poses, label)
		check(has_kind(own, "start"), "%s %s: the route start is captured" % [station_id, label])
		check(has_kind(own, "goal"), "%s %s: the route goal is captured" % [station_id, label])
		var start := pose_of_kind(own, "start")
		if not start.is_empty():
			check(position_of(start).distance_to(guide.points[0]) < 0.001, "%s %s: the start pose stands on the route's first point" % [station_id, label])
		var goal := pose_of_kind(own, "goal")
		if not goal.is_empty():
			check(position_of(goal).distance_to(guide.points[guide.points.size() - 1]) < 0.001, "%s %s: the goal pose stands on the route's last point" % [station_id, label])
		var stair := Capture.stair_span(guide, (routed.doc.result as Dictionary).get("steps", []))
		if stair.is_empty():
			check(not has_kind(own, "mid_stair"), "%s %s: no stairs step, so no mid-stair pose is invented" % [station_id, label])
		else:
			var mid := pose_of_kind(own, "mid_stair")
			check(not mid.is_empty(), "%s %s: the stair middle is captured" % [station_id, label])
			if not mid.is_empty():
				var at := position_of(mid)
				var along: float = float(guide.project(at).s)
				check(along >= float(stair.from_s) - 0.01 and along <= float(stair.to_s) + 0.01, "%s %s: the mid-stair pose lies inside the stair's span (%.2f m in %.2f..%.2f)" % [station_id, label, along, float(stair.from_s), float(stair.to_s)])
				var step := guide.step_at(along)
				var steps: Array = routed.doc.result.steps
				var mode := str((steps[step] as Dictionary).get("mode", "")) if step >= 0 and step < steps.size() else ""
				check(mode == "stairs", "%s %s: the mid-stair pose stands on a stairs step, not on %s" % [station_id, label, mode if not mode.is_empty() else "none"])
		if guide.rides.is_empty():
			check(not has_kind(own, "lift_landing"), "%s %s: a route with no lift has no landing pose" % [station_id, label])
		else:
			for ride in guide.rides:
				var landing := pose_of_step(own, int(ride.step))
				check(not landing.is_empty(), "%s %s: the landing of the lift on step %d is captured" % [station_id, label, int(ride.step)])
				if landing.is_empty():
					continue
				var exit_point: Vector3 = ride.to
				var feet := position_of(landing)
				var away := Vector2(feet.x - exit_point.x, feet.z - exit_point.z).length()
				check(away <= Walker.RIDE_LANDING_REACH + 0.001, "%s %s: the landing pose is within the ride's %.1f m reach (%.2f m)" % [station_id, label, Walker.RIDE_LANDING_REACH, away])
				check(absf(feet.y - exit_point.y) <= Walker.RIDE_LANDING_LEVEL + 0.001, "%s %s: the landing pose is on the exit's own level (%.2f m)" % [station_id, label, feet.y - exit_point.y])
		# Every pose must be somewhere the real walker can stand: a picture of a place nobody can walk to is no evidence.
		for pose in own:
			var at := position_of(pose)
			var stands := walker.walk_from(at, 0.0)
			check(stands, "%s %s: the %s pose (%s) has walkable ground" % [station_id, label, str(pose.kind), str(at)])
			if stands:
				var settled := walker.feet()
				check(absf(settled.y - at.y) <= Walker.STEP_UP and Vector2(settled.x - at.x, settled.z - at.z).length() < 0.01, "%s %s: the %s pose's ground is where the pose is (%.2f m below)" % [station_id, label, str(pose.kind), at.y - settled.y])
	if station_id == "shinjuku":
		check(not pose_of_kind(poses, "lift_landing", "S4").is_empty(), "S4: the lift exit landing is a capture pose (%s)" % str(pose_names(poses)))
	holder.queue_free()


static func poses_of_route(poses: Array, label: String) -> Array:
	var found: Array = []
	for pose in poses:
		if str(pose.get("route", "")) == label:
			found.append(pose)
	return found


static func pose_of_kind(poses: Array, kind: String, route := "") -> Dictionary:
	for pose in poses:
		if str(pose.get("kind", "")) != kind:
			continue
		if not route.is_empty() and str(pose.get("route", "")) != route:
			continue
		return pose
	return {}


static func has_kind(poses: Array, kind: String) -> bool:
	return not pose_of_kind(poses, kind).is_empty()


## The landing pose of the lift on `step` (its own step id, so a route with more than one lift stays attributable).
static func pose_of_step(poses: Array, step: int) -> Dictionary:
	for pose in poses:
		if str(pose.get("kind", "")) == "lift_landing" and int(pose.get("step", -1)) == step:
			return pose
	return {}


static func position_of(pose: Dictionary) -> Vector3:
	var at: Array = pose.position
	return Vector3(at[0], at[1], at[2])


static func pose_names(poses: Array) -> Array[String]:
	var names: Array[String] = []
	for pose in poses:
		names.append(str(pose.get("name", "")))
	return names


# ---- the report generator -------------------------------------------------------------------------------------------

## Fixture reports (written here, never measured) through the real generator: the machine label, the per-pose table, the
## "no perf" wording, and the refusals — a report that is not a `gteki.capture/0.1` document must not produce a table.
func check_report_generator() -> void:
	var dir := OS.get_temp_dir().path_join("gteki-capture-test-%d" % Time.get_ticks_usec())
	check(DirAccess.make_dir_recursive_absolute(dir) == OK, "self: the fixture directory is created (%s)" % dir)
	var fixture := write_json(dir.path_join("shinjuku-hq.json"), sample_report())
	var out := dir.path_join("g5-performance.md")
	check(Report.main([out, fixture]) == 0, "self: the generator writes a table from a fixture report")
	var text := FileAccess.get_file_as_string(out)
	check(text.contains("Measured on Fixture GPU (forward_plus via metal, FixtureOS 1.0, Fixture CPU) in the lead's GPU slot."), "self: the table names the machine and the GPU slot it was measured in")
	check(text.contains("renderer `forward_plus`, driver `metal`"), "self: the table names the renderer the run actually used, not the project setting")
	check(not text.contains("gl_compatibility"), "self: a project renderer of gl_compatibility is never printed as the measured renderer")
	check(text.contains("## shinjuku — look hq, GI sdfgi"), "self: the run names its station, look and GI")
	check(text.contains("| Frame interval ms p50 | p95 | max | Renderer setup ms p50 | p95 | max |"), "self: each column names the series it prints")
	check(text.contains("| g5_S4_start | 300 | 16.70 | 18.20 | 40.50 | 4.20 | 5.10 | 9.90 | 412 | 120401 | 512.0 |"), "self: a pose's percentiles, draw calls, primitives and video memory are printed as measured")
	check(text.contains("**Renderer setup ms** — `RenderingServer.get_frame_setup_time_cpu()`"), "self: the table says what the renderer setup series is")
	check(text.contains("not a per-frame figure"), "self: the table says the engine process figure is not per-frame")
	check(text.contains("Engine process-time interval maximum (`Performance.TIME_PROCESS`: about once a second, that second's largest process time, not a per-frame figure): 11.40 ms"), "self: the engine process figure is reported once per run as an interval maximum, not as percentiles")
	check(not text.contains("| Process ms p50 |") and not text.contains("process_ms"), "self: no per-frame percentiles are printed from the engine's once-a-second process figure")
	check(text.contains("Worst pose by frame-interval p95: g5_S4_start (18.20 ms)."), "self: the worst pose is named from the sampled p95")
	check(text.contains("Failed poses: g5_S4_goal (no walkable ground)."), "self: a pose that failed is listed, not dropped")
	check(text.contains("Poses not taken: W2: no stairs step, so no mid-stair pose."), "self: a pose the run says it could not take is listed")

	var quiet := write_json(dir.path_join("quiet.json"), sample_report(false))
	var quiet_out := dir.path_join("quiet.md")
	check(Report.main([quiet_out, quiet]) == 0, "self: a capture without --perf still generates a table")
	var quiet_text := FileAccess.get_file_as_string(quiet_out)
	check(quiet_text.contains("No frames were sampled in this run."), "self: a run captured without perf says so instead of showing zeroes")
	check(quiet_text.contains("Captured without perf: g5_S4_start."), "self: the poses it did capture without perf are named")

	var bad := write_json(dir.path_join("bad.json"), {"contract": "gteki.other/0.1"})
	var never := dir.path_join("never.md")
	check(Report.main([never, bad]) == 1, "self: a file that is not a capture report is refused")
	check(not FileAccess.file_exists(never), "self: a refused report writes no table")
	check(Report.main([]) == 2, "self: the generator needs an output path and at least one report")
	for name in DirAccess.get_files_at(dir):
		DirAccess.remove_absolute(dir.path_join(name))
	DirAccess.remove_absolute(dir)


static func write_json(path: String, data: Dictionary) -> String:
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file != null:
		file.store_string(JSON.stringify(data, "\t"))
		file.close()
	return path


## A two-pose fixture shaped like a real report; `with_perf` false is a capture run without --perf.
static func sample_report(with_perf := true) -> Dictionary:
	var poses: Array = [
		{"name": "g5_S4_start", "file": "00_g5_S4_start.png"},
		{"name": "g5_S4_goal", "error": "no walkable ground"},
	]
	if with_perf:
		poses[0]["perf"] = {
			"warmup_frames": 60, "seconds": 5.0, "frames": 300,
			"frame_ms": {"p50": 16.7, "p95": 18.2, "max": 40.5},
			"setup_ms": {"p50": 4.2, "p95": 5.1, "max": 9.9},
			"process_interval_max_ms": 11.4,
			"draw_calls": 412, "primitives": 120401, "video_mem_bytes": 536870912,
		}
	return {
		"contract": "gteki.capture/0.1",
		"station": "shinjuku", "look": "hq", "gi": "sdfgi", "perf_seconds": 5.0,
		"machine": {"os": "FixtureOS", "os_version": "1.0", "processor": "Fixture CPU", "gpu": "Fixture GPU", "gpu_vendor": "Fixture"},
		"renderer": "forward_plus", "project_renderer": "gl_compatibility", "driver": "metal", "adapter": "Fixture GPU",
		"window": [1600, 900], "resolution": [1600, 900],
		"settle_physics_frames": 45, "perf_warmup_frames": 60,
		"pose_problems": ["W2: no stairs step, so no mid-stair pose"],
		"timed_out": false, "elapsed_s": 12.5,
		"poses": poses,
	}
