extends CanvasLayer
## G-3 HUD and route display for the HQ client: search box, start picker, language toggle, route ribbon, step list and
## guided walk. Search and routing come from the TypeScript CLIs through gteki_bridge.gd; nothing is ranked or routed here.
## The start is always user-chosen (a POI from the results, or the nearest spawn point): the client never knows where the
## user really is.

const Bridge = preload("res://addons/gteki/gteki_bridge.gd")
const Guide = preload("res://addons/gteki/gteki_guide.gd")
const Ribbon = preload("res://addons/gteki/gteki_ribbon.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")

const PANEL_WIDTH := 520
const HIGHLIGHT_PERIOD := 0.25
const NEAR_PATH := 6.0
const LANGS := ["ja", "en"]
## A lift ride (#287) fades out, lands and fades in; the walker is standing still throughout.
const RIDE_FADE := 0.3
const RIDE_PROMPT := "E: ride the lift"

var hq: Node3D
var bridge := Bridge.new()
var guide := Guide.new()
var ribbon: Object
var station_id := ""
var index: Dictionary = {}
var lang := "ja"
var hits: Array = []
var goal_poi := ""
var start_poi := ""
var status_text := ""
var _since_highlight := 0.0
var snap_camera := false
var _syncing := false

var _lang_box: OptionButton
var _search: LineEdit
var _results: ItemList
var _start_label: Label
var _goal_label: Label
var _status: Label
var _symbolic_note: Label
var _facts: Label
var _steps: ItemList
var _guide_toggle: CheckButton
var _route_button: Button
var _prompt: Label
var _fade: ColorRect
## The ride being offered, and the fade state: "" (none), "out" (to black) or "in" (back).
var _ride: Dictionary = {}
var _ride_phase := ""
var _ride_left := 0.0


func setup(owner_hq: Node3D) -> void:
	hq = owner_hq
	layer = 10
	var theme := Theme.new()
	theme.default_font_size = 16
	var panel := PanelContainer.new()
	panel.theme = theme
	panel.position = Vector2(12, 12)
	panel.custom_minimum_size = Vector2(PANEL_WIDTH, 0)
	add_child(panel)
	var box := VBoxContainer.new()
	box.add_theme_constant_override("separation", 6)
	panel.add_child(box)

	var top := HBoxContainer.new()
	box.add_child(top)
	var title := Label.new()
	title.text = "GTEki"
	title.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	top.add_child(title)
	_lang_box = OptionButton.new()
	_lang_box.add_item("日本語")
	_lang_box.add_item("English")
	_lang_box.item_selected.connect(func(i: int) -> void: set_lang(LANGS[i]))
	top.add_child(_lang_box)

	var search_row := HBoxContainer.new()
	box.add_child(search_row)
	_search = LineEdit.new()
	_search.placeholder_text = "Search (e.g. 35, 中央通路)"
	_search.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_search.text_submitted.connect(func(_t: String) -> void: do_search(_search.text))
	search_row.add_child(_search)
	var go := Button.new()
	go.text = "Search"
	go.pressed.connect(func() -> void: do_search(_search.text))
	search_row.add_child(go)

	_results = ItemList.new()
	_results.custom_minimum_size = Vector2(0, 170)
	_results.auto_height = false
	box.add_child(_results)

	var pick_row := HBoxContainer.new()
	box.add_child(pick_row)
	var as_start := Button.new()
	as_start.text = "Use as start"
	as_start.pressed.connect(func() -> void: pick(true))
	pick_row.add_child(as_start)
	var as_goal := Button.new()
	as_goal.text = "Use as goal"
	as_goal.pressed.connect(func() -> void: pick(false))
	pick_row.add_child(as_goal)
	var nearest := Button.new()
	nearest.text = "Start: nearest spawn"
	nearest.pressed.connect(func() -> void: set_start(""))
	pick_row.add_child(nearest)

	_start_label = Label.new()
	_start_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_start_label)
	_goal_label = Label.new()
	_goal_label.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_goal_label)

	var act := HBoxContainer.new()
	box.add_child(act)
	_route_button = Button.new()
	_route_button.text = "Route"
	_route_button.pressed.connect(func() -> void: compute_route())
	act.add_child(_route_button)
	var clear := Button.new()
	clear.text = "Clear"
	clear.pressed.connect(func() -> void: clear_route())
	act.add_child(clear)
	_guide_toggle = CheckButton.new()
	_guide_toggle.text = "Guided walk"
	_guide_toggle.toggled.connect(func(on: bool) -> void: if not _syncing: set_guided(on))
	act.add_child(_guide_toggle)

	_status = Label.new()
	_status.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	box.add_child(_status)
	_symbolic_note = Label.new()
	_symbolic_note.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_symbolic_note.add_theme_color_override("font_color", Color(1.0, 0.7, 0.2))
	box.add_child(_symbolic_note)
	_steps = ItemList.new()
	_steps.custom_minimum_size = Vector2(0, 170)
	_steps.auto_height = false
	_steps.select_mode = ItemList.SELECT_SINGLE
	box.add_child(_steps)
	_facts = Label.new()
	_facts.autowrap_mode = TextServer.AUTOWRAP_ARBITRARY
	_facts.add_theme_font_size_override("font_size", 13)
	box.add_child(_facts)
	_prompt = Label.new()
	_prompt.add_theme_font_size_override("font_size", 20)
	_prompt.add_theme_color_override("font_color", Color(1.0, 0.88, 0.3))
	box.add_child(_prompt)
	# The ride's fade, over the whole screen and never taking the mouse.
	_fade = ColorRect.new()
	_fade.color = Color(0.0, 0.0, 0.0, 0.0)
	_fade.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_fade.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(_fade)
	refresh_labels()


