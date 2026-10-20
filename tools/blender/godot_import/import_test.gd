extends SceneTree

## Imports every GLB copied into res://kit and emits either an inspection report
## or rendered review images. The same imported PackedScene path is used for both.

var output_dir := ""
var kit_paths: Array[String] = []
var loaded: Array[Dictionary] = []
var failed := false

func _initialize() -> void:
	output_dir = OS.get_environment("GTEKI_GODOT_OUT")
	call_deferred("_run")

func _run() -> void:
	var dir := DirAccess.open("res://kit")
	if dir == null:
		_fail("Cannot open res://kit")
		return
	for filename in dir.get_files():
		if filename.to_lower().ends_with(".glb"):
			kit_paths.append("res://kit/" + filename)
	kit_paths.sort()
	if kit_paths.is_empty():
		_fail("No GLBs found in res://kit")
		return

	for path in kit_paths:
		var resource := load(path)
		if not resource is PackedScene:
			_fail("Could not load PackedScene: " + path)
			return
		var instance := (resource as PackedScene).instantiate() as Node3D
		if instance == null:
			_fail("Could not instantiate: " + path)
			return
		root.add_child(instance)
		await process_frame
		loaded.append({"path": path, "report": _inspect(instance)})
		root.remove_child(instance)
		instance.free()

	if OS.get_environment("GTEKI_GODOT_MODE") == "screenshot":
		await _render_screenshots()
	else:
		_write_report()
	quit(1 if failed else 0)

func _inspect(scene_root: Node) -> Dictionary:
	var result := {
		"node_count": 0,
		"mesh_instance_3d_count": 0,
		"static_body_3d_count": 0,
		"collision_shape_3d_count": 0,
		"surfaces": [],
		"materials": [],
		"sockets": [],
		"aabb": null,
		"checks": {},
		"__has_box": false,
		"__box": AABB(),
	}
	_collect(scene_root, result)
	if result.__has_box:
		var merged: AABB = result.__box
		result.aabb = {"min": _vec(merged.position), "max": _vec(merged.end)}
		var entry_ok := absf(merged.end.z) <= 0.05 and merged.position.z < -0.01
		# glTF extras arrive as node metadata "extras"; the contract lets slabs sit below y=0
		var meta := _find_gteki_meta(scene_root)
		var params: Dictionary = meta.get("params", {}) if meta is Dictionary else {}
		var below_ok := params.has("allow_below_floor") and merged.position.y < 0.0
		result.gteki_meta_found = not meta.is_empty()
		# placement-aware origin checks (contract §1)
		var placement: String = str(meta.get("placement", "linear"))
		var floor_ok := absf(merged.position.y) <= 0.05 or below_ok
		result.placement = placement
		result.checks = {"gteki_extras_imported": not meta.is_empty()}
		match placement:
			"linear":
				result.checks.floor_min_y_near_zero = floor_ok
				result.checks.entry_at_z_zero_extends_negative = entry_ok
			"wall":
				result.checks.projects_into_room_from_wall_plane = merged.end.z > 0.01 and merged.position.z <= 0.01
			"free":
				result.checks.floor_min_y_near_zero = floor_ok
				var c := merged.get_center()
				result.checks.footprint_centred = absf(c.x) <= 0.05 and absf(c.z) <= 0.05
			"ceiling":
				result.checks.hangs_above_head_height = merged.position.y >= 2.0
	result.erase("__has_box")
	result.erase("__box")
	return result

func _find_gteki_meta(node: Node) -> Dictionary:
	if node.has_meta("extras"):
		var extras = node.get_meta("extras")
		if extras is Dictionary and extras.has("gteki"):
			var g = extras["gteki"]
			if g is Dictionary:
				return g
	for child in node.get_children():
		var found := _find_gteki_meta(child)
		if not found.is_empty():
			return found
	return {}

