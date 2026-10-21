extends RefCounted
## Runtime glTF loading; geometry roles are display/physics hints, never routing evidence.

const Station = preload("res://addons/gteki/gteki_station.gd")
# Same role vocabulary as @gteki/scene-api (WALKABLE_ROLES / COLLIDER_ROLES / CAMERA_ROLES / SEE_THROUGH_ROLES).
const WALKABLE = ["floor", "stairs_ramps", "walkable", "ramp", "stairs"]
const COLLIDER = ["wall", "walls", "barriers", "barrier", "transport", "collider"]
## Camera-only (ceilings, slab undersides): hidden, and they collide on CAMERA_LAYER only, so a camera arm
## (e.g. SpringArm3D with this mask) stops at them while walking bodies on layer 1 pass through.
const CAMERA = ["camera_blocker"]
const CAMERA_LAYER := 1 << 1
## Visual-only signage a follow camera may see through; tagged gteki_see_through, never collides.
const SEE_THROUGH = ["sign", "signs", "signage"]

var issues: Array[String] = []
var counts: Dictionary = {"assets": 0, "walkable": 0, "collider": 0, "camera_blocker": 0}


func load_assets(manifest: Dictionary, gteki_dir: String, station_root: Node3D) -> bool:
	issues.clear()
	counts = {"assets": 0, "walkable": 0, "collider": 0, "camera_blocker": 0}
	for asset in manifest.get("assets", []):
		if not asset is Dictionary or asset.get("format") != "glb" or not asset.get("uri") is String:
			issues.append("Expected a manifest GLB asset")
			continue
		var uri: String = asset.uri
		# Contract URIs stay inside the station's gteki directory.
		if uri.is_empty() or uri.is_absolute_path() or ":" in uri or "\\" in uri or "?" in uri or "#" in uri or ".." in uri.split("/") or not uri.to_lower().ends_with(".glb"):
			issues.append("Invalid asset URI: %s" % uri)
			continue
		var matrix: Variant = asset.get("transform")
		if matrix != null and not _valid_matrix(matrix):
			issues.append("Asset transform must be a finite affine column-major 4x4: %s" % uri)
			continue
		var resolved := resolve_in_station(gteki_dir, uri)
		if resolved.is_empty():
			issues.append("Asset resolves outside the station folder (symlink): %s" % uri)
			continue
		if not glb_is_self_contained(resolved):
			issues.append("GLB references external buffers/images; only self-contained GLBs load: %s" % uri)
			continue
		load_glb(resolved, station_root, asset.get("id", "asset"), matrix, str(asset.get("role", "visual")))
	print("GLB assets=%d walkable=%d collider=%d camera_blocker=%d" % [counts.assets, counts.walkable, counts.collider, counts.camera_blocker])
	return issues.is_empty()


func load_glb(path: String, station_root: Node3D, asset_id: String = "asset", matrix: Variant = null, asset_role: String = "visual") -> Node3D:
	if matrix != null and not _valid_matrix(matrix):
		issues.append("Invalid GLB transform: %s" % path)
		return null
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var error := document.append_from_file(path, state)
	if error != OK:
		issues.append("Cannot load GLB %s: %s" % [path, error_string(error)])
		return null
	var scene := document.generate_scene(state)
	if scene == null:
		issues.append("Cannot generate GLB scene: %s" % path)
		return null
	var asset_root := Node3D.new()
	asset_root.name = asset_id
	asset_root.transform = matrix_to_transform(matrix)
	asset_root.add_child(scene)
	station_root.add_child(asset_root)
	_tag_roles(scene)
	if asset_role != "visual":
		_apply_asset_role(scene, asset_role)
	counts.assets += 1
	return asset_root


## The manifest role is asset-wide (as in the web explorer): in a collision asset every mesh without its
## own walkable/collider role still collides, and a collision-only asset is not drawn.
func _apply_asset_role(node: Node, asset_role: String) -> void:
	if node is MeshInstance3D:
		# Inherited roles are already tagged on the mesh itself by _tag_roles.
		if not node.has_meta("gteki_walkable") and not node.has_meta("gteki_collider") and not node.has_meta("gteki_camera_blocker"):
			node.set_meta("gteki_collider", true)
			# A collider is never see-through (as on the web).
			node.remove_meta("gteki_see_through")
			counts.collider += 1
			if node.mesh != null:
				node.create_trimesh_collision()
		if asset_role == "collision":
			node.visible = false
	for child in node.get_children():
		_apply_asset_role(child, asset_role)


## Resolve `uri` under `gteki_dir` to its canonical path and accept it only if that lies inside the
## canonical station folder (the parent of gteki/), like the web explorer's fence. Returns "" otherwise.
static func resolve_in_station(gteki_dir: String, uri: String) -> String:
	var raw := ProjectSettings.globalize_path(gteki_dir).simplify_path()
	# The fence is the canonical *station* folder, derived independently of where gteki/ points:
	# if <alpha>/gteki is a link into <beta>, beta's files must not pass as alpha's.
	var fence := canonical_path(raw.get_base_dir())
	if fence.is_empty():
		return ""
	var target := canonical_path(raw.path_join(uri))
	if target.is_empty() or not target.begins_with(fence + "/"):
		return ""
	return target