## True while a text field has focus, so hq does not read WASD as movement.
func typing() -> bool:
	return hq.get_viewport().gui_get_focus_owner() is LineEdit


func _unhandled_input(event: InputEvent) -> void:
	# E or the gamepad's A takes the lift the HUD offers; no other input can start a ride.
	var wants_ride: bool = (event is InputEventKey and event.pressed and not event.echo and event.keycode == KEY_E) \
		or (event is InputEventJoypadButton and event.pressed and event.button_index == JOY_BUTTON_A)
	if wants_ride and not typing() and ride_pressed():
		hq.get_viewport().set_input_as_handled()
		return
	if (event is InputEventMouseButton and event.pressed) or (event is InputEventKey and event.pressed and event.keycode == KEY_ESCAPE):
		var focus := hq.get_viewport().gui_get_focus_owner()
		if focus != null:
			focus.release_focus()


## Called by hq after a station loads: forget the old route and results, load the display index.
func station_changed(id: String) -> void:
	station_id = id
	clear_route()
	hits = []
	goal_poi = ""
	start_poi = ""
	_results.clear()
	var loaded := bridge.load_index(id)
	if loaded.ok:
		index = loaded.index
		set_status("Search index loaded (%d POIs)." % index.entries.size())
	else:
		index = {"entries": {}, "floors": {}}
		set_status("Search index unavailable: %s" % loaded.error, true)
	refresh_labels()


func set_lang(value: String) -> void:
	lang = value
	_lang_box.select(LANGS.find(value))
	refresh_labels()


func set_status(text: String, is_error := false) -> void:
	status_text = text
	_status.text = text
	_status.add_theme_color_override("font_color", Color(1.0, 0.45, 0.4) if is_error else Color(0.8, 1.0, 0.8))


func name_of(poi_id: String) -> String:
	return Bridge.poi_name(index, poi_id, lang) if index.has("entries") else poi_id


func row_text(hit: Dictionary) -> String:
	var entry: Variant = index.get("entries", {}).get(hit.poiId)
	var category := str(entry.category) if entry != null else "?"
	var floor_text := Bridge.floor_label(index, entry.floorId, lang) if entry != null else "?"
	return "%s  |  %s  |  %s  |  %s" % [name_of(hit.poiId), category, floor_text, "routable" if hit.routable else "search-only"]


func do_search(query: String) -> void:
	if station_id.is_empty():
		return
	var found := bridge.search(station_id, query, 8)
	_results.clear()
	hits = []
	if not found.ok:
		set_status("Search failed: %s" % found.error, true)
		return
	hits = found.hits
	for hit in hits:
		var row := _results.add_item(row_text(hit))
		if not hit.routable:
			# Shown, but never selectable as start or goal.
			_results.set_item_disabled(row, true)
			_results.set_item_custom_fg_color(row, Color(0.6, 0.6, 0.6))
	set_status("%d result(s) for \"%s\"." % [hits.size(), query] if not hits.is_empty() else "No results for \"%s\"." % query)


