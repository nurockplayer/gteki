extends SceneTree
## Headless checks of the exported station scene snapshots (G-1).
## Usage: --script res://tests/run_scene_tests.gd -- <scenesDir> <stationId> [<stationId> ...]
## <scenesDir>/<stationId>/{scene.glb,scene.json} come from packages/godot/src/export-scene.ts.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Assets = preload("res://addons/gteki/gteki_assets.gd")
const Lightmap = preload("res://addons/gteki/gteki_lightmap.gd")
const AoAtlas = preload("res://addons/gteki/gteki_ao_atlas.gd")
const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const EPSILON := 0.001
const AABB_TOLERANCE := 0.01

var checks := 0
var failures: Array[String] = []


func _initialize() -> void:
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		printerr("FAIL: ", message)


func vector(values: Array) -> Vector3:
	return Vector3(values[0], values[1], values[2])


func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("Usage: -- <scenesDir> <stationId> [<stationId> ...]")
		quit(1)
		return
	check_mapping_constants()
	check_hide_rules()
	check_hide_edge_cases()
	check_ao_atlas()
	for i in range(1, args.size()):
		await check_station(args[0].path_join(args[i]), args[i])
	finish()


## #232: hiding a mesh must not hide the drawn children it carries; only its own surfaces stop painting.
func check_hide_rules() -> void:
	var scene := Scene.new()
	var parent := MeshInstance3D.new()
	parent.name = "parent"
	parent.mesh = BoxMesh.new()
	var child := MeshInstance3D.new()
	child.name = "child"
	child.mesh = BoxMesh.new()
	parent.add_child(child)
	scene._hide_mesh(parent)
	check(parent.visible, "hide: a mesh with drawn children stays visible so the children render")
	check(not Scene.is_drawn(parent), "hide: its own surfaces paint nothing")
	check(Scene.is_drawn(child), "hide: its drawn child is untouched")
	check(child.get_surface_override_material(0) == null, "hide: the child keeps its own material")
	var leaf := MeshInstance3D.new()
	leaf.mesh = BoxMesh.new()
	scene._hide_mesh(leaf)
	check(not leaf.visible, "hide: a mesh without drawn children is hidden as a whole")
	parent.free()
	leaf.free()


## #255: the two ways hiding goes wrong beyond #232.
func check_hide_edge_cases() -> void:
	var scene := Scene.new()
	# A parent with no mesh of its own still carries drawn children; there is nothing of its own to hide.
	var holder := MeshInstance3D.new()
	holder.name = "holder"
	var held := MeshInstance3D.new()
	held.name = "held"
	held.mesh = BoxMesh.new()
	holder.add_child(held)
	scene._hide_mesh(holder)
	check(holder.visible, "hide: a meshless parent stays visible, so its drawn child keeps rendering")
	check(Scene.is_drawn(held), "hide: the meshless parent's drawn child is untouched")
	check(holder.get_surface_override_material(0) == null, "hide: a meshless parent gets no surface override")
	holder.free()
	# A material_override wins over every surface override (Godot 4.7.2 get_active_material), so a mesh that carries
	# an opaque one keeps painting unless the hide replaces it too.
	var painted := MeshInstance3D.new()
	painted.name = "painted"
	painted.mesh = BoxMesh.new()
	var opaque := StandardMaterial3D.new()
	opaque.albedo_color = Color(1.0, 0.0, 0.0, 1.0)
	painted.material_override = opaque
	var painted_child := MeshInstance3D.new()
	painted_child.name = "painted_child"
	painted_child.mesh = BoxMesh.new()
	painted.add_child(painted_child)
	check(Scene.is_drawn(painted), "hide: a mesh is drawn through its material_override before hiding")
	scene._hide_mesh(painted)
	check(not Scene.is_drawn(painted), "hide: an opaque material_override is replaced, so the mesh paints nothing")
	check(painted.material_override is BaseMaterial3D and (painted.material_override as BaseMaterial3D).albedo_color.a <= 0.0, "hide: the material_override left in place is the transparent one")
	check(painted.visible and Scene.is_drawn(painted_child), "hide: the child of a mesh hidden through its override still renders")
	painted.free()


