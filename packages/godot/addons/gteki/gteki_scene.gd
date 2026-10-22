extends RefCounted
## Loads a station scene snapshot written by packages/godot/src/export-scene.ts:
##   <dir>/scene.glb   the station's own buildScene output; roles in node extras `gteki_role`
##   <dir>/scene.json  sidecar (gteki.godot-scene/0.1): walls and spawn points in ENU, environment, counts, warnings
## Godot adds no station truth: it only gives the TypeScript geometry physics. Geometry roles are display/physics
## hints, never routing evidence (see gteki_assets.gd).

const Assets = preload("res://addons/gteki/gteki_assets.gd")
const Station = preload("res://addons/gteki/gteki_station.gd")

const SCHEMA := "gteki.godot-scene/0.1"
## Physics layers. Walking bodies should use mask COLLIDER_LAYER | GROUND_LAYER; a camera arm uses Assets.CAMERA_LAYER.
## Ground has its own layer so "is there walkable ground here" can be asked without walls or ceilings answering.
const COLLIDER_LAYER := 1 << 0
const GROUND_LAYER := 1 << 2
## The wall boxes built from the sidecar `walls`. Kept off the walker's masks: like the web, the walker applies the
## wall band rule analytically (gteki_walker.gd), and the web's camera never stops at walls.
const WALL_LAYER := 1 << 3
## Wall segments are zero-thickness in the web walker; the box only needs to be a solid for a trimesh-free test.
const WALL_THICKNESS := 0.05
## Extras flags set by the exporter: collision proxies the scene never draws, and any source mesh that was not drawn
## (a scene helper such as the access-fence collider, which the scene collides through tiles instead).
const COLLISION_ONLY := "gteki_collision_only"
const HIDDEN := "gteki_hidden"

var issues: Array[String] = []
var sidecar: Dictionary = {}
var root: Node3D
var assets: Assets
## Mesh counts by Godot behaviour, in the same terms as the sidecar's `counts`.
var counts: Dictionary = {}
## Wall segments that became a collision shape.
var wall_shapes := 0
## Zero-length segments (no shape).
var skipped_walls := 0
## Segments with zMax < zMin. The band is in walker-feet space (see WALKER_BODY in @gteki/scene-api: a wall blocks
## when zMin <= feet + bodyTopM and zMax >= feet + bodyBottomM), where a folded bodyMin/bodyMax can invert it and
## the segment still blocks. No box can represent that, so these get NO shape here: the walk (G-2) must apply the
## band rule to `sidecar.walls` itself. Counted so nothing silently under-blocks.
var inverted_walls := 0
var walls_body: StaticBody3D
## Index in the sidecar `walls` array to the walls_body shape owner id, for the segments that became a shape.
var wall_owner_by_index: Dictionary = {}
## [{position: Vector3 (Godot frame), heading_deg, node_id, label}]
var spawn_points: Array[Dictionary] = []
var environment: Dictionary = {}


## ENU (x east, y north, z up) to Godot (x, z, -y), the same mapping as @gteki/geo enuToRenderer.
static func enu_to_godot(x: float, y: float, z: float) -> Vector3:
	return Vector3(x, z, -y)


func load_snapshot(dir: String, parent: Node3D) -> bool:
	issues.clear()
	var errors: Array[String] = []
	sidecar = Station.read_json(dir.path_join("scene.json"), errors)
	issues.append_array(errors)
	if sidecar.is_empty():
		return false
	if sidecar.get("schema") != SCHEMA:
		issues.append("Unsupported scene sidecar schema: %s" % str(sidecar.get("schema")))
		return false
	var glb := dir.path_join("scene.glb")
	if not FileAccess.file_exists(glb):
		issues.append("Missing scene.glb in %s" % dir)
		return false
	root = Node3D.new()
	root.name = str(sidecar.get("stationId", "station"))
	parent.add_child(root)
	assets = Assets.new()
	# The snapshot is a generated, self-contained cache file (no external buffers), so it skips the manifest fence.
	var loaded := assets.load_glb(glb, root, "scene")
	issues.append_array(assets.issues)
	if loaded == null:
		return false
	_finish_meshes(loaded)
	_build_walls()
	_read_spawn_points()
	environment = sidecar.get("environment", {})
	return issues.is_empty()


