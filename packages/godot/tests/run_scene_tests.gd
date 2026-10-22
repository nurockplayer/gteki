extends SceneTree
## Headless checks of the exported station scene snapshots (G-1).
## Usage: --script res://tests/run_scene_tests.gd -- <scenesDir> <stationId> [<stationId> ...]
## <scenesDir>/<stationId>/{scene.glb,scene.json} come from packages/godot/src/export-scene.ts.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Assets = preload("res://addons/gteki/gteki_assets.gd")
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
	for i in range(1, args.size()):
		await check_station(args[0].path_join(args[i]), args[i])
	finish()


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
	# Negative control: the ground query must not answer when nothing walkable is within reach.
	if not scene.spawn_points.is_empty():
		check(scene.ground_below(scene.spawn_points[0].position + Vector3.UP * 30.0).is_empty(), "%s: ground query is empty 30 m above a spawn" % id)
	holder.queue_free()
	await process_frame


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
