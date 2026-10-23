extends SceneTree
## Headless checks of G-3 (search bridge, route ribbon, step highlighting, guided walk, HUD state).
## Usage: --script res://tests/run_guide_tests.gd
## Runs the real TypeScript CLIs through OS.execute (pnpm tsx), so it needs the repo's node_modules and takes a few seconds
## per call. Golden search vectors: packages/godot/src/search-goldens.json.

const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")
const Ribbon = preload("res://addons/gteki/gteki_ribbon.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Hud = preload("res://hq/hq_guide.gd")
const QUERIES_PER_STATION := 4

var checks := 0
var failures: Array[String] = []
var bridge := Bridge.new()


func _initialize() -> void:
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		printerr("FAIL: ", message)


func run() -> void:
	check(not bridge.repo_root.is_empty(), "repo root found (%s)" % bridge.repo_root)
	test_search()
	test_ikebukuro_route()
	test_shinjuku_symbolic()
	test_rides()
	test_failures()
	await test_hud()
	await test_ride_hud()
	await test_ride_refusal_hud()
	await test_ride_landing()
	finish()


func goldens() -> Dictionary:
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(bridge.repo_root.path_join("packages/godot/src/search-goldens.json")))
	return parsed if parsed is Dictionary else {}


# (1) The bridge returns the TypeScript ranking for golden queries on both stations.
func test_search() -> void:
	var data := goldens()
	check(data.has("queries"), "search goldens load")
	for station in ["ikebukuro", "shinjuku"]:
		var list: Array = data.queries.get(station, [])
		check(list.size() >= QUERIES_PER_STATION, "%s: goldens present" % station)
		for i in mini(QUERIES_PER_STATION, list.size()):
			var golden: Dictionary = list[i]
			var found := bridge.search(station, golden.query, 8)
			check(found.ok, "%s: search \"%s\" runs: %s" % [station, golden.query, found.get("error", "")])
			if not found.ok:
				continue
			check(found.hits.size() >= golden.top.size(), "%s: \"%s\" returns at least the golden hits" % [station, golden.query])
			var ids: Array = []
			for hit in found.hits.slice(0, golden.top.size()):
				ids.append(hit.poiId)
			var want: Array = []
			for top in golden.top:
				want.append(top.poiId)
			check(ids == want, "%s: \"%s\" top hits %s match golden %s" % [station, golden.query, str(ids), str(want)])
			check(found.hits[0].has("routable") and found.hits[0].score == golden.top[0].score, "%s: \"%s\" top score is the golden %s" % [station, golden.query, str(golden.top[0].score)])
		var loaded := bridge.load_index(station)
		check(loaded.ok, "%s: search index loads: %s" % [station, loaded.get("error", "")])
		if loaded.ok and not list.is_empty():
			var first: String = list[0].top[0].poiId
			check(loaded.index.entries.has(first), "%s: index has %s" % [station, first])
			check(Bridge.poi_name(loaded.index, first, "ja") != first or Bridge.poi_name(loaded.index, first, "en") != first, "%s: %s has a display name" % [station, first])


