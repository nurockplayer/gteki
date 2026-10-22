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
	test_failures()
	await test_hud()
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