func _collect(node: Node, result: Dictionary) -> void:
	result.node_count += 1
	if node is MeshInstance3D:
		result.mesh_instance_3d_count += 1
		var mesh_instance := node as MeshInstance3D
		if mesh_instance.mesh != null:
			var world_box := mesh_instance.global_transform * mesh_instance.get_aabb()
			result.__box = world_box if not result.__has_box else result.__box.merge(world_box)
			result.__has_box = true
			for surface_index in mesh_instance.mesh.get_surface_count():
				var material: Material = mesh_instance.get_surface_override_material(surface_index)
				if material == null:
					material = mesh_instance.mesh.surface_get_material(surface_index)
				var surface_name := ""
				if material != null:
					surface_name = material.resource_name
					if surface_name.is_empty():
						surface_name = material.get_class()
					if not result.materials.has(surface_name):
						result.materials.append(surface_name)
				result.surfaces.append({
					"node": str(node.name),
					"index": surface_index,
					"surface": mesh_instance.mesh.surface_get_name(surface_index),
					"material": surface_name,
				})
	if node is StaticBody3D:
		result.static_body_3d_count += 1
	if node is CollisionShape3D:
		result.collision_shape_3d_count += 1
	if node is Node3D and str(node.name).begins_with("SOCKET_"):
		var marker := node as Node3D
		result.sockets.append({"name": str(node.name), "global_position": _vec(marker.global_position)})
	for child in node.get_children():
		_collect(child, result)

func _write_report() -> void:
	var rows: Array[Dictionary] = []
	for item in loaded:
		var report: Dictionary = item.report
		rows.append({
			"id": item.path.get_file().get_basename(),
			"file": item.path,
			"node_count": report.node_count,
			"mesh_instance_3d_count": report.mesh_instance_3d_count,
			"surfaces": report.surfaces,
			"materials": report.materials,
			"static_body_3d_count": report.static_body_3d_count,
			"collision_shape_3d_count": report.collision_shape_3d_count,
			"sockets": report.sockets,
			"aabb": report.aabb,
			"checks": report.checks,
			"placement": report.get("placement", "unknown"),
		})
	var report_doc := {"godot_version": Engine.get_version_info().string, "assets": rows}
	var file := FileAccess.open(output_dir.path_join("godot_import_report.json"), FileAccess.WRITE)
	if file == null:
		_fail("Cannot write report to " + output_dir)
		return
	file.store_string(JSON.stringify(report_doc, "\t"))
	file.close()
	print("Godot import report: %s" % output_dir.path_join("godot_import_report.json"))
	for row in rows:
		print("PASS %s nodes=%d meshes=%d materials=%d static_bodies=%d collision_shapes=%d sockets=%d AABB=%s" % [
			row.id, row.node_count, row.mesh_instance_3d_count, row.materials.size(),
			row.static_body_3d_count, row.collision_shape_3d_count, row.sockets.size(), str(row.aabb)])
		for check in row.checks:
			if not row.checks[check]:
				print("WARN %s placement=%s check failed: %s" % [row.id, row.get("placement", "?"), check])

func _render_screenshots() -> void:
	var world := Node3D.new()
	world.name = "ReviewWorld"
	root.add_child(world)
	_add_lighting(world)
	var instances: Array[Node3D] = []
	var spacing := 0.0
	var grid_columns := ceili(sqrt(float(loaded.size())))
	for index in loaded.size():
		var item: Dictionary = loaded[index]
		var instance := (load(item.path) as PackedScene).instantiate() as Node3D
		world.add_child(instance)
		instances.append(instance)
	var overview_box := AABB()
	var overview_has_box := false
	for index in loaded.size():
		var item: Dictionary = loaded[index]
		var instance := instances[index]
		var local_box := _local_bounds(instance)
		if local_box.size.length() > spacing:
			spacing = local_box.size.length()
	var gap := maxf(spacing * 0.35, 1.0)
	for index in loaded.size():
		var instance := instances[index]
		var local_box := _local_bounds(instance)
		var col := index % grid_columns
		var row := index / grid_columns
		var offset := Vector3((float(col) - float(grid_columns - 1) * 0.5) * (spacing + gap), 0.0, -float(row) * (spacing + gap))
		var center := local_box.get_center()
		instance.position = Vector3(offset.x - center.x, 0.0, offset.z - center.z)
		var placed_box := instance.transform * local_box
		if not overview_has_box:
			overview_box = placed_box
			overview_has_box = true
		else:
			overview_box = overview_box.merge(placed_box)
	var overview_camera := _make_camera(overview_box, 1.35)
	world.add_child(overview_camera)
	await _settle_frames(5)
	_save_viewport("godot_kit_overview.png")

	for index in loaded.size():
		for child in world.get_children():
			if child is Camera3D:
				world.remove_child(child)
				child.queue_free()
		var instance: Node3D = instances[index]
		for other_index in loaded.size():
			if other_index != index:
				var other := instances[other_index]
				other.visible = false
			else:
				instance.visible = true
		var box := _world_bounds(instance)
		var camera := _make_camera(box, 1.5)
		world.add_child(camera)
		await _settle_frames(4)
		_save_viewport("godot_%s.png" % loaded[index].path.get_file().get_basename())
		world.remove_child(camera)
		camera.queue_free()
		for other_index in loaded.size():
			instances[other_index].visible = true
	print("Godot screenshots: %s" % output_dir)

