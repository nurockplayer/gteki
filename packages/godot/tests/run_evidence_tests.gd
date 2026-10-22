extends SceneTree
## G-5a: headless evidence walks (#164). For four Ikebukuro routes plus a flat control it does two things and writes
## the result as a Markdown evidence table:
##   1. route check: ask the real bridge (gteki_bridge.gd -> packages/cli/src/route.ts, the same TypeScript router the
##      web explorer runs) for the route and compare it, exactly, with tests/e2e/specs/__goldens__/.../ikebukuro-routes.json;
##   2. walk check: spawn the web-rule walker (gteki_walker.gd) at the route start and drive it along the route polyline,
##      recording walked length, stalls, body-block episodes, the floors it actually visited (y bands), the arrival
##      distance and the time at the web's walk speed.
## This is a headless physics walk, no rendering: it says nothing about how the station looks.
## Usage: -- <scenesDir> [<stationId>]      (default station: ikebukuro)

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Station = preload("res://addons/gteki/gteki_station.gd")

const DT := 1.0 / 60.0
## A leg is done when the walker is this close to its waypoint (the same reach run_walk_tests.gd uses).
const WAYPOINT_REACH := 0.2
## Consecutive steps with no horizontal progress that count as a stall (1 s of walking into something).
const STALL_STEPS := 60
## A leg's step budget is twice its straight-line walking time plus this many steps, so a walker that keeps moving but
## never arrives is stopped without the budget cutting off an honest long leg (W2's longest is 113 m: ~4700 steps).
const LEG_BUDGET_STEPS := 600
const LEG_BUDGET_FACTOR := 2.0
## The golden the web's 02-navigation spec writes; every expected value (distance, seconds, node count, floor changes,
## step list) is read from it, never copied into this file.
const GOLDEN := "tests/e2e/specs/__goldens__/02-navigation.spec.ts/ikebukuro-routes.json"
const EVIDENCE := "res://docs/evidence/g5-ikebukuro.md"
## Walked 3D length must match the route's own length within this much: corner cutting at the polyline waypoints plus
## the WAYPOINT_REACH stop at each one shortens the walked path, and the walker's height damping rounds a stair's
## climb slightly. Measured worst case is printed in the table; a route that leaves this band is a finding.
const LENGTH_TOLERANCE_M := 3.0
const LENGTH_TOLERANCE_FRACTION := 0.02

## Evidence route label -> the golden scenario it replays. W2 is the flat control (no floor change).
const ROUTES := [
	{"label": "W1", "golden": "I1"},
	{"label": "W2", "golden": "I2"},
	{"label": "W3", "golden": "I3"},
	{"label": "W4", "golden": "I4"},
	{"label": "I7", "golden": "I7"},
]
## Routes whose strict replay is already known to be blocked, with the exact evidence. This is a findings list, not an
## allowance: the test asserts the block still happens where it says, and a changed route or collider fails it.
## W4 and I7 are stopped at the same passage: the verified walk edge `w_c__w_n` (geometry segment (-113, 130.5) ->
## (-112, 142.5), ENU) passes 0.29 m from the surface of `Mesh825_col`, a collision-only proxy (raycast tile under
## gteki_collision_proxies, material_22, 9.8 x 24.2 m, y 27.86..30.42), i.e. inside the walker's 0.3 m body radius. A
## player slides along it (the web's free-walk spec nudges past, and the browser walks I4); a strict replay is
## refused. I7 is not walk-claimed by the web either (`walk: false` in tests/e2e/fixtures/scenarios.json). Reported to
## the lead as a station-data finding: the line is the problem, not the walker — a probe 0.2 m west of the passage
## walks all of its steps, so a small lateral shift of the guide (or a geometry check on the proxy) fixes it. It is
## not accepted quality, and fixing it means deleting the entry, not widening it.
const KNOWN_BLOCKS := {
	"W4": {"point": 13, "collider": "Mesh825_col", "edge": "w_c__w_n", "offset_m": 0.29},
	"I7": {"point": 46, "collider": "Mesh825_col", "edge": "w_c__w_n", "offset_m": 0.29},
}

