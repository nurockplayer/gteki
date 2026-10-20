extends RefCounted
## Runtime glTF loading; geometry roles are display/physics hints, never routing evidence.

const Station = preload("res://addons/gteki/gteki_station.gd")
const WALKABLE = ["floor", "stairs_ramps"]
const COLLIDER = ["wall", "barriers"]

var issues: Array[String] = []
var counts: Dictionary = {"assets": 0, "walkable": 0, "collider": 0}


func load_assets(manifest: Dictionary, gteki_dir: String, station_root: Node3D) -> bool:
	issues.clear()
	counts = {"assets": 0, "walkable": 0, "collider": 0}
	for asset in manifest.get("assets", []):
		if not asset is Dictionary or asset.get("format") != "glb" or not asset.get("uri") is String:
			issues.append("Expected a manifest GLB asset")
			continue
		var uri: String = asset.uri
		# Contract URIs stay inside the station's gteki directory.
		if uri.is_empty() or uri.is_absolute_path() or ":" in uri or "\\" in uri or ".." in uri.split("/") or not uri.to_lower().ends_with(".glb"):
			issues.append("Invalid asset URI: %s" % uri)
			continue
		var matrix: Variant = asset.get("transform")
		if matrix != null and not _valid_matrix(matrix):
			issues.append("Asset transform must be a finite affine column-major 4x4: %s" % uri)
			continue
		load_glb(gteki_dir.path_join(uri), station_root, asset.get("id", "asset"), matrix)
	print("GLB assets=%d walkable=%d collider=%d" % [counts.assets, counts.walkable, counts.collider])
	return issues.is_empty()


func load_glb(path: String, station_root: Node3D, asset_id: String = "asset", matrix: Variant = null) -> Node3D:
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
	counts.assets += 1
	return asset_root


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


func _tag_roles(node: Node) -> void:
	var role := str(node.get_meta("gteki_role", "")).to_lower()
	# Godot imports glTF extras as metadata, including nested extras from other exporters.
	var extras: Variant = node.get_meta("extras", {})
	if role.is_empty() and extras is Dictionary:
		role = str(extras.get("gteki_role", "")).to_lower()
	if role.is_empty():
		role = str(node.name).to_lower()
	if role in WALKABLE:
		node.set_meta("gteki_walkable", true)
		counts.walkable += 1
	elif role in COLLIDER:
		node.set_meta("gteki_collider", true)
		counts.collider += 1
		if node is MeshInstance3D and node.mesh != null:
			node.create_trimesh_collision()
	# Collision creation adds children; inspect the resulting list once.
	for child in node.get_children():
		_tag_roles(child)