func pick(as_start: bool) -> void:
	var selected := _results.get_selected_items()
	if selected.is_empty():
		set_status("Select a routable result first.", true)
		return
	var hit: Dictionary = hits[selected[0]]
	if not hit.routable:
		set_status("%s is search-only and cannot be a start or goal." % name_of(hit.poiId), true)
		return
	if as_start:
		set_start(hit.poiId)
	else:
		goal_poi = hit.poiId
		refresh_labels()


func set_start(poi_id: String) -> void:
	start_poi = poi_id
	refresh_labels()


func nearest_spawn() -> Dictionary:
	var best: Dictionary = {}
	var best_d := INF
	for spawn in hq.current.spawn_points:
		var d: float = spawn.position.distance_to(hq.walker.global_position)
		if d < best_d:
			best_d = d
			best = spawn
	return best


func refresh_labels() -> void:
	if _start_label == null:
		return
	if start_poi.is_empty():
		var spawn := nearest_spawn() if hq != null and hq.current != null and not hq.current.spawn_points.is_empty() else {}
		_start_label.text = "Start: nearest spawn point%s (your choice; the client does not know where you are)" % (" - %s" % str(spawn.get("label", "")) if not spawn.is_empty() else "")
	else:
		_start_label.text = "Start: %s" % name_of(start_poi)
	_goal_label.text = "Goal: %s" % (name_of(goal_poi) if not goal_poi.is_empty() else "(none)")
	for i in hits.size():
		_results.set_item_text(i, row_text(hits[i]))
	show_route_text()


func compute_route() -> void:
	if goal_poi.is_empty():
		set_status("Choose a routable goal first.", true)
		return
	var answer: Dictionary
	if start_poi.is_empty():
		var spawn := nearest_spawn()
		if spawn.is_empty():
			set_status("This station has no spawn point to start from.", true)
			return
		answer = bridge.route(station_id, spawn.node_id, goal_poi, false, true)
	else:
		answer = bridge.route(station_id, start_poi, goal_poi, true, true)
	apply_answer(answer)


## Show a bridge.route() answer: a ribbon for a found route, the reason for a failed one, never a partial line.
func apply_answer(answer: Dictionary) -> void:
	remove_ribbon()
	set_guided(false)
	if not answer.ok and not answer.has("doc"):
		guide.clear()
		set_status("Route failed: %s" % answer.error, true)
		show_route_text()
		return
	guide.load_doc(answer.doc)
	if guide.ok:
		ribbon = Ribbon.build(guide)
		if ribbon != null:
			hq.add_child(ribbon.instance)
		set_status("Route found.")
	elif not guide.reason.is_empty():
		set_status("No route (%s): %s" % [guide.reason, guide.message], true)
	else:
		set_status("Route unusable: %s" % "; ".join(guide.issues), true)
	show_route_text()


func remove_ribbon() -> void:
	if ribbon != null and ribbon.instance != null:
		ribbon.instance.queue_free()
	ribbon = null


func clear_route() -> void:
	remove_ribbon()
	set_guided(false)
	guide.clear()
	_end_ride()
	if _steps != null:
		show_route_text()


func show_route_text() -> void:
	_steps.clear()
	_facts.text = ""
	_symbolic_note.text = ""
	if not guide.ok:
		return
	if guide.symbolic:
		_symbolic_note.text = "Heights on this route are symbolic (no surveyed Z); the dashed ribbon shows floor levels as display values only."
	var list: Array = guide.instructions.get(lang, [])
	for i in list.size():
		_steps.add_item("%d. %s" % [i + 1, list[i].text])
	var lines: Array[String] = []
	for fact in guide.facts():
		lines.append("%s: %s" % [fact[0], JSON.stringify(fact[1])])
		if fact[0] == "unknowns":
			for unknown in fact[1]:
				lines.append("  %s: UNKNOWN (%d edges)" % [unknown.get("kind", "?"), unknown.get("edgeIds", []).size()])
	_facts.text = "\n".join(lines)
	update_highlight(true)


func update_highlight(force := false) -> void:
	if not guide.ok or _steps.item_count == 0:
		return
	var at := guide.s
	if not guide.guiding:
		var near := guide.project(hq.walker.global_position)
		if near.distance > NEAR_PATH:
			if force:
				_steps.deselect_all()
			return
		at = near.s
	var i := guide.instruction_at(at, lang)
	if i >= 0 and i < _steps.item_count:
		_steps.select(i)
		_steps.ensure_current_is_visible()


