extends SceneTree
## G-5a: headless evidence walks (#164). For a station's routes it does two things and writes the result as a Markdown
## evidence table:
##   1. route check: ask the real bridge (gteki_bridge.gd -> packages/cli/src/route.ts, the same TypeScript router the
##      web explorer runs) for the route and compare it, exactly, with the web's golden
##      (tests/e2e/specs/__goldens__/02-navigation.spec.ts/<station>-routes.json); a scenario the router must refuse is
##      checked as a refusal with the golden's own reason;
##   2. walk check: spawn the web-rule walker (gteki_walker.gd) at the route start and drive it along the route polyline,
##      recording walked length, stalls, body-block episodes, the floors it actually visited (y bands), the arrival
##      distance and the time at the web's walk speed.
## This is a headless physics walk, no rendering: it says nothing about how the station looks.
## Usage: -- <scenesDir> [<stationId>]      (default station: ikebukuro)

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Station = preload("res://addons/gteki/gteki_station.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")

const DT := 1.0 / 60.0
## A vertex is reached when the walker is this close to it, and only then does it turn to the next one. The walker turns
## in place toward the next segment, so a larger reach turns while still short of the vertex and the chord cuts the
## corner: with the 0.2 m reach the W4/I7 replay was refused by a wall corner the line passes (#284: the walk, not the
## station). The cut is bounded by the reach, so at 0.05 m no vertex is cut by 0.05 m, and no route may be blocked.
const WAYPOINT_REACH := 0.05
## Consecutive steps with no horizontal progress that count as a stall (1 s of walking into something).
const STALL_STEPS := 60
## A leg's step budget is twice its straight-line walking time plus this many steps, so a walker that keeps moving but
## never arrives is stopped without the budget cutting off an honest long leg (W2's longest is 113 m: ~4700 steps).
const LEG_BUDGET_STEPS := 600
const LEG_BUDGET_FACTOR := 2.0
## The golden the web's 02-navigation spec writes; every expected value (distance, seconds, node count, floor changes,
## step list) is read from it, never copied into this file.
const GOLDEN_DIR := "tests/e2e/specs/__goldens__/02-navigation.spec.ts"
## Walked 3D length must match the route's own length within `max(LENGTH_TOLERANCE_M, vertices * WAYPOINT_REACH)`. The
## walk ties every vertex from inside the reach, so by construction each one can add or cut less than `WAYPOINT_REACH` of
## path: the error is bounded per vertex, not proportionally to the route. The measured worst case is in the table; a
## route outside the band is a finding, not tolerance noise.
const LENGTH_TOLERANCE_M := 0.5
const LENGTH_TOLERANCE_PER_VERTEX := WAYPOINT_REACH

## What the evidence run does at each station: the golden it replays, the table it writes, and the golden scenarios it
## covers (evidence label -> scenario id, with the reason it is in the set). A scenario whose golden route is ok is
## walked; one the router must refuse is checked as a refusal, from the same bridge and the same profile flags.
const PLANS := {
	"ikebukuro": {
		"golden": "ikebukuro-routes.json",
		"evidence": "res://docs/evidence/g5-ikebukuro.md",
		# W2 is the flat control (no floor change); the rest cover a stair each way and the two deepest routes.
		"routes": [
			{"label": "W1", "golden": "I1"},
			{"label": "W2", "golden": "I2"},
			{"label": "W3", "golden": "I3"},
			{"label": "W4", "golden": "I4"},
			{"label": "I7", "golden": "I7"},
		],
	},
	"shinjuku": {
		"golden": "shinjuku-routes.json",
		"evidence": "res://docs/evidence/g5-shinjuku.md",
		"selection": [
			"All nine scenarios of the golden are replayed here — the golden has nine, so none had to be picked out. Four",
			"route and are walked (S4 takes its lift, which the route itself states), and five are refusals the router must",
			"make, checked against the bridge (a refused route has no polyline to walk), each with the profile toggle its",
			"scenario sets.",
		],
		"routes": [
			{"label": "S1", "golden": "S1", "why": "street (north) down to the B6 Oedo platform: four floor changes, and it crosses the fare line"},
			{"label": "S2", "golden": "S2", "why": "the Oedo platform back up to the north-west street via the stacked switchback: the longest route, four floor changes"},
			{"label": "S3", "golden": "S3", "why": "B1 exit to the B3 toilets inside the paid area: the paid-area way down"},
			{"label": "S4", "golden": "S4", "why": "the shortest route (13 m): street to B1 south, outside the gates, down one lift"},
			{"label": "S5", "golden": "S5", "why": "step-free profile: the router must refuse, the connection uses stairs"},
			{"label": "SN1", "golden": "SN1", "why": "outside-gates profile: the platform is paid, so the router must refuse"},
			{"label": "SN2", "golden": "SN2", "why": "outside-gates profile: the toilets are paid, so the router must refuse"},
			{"label": "SN3", "golden": "SN3", "why": "require-known-hours profile: unknown hours, so the router must refuse"},
			{"label": "SN4", "golden": "SN4", "why": "start equals goal: the router must refuse with its own reason"},
		],
	},
}

var checks := 0
var failures: Array[String] = []
var repo_root := ""
var rows: Array[Dictionary] = []
## The floors' own provenance, read with the elevations so the table states it from the data rather than from memory.
var floor_sources: Array[String] = []
var floor_elevation_m_missing := false
## Floor id -> rendered elevation (m), so a route's own floor ids can be compared with the walker's height trace.
var floor_band_by_id: Dictionary = {}


func _initialize() -> void:
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		printerr("FAIL: ", message)


