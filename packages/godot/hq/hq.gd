extends Node3D
## HQ client (G-1 loader + G-2 walk): picks a station snapshot, loads it, and lets you walk it third-person.
## No search/route (G-3) yet. The HQ look (G-4b) is opt-in: `--look=hq` builds the sidecar-driven Environment and
## applies the station's material table (gteki_look.gd); the default `baseline` is today's look.
## Run:  godot --path packages/godot res://hq/hq.tscn -- [--station=<id>] [--scenes=<dir>] [--lightmap=on|off] [--look=baseline|hq] [--gi=off|sdfgi] [--check]
## <dir> holds <stationId>/{scene.glb,scene.json} from packages/godot/src/export-scene.ts (default: .cache/scenes).
## Keys: WASD/arrows move, Shift runs, drag (left or right mouse) or right stick orbits, wheel zooms,
##       Tab switches station, N cycles the station's spawn points. --check loads every station (or the one named by
##       --station), prints a summary and quits; it also asserts the lighting wiring (check_lighting) on each.
##       --lightmap=on (default) applies the station's baked lightmap (G-4a); =off keeps the unlit snapshot. With the
##       lightmap on, the added lights are masked to the avatar, as the web lights only its own avatar in "scene" mode.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const FollowCamera = preload("res://addons/gteki/gteki_follow_camera.gd")
const GuideHud = preload("res://hq/hq_guide.gd")
const HqLights = preload("res://addons/gteki/gteki_hq_lights.gd")
const Look = preload("res://addons/gteki/gteki_look.gd")

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
var guide_hud: GuideHud
var lightmap := true
## G-4b: "baseline" (today's look) or "hq" (style-bible look); see gteki_look.gd.
var look_profile := "baseline"
var gi := "off"
var look_node: WorldEnvironment
var material_table: Dictionary = {}
var materials_applied := 0
## Key + fill, masked to the avatar layer while a station bake is applied (gteki_hq_lights.gd).
var lights: Array[DirectionalLight3D] = []
var _look := Vector2.ZERO
var _zoom := 0.0
var _placing := false


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
		elif arg.begins_with("--lightmap="):
			var value := arg.trim_prefix("--lightmap=")
			if value != "on" and value != "off":
				printerr("--lightmap must be on or off, not %s" % value)
				get_tree().quit(2)
				return
			lightmap = value == "on"
	var look_args := Look.parse_args(OS.get_cmdline_user_args())
	if not (look_args.errors as Array).is_empty():
		for message in look_args.errors:
			printerr(message)
		get_tree().quit(2)
		return
	look_profile = str(look_args.profile)
	gi = str(look_args.gi)
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
	lights = HqLights.build(self)
	look_node = Look.build(self, look_profile)
	if look_profile == "hq":
		material_table = Look.load_table()
		if material_table.is_empty():
			printerr("--look=hq but %s is missing or unreadable" % Look.TABLE_PATH)
	if not check_only:
		guide_hud = GuideHud.new()
		add_child(guide_hud)
		guide_hud.setup(self)
	if check_only:
		# Every station unless one was named: --check is the one place the real client asserts its lighting wiring.
		var ids: Array[String] = []
		if wanted.is_empty():
			ids.append_array(station_ids)
		else:
			ids.append(wanted)
		var ok := true
		for id in ids:
			var loaded := load_station(id)
			if not loaded:
				ok = false
				continue
			var placed := await place_at_spawn(0)
			ok = (placed and check_lighting(id)) and ok
		get_tree().quit(0 if ok else 1)
		return
	var ok := load_station(wanted if not wanted.is_empty() else station_ids[0])
	if ok:
		ok = await place_at_spawn(0)


func lightmap_summary() -> String:
	if not current.lightmap.is_empty() and not lightmap:
		return "lightmap off (%d meshes recorded)" % int(current.lightmap.get("meshes", 0))
	if current.lightmap_applied:
		return "lightmap %d meshes / %d surfaces, %dx%d" % [current.lightmap_meshes, current.lightmap_surfaces, current.lightmap_texture_size.x, current.lightmap_texture_size.y]
	return "no lightmap"


