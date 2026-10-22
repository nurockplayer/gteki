extends Node3D
## HQ client (G-1 loader + G-2 walk): picks a station snapshot, loads it, and lets you walk it third-person.
## No search/route (G-3) and no HQ look (G-4) yet.
## Run:  godot --path packages/godot res://hq/hq.tscn -- [--station=<id>] [--scenes=<dir>] [--check]
## <dir> holds <stationId>/{scene.glb,scene.json} from packages/godot/src/export-scene.ts (default: .cache/scenes).
## Keys: WASD/arrows move, Shift runs, drag (left or right mouse) or right stick orbits, wheel zooms,
##       Tab switches station, N cycles the station's spawn points. --check loads, prints a summary and quits.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const FollowCamera = preload("res://addons/gteki/gteki_follow_camera.gd")
const Capture = preload("res://hq/hq_capture.gd")

## Web wheel notch (deltaY) in the units apply_look expects, and stick look speed in pixels per second.
const WHEEL_UNITS := 100.0
const STICK_LOOK_SPEED := 700.0
const STICK_DEADZONE := 0.15

var scenes_dir := ProjectSettings.globalize_path("res://.cache/scenes")
var station_ids: Array[String] = []
var current: Scene
var holder: Node3D
var walker: Walker
var camera: FollowCamera
var spawn_index := 0
var _look := Vector2.ZERO
var _zoom := 0.0
var _placing := false


func _ready() -> void:
	var wanted := ""
	var check_only := false
	var capture_dir := ""
	var poses_file := ""
	var look := "baseline"
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--station="):
			wanted = arg.trim_prefix("--station=")
		elif arg.begins_with("--scenes="):
			scenes_dir = arg.trim_prefix("--scenes=")
		elif arg == "--check":
			check_only = true
		elif arg.begins_with("--capture="):
			capture_dir = arg.trim_prefix("--capture=")
		elif arg.begins_with("--poses="):
			poses_file = arg.trim_prefix("--poses=")
		elif arg.begins_with("--look="):
			look = arg.trim_prefix("--look=")
	station_ids = list_stations(scenes_dir)
	if station_ids.is_empty():
		printerr("No station snapshots in %s (run packages/godot/run-scenes.sh)" % scenes_dir)
		get_tree().quit(1)
		return
	walker = Walker.new()
	walker.name = "walker"
	add_child(walker)
	camera = FollowCamera.new()
	camera.name = "camera"
	add_child(camera)
	camera.current = true
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-50, 30, 0)
	add_child(light)
	if look == "hq":
		add_child(Capture.hq_environment())
	elif look != "baseline":
		printerr("Unknown --look=%s (baseline or hq)" % look)
		get_tree().quit(2)
		return
	var ok := load_station(wanted if not wanted.is_empty() else station_ids[0])
	if ok:
		ok = await place_at_spawn(0)
	if not capture_dir.is_empty():
		if not ok:
			get_tree().quit(1)
			return
		if DisplayServer.get_name() == "headless":
			print("capture needs a display (run windowed, not --headless)")
			get_tree().quit(0)
			return
		var capture := Capture.new()
		var code := await capture.run(self, capture_dir, poses_file, look)
		get_tree().quit(code)
		return
	if check_only:
		get_tree().quit(0 if ok else 1)


static func list_stations(dir: String) -> Array[String]:
	var found: Array[String] = []
	for entry in DirAccess.get_directories_at(dir):
		if FileAccess.file_exists(dir.path_join(entry).path_join("scene.json")):
			found.append(entry)
	found.sort()
	return found


func load_station(id: String) -> bool:
	if holder != null:
		holder.queue_free()
	holder = Node3D.new()
	add_child(holder)
	current = Scene.new()
	var ok := current.load_snapshot(scenes_dir.path_join(id), holder)
	if not ok:
		printerr("Cannot load %s: %s" % [id, str(current.issues)])
		return false
	print("%s: %d meshes (walkable %d, collider %d), %d walls, %d spawn points, %d export warnings" % [id, current.counts.meshes, current.counts.walkable, current.counts.collider, current.wall_shapes, current.spawn_points.size(), current.sidecar.warnings.size()])
	var background: Variant = current.environment.get("background")
	if background is float or background is int:
		RenderingServer.set_default_clear_color(Color.hex((int(background) << 8) | 0xff))
	walker.set_walls(current.sidecar.get("walls", []))
	return true


## Put the walker on spawn point `index` (wrapping) and the camera behind it. Bodies added this frame only join the
## physics space on the next physics frames, so wait for them.
func place_at_spawn(index: int) -> bool:
	if current == null or current.spawn_points.is_empty():
		printerr("No spawn points to walk from")
		return false
	_placing = true
	await get_tree().physics_frame
	await get_tree().physics_frame
	spawn_index = posmod(index, current.spawn_points.size())
	var spawn: Dictionary = current.spawn_points[spawn_index]
	var ok := walker.walk_from(spawn.position, spawn.heading_deg)
	if ok:
		walker.pitch = Walker.DEFAULT_PITCH
		camera.follow(walker, 0.0, true)
		print("spawn %d/%d %s %s" % [spawn_index + 1, current.spawn_points.size(), spawn.node_id, spawn.label])
	else:
		printerr("No walkable ground at spawn %s" % spawn.node_id)
	_placing = false
	return ok


func _unhandled_input(event: InputEvent) -> void:
	if event is InputEventMouseMotion and (event.button_mask & (MOUSE_BUTTON_MASK_LEFT | MOUSE_BUTTON_MASK_RIGHT)) != 0:
		_look += event.relative
	elif event is InputEventMouseButton and event.pressed:
		if event.button_index == MOUSE_BUTTON_WHEEL_DOWN:
			_zoom += WHEEL_UNITS
		elif event.button_index == MOUSE_BUTTON_WHEEL_UP:
			_zoom -= WHEEL_UNITS
	elif event is InputEventKey and event.pressed and not event.echo and not _placing:
		if event.keycode == KEY_TAB and not station_ids.is_empty():
			var next := (station_ids.find(String(current.root.name)) + 1) % station_ids.size()
			if load_station(station_ids[next]):
				place_at_spawn(0)
		elif event.keycode == KEY_N:
			place_at_spawn(spawn_index + 1)


func _key(key: Key) -> float:
	return 1.0 if Input.is_physical_key_pressed(key) else 0.0


func _physics_process(delta: float) -> void:
	if _placing or current == null:
		return
	var move := Vector2(
		_key(KEY_D) + _key(KEY_RIGHT) - _key(KEY_A) - _key(KEY_LEFT),
		_key(KEY_W) + _key(KEY_UP) - _key(KEY_S) - _key(KEY_DOWN))
	var stick := Vector2(Input.get_joy_axis(0, JOY_AXIS_LEFT_X), -Input.get_joy_axis(0, JOY_AXIS_LEFT_Y))
	if stick.length() > STICK_DEADZONE:
		move = stick
	if move.length() > 1.0:
		move = move.normalized()
	var look := _look
	var right := Vector2(Input.get_joy_axis(0, JOY_AXIS_RIGHT_X), Input.get_joy_axis(0, JOY_AXIS_RIGHT_Y))
	if right.length() > STICK_DEADZONE:
		look += right * STICK_LOOK_SPEED * delta
	walker.apply_look(look.x, look.y, _zoom)
	_look = Vector2.ZERO
	_zoom = 0.0
	walker.step(delta, move, Input.is_physical_key_pressed(KEY_SHIFT))
	camera.follow(walker, delta)