func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		printerr("Usage: -- <scenesDir> [<stationId>]")
		quit(1)
		return
	var scenes_dir: String = args[0]
	var station_id: String = args[1] if args.size() > 1 else "ikebukuro"
	check_self()
	var plan: Dictionary = PLANS.get(station_id, {})
	check(not plan.is_empty(), "station %s has an evidence plan" % station_id)
	if plan.is_empty():
		finish()
		return
	var bridge := Bridge.new()
	repo_root = bridge.repo_root
	check(not repo_root.is_empty(), "the repository root is found above the project")
	var golden := load_golden(plan)
	check(not golden.is_empty(), "the routes golden loads from %s" % golden_path(plan))

	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	var loaded := scene.load_snapshot(scenes_dir.path_join(station_id), holder)
	check(loaded, "%s: snapshot loads: %s" % [station_id, str(scene.issues)])
	if not loaded or golden.is_empty():
		holder.queue_free()
		finish()
		return
	var walker := Walker.new()
	holder.add_child(walker)
	walker.set_walls(scene.sidecar.get("walls", []))
	await physics_frame
	await physics_frame

	var elevations := floor_elevations(bridge.station_dir(station_id))
	for spec in plan.routes:
		var label := str(spec.label)
		var scenario: Variant = golden.get(str(spec.golden))
		check(scenario is Dictionary, "%s: golden scenario %s exists" % [label, str(spec.golden)])
		if not scenario is Dictionary:
			continue
		var expected: Dictionary = scenario.result
		var row := {"label": label, "golden_id": str(spec.golden), "from": str(scenario.from), "to": str(scenario.to), "why": str(spec.get("why", ""))}
		row["expected"] = expected
		row["expect_refusal"] = expected.get("ok", true) == false
		var routed := bridge.route(station_id, str(scenario.from), str(scenario.to), true, true, profile_args(scenario.get("profile", {})))
		if routed.has("doc"):
			row["doc"] = routed.doc
		if row.expect_refusal:
			row["route_diff"] = check_refusal(label, expected, routed)
			rows.append(row)
			continue
		check(routed.ok, "%s: the router answers %s -> %s: %s" % [label, str(scenario.from), str(scenario.to), str(routed.get("error", ""))])
		if not routed.ok:
			# A route the golden has and the router refuses is a finding of its own; the row still goes into the table,
			# marked as a mismatch, rather than silently missing.
			row["route_diff"] = ["router refused: %s" % str(routed.get("reason", routed.get("error", "?")))]
			rows.append(row)
			continue
		var doc: Dictionary = routed.doc
		row["doc"] = doc
		row["route_diff"] = check_route(label, expected, doc)
		# The rides the route itself states (#287): the client and this walk read them from the same Guide code, and a
		# route without an `elevator` step has none, so nothing here can teleport across a step the route does not call
		# a lift.
		var guided := Guide.new()
		check(guided.load_doc(doc), "%s: the route loads in the guide (%s)" % [label, str(guided.issues)])
		row["rides"] = guided.rides
		walk_route(walker, label, doc, guided, elevations, row)
		rows.append(row)

	holder.queue_free()
	write_evidence(station_id, scene, plan, elevations)
	finish()


# ---- route check ----------------------------------------------------------------------------------------------

static func golden_path(plan: Dictionary) -> String:
	return GOLDEN_DIR.path_join(str(plan.golden))


func load_golden(plan: Dictionary) -> Dictionary:
	if repo_root.is_empty():
		return {}
	var errors: Array[String] = []
	var data := Station.read_json(repo_root.path_join(golden_path(plan)), errors)
	check(errors.is_empty(), "the golden parses (%s)" % str(errors))
	return data if errors.is_empty() else {}


## The route.ts flags for a golden scenario's `profile` block — the same three toggles the web's 02-navigation spec sets.
## A scenario without a profile block runs on the router's defaults.
static func profile_args(profile: Dictionary) -> Array:
	var args: Array = []
	if bool(profile.get("stepFree", false)):
		args.append("--step-free")
	if bool(profile.get("unpaidOnly", false)):
		args.append("--unpaid-only")
	if bool(profile.get("strictHours", false)):
		args.append("--strict-hours")
	return args


## The route the bridge returns must equal the golden exactly: it is the same TypeScript router, so a difference is a
## finding (a Godot-side assumption, a stale golden or a changed station), never something to round away. The golden
## stores length to 0.1 m and seconds as a whole number (the web's own presentation), so those compare at that
## precision; nodes, floor changes and the ordered step list compare as they are. Returns the differences (empty =
## match); pure, so the self-checks can feed it an altered golden row and see each field reported.
static func route_compare(expected: Dictionary, doc: Dictionary) -> Dictionary:
	var result: Dictionary = doc.get("result", {})
	var nodes: Array = result.get("nodeIds", [])
	var steps: Array[String] = []
	for step in result.get("steps", []):
		steps.append(("<%s" if bool(step.get("reversed", false)) else ">%s") % str(step.get("edgeId", "?")))
	var got := {
		"lengthM": roundf(float(result.get("totalLengthM", -1.0)) * 10.0) / 10.0,
		"seconds": roundi(float(result.get("estimatedSeconds", -1.0))),
		"nodes": nodes.size(),
		"floorChanges": int(result.get("floorChanges", -1)),
		"steps": steps,
	}
	var diffs: Array[String] = []
	if not is_equal_approx(got.lengthM, float(expected.get("lengthM", -1.0))):
		diffs.append("length %.1f m, golden %.1f m" % [got.lengthM, float(expected.get("lengthM", -1.0))])
	if int(got.seconds) != int(expected.get("seconds", -1)):
		diffs.append("time %d s, golden %d s" % [got.seconds, int(expected.get("seconds", -1))])
	if int(got.nodes) != int(expected.get("nodes", -1)):
		diffs.append("%d nodes, golden %d" % [got.nodes, int(expected.get("nodes", -1))])
	if int(got.floorChanges) != int(expected.get("floorChanges", -1)):
		diffs.append("%d floor changes, golden %d" % [got.floorChanges, int(expected.get("floorChanges", -1))])
	if got.steps != expected.get("steps", []):
		diffs.append("steps %s, golden %s" % [str(got.steps), str(expected.get("steps", []))])
	return {"got": got, "diffs": diffs}


func check_route(label: String, expected: Dictionary, doc: Dictionary) -> Array[String]:
	var compared := route_compare(expected, doc)
	var got: Dictionary = compared.got
	var diffs: Array[String] = compared.diffs
	check(diffs.is_empty(), "%s: the route matches the golden exactly (%s)" % [label, "match" if diffs.is_empty() else "; ".join(diffs)])
	print("%s: route %.1f m / %d s / %d nodes / %d floor changes / %d steps%s" % [label, got.lengthM, got.seconds, got.nodes, got.floorChanges, (got.steps as Array).size(), "" if diffs.is_empty() else " MISMATCH"])
	return diffs


## A scenario the golden refuses: the bridge must refuse it too, with the golden's own reason. Anything else — a route
## where the golden refuses one, or a different reason — is a difference. Pure, like route_compare.
static func refusal_diff(expected: Dictionary, routed: Dictionary) -> Array[String]:
	var diffs: Array[String] = []
	var want := str(expected.get("reason", "?"))
	if routed.ok:
		diffs.append("router answered a route, golden refuses (%s)" % want)
	elif not routed.has("reason"):
		diffs.append("the bridge failed: %s" % str(routed.get("error", "?")))
	elif str(routed.get("reason")) != want:
		diffs.append("refused (%s), golden (%s)" % [str(routed.get("reason")), want])
	return diffs


func check_refusal(label: String, expected: Dictionary, routed: Dictionary) -> Array[String]:
	var diffs := refusal_diff(expected, routed)
	check(diffs.is_empty(), "%s: the router refuses the scenario as the golden does (%s)" % [label, "match" if diffs.is_empty() else "; ".join(diffs)])
	var answer := "answered a route" if routed.ok else str(routed.get("reason", routed.get("error", "?")))
	print("%s: router %s, golden %s%s" % [label, answer, str(expected.get("reason", "?")), "" if diffs.is_empty() else " MISMATCH"])
	return diffs


# ---- walk check -----------------------------------------------------------------------------------------------

