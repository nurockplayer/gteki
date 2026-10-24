extends RefCounted
## G-4/G-5b capture mode: place the walker on a list of poses, let the follow camera settle, save the viewport as a PNG
## and record RenderingServer stats; with `--perf=<seconds>` it also samples frame time per pose.
## Windowed only: a headless display has nothing to render, so it has no picture and no frame time that would mean
## anything (the client refuses `--perf` on a headless display instead of making a number up).
## Run:  godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- --station=<id> --capture=<outDir>
##         [--poses=<file>] [--look=baseline|hq] [--gi=off|sdfgi] [--ao=on|off] [--ao-light-affect=<0..1>]
##         [--perf=<seconds>]
## Poses file: JSON array of {name, position:[x,y,z] (Godot frame, near the ground), yaw_deg (walker yaw, 0 faces -Z,
## positive turns left), pitch?, distance?}. Default poses: each spawn point x 4 yaws; Ikebukuro adds the
## g_jr_c2 -> x35 route every 15 m and the #227 stall area (.cache/routes/ikebukuro.route.json, written by run-walk.sh;
## a missing route file is a failure of the run — it goes into `pose_problems` and the run exits non-zero — never a
## quietly shorter pose list), Shinjuku its inverted-band walls; then the G-5 evidence poses — the start, the mid-stair
## point and the goal of every route the evidence walk covers, plus each lift's landing (the one shaft in the goldens is
## Shinjuku S4's) — asked from the router through gteki_bridge.gd, the same call the evidence walk makes.
## Writes <outDir>/report.json (`gteki.capture/0.1`): station, look, GI, the kit AO state (`ao`, `ao_light_affect` and
## `ao_light_affect_requested`), the renderer the run actually used, the project
## renderer setting, driver, GPU, window, machine and, per
## pose, the PNG, the camera, RenderingServer stats and (with --perf) the frame-interval and renderer-setup percentiles.

const Walker = preload("res://addons/gteki/gteki_walker.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")
const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Evidence = preload("res://addons/gteki/gteki_evidence.gd")

const WIDTH := 1600
const HEIGHT := 900
const SETTLE_PHYSICS_FRAMES := 45
const SETTLE_RENDER_FRAMES := 3
const TIMING_FRAMES := 30
## Frames rendered before the perf window: shader compilation and first-use uploads land there, not in the measurement.
const PERF_WARMUP_FRAMES := 60
const TIMEOUT_MS := 10 * 60 * 1000
## What one pose costs besides its perf window — the settle, the 60 warm-up frames and the PNG — allowed for at a slow
## 30 rendered frames a second when the timeout decides whether a pose still fits.
const POSE_OVERHEAD_MS := 5000
const ROUTE_STEP := 15.0
const ROUTE_FILE := "res://.cache/routes/ikebukuro.route.json"
const DT := 1.0 / 60.0
## Index of the #227 stall in the deduped Ikebukuro polyline.
const STALL_POINT := 8
## Where a mid-stair pose is looked for, in order, as a fraction of the stair span: the middle first, then either side of
## it, all inside the stair the route states.
const MID_STAIR_FRACTIONS: Array[float] = [0.5, 0.4, 0.6, 0.3, 0.7]

## Why the default pose list is shorter than the evidence routes call for (a route the router refuses, a stair span with
## no walkable mid point, a missing route file). Reported in report.json: a pose is missing loudly, never silently.
var pose_problems: Array[String] = []
## The Ikebukuro route file the G-4 route poses sample is missing or unreadable: the run still captures every other
## pose, but it exits non-zero, because a route list without them is not the capture the runbook asked for.
var route_file_missing := false