func _add_lighting(parent: Node3D) -> void:
	var environment := Environment.new()
	environment.background_mode = Environment.BG_SKY
	var sky := Sky.new()
	var sky_material := ProceduralSkyMaterial.new()
	sky_material.sky_top_color = Color(0.14, 0.22, 0.34)
	sky_material.sky_horizon_color = Color(0.56, 0.64, 0.74)
	sky_material.ground_bottom_color = Color(0.09, 0.1, 0.12)
	sky_material.ground_horizon_color = Color(0.38, 0.4, 0.42)
	sky.sky_material = sky_material
	environment.sky = sky
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.ssao_enabled = true
	environment.glow_enabled = true
	environment.glow_intensity = 0.55
	var world_environment := WorldEnvironment.new()
	world_environment.environment = environment
	parent.add_child(world_environment)
	var light := DirectionalLight3D.new()
	light.name = "KeyLight"
	light.rotation_degrees = Vector3(-48.0, -35.0, 0.0)
	light.light_energy = 2.0
	light.shadow_enabled = true
	parent.add_child(light)
	var fill := DirectionalLight3D.new()
	fill.name = "FillLight"
	fill.rotation_degrees = Vector3(-22.0, 145.0, 0.0)
	fill.light_energy = 0.55
	fill.shadow_enabled = false
	parent.add_child(fill)

func _make_camera(box: AABB, multiplier: float) -> Camera3D:
	var camera := Camera3D.new()
	camera.current = true
	var center := box.get_center()
	var radius := maxf(box.size.length() * 0.5, 1.0)
	var distance := radius * multiplier / tan(deg_to_rad(camera.fov * 0.5))
	var direction := Vector3(1.0, 0.72, 1.15).normalized()
	camera.position = center + direction * distance
	camera.basis = Basis.looking_at(center - camera.position, Vector3.UP)
	camera.near = maxf(0.01, distance / 500.0)
	camera.far = maxf(1000.0, distance * 20.0)
	return camera

func _local_bounds(node: Node) -> AABB:
	var result := AABB()
	var has_box := false
	var queue: Array[Node] = [node]
	while not queue.is_empty():
		var current: Node = queue.pop_front()
		if current is MeshInstance3D and (current as MeshInstance3D).mesh != null:
			var relative: Transform3D = node.global_transform.affine_inverse() * current.global_transform
			var box: AABB = relative * (current as MeshInstance3D).get_aabb()
			result = box if not has_box else result.merge(box)
			has_box = true
		for child in current.get_children():
			queue.append(child)
	return result if has_box else AABB(Vector3(-0.5, 0, -0.5), Vector3.ONE)

func _world_bounds(node: Node) -> AABB:
	return node.global_transform * _local_bounds(node)

func _settle_frames(count: int) -> void:
	for _frame in count:
		await process_frame

func _save_viewport(filename: String) -> void:
	var image := root.get_texture().get_image()
	var path := output_dir.path_join(filename)
	var error := image.save_png(path)
	if error != OK:
		_fail("Could not save screenshot %s (error %d)" % [path, error])

func _vec(value: Vector3) -> Array[float]:
	return [value.x, value.y, value.z]

func _fail(message: String) -> void:
	failed = true
	push_error(message)
	quit(1)