var checks := 0
var failures: Array[String] = []
var repo_root := ""
var rows: Array[Dictionary] = []


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
	var bridge := Bridge.new()
	repo_root = bridge.repo_root
	check(not repo_root.is_empty(), "the repository root is found above the project")
	var golden := load_golden()
	check(not golden.is_empty(), "the routes golden loads from %s" % GOLDEN)

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
	for spec in ROUTES:
		var label := str(spec.label)
		var scenario: Variant = golden.get(str(spec.golden))
		check(scenario is Dictionary, "%s: golden scenario %s exists" % [label, str(spec.golden)])
		if not scenario is Dictionary:
			continue
		var row := {"label": label, "golden_id": str(spec.golden), "from": str(scenario.from), "to": str(scenario.to)}
		row["expected"] = scenario.result
		var routed := bridge.route(station_id, str(scenario.from), str(scenario.to), true, true)
		check(routed.ok, "%s: the router answers %s -> %s: %s" % [label, str(scenario.from), str(scenario.to), str(routed.get("error", ""))])
		if not routed.ok:
			continue
		var doc: Dictionary = routed.doc
		row["doc"] = doc
		check_route(label, scenario.result, doc)
		walk_route(walker, label, doc, elevations, row)
		rows.append(row)

	holder.queue_free()
	write_evidence(station_id, scene)
	finish()


# ---- route check ----------------------------------------------------------------------------------------------

func load_golden() -> Dictionary:
	if repo_root.is_empty():
		return {}
	var path := repo_root.path_join(GOLDEN)
	var errors: Array[String] = []
	var data := Station.read_json(path, errors)
	check(errors.is_empty(), "the golden parses (%s)" % str(errors))
	return data if errors.is_empty() else {}


## The route the bridge returns must equal the golden exactly: it is the same TypeScript router, so a difference is a
## finding (a Godot-side assumption, a stale golden or a changed station), never something to round away. The golden
## stores length to 0.1 m and seconds as a whole number (the web's own presentation), so those compare at that
## precision; nodes, floor changes and the ordered step list compare as they are.
func check_route(label: String, expected: Dictionary, doc: Dictionary) -> void:
	var result: Dictionary = doc.result
	var nodes: Array = result.get("nodeIds", [])
	var steps: Array[String] = []
	for step in result.get("steps", []):
		steps.append(("%s%s" % ["<" if bool(step.reversed) else ">", str(step.edgeId)]))
	var got := {
		"lengthM": roundf(float(result.get("totalLengthM", -1.0)) * 10.0) / 10.0,
		"seconds": roundi(float(result.get("estimatedSeconds", -1.0))),
		"nodes": nodes.size(),
		"floorChanges": int(result.get("floorChanges", -1)),
		"steps": steps,
	}
	check(is_equal_approx(got.lengthM, float(expected.lengthM)), "%s: route length %.1f m equals the golden %.1f m" % [label, got.lengthM, float(expected.lengthM)])
	check(int(got.seconds) == int(expected.seconds), "%s: route time %d s equals the golden %d s" % [label, got.seconds, int(expected.seconds)])
	check(int(got.nodes) == int(expected.nodes), "%s: route nodes %d equal the golden %d" % [label, got.nodes, int(expected.nodes)])
	check(int(got.floorChanges) == int(expected.floorChanges), "%s: route floorChanges %d equal the golden %d" % [label, got.floorChanges, int(expected.floorChanges)])
	check(got.steps == expected.steps, "%s: route steps %s equal the golden %s" % [label, str(got.steps), str(expected.steps)])
	print("%s: route %.1f m / %d s / %d nodes / %d floor changes / %d steps" % [label, got.lengthM, got.seconds, got.nodes, got.floorChanges, steps.size()])