## Lane E #391: a kit AO atlas applies to exactly the flagged surfaces, one Texture2D per kind is shared, unflagged
## surfaces stay untouched, and a sha mismatch fails loudly instead of sampling the wrong atlas.
func check_ao_atlas() -> void:
	var dir := OS.get_temp_dir().path_join("gteki-ao-atlas-test-%d" % Time.get_ticks_usec())
	check(DirAccess.make_dir_recursive_absolute(dir) == OK, "ao: temp dir for the synthetic atlas")
	var uri := "kit/catalog/high/atlas/nosing_ao.png"
	var path := dir.path_join(uri)
	check(DirAccess.make_dir_recursive_absolute(path.get_base_dir()) == OK, "ao: temp atlas folders")
	var image := Image.create(4, 4, false, Image.FORMAT_RGBA8)
	image.fill(Color(1.0, 1.0, 1.0, 1.0))
	image.set_pixel(0, 0, Color(0.5, 0.5, 0.5, 1.0))
	check(image.save_png(path) == OK, "ao: synthetic atlas PNG saves")
	var sha := FileAccess.get_sha256(path)
	check(not sha.is_empty(), "ao: synthetic atlas has a sha256")
	var block := {"nosing": {"uri": uri, "sha256": sha, "channel": 1, "color_space": "", "flip_y": false, "meshes": 2, "surfaces": 3}}

	var root := _ao_root()
	var applier := AoAtlas.new()
	check(applier.apply(root, block, "", dir), "ao: the synthetic atlas applies: %s" % str(applier.issues))
	check(applier.issues.is_empty(), "ao: no issues for the matching atlas")
	check(applier.meshes == 2 and applier.surfaces == 3, "ao: applied mesh/surface counts (got %d/%d)" % [applier.meshes, applier.surfaces])
	check(applier.textures.size() == 1, "ao: one Texture2D per kind")
	var texture: Variant = applier.textures.get("nosing", null)
	check(texture is Texture2D, "ao: the nosing atlas is a Texture2D")
	var first: MeshInstance3D = root.get_node("first")
	var second: MeshInstance3D = root.get_node("second")
	var untouched: MeshInstance3D = root.get_node("untouched")
	_check_ao_surface(first, 0, texture)
	_check_ao_surface(first, 1, texture)
	_check_ao_surface(second, 0, texture)
	check(untouched.get_surface_override_material(0) == null, "ao: an unflagged surface gets no override")
	var untouched_source := untouched.mesh.surface_get_material(0) as BaseMaterial3D
	check(untouched_source != null and not untouched_source.ao_enabled, "ao: an unflagged surface keeps its material")
	check((texture as Texture2D).get_image().has_mipmaps(), "ao: the atlas texture is mipmapped")
	root.free()

	# Surfaces that shared one snapshot material share one AO copy (the web's one material per kind, so it can batch).
	var shared_root := _ao_root()
	var shared_first: MeshInstance3D = shared_root.get_node("first")
	var shared_second: MeshInstance3D = shared_root.get_node("second")
	shared_second.mesh.surface_set_material(0, shared_first.mesh.surface_get_material(0))
	var sharing := AoAtlas.new()
	check(sharing.apply(shared_root, block, "", dir), "ao: the shared-material case applies: %s" % str(sharing.issues))
	check(shared_first.get_surface_override_material(0) == shared_second.get_surface_override_material(0), "ao: one shared snapshot material gets one shared AO copy")
	check(shared_first.get_surface_override_material(0) != shared_first.get_surface_override_material(1), "ao: distinct snapshot materials keep distinct AO copies")
	shared_root.free()

	# A sha mismatch is an issue and applies nothing, rather than sampling the wrong atlas.
	var mismatched_root := _ao_root()
	var mismatched := block.duplicate(true)
	mismatched["nosing"]["sha256"] = "0000000000000000000000000000000000000000000000000000000000000000"
	var wrong := AoAtlas.new()
	check(not wrong.apply(mismatched_root, mismatched, "", dir), "ao: a sha mismatch fails")
	check(wrong.issues.size() == 1 and str(wrong.issues[0]).contains("sha256"), "ao: the sha mismatch is reported (got %s)" % str(wrong.issues))
	check(wrong.textures.is_empty() and wrong.meshes == 0 and wrong.surfaces == 0, "ao: a mismatched atlas applies nothing")
	check((mismatched_root.get_node("first") as MeshInstance3D).get_surface_override_material(0) == null, "ao: a mismatched atlas leaves surfaces untouched")
	mismatched_root.free()

	# Malformed extras are reported instead of guessed.
	var malformed_root := _ao_root()
	(malformed_root.get_node("second") as MeshInstance3D).set_meta("extras", {"gteki_ao_atlas_surfaces": ["nosing"]})
	var malformed := AoAtlas.new()
	check(not malformed.apply(malformed_root, block, "", dir), "ao: malformed extras fail")
	check(not malformed.issues.is_empty() and str(malformed.issues[0]).contains("malformed"), "ao: malformed extras are reported (got %s)" % str(malformed.issues))
	malformed_root.free()

	DirAccess.remove_absolute(path)
	DirAccess.remove_absolute(dir)