## `ao` / `ao_light_affect` are what the client loaded the station with (`hq.gd`): recorded so the report states the AO
## state the pictures were taken with. `ao_light_affect` is null when AO was off or Godot's default was kept;
## `ao_light_affect_requested` keeps the value the run asked for, whether or not AO was applied.
func run(hq: Node3D, out_dir: String, poses_file: String, look: String, gi: String, perf_seconds: float, ao := true, ao_light_affect := -1.0) -> int:
	var started := Time.get_ticks_msec()
	var dir := out_dir if out_dir.is_absolute_path() else ProjectSettings.globalize_path("res://").path_join(out_dir)
	if DirAccess.make_dir_recursive_absolute(dir) != OK:
		printerr("Cannot create %s" % dir)
		return 1
	var station := String(hq.current.root.name)
	var poses := read_poses(poses_file) if not poses_file.is_empty() else build_poses(hq, station)
	if poses.is_empty():
		printerr("No poses to capture")
		return 1
	var window := hq.get_window()
	window.size = Vector2i(WIDTH, HEIGHT)
	hq._placing = true
	for i in 5:
		await hq.get_tree().process_frame
	var results: Array = []
	var timed_out := false
	var failures := 0
	for i in poses.size():
		# Never start a pose the 10-minute bound cannot hold: the settle, the warm-up and the perf window all count.
		var pose_budget_ms := int(perf_seconds * 1000.0) + POSE_OVERHEAD_MS
		if Time.get_ticks_msec() - started + pose_budget_ms > TIMEOUT_MS:
			timed_out = true
			printerr("Capture timeout after %d of %d poses" % [i, poses.size()])
			break
		var result := await capture_pose(hq, poses[i], i, dir, station, perf_seconds)
		if result.has("error"):
			failures += 1
		results.append(result)
		print("capture %d/%d %s %s" % [i + 1, poses.size(), poses[i].name, result.get("file", result.get("error", ""))])
	var report := {
		"contract": "gteki.capture/0.1",
		"station": station,
		"look": look,
		"gi": gi,
		"ao": ao,
		# What the AO copies actually carry (null with AO off, or when Godot's default was kept), and what the run asked
		# for, kept apart so `--ao=off --ao-light-affect=0.5` does not read as AO applied at 0.5.
		"ao_light_affect": null if (not ao or ao_light_affect < 0.0) else ao_light_affect,
		"ao_light_affect_requested": null if ao_light_affect < 0.0 else ao_light_affect,
		"perf_seconds": perf_seconds,
		"machine": machine(),
		# What this run rendered with. The project setting is `gl_compatibility` and the runbook asks for Forward+ on the
		# command line, so the figures must be labelled with the runtime method; the project default is kept apart, as
		# `project_renderer`, and is never what a performance table calls the renderer.
		"renderer": RenderingServer.get_current_rendering_method(),
		"project_renderer": str(ProjectSettings.get_setting("rendering/renderer/rendering_method")),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"window": [window.size.x, window.size.y],
		"resolution": [WIDTH, HEIGHT],
		"settle_physics_frames": SETTLE_PHYSICS_FRAMES,
		"perf_warmup_frames": PERF_WARMUP_FRAMES,
		"timing_frames": TIMING_FRAMES,
		"poses_file": poses_file,
		"pose_problems": pose_problems,
		"timed_out": timed_out,
		"elapsed_s": (Time.get_ticks_msec() - started) / 1000.0,
		"poses": results,
	}
	var file := FileAccess.open(dir.path_join("report.json"), FileAccess.WRITE)
	if file == null:
		printerr("Cannot write report.json in %s" % dir)
		return 1
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
	var notes := ""
	if failures > 0:
		notes += ", %d failed" % failures
	if timed_out:
		notes += ", TIMED OUT"
	if route_file_missing:
		notes += ", ROUTE FILE MISSING (see pose_problems)"
	print("captured %d poses%s in %.1f s -> %s" % [results.size(), notes, report.elapsed_s, dir])
	if route_file_missing:
		printerr("The Ikebukuro route poses are missing (%s); this run is not a complete capture" % ROUTE_FILE)
	return 1 if (failures > 0 or timed_out or route_file_missing) else 0