# ---- walk check -----------------------------------------------------------------------------------------------

## The station's floor elevations in metres, from its own station.json. The walk compares the walker's height with
## these, so the floor observation comes from the station data, not from the route it is meant to check.
func floor_elevations(station_dir: String) -> Array[float]:
	var path := station_dir.path_join("gteki/station.json")
	var errors: Array[String] = []
	var station := Station.read_json(path, errors)
	var elevations: Array[float] = []
	for floor_record in station.get("floors", []):
		elevations.append(float(floor_record.renderElevationM))
	check(not elevations.is_empty(), "the station's floor elevations load from %s (%s)" % [path, str(errors)])
	return elevations


static func heading_to_yaw(forward_x: float, forward_z: float) -> float:
	return atan2(-forward_x, -forward_z)


## Drives the walker along the route polyline, one waypoint at a time, at the web's walk speed. Fills `row` with the
## measurements and checks them: arrival within 1 m, no stall or body block outside KNOWN_BLOCKS, the floor changes
## the walker actually makes equal the route's, and the walked length within the stated tolerance of the route's.
func walk_route(walker: Walker, label: String, doc: Dictionary, elevations: Array[float], row: Dictionary) -> void:
	var points: Array[Vector3] = []
	for p in doc.polyline:
		var q := Vector3(p.renderer[0], p.renderer[1], p.renderer[2])
		if points.is_empty() or Vector2(q.x - points[-1].x, q.z - points[-1].z).length() > 0.05:
			points.append(q)
	check(points.size() >= 2, "%s: the route polyline has points" % label)
	if points.size() < 2:
		return
	var start := points[0]
	check(walker.walk_from(start, 0.0), "%s: the route start has walkable ground" % label)
	var first_dir := Vector2(points[1].x - points[0].x, points[1].z - points[0].z).normalized()
	walker.yaw = heading_to_yaw(first_dir.x, first_dir.y)
	var steps := 0
	var walked_3d := 0.0
	var walked_flat := 0.0
	var heights: Array[float] = [walker.feet().y]
	var stalls: Array[int] = []
	var blocks := 0
	var in_block := false
	var refused := 0
	var stopped_at := -1
	var stopped_because := ""
	for i in range(1, points.size()):
		var goal := points[i]
		var stalled := 0
		var guard := 0
		var budget := int(ceil(Vector2(goal.x - walker.feet().x, goal.z - walker.feet().z).length() / (Walker.WALK * DT) * LEG_BUDGET_FACTOR)) + LEG_BUDGET_STEPS
		while true:
			var here := walker.feet()
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
			if not moved:
				refused += 1
				if not walker.last_block.is_empty():
					if not in_block:
						blocks += 1
					in_block = true
			else:
				in_block = false
			stalled = (stalled + 1) if Vector2(after.x - here.x, after.z - here.z).length() < 1e-4 else 0
			if stalled > STALL_STEPS or guard > budget:
				stopped_at = i
				stopped_because = "stalls at polyline point %d (%s, stage %s)" % [i, str(goal), walker.last_block] if stalled > STALL_STEPS else "runs out of its step budget at polyline point %d (%s)" % [i, str(goal)]
				print("  %s: %s, from %s after %d steps in this leg; ground ahead %s" % [label, stopped_because, str(after), guard, str(walker.ground_at(after.x, after.y + 0.5, after.z, 1.45))])
				break
		if stopped_at >= 0:
			stalls.append(i)
			break
	var end := walker.feet()
	var goal_point := points[-1]
	var miss := Vector2(end.x - goal_point.x, end.z - goal_point.z).length()
	var route_length := float(row.expected.lengthM)
	var tolerance := maxf(LENGTH_TOLERANCE_M, route_length * LENGTH_TOLERANCE_FRACTION)
	var levels := count_level_changes(heights, elevations)
	var known: Variant = KNOWN_BLOCKS.get(str(row.label), null)
	row["walk"] = {
		"points": points.size(),
		"steps": steps,
		"refused": refused,
		"walked_3d": walked_3d,
		"walked_flat": walked_flat,
		"stalls": stalls,
		"blocks": blocks,
		"levels": levels,
		"miss": miss,
		"seconds": steps * DT,
		"stopped_at": stopped_at,
		"stopped_because": stopped_because,
		"end": end,
	}
	if known is Dictionary:
		# A documented block is evidence, not an allowance: it must still stop the walk exactly where the record says.
		check(stopped_at == int(known.point), "%s: the documented block still stops the walk at polyline point %d (%s)" % [label, int(known.point), stopped_because])
		check(blocks > 0, "%s: the documented block is still the walker's body being refused by %s" % [label, str(known.collider)])
	else:
		check(stopped_at < 0, "%s: the walk follows the whole polyline (%s)" % [label, stopped_because])
		check(blocks == 0, "%s: the walker body is blocked nowhere (%d block episodes, none documented)" % [label, blocks])
		check(levels == int(row.expected.floorChanges), "%s: the walker changes floors %d time(s), the route %d" % [label, levels, int(row.expected.floorChanges)])
		check(miss < 1.0, "%s: the walk ends within 1 m of the goal (%.2f m)" % [label, miss])
		check(absf(walked_3d - route_length) <= tolerance, "%s: the walked %.1f m is within %.1f m of the route's %.1f m" % [label, walked_3d, tolerance, route_length])
	print("%s: walk %d waypoints, %d steps, %.1f m walked (route %.1f m), %d stopped, %d block episodes, %d floor changes, %.0f s at %.2f m/s, %s" % [label, points.size(), steps, walked_3d, route_length, stalls.size(), blocks, levels, steps * DT, Walker.WALK, ("arrived %.2f m from the goal" % miss) if stopped_at < 0 else ("stopped %.2f m short of the goal at %s, height %.2f..%.2f" % [miss, str(end), heights.min(), heights.max()])])