## Two meshes sharing one kind (three atlas surfaces in total) and an unflagged third mesh. Each surface is a quad
## with UV and UV2, as the glTF importer produces from TEXCOORD_0/TEXCOORD_1.
func _ao_root() -> Node3D:
	var root := Node3D.new()
	var first := _ao_mesh("first", 2)
	first.set_meta("extras", {"gteki_ao_atlas_surfaces": {"0": "nosing", "1": "nosing"}})
	var second := _ao_mesh("second", 1)
	second.set_meta("extras", {"gteki_ao_atlas_surfaces": {"0": "nosing"}})
	var untouched := _ao_mesh("untouched", 1)
	root.add_child(first)
	root.add_child(second)
	root.add_child(untouched)
	return root


func _ao_mesh(node_name: String, surfaces: int) -> MeshInstance3D:
	var mesh := ArrayMesh.new()
	for i in range(surfaces):
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = PackedVector3Array([Vector3(0, 0, 0), Vector3(1, 0, 0), Vector3(1, 1, 0), Vector3(0, 1, 0)])
		arrays[Mesh.ARRAY_NORMAL] = PackedVector3Array([Vector3(0, 0, 1), Vector3(0, 0, 1), Vector3(0, 0, 1), Vector3(0, 0, 1)])
		arrays[Mesh.ARRAY_TEX_UV] = PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)])
		arrays[Mesh.ARRAY_TEX_UV2] = PackedVector2Array([Vector2(0, 0), Vector2(1, 0), Vector2(1, 1), Vector2(0, 1)])
		arrays[Mesh.ARRAY_INDEX] = PackedInt32Array([0, 1, 2, 0, 2, 3])
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		var material := StandardMaterial3D.new()
		material.resource_name = "%s_%d" % [node_name, i]
		mesh.surface_set_material(i, material)
	var instance := MeshInstance3D.new()
	instance.name = node_name
	instance.mesh = mesh
	return instance


func _check_ao_surface(mesh: MeshInstance3D, index: int, texture: Variant) -> void:
	var material: Material = mesh.get_surface_override_material(index)
	check(material is BaseMaterial3D, "ao: surface %s/%d gets an override material" % [mesh.name, index])
	if not material is BaseMaterial3D:
		return
	var base: BaseMaterial3D = material
	check(base.ao_enabled, "ao: surface %s/%d has ao_enabled" % [mesh.name, index])
	check(texture is Texture2D and base.ao_texture == texture, "ao: surface %s/%d shares the kind's one texture" % [mesh.name, index])
	check(base.ao_on_uv2, "ao: surface %s/%d samples UV2" % [mesh.name, index])
	check(base.ao_texture_channel == BaseMaterial3D.TEXTURE_CHANNEL_RED, "ao: surface %s/%d samples the R channel" % [mesh.name, index])
	check(is_zero_approx(base.ao_light_affect), "ao: surface %s/%d keeps ao_light_affect at its default" % [mesh.name, index])
	# The override is a duplicate; the snapshot material it came from stays untouched.
	check(base != mesh.mesh.surface_get_material(index), "ao: surface %s/%d override is a duplicate" % [mesh.name, index])
	var source := mesh.mesh.surface_get_material(index) as BaseMaterial3D
	check(source != null and not source.ao_enabled and source.ao_texture == null, "ao: the snapshot material of %s/%d is untouched" % [mesh.name, index])


