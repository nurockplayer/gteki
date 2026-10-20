extends RefCounted
## Construct the path supplied by @gteki/navigation. No graph search lives in Godot.

const Station = preload("res://addons/gteki/gteki_station.gd")

var document: Dictionary = {}
var points := PackedVector3Array()
var issues: Array[String] = []


func load_route(path: String, station_id: String) -> bool:
	document.clear()
	points.clear()
	issues.clear()
	var data := Station.read_json(path, issues)
	if not issues.is_empty():
		return false
	if data.get("contract") != "gteki.route/0.1" or data.get("stationId") != station_id:
		issues.append("Route contract/station identity mismatch")
	if not data.get("result") is Dictionary or not data.get("path") is Array:
		issues.append("Route result/path missing")
	if not issues.is_empty():
		return false
	if data.result.get("ok") != true:
		issues.append("TypeScript router did not find a route: %s" % data.result.get("reason", "unknown"))
		return false
	if not data.result.get("nodeIds") is Array or data.path.size() != data.result.nodeIds.size():
		issues.append("Route node count mismatch")
		return false
	for i in range(data.path.size()):
		var point: Variant = data.path[i]
		if not point is Dictionary or point.get("nodeId") != data.result.nodeIds[i] or not point.get("renderer") is Array:
			issues.append("Invalid route point %d" % i)
			continue
		var renderer: Array = point.renderer
		if renderer.size() != 3 or not renderer.all(Station.is_number):
			issues.append("Invalid renderer coordinates at %d" % i)
			continue
		points.append(Vector3(renderer[0], renderer[1], renderer[2]))
	if points.size() < 2:
		issues.append("A successful route requires at least two points")
	if not issues.is_empty():
		points.clear()
		return false
	document = data
	return true


func build_path() -> Path3D:
	var path := Path3D.new()
	path.name = "GTEkiRoute"
	path.curve = Curve3D.new()
	for point in points:
		path.curve.add_point(point)
	return path


func total_length() -> float:
	var length := 0.0
	for i in range(1, points.size()):
		length += points[i - 1].distance_to(points[i])
	return length