## realpath(3)-style: resolve every component (including chained and nested links) of an absolute
## path. Returns "" on a missing component, a non-absolute path or more than 40 link hops.
static func canonical_path(path: String) -> String:
	if not path.is_absolute_path():
		return ""
	var simple := path.simplify_path()
	# Keep the filesystem root ("/" or a Windows drive such as "C:/") out of the component walk.
	var root := "/"
	if simple.length() >= 2 and simple[1] == ":":
		root = simple.substr(0, 2) + "/"
		simple = simple.substr(2)
	var pending := Array(simple.split("/", false))
	var resolved := root
	var hops := 0
	while not pending.is_empty():
		var part: String = pending.pop_front()
		if part == "." or part.is_empty():
			continue
		if part == "..":
			resolved = resolved.get_base_dir() if resolved != root else root
			continue
		var dir := DirAccess.open(resolved)
		if dir == null:
			return ""
		if dir.is_link(part):
			hops += 1
			if hops > 40:
				return ""
			var link := dir.read_link(part)
			if link.is_absolute_path():
				# An absolute target restarts from its own root (drive-aware).
				root = link.substr(0, 2) + "/" if link.length() >= 2 and link[1] == ":" else "/"
				resolved = root
				if root != "/":
					link = link.substr(2)
			var rest := Array(link.split("/", false))
			rest.append_array(pending)
			pending = rest
			continue
		var next := resolved.path_join(part)
		if not dir.dir_exists(part) and not dir.file_exists(part):
			return ""
		resolved = next
	return resolved


## True when the GLB's JSON chunk declares no external (non-data:) buffer or image URIs, so loading
## it cannot read files outside the fenced asset path.
static func glb_is_self_contained(path: String) -> bool:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null or file.get_length() < 20:
		return false
	if file.get_32() != 0x46546C67:  # "glTF"
		return false
	file.get_32()  # version
	file.get_32()  # total length
	var json_length := file.get_32()
	if file.get_32() != 0x4E4F534A:  # "JSON"
		return false
	var doc: Variant = JSON.parse_string(file.get_buffer(json_length).get_string_from_utf8())
	if not doc is Dictionary:
		return false
	for key in ["buffers", "images"]:
		for entry in doc.get(key, []):
			if entry is Dictionary and entry.has("uri") and not str(entry.uri).begins_with("data:"):
				return false
	return true


static func _valid_matrix(matrix: Variant) -> bool:
	return matrix is Array and matrix.size() == 16 and matrix.all(Station.is_number) and matrix[3] == 0 and matrix[7] == 0 and matrix[11] == 0 and matrix[15] == 1


static func matrix_to_transform(matrix: Variant) -> Transform3D:
	if matrix == null:
		return Transform3D.IDENTITY
	# The four columns are basis X, Y, Z, origin; assets are already in renderer space.
	return Transform3D(
		Basis(Vector3(matrix[0], matrix[1], matrix[2]), Vector3(matrix[4], matrix[5], matrix[6]), Vector3(matrix[8], matrix[9], matrix[10])),
		Vector3(matrix[12], matrix[13], matrix[14])
	)


## A node's own role, as the web's roleOf: gteki_role metadata/extras, else a name that is a role or
## starts with "<role>_" / "<role>.".
static func _own_role(node: Node) -> String:
	var role := str(node.get_meta("gteki_role", "")).strip_edges().to_lower()
	# Godot imports glTF extras as metadata, including nested extras from other exporters.
	var extras: Variant = node.get_meta("extras", {})
	if role.is_empty() and extras is Dictionary:
		role = str(extras.get("gteki_role", "")).strip_edges().to_lower()
	# Trimmed and lowercased; an empty role counts as absent (same normalisation as the web's roleOf).
	if not role.is_empty():
		return role
	var name := str(node.name).to_lower()
	for candidate in WALKABLE + COLLIDER + CAMERA + SEE_THROUGH:
		if name == candidate or name.begins_with(candidate + "_") or name.begins_with(candidate + "."):
			return candidate
	return ""


## Tag meshes by role; children inherit their parent's role (as on the web), so a mesh under a "wall"
## group collides and one under a "floor" group is walkable. Counts are meshes.
func _tag_roles(node: Node, inherited: String = "") -> void:
	var own := _own_role(node)
	var role := own if not own.is_empty() else inherited
	var is_mesh := node is MeshInstance3D
	if role in WALKABLE:
		node.set_meta("gteki_walkable", true)
		if is_mesh:
			counts.walkable += 1
	elif role in COLLIDER:
		node.set_meta("gteki_collider", true)
		if is_mesh:
			counts.collider += 1
			if role == "collider":
				node.visible = false
	elif role in CAMERA:
		node.set_meta("gteki_camera_blocker", true)
		if is_mesh:
			counts.camera_blocker += 1
			node.visible = false
	elif role in SEE_THROUGH and is_mesh:
		node.set_meta("gteki_see_through", true)
	# Snapshot children first: collision creation adds a StaticBody3D child that needs no tagging.
	var children := node.get_children()
	if is_mesh and role in COLLIDER and node.mesh != null:
		node.create_trimesh_collision()
	if is_mesh and role in CAMERA and node.mesh != null:
		node.create_trimesh_collision()
		for body in node.get_children():
			if body is StaticBody3D and not body in children:
				body.collision_layer = CAMERA_LAYER
				body.collision_mask = 0
	for child in children:
		_tag_roles(child, role)
