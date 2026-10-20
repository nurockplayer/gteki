extends SceneTree

const Station = preload("res://addons/gteki/gteki_station.gd")
const Route = preload("res://addons/gteki/gteki_route.gd")
const Assets = preload("res://addons/gteki/gteki_assets.gd")
const EPSILON = 0.001

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
	if args.size() < 3 or args.size() > 4:
		printerr("Usage: -- <stationDir> <route.json> <reference.json> [optional.glb]")
		quit(1)
		return
	var station := Station.new()
	check(station.load_station(args[0]), "station JSON loads: %s" % str(station.issues))
	var reference := Station.read_json(args[2], failures)
	if station.manifest.is_empty() or reference.is_empty():
		finish()
		return
	check(station.manifest.station.id == reference.stationId, "reference station identity")
	check(station.nodes.size() == int(reference.nodeCount), "node count")
	check(station.floors.size() == int(reference.floorCount), "floor count")
	check(station.pois.size() == int(reference.poiCount), "POI count")
	check(reference.nodes.size() == station.nodes.size(), "every node has a TypeScript coordinate reference")
	for expected in reference.nodes:
		check(station.nodes_by_id.has(expected.nodeId), "reference node exists: %s" % expected.nodeId)
		if not station.nodes_by_id.has(expected.nodeId):
			continue
		var node: Dictionary = station.nodes_by_id[expected.nodeId]
		check(station.node_to_godot(node).distance_to(vector(expected.renderer)) < EPSILON, "TS ENU mapping: %s" % node.id)
		check(station.symbolic_heights[node.id] == expected.heightSymbolic, "height provenance: %s" % node.id)
	for sample in reference.heightCases:
		check(station.enu_to_godot(sample.enu).distance_to(vector(sample.renderer)) < EPSILON, "height fallback matches TypeScript")
		check((sample.enu.z == null) == sample.heightSymbolic, "unknown height remains symbolic")
	var matrix_transform := Assets.matrix_to_transform(reference.enuToRendererMatrix)
	check((matrix_transform * Vector3(2, 3, 7)).distance_to(Vector3(2, 7, -3)) < EPSILON, "TS ENU_TO_RENDERER_MATRIX column order")

	var route := Route.new()
	check(route.load_route(args[1], station.manifest.station.id), "router JSON loads: %s" % str(route.issues))
	if not route.document.is_empty():
		check(route.document.result.nodeIds == ["start", "a", "goal"], "fixture uses the TypeScript start→goal route")
		var path := route.build_path()
		root.add_child(path)
		check(path.curve.point_count == route.document.path.size(), "route curve point count")
		var known_heights := true
		for i in range(route.document.path.size()):
			var point: Dictionary = route.document.path[i]
			check(station.nodes_by_id.has(point.nodeId), "route node exists: %s" % point.nodeId)
			if not station.nodes_by_id.has(point.nodeId):
				continue
			var node: Dictionary = station.nodes_by_id[point.nodeId]
			check(point.enu == node.position, "route preserves ENU/null: %s" % node.id)
			check(station.node_to_godot(node).distance_to(vector(point.renderer)) < EPSILON, "route renderer matches Godot: %s" % node.id)
			check(path.curve.get_point_position(i).distance_to(vector(point.renderer)) < EPSILON, "curve uses router point: %s" % node.id)
			check(point.heightSymbolic == station.symbolic_heights[node.id], "route symbolic flag: %s" % node.id)
			known_heights = known_heights and node.position.z != null
		if known_heights:
			check(abs(route.total_length() - float(route.document.result.totalLengthM)) < EPSILON, "polyline length equals TypeScript totalLengthM")
			check(abs(path.curve.get_baked_length() - float(route.document.result.totalLengthM)) < EPSILON, "Curve3D length equals TypeScript totalLengthM")
		else:
			print("SKIP metric route length: symbolic display heights")
		print("Route points=%d length=%.3f m" % [route.points.size(), route.total_length()])
		path.free()

	var station_root := Node3D.new()
	station_root.name = "Station"
	root.add_child(station_root)
	var assets := Assets.new()
	check(assets.load_assets(station.manifest, args[0].path_join("gteki"), station_root), "manifest assets load: %s" % str(assets.issues))
	test_generated_glb(station_root)
	if args.size() == 4:
		check(assets.load_glb(args[3], station_root) != null, "optional GLB loads: %s" % str(assets.issues))
		print("Optional GLB counts: %s" % str(assets.counts))
	station_root.free()
	finish()