func capture_pose(hq: Node3D, pose: Dictionary, index: int, dir: String, station: String, perf_seconds := 0.0) -> Dictionary:
	var walker: Walker = hq.walker
	var camera: Camera3D = hq.camera
	var position := Vector3(pose.position[0], pose.position[1], pose.position[2])
	if not walker.walk_from(position, 0.0):
		return {"name": pose.name, "error": "no walkable ground at %s" % str(position), "pose": pose}
	walker.yaw = deg_to_rad(float(pose.yaw_deg))
	walker.body_yaw = walker.yaw
	walker._sync_avatar()
	walker.pitch = float(pose.get("pitch", Walker.DEFAULT_PITCH))
	walker.cam_distance = float(pose.get("distance", Walker.DEFAULT_DISTANCE))
	camera.follow(walker, DT, true)
	for i in SETTLE_PHYSICS_FRAMES:
		await hq.get_tree().physics_frame
		camera.follow(walker, DT)
	for i in SETTLE_RENDER_FRAMES:
		await RenderingServer.frame_post_draw
	var result := {
		"name": pose.name,
		"pose": pose,
		"feet": _vec(walker.global_position),
	}
	var frame_ms_avg := 0.0
	if perf_seconds > 0.0:
		result["perf"] = await sample_perf(perf_seconds)
	else:
		var started := Time.get_ticks_usec()
		for i in TIMING_FRAMES:
			await RenderingServer.frame_post_draw
		frame_ms_avg = (Time.get_ticks_usec() - started) / 1000.0 / TIMING_FRAMES
	var image := hq.get_viewport().get_texture().get_image()
	if image == null:
		result["error"] = "no viewport image"
		return result
	if image.get_width() != WIDTH or image.get_height() != HEIGHT:
		image.resize(WIDTH, HEIGHT, Image.INTERPOLATE_LANCZOS)
	var file_name := "%02d_%s.png" % [index, String(pose.name).validate_filename()]
	var err := image.save_png(dir.path_join(file_name))
	if err != OK:
		result["error"] = "save_png failed (%d)" % err
		return result
	result["file"] = file_name
	var xf := camera.global_transform
	result["camera"] = {
		"origin": _vec(xf.origin),
		"basis_x": _vec(xf.basis.x), "basis_y": _vec(xf.basis.y), "basis_z": _vec(xf.basis.z),
		"fov": camera.fov,
		"distance": camera.last_distance,
	}
	var stats := {
		"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		"video_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED),
		"texture_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED),
		"buffer_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED),
	}
	# The short capture-only timing; a perf run measured the same frames properly and reports it under `perf`.
	if perf_seconds <= 0.0:
		stats["frame_ms_avg_%d" % TIMING_FRAMES] = frame_ms_avg
	result["stats"] = stats
	return result


## Measure one settled pose: PERF_WARMUP_FRAMES rendered frames first (shader compilation, first-use uploads), then
## rendered frames until `seconds` of wall clock have passed. The warm-up frames are awaited before any series starts,
## so no warm-up frame is in one. Each measured frame records
##  - `frame_ms`: the wall-clock interval between consecutive rendered frames — vsync, presenter and compositor included;
##  - `setup_ms`: `RenderingServer.get_frame_setup_time_cpu()`, the CPU time the renderer spent setting up that frame.
## `Performance.TIME_PROCESS` is not a per-frame figure: the engine refreshes it about once a second with the largest
## process time seen in that second, so it is one scalar for the window (`process_interval_max_ms`), never a percentile
## series. The RenderingServer counters are read at the end of the same window.
func sample_perf(seconds: float) -> Dictionary:
	for i in PERF_WARMUP_FRAMES:
		await RenderingServer.frame_post_draw
	var setup_ms: Array[float] = []
	var frame_ms: Array[float] = []
	var start := Time.get_ticks_usec()
	var last := start
	while true:
		await RenderingServer.frame_post_draw
		var now := Time.get_ticks_usec()
		frame_ms.append((now - last) / 1000.0)
		last = now
		setup_ms.append(RenderingServer.get_frame_setup_time_cpu())
		if now - start >= int(seconds * 1000000.0):
			break
	var setup := percentiles(setup_ms)
	if float(setup.get("max", 0.0)) <= 0.0:
		# A renderer that reports no setup time reports nothing, rather than a wall of 0.00 ms frames.
		setup = {}
	return {
		"warmup_frames": PERF_WARMUP_FRAMES,
		"seconds": seconds,
		"frames": frame_ms.size(),
		"frame_ms": percentiles(frame_ms),
		"setup_ms": setup,
		# One figure for the whole window: see the note above on why this is not per-frame.
		"process_interval_max_ms": snappedf(Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, 0.001),
		"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
		"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
		"objects": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
		"video_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED),
		"texture_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED),
		"buffer_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED),
	}