## The station's floor elevations in metres, from its own station.json. The walk compares the walker's height with
## these, so the floor observation comes from the station data, not from the route it is meant to check.
func floor_elevations(station_dir: String) -> Array[float]:
	var path := station_dir.path_join("gteki/station.json")
	var errors: Array[String] = []
	var station := Station.read_json(path, errors)
	var floors: Array = station.get("floors", [])
	var elevations: Array[float] = []
	floor_sources.clear()
	floor_band_by_id.clear()
	floor_elevation_m_missing = not floors.is_empty()
	for floor_record in floors:
		elevations.append(float(floor_record.renderElevationM))
		floor_band_by_id[str(floor_record.get("id", ""))] = float(floor_record.renderElevationM)
		var source := str(floor_record.get("elevationSource", "UNKNOWN"))
		if not floor_sources.has(source):
			floor_sources.append(source)
		if floor_record.get("elevationM", null) != null:
			floor_elevation_m_missing = false
	check(not elevations.is_empty(), "the station's floor elevations load from %s (%s)" % [path, str(errors)])
	return elevations


## The narrowest gap between two different rendered floor bands, from the elevations the walk itself uses. Two floors can
## share a rendered elevation (a mezzanine drawn at street level), so equal values are one band, not a zero gap. Returns
## 0.0 when the station has fewer than two bands, which the table words as "one rendered band".
static func floor_band_separation(elevations: Array[float]) -> float:
	var bands: Array[float] = []
	for elevation in elevations:
		if not bands.has(elevation):
			bands.append(elevation)
	bands.sort()
	var narrowest := 0.0
	for i in range(1, bands.size()):
		var gap := bands[i] - bands[i - 1]
		if narrowest == 0.0 or gap < narrowest:
			narrowest = gap
	return narrowest


## The band-separation sentence the table needs, from the same elevations the walk used.
static func band_sentence(elevations: Array[float]) -> String:
	var narrowest := floor_band_separation(elevations)
	if narrowest <= 0.0:
		return "This station has a single rendered floor band, so its height trace cannot cross one."
	return "The narrowest separation between two different rendered bands here is %.1f m." % narrowest


## The table's "Floor changes" bullet. The elevations are rendered floor bands, not surveyed physical levels: the bullet
## says which of that is in the station data it was given.
func floor_band_lines(elevations: Array[float]) -> Array[String]:
	var lines: Array[String] = []
	lines.append("- **Floor-band crossings**: every sample of the walker's own height is put in the band of the station floor")
	lines.append("  whose elevation is nearest, and every change of band is counted (`floorChanges` counts graph floor transitions,")
	lines.append("  so this is an independent observation, not a copy of the route). The walk must start on the route's first")
	lines.append("  floor, reach every floor the route names in the order it names them, and end on the route's goal floor. It may")
	lines.append("  cross more bands than `floorChanges`, because a stair edge can span floors the route has no node on; every")
	lines.append("  such band is one the stair passes through, so it must lie strictly between the elevations of the two")
	lines.append("  consecutive route floors being travelled between and move toward the second. A band outside that range, a")
	lines.append("  reversal, or a walk that ends on another band fails. The crossed count is shown beside the route's so that")
	lines.append("  difference is visible, not averaged away. The elevation is the station's *rendered floor band*")
	lines.append("  (`renderElevationM` in `station.json`), not the physical floor level:")
	if floor_elevation_m_missing:
		lines.append("  `elevationM` is null on every floor and `elevationSource` is %s." % ", ".join(PackedStringArray(floor_sources)))
	elif not floor_sources.is_empty():
		lines.append("  `elevationSource` is %s." % ", ".join(PackedStringArray(floor_sources)))
	lines.append("  %s" % band_sentence(elevations))
	if floor_band_separation(elevations) > 0.0:
		lines.append("  The walker's height is damped toward the stair surface; a lag smaller than half of that separation cannot")
		lines.append("  add or lose a crossing, and no lag figure is asserted here.")
	return lines


static func heading_to_yaw(forward_x: float, forward_z: float) -> float:
	return atan2(-forward_x, -forward_z)


## The router measures an edge in 3D when its heights are known and in plan (x, z) when they are symbolic
## (`geometryLength(geometry, symbolicZ)` in packages/navigation/src/router.ts); a route's length is the sum of those.
## The polyline's own `zKnown` flags say which: a route with a symbolic height is measured without that climb, so the
## walk must compare its plan length to it, not the 3D one. Pure, so the self-checks can state both cases.
static func route_measures_plan(doc: Dictionary) -> bool:
	for p in doc.get("polyline", []):
		if not bool(p.get("zKnown", true)):
			return true
	return false


