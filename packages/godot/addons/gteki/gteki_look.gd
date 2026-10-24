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
## - The material table maps source material names to style.md §2 finishes. It is applied only with `--look=hq`,
##   only to StandardMaterial3D surfaces, and never to a material the table does not name. A mapping applies only while
##   its `from` evidence still matches the surface it was derived from; otherwise it is skipped with a warning (#257).

const Scene = preload("res://addons/gteki/gteki_scene.gd")

const PROFILES := ["baseline", "hq"]
const GI_MODES := ["off", "sdfgi"]
const TABLE_PATH := "res://looks/materials.json"
## docs/assets/style.md §7: the interior references use a near-black world, so a station with its bake applied gets no
## ambient at all (the bake is its light). An unbaked station gets the studio world's light grey as a low ambient fill,
## at a fill level that leaves the key lights dominant. §7 states it as a linear value; Environment colour properties
## take sRGB, so it is converted once with `linear_to_srgb()` before assignment.
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
	# unchanged. Environment colours take sRGB, so the sidecar's sRGB hex goes in as is: Godot linearises it in the
	# renderer, and decoding it here as well would apply the transform twice (fog almost black).
	var fog: Variant = settings.get("fog", null)
	if fog is Dictionary:
		environment.fog_enabled = true
		environment.fog_mode = Environment.FOG_MODE_DEPTH
		environment.fog_depth_begin = float(fog.get("near", 0.0))
		environment.fog_depth_end = float(fog.get("far", 1.0))
		environment.fog_depth_curve = 1.0
		environment.fog_density = 1.0
		environment.fog_light_color = srgb_color(int(fog.get("color", 0)))
	if baked:
		environment.ambient_light_source = Environment.AMBIENT_SOURCE_DISABLED
		environment.ambient_light_energy = 0.0
	else:
		environment.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
		environment.ambient_light_color = AMBIENT_COLOR.linear_to_srgb()
		environment.ambient_light_energy = AMBIENT_ENERGY
		environment.ambient_light_sky_contribution = 0.0
	environment.sdfgi_enabled = gi == "sdfgi"
	return environment


## A sidecar colour (three's sRGB hex) as the sRGB `Color` an Environment property takes. Godot linearises those
## properties itself, so this must not decode; material albedo is written as sRGB for the same reason (#251).
static func srgb_color(rgb: int) -> Color:
	return Color.html("#%06x" % (rgb & 0xffffff))


static func load_table(path: String = TABLE_PATH) -> Dictionary:
	if not FileAccess.file_exists(path):
		return {}
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(path))
	if not parsed is Dictionary:
		return {}
	return parsed


## The tolerance on the metal/roughness fingerprint. The snapshot records those at the two-decimal precision the dump
## prints, so 0.01 is that evidence's own resolution (plus a hair for float noise).
const FINGERPRINT_TOLERANCE := 0.01 + 0.000001


