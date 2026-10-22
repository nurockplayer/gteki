extends SceneTree
## Headless checks of the G-4b look profile (`addons/gteki/gteki_look.gd`) and its material table.
## Usage: --script res://tests/run_look_tests.gd -- <scenesDir> <stationId> [<stationId> ...]

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Look = preload("res://addons/gteki/gteki_look.gd")

var checks := 0
var failures: Array[String] = []


func _initialize() -> void:
	call_deferred("run")


func check(condition: bool, message: String) -> void:
	checks += 1
	if not condition:
		failures.append(message)
		printerr("FAIL: ", message)


func run() -> void:
	var args := OS.get_cmdline_user_args()
	if args.size() < 2:
		printerr("Usage: -- <scenesDir> <stationId> [<stationId> ...]")
		quit(1)
		return
	check_args()
	var table := Look.load_table()
	check_table(table)
	for i in range(1, args.size()):
		await check_station(args[0].path_join(args[i]), args[i], table)
	if failures.is_empty():
		print("PASS: GTEki Godot look profile (%d checks)" % checks)
	else:
		printerr("FAIL: %d of %d look checks failed:\n  %s" % [failures.size(), checks, "\n  ".join(failures)])
	quit(0 if failures.is_empty() else 1)


func check_args() -> void:
	var defaults := Look.parse_args(PackedStringArray())
	check(defaults.profile == "baseline" and defaults.gi == "off" and (defaults.errors as Array).is_empty(), "defaults: baseline, no SDFGI, no error")
	var hq := Look.parse_args(PackedStringArray(["--look=hq"]))
	check(hq.profile == "hq" and (hq.errors as Array).is_empty(), "--look=hq selects the hq profile")
	var sdfgi := Look.parse_args(PackedStringArray(["--look=hq", "--gi=sdfgi"]))
	check(sdfgi.gi == "sdfgi" and (sdfgi.errors as Array).is_empty(), "--gi=sdfgi is accepted")
	var bad := Look.parse_args(PackedStringArray(["--look=pretty", "--gi=lumen"]))
	check((bad.errors as Array).size() == 2 and bad.profile == "baseline", "unknown --look / --gi values are errors and never a silent fallback")


func check_table(table: Dictionary) -> void:
	var styles: Dictionary = table.get("styles", {})
	check(not styles.is_empty(), "materials.json declares style materials")
	check(table.get("schema") == "gteki.godot-look/0.1", "materials.json schema")
	for name in styles.keys():
		var style: Dictionary = styles[name]
		var albedo := str(style.get("albedo", ""))
		check(albedo.length() == 7 and albedo.begins_with("#"), "%s: albedo is a 6-digit sRGB hex (%s)" % [name, albedo])
		check(float(style.get("roughness", -1.0)) >= 0.0 and float(style.get("roughness", 2.0)) <= 1.0, "%s: roughness in 0..1" % name)
		check(float(style.get("metal", -1.0)) >= 0.0 and float(style.get("metal", 2.0)) <= 1.0, "%s: metal in 0..1" % name)
		# Optional fields: a Godot-local style says so and explains itself; nothing here is a style-bible entry.
		if style.has("local"):
			check(style.local is bool, "%s: local is a bool" % name)
		if style.has("note"):
			check(style.note is String and not str(style.note).is_empty(), "%s: note is a non-empty string" % name)
		if style.get("local", false) == true:
			check(style.has("note"), "%s: a local style carries a note" % name)
	var stations: Dictionary = table.get("stations", {})
	check(stations.has("shinjuku") and stations.has("ikebukuro"), "materials.json covers both stations")
	for id in stations.keys():
		var mappings: Dictionary = stations[id].get("materials", {})
		for name in mappings.keys():
			var mapping: Dictionary = mappings[name]
			check(styles.has(str(mapping.get("style", ""))), "%s/%s: style is declared" % [id, name])
			var from: Dictionary = mapping.get("from", {})
			for key in ["color", "metal", "roughness", "surfaces", "evidence"]:
				check(from.has(key), "%s/%s: `from` carries %s evidence" % [id, name, key])
			# Optional: a mapping that is not E27 fact says so in its own field.
			if mapping.has("provisional"):
				check(mapping.provisional is String and not str(mapping.provisional).is_empty(), "%s/%s: provisional is a non-empty string" % [id, name])
	check((stations.shinjuku.get("materials", {}) as Dictionary).size() > 0, "Shinjuku has mapped materials")