## Walkable meshes get a ground body (assets only tags them), collision-only proxies stop being drawn.
func _finish_meshes(node: Node) -> void:
	counts = {"meshes": 0, "walkable": 0, "collider": 0, "camera_blocker": 0, "see_through": 0, "collision_only": 0, "hidden": 0}
	_visit(node)


func _visit(node: Node) -> void:
	if node is MeshInstance3D or node is MultiMeshInstance3D:
		counts.meshes += 1
	if node is MeshInstance3D:
		var mesh: MeshInstance3D = node
		var extras: Variant = mesh.get_meta("extras", {})
		if node.has_meta("gteki_walkable"):
			counts.walkable += 1
			_add_ground(mesh)
		if node.has_meta("gteki_collider"):
			counts.collider += 1
			_apply_collider_side(mesh)
		if node.has_meta("gteki_camera_blocker"):
			counts.camera_blocker += 1
		if node.has_meta("gteki_see_through"):
			counts.see_through += 1
		if extras is Dictionary and extras.get(COLLISION_ONLY, false) == true:
			counts.collision_only += 1
			_hide_mesh(mesh)
		if extras is Dictionary and extras.get(HIDDEN, false) == true:
			counts.hidden += 1
			_hide_mesh(mesh)
	for child in node.get_children():
		_visit(child)


## The web ray-tests a collider mesh against its material's `side` (a FrontSide wall can be walked through from
## behind; an array of materials counts as double-sided). Godot's trimesh is single-sided by winding unless asked
## otherwise, so make it double-sided exactly where the exported material is (glTF `doubleSided` = cull disabled).
func _apply_collider_side(mesh: MeshInstance3D) -> void:
	if mesh.mesh == null:
		return
	var double_sided := mesh.mesh.get_surface_count() > 1
	if not double_sided and mesh.mesh.get_surface_count() == 1:
		var material: Variant = mesh.get_active_material(0)
		double_sided = material is BaseMaterial3D and material.cull_mode == BaseMaterial3D.CULL_DISABLED
	for body in mesh.get_children():
		if body is StaticBody3D and body.collision_layer == COLLIDER_LAYER:
			for shape_node in body.get_children():
				if shape_node is CollisionShape3D and shape_node.shape is ConcavePolygonShape3D:
					shape_node.shape.backface_collision = double_sided


## Not drawn. `visible = false` would hide the whole subtree, and a hidden mesh can carry drawn children (they carry
## their own flags): those stay, and this mesh's own surfaces get a fully transparent override material instead
## (#232). Drawing nothing is stronger than `layers = 0`, which only keeps the node out of every camera.
func _hide_mesh(mesh: MeshInstance3D) -> void:
	for child in mesh.get_children():
		if not child is CollisionObject3D:
			_hide_own_surfaces(mesh)
			return
	mesh.visible = false


## A MeshInstance3D has no per-surface visibility flag, so each surface gets an unshaded fully transparent
## material; the node itself (and its children) keeps rendering.
func _hide_own_surfaces(mesh: MeshInstance3D) -> void:
	if mesh.mesh == null:
		mesh.visible = false
		return
	mesh.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var invisible := StandardMaterial3D.new()
	invisible.albedo_color = Color(0.0, 0.0, 0.0, 0.0)
	invisible.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	invisible.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	invisible.cull_mode = BaseMaterial3D.CULL_DISABLED
	for surface in range(mesh.mesh.get_surface_count()):
		mesh.set_surface_override_material(surface, invisible)