func test_generated_glb(station_root: Node3D) -> void:
	var source := Node3D.new()
	source.name = "GeneratedFixture"
	# floor/wall test names; metadata_only tests extras independently of names.
	for entry in [["floor", "floor"], ["wall", "wall"], ["metadata_only", "stairs_ramps"], ["barriers", "barriers"]]:
		var mesh := MeshInstance3D.new()
		mesh.name = entry[0]
		mesh.mesh = BoxMesh.new()
		mesh.set_meta("gteki_role", entry[1])
		# GLTFDocument serializes the dedicated extras dictionary, not arbitrary metadata.
		mesh.set_meta("extras", {"gteki_role": entry[1]})
		source.add_child(mesh)
		mesh.owner = source
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var export_error := document.append_from_scene(source, state)
	check(export_error == OK, "Godot builds GLTFState")
	if export_error != OK:
		source.free()
		return
	var filename := "generated-proof-%d.glb" % OS.get_process_id()
	var output := "user://".path_join(filename)
	var write_error := document.write_to_filesystem(state, output)
	check(write_error == OK, "Godot exports test GLB to user://")
	source.free()
	if write_error != OK:
		return
	var assets := Assets.new()
	var matrix := [0, 0, -2, 0, 0, 3, 0, 0, 4, 0, 0, 0, 5, 6, 7, 1]
	var manifest := {"assets": [
		{"id": "transformed", "uri": filename, "format": "glb", "transform": matrix},
		{"id": "identity", "uri": filename, "format": "glb"},
	]}
	check(assets.load_assets(manifest, "user://", station_root), "generated GLBs reimport through manifest: %s" % str(assets.issues))
	check(assets.counts == {"assets": 2, "walkable": 4, "collider": 4}, "GLB names/extras classify all four roles: %s" % str(assets.counts))
	var transformed := station_root.get_node_or_null("transformed") as Node3D
	var identity := station_root.get_node_or_null("identity") as Node3D
	check(transformed != null and identity != null, "assets parented under station root")
	if transformed != null:
		check((transformed.transform * Vector3(1, 2, 3)).distance_to(Vector3(17, 12, 5)) < EPSILON, "asset column-major basis/translation")
		check(transformed.find_children("*", "StaticBody3D", true, false).size() == 2, "wall/barrier meshes create colliders")
	if identity != null:
		check(identity.transform == Transform3D.IDENTITY, "omitted asset transform is identity")
	var rejected := Assets.new()
	check(not rejected.load_assets({"assets": [{"uri": "../escape.glb", "format": "glb"}]}, "user://", station_root), "reject asset traversal")
	check(not rejected.load_assets({"assets": [{"uri": filename, "format": "glb", "transform": [1]}]}, "user://", station_root), "reject malformed asset transform")
	_check_symlink_fence(output)
	DirAccess.remove_absolute(ProjectSettings.globalize_path(output))


## In-station symlinks load; links that resolve into another folder are refused before any read.
func _check_symlink_fence(glb: String) -> void:
	var root := ProjectSettings.globalize_path("user://").path_join("fence-%d" % OS.get_process_id())
	var gteki := root.path_join("station/gteki")
	DirAccess.make_dir_recursive_absolute(gteki)
	DirAccess.make_dir_recursive_absolute(root.path_join("station/assets"))
	DirAccess.make_dir_recursive_absolute(root.path_join("other"))
	var source := ProjectSettings.globalize_path(glb)
	DirAccess.copy_absolute(source, root.path_join("station/assets/inside.glb"))
	DirAccess.copy_absolute(source, root.path_join("other/outside.glb"))
	var dir := DirAccess.open(gteki)
	DirAccess.make_dir_recursive_absolute(root.path_join("station/links"))
	# Chained escape: the first hop stays inside the station, the second leaves it.
	var linked := dir.create_link("../assets/inside.glb", "inside.glb") == OK and dir.create_link("../../other/outside.glb", "outside.glb") == OK \
		and DirAccess.open(root.path_join("station/links")).create_link("../../other/outside.glb", "next.glb") == OK \
		and dir.create_link("../links/next.glb", "chained.glb") == OK
	check(linked, "create test symlinks")
	if linked:
		var station_root := Node3D.new()
		var ok := Assets.new()
		check(ok.load_assets({"assets": [{"id": "in", "uri": "inside.glb", "format": "glb"}]}, gteki, station_root), "in-station symlinked GLB loads: %s" % str(ok.issues))
		var escape := Assets.new()
		check(not escape.load_assets({"assets": [{"id": "out", "uri": "outside.glb", "format": "glb"}]}, gteki, station_root), "symlink escaping the station folder is refused")
		check(escape.counts.assets == 0, "refused symlink is never read")
		var chained := Assets.new()
		check(not chained.load_assets({"assets": [{"id": "chain", "uri": "chained.glb", "format": "glb"}]}, gteki, station_root), "chained symlink escaping on its second hop is refused")
		check(chained.counts.assets == 0, "refused chained symlink is never read")
		station_root.free()
	for f in ["station/gteki/inside.glb", "station/gteki/outside.glb", "station/gteki/chained.glb", "station/links/next.glb", "station/assets/inside.glb", "other/outside.glb", "station/gteki", "station/assets", "station/links", "station", "other", ""]:
		DirAccess.remove_absolute(root.path_join(f))


func finish() -> void:
	if failures.is_empty():
		print("PASS: GTEki Godot compatibility proof (%d checks)" % checks)
		quit(0)
	else:
		printerr("FAIL: GTEki Godot compatibility proof (%d failures / %d checks)" % [failures.size(), checks])
		quit(1)