func check_station(dir: String, id: String, table: Dictionary) -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	var loaded := scene.load_snapshot(dir, holder)
	check(loaded, "%s: snapshot loads: %s" % [id, str(scene.issues)])
	if not loaded:
		holder.queue_free()
		return
	# baseline: exactly today's look, no environment node and no material change.
	check(Look.build(holder, "baseline") == null, "%s: baseline adds no WorldEnvironment" % id)
	check(Look.apply(null, scene) == null, "%s: baseline applies nothing" % id)
	# hq: Environment from the sidecar.
	var node := Look.build(holder, "hq")
	check(node != null and node.name == "hq_look" and node.get_parent() == holder, "%s: hq adds a WorldEnvironment under the holder" % id)
	var environment := Look.apply(node, scene, "off")
	check(environment != null and node.environment == environment, "%s: hq assigns the Environment" % id)
	check(environment.tonemap_mode == Environment.TONE_MAPPER_AGX, "%s: tonemap is AgX" % id)
	check(is_equal_approx(environment.tonemap_exposure, float(scene.environment.get("exposure", 1.0))), "%s: exposure follows the sidecar (%.3f)" % [id, environment.tonemap_exposure])
	check(environment.ssao_enabled, "%s: SSAO is on" % id)
	check(not environment.glow_enabled, "%s: glow is off" % id)
	check(not environment.sdfgi_enabled, "%s: SDFGI is off by default" % id)
	check(Look.apply(node, scene, "sdfgi").sdfgi_enabled, "%s: --gi=sdfgi turns SDFGI on" % id)
	check(not Look.apply(node, scene).sdfgi_enabled, "%s: SDFGI goes off again without the flag" % id)
	var fog: Variant = scene.environment.get("fog", null)
	if fog is Dictionary:
		check(environment.fog_enabled, "%s: sidecar fog is applied" % id)
		check(is_equal_approx(environment.fog_depth_begin, float(fog.near)) and is_equal_approx(environment.fog_depth_end, float(fog.far)), "%s: fog near/far map to depth begin/end (%s..%s)" % [id, str(fog.near), str(fog.far)])
		check(environment.fog_mode == Environment.FOG_MODE_DEPTH and is_equal_approx(environment.fog_depth_curve, 1.0), "%s: fog is linear depth fog" % id)
		check(environment.fog_light_color.is_equal_approx(Look.linear_color(int(fog.color))), "%s: fog colour is the sidecar colour, sRGB→linear" % id)
	else:
		check(not environment.fog_enabled, "%s: no sidecar fog, no fog" % id)
	if scene.lightmap_applied:
		check(environment.ambient_light_source == Environment.AMBIENT_SOURCE_DISABLED, "%s: a baked station gets no ambient" % id)
	else:
		check(environment.ambient_light_source == Environment.AMBIENT_SOURCE_COLOR, "%s: an unbaked station gets an ambient colour" % id)
		check(environment.ambient_light_color.is_equal_approx(Look.AMBIENT_COLOR) and is_equal_approx(environment.ambient_light_energy, Look.AMBIENT_ENERGY), "%s: ambient is the §7 world grey at fill level" % id)
	check_materials(holder, table, id)


## Recorded before the table is applied, so "unmapped materials are untouched" compares against the snapshot itself.
func surface_materials(root: Node) -> Dictionary:
	var found := {}
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D or node.mesh == null:
			continue
		for surface in range(node.mesh.get_surface_count()):
			found["%d:%d" % [node.get_instance_id(), surface]] = {
				"material": node.get_active_material(surface),
				"override": node.get_surface_override_material(surface),
			}
	return found


func check_materials(holder: Node3D, table: Dictionary, id: String) -> void:
	var mappings: Dictionary = table.get("stations", {}).get(id, {}).get("materials", {})
	var styles: Dictionary = table.get("styles", {})
	var before := surface_materials(holder)
	var result := Look.apply_materials(holder, table, id)
	check((result.missing as Array).is_empty(), "%s: every mapped material name exists in the snapshot (%s)" % [id, str(result.missing)])
	check((result.unknown_style as Array).is_empty(), "%s: every mapping names a declared style (%s)" % [id, str(result.unknown_style)])
	check(int(result.applied) > 0 or mappings.is_empty(), "%s: the table maps surfaces (%d)" % [id, result.applied])
	var after := surface_materials(holder)
	var checked := {}
	var untouched := 0
	for key in before.keys():
		var was: Dictionary = before[key]
		var now: Dictionary = after[key]
		var name := str((was.material as BaseMaterial3D).resource_name) if was.material is BaseMaterial3D else ""
		if mappings.has(name):
			var override: Variant = now.override
			check(override is StandardMaterial3D, "%s/%s: surface %s has the table material" % [id, name, key])
			if override is StandardMaterial3D:
				var style: Dictionary = styles[str(mappings[name].style)]
				check(override.albedo_color.to_html(false).to_upper() == str(style.albedo).trim_prefix("#").to_upper(), "%s/%s: albedo is the palette hex %s" % [id, name, style.albedo])
				check(is_equal_approx(override.roughness, float(style.roughness)) and is_equal_approx(override.metallic, float(style.metal)), "%s/%s: roughness/metal are the palette values" % [id, name])
				# The table sets albedo/roughness/metal only; the duplicate keeps the source's emission (the Oedo
				# band's faint emission), transparency and texture.
				var source := was.material as BaseMaterial3D
				check(override.emission_enabled == source.emission_enabled and override.emission.is_equal_approx(source.emission) and is_equal_approx(override.emission_energy_multiplier, source.emission_energy_multiplier), "%s/%s: the override keeps the source emission" % [id, name])
				check(override.transparency == source.transparency and override.albedo_texture == source.albedo_texture, "%s/%s: the override keeps transparency and texture" % [id, name])
			checked[name] = true
		else:
			# No mapping: the surface keeps the snapshot material and no override of ours.
			check(now.material == was.material and now.override == was.override, "%s/%s: unmapped surface %s is untouched" % [id, name, key])
			untouched += 1
	check(checked.size() == mappings.size() or mappings.is_empty(), "%s: every mapping reached a surface (%d of %d)" % [id, checked.size(), mappings.size()])
	if not mappings.is_empty():
		check(untouched > 0, "%s: unmapped surfaces exist and are left alone" % id)