## p50/p95/max of a measured series, nearest-rank (the smallest value with at least that share of the samples at or
## below it); {} for no samples, so nothing is reported as a 0 ms frame.
static func percentiles(values: Array[float]) -> Dictionary:
	if values.is_empty():
		return {}
	var sorted := values.duplicate()
	sorted.sort()
	return {
		"p50": snappedf(sorted[nearest_rank(0.5, sorted.size())], 0.001),
		"p95": snappedf(sorted[nearest_rank(0.95, sorted.size())], 0.001),
		"max": snappedf(sorted[sorted.size() - 1], 0.001),
	}


static func nearest_rank(q: float, count: int) -> int:
	return clampi(int(ceil(q * count)) - 1, 0, count - 1)


## What the run was measured on: the machine and its adapter, recorded from the runtime rather than typed in.
static func machine() -> Dictionary:
	return {
		"os": OS.get_name(),
		"os_version": OS.get_version(),
		"processor": OS.get_processor_name(),
		"gpu": RenderingServer.get_video_adapter_name(),
		"gpu_vendor": RenderingServer.get_video_adapter_vendor(),
	}


## The capture/perf arguments, parsed in one place so the client only routes them and the tests state the rules.
## {"capture": dir, "poses": file, "perf_s": float, "error": ""}; a non-empty error is an argument error (exit 2).
static func parse_args(args: PackedStringArray) -> Dictionary:
	var out := {"capture": "", "poses": "", "perf_s": 0.0, "error": ""}
	for arg in args:
		if arg.begins_with("--capture="):
			out.capture = arg.trim_prefix("--capture=")
			if String(out.capture).is_empty():
				out.error = "--capture needs a directory"
		elif arg.begins_with("--poses="):
			out.poses = arg.trim_prefix("--poses=")
			if String(out.poses).is_empty():
				out.error = "--poses needs a file"
		elif arg.begins_with("--perf="):
			var value := arg.trim_prefix("--perf=")
			if not value.is_valid_float() or float(value) <= 0.0:
				out.error = "--perf must be a positive number of seconds, not %s" % value
			else:
				out.perf_s = float(value)
	if String(out.error).is_empty() and float(out.perf_s) > 0.0 and String(out.capture).is_empty():
		out.error = "--perf needs --capture=<dir>: the numbers are written into its report.json"
	return out


static func _vec(v: Vector3) -> Array:
	return [snappedf(v.x, 0.0001), snappedf(v.y, 0.0001), snappedf(v.z, 0.0001)]


static func read_poses(path: String) -> Array:
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	if not (parsed is Array):
		printerr("Poses file %s is not a JSON array" % path)
		return []
	var poses: Array = []
	for i in parsed.size():
		var p: Dictionary = parsed[i]
		if not (p.get("position") is Array) or p.position.size() != 3 or not p.has("yaw_deg"):
			printerr("Pose %d needs position [x,y,z] and yaw_deg" % i)
			return []
		if not p.has("name"):
			p["name"] = "pose%d" % i
		poses.append(p)
	return poses