## One line for the station summary: the look profile, or what the hq Environment took from the sidecar.
func look_summary() -> String:
	if look_node == null or look_node.environment == null:
		return "look baseline"
	var environment := look_node.environment
	var ambient := "ambient off" if environment.ambient_light_source == Environment.AMBIENT_SOURCE_DISABLED else "ambient %.2f" % environment.ambient_light_energy
	var fog := "fog %d..%d" % [int(environment.fog_depth_begin), int(environment.fog_depth_end)] if environment.fog_enabled else "no fog"
	return "look hq (AgX %.2f, ssao, %s, %s, %s, %d surfaces mapped)" % [
		environment.tonemap_exposure, fog, ambient, "sdfgi" if environment.sdfgi_enabled else "gi off", materials_applied]


## --check: the added lights' cull masks are exactly the expected ones (`gteki_hq_lights.gd`), every station mesh that
## still draws is on WORLD_LAYER, and with a bake applied at least one light reaches the avatar layer. Run after
## `load_station`, i.e. against the same snapshot and lightmap state the client renders.
func check_lighting(id: String) -> bool:
	var ok := true
	var expected := HqLights.cull_mask(current.lightmap_applied)
	for light in lights:
		if light.light_cull_mask != expected:
			printerr("%s: light %s cull mask 0x%x != 0x%x" % [id, light.name, light.light_cull_mask, expected])
			ok = false
	var drawn := 0
	var off_layer := 0
	var stack: Array[Node] = [current.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D:
			continue
		var mesh: MeshInstance3D = node
		if not Scene.is_drawn(mesh):
			continue
		drawn += 1
		if mesh.layers != HqLights.WORLD_LAYER:
			off_layer += 1
	if drawn == 0:
		printerr("%s: no station mesh draws, so the layer check would pass vacuously" % id)
		ok = false
	if off_layer > 0:
		printerr("%s: %d of %d drawing station mesh(es) are not on WORLD_LAYER" % [id, off_layer, drawn])
		ok = false
	if current.lightmap_applied:
		var on_avatar := 0
		for light in lights:
			if (light.light_cull_mask & Walker.AVATAR_LAYER) != 0:
				on_avatar += 1
		if on_avatar == 0:
			printerr("%s: no light reaches the avatar layer while the bake is applied" % id)
			ok = false
	print("%s: lighting check %s (lightmap %s, %d lights, mask 0x%x, %d drawing meshes on WORLD_LAYER)" % [id, "ok" if ok else "FAILED", "applied" if current.lightmap_applied else "off", lights.size(), expected, drawn])
	return ok


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
	var ok := current.load_snapshot(scenes_dir.path_join(id), holder, {"lightmap": lightmap})
	if not ok:
		printerr("Cannot load %s: %s" % [id, str(current.issues)])
		return false
	# The bake is the station's light and the web adds no scene lights: the added lights then reach the avatar layer
	# only, so the avatar stays shaded instead of a black silhouette. The unlit snapshot (--lightmap=off or a station
	# without a lightmap such as Shinjuku) keeps them on every layer.
	HqLights.apply(lights, current.lightmap_applied)
	# G-4b: the Environment follows the station just loaded (exposure, fog, ambient rule), then the material table.
	Look.apply(look_node, current, gi)
	materials_applied = 0
	if look_profile == "hq":
		var table := Look.apply_materials(current.root, material_table, id)
		materials_applied = int(table.applied)
		if not (table.missing as Array).is_empty():
			printerr("%s: material table names %s, absent from the snapshot" % [id, str(table.missing)])
	print("%s: %d meshes (walkable %d, collider %d), %d walls, %d spawn points, %d export warnings, %s, %s" % [id, current.counts.meshes, current.counts.walkable, current.counts.collider, current.wall_shapes, current.spawn_points.size(), current.sidecar.warnings.size(), lightmap_summary(), look_summary()])
	var background: Variant = current.environment.get("background")
	if background is float or background is int:
		RenderingServer.set_default_clear_color(Color.hex((int(background) << 8) | 0xff))
	walker.set_walls(current.sidecar.get("walls", []))
	if guide_hud != null:
		guide_hud.station_changed(id)
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
		if guide_hud != null:
			guide_hud.refresh_labels()
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
	if guide_hud != null and guide_hud.typing():
		move = Vector2.ZERO
	walker.apply_look(look.x, look.y, _zoom)
	_look = Vector2.ZERO
	_zoom = 0.0
	# G-3: guided walking moves the avatar along the route itself; any movement key hands control back.
	if guide_hud != null and guide_hud.physics(delta, move):
		return
	walker.step(delta, move, Input.is_physical_key_pressed(KEY_SHIFT))
	camera.follow(walker, delta)