## Drives the walker along the route polyline, one waypoint at a time, at the web's walk speed. Fills `row` with the
## measurements and checks them: arrival within 1 m, no stall or body block outside KNOWN_BLOCKS, the walk reaching the
## route's floors in order with every band in between one the transit passes through (`bands_follow_route`), and the
## walked length within the stated tolerance of the route's, compared in the basis the router measured it in.
## A route that states a lift ride (#287) is walked up to the shaft and then rides it: the same Guide.take_ride() the HQ
## client uses lands the feet on the shaft's exit through the walker's own ground rule. The ridden span's plan length and
## the approach the walker could not step (it cannot stand on the shaft edge) are excluded from the walked length and
## reported, so the ride is visible in the numbers rather than lost in a tolerance.
func walk_route(walker: Walker, label: String, doc: Dictionary, guided: Guide, elevations: Array[float], row: Dictionary) -> void:
	var points: Array[Vector3] = []
	for p in doc.polyline:
		var q := Vector3(p.renderer[0], p.renderer[1], p.renderer[2])
		if points.is_empty() or Vector2(q.x - points[-1].x, q.z - points[-1].z).length() > 0.05:
			points.append(q)
	check(points.size() >= 2, "%s: the route polyline has points" % label)
	if points.size() < 2:
		return
	# The rides the route states, anchored to this walk's own polyline points (the walker drops vertices closer than
	# 0.05 m, so the guide's point indices are matched by position, never assumed).
	var ride_at_point := {}
	for ride in guided.rides:
		var from_i := nearest_point(points, ride.from)
		var to_i := nearest_point(points, ride.to)
		check(from_i >= 0 and to_i > from_i, "%s: the ride on step %d starts and ends on polyline points" % [label, int(ride.step)])
		if from_i >= 0 and to_i > from_i:
			var anchored: Dictionary = (ride as Dictionary).duplicate()
			anchored.from_point = from_i
			anchored.to_point = to_i
			ride_at_point[from_i] = anchored
	var start := points[0]
	check(walker.walk_from(start, 0.0), "%s: the route start has walkable ground" % label)
	var first_dir := Vector2(points[1].x - points[0].x, points[1].z - points[0].z).normalized()
	walker.yaw = heading_to_yaw(first_dir.x, first_dir.y)
	var steps := 0
	var walked_3d := 0.0
	var walked_flat := 0.0
	var heights: Array[float] = [walker.feet().y]
	# Every change of floor band in the walker's own height trace, with where it happened: printed when the count
	# disagrees with the route, so a finding can be read without a rerun.
	var crossings: Array[Dictionary] = []
	var current_band := nearest_floor(walker.feet().y, elevations) if not elevations.is_empty() else 0.0
	var stalls: Array[int] = []
	var blocks := 0
	var in_block := false
	var refused := 0
	var refusal := {}
	var stopped_at := -1
	var stopped_because := ""
	var rides_taken: Array[Dictionary] = []
	var ride_drop := 0.0
	var ride_plan := 0.0
	var approach_gap := 0.0
	var ride_landing := 0.0
	var i := 1
	while i < points.size():
		var goal := points[i]
		var ride: Dictionary = ride_at_point.get(i, {})
		var stalled := 0
		var guard := 0
		var budget := int(ceil(Vector2(goal.x - walker.feet().x, goal.z - walker.feet().z).length() / (Walker.WALK * DT) * LEG_BUDGET_FACTOR)) + LEG_BUDGET_STEPS
		while true:
			var here := walker.feet()
			# The shaft's edge is not walkable ground, so the last stretch before it cannot be stepped: the walker takes
			# the ride the route states when it is within RIDE_TRIGGER of the shaft, exactly as the HUD offers it.
			if not ride.is_empty() and here.distance_to(ride.from) <= Guide.RIDE_TRIGGER:
				approach_gap += Vector2(ride.from.x - here.x, ride.from.z - here.z).length()
				print("%s: takes the lift at %s (%.2f m from the shaft start), exit %s" % [label, str(here), here.distance_to(ride.from), str(ride.to)])
				if not guided.take_ride(walker, ride):
					check(false, "%s: the lift's exit has walkable ground (%s)" % [label, str(ride.to)])
					stopped_at = i
					stopped_because = "the lift exit has no walkable ground"
					break
				rides_taken.append(ride)
				ride_drop += absf(float(ride.drop))
				ride_plan += float(ride.plan_m)
				var landed := walker.feet()
				var exit_point: Vector3 = ride.to
				var landing_offset := Vector2(landed.x - exit_point.x, landed.z - exit_point.z).length()
				ride_landing = maxf(ride_landing, landing_offset)
				if landing_offset > 0.01:
					print("%s: the shaft's exit vertex is over the opening; the feet are set down %.2f m from it on the floor" % [label, landing_offset])
				heights.append(landed.y)
				if not elevations.is_empty():
					var landing_band := nearest_floor(landed.y, elevations)
					if landing_band != current_band:
						crossings.append({"step": steps, "at": landed, "from": current_band, "to": landing_band})
						current_band = landing_band
				i = int(ride.to_point)
				break
			var to_goal := Vector2(goal.x - here.x, goal.z - here.z)
			if to_goal.length() < WAYPOINT_REACH:
				break
			walker.yaw = heading_to_yaw(to_goal.x / to_goal.length(), to_goal.y / to_goal.length())
			walker.last_block = ""
			var moved := walker.step(DT, Vector2(0, 1), false)
			steps += 1
			guard += 1
			var after := walker.feet()
			walked_3d += here.distance_to(after)
			walked_flat += Vector2(after.x - here.x, after.z - here.z).length()
			heights.append(after.y)
			if not elevations.is_empty():
				var band := nearest_floor(after.y, elevations)
				if band != current_band:
					crossings.append({"step": steps, "at": after, "from": current_band, "to": band})
					current_band = band
			if not moved:
				refused += 1
				if not walker.last_block.is_empty():
					if not in_block:
						blocks += 1
					in_block = true
					refusal = {
						"step": steps,
						"stage": walker.last_block,
						"collider": walker.last_block_collider,
						"point": walker.last_block_point,
						"clearance": walker.last_block_clearance,
						"feet": after,
					}
			else:
				in_block = false
			stalled = (stalled + 1) if Vector2(after.x - here.x, after.z - here.z).length() < 1e-4 else 0
			if stalled > STALL_STEPS or guard > budget:
				stopped_at = i
				stopped_because = "stalls at polyline point %d (%s, stage %s)" % [i, str(goal), walker.last_block] if stalled > STALL_STEPS else "runs out of its step budget at polyline point %d (%s)" % [i, str(goal)]
				# A stall without a refused step is usually ground that ends (a stairwell edge, a lift opening) rather than a
				# wall, so the report probes the nearest ground beyond the body, where the next step would have landed.
				var ahead := after + Vector3(-sin(walker.yaw), 0.0, -cos(walker.yaw)) * (Walker.RADIUS + 0.05)
				print("  %s: %s, from %s after %d steps in this leg; ground under the feet %s, under %s (%.2f m ahead) %s" % [label, stopped_because, str(after), guard, str(walker.ground_at(after.x, after.y + 0.5, after.z, 1.45)), str(ahead), Walker.RADIUS + 0.05, str(walker.ground_at(ahead.x, after.y + 0.5, ahead.z, 1.45))])
				break
		if stopped_at >= 0:
			stalls.append(i)
			break
		i += 1
	var end := walker.feet()
	var goal_point := points[-1]
	var miss := Vector2(end.x - goal_point.x, end.z - goal_point.z).length()
	var route_length := float(row.expected.lengthM)
	var tolerance := length_tolerance(points.size())
	var levels := count_level_changes(heights, elevations)
	var route_floors := route_bands(doc)
	var named: Array[float] = route_floors.bands
	var walked_bands: Array[float] = []
	if not elevations.is_empty():
		walked_bands.append(nearest_floor(heights[0], elevations))
	for crossing in crossings:
		walked_bands.append(float(crossing.to))
	var plan_length := route_measures_plan(doc)
	var compared_length := walked_flat if plan_length else walked_3d
	# What the walk was supposed to cover on foot: the route minus the span it rode, minus the measured approach the
	# walker could not step because the ground ends at the shaft.
	var expected_walk := route_length - ride_plan - approach_gap
	row["walk"] = {
		"points": points.size(),
		"steps": steps,
		"refused": refused,
		"walked_3d": walked_3d,
		"walked_flat": walked_flat,
		"stalls": stalls,
		"blocks": blocks,
		"levels": levels,
		"route_floors": named,
		"walked_bands": walked_bands,
		"plan_length": plan_length,
		"compared_length": compared_length,
		"rides_taken": rides_taken,
		"ride_drop": ride_drop,
		"ride_plan": ride_plan,
		"ride_landing": ride_landing,
		"approach_gap": approach_gap,
		"expected_walk": expected_walk,
		"miss": miss,
		"seconds": steps * DT,
		"stopped_at": stopped_at,
		"stopped_because": stopped_because,
		"refusal": refusal,
		"crossings": crossings,
		"end": end,
	}
	# No route may be blocked anywhere. A refusal is reported with what actually refused the step — the collider, where
	# the body stood and how far the surface was — so a block can be handed back as a finding (#284) without a rerun.
	check(stopped_at < 0, "%s: the walk follows the whole polyline (%s)%s" % [label, stopped_because, refusal_note(refusal)])
	check(blocks == 0, "%s: the walker body is blocked nowhere (%d block episodes)%s" % [label, blocks, refusal_note(refusal)])
	check((route_floors.unknown as Array).is_empty(), "%s: every floor the route names is in the station data (%s)" % [label, str(route_floors.unknown)])
	var band_error := bands_follow_route(named, walked_bands)
	check(band_error.is_empty(), "%s: the walk follows the route's floors through the rendered bands (route %s, walked %s): %s" % [label, str(named), str(walked_bands), band_error])
	if not band_error.is_empty():
		# The trace behind the failure, so a band outside the transit can be read without a rerun.
		for crossing in crossings:
			print("  %s: band %.2f -> %.2f at step %d (%s)" % [label, float(crossing.from), float(crossing.to), int(crossing.step), str(crossing.at)])
	check(miss < 1.0, "%s: the walk ends within 1 m of the goal (%.2f m)" % [label, miss])
	# No silent teleport: every ride the route states must have been taken by the shared take_ride() path, and the walked
	# length is held to the route's own minus that ridden span and the approach the ground did not allow.
	check(rides_taken.size() == ride_at_point.size(), "%s: every lift the route states is ridden (route states %d, the walk took %d)" % [label, ride_at_point.size(), rides_taken.size()])
	check(absf(compared_length - expected_walk) <= tolerance, "%s: the walked %s length %.1f m is within %.1f m of the route's %.1f m less %.2f m ridden and %.2f m unstepable approach (%.1f m)" % [label, "plan" if plan_length else "3D", compared_length, tolerance, route_length, ride_plan, approach_gap, expected_walk])
	var ride_note := ""
	if not rides_taken.is_empty():
		ride_note = ", %d lift ride(s) totalling %.2f m of rise/fall excluded from the walked length (ridden spans %s, approach %.2f m)" % [rides_taken.size(), ride_drop, str(rides_taken.map(func(r): return "%.2f m" % float(r.plan_m))), approach_gap]
	print("%s: walk %d waypoints, %d steps, %.1f m walked (flat %.1f m, router's %s length %.1f m)%s, %d stopped, %d block episodes, %d band crossings (route %d floor changes), %.0f s at %.2f m/s, %s" % [label, points.size(), steps, walked_3d, walked_flat, "plan" if plan_length else "3D", route_length, ride_note, stalls.size(), blocks, levels, int(row.expected.floorChanges), steps * DT, Walker.WALK, ("arrived %.2f m from the goal" % miss) if stopped_at < 0 else ("stopped %.2f m short of the goal at %s, height %.2f..%.2f" % [miss, str(end), heights.min(), heights.max()])])


