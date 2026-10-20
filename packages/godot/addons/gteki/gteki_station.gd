extends RefCounted
## Runtime JSON adapter only. The TypeScript parser/router owns contract validation/routing.

const CONTRACT = "gteki.station/0.1"

var manifest: Dictionary = {}
var nodes: Array = []
var floors: Array = []
var pois: Array = []
var nodes_by_id: Dictionary = {}
var floors_by_id: Dictionary = {}
var symbolic_heights: Dictionary = {}
var issues: Array[String] = []


static func read_json(path: String, errors: Array[String]) -> Dictionary:
	var file := FileAccess.open(path, FileAccess.READ)
	if file == null:
		errors.append("Cannot open %s: %s" % [path, error_string(FileAccess.get_open_error())])
		return {}
	var json := JSON.new()
	var error := json.parse(file.get_as_text())
	if error != OK:
		errors.append("%s:%d: %s" % [path, json.get_error_line(), json.get_error_message()])
		return {}
	if not json.data is Dictionary:
		errors.append("%s: expected a JSON object" % path)
		return {}
	return json.data


static func is_number(value: Variant) -> bool:
	return (value is float or value is int) and is_finite(float(value))


func load_station(station_dir: String) -> bool:
	issues.clear()
	manifest.clear()
	nodes.clear()
	floors.clear()
	pois.clear()
	nodes_by_id.clear()
	floors_by_id.clear()
	symbolic_heights.clear()
	var base := station_dir.path_join("gteki")
	var m := read_json(base.path_join("station.json"), issues)
	var graph := read_json(base.path_join("graph.json"), issues)
	var poi_file := read_json(base.path_join("pois.json"), issues)
	if not issues.is_empty():
		return false
	for document in [m, graph, poi_file]:
		if document.get("schema") != CONTRACT:
			issues.append("Expected %s" % CONTRACT)
	if not m.get("station") is Dictionary or not m.get("floors") is Array:
		issues.append("Missing station/floors")
	if not graph.get("nodes") is Array or not poi_file.get("pois") is Array:
		issues.append("Missing nodes/pois")
	if not issues.is_empty():
		return false
	var station_id: Variant = m.station.get("id")
	if not station_id is String or graph.get("stationId") != station_id or poi_file.get("stationId") != station_id:
		issues.append("Station identity mismatch")
	for floor_record in m.floors:
		if not floor_record is Dictionary or not floor_record.get("id") is String or not is_number(floor_record.get("renderElevationM")):
			issues.append("Invalid floor record")
			continue
		if floors_by_id.has(floor_record.id):
			issues.append("Duplicate floor: %s" % floor_record.id)
		floors_by_id[floor_record.id] = floor_record
	for node in graph.nodes:
		if not node is Dictionary or not node.get("id") is String or not node.get("position") is Dictionary:
			issues.append("Invalid node record")
			continue
		var position: Dictionary = node.position
		if not position.has("z") or not is_number(position.get("x")) or not is_number(position.get("y")):
			issues.append("Invalid ENU position: %s" % node.id)
		if position.get("z") != null and not is_number(position.z):
			issues.append("Invalid height: %s" % node.id)
		if node.has("renderZ") and not is_number(node.renderZ):
			issues.append("Invalid renderZ: %s" % node.id)
		if not floors_by_id.has(node.get("floorId", "")):
			issues.append("Unknown floor: %s" % node.id)
		if nodes_by_id.has(node.id):
			issues.append("Duplicate node: %s" % node.id)
		nodes_by_id[node.id] = node
		symbolic_heights[node.id] = position.get("z") == null
	if not issues.is_empty():
		nodes_by_id.clear()
		floors_by_id.clear()
		symbolic_heights.clear()
		return false
	manifest = m
	nodes = graph.nodes
	floors = m.floors
	pois = poi_file.pois
	return true


func enu_to_godot(enu: Dictionary) -> Vector3:
	# Null remains unknown in the contract. These fallbacks are display heights only.
	var height: Variant = enu.get("z")
	if height == null:
		height = enu.get("renderZ")
	if height == null:
		height = floors_by_id.get(enu.get("floorId", ""), {}).get("renderElevationM")
	if not is_number(height):
		issues.append("Cannot resolve display height")
		return Vector3(NAN, NAN, NAN)
	return Vector3(float(enu.x), float(height), -float(enu.y))


func node_to_godot(node: Dictionary) -> Vector3:
	var enu: Dictionary = node.position.duplicate()
	enu["renderZ"] = node.get("renderZ")
	enu["floorId"] = node.floorId
	return enu_to_godot(enu)