## Counts floor changes in the walker's own height trace: every sample is put in the band of the station floor whose
## elevation is nearest, and every change of band is counted. The walker's height is damped toward the stair surface,
## so it lags by ~0.2 m mid-flight — well inside half of this station's 4.6 m floor separation, so a stair is crossed
## once. A dip that stays on one floor (W1 dips 1.0 m inside B1) stays in its band and is not counted, while a route
## that goes up and comes back down counts both crossings.
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


static func nearest_floor(y: float, elevations: Array[float]) -> float:
	var best := elevations[0]
	for elevation in elevations:
		if absf(y - elevation) < absf(y - best):
			best = elevation
	return best


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


func write_evidence(station_id: String, scene: Scene) -> void:
	var path := ProjectSettings.globalize_path(EVIDENCE)
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
	lines.append("the web explorer runs) against the web's golden `%s`." % GOLDEN)
	lines.append("Distances, times, node counts, floor changes and the ordered step list are read from the golden and must")
	lines.append("match exactly (length at the golden's 0.1 m and seconds at its whole-second presentation).")
	lines.append("")
	lines.append("| Route | From -> To | Golden (length / time / nodes / floor changes) | Route check | Walked 3D / flat | Length tolerance | Stopped | Body-block episodes | Floor changes walked / route | Arrival miss | Walk time |")
	lines.append("|---|---|---|---|---|---|---|---|---|---|---|")
	for row in rows:
		var expected: Dictionary = row.expected
		var golden := "%.1f m / %d s / %d / %d" % [float(expected.lengthM), int(expected.seconds), int(expected.nodes), int(expected.floorChanges)]
		var walk: Dictionary = row.get("walk", {})
		var walked := "did not walk"
		var tolerance := "-"
		var stopped := "-"
		var blocks := "-"
		var levels := "-"
		var miss := "-"
		var seconds := "-"
		var verdict := "no route"
		if row.has("doc"):
			verdict = "match"
			if not walk.is_empty():
				walked = "%.1f m / %.1f m" % [float(walk.walked_3d), float(walk.walked_flat)]
				tolerance = "±%.1f m" % maxf(LENGTH_TOLERANCE_M, float(expected.lengthM) * LENGTH_TOLERANCE_FRACTION)
				var stopped_at := int(walk.stopped_at)
				stopped = "point %d%s" % [stopped_at, " (known)" if KNOWN_BLOCKS.has(str(row.label)) else ""] if stopped_at >= 0 else "no"
				blocks = str(walk.blocks)
				levels = "%d / %d" % [int(walk.levels), int(expected.floorChanges)]
				miss = ("%.2f m" % float(walk.miss)) if stopped_at < 0 else "-"
				seconds = "%.0f s" % float(walk.seconds)
		lines.append("| %s | `%s` -> `%s` | %s | %s | %s | %s | %s | %s | %s | %s | %s |" % [row.label, row.from, row.to, golden, verdict, walked, tolerance, stopped, blocks, levels, miss, seconds])
	lines.append("")
	if not KNOWN_BLOCKS.is_empty():
		lines.append("### Known blocks")
		lines.append("")
		for label in KNOWN_BLOCKS.keys():
			var record: Dictionary = KNOWN_BLOCKS[label]
			lines.append("- **%s**: the strict replay stops at polyline point %d. The walker's body (radius %.1f m) is refused by"
				% [label, int(record.point), Walker.RADIUS])
			lines.append("  `%s`, a collision-only proxy that the verified edge `%s` passes %.2f m from — inside the body radius."
				% [str(record.collider), str(record.edge), float(record.offset_m)])
			lines.append("  A player slides along it and the browser's free-walk spec nudges past; a strict replay cannot. The line is")
			lines.append("  the problem, not the walker: a probe 0.2 m west of the passage walks its whole length. This is a station-data")
			lines.append("  finding for the lead (shift the guide line or check the proxy), not accepted quality.")
		lines.append("")
	lines.append("## How the walk numbers are made")
	lines.append("")
	lines.append("- **Walked length**: summed 3D distance the walker's feet travel while following the route polyline waypoint")
	lines.append("  by waypoint (a waypoint is reached within %.1f m). The tolerance is `max(%.1f m, %.0f%% of the route)`:" % [WAYPOINT_REACH, LENGTH_TOLERANCE_M, LENGTH_TOLERANCE_FRACTION * 100.0])
	lines.append("  cutting each corner by up to the reach at the polyline's turning points, plus the height damping on stairs,")
	lines.append("  can only shorten the walked path. A route outside the band is a finding, not tolerance noise.")
	lines.append("- **Stopped**: a leg that makes no horizontal progress for %d steps (%.0f s) or that exceeds twice its" % [STALL_STEPS, STALL_STEPS * DT])
	lines.append("  straight-line walking time plus %d steps. The known set is listed above; anything else fails the test." % LEG_BUDGET_STEPS)
	lines.append("- **Body-block episodes**: runs of steps the walker's own body test (`bodyBlock`: radius %.1f m, rays at %.1f / %.1f m)"
		% [Walker.RADIUS, Walker.BODY_HEIGHTS[0], Walker.BODY_HEIGHTS[1]])
	lines.append("  refused. Slide moves along the surface the walker hit are not blocks.")
	lines.append("- **Floor changes**: every sample of the walker's own height is put in the band of the station floor whose")
	lines.append("  elevation is nearest (`floorChanges` counts graph floor transitions, so this is an independent observation")
	lines.append("  of the same thing, not a copy of the route). Height damping lags a stair by ~0.2 m, far inside half of the")
	lines.append("  4.6 m separation between this station's floors.")
	lines.append("- **Walk time**: steps at the web's walk speed %.2f m/s (60 Hz fixed step); reported, not asserted." % Walker.WALK)
	lines.append("")
	var text := "\n".join(lines) + "\n"
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