# (2) Ikebukuro JR Central Gate 2 -> Exit 35: ribbon vertices follow the polyline, no symbolic heights.
func test_ikebukuro_route() -> void:
	var answer := bridge.route("ikebukuro", "jr-central-gate-2", "exit-35", true, true)
	check(answer.ok, "ikebukuro: POI route runs: %s" % answer.get("error", ""))
	if not answer.ok:
		return
	var guide := Guide.new()
	check(guide.load_doc(answer.doc), "ikebukuro: route loads: %s" % str(guide.issues))
	var count: int = answer.doc.polyline.size()
	check(guide.points.size() == count and count >= 2, "ikebukuro: %d polyline points kept" % count)
	check(not guide.symbolic, "ikebukuro: heights are surveyed, route is not symbolic")
	var ribbon = Ribbon.build(guide)
	check(ribbon != null, "ikebukuro: ribbon builds")
	if ribbon == null:
		return
	var arrays: Array = ribbon.mesh.surface_get_arrays(0)
	check(ribbon.vertex_count == 2 * count and arrays[Mesh.ARRAY_VERTEX].size() == 2 * count, "ikebukuro: ribbon has 2 vertices per polyline point (%d for %d)" % [ribbon.vertex_count, count])
	check(ribbon.mesh.get_surface_count() == 1 and not ribbon.has_symbolic(), "ikebukuro: a single solid surface")
	var lifted := true
	for i in count:
		var mid: Vector3 = (arrays[Mesh.ARRAY_VERTEX][2 * i] + arrays[Mesh.ARRAY_VERTEX][2 * i + 1]) * 0.5
		var expect := guide.points[i] + Vector3(0, Ribbon.LIFT, 0)
		lifted = lifted and mid.distance_to(expect) < 0.001
	check(lifted, "ikebukuro: ribbon runs LIFT above the polyline points in renderer coordinates")
	check(abs(guide.total() - float(answer.doc.result.totalLengthM)) < 3.0, "ikebukuro: polyline length %.1f is near the router's %.1f" % [guide.total(), float(answer.doc.result.totalLengthM)])
	check(guide.facts().any(func(f): return f[0] == "evidenceCheckedDate") and guide.facts().any(func(f): return f[0] == "unknowns"), "ikebukuro: freshness and unknowns are passed through")
	# Step highlight: first instruction at the start, last at the end, monotonic in between.
	check(guide.instruction_at(0.0, "en") == 0 and guide.instruction_at(guide.total(), "ja") == guide.instructions.ja.size() - 1, "ikebukuro: highlight starts at the first step and ends at the last")
	var last := 0
	var monotonic := true
	for k in 100:
		var i := guide.instruction_at(guide.total() * k / 99.0, "en")
		monotonic = monotonic and i >= last
		last = i
	check(monotonic, "ikebukuro: highlighted step never goes backwards along the route")
	# (4) Guided walk reaches the goal within 0.5 m (no collisions, web stepGuide speed).
	var walker := Walker.new()
	root.add_child(walker)
	guide.start_guide(0.0)
	var steps := 0
	while not guide.arrived and steps < 20000:
		var sampled := guide.advance(1.0 / 60.0)
		walker.global_position = sampled.position
		steps += 1
	var miss := walker.global_position.distance_to(guide.points[count - 1])
	check(guide.arrived and miss < 0.5, "ikebukuro: guided walk arrives %.3f m from the goal after %d ticks (%.0f s)" % [miss, steps, steps / 60.0])
	check(abs(steps / 60.0 - guide.total() / Guide.GUIDE_SPEED) < 1.0, "ikebukuro: guided walk takes length/speed")
	walker.queue_free()
	ribbon.instance.free()


# Shinjuku platform:oedo -> exit:1 has no surveyed heights: flagged symbolic, dashed surface only.
func test_shinjuku_symbolic() -> void:
	var answer := bridge.route("shinjuku", "poi:platform:oedo", "poi:exit:1", true, true)
	check(answer.ok, "shinjuku: POI route runs: %s" % answer.get("error", ""))
	if not answer.ok:
		return
	var guide := Guide.new()
	check(guide.load_doc(answer.doc) and guide.symbolic, "shinjuku: route is flagged symbolic")
	var ribbon = Ribbon.build(guide)
	check(ribbon != null and ribbon.has_symbolic() and ribbon.vertex_count == 2 * guide.points.size(), "shinjuku: ribbon has a dashed symbolic surface")
	if ribbon != null:
		check(ribbon.mesh.get_surface_count() == 1 and ribbon.surface_symbolic[0], "shinjuku: every segment is in the symbolic surface")
		ribbon.instance.free()


