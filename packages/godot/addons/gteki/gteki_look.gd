extends RefCounted
## G-4b: the HQ look profile (issue #164). Two profiles, chosen with `--look=` on `hq.tscn`:
##   baseline  today's look: no WorldEnvironment, no material table. The default until the lead approves `hq`.
##   hq        the style-bible look: AgX, exposure and fog from the station's sidecar, SSAO, no glow, ambient rules
##             below, and the station's material table (looks/materials.json) applied to its surfaces.
##
## What comes from where:
## - AgX, the strong contact AO and the soft, even interior light are the targets in docs/assets/style.md §7. Exposure
##   and fog are the station's own numbers (scene-api `environment`), carried by the snapshot sidecar.
## - SSAO and SDFGI are Forward+/Mobile features. This project runs gl_compatibility, where Godot ignores both, so they
##   are set for the GPU review slot rather than for the headless gate. `--gi=sdfgi` is the lead's switch.
## - The material table maps snapshot material names to style.md §2 finishes. It is applied only with `--look=hq`,
##   only to StandardMaterial3D surfaces, and never to a material the table does not name.

const Scene = preload("res://addons/gteki/gteki_scene.gd")

const PROFILES := ["baseline", "hq"]
const GI_MODES := ["off", "sdfgi"]
const TABLE_PATH := "res://looks/materials.json"
## docs/assets/style.md §7: the interior references use a near-black world, so a station with its bake applied gets no
## ambient at all (the bake is its light). An unbaked station gets the studio world's light grey as a low ambient fill;
## it is a colour, so it is used as the linear value §7 states, at a fill level that leaves the key lights dominant.
const AMBIENT_COLOR := Color(0.55, 0.58, 0.62)
const AMBIENT_ENERGY := 0.25


## `--look=` and `--gi=` for the client. Unknown values are errors, never a silent fallback.
static func parse_args(args: PackedStringArray) -> Dictionary:
	var profile := "baseline"
	var gi := "off"
	var errors: Array[String] = []
	for arg in args:
		if arg.begins_with("--look="):
			var value := arg.trim_prefix("--look=")
			if value in PROFILES:
				profile = value
			else:
				errors.append("--look must be one of %s, not %s" % [", ".join(PROFILES), value])
		elif arg.begins_with("--gi="):
			var value := arg.trim_prefix("--gi=")
			if value in GI_MODES:
				gi = value
			else:
				errors.append("--gi must be one of %s, not %s" % [", ".join(GI_MODES), value])
	return {"profile": profile, "gi": gi, "errors": errors}


## Adds the WorldEnvironment for `profile` under `parent`. `baseline` adds nothing (today's look).
static func build(parent: Node3D, profile: String) -> WorldEnvironment:
	if profile != "hq":
		return null
	var node := WorldEnvironment.new()
	node.name = "hq_look"
	parent.add_child(node)
	return node


## Re-configures `node` for the station just loaded (`scene.environment`) and returns the Environment, or null for the
## baseline profile (no node). Call after `load_snapshot`, i.e. against the same snapshot state the client renders.
static func apply(node: WorldEnvironment, scene: Scene, gi: String = "off") -> Environment:
	if node == null:
		return null
	var environment := environment_for(scene.environment, scene.lightmap_applied, gi)
	node.environment = environment
	return environment


## The `hq` Environment for one station. `baked`: the station's lightmap is applied, so the bake is the station's light
## and no ambient may compete with it. `gi`: "sdfgi" turns SDFGI on (off by default; Forward+/Mobile only).
static func environment_for(settings: Dictionary, baked: bool, gi: String = "off") -> Environment:
	var environment := Environment.new()
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_exposure = float(settings.get("exposure", 1.0))
	environment.ssao_enabled = true
	# The style references have no bloom (style.md §7): highlights come from AgX and the bevels, not from glow.
	environment.glow_enabled = false
	# three's fog is linear in distance; Godot's depth fog is linear too when its curve is 1.0, so near/far carry over
	# unchanged and the colour is three's sRGB hex converted to the linear value Godot expects.
	var fog: Variant = settings.get("fog", null)
	if fog is Dictionary:
		environment.fog_enabled = true
		environment.fog_mode = Environment.FOG_MODE_DEPTH
		environment.fog_depth_begin = float(fog.get("near", 0.0))
		environment.fog_depth_end = float(fog.get("far", 1.0))
		environment.fog_depth_curve = 1.0
		environment.fog_density = 1.0
		environment.fog_light_color = linear_color(int(fog.get("color", 0)))
	if baked:
		environment.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
		environment.ambient_light_energy = 0.0
	else:
		environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		environment.ambient_light_color = AMBIENT_COLOR
		environment.ambient_light_energy = AMBIENT_ENERGY
		environment.ambient_light_sky_contribution = 0.0
	environment.sdfgi_enabled = gi == "sdfgi"
	return environment


## An sRGB hex colour (as three stores `fog.color`) as the linear value Godot's rendering expects.
static func linear_color(rgb: int) -> Color:
	return Color.html("#%06x" % (rgb & 0xffffff)).srgb_to_linear()


static func load_table(path: String = TABLE_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary:
		return {}
	return parsed


## Applies `station_id`'s material table to every drawn surface under `root`. Surfaces whose material the table does not
## name keep the snapshot material untouched (no override). Returns
## {applied, surfaces, missing, unknown_style}: surfaces the table changed, mapped names found in the snapshot, mapped
## names no surface used, and mappings whose style is not in `styles`.
static func apply_materials(root: Node3D, table: Dictionary, station_id: String) -> Dictionary:
	var mappings: Dictionary = table.get("stations", {}).get(station_id, {}).get("materials", {})
	var styles: Dictionary = table.get("styles", {})
	var cache := {}
	var found := {}
	var unknown_style: Array[String] = []
	var applied := 0
	var surfaces := 0
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D or node.mesh == null:
			continue
		var mesh: MeshInstance3D = node
		for surface in range(mesh.mesh.get_surface_count()):
			surfaces += 1
			var material: Variant = mesh.get_active_material(surface)
			if not material is BaseMaterial3D:
				continue
			var name := str(material.resource_name)
			if not mappings.has(name):
				continue
			found[name] = true
			var mapping: Variant = mappings[name]
			var style_name := str(mapping.get("style", "")) if mapping is Dictionary else ""
			var style: Variant = styles.get(style_name)
			if not style is Dictionary:
				if not style_name in unknown_style:
					unknown_style.append(style_name)
				continue
			if not cache.has(name):
				# The override is a duplicate, so everything the table does not set (emission, transparency, textures)
				# stays the snapshot's: the Oedo accent band keeps its faint emission this way.
				var copy: StandardMaterial3D = (material as BaseMaterial3D).duplicate()
				copy.albedo_color = Color.html(str(style.get("albedo", "#ffffff")))
				copy.roughness = float(style.get("roughness", 0.5))
				copy.metallic = float(style.get("metal", 0.0))
				cache[name] = copy
			mesh.set_surface_override_material(surface, cache[name])
			applied += 1
	var missing: Array[String] = []
	for name in mappings.keys():
		if not found.has(name):
			missing.append(str(name))
	return {"applied": applied, "surfaces": surfaces, "missing": missing, "unknown_style": unknown_style}
