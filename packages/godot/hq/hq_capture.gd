extends RefCounted
## G-4 capture mode: place the walker on a list of poses, let the follow camera settle, save the viewport as a PNG and
## record RenderingServer stats. Windowed only (a headless display has nothing to render).
## Run:  godot --path packages/godot --rendering-method forward_plus res://hq/hq.tscn -- --station=<id> --capture=<outDir>
##         [--poses=<file>] [--look=baseline|hq]
## Poses file: JSON array of {name, position:[x,y,z] (Godot frame, near the ground), yaw_deg (walker yaw, 0 faces -Z,
## positive turns left), pitch?, distance?}. Default poses are built from the station's spawn points, plus the
## g_jr_c2 -> x35 route for Ikebukuro (.cache/routes/ikebukuro.route.json) and inverted-band walls for Shinjuku.

const Walker = preload("res://addons/gteki/gteki_walker.gd")

const WIDTH := 1600
const HEIGHT := 900
const SETTLE_PHYSICS_FRAMES := 45
const SETTLE_RENDER_FRAMES := 3
const TIMING_FRAMES := 30
const TIMEOUT_MS := 10 * 60 * 1000
const ROUTE_STEP := 15.0
const DT := 1.0 / 60.0
## Index of the #227 stall in the deduped Ikebukuro polyline.
const STALL_POINT := 8


## The `--look=hq` environment: AgX tone mapping, SSAO on, glow off and one ambient source. Nothing else changes.
static func hq_environment() -> WorldEnvironment:
	var env := Environment.new()
	env.background_mode = Environment.BG_CLEAR_COLOR
	env.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	env.ambient_light_color = Color(0.85, 0.9, 1.0)
	env.ambient_light_energy = 0.6
	env.tonemap_mode = Environment.TONE_MAPPER_AGX
	env.ssao_enabled = true
	env.glow_enabled = false
	var node := WorldEnvironment.new()
	node.name = "hq_environment"
	node.environment = env
	return node


func run(hq: Node3D, out_dir: String, poses_file: String, look: String) -> int:
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
		if Time.get_ticks_msec() - started > TIMEOUT_MS:
			timed_out = true
			printerr("Capture timeout after %d of %d poses" % [i, poses.size()])
			break
		var result := await capture_pose(hq, poses[i], i, dir, station)
		if result.has("error"):
			failures += 1
		results.append(result)
		print("capture %d/%d %s %s" % [i + 1, poses.size(), poses[i].name, result.get("file", result.get("error", ""))])
	var report := {
		"contract": "gteki.capture/0.1",
		"station": station,
		"look": look,
		"renderer": str(ProjectSettings.get_setting("rendering/renderer/rendering_method")),
		"rendering_method_runtime": RenderingServer.get_current_rendering_method(),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"resolution": [WIDTH, HEIGHT],
		"settle_physics_frames": SETTLE_PHYSICS_FRAMES,
		"timing_frames": TIMING_FRAMES,
		"timed_out": timed_out,
		"elapsed_s": (Time.get_ticks_msec() - started) / 1000.0,
		"poses": results,
	}
	var file := FileAccess.open(dir.path_join("captures.json"), FileAccess.WRITE)
	if file == null:
		printerr("Cannot write captures.json in %s" % dir)
		return 1
	file.store_string(JSON.stringify(report, "\t"))
	file.close()
	print("captured %d poses (%d failed%s) in %.1f s -> %s" % [results.size(), failures, ", TIMED OUT" if timed_out else "", report.elapsed_s, dir])
	return 1 if (failures > 0 or timed_out) else 0


func capture_pose(hq: Node3D, pose: Dictionary, index: int, dir: String, station: String) -> Dictionary:
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
	var started := Time.get_ticks_usec()
	for i in TIMING_FRAMES:
		await RenderingServer.frame_post_draw
	var frame_ms := (Time.get_ticks_usec() - started) / 1000.0 / TIMING_FRAMES
	var image := hq.get_viewport().get_texture().get_image()
	if image == null:
		return {"name": pose.name, "error": "no viewport image", "pose": pose}
	if image.get_width() != WIDTH or image.get_height() != HEIGHT:
		image.resize(WIDTH, HEIGHT, Image.INTERPOLATE_LANCZOS)
	var file_name := "%02d_%s.png" % [index, String(pose.name).validate_filename()]
	var err := image.save_png(dir.path_join(file_name))
	if err != OK:
		return {"name": pose.name, "error": "save_png failed (%d)" % err, "pose": pose}
	var xf := camera.global_transform
	return {
		"name": pose.name,
		"file": file_name,
		"pose": pose,
		"feet": _vec(walker.global_position),
		"camera": {
			"origin": _vec(xf.origin),
			"basis_x": _vec(xf.basis.x), "basis_y": _vec(xf.basis.y), "basis_z": _vec(xf.basis.z),
			"fov": camera.fov,
			"distance": camera.last_distance,
		},
		"stats": {
			"draw_calls": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			"primitives": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
			"objects": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
			"video_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_VIDEO_MEM_USED),
			"texture_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TEXTURE_MEM_USED),
			"buffer_mem_bytes": RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_BUFFER_MEM_USED),
			"frame_ms_avg_30": frame_ms,
		},
	}


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


static func build_poses(hq: Node3D, station: String) -> Array:
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
		poses.append_array(route_poses(hq))
	elif station == "shinjuku":
		poses.append_array(inverted_wall_poses(hq))
	return poses


## Follow-camera poses every ROUTE_STEP metres along the g_jr_c2 -> x35 polyline, plus the #227 stall area.
static func route_poses(hq: Node3D) -> Array:
	var path := ProjectSettings.globalize_path("res://.cache/routes/ikebukuro.route.json")
	var route: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not (route is Dictionary) or not route.has("polyline"):
		printerr("No route file at %s, skipping the route poses (see README, G-4)" % path)
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