## The refusal in words for a failure message: the stage, the collider, the feet position (renderer frame) and the
## clearance to the refusing surface's plane. Empty when nothing refused a step.
static func refusal_note(refusal: Dictionary) -> String:
	if refusal.is_empty():
		return ""
	return ": refused by %s at %s (%s), clearance %.3f m" % [str(refusal.collider), str(refusal.feet), str(refusal.stage), float(refusal.clearance)]


# ---- self-checks ---------------------------------------------------------------------------------------------

## The evidence machinery checked against fabricated rows, never the station: a route that differs from the golden must
## be reported as a mismatch, a block's failure note must name what refused it, and a failing run must not write a table
## that reads as passing (#283 review). Runs before the station is loaded.
func check_self() -> void:
	var expected := {"lengthM": 10.0, "seconds": 8, "nodes": 2, "floorChanges": 0, "steps": [">a", "<b"]}
	var doc := {"result": {"totalLengthM": 10.0, "estimatedSeconds": 8, "nodeIds": ["x", "y"], "floorChanges": 0, "steps": [{"edgeId": "a", "reversed": false}, {"edgeId": "b", "reversed": true}]}}
	check(route_compare(expected, doc).diffs.is_empty(), "self: a route equal to the golden compares as a match")
	for field in ["lengthM", "seconds", "nodes", "floorChanges"]:
		var altered: Dictionary = expected.duplicate()
		altered[field] = float(expected[field]) + 5.0 if field == "lengthM" else int(expected[field]) + 1
		check(not route_compare(altered, doc).diffs.is_empty(), "self: a golden row altered in %s is reported as a mismatch" % field)
	var altered_steps: Dictionary = expected.duplicate()
	altered_steps.steps = [">a", ">b"]
	check(not route_compare(altered_steps, doc).diffs.is_empty(), "self: a golden step list with a flipped edge is reported as a mismatch")
	check(refusal_note({"collider": "Mesh1", "feet": Vector3(1.0, 2.0, 3.0), "stage": "ahead h=0.5 d=0.290", "clearance": 0.29}).contains("Mesh1"), "self: a block's failure note names the collider, the place and the clearance")
	check(refusal_note({}).is_empty(), "self: a walk with no refusal has no note")
	var refused := {"ok": false, "reason": "no_path"}
	check(refusal_diff({"reason": "no_path"}, refused).is_empty(), "self: a refusal with the golden's reason compares as a match")
	check(not refusal_diff({"reason": "start_equals_goal"}, refused).is_empty(), "self: a refusal with another reason is reported as a mismatch")
	check(not refusal_diff({"reason": "no_path"}, {"ok": true}).is_empty(), "self: a route where the golden refuses one is reported as a mismatch")
	check(not refusal_diff({"reason": "no_path"}, {"ok": false, "error": "Cannot launch pnpm"}).is_empty(), "self: a bridge failure is never written as a refusal match")
	check(profile_args({}).is_empty(), "self: a scenario without a profile passes no profile flag")
	check(profile_args({"stepFree": true, "unpaidOnly": true, "strictHours": true}) == ["--step-free", "--unpaid-only", "--strict-hours"], "self: a scenario's profile toggles become the router's own flags")
	check(is_equal_approx(floor_band_separation([0.0, 4.6]), 4.6), "self: the band separation is the gap between rendered elevations")
	check(is_equal_approx(floor_band_separation([0.0, 0.0, 4.6]), 4.6), "self: two floors drawn at one elevation are one band, not a zero gap")
	check("\n".join(floor_band_lines([0.0, 0.0, 4.6])).contains("4.6"), "self: the table states the band separation it was given")
	check("\n".join(floor_band_lines([2.0, 2.0])).contains("single"), "self: a station with one band says so instead of quoting 0 m")
	check(route_measures_plan({"polyline": [{"zKnown": false}]}), "self: a route with a symbolic height is measured in plan")
	check(not route_measures_plan({"polyline": [{"zKnown": true}, {"zKnown": true}]}), "self: a route with known heights is measured in 3D")
	check(bands_follow_route([0.0, -7.8], [0.0, -7.8]).is_empty(), "self: the floors a route names, reached in order, match")
	check(not bands_follow_route([0.0, -7.8], [-7.8, 0.0]).is_empty(), "self: the same floors in the wrong order do not match")
	check(bands_follow_route([0.0, -23.74], [0.0, -6.19, -7.8, -23.74]).is_empty(), "self: bands strictly between the two route floors are the stair's transit and match")
	check(not bands_follow_route([0.0, -23.74], [0.0, -7.8, -6.19, -23.74]).is_empty(), "self: a band crossed back up in the transit is a reversal and does not match")
	check(not bands_follow_route([0.0, -23.74], [0.0, -6.19, -30.0, -23.74]).is_empty(), "self: a band outside the 0 -> -23.74 transit does not match")
	check(not bands_follow_route([0.0, -7.8], [0.0, -7.8, -16.2]).is_empty(), "self: a walk that leaves the goal floor does not match")
	check(not bands_follow_route([0.0, -7.8], [0.0, -16.2]).is_empty(), "self: a floor the route names that the walk never reaches does not match")
	check(not bands_follow_route([0.0, -7.8], [-7.8, 0.0, -7.8]).is_empty(), "self: a walk that starts on another band does not match")
	check(not bands_follow_route([], [0.0]).is_empty(), "self: a route that names no floor cannot be followed")
	# Ride detection (#287): read from the route's own `elevator` steps, gated on both the mode and the shaft geometry.
	# The S4-shaped route: a flat elevator entry, then 0.473 m horizontal with a 7.8 m drop inside it, then a flat exit.
	var shaft_points := PackedVector3Array([Vector3(0, 0, 0), Vector3(1.2, 0, 0), Vector3(1.673, -7.8, 0), Vector3(2.9, -7.8, 0)])
	var shaft_steps: Array[int] = [0, 0, 1, 2]
	var ride_found := Guide.find_rides([{"mode": "walk"}, {"mode": "elevator"}, {"mode": "walk"}], shaft_points, shaft_steps, cumulative_of(shaft_points))
	check(ride_found.size() == 1 and int(ride_found[0].step) == 1 and int(ride_found[0].from_point) == 1 and int(ride_found[0].to_point) == 2, "self: the vertical span of an elevator step is one ride (%s)" % str(ride_found))
	if ride_found.size() == 1:
		check(is_equal_approx(float(ride_found[0].drop), -7.8) and is_equal_approx(float(ride_found[0].plan_m), 0.473), "self: the ride reports its 0.473 m horizontal span and 7.8 m drop (drop %.3f, plan %.3f)" % [float(ride_found[0].drop), float(ride_found[0].plan_m)])
	check(Guide.find_rides([{"mode": "walk"}, {"mode": "walk"}, {"mode": "walk"}], shaft_points, shaft_steps, cumulative_of(shaft_points)).is_empty(), "self: the same geometry under walk steps is no ride, so the mode gate holds")
	# A lift with no shallow shaft: 0.6 m horizontal is over RIDE_MAX_FLAT, so nothing is ridden and it is reported.
	var wide_points := PackedVector3Array([Vector3(0, 0, 0), Vector3(1.2, 0, 0), Vector3(1.8, -7.8, 0)])
	var wide_steps: Array[int] = [0, 0, 1]
	check(Guide.find_rides([{"mode": "walk"}, {"mode": "elevator"}], wide_points, wide_steps, cumulative_of(wide_points)).is_empty(), "self: an elevator span 0.6 m wide with a 7.8 m drop is no ride (over RIDE_MAX_FLAT %.1f)" % Guide.RIDE_MAX_FLAT)
	# A steep span under another mode: 0.4 m horizontal, 2 m drop, on a stairs step — no ride, because only `elevator`
	# may be ridden.
	var stair_points := PackedVector3Array([Vector3(0, 0, 0), Vector3(1.2, 0, 0), Vector3(1.6, -2.0, 0)])
	check(Guide.find_rides([{"mode": "walk"}, {"mode": "stairs"}], stair_points, wide_steps, cumulative_of(stair_points)).is_empty(), "self: a 0.4 m wide 2 m drop under a stairs step is no ride (the mode gate)")

	check(not writes_table(["a check failed"]), "self: a failing run does not write the table")
	check(writes_table([]), "self: a passing run writes the table")
	var matched := {"label": "X", "golden_id": "X", "from": "a", "to": "b", "expected": expected, "doc": doc, "route_diff": []}
	check(evidence_verdict(matched) == "match", "self: a matched row is written as a match")
	var mismatched := matched.duplicate()
	mismatched.route_diff = ["length 15.0 m, golden 10.0 m"]
	check(evidence_verdict(mismatched).begins_with("MISMATCH ("), "self: a mismatched row is never written as a match (%s)" % evidence_verdict(mismatched))
	check(evidence_verdict({"label": "X", "expected": expected}) == "no route", "self: a row without a route is written as no route")