## Walker yaw (radians) that looks along the Godot-frame direction (dx, dz): forward is (-sin yaw, -cos yaw).
static func yaw_deg_toward(dx: float, dz: float) -> float:
	return rad_to_deg(atan2(-dx, -dz))


func build_poses(hq: Node3D, station: String) -> Array:
	var poses: Array = []
	var spawns: Array = hq.current.spawn_points
	for s in spawns.size():
		var spawn: Dictionary = spawns[s]
		var base_yaw := -float(spawn.heading_deg)
		for k in 4:
			poses.append({
				"name": "spawn%d_%s_yaw%d" % [s, String(spawn.node_id), k * 90],
				"position": [spawn.position.x, spawn.position.y, spawn.position.z],
				"yaw_deg": base_yaw + k * 90.0,
			})
	if station == "ikebukuro":
		poses.append_array(route_poses(ROUTE_FILE))
	elif station == "shinjuku":
		poses.append_array(inverted_wall_poses(hq))
	poses.append_array(evidence_poses(hq.walker, station))
	return poses


## Follow-camera poses every ROUTE_STEP metres along the g_jr_c2 -> x35 polyline, plus the #227 stall area.
## A missing or unreadable route file is a failure of the run, not a shorter pose list: it is recorded in
## `pose_problems` and `route_file_missing`, and the run exits non-zero (the other poses still capture).
func route_poses(path: String) -> Array:
	var text := FileAccess.get_file_as_string(path)
	var route: Variant = JSON.parse_string(text) if not text.is_empty() else null
	if not (route is Dictionary) or not route.has("polyline"):
		route_file_missing = true
		var message := "No route file at %s, so the G-4 route poses are not captured (see README, G-4)" % path
		pose_problems.append(message)
		printerr(message)
		return []
	var points: Array[Vector3] = []
	for p in route.polyline:
		var q := Vector3(p.renderer[0], p.renderer[1], p.renderer[2])
		if points.is_empty() or Vector2(q.x - points[-1].x, q.z - points[-1].z).length() > 0.05:
			points.append(q)
	var poses: Array = []
	var next_at := 0.0
	var travelled := 0.0
	for i in range(points.size() - 1):
		var a := points[i]
		var b := points[i + 1]
		var seg := Vector2(b.x - a.x, b.z - a.z).length()
		var yaw := yaw_deg_toward(b.x - a.x, b.z - a.z)
		while next_at <= travelled + seg:
			var t := (next_at - travelled) / seg
			var at := a.lerp(b, t)
			poses.append({"name": "route_%03dm" % int(round(next_at)), "position": [at.x, at.y, at.z], "yaw_deg": yaw})
			next_at += ROUTE_STEP
		travelled += seg
	if points.size() > STALL_POINT:
		var a := points[STALL_POINT - 1]
		var b := points[STALL_POINT]
		var dir := Vector2(b.x - a.x, b.z - a.z)
		var back := minf(dir.length(), 4.0)
		var from := Vector2(b.x, b.z) - dir.normalized() * back
		poses.append({"name": "stall227_point%d" % STALL_POINT, "position": [from.x, b.y, from.y], "yaw_deg": yaw_deg_toward(dir.x, dir.y)})
	return poses


