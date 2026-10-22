extends Node3D
## HQ client skeleton (G-1): picks a station snapshot and loads it. No walking yet (G-2) and no HQ look (G-4).
## Run:  godot --path packages/godot res://hq/hq.tscn -- [--station=<id>] [--scenes=<dir>] [--check]
## <dir> holds <stationId>/{scene.glb,scene.json} from packages/godot/src/export-scene.ts (default: .cache/scenes).
## Tab cycles stations. --check loads, prints a summary and quits (usable with --headless).

const Scene = preload("res://addons/gteki/gteki_scene.gd")

var scenes_dir := ProjectSettings.globalize_path("res://.cache/scenes")
var station_ids: Array[String] = []
var current: Scene
var holder: Node3D
var camera: Camera3D


func _ready() -> void:
	var wanted := ""
	var check_only := false
	for arg in OS.get_cmdline_user_args():
		if arg.begins_with("--station="):
			wanted = arg.trim_prefix("--station=")
		elif arg.begins_with("--scenes="):
			scenes_dir = arg.trim_prefix("--scenes=")
		elif arg == "--check":
			check_only = true
	station_ids = list_stations(scenes_dir)
	if station_ids.is_empty():
		printerr("No station snapshots in %s (run packages/godot/run-scenes.sh)" % scenes_dir)
		get_tree().quit(1)
		return
	camera = Camera3D.new()
	camera.far = 500.0
	add_child(camera)
	var light := DirectionalLight3D.new()
	light.rotation_degrees = Vector3(-50, 30, 0)
	add_child(light)
	var ok := load_station(wanted if not wanted.is_empty() else station_ids[0])
	if check_only:
		await get_tree().physics_frame
		await get_tree().physics_frame
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
	if not current.spawn_points.is_empty():
		var spawn: Dictionary = current.spawn_points[0]
		# Compass heading: clockwise from north, and north is -Z. Eye height is WALKER_BODY.eyeM.
		camera.position = spawn.position + Vector3.UP * 1.62
		camera.rotation = Vector3(0.0, -deg_to_rad(spawn.heading_deg), 0.0)
	return true


func _unhandled_key_input(event: InputEvent) -> void:
	if event is InputEventKey and event.pressed and event.keycode == KEY_TAB and not station_ids.is_empty():
		var next := (station_ids.find(current.root.name if current != null and current.root != null else "") + 1) % station_ids.size()
		load_station(station_ids[next])