# (5) #287: a lift ride is read from the route itself — Shinjuku S4's one shaft — and only from an `elevator` step.
func test_rides() -> void:
	var answer := bridge.route("shinjuku", "poi:exit:3", "poi:exit:6", true, true)
	check(answer.ok, "shinjuku S4: route runs: %s" % answer.get("error", ""))
	if not answer.ok:
		return
	var guide := Guide.new()
	check(guide.load_doc(answer.doc), "shinjuku S4: route loads: %s" % str(guide.issues))
	check(guide.rides.size() == 1, "shinjuku S4: the route states exactly one lift ride (%d)" % guide.rides.size())
	if guide.rides.size() != 1:
		return
	var ride: Dictionary = guide.rides[0]
	check(str(answer.doc.result.steps[int(ride.step)].get("mode", "")) == "elevator", "shinjuku S4: the ride is on the route's elevator step %d" % int(ride.step))
	check(float(ride.plan_m) < Guide.RIDE_MAX_FLAT and absf(float(ride.drop)) > Guide.RIDE_MIN_DROP, "shinjuku S4: the shaft is %.3f m wide with a %.1f m drop (gates %.1f / %.1f)" % [float(ride.plan_m), absf(float(ride.drop)), Guide.RIDE_MAX_FLAT, Guide.RIDE_MIN_DROP])
	check(absf(float(ride.plan_m) - 0.473) < 0.002 and absf(absf(float(ride.drop)) - 7.8) < 0.01, "shinjuku S4: the measured shaft is the documented %.3f m wide / %.1f m drop" % [float(ride.plan_m), absf(float(ride.drop))])
	# Offered on the ride's own step and within reach, nowhere else.
	var near: Vector3 = ride.from + Vector3(0.3, 0.0, 0.0)
	check(not guide.ride_at(near, int(ride.step)).is_empty(), "shinjuku S4: within 1 m of the shaft start, on its step, the ride is offered")
	check(guide.ride_at(ride.from + Vector3(2.0, 0.0, 0.0), int(ride.step)).is_empty(), "shinjuku S4: 2 m from the shaft start the ride is not offered")
	check(guide.ride_at(near, int(ride.step) + 1).is_empty(), "shinjuku S4: off the ride's step the ride is not offered")
	check(guide.ride_at(near, int(ride.step) - 1).is_empty(), "shinjuku S4: the step before the ride does not offer it")
	# The step progression: on the last RIDE_TRIGGER of the approach that ends at the shaft the ride's step is already
	# the active one — the same distance the ride is offered over — so a walker stopped short of the edge has the lift
	# showing where it stands; further back the walk step keeps the highlight (#287 review).
	var walk_step := int(guide.step_index[int(ride.from_point)])
	check(walk_step != int(ride.step), "shinjuku S4: the step that ends at the shaft's start is the walk step (%d), not the ride's (%d)" % [walk_step, int(ride.step)])
	check(guide.step_at(float(ride.from_s) - 0.3) == int(ride.step), "shinjuku S4: 0.3 m short of the shaft the ride's step is the active one")
	check(guide.step_at(float(ride.from_s) - 0.7) == int(ride.step), "shinjuku S4: 0.7 m short of the shaft, inside the 1.0 m offer, the ride's step is the active one")
	check(guide.step_at(float(ride.from_s) + 0.3) == int(ride.step), "shinjuku S4: on the shaft itself the ride's step is the active one")
	if float(ride.from_s) > Guide.RIDE_TRIGGER + 0.1:
		check(guide.step_at(float(ride.from_s) - (Guide.RIDE_TRIGGER + 0.1)) == walk_step, "shinjuku S4: %.1f m short of the shaft the highlight is still on the walk step (%d)" % [Guide.RIDE_TRIGGER + 0.1, guide.step_at(float(ride.from_s) - (Guide.RIDE_TRIGGER + 0.1))])
	# A guided walk started strictly inside the shaft (a teleported or hand-edited position) backs up to the shaft's
	# start, where the lift is offered, instead of freezing inside the span with no prompt (#290 review).
	var inside := Guide.new()
	inside.load_doc(answer.doc)
	inside.start_guide(float(ride.from_s) + 0.3)
	check(is_equal_approx(inside.s, float(ride.from_s)), "shinjuku S4: a guided walk started inside the shaft backs up to its start (s=%.2f)" % inside.s)
	check(not inside.ride_near(ride.from, inside.s).is_empty(), "shinjuku S4: at the shaft's start the lift is offered, so the walk is not stranded")
	# A route with no elevator step states no rides (Ikebukuro's W1 is all walk).
	var flat := bridge.route("ikebukuro", "jr-central-gate-2", "exit-35", true, true)
	var flat_guide := Guide.new()
	check(flat.ok and flat_guide.load_doc(flat.doc) and flat_guide.rides.is_empty(), "ikebukuro: a route with no elevator step states no rides")
	# The mode gate on S4 itself: the same shaft geometry relabelled `walk` is no ride, so a vertical span nobody calls a
	# lift can never be ridden.
	var relabelled: Dictionary = answer.doc.duplicate(true)
	for step in relabelled.result.steps:
		if str(step.get("mode", "")) == "elevator":
			step.mode = "walk"
	var no_lift := Guide.new()
	check(no_lift.load_doc(relabelled) and no_lift.rides.is_empty(), "shinjuku S4: the same shaft under walk steps is no ride (the mode gate)")
	check(no_lift.ride_at(near, int(ride.step)).is_empty(), "shinjuku S4: with the elevator relabelled, standing on the shaft offers nothing")