## Three poses facing walls whose band is inverted (zMax < zMin), standing 1.5 m off on whichever side has ground.
static func inverted_wall_poses(hq: Node3D) -> Array:
	var candidates: Array = []
	for wall in hq.current.sidecar.get("walls", []):
		if float(wall.zMax) < float(wall.zMin):
			var dx: float = float(wall.b.x) - float(wall.a.x)
			var dz: float = -(float(wall.b.y) - float(wall.a.y))
			if Vector2(dx, dz).length() >= 2.0:
				candidates.append(wall)
	var poses: Array = []
	var walker: Walker = hq.walker
	var stride := maxi(1, candidates.size() / 7)
	var index := stride / 2
	var tried := 0
	while poses.size() < 3 and tried < candidates.size():
		var wall: Dictionary = candidates[index % candidates.size()]
		index += stride
		tried += 1
		var mx: float = (float(wall.a.x) + float(wall.b.x)) * 0.5
		var mz: float = -(float(wall.a.y) + float(wall.b.y)) * 0.5
		var dx: float = float(wall.b.x) - float(wall.a.x)
		var dz: float = -(float(wall.b.y) - float(wall.a.y))
		var n := Vector2(-dz, dx).normalized()
		var found := false
		for y in [float(wall.zMax), float(wall.zMin)]:
			for off in [1.5, 2.5]:
				for side in [1.0, -1.0]:
					var sx: float = mx + n.x * off * side
					var sz: float = mz + n.y * off * side
					if not found and walker.ground_at(sx, y + 0.5, sz, 4.0) != null:
						poses.append({
							"name": "inverted_wall%d" % poses.size(),
							"position": [sx, y, sz],
							"yaw_deg": yaw_deg_toward(mx - sx, mz - sz),
						})
						found = true
	return poses


# ---- G-5 evidence poses --------------------------------------------------------------------------------------------

## The G-5 evidence poses: for every route the evidence walk covers (`gteki_evidence.gd`), its start, its mid-stair
## point and its goal, plus the landing of every lift the route states (Shinjuku S4's shaft is the one in the goldens).
## The routes come from the real router through the bridge, so a pose cannot describe a route the walk does not check;
## a route it refuses, or a route with no walkable stair middle, is stated in `pose_problems` instead of being guessed.
func evidence_poses(walker: Walker, station: String) -> Array:
	if Evidence.routes(station).is_empty():
		pose_problems.append("%s has no G-5 evidence routes" % station)
		return []
	var bridge := Bridge.new()
	if bridge.repo_root.is_empty():
		pose_problems.append("Cannot find the repository root; no evidence poses")
		return []
	var golden := Evidence.load_golden(bridge.repo_root, station)
	if golden.is_empty():
		pose_problems.append("No golden for %s; no evidence poses" % station)
		return []
	var poses: Array = []
	for spec in Evidence.routes(station):
		var label := str(spec.label)
		var scenario: Variant = golden.get(str(spec.golden))
		if not scenario is Dictionary:
			pose_problems.append("%s: golden scenario %s is missing" % [label, str(spec.golden)])
			continue
		var routed := Evidence.route_for(bridge, station, scenario)
		if not routed.ok:
			pose_problems.append("%s: the router gives no route (%s)" % [label, str(routed.get("error", ""))])
			continue
		poses.append_array(route_evidence_poses(label, routed.doc, walker))
	return poses


## One route's own poses: start, mid-stair (when the route has a `stairs` step) and goal, then each lift's landing.
func route_evidence_poses(label: String, doc: Dictionary, walker: Walker) -> Array:
	var guide := Guide.new()
	if not guide.load_doc(doc) or guide.points.size() < 2:
		pose_problems.append("%s: the route does not load in the guide (%s)" % [label, str(guide.issues)])
		return []
	var poses: Array = []
	var points := guide.points
	poses.append(_pose("g5_%s_start" % label, "start", label, points[0],
		yaw_deg_toward(points[1].x - points[0].x, points[1].z - points[0].z)))
	var last := points.size() - 1
	poses.append(_pose("g5_%s_goal" % label, "goal", label, points[last],
		yaw_deg_toward(points[last].x - points[last - 1].x, points[last].z - points[last - 1].z)))
	var stairs: Array = (doc.result as Dictionary).get("steps", [])
	var stair := stair_span(guide, stairs)
	if stair.is_empty():
		pose_problems.append("%s: no stairs step, so no mid-stair pose" % label)
	else:
		var mid := stair_mid_pose(guide, walker, float(stair.from_s), float(stair.to_s))
		if mid.is_empty():
			pose_problems.append("%s: the stair span has no walkable mid point" % label)
		else:
			var pose := _pose("g5_%s_mid_stair" % label, "mid_stair", label, mid.position, mid.yaw_deg)
			pose["step"] = int(stair.step)
			pose["s"] = mid.s
			poses.append(pose)
	var rides: Array = guide.rides
	for r in rides.size():
		var ride: Dictionary = rides[r]
		var landing := ride_landing_pose(guide, walker, ride)
		if landing.is_empty():
			pose_problems.append("%s: the lift exit has no landing the walker accepts" % label)
			continue
		var name := "g5_%s_lift_landing" % label if rides.size() == 1 else "g5_%s_lift%d_landing" % [label, r + 1]
		var pose := _pose(name, "lift_landing", label, landing.position, landing.yaw_deg)
		pose["step"] = int(ride.step)
		poses.append(pose)
	return poses