## Applies `station_id`'s material table to every drawn surface under `root`. A mapping is applied only while the
## snapshot material it names still matches the mapping's `from` evidence: the sRGB albedo exactly, metal and roughness
## within 0.01, and every recorded sample mesh still carrying that material. A mapping that no longer matches is
## skipped, warned about and reported in `mismatched` (the look tests fail on it). A name shared by two or more
## distinct materials is ambiguous, so its mapping is skipped and reported the same way. Surfaces whose material the
## table does not name keep the snapshot material untouched (no override). Returns {applied, surfaces, missing, mismatched, unknown_style}: surfaces the table
## changed, surfaces walked, mapped names absent from the snapshot, mappings skipped because their evidence no longer
## matches, and mappings whose style is not in `styles`.
static func apply_materials(root: Node3D, table: Dictionary, station_id: String) -> Dictionary:
	var mappings: Dictionary = table.get("stations", {}).get(station_id, {}).get("materials", {})
	var styles: Dictionary = table.get("styles", {})
	var found := fingerprint_materials(root)
	var missing: Array[String] = []
	var mismatched: Array[String] = []
	var unknown_style: Array[String] = []
	var verified := {}
	for key in mappings.keys():
		var name := str(key)
		if not found.has(name):
			missing.append(name)
			continue
		if (found[name].instances as Dictionary).size() > 1:
			var reason := "name is shared by %d distinct materials" % (found[name].instances as Dictionary).size()
			mismatched.append("%s: %s" % [name, reason])
			push_warning("look: %s/%s is skipped, %s" % [station_id, name, reason])
			continue
		var mapping: Variant = mappings[key]
		var style_name := str(mapping.get("style", "")) if mapping is Dictionary else ""
		if not styles.get(style_name) is Dictionary:
			if not style_name in unknown_style:
				unknown_style.append(style_name)
			continue
		var reason := fingerprint_mismatch(mapping.get("from", null) if mapping is Dictionary else null, found[name])
		if not reason.is_empty():
			mismatched.append("%s: %s" % [name, reason])
			push_warning("look: %s/%s is skipped, its evidence no longer matches (%s)" % [station_id, name, reason])
			continue
		verified[name] = true
	var cache := {}
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
			if not verified.has(name):
				continue
			if not cache.has(name):
				cache[name] = style_material(material, styles[str(mappings[name].style)])
			mesh.set_surface_override_material(surface, cache[name])
			applied += 1
	return {
		"applied": applied,
		"surfaces": surfaces,
		"missing": missing,
		"mismatched": mismatched,
		"unknown_style": unknown_style,
	}


## The evidence each snapshot material actually carries, keyed by name: {name: {color, metal, roughness, meshes}},
## where `meshes` is the set of mesh node names that use it. First instance per name wins (glTF import shares one
## material resource per glTF material).
static func fingerprint_materials(root: Node3D) -> Dictionary:
	var found := {}
	var stack: Array[Node] = [root]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D or node.mesh == null:
			continue
		var mesh: MeshInstance3D = node
		for surface in range(mesh.mesh.get_surface_count()):
			var material: Variant = mesh.get_active_material(surface)
			if not material is BaseMaterial3D:
				continue
			var base: BaseMaterial3D = material
			var name := str(base.resource_name)
			if not found.has(name):
				found[name] = {
					"color": base.albedo_color.to_html(false),
					"metal": base.metallic,
					"roughness": base.roughness,
					"meshes": {},
					"instances": {},
				}
			found[name].instances[str(base.get_instance_id())] = true
			found[name].meshes[str(mesh.name)] = true
	return found


## "" when `actual` matches the mapping's recorded `from` evidence, else the first difference, as a short phrase.
static func fingerprint_mismatch(from: Variant, actual: Dictionary) -> String:
	if not from is Dictionary:
		return "no `from` evidence"
	# `Color.to_html(false)` writes the six hex digits without the leading `#`; the table writes the CSS form.
	var want_color := str(from.get("color", "")).to_lower().trim_prefix("#")
	if want_color.is_empty():
		return "no recorded albedo"
	if want_color != str(actual.color).to_lower().trim_prefix("#"):
		return "albedo %s, recorded %s" % [actual.color, want_color]
	for key in ["metal", "roughness"]:
		if not from.has(key):
			return "no recorded %s" % key
		var got := float(actual[key])
		var want := float(from[key])
		if absf(got - want) > FINGERPRINT_TOLERANCE:
			return "%s %.2f, recorded %.2f" % [key, got, want]
	var meshes: Variant = from.get("meshes", [])
	if not meshes is Array:
		return "sample meshes are not a list"
	for mesh_name in meshes:
		if not (actual.meshes as Dictionary).has(str(mesh_name)):
			return "sample mesh %s no longer uses it" % str(mesh_name)
	return ""


## A style's material for one source surface. The override is a duplicate, so everything the table does not set
## (emission, transparency, textures) stays the snapshot's: the Oedo accent band keeps its faint emission this way.
static func style_material(source: BaseMaterial3D, style: Dictionary) -> StandardMaterial3D:
	var copy: StandardMaterial3D = source.duplicate()
	copy.albedo_color = Color.html(str(style.get("albedo", "#ffffff")))
	copy.roughness = float(style.get("roughness", 0.5))
	copy.metallic = float(style.get("metal", 0.0))
	return copy