# ---- walk measurements ----------------------------------------------------------------------------------------

## Counts floor changes in the walker's own height trace: every sample is put in the band of the station floor whose
## elevation is nearest, and every change of band is counted. The walker's height is damped toward the stair surface, so
## a lag smaller than half of the narrowest rendered floor-band separation cannot add or lose a crossing; the lag itself
## is not measured here. A dip that stays on one floor (W1 dips 1.0 m inside B1) stays in its band and is not counted,
## while a route that goes up and comes back down counts both crossings.
## The floors the route names, in order: every step's from/to floor mapped to its rendered band, consecutive repeats
## dropped. A floor id the station data does not know is returned in `unknown` rather than being skipped silently.
func route_bands(doc: Dictionary) -> Dictionary:
	var bands: Array[float] = []
	var unknown: Array[String] = []
	for step in doc.get("result", {}).get("steps", []):
		for key in ["fromFloorId", "toFloorId"]:
			var id := str(step.get(key, ""))
			if not floor_band_by_id.has(id):
				if not unknown.has(id):
					unknown.append(id)
				continue
			var band: float = floor_band_by_id[id]
			if bands.is_empty() or not is_equal_approx(bands[-1], band):
				bands.append(band)
	return {"bands": bands, "unknown": unknown}


## "" when the walk's floor trace follows the route's floors, else the first reason it does not. The walk starts on the
## route's first floor and reaches every floor the route names, in the order it names them. A band in between must be
## one the stair passes through: strictly between the two route floors it is travelling between, moving toward the
## second. A band outside that range, a reversal, leaving the goal floor or ending anywhere else fails — so a fall to
## a wrong level cannot pass as an extra crossing.
static func bands_follow_route(named: Array[float], walked: Array[float]) -> String:
	if named.is_empty():
		return "the route names no floor"
	if walked.is_empty():
		return "the walk recorded no floor band"
	if not is_equal_approx(walked[0], named[0]):
		return "the walk starts in band %.2f, the route on %.2f" % [walked[0], named[0]]
	var next := 1
	var previous := named[0]
	for k in range(1, walked.size()):
		var band := walked[k]
		if next < named.size() and is_equal_approx(band, named[next]):
			previous = band
			next += 1
			continue
		if next >= named.size():
			return "the walk leaves the goal floor %.2f (band %.2f at sample %d)" % [named[-1], band, k]
		var from_band := named[next - 1]
		var to_band := named[next]
		var lo := minf(from_band, to_band)
		var hi := maxf(from_band, to_band)
		if band <= lo or band >= hi:
			return "band %.2f at sample %d is outside the %.2f -> %.2f it is travelling between" % [band, k, from_band, to_band]
		var direction := signf(to_band - from_band)
		if direction == 0.0 or (band - previous) * direction <= 0.0:
			return "band %.2f at sample %d reverses the %.2f -> %.2f transit" % [band, k, from_band, to_band]
		previous = band
	if next != named.size():
		return "the walk never reaches %.2f (route floors %s, walked bands %s)" % [named[next], str(named), str(walked)]
	return ""