## The synthetic S4-shaped route the HUD tests share: a flat walk entry, a 0.473 m wide 7.8 m shaft on an `elevator`
## step, a flat walk exit.
func ride_doc() -> Dictionary:
	return {
		"contract": "gteki.route/0.1",
		"result": {"ok": true, "totalLengthM": 5.3, "estimatedSeconds": 4, "floorChanges": 1, "steps": [
			{"edgeId": "a", "mode": "walk"},
			{"edgeId": "b", "mode": "elevator"},
			{"edgeId": "c", "mode": "walk"},
		]},
		"polyline": [
			{"renderer": [0.0, 0.0, 0.0], "zKnown": false, "stepIndex": 0},
			{"renderer": [1.2, 0.0, 0.0], "zKnown": false, "stepIndex": 0},
			{"renderer": [1.673, -7.8, 0.0], "zKnown": false, "stepIndex": 1},
			{"renderer": [2.9, -7.8, 0.0], "zKnown": false, "stepIndex": 2},
			{"renderer": [5.0, -7.8, 0.0], "zKnown": false, "stepIndex": 2},
		],
		"instructions": {
			"ja": [{"stepIndexes": [0], "text": "出発"}, {"stepIndexes": [1], "text": "エレベーターで下へ"}, {"stepIndexes": [2], "text": "到着"}],
			"en": [{"stepIndexes": [0], "text": "Start"}, {"stepIndexes": [1], "text": "Take the elevator down"}, {"stepIndexes": [2], "text": "Arrive"}],
		},
	}


## A stub hq for the HUD tests: the walker, a camera that records where it was put, and no spawn points.
func ride_stub(walker: Node, camera: Node) -> Node3D:
	var hq_script := GDScript.new()
	hq_script.source_code = "extends Node3D\nvar walker\nvar camera\nvar current\n"
	hq_script.reload()
	var stub := Node3D.new()
	stub.set_script(hq_script)
	stub.walker = walker
	stub.camera = camera
	stub.current = {"spawn_points": []}
	root.add_child(stub)
	return stub


## A stub walker for the HUD flow: the real Walker with only the landing stubbed (there is no snapshot under the
## synthetic exit to accept ground from), set down `offset` forward of the shaft's exit vertex as the real one is.
func ride_walker(landing: Vector3) -> CharacterBody3D:
	var walker_script := GDScript.new()
	walker_script.source_code = "extends \"res://addons/gteki/gteki_walker.gd\"\nvar rides: Array[Vector3] = []\nvar refused := false\nfunc ride_to(target: Vector3, _forward: Vector3) -> bool:\n\tif refused:\n\t\treturn false\n\trides.append(target)\n\tglobal_position = target + Vector3(%f, %f, %f)\n\tbody_yaw = yaw\n\treturn true\n" % [landing.x, landing.y, landing.z]
	walker_script.reload()
	var walker := CharacterBody3D.new()
	walker.set_script(walker_script)
	return walker


## A stub follow camera that remembers where it was last put and whether the move was a snap.
func ride_camera() -> Camera3D:
	var camera_script := GDScript.new()
	camera_script.source_code = "extends Camera3D\nvar last_position := Vector3.ZERO\nvar last_snap := false\nvar follows := 0\nfunc follow(walker: Node3D, _dt: float, snap: bool = false) -> void:\n\tfollows += 1\n\tlast_snap = snap\n\tlast_position = walker.global_position\n"
	camera_script.reload()
	var camera := Camera3D.new()
	camera.set_script(camera_script)
	return camera