static func _pose(name: String, kind: String, route: String, at: Vector3, yaw: float) -> Dictionary:
	return {
		"name": name,
		"kind": kind,
		"route": route,
		"position": [snappedf(at.x, 0.0001), snappedf(at.y, 0.0001), snappedf(at.z, 0.0001)],
		"yaw_deg": snappedf(yaw, 0.01),
	}


## The first `stairs` step's span on the route's own polyline: from the point before its first point to its last point
## (a point's stepIndex names the step that ends there), with the path distance at both ends. {} when the route has no
## stairs step, so no mid-stair point exists to capture.
static func stair_span(guide: Guide, steps: Array) -> Dictionary:
	for step_id in range(steps.size()):
		var record: Variant = steps[step_id]
		if not record is Dictionary or str(record.get("mode", "")) != "stairs":
			continue
		var first := -1
		var last := -1
		for k in guide.step_index.size():
			if guide.step_index[k] == step_id:
				if first < 0:
					first = k
				last = k
		if first < 0:
			continue
		var from_point := maxi(0, first - 1)
		return {"step": step_id, "from_point": from_point, "to_point": last,
			"from_s": guide.cumulative[from_point], "to_s": guide.cumulative[last]}
	return {}


## A point inside the stair span, on ground the walker can stand on: the span's middle first, then either side of it.
## `walker` may be null, and then the sampled middle is taken without the ground test (only the windowed client can
## ray-test the station). {} when no fraction has ground, so the caller reports a missing pose.
static func stair_mid_pose(guide: Guide, walker: Walker, from_s: float, to_s: float) -> Dictionary:
	for fraction in MID_STAIR_FRACTIONS:
		var at := lerpf(from_s, to_s, fraction)
		var sample := guide.sample(at)
		var position: Vector3 = sample.position
		if walker != null and walker.ground_at(position.x, position.y + 1.5, position.z, 4.0) == null:
			continue
		return {"position": position, "yaw_deg": yaw_deg_toward(float(sample.tx), float(sample.tz)), "s": snappedf(at, 0.001)}
	return {}


## Where a ride's own rules put the feet down from the shaft's exit (`walker.ride_landing`, pure: it asks the station,
## it does not move the walker), facing along the route's continuation so the picture shows where the lift lets out.
static func ride_landing_pose(guide: Guide, walker: Walker, ride: Dictionary) -> Dictionary:
	if walker == null:
		return {}
	var to_point := int(ride.to_point)
	var forward := Vector3.ZERO
	if to_point + 1 < guide.points.size():
		forward = guide.points[to_point + 1] - guide.points[to_point]
	elif to_point > 0:
		forward = guide.points[to_point] - guide.points[to_point - 1]
	var landing: Variant = walker.ride_landing(ride.to, forward)
	if landing == null:
		return {}
	return {"position": landing, "yaw_deg": yaw_deg_toward(forward.x, forward.z)}