static func count_level_changes(heights: Array[float], elevations: Array[float]) -> int:
	if heights.is_empty() or elevations.is_empty():
		return 0
	var changes := 0
	var current := nearest_floor(heights[0], elevations)
	for y in heights:
		var level := nearest_floor(y, elevations)
		if level != current:
			changes += 1
			current = level
	return changes


## The walked length's band for a polyline of `vertices` points: one reach of slop per vertex (the walk ties each one
## from anywhere inside the reach) plus the floor.
static func length_tolerance(vertices: int) -> float:
	return maxf(LENGTH_TOLERANCE_M, vertices * LENGTH_TOLERANCE_PER_VERTEX)


static func nearest_floor(y: float, elevations: Array[float]) -> float:
	var best := elevations[0]
	for elevation in elevations:
		if absf(y - elevation) < absf(y - best):
			best = elevation
	return best


## Index of the polyline point within 0.01 m of `at`, or -1: a ride's ends are matched to this walk's own points by
## position (the walk drops vertices closer than 0.05 m, so the guide's indices cannot be assumed).
static func nearest_point(points: Array[Vector3], at: Vector3) -> int:
	var best := -1
	var best_d := 0.01
	for i in points.size():
		var d := points[i].distance_to(at)
		if d <= best_d:
			best_d = d
			best = i
	return best


## Distance along a polyline of its own points, the same cumulative the guide keeps: pure, for the self-checks.
static func cumulative_of(points: PackedVector3Array) -> PackedFloat32Array:
	var run := PackedFloat32Array()
	var total := 0.0
	run.append(0.0)
	for i in range(1, points.size()):
		total += points[i - 1].distance_to(points[i])
		run.append(total)
	return run


# ---- evidence table -------------------------------------------------------------------------------------------

func git_state() -> String:
	if repo_root.is_empty():
		return "UNKNOWN"
	var out: Array = []
	if OS.execute("git", ["-C", repo_root, "rev-parse", "--short=9", "HEAD"], out, true) != 0:
		return "UNKNOWN"
	var sha := "".join(out).strip_edges()
	var status: Array = []
	OS.execute("git", ["-C", repo_root, "status", "--porcelain", "--untracked-files=no"], status, true)
	return sha + (" (working tree dirty)" if not "".join(status).strip_edges().is_empty() else "")


## The table's "Route check" cell: what `check_route` actually compared, never a fixed label — a row is only a match
## when its own comparison was empty.
static func evidence_verdict(row: Dictionary) -> String:
	if not row.has("doc"):
		return "no route"
	var diffs: Variant = row.get("route_diff", [])
	if not diffs is Array:
		return "UNKNOWN"
	return "match" if (diffs as Array).is_empty() else "MISMATCH (%s)" % ", ".join(PackedStringArray(diffs))


## The table is written only by a run in which every check passed; a failing run prints the table it would have
## written instead, so a table on disk never reads as this run's pass.
static func writes_table(failure_list: Array[String]) -> bool:
	return failure_list.is_empty()