# HUD ride flow (#287 review) with a stub hq and a stub walker that records the landing, on the S4-shaped route: guided
# walking stops at the shaft and waits for E, the camera is put on the landing while the screen is black, the guide
# resumes from the landing (never the exit vertex over the opening) and guided walking carries on to the goal.
func test_ride_hud() -> void:
	var doc := ride_doc()
	var camera := ride_camera()
	var walker := ride_walker(Vector3(0.75, 0.0, 0.0))
	var stub := ride_stub(walker, camera)
	stub.add_child(walker)
	stub.add_child(camera)
	var hud := Hud.new()
	stub.add_child(hud)
	hud.setup(stub)
	hud.apply_answer({"ok": true, "doc": doc})
	check(hud.guide.ok and hud.guide.rides.size() == 1, "hud ride: the route states one ride (%d)" % hud.guide.rides.size())
	if not hud.guide.ok or hud.guide.rides.size() != 1:
		stub.queue_free()
		return
	var ride: Dictionary = hud.guide.rides[0]
	walker.global_position = Vector3(0.0, 0.0, 0.0)
	walker.yaw = 0.42
	hud.set_guided(true)
	# Two metres short of the shaft, on the entry step: nothing is offered.
	hud.guide.start_guide(0.0)
	walker.global_position = Vector3(-0.8, 0.0, 0.0)
	hud.update_ride_prompt()
	check(hud._prompt.text.is_empty() and hud._ride.is_empty(), "hud ride: 2 m before the shaft nothing is offered")
	check(not hud.ride_pressed(), "hud ride: with nothing offered, the ride key does nothing")
	# Guided motion carries the avatar to the shaft and stops there: it never passes a lift the route states, and only
	# E gets past it (#287 review).
	hud.guide.start_guide(0.0)
	for _k in 300:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	var waiting := walker.global_position
	check(is_equal_approx(hud.guide.s, float(ride.from_s)), "hud ride: guided walking stops at the shaft's start (s=%.2f, shaft at %.2f)" % [hud.guide.s, float(ride.from_s)])
	check(waiting.is_equal_approx(hud.guide.sample(float(ride.from_s)).position), "hud ride: the avatar waits at the shaft (%s)" % str(waiting))
	check(walker.rides.is_empty(), "hud ride: guided motion never rides the lift by itself (%s)" % str(walker.rides))
	check(hud._prompt.text == Hud.RIDE_PROMPT and not hud._ride.is_empty(), "hud ride: at the shaft the prompt shows (%s)" % hud._prompt.text)
	for _k in 60:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(walker.global_position.distance_to(waiting) < 1e-4 and is_equal_approx(hud.guide.s, float(ride.from_s)), "hud ride: without E the avatar waits at the shaft (moved %.3f m)" % walker.global_position.distance_to(waiting))
	# The real key path: an E press starts it; a second press during the fade does nothing.
	var key := InputEventKey.new()
	key.keycode = KEY_E
	key.pressed = true
	hud._unhandled_input(key)
	check(hud._ride_phase == "out", "hud ride: the E key starts the ride (%s)" % hud._ride_phase)
	check(not hud.ride_pressed(), "hud ride: a second press during the fade is ignored")
	var yaw_before: float = walker.yaw
	check(hud.physics(Hud.RIDE_FADE, Vector2.ZERO), "hud ride: a ride in progress owns the tick")
	check(walker.rides.size() == 1 and walker.rides[0].is_equal_approx(hud.guide.points[2]), "hud ride: the landing starts from the shaft's exit (%s)" % str(walker.rides))
	var landing := hud.guide.points[2] + Vector3(0.75, 0.0, 0.0)
	check(walker.global_position.is_equal_approx(landing), "hud ride: the walker's feet are on the landing, 0.75 m forward of the exit (%s)" % str(walker.global_position))
	check(is_equal_approx(hud.guide.s, float(hud.guide.cumulative[2]) + 0.75), "hud ride: the guide resumes from the landing, not the exit vertex (s=%.2f)" % hud.guide.s)
	check(hud.guide.s <= float(ride.to_s) + Walker.RIDE_LANDING_REACH + 1e-6, "hud ride: the resume point is never more than the landing's reach past the exit (s=%.2f)" % hud.guide.s)
	# The camera is on the landing before the fade-in starts, so the screen never fades in on the departure floor and then
	# jumps a floor (#287 review).
	check(camera.last_snap and camera.last_position.is_equal_approx(walker.global_position), "hud ride: the camera is snapped to the landing while black (%s, snap %s)" % [str(camera.last_position), str(camera.last_snap)])
	check(is_equal_approx(walker.yaw, yaw_before) and is_equal_approx(walker.body_yaw, yaw_before), "hud ride: the yaw is kept through the ride")
	check(hud._ride_phase == "in" and hud._fade.color.a > 0.99, "hud ride: the fade back in starts from black")
	hud.physics(Hud.RIDE_FADE, Vector2.ZERO)
	check(hud._ride_phase.is_empty() and is_zero_approx(hud._fade.color.a) and hud._prompt.text.is_empty(), "hud ride: the fade in clears the ride and the prompt")
	# Guided walking continues from the landing, never back over the exit vertex, and reaches the goal.
	hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(walker.global_position.distance_to(hud.guide.points[2]) > 0.5, "hud ride: the first guided tick after the ride is past the exit vertex, not on it (%s)" % str(walker.global_position))
	check(walker.global_position.distance_to(landing) < 0.1, "hud ride: the first guided tick continues from the landing (%s)" % str(walker.global_position))
	var ticks := 0
	while not hud.guide.arrived and ticks < 600:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
		ticks += 1
	check(hud.guide.arrived and walker.global_position.is_equal_approx(hud.guide.points[hud.guide.points.size() - 1]), "hud ride: guided walking carries on from the landing to the goal after %d ticks" % ticks)
	# Toggling guided walking back on from the departure floor offers the same lift again: a ride taken earlier in the
	# session does not count as ridden for a guide started behind it (#290 review).
	walker.global_position = hud.guide.points[0]
	hud.set_guided(true)
	for _k in 300:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(is_equal_approx(hud.guide.s, float(ride.from_s)), "hud ride: re-enabled guided walking clamps at the shaft again (s=%.2f)" % hud.guide.s)
	check(hud._prompt.text == Hud.RIDE_PROMPT, "hud ride: the re-offered lift's prompt shows (%s)" % hud._prompt.text)
	check(hud.guide.ridden.is_empty() or not hud.guide.ridden.has(int(ride.step)), "hud ride: the shaft ahead of the new start counts as not ridden (%s)" % str(hud.guide.ridden))
	stub.queue_free()
	await process_frame