func check_mapping_constants() -> void:
	# ENU (east, north, up) to Godot (x, z, -y): north is -Z, up is +Y.
	check(Scene.enu_to_godot(1, 2, 3).is_equal_approx(Vector3(1, 3, -2)), "ENU→Godot mapping (x, z, -y)")


func check_station(dir: String, id: String) -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	var loaded := scene.load_snapshot(dir, holder)
	check(loaded, "%s: snapshot loads: %s" % [id, str(scene.issues)])
	if not loaded:
		holder.queue_free()
		return
	var sidecar := scene.sidecar
	check(sidecar.stationId == id, "%s: sidecar station identity" % id)
	check(sidecar.warnings is Array and not sidecar.warnings.is_empty(), "%s: degradations are listed in warnings" % id)

	# Role counts: the TypeScript tagging (sidecar) and Godot's reading of the GLB must agree.
	var expected: Dictionary = sidecar.counts
	check(scene.counts.meshes == int(expected.meshes), "%s: mesh count %d == sidecar %d" % [id, scene.counts.meshes, int(expected.meshes)])
	for role in ["walkable", "collider", "camera_blocker", "see_through"]:
		check(scene.counts[role] == int(expected[role]), "%s: %s count %d == sidecar %d" % [id, role, scene.counts[role], int(expected[role])])
	check(scene.counts.collision_only == int(expected.collisionOnly), "%s: collision-only proxies %d == sidecar %d" % [id, scene.counts.collision_only, int(expected.collisionOnly)])
	check(scene.counts.hidden == int(expected.hidden), "%s: hidden source meshes %d == sidecar %d" % [id, scene.counts.hidden, int(expected.hidden)])
	_check_hidden_sources(scene, id)
	_check_lightmap(scene, id)
	_check_ao_atlas_station(scene, id)
	check(scene.counts.walkable >= 1, "%s: at least one walkable mesh" % id)
	# Mesh colliders and wall segments are both collision; a station may use only one kind (Shinjuku: walls only).
	var walls: Array = sidecar.walls
	check(scene.counts.collider + scene.wall_shapes >= 1, "%s: at least one collider (mesh or wall)" % id)
	check(scene.wall_shapes + scene.skipped_walls + scene.inverted_walls == walls.size(), "%s: every sidecar wall is a shape or counted (zero-length / inverted band)" % id)
	var expected_inverted := 0
	for wall in walls:
		if float(wall.zMax) <= float(wall.zMin) and Vector2(wall.a.x, wall.a.y).distance_to(Vector2(wall.b.x, wall.b.y)) >= 1e-4:
			expected_inverted += 1
	check(scene.inverted_walls == expected_inverted, "%s: inverted-band walls %d == TypeScript data %d" % [id, scene.inverted_walls, expected_inverted])
	print("%s: meshes=%d walkable=%d collider=%d camera_blocker=%d see_through=%d walls=%d (zero-length %d, inverted band %d: no shape, G-2 applies the band rule) spawns=%d" % [id, scene.counts.meshes, scene.counts.walkable, scene.counts.collider, scene.counts.camera_blocker, scene.counts.see_through, scene.wall_shapes, scene.skipped_walls, scene.inverted_walls, scene.spawn_points.size()])
	_check_camera_blockers(scene, id)

	# Coordinate frames against the TypeScript oracle in the sidecar.
	var reference: Dictionary = sidecar.reference
	check(scene.spawn_points.size() == sidecar.spawnPoints.size() and scene.spawn_points.size() == reference.spawnPointsRenderer.size(), "%s: spawn point count" % id)
	for i in range(scene.spawn_points.size()):
		check(scene.spawn_points[i].position.distance_to(vector(reference.spawnPointsRenderer[i])) < EPSILON, "%s: spawn %d ENU→Godot matches TypeScript enuToRenderer" % [id, i])
	for sample in reference.wallSamplesRenderer:
		_check_wall_sample(scene, id, sample)
	_check_bounds(scene, id, reference.bounds)

	# Physics needs a frame to see bodies added this frame.
	await physics_frame
	await physics_frame
	for spawn in scene.spawn_points:
		var hit := scene.ground_below(spawn.position)
		check(not hit.is_empty(), "%s: walkable ground within 1 m below spawn %s (%s)" % [id, spawn.node_id, spawn.label])
		if not hit.is_empty():
			var drop: float = spawn.position.y - hit.position.y
			check(drop <= 1.0 + EPSILON and drop >= -0.5 - EPSILON, "%s: ground under spawn %s is %.3f m below" % [id, spawn.node_id, drop])
			print("  spawn %s ground %.3f m below" % [spawn.node_id, drop])
	if id == "ikebukuro":
		_check_ikebukuro_helpers(scene)
		await _check_lightmap_off(dir)
	# Negative control: the ground query must not answer when nothing walkable is within reach.
	if not scene.spawn_points.is_empty():
		check(scene.ground_below(scene.spawn_points[0].position + Vector3.UP * 30.0).is_empty(), "%s: ground query is empty 30 m above a spawn" % id)
	holder.queue_free()
	await process_frame