func write_evidence(station_id: String, scene: Scene, plan: Dictionary, elevations: Array[float]) -> void:
	var path := ProjectSettings.globalize_path(str(plan.evidence))
	DirAccess.make_dir_recursive_absolute(path.get_base_dir())
	var version: Dictionary = Engine.get_version_info()
	var lines: Array[String] = []
	lines.append("# G-5a evidence walks: %s" % station_id)
	lines.append("")
	lines.append("**Headless physics walk, no rendering.** These numbers come from the exported snapshot driven by the")
	lines.append("web-rule walker (`gteki_walker.gd`) in headless Godot; they say nothing about how the station looks.")
	lines.append("")
	lines.append("| | |")
	lines.append("|---|---|")
	lines.append("| Generated by | `packages/godot/tests/run_evidence_tests.gd` (`bash packages/godot/run-evidence.sh`) |")
	lines.append("| Walk run at commit | `%s` |" % git_state())
	lines.append("| Godot | `%s` |" % str(version.get("string", "?")))
	lines.append("| Snapshot exported at | `%s` |" % str(scene.sidecar.get("sourceCommit", "UNKNOWN")))
	lines.append("| Snapshot meshes | %d (walkable %d, collider %d) |" % [int(scene.counts.get("meshes", 0)), int(scene.counts.get("walkable", 0)), int(scene.counts.get("collider", 0))])
	lines.append("")
	lines.append("Routes compared: the bridge (`gteki_bridge.gd` -> `packages/cli/src/route.ts`, the same TypeScript router")
	lines.append("the web explorer runs) against the web's golden `%s`." % golden_path(plan))
	lines.append("Distances, times, node counts, floor changes and the ordered step list are read from the golden and must")
	lines.append("match exactly (length at the golden's 0.1 m and seconds at its whole-second presentation). A scenario the")
	lines.append("golden refuses must be refused by the router, with the golden's own reason, and is not walked.")
	lines.append("")
	lines.append("| Route | From -> To | Golden (length / time / nodes / floor changes) | Route check | Walked 3D / flat | Length basis | Rides | Length tolerance | Stopped | Body-block episodes | Floor-band crossings walked / route floor changes | Arrival miss | Walk time |")
	lines.append("|---|---|---|---|---|---|---|---|---|---|---|---|---|")
	for row in rows:
		var expected: Dictionary = row.expected
		var refused := bool(row.get("expect_refusal", false))
		var golden := "refused: %s" % str(expected.get("reason", "?")) if refused else "%.1f m / %d s / %d / %d" % [float(expected.lengthM), int(expected.seconds), int(expected.nodes), int(expected.floorChanges)]
		var walk: Dictionary = row.get("walk", {})
		var walked := "not walked (the router refuses)" if refused else "did not walk"
		var basis := "-"
		var rides_text := "-"
		var tolerance := "-"
		var stopped := "-"
		var blocks := "-"
		var levels := "-"
		var miss := "-"
		var seconds := "-"
		var verdict := evidence_verdict(row)
		if row.has("doc") and not refused:
			basis = "plan" if route_measures_plan(row.doc) else "3D"
			if not walk.is_empty():
				walked = "%.1f m / %.1f m" % [float(walk.walked_3d), float(walk.walked_flat)]
				# The rides the route itself states, with the measured shaft each one rides and the total height: a route
				# with no `elevator` step reads "none", so a teleport with no step behind it cannot hide here.
				var taken: Array = walk.rides_taken
				if taken.is_empty():
					rides_text = "none"
				else:
					var spans: Array[String] = []
					for ride in taken:
						spans.append("%.2f m wide, %.1f m drop" % [float(ride.plan_m), absf(float(ride.drop))])
					rides_text = "%d, %.1f m total (%s)" % [taken.size(), float(walk.ride_drop), "; ".join(spans)]
				tolerance = "±%.1f m" % length_tolerance(int(walk.points))
				var stopped_at := int(walk.stopped_at)
				stopped = "point %d" % stopped_at if stopped_at >= 0 else "no"
				blocks = str(walk.blocks)
				levels = "%d / %d" % [int(walk.levels), int(expected.floorChanges)]
				miss = ("%.2f m" % float(walk.miss)) if stopped_at < 0 else "-"
				seconds = "%.0f s" % float(walk.seconds)
		lines.append("| %s | `%s` -> `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % [row.label, row.from, row.to, golden, verdict, walked, basis, rides_text, tolerance, stopped, blocks, levels, miss, seconds])
	lines.append("")
	var has_why := false
	for spec in plan.routes:
		if not str(spec.get("why", "")).is_empty():
			has_why = true
	if plan.has("selection") or has_why:
		lines.append("## Why these routes")
		lines.append("")
		for line in plan.get("selection", []):
			lines.append(str(line))
		for row in rows:
			if not str(row.get("why", "")).is_empty():
				lines.append("- **%s** (`%s` -> `%s`): %s" % [row.label, row.from, row.to, str(row.why)])
		lines.append("")
	lines.append("## How the walk numbers are made")
	lines.append("")
	lines.append("- **Steering**: the walker walks the route polyline itself: it turns toward the next vertex only once it is")
	lines.append("  within %.2f m of the current one, so by construction of that reach every vertex is cut by less than %.2f m in" % [WAYPOINT_REACH, WAYPOINT_REACH])
	lines.append("  plan and the walk never takes a chord across a corner that the line does not take. The same rule is used on")
	lines.append("  every route.")
	lines.append("- **Walked length**: summed 3D distance the walker's feet travel while following the route polyline waypoint")
	lines.append("  by waypoint (and the same sum in plan, which is the *flat* figure). The router measures an edge in 3D when its")
	lines.append("  heights are known and in plan when they are symbolic (`geometryLength(geometry, symbolicZ)` in")
	lines.append("  `packages/navigation/src/router.ts`), so the walk compares the figure the route was measured in: the flat one")
	lines.append("  when the route has a symbolic height, the 3D one otherwise. The **Length basis** column names that figure per")
	lines.append("  route, so a plan length is never read as a walked 3D one.")
	lines.append("  Every vertex is tied from inside the vertex reach, so by construction of that reach it can add or cut less than")
	lines.append("  %.2f m of path; the error is bounded per vertex, not proportionally to the route. The tolerance is therefore" % WAYPOINT_REACH)
	lines.append("  `max(%.1f m, %.2f m x polyline vertices)`: the measured value is in the table and a route outside the band is a" % [LENGTH_TOLERANCE_M, LENGTH_TOLERANCE_PER_VERTEX])
	lines.append("  finding, not tolerance noise.")
	lines.append("- **Rides**: a lift ride is read from the route itself (#287): inside an `elevator` step, a consecutive polyline")
	lines.append("  pair that moves under %.1f m horizontally while changing height by more than %.1f m is the shaft, and the same" % [Guide.RIDE_MAX_FLAT, Guide.RIDE_MIN_DROP])
	lines.append("  vertical span under `walk` or `stairs` is never a ride. The walk takes a ride through the same")
	lines.append("  `Guide.take_ride()` the HQ client's E prompt uses, and the **Rides** column shows the count, each shaft's width")
	lines.append("  and drop and the total height. The ridden span's plan length and the approach the walking walker could not step")
	lines.append("  (the ground ends at the shaft) are excluded from the walked length; a route that states a ride the walk did not")
	lines.append("  take fails, so no leg is ever teleported.")
	var ridden: Array[String] = []
	var landing_max := 0.0
	for row in rows:
		var walk: Dictionary = row.get("walk", {})
		for ride in walk.get("rides_taken", []):
			ridden.append("%s's shaft is %.3f m wide with a %.1f m drop" % [row.label, float(ride.plan_m), absf(float(ride.drop))])
		landing_max = maxf(landing_max, float(walk.get("ride_landing", 0.0)))
	if ridden.is_empty():
		lines.append("  This station's routes have no `elevator` step, so nothing here rides one.")
	else:
		lines.append("  On this run %s — inside the gate with a visible margin," % "; ".join(ridden))
		lines.append("  while a flat elevator step's entry walk and any stair are outside it. The shaft's exit vertex sits over")
		lines.append("  the opening (the car's floor is the hole), so the feet are set down on the nearest ground the walker's")
		lines.append("  own body fits on — %.2f m away — never on the lip." % landing_max)
	lines.append("- **Stopped**: a leg that makes no horizontal progress for %d steps (%.0f s) or that exceeds twice its" % [STALL_STEPS, STALL_STEPS * DT])
	lines.append("  straight-line walking time plus %d steps. No route may stop: a stopped route fails the test." % LEG_BUDGET_STEPS)
	lines.append("- **Body-block episodes**: runs of steps the walker's own body test (`bodyBlock`: radius %.1f m, rays at %.1f / %.1f m)"
		% [Walker.RADIUS, Walker.BODY_HEIGHTS[0], Walker.BODY_HEIGHTS[1]])
	lines.append("  refused. Slide moves along the surface the walker hit are not blocks. No route may have one; a failure names")
	lines.append("  the collider that refused the step, the walker's feet where it stood and the clearance to the surface's plane.")
	lines.append_array(floor_band_lines(elevations))
	lines.append("- **Walk time**: steps at the web's walk speed %.2f m/s (60 Hz fixed step); reported, not asserted." % Walker.WALK)
	lines.append("")
	var text := "\n".join(lines) + "\n"
	if not writes_table(failures):
		printerr("evidence: %d check(s) failed, so %s is left untouched; the table this run would have written:" % [failures.size(), path])
		print(text)
		return
	var file := FileAccess.open(path, FileAccess.WRITE)
	if file == null:
		check(false, "the evidence table can be written to %s" % path)
		return
	file.store_string(text)
	file.close()
	print("evidence: wrote %s" % path)


func finish() -> void:
	if failures.is_empty():
		print("PASS: GTEki Godot evidence walks (%d checks)" % checks)
		quit(0)
	else:
		printerr("FAIL: GTEki Godot evidence walks (%d failures / %d checks):\n  %s" % [failures.size(), checks, "\n  ".join(failures)])
		quit(1)