# A ride whose landing nothing accepts (#287 review): the walker stays where it is, the HUD says why, and guided motion
# stays at the shaft instead of carrying the avatar past the lift.
func test_ride_refusal_hud() -> void:
	var camera := ride_camera()
	var walker := ride_walker(Vector3.ZERO)
	walker.refused = true
	var stub := ride_stub(walker, camera)
	stub.add_child(walker)
	stub.add_child(camera)
	var hud := Hud.new()
	stub.add_child(hud)
	hud.setup(stub)
	hud.apply_answer({"ok": true, "doc": ride_doc()})
	if not hud.guide.ok or hud.guide.rides.size() != 1:
		check(false, "hud refusal: the route states one ride")
		stub.queue_free()
		return
	var ride: Dictionary = hud.guide.rides[0]
	walker.global_position = hud.guide.points[0]
	hud.set_guided(true)
	for _k in 300:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(is_equal_approx(hud.guide.s, float(ride.from_s)) and hud._prompt.text == Hud.RIDE_PROMPT, "hud refusal: guided motion waits at the shaft with the prompt showing")
	var before := walker.global_position
	var key := InputEventKey.new()
	key.keycode = KEY_E
	key.pressed = true
	hud._unhandled_input(key)
	hud.physics(Hud.RIDE_FADE, Vector2.ZERO)
	check(walker.global_position.is_equal_approx(before), "hud refusal: a refused landing leaves the walker unmoved (%s)" % str(walker.global_position))
	check(hud.status_text.contains("not taken"), "hud refusal: the HUD says the lift was not taken (%s)" % hud.status_text)
	check(walker.rides.is_empty(), "hud refusal: nothing was landed")
	hud.physics(Hud.RIDE_FADE, Vector2.ZERO)
	for _k in 120:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(is_equal_approx(hud.guide.s, float(ride.from_s)) and walker.global_position.is_equal_approx(before), "hud refusal: after the failed ride guided motion still does not pass the shaft (s=%.2f)" % hud.guide.s)
	check(hud._prompt.text == Hud.RIDE_PROMPT, "hud refusal: the lift is offered again so the player can retry")
	stub.queue_free()
	await process_frame


## A static box on a physics layer, for the landing tests: the only station truth the synthetic world has.
func add_box(center: Vector3, size: Vector3, layer: int) -> StaticBody3D:
	var body := StaticBody3D.new()
	body.collision_layer = layer
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = size
	shape.shape = box
	body.add_child(shape)
	body.position = center
	root.add_child(body)
	return body


