extends SceneTree
## Headless checks of G-3 (search bridge, route ribbon, step highlighting, guided walk, HUD state).
## Usage: --script res://tests/run_guide_tests.gd
## Runs the real TypeScript CLIs through OS.execute (pnpm tsx), so it needs the repo's node_modules and takes a few seconds
## per call. Golden search vectors: packages/godot/src/search-goldens.json.

const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")
const Ribbon = preload("res://addons/gteki/gteki_ribbon.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
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
	# The step progression: on the approach that ends at the shaft the ride's step is already the active one, so a
	# walker stopped short of the edge has the lift showing where it stands.
	check(guide.step_at(float(ride.from_s) - 0.3) == int(ride.step), "shinjuku S4: on the approach to the shaft the ride's step is the active one")
	check(guide.step_at(float(ride.from_s) + 0.3) == int(ride.step), "shinjuku S4: on the shaft itself the ride's step is the active one")
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


# HUD ride flow (#287) with a stub hq and a stub walker that records the landing, on a small synthetic route shaped like
# S4: a flat elevator entry, a 0.473 m wide 7.8 m shaft, a flat exit.
func test_ride_hud() -> void:
	var doc := {
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
	var walker_script := GDScript.new()
	# A real Walker with only the landing stubbed: there is no snapshot under the synthetic exit to accept ground from.
	walker_script.source_code = "extends \"res://addons/gteki/gteki_walker.gd\"\nvar rides: Array[Vector3] = []\nfunc ride_to(target: Vector3, _forward: Vector3) -> bool:\n\trides.append(target)\n\tglobal_position = target\n\tbody_yaw = yaw\n\treturn true\n"
	walker_script.reload()
	var hq_script := GDScript.new()
	hq_script.source_code = "extends Node3D\nvar walker\nvar camera\nvar current\n"
	hq_script.reload()
	var stub := Node3D.new()
	stub.set_script(hq_script)
	var walker := CharacterBody3D.new()
	walker.set_script(walker_script)
	stub.add_child(walker)
	stub.walker = walker
	stub.camera = null
	stub.current = {"spawn_points": []}
	root.add_child(stub)
	var hud := Hud.new()
	stub.add_child(hud)
	hud.setup(stub)
	hud.apply_answer({"ok": true, "doc": doc})
	check(hud.guide.ok and hud.guide.rides.size() == 1, "hud ride: the route states one ride (%d)" % hud.guide.rides.size())
	if not hud.guide.ok or hud.guide.rides.size() != 1:
		stub.queue_free()
		return
	walker.global_position = Vector3(0.0, 0.0, 0.0)
	walker.yaw = 0.42
	hud.set_guided(true)
	# Two metres short of the shaft, on the entry step: nothing is offered.
	hud.guide.start_guide(0.0)
	walker.global_position = Vector3(-0.8, 0.0, 0.0)
	hud.update_ride_prompt()
	check(hud._prompt.text.is_empty() and hud._ride.is_empty(), "hud ride: 2 m before the shaft nothing is offered")
	check(not hud.ride_pressed(), "hud ride: with nothing offered, the ride key does nothing")
	# A player walking this route stops 0.3 m short of the shaft (the ground ends): the approach segment already carries
	# the ride's own elevator step, so the prompt shows at the place the player actually stands (#287 review).
	hud.guide.start_guide(float(hud.guide.cumulative[1]) - 0.3)
	walker.global_position = Vector3(0.9, 0.0, 0.0)
	check(hud.guide.step_at(hud.guide.s) == int(hud.guide.rides[0].step), "hud ride: 0.3 m short of the shaft, the ride's elevator step is the active one")
	hud.update_ride_prompt()
	check(hud._prompt.text == Hud.RIDE_PROMPT and not hud._ride.is_empty(), "hud ride: the prompt appears where a player stands when the ground ends (%s)" % hud._prompt.text)
	# The real key path: an E press starts it; a second press during the fade does nothing.
	var key := InputEventKey.new()
	key.keycode = KEY_E
	key.pressed = true
	hud._unhandled_input(key)
	check(hud._ride_phase == "out", "hud ride: the E key starts the ride (%s)" % hud._ride_phase)
	check(not hud.ride_pressed(), "hud ride: a second press during the fade is ignored")
	var yaw_before: float = walker.yaw
	check(hud.physics(Hud.RIDE_FADE, Vector2.ZERO), "hud ride: a ride in progress owns the tick")
	check(walker.rides.size() == 1 and walker.rides[0].is_equal_approx(hud.guide.points[2]), "hud ride: the landing is the shaft's exit (%s)" % str(walker.rides))
	check(walker.global_position.is_equal_approx(hud.guide.points[2]), "hud ride: the walker's feet are at the exit (%s)" % str(walker.global_position))
	check(is_equal_approx(hud.guide.s, float(hud.guide.cumulative[2])), "hud ride: the guide moves to the exit (s=%.2f)" % hud.guide.s)
	check(is_equal_approx(walker.yaw, yaw_before) and is_equal_approx(walker.body_yaw, yaw_before), "hud ride: the yaw is kept through the ride")
	check(hud._ride_phase == "in" and hud._fade.color.a > 0.99, "hud ride: the fade back in starts from black")
	hud.physics(Hud.RIDE_FADE, Vector2.ZERO)
	check(hud._ride_phase.is_empty() and is_zero_approx(hud._fade.color.a) and hud._prompt.text.is_empty(), "hud ride: the fade in clears the ride and the prompt")
	# Guided walking continues from the exit to the goal.
	var ticks := 0
	while not hud.guide.arrived and ticks < 600:
		hud.physics(1.0 / 60.0, Vector2.ZERO)
		ticks += 1
	check(hud.guide.arrived and walker.global_position.is_equal_approx(hud.guide.points[hud.guide.points.size() - 1]), "hud ride: guided walking carries on from the exit to the goal after %d ticks" % ticks)
	stub.queue_free()
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