func set_guided(on: bool) -> void:
	_syncing = true
	_guide_toggle.button_pressed = on and guide.ok
	_syncing = false
	_end_ride()
	if on and guide.ok:
		var near := guide.project(hq.walker.global_position)
		guide.start_guide(near.s if near.distance <= 2.0 else 0.0)
		snap_camera = true
		hq.walker.pitch = Walker.DEFAULT_PITCH
	elif guide.guiding:
		guide.stop_guide()
		# Back to free walking: put the walker on the nearest ground at the place the guide left it.
		hq.walker.walk_from(hq.walker.global_position, -rad_to_deg(hq.walker.yaw))


## Per physics tick, before hq's own walker step. Returns true when guided walking moved the avatar this tick.
func physics(delta: float, move: Vector2) -> bool:
	if typing():
		move = Vector2.ZERO
	if guide.guiding and not _ride_phase.is_empty():
		# A ride in progress owns the avatar: no walking, no cancellation.
		ride_tick(delta)
		_since_highlight += delta
		return true
	if guide.guiding and move != Vector2.ZERO:
		set_guided(false)
		return false
	update_ride_prompt()
	if guide.guiding:
		guided_tick(hq.walker, hq.camera, delta)
		update_ride_prompt()
		_since_highlight += delta
		if _since_highlight >= 0.1:
			_since_highlight = 0.0
			update_highlight()
		if guide.arrived:
			set_status("Arrived. Move to walk freely.")
		return true
	_since_highlight += delta
	if _since_highlight >= HIGHLIGHT_PERIOD:
		_since_highlight = 0.0
		update_highlight()
	return false


## Offer the lift only while guided walking stands on the ride's own elevator step and within reach of its start; the
## prompt clears itself the moment either stops being true, and no other step can offer one.
func update_ride_prompt() -> void:
	_ride = {}
	if not guide.guiding:
		_prompt.text = ""
		return
	_ride = guide.ride_at(hq.walker.global_position, guide.step_at(guide.s))
	_prompt.text = RIDE_PROMPT if not _ride.is_empty() else ""


## Start the ride the HUD offers. False when there is none (or one is already running), so the key does nothing else.
func ride_pressed() -> bool:
	if not _ride_phase.is_empty() or _ride.is_empty() or not guide.guiding:
		return false
	_ride_phase = "out"
	_ride_left = RIDE_FADE
	_prompt.text = ""
	return true


## The fade: RIDE_FADE out, then the shared Guide.take_ride() landing, then RIDE_FADE back in. The yaw is untouched and
## the guide moves to the shaft's exit, so the next guided tick continues from where the lift put the walker.
func ride_tick(delta: float) -> void:
	_ride_left = maxf(0.0, _ride_left - delta)
	if _ride_phase == "out":
		_fade.color.a = 1.0 - _ride_left / RIDE_FADE
		if _ride_left > 0.0:
			return
		var ride := _ride
		_ride = {}
		_ride_phase = "in"
		_ride_left = RIDE_FADE
		if ride.is_empty() or not guide.take_ride(hq.walker, ride):
			set_status("The lift's exit has no walkable ground; the lift was not taken.", true)
			return
		snap_camera = true
		return
	_fade.color.a = _ride_left / RIDE_FADE
	if _ride_left <= 0.0:
		_end_ride()


## Clear the prompt, the offered ride and the fade (cancelled guide, new route, finished ride).
func _end_ride() -> void:
	_ride_phase = ""
	_ride_left = 0.0
	_ride = {}
	if _prompt != null:
		_prompt.text = ""
	if _fade != null:
		_fade.color.a = 0.0


## Move the avatar along the polyline without collisions (explorer.ts stepGuide) and keep the follow camera on it.
func guided_tick(walker: Walker, camera: Camera3D, delta: float) -> void:
	var snap := snap_camera
	snap_camera = false
	var sampled := guide.advance(delta)
	if sampled.is_empty():
		return
	walker.global_position = sampled.position
	if sampled.tx != 0.0 or sampled.tz != 0.0:
		var target := atan2(-sampled.tx, -sampled.tz)
		walker.yaw += angle_difference(walker.yaw, target) * minf(1.0, delta * Guide.YAW_FOLLOW)
	walker.body_yaw = walker.yaw
	walker._sync_avatar()
	if camera != null:
		camera.follow(walker, delta, snap)