## G-4a: the sidecar records which surfaces carried three's lightMap and the intensity; Godot must apply the same
## baked light to exactly those surfaces, decoding the station's own WebP the way the bake states.
func _check_lightmap(scene: Scene, id: String) -> void:
	var block: Dictionary = scene.sidecar.get("lightmap", {})
	if block.is_empty():
		check(not scene.lightmap_applied, "%s: no lightmap in the sidecar and none applied" % id)
		check(scene.lightmap_meshes == 0, "%s: no lightmapped meshes" % id)
		return
	check(scene.lightmap_applied, "%s: the recorded lightmap is applied" % id)
	if not scene.lightmap_applied:
		return
	check(scene.lightmap_meshes == int(block.meshes), "%s: lightmapped meshes %d == sidecar %d" % [id, scene.lightmap_meshes, int(block.meshes)])
	check(scene.lightmap_surfaces == int(block.surfaces), "%s: lightmapped surfaces %d == sidecar %d" % [id, scene.lightmap_surfaces, int(block.surfaces)])
	# Every flagged surface must carry the shader material and keep TEXCOORD_1 as UV2.
	var flagged := 0
	var stack: Array[Node] = [scene.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D:
			continue
		var mesh: MeshInstance3D = node
		var extras := _extras(mesh)
		if not extras.has("gteki_lightmap_surfaces"):
			continue
		flagged += 1
		for surface in extras["gteki_lightmap_surfaces"]:
			var index := int(surface)
			check(index >= 0 and index < mesh.mesh.get_surface_count(), "%s: lightmapped surface %s/%d exists" % [id, mesh.name, index])
			if index < 0 or index >= mesh.mesh.get_surface_count():
				continue
			var material: Material = mesh.get_surface_override_material(index)
			check(material is ShaderMaterial, "%s: lightmapped surface %s/%d has the lightmap shader" % [id, mesh.name, index])
			if material is ShaderMaterial:
				check(material.get_shader_parameter("light_map") is Texture2D, "%s: lightmapped surface %s/%d carries the texture" % [id, mesh.name, index])
				# The importer stores albedo_color in sRGB; the uniform must be declared source_color (sRGB -> linear)
				# or the albedo and the EMISSION it scales would be too bright.
				check(str(material.shader.code).contains("albedo_color : source_color"), "%s: lightmapped surface %s/%d declares albedo_color as source_color" % [id, mesh.name, index])
				var source: Variant = material.get_meta("gteki_source_material", null)
				check(source is BaseMaterial3D, "%s: lightmapped surface %s/%d keeps its source material" % [id, mesh.name, index])
				if source is BaseMaterial3D:
					var uniform: Variant = material.get_shader_parameter("albedo_color")
					check(uniform is Color and uniform == source.albedo_color, "%s: lightmapped surface %s/%d albedo uniform == source albedo_color" % [id, mesh.name, index])
			check((mesh.mesh.surface_get_format(index) & Mesh.ARRAY_FORMAT_TEX_UV2) != 0, "%s: lightmapped surface %s/%d keeps UV2" % [id, mesh.name, index])
	check(flagged == scene.lightmap_meshes, "%s: lightmap flags found by traversal %d == applied %d" % [id, flagged, scene.lightmap_meshes])
	if id != "ikebukuro":
		return
	# The expected size is the station's own bake metadata, not a constant of this test.
	var meta := _read_json(_station_dir(id).path_join("gteki/assets/ikebukuro_b1_lit.meta.json"))
	var expected_size := int(meta.get("lightmap_size", 0))
	check(expected_size > 0, "ikebukuro: bake metadata declares lightmap_size")
	check(scene.lightmap_texture_size == Vector2i(expected_size, expected_size), "ikebukuro: lightmap texture is %s, metadata says %d" % [str(scene.lightmap_texture_size), expected_size])
	var encoding: Dictionary = meta.get("encoding", {})
	var scale := float(encoding.get("scale", 0.0))
	var intensity := float(block.get("light_map_intensity", 0.0))
	check(scale > 0.0 and intensity > 0.0, "ikebukuro: bake scale and recorded lightMapIntensity are positive")
	if scale <= 0.0 or intensity <= 0.0:
		return
	# buildScene sets intensity = scale * PI * LIGHTMAP_GAIN (0.09 in scene.ts).
	var gain := intensity / (scale * PI)
	check(absf(gain - 0.09) < 1e-9, "ikebukuro: lightMapIntensity / (scale*PI) == LIGHTMAP_GAIN 0.09, got %.12f" % gain)
	# Spot check: raw texels decoded by GDScript match (byte/255)^2.2 * scale * gain within 1e-3.
	var image: Image = Image.load_from_file(scene.lightmap_texture_path)
	var decoded := image != null and not image.is_empty()
	check(decoded, "ikebukuro: the lightmap file decodes")
	if not decoded:
		return
	var width := image.get_width()
	var height := image.get_height()
	var worst := 0.0
	var sampled := 0
	for k in range(12):
		var x := (width * (k * 977 + 13)) / 997 % width
		var y := (height * (k * 1597 + 29)) / 1009 % height
		var texel := image.get_pixel(x, y)
		for channel in [texel.r, texel.g, texel.b]:
			var raw := float(channel)
			var expected := pow(raw, 2.2) * scale * 0.09
			worst = maxf(worst, absf(Lightmap.decode_texel(raw, intensity) - expected))
			sampled += 1
	check(sampled == 36, "ikebukuro: spot check sampled 36 channels")
	check(worst <= 1e-3, "ikebukuro: 36 texel channels decode within 1e-3 of (byte/255)^2.2*scale*gain (worst %.9f)" % worst)


## --lightmap=off must really turn the bake off (same snapshot, no shader materials, no texture decode).
func _check_lightmap_off(dir: String) -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	var loaded := scene.load_snapshot(dir, holder, {"lightmap": false})
	check(loaded, "ikebukuro: snapshot loads with the lightmap flag off")
	check(not scene.lightmap.get("uri", "").is_empty(), "ikebukuro: the sidecar still records the lightmap when it is off")
	check(not scene.lightmap_applied and scene.lightmap_meshes == 0, "ikebukuro: --lightmap=off applies no lightmap")
	holder.queue_free()
	await process_frame


## Lane E #391: today no station ships a kit AO atlas, so its sidecar has no block and nothing may be applied.
func _check_ao_atlas_station(scene: Scene, id: String) -> void:
	var block: Variant = scene.sidecar.get("ao_atlas_bindings", {})
	if block is Dictionary and block.is_empty():
		check(not scene.ao_atlas_applied and scene.ao_atlas_meshes == 0 and scene.ao_atlas_surfaces == 0, "%s: no AO atlas block and none applied" % id)
		return
	check(block is Dictionary and scene.ao_atlas_applied, "%s: the recorded AO atlases are applied" % id)


func _station_dir(id: String) -> String:
	return Bridge.find_repo_root().path_join("stations").path_join(id)


func _read_json(path: String) -> Dictionary:
	var text := FileAccess.get_file_as_string(path)
	var parsed: Variant = JSON.parse_string(text)
	return parsed if parsed is Dictionary else {}


func _extras(node: Node) -> Dictionary:
	var extras: Variant = node.get_meta("extras", {})
	return extras if extras is Dictionary else {}


## No mesh the source scene kept invisible may be drawn: flagged meshes are hidden (or leave no render layer).
func _check_hidden_sources(scene: Scene, id: String) -> void:
	var flagged := 0
	var drawn: Array[String] = []
	var stack: Array[Node] = [scene.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if node is MeshInstance3D and _extras(node).get(Scene.HIDDEN, false) == true:
			flagged += 1
			if Scene.is_drawn(node):
				drawn.append(str(node.name))
	check(drawn.is_empty(), "%s: no visible mesh whose source was invisible (%s)" % [id, str(drawn.slice(0, 5))])
	check(flagged == scene.counts.hidden, "%s: flagged hidden meshes found by traversal" % id)


## Ikebukuro's invisible helpers (scene.ts assembleCollision / fences.ts): the walk-bridge walkables are exported as
## tiles (role walkable, gteki_source_role walk_bridges) and the fence collider is collided through the collider tiles;
## the hidden originals stay in the file, hidden. Needs the physics frames to have run.
func _check_ikebukuro_helpers(scene: Scene) -> void:
	var bridge_tiles := 0
	var originals := {}
	var fence_original: MeshInstance3D = null
	var stack: Array[Node] = [scene.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D:
			continue
		var extras := _extras(node)
		if extras.get("gteki_source_role", "") == "walk_bridges" and node.has_meta("gteki_walkable"):
			bridge_tiles += 1
		var role := str(extras.get("gteki_role", ""))
		if role in ["walk_bridges", "access_fences_collider", "doors_solid", "windows_solid", "portal_beyond"]:
			originals[role] = node
			if role == "access_fences_collider":
				fence_original = node
	check(bridge_tiles >= 1, "ikebukuro: walk bridges are walkable tiles (role walkable, source walk_bridges): %d" % bridge_tiles)
	for role in ["walk_bridges", "access_fences_collider", "doors_solid", "windows_solid", "portal_beyond"]:
		check(originals.has(role), "ikebukuro: hidden helper %s is in the snapshot" % role)
		# portal_beyond is drawn on the web too (an opaque "beyond" surface); only the others are invisible helpers.
		if originals.has(role) and role != "portal_beyond":
			var helper: MeshInstance3D = originals[role]
			check(not Scene.is_drawn(helper), "ikebukuro: helper %s is not drawn" % role)
	if fence_original == null or fence_original.mesh == null:
		return
	# The fence collider's panels must stop rays on the collider layer, i.e. exist as collider tiles. First triangle of
	# each of the first panels (a quad is 6 vertices): a ray 0.4 m either side of its centre must hit within the plane.
	var faces := fence_original.mesh.get_faces()
	var space := scene.root.get_world_3d().direct_space_state
	var panels := mini(10, faces.size() / 6)
	check(panels > 0, "ikebukuro: the fence collider has panels")
	var hit_panels := 0
	for k in range(panels):
		var a: Vector3 = fence_original.global_transform * faces[k * 6]
		var b: Vector3 = fence_original.global_transform * faces[k * 6 + 1]
		var c: Vector3 = fence_original.global_transform * faces[k * 6 + 2]
		var centre := (a + b + c) / 3.0
		var normal := (b - a).cross(c - a).normalized()
		# Tiles are single-sided unless their material is double-sided: try from both sides of the panel.
		for side in [1.0, -1.0]:
			var start: Vector3 = centre + normal * 0.4 * side
			var query := PhysicsRayQueryParameters3D.create(start, centre - normal * 0.4 * side, Scene.COLLIDER_LAYER)
			query.hit_back_faces = true
			var hit := space.intersect_ray(query)
			if not hit.is_empty() and abs(hit.position.distance_to(start) - 0.4) < 0.02:
				hit_panels += 1
				break
	check(hit_panels == panels, "ikebukuro: fence collider panels exist as collider tiles (%d of %d)" % [hit_panels, panels])


func _check_camera_blockers(scene: Scene, id: String) -> void:
	var blockers := 0
	var stack: Array[Node] = [scene.root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if node is MeshInstance3D and node.has_meta("gteki_camera_blocker"):
			blockers += 1
			check(not node.visible or node.layers == 0, "%s: camera blocker is not drawn" % id)
			for body in node.get_children():
				if body is StaticBody3D:
					check(body.collision_layer == Assets.CAMERA_LAYER, "%s: camera blocker is on the camera layer only" % id)
	check(blockers == scene.counts.camera_blocker, "%s: camera blockers found by traversal" % id)


func _check_wall_sample(scene: Scene, id: String, sample: Dictionary) -> void:
	var index := int(sample.index)
	if not scene.wall_owner_by_index.has(index):
		# A zero-length or zero-height segment is skipped by the loader; the sample must then be degenerate.
		var wall: Dictionary = scene.sidecar.walls[index]
		check(Vector2(wall.a.x, wall.a.y).distance_to(Vector2(wall.b.x, wall.b.y)) < 1e-4 or wall.zMax <= wall.zMin, "%s: wall %d has no shape only if zero-length or inverted" % [id, index])
		return
	var owner_id: int = scene.wall_owner_by_index[index]
	var transform := scene.walls_body.shape_owner_get_transform(owner_id)
	var a := vector(sample.a)
	var b := vector(sample.b)
	var wall_data: Dictionary = scene.sidecar.walls[index]
	var mid := (a + b) * 0.5
	mid.y = (float(wall_data.zMin) + float(wall_data.zMax)) * 0.5
	check(transform.origin.distance_to(mid) < EPSILON, "%s: wall %d centre matches TypeScript renderer frame" % [id, index])
	var along := Vector3(b.x - a.x, 0, b.z - a.z).normalized()
	check(transform.basis.x.distance_to(along) < EPSILON, "%s: wall %d direction matches TypeScript renderer frame" % [id, index])
	var shape: BoxShape3D = scene.walls_body.shape_owner_get_shape(owner_id, 0)
	check(abs(shape.size.x - Vector2(a.x, a.z).distance_to(Vector2(b.x, b.z))) < EPSILON, "%s: wall %d length" % [id, index])
	check(abs(shape.size.y - (float(wall_data.zMax) - float(wall_data.zMin))) < EPSILON, "%s: wall %d extruded zMin..zMax" % [id, index])


func _check_bounds(scene: Scene, id: String, bounds: Dictionary) -> void:
	# World AABB of the loaded meshes per behaviour against the same union computed in three.js: this catches
	# any axis, handedness or unit change between the TypeScript scene and the glTF import.
	for behaviour in ["walkable", "collider"]:
		var meta: String = "gteki_" + behaviour
		var union := AABB()
		var any := false
		var stack: Array[Node] = [scene.root]
		while not stack.is_empty():
			var node: Node = stack.pop_back()
			stack.append_array(node.get_children())
			if node is MeshInstance3D and node.has_meta(meta) and node.mesh != null:
				var box: AABB = node.global_transform * node.get_aabb()
				union = box if not any else union.merge(box)
				any = true
		var expected: Variant = bounds.get(behaviour)
		if expected == null:
			check(not any, "%s: no %s meshes, as in the sidecar" % [id, behaviour])
			continue
		check(any, "%s: %s meshes present for bounds" % [id, behaviour])
		if not any:
			continue
		var lo := vector(expected.min)
		var hi := vector(expected.max)
		check(union.position.distance_to(lo) < AABB_TOLERANCE and union.end.distance_to(hi) < AABB_TOLERANCE, "%s: %s AABB %s..%s matches TypeScript %s..%s" % [id, behaviour, union.position, union.end, lo, hi])


func finish() -> void:
	if failures.is_empty():
		print("PASS: GTEki Godot scene snapshots (%d checks)" % checks)
		quit(0)
	else:
		printerr("FAIL: GTEki Godot scene snapshots (%d failures / %d checks)" % [failures.size(), checks])
		quit(1)