## True when this mesh still paints: visible, on a render layer, and at least one surface that is not the
## transparent override `_hide_own_surfaces` installs. The headless tests use it to assert that no flagged mesh draws.
static func is_drawn(mesh: MeshInstance3D) -> bool:
	if not mesh.visible or mesh.layers == 0 or mesh.mesh == null:
		return false
	for surface in range(mesh.mesh.get_surface_count()):
		var material: Material = mesh.get_surface_override_material(surface)
		if material == null:
			material = mesh.get_active_material(surface)
		if material == null or not _is_transparent(material):
			return true
	return false


static func _is_transparent(material: Material) -> bool:
	if material is BaseMaterial3D:
		var base: BaseMaterial3D = material
		return base.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED and base.albedo_color.a <= 0.0
	return false


func _add_ground(mesh: MeshInstance3D) -> void:
	if mesh.mesh == null:
		return
	var before := mesh.get_children()
	mesh.create_trimesh_collision()
	for body in mesh.get_children():
		if body is StaticBody3D and not body in before:
			body.collision_layer = GROUND_LAYER
			body.collision_mask = 0
			# Winding of TypeScript floor meshes varies (the web raycasts them double-sided).
			for shape_node in body.get_children():
				if shape_node is CollisionShape3D and shape_node.shape is ConcavePolygonShape3D:
					shape_node.shape.backface_collision = true


## One thin box per wall segment between zMin and zMax (ENU metres, as returned by the station's buildScene).
func _build_walls() -> void:
	walls_body = StaticBody3D.new()
	walls_body.name = "walls"
	walls_body.collision_layer = WALL_LAYER
	walls_body.collision_mask = 0
	root.add_child(walls_body)
	wall_shapes = 0
	skipped_walls = 0
	inverted_walls = 0
	wall_owner_by_index.clear()
	var wall_list: Array = sidecar.get("walls", [])
	for wall_index in range(wall_list.size()):
		var wall: Dictionary = wall_list[wall_index]
		var a := Vector3(wall.a.x, 0.0, -float(wall.a.y))
		var b := Vector3(wall.b.x, 0.0, -float(wall.b.y))
		var length := a.distance_to(b)
		var height := float(wall.zMax) - float(wall.zMin)
		if length < 1e-4:
			skipped_walls += 1
			continue
		if height <= 0.0:
			inverted_walls += 1
			continue
		var shape := BoxShape3D.new()
		shape.size = Vector3(length, height, WALL_THICKNESS)
		var mid := (a + b) * 0.5
		mid.y = (float(wall.zMin) + float(wall.zMax)) * 0.5
		var direction := b - a
		var owner_id := walls_body.create_shape_owner(walls_body)
		walls_body.shape_owner_add_shape(owner_id, shape)
		walls_body.shape_owner_set_transform(owner_id, Transform3D(Basis(Vector3.UP, atan2(-direction.z, direction.x)), mid))
		wall_owner_by_index[wall_index] = owner_id
		wall_shapes += 1


func _read_spawn_points() -> void:
	spawn_points.clear()
	for spawn in sidecar.get("spawnPoints", []):
		spawn_points.append({
			"position": enu_to_godot(spawn.x, spawn.y, spawn.z),
			"heading_deg": float(spawn.get("headingDeg", 0.0)),
			"node_id": str(spawn.get("nodeId", "")),
			"label": str(spawn.get("label", "")),
		})


## Nearest walkable ground at or below `from_position + up_tolerance` and no further than `max_drop` under
## `from_position`. Needs the snapshot in the tree and one physics frame since it was added.
## Returns {} when there is none, else {position, collider}.
func ground_below(from_position: Vector3, max_drop: float = 1.0, up_tolerance: float = 0.5) -> Dictionary:
	var space := root.get_world_3d().direct_space_state
	var query := PhysicsRayQueryParameters3D.create(from_position + Vector3.UP * up_tolerance, from_position + Vector3.DOWN * max_drop)
	query.collision_mask = GROUND_LAYER
	query.hit_back_faces = true
	var hit := space.intersect_ray(query)
	return hit