## The landing search's rules (#287 review) in a synthetic physics world: the vertex is over the opening, so the feet
## go straight ahead first, on the exit's own level, never behind the shaft, never across a wall and never into a wall;
## with nothing found the ride is refused and the walker does not move.
func test_ride_landing() -> void:
	var walker := Walker.new()
	root.add_child(walker)
	var forward := Vector3(1.0, 0.0, 0.0)
	# A: ground ahead on the exit's level, starting 2.0 m from the vertex (its edge is a body radius from it).
	add_box(Vector3(3.5, -8.0, 0.0), Vector3(3.0, 0.4, 4.0), Scene.GROUND_LAYER)
	# B: ground only behind the shaft.
	add_box(Vector3(-2.0, -8.0, 100.0), Vector3(6.0, 0.4, 4.0), Scene.GROUND_LAYER)
	# C: ground ahead but 0.4 m below the exit's level.
	add_box(Vector3(3.5, -8.4, 200.0), Vector3(3.0, 0.4, 4.0), Scene.GROUND_LAYER)
	# D: ground ahead on the exit's level, with a collider between the vertex and it at body height.
	add_box(Vector3(3.5, -8.0, 300.0), Vector3(3.0, 0.4, 4.0), Scene.GROUND_LAYER)
	add_box(Vector3(1.925, -7.2, 300.0), Vector3(0.05, 1.4, 2.0), Scene.COLLIDER_LAYER)
	# E: ground ahead and clear, but a wall within the body's radius at the landing.
	add_box(Vector3(3.5, -8.0, 400.0), Vector3(3.0, 0.4, 4.0), Scene.GROUND_LAYER)
	await physics_frame
	await physics_frame
	var landing: Variant = walker.ride_landing(Vector3(1.673, -7.8, 0.0), forward)
	check(landing != null, "landing: ground ahead on the exit's level is found (%s)" % str(landing))
	if landing != null:
		var point: Vector3 = landing
		var flat := Vector2(point.x - 1.673, point.z)
		check(is_equal_approx(point.y, -7.8), "landing: the feet are on the exit's own level (%.2f m)" % point.y)
		check(absf(flat.length() - 0.75) < 0.01, "landing: the landing is 0.75 m forward, where the body first fits (%.2f m)" % flat.length())
		check(flat.normalized().dot(Vector2(forward.x, forward.z)) > 0.999, "landing: straight ahead is tried first, so the landing is on the route's continuation")
	check(walker.ride_landing(Vector3(1.673, -7.8, 100.0), forward) == null, "landing: ground only behind the shaft is no landing (outside the cone)")
	check(walker.ride_landing(Vector3(1.673, -7.8, 200.0), forward) == null, "landing: ground 0.4 m off the exit's level is no landing (the level gate)")
	check(walker.ride_landing(Vector3(1.673, -7.8, 300.0), forward) == null, "landing: a wall between the vertex and the ground refuses the ride")
	# The same spot with a sidecar wall within RADIUS of it: the body does not fit (ENU y = -renderer z).
	walker.set_walls([{"a": Vector2(2.5, -398.0), "b": Vector2(2.5, -402.0), "zMin": -7.8, "zMax": -6.0}])
	check(walker.ride_landing(Vector3(1.673, -7.8, 400.0), forward) == null, "landing: a wall within the body's radius refuses the landing (body fit)")
	walker.set_walls([])
	walker.global_position = Vector3(0.0, 0.0, 100.0)
	var before := walker.global_position
	check(not walker.ride_to(Vector3(1.673, -7.8, 100.0), forward), "landing: a ride with no landing is refused")
	check(walker.global_position.is_equal_approx(before), "landing: a refused ride leaves the walker where it was")
	walker.queue_free()
	await process_frame


# (3) Failure states: a router "no route" answer and a broken bridge both leave no line and no fake result.
func test_failures() -> void:
	var answer := bridge.route("ikebukuro", "jr-central-gate-2", "poi:does-not-exist", true, true)
	check(not answer.ok and answer.has("doc") and answer.has("reason"), "negative route: router answers with a reason (%s)" % answer.get("error", ""))
	var guide := Guide.new()
	check(not guide.load_doc(answer.doc), "negative route: not loaded")
	check(guide.reason == "unknown_goal" and guide.points.is_empty() and Ribbon.build(guide) == null, "negative route: reason %s, no polyline, no ribbon" % guide.reason)
	var broken := Bridge.new()
	broken.pnpm_bin = "/nonexistent/pnpm"
	var search := broken.search("ikebukuro", "35")
	check(not search.ok and not search.has("hits") and "Cannot launch pnpm" in search.error, "broken bridge: search fails with an error and no hits (%s)" % search.get("error", ""))
	var route := broken.route("ikebukuro", "g_jr_c2", "x35")
	check(not route.ok and not route.has("doc"), "broken bridge: route fails with no document")


# HUD state with a stub in place of hq.gd.
func test_hud() -> void:
	var stub_script := GDScript.new()
	stub_script.source_code = "extends Node3D\nvar walker\nvar camera\nvar current\n"
	stub_script.reload()
	var stub := Node3D.new()
	stub.set_script(stub_script)
	var walker := Walker.new()
	stub.add_child(walker)
	stub.walker = walker
	stub.camera = null
	stub.current = {"spawn_points": [{"position": Vector3(-14, 27.91, -78.5), "node_id": "g_jr_c2", "label": "JR Central Gate 2"}]}
	root.add_child(stub)
	var hud := Hud.new()
	stub.add_child(hud)
	hud.setup(stub)
	hud.station_changed("ikebukuro")
	check(hud.index.get("entries", {}).size() > 0, "hud: index loaded")
	hud.do_search("35")
	check(hud.hits.size() > 0 and hud._results.item_count == hud.hits.size(), "hud: results listed (%d)" % hud.hits.size())
	var disabled := 0
	var mismatch := 0
	for i in hud.hits.size():
		disabled += 1 if hud._results.is_item_disabled(i) else 0
		mismatch += 1 if hud._results.is_item_disabled(i) == hud.hits[i].routable else 0
	check(mismatch == 0, "hud: non-routable hits are disabled, routable ones are not (%d disabled)" % disabled)
	check(hud.row_text(hud.hits[0]).contains("routable") and hud.row_text(hud.hits[0]).contains("|"), "hud: row shows name, category, floor, routable marker: %s" % hud.row_text(hud.hits[0]))
	hud.set_lang("en")
	var en_row: String = hud.row_text(hud.hits[0])
	hud.set_lang("ja")
	check(en_row != hud.row_text(hud.hits[0]), "hud: language toggle changes names")
	# Start from the nearest spawn (user-chosen default), goal exit-35.
	hud.goal_poi = "exit-35"
	hud.compute_route()
	check(hud.guide.ok and hud.ribbon != null and hud.ribbon.instance.get_parent() == stub, "hud: spawn-start route draws a ribbon (%s)" % hud.status_text)
	check(hud._steps.item_count == hud.guide.instructions.ja.size() and hud._steps.item_count > 0, "hud: step list shows the instructions")
	hud.set_lang("en")
	check(hud._steps.get_item_text(1).contains(hud.guide.instructions.en[1].text), "hud: step list switches language")
	check(hud._facts.text.contains("evidenceCheckedDate") and hud._facts.text.contains("hours: UNKNOWN"), "hud: freshness and hours UNKNOWN shown")
	check(hud._symbolic_note.text.is_empty(), "hud: no symbolic note for surveyed heights")
	# Walker at the start highlights step 0; guided walk toggle, then a movement key hands control back.
	walker.global_position = hud.guide.points[0]
	hud.update_highlight(true)
	check(hud._steps.get_selected_items() == PackedInt32Array([0]), "hud: step 0 highlighted at the start")
	walker.global_position = hud.guide.points[hud.guide.points.size() - 1]
	hud.update_highlight(true)
	check(hud._steps.get_selected_items() == PackedInt32Array([hud._steps.item_count - 1]), "hud: last step highlighted at the goal")
	hud.set_guided(true)
	check(hud.guide.guiding and hud._guide_toggle.button_pressed, "hud: guided walk on")
	for i in 30:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
	check(hud.guide.s > 0.0 and walker.global_position.distance_to(hud.guide.sample(hud.guide.s).position) < 0.001, "hud: guided ticks move the avatar along the polyline (s=%.2f)" % hud.guide.s)
	var consumed: bool = hud.physics(1.0 / 60.0, Vector2(0, 1))
	check(not consumed and not hud.guide.guiding and not hud._guide_toggle.button_pressed, "hud: a movement key ends guided walking")
	# Shinjuku: symbolic note.
	hud.station_changed("shinjuku")
	hud.start_poi = "poi:platform:oedo"
	hud.goal_poi = "poi:exit:1"
	hud.compute_route()
	check(hud.guide.ok and hud.guide.symbolic and not hud._symbolic_note.text.is_empty(), "hud: symbolic heights are announced (%s)" % hud._symbolic_note.text)
	# Failure: reason shown, no ribbon, no steps.
	hud.goal_poi = "poi:does-not-exist"
	hud.compute_route()
	var ribbons := 0
	for child in stub.get_children():
		ribbons += 1 if child.name.begins_with("GTEkiRouteRibbon") and not child.is_queued_for_deletion() else 0
	check(not hud.guide.ok and hud.ribbon == null and ribbons == 0 and hud._steps.item_count == 0 and hud.status_text.contains("unknown_goal"), "hud: failed route shows its reason (%s) and no line" % hud.status_text)
	# Broken bridge: error shown, nothing drawn.
	hud.bridge.pnpm_bin = "/nonexistent/pnpm"
	hud.do_search("exit")
	check(hud.hits.is_empty() and hud.status_text.contains("Search failed"), "hud: bridge failure is reported, no results (%s)" % hud.status_text)
	stub.queue_free()
	await process_frame


func finish() -> void:
	print("\n%d checks, %d failures" % [checks, failures.size()])
	if failures.is_empty():
		print("PASS")
		quit(0)
	else:
		for failure in failures:
			printerr("  - ", failure)
		quit(1)
