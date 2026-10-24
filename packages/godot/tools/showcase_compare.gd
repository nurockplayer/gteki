extends SceneTree
## G-4: render Lane E's showcase GLBs through their exported cameras, beside the Blender references.
## Run in the lead's GPU slot; a headless display exits successfully before reading inputs or writing anything.
## Usage: --script res://tools/showcase_compare.gd -- <absolute.glb> <absolute out_dir>
##        [--camera=<name>] [--ref=<camera>=<absolute image>]... [--region=<camera>=<name>:<x>,<y>,<w>,<h>]...
##        [--tune=<key>=<value>]... [--tag=<name>] [--report=<absolute json path>]
## Imported geometry, materials and camera transforms/FOV stay the GLB's. Lighting approximates render_preview.py;
## neither Godot spots nor its AgX implementation reproduce Blender area lights / Medium High Contrast exactly.

const WIDTH := 1600
const HEIGHT := 900
const SETTLE_RENDER_FRAMES := 60
const HEADLESS_MESSAGE := "showcase_compare needs a display"
const DEFAULT_REGION_NAMES := ["whole", "top_third", "middle_third", "bottom_third"]
static var REGION_NAME := RegEx.create_from_string("^[A-Za-z0-9_.-]+$")
const LUMINANCE_METHOD := "mean linear Rec.709 luminance, sRGB-decoded, every 2nd pixel; ratio = godot / reference"
## Approximation constants, not a physical match: Godot's non-physical energy has no Blender-watt equivalence.
## 0.02 gives a 1 m LED energy 1.1; 1.5 m spacing bounds the number of shadowed spots. A wide 75 degree half-cone
## and 8 m reach spread light over a concourse bay. Split watts equally so a longer row never multiplies its power.
## Godot 4.7.2 storage_rd/light_storage.cpp multiplies nonphysical sun energy by PI; scene_forward_lights_inc.glsl
## divides diffuse by PI. Use 1/PI for Blender's irradiance scale, not a full BRDF/renderer match. Uniform sky L
## gives diffuse albedo * L (scene_forward_clustered.glsl; storage_rd/render_scene_data_rd.cpp carries the BG
## multiplier into sky ambient), so world strength stays 0.9, without another PI.
## doc/classes/Environment.xml exposes tonemap_agx_contrast: 1.5 raises the 1.25 default towards Medium High
## Contrast, provisionally, not Blender's exact look. Sources: github.com/godotengine/godot/tree/4.7.2-stable.
## Bias 0.06 / normal bias 1.5 raise the spot defaults (0.03 / 1.0) against acne; check detachment in the GPU slot.
## 8192 atlas, four 64-slot quadrants = 256 spots at 512 px each, leaving room beyond the observed 121 lights.
## The uniform sky has no gradient/sun disk. The once-updated room probe is not `interior` (an interior probe drops the
## sky, so directions without geometry would reflect black) and its box is the visible bounds grown by its blend
## distance, so surfaces on the bounds still get full probe weight.
const APPROXIMATION := {
	"watts_to_energy": 0.02,
	"linear_led_watts_per_m": 55.0,
	"linear_led_width_m": 0.12,
	"linear_led_default_length_m": 1.0,
	"linear_led_spacing_m": 1.5,
	"disk_default_size_m": 0.4,
	"disk_default_watts": 40.0,
	"hint_offset_m": 0.03,
	"spot_angle_deg": 75.0,
	"spot_range_m": 8.0,
	"spot_attenuation": 1.0,
	"spot_angle_attenuation": 1.0,
	"spot_shadow_bias": 0.06,
	"spot_shadow_normal_bias": 1.5,
	"positional_shadow_atlas_size": 8192,
	"positional_shadow_atlas_quadrant_subdiv": Viewport.SHADOW_ATLAS_QUADRANT_SUBDIV_64,
	"texture_filter": BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC,
	"background_mode": Environment.BG_SKY,
	"ambient_light_source": Environment.AMBIENT_SOURCE_SKY,
	"reflected_light_source": Environment.REFLECTION_SOURCE_SKY,
	"ambient_light_sky_contribution": 1.0,
	"sky_shader": "shader_type sky;\nuniform vec4 colour : source_color;\nvoid sky() { COLOR = colour.rgb; }\n",
	"reflection_probe_update_mode": ReflectionProbe.UPDATE_ONCE,
	"reflection_probe_interior": false,
	"reflection_probe_blend_distance_m": 1.0,
	"reflection_probe_box_projection": true,
	"reflection_probe_ambient_mode": ReflectionProbe.AMBIENT_DISABLED,
	"agx_contrast": 1.5,
	"colour_linear": [1.0, 0.96, 0.9],
	"sun_blender_energy": 3.0,
	"sun_energy_factor": 1.0 / PI,
	"sun_angular_distance_deg": 3.0,
}
## G-5 tuning: one-run overrides on top of APPROXIMATION, so the GPU slot can sweep without editing code.
## Ranges reject typos, not physical limits: Environment's AgX contrast useful band is 0.5-2.5, energies 0-16,
## exposure_ev adds stops to the layout exposure. gi=none is the default (no GI) and leaves the environment
## untouched; gi_energy is only meaningful for sdfgi/voxelgi. probe_ambient applies only to an interior probe.
const TUNE_FLOATS := {
	"agx_contrast": [0.5, 2.5],
	"exposure_ev": [-4.0, 4.0],
	"ambient_energy": [0.0, 16.0],
	"gi_energy": [0.0, 16.0],
	"probe_ambient_energy": [0.0, 16.0],
}
const TUNE_ENUMS := {
	"gi": ["none", "sdfgi", "voxelgi"],
	"probe_ambient": ["disabled", "environment", "color"],
}
const PROBE_AMBIENT_MODES := {
	"disabled": ReflectionProbe.AMBIENT_DISABLED,
	"environment": ReflectionProbe.AMBIENT_ENVIRONMENT,
	"color": ReflectionProbe.AMBIENT_COLOR,
}
static var TAG_NAME := RegEx.create_from_string("^[A-Za-z0-9_.-]+$")
## ReflectionProbe.ambient_color only matters in AMBIENT_COLOR mode, so its colour is #rrggbb sRGB there.
static var TUNE_COLOUR := RegEx.create_from_string("^#[0-9A-Fa-f]{6}$")


func _initialize() -> void:
	call_deferred("run")


## Brightness per named region: mean linear Rec.709 luminance of sRGB-decoded pixels, every 2nd pixel in x and y.
## Both images share a size and FORMAT_RGBA8. A zero reference mean gives a null ratio instead of dividing.
static func luminance_stats(reference: Image, godot: Image, regions: Array) -> Dictionary:
	var stats := {}
	for region: Dictionary in regions:
		var rect: Rect2i = region.rect
		var reference_mean := mean_linear_luminance(reference, rect)
		var godot_mean := mean_linear_luminance(godot, rect)
		var ratio: Variant = null
		if reference_mean > 0.0:
			ratio = snappedf(godot_mean / reference_mean, 0.0001)
		stats[region.name] = {
			"reference": snappedf(reference_mean, 0.0001),
			"godot": snappedf(godot_mean, 0.0001),
			"ratio": ratio,
		}
	return stats


static func mean_linear_luminance(image: Image, rect: Rect2i) -> float:
	var total := 0.0
	var samples := 0
	for y in range(rect.position.y, rect.end.y, 2):
		for x in range(rect.position.x, rect.end.x, 2):
			var linear := image.get_pixel(x, y).srgb_to_linear()
			total += 0.2126 * linear.r + 0.7152 * linear.g + 0.0722 * linear.b
			samples += 1
	return total / samples if samples > 0 else 0.0


## Whole frame, then three horizontal bands; the bottom band absorbs remainder rows so every row is covered once.
static func default_regions(size: Vector2i) -> Array:
	var third := size.y / 3
	return [
		{"name": "whole", "rect": Rect2i(0, 0, size.x, size.y)},
		{"name": "top_third", "rect": Rect2i(0, 0, size.x, third)},
		{"name": "middle_third", "rect": Rect2i(0, third, size.x, third)},
		{"name": "bottom_third", "rect": Rect2i(0, 2 * third, size.x, size.y - 2 * third)},
	]


## Absolute filesystem paths only: res:// and user:// are not host file arguments either.
static func absolute_file_path(path: String) -> bool:
	return path.is_absolute_path() and not path.contains("://")


## One --tune=<key>=<value>; returns {"ok": bool, "value": Variant} or {"ok": false, "error": String}.
## Floats keep their parsed value, enums their string, ssao a bool: the report shows what ran, not the CLI text.
static func parse_tuning(key: String, value: String) -> Dictionary:
	if TUNE_FLOATS.has(key):
		var bounds: Array = TUNE_FLOATS[key]
		if not value.is_valid_float() or float(value) < bounds[0] or float(value) > bounds[1]:
			return {"ok": false, "error": "--tune=%s must be a number in [%s, %s]: %s" % [key, bounds[0], bounds[1], value]}
		return {"ok": true, "value": float(value)}
	if TUNE_ENUMS.has(key):
		var choices: Array = TUNE_ENUMS[key]
		if not value in choices:
			return {"ok": false, "error": "--tune=%s must be one of %s: %s" % [key, ", ".join(PackedStringArray(choices)), value]}
		return {"ok": true, "value": value}
	if key == "ssao":
		if not value in ["true", "false"]:
			return {"ok": false, "error": "--tune=ssao must be true or false: %s" % value}
		return {"ok": true, "value": value == "true"}
	if key == "probe_ambient_colour":
		if not TUNE_COLOUR.search(value) or not Color.html_is_valid(value):
			return {"ok": false, "error": "--tune=probe_ambient_colour must be #rrggbb: %s" % value}
		return {"ok": true, "value": value}
	return {"ok": false, "error": "Unknown --tune key: %s" % key}


## Parse independently of the display and filesystem; validate references against the imported cameras later.
static func parse_args(args: PackedStringArray) -> Dictionary:
	var positional: Array[String] = []
	var camera := ""
	var refs := {}
	var regions := {}
	var tuning := {}
	var tuned: Array[String] = []
	var tag := ""
	var tag_given := false
	var report := ""
	var report_given := false
	var errors: Array[String] = []
	for arg in args:
		if arg.begins_with("--camera="):
			if not camera.is_empty():
				errors.append("--camera may appear only once")
			camera = arg.trim_prefix("--camera=")
			if camera.is_empty():
				errors.append("--camera needs a name")
		elif arg.begins_with("--region="):
			# The coordinates never contain ':' and the region name never contains '=' or ':', so split on the last
			# ':' and then the last '=': the camera name may contain either.
			var spec := arg.trim_prefix("--region=")
			var colon := spec.rfind(":")
			var head := spec.substr(0, colon) if colon >= 0 else ""
			var camera_separator := head.rfind("=")
			var coords := spec.substr(colon + 1).split(",") if colon >= 0 else PackedStringArray()
			var numeric := coords.size() == 4
			for coord in coords:
				numeric = numeric and coord.is_valid_int()
			var region_camera := head.substr(0, camera_separator) if camera_separator >= 0 else ""
			var region_name := head.substr(camera_separator + 1) if camera_separator >= 0 else ""
			if region_camera.is_empty() or not REGION_NAME.search(region_name) or not numeric:
				errors.append("--region must be <camera>=<name>:<x>,<y>,<w>,<h> with a name of letters, digits, '_', '.' or '-': %s" % arg)
				continue
			# Bounds are checked on the 64-bit values before Rect2i (32-bit) is built, so no value can wrap into range.
			var x := int(coords[0])
			var y := int(coords[1])
			var w := int(coords[2])
			var h := int(coords[3])
			if x < 0 or y < 0 or w <= 0 or h <= 0 or x >= WIDTH or y >= HEIGHT or w > WIDTH - x or h > HEIGHT - y:
				errors.append("--region must have positive size inside %dx%d: %s" % [WIDTH, HEIGHT, arg])
				continue
			var rect := Rect2i(x, y, w, h)
			var camera_regions: Array = regions.get(region_camera, [])
			var duplicate := region_name in DEFAULT_REGION_NAMES
			for existing: Dictionary in camera_regions:
				duplicate = duplicate or existing.name == region_name
			if duplicate:
				errors.append("Duplicate or reserved region for camera %s: %s" % [region_camera, region_name])
				continue
			camera_regions.append({"name": region_name, "rect": rect})
			regions[region_camera] = camera_regions
		elif arg.begins_with("--ref="):
			var pair := arg.trim_prefix("--ref=")
			var separator := pair.find("=")
			if separator <= 0 or separator == pair.length() - 1:
				errors.append("--ref must be <camera>=<absolute image path>")
				continue
			var name := pair.substr(0, separator)
			var path := pair.substr(separator + 1)
			if not absolute_file_path(path):
				errors.append("Reference path must be absolute: %s" % path)
			if refs.has(name):
				errors.append("Duplicate reference for camera: %s" % name)
			refs[name] = path
		elif arg.begins_with("--tune="):
			# Values never contain '=', so the first separator splits key from value.
			var spec := arg.trim_prefix("--tune=")
			var separator := spec.find("=")
			if separator <= 0:
				errors.append("--tune must be <key>=<value>: %s" % arg)
				continue
			var key := spec.substr(0, separator)
			if key in tuned:
				errors.append("Duplicate --tune key: %s" % key)
				continue
			tuned.append(key)
			var parsed_tune := parse_tuning(key, spec.substr(separator + 1))
			if not parsed_tune.ok:
				errors.append(parsed_tune.error)
				continue
			tuning[key] = parsed_tune.value
		elif arg.begins_with("--tag="):
			if tag_given:
				errors.append("--tag may appear only once")
				continue
			tag_given = true
			tag = arg.trim_prefix("--tag=")
			if not TAG_NAME.search(tag):
				errors.append("--tag must be letters, digits, '_', '.' or '-': %s" % tag)
			elif tag.ends_with("_side"):
				errors.append("--tag must not end in '_side', which is the side-by-side suffix: %s" % tag)
		elif arg.begins_with("--report="):
			if report_given:
				errors.append("--report may appear only once")
				continue
			report_given = true
			report = arg.trim_prefix("--report=")
			if not absolute_file_path(report):
				errors.append("Report path must be absolute: %s" % report)
		elif arg.begins_with("--"):
			errors.append("Unknown argument: %s" % arg)
		else:
			positional.append(arg)
	if tuning.has("gi_energy") and not (tuning.get("gi", "none") in ["sdfgi", "voxelgi"]):
		errors.append("--tune=gi_energy needs --tune=gi=sdfgi or --tune=gi=voxelgi")
	# ReflectionProbe's ambient colour and its energy only reach the renderer in AMBIENT_COLOR mode.
	for key in ["probe_ambient_energy", "probe_ambient_colour"]:
		if tuning.has(key) and tuning.get("probe_ambient", "disabled") != "color":
			errors.append("--tune=%s needs --tune=probe_ambient=color" % key)
	if positional.size() != 2:
		errors.append("Usage: showcase_compare.gd -- <absolute.glb> <absolute out_dir> [--camera=<name>] [--ref=<camera>=<absolute image>]... [--tune=<key>=<value>]... [--tag=<name>] [--report=<absolute json path>]")
	for path in positional:
		if not absolute_file_path(path):
			errors.append("File arguments must be absolute: %s" % path)
	return {
		"glb": positional[0] if positional.size() > 0 else "",
		"out_dir": positional[1] if positional.size() > 1 else "",
		"camera": camera, "refs": refs, "regions": regions, "tuning": tuning, "tag": tag,
		"report": report, "errors": errors,
	}


## Blender XYZ Euler means Rz * Ry * Rx (Godot's default Euler order is different). Left-multiply by the glTF
## world conversion C: (x,y,z) -> (x,z,-y). Do not conjugate: the light must still emit along its local -Z.
static func sun_basis(euler_degrees: Vector3 = Vector3(50.0, 10.0, 35.0)) -> Basis:
	var rotation := Basis(Vector3.BACK, deg_to_rad(euler_degrees.z)) \
		* Basis(Vector3.UP, deg_to_rad(euler_degrees.y)) \
		* Basis(Vector3.RIGHT, deg_to_rad(euler_degrees.x))
	var conversion := Basis(Vector3.RIGHT, Vector3.FORWARD, Vector3.UP)
	return conversion * rotation


## Environment Color properties take sRGB. Blender's world values are linear; strength stays separate.
static func background(mode: String) -> Dictionary:
	var linear := Color(0.55, 0.58, 0.62) if mode == "studio" else Color(0.02, 0.022, 0.025)
	return {"colour": linear.linear_to_srgb(), "strength": 0.9 if mode == "studio" else 1.0}


## ClassDB on 4.7.2 has no global GLTFState/GLTFDocument mipmap/filter switch; BasisU also changes compression.
## Visit original mesh materials AND overrides, retaining shared textures via one replacement cache per texture and
## mip kind. Normal maps are renormalised per level. Colour mips average the stored sRGB values, as Godot's own texture
## importer does (Image.srgb_to_linear only takes 8-bit formats), so distant high-contrast albedo is slightly darker.
const NORMAL_SLOTS := [BaseMaterial3D.TEXTURE_NORMAL, BaseMaterial3D.TEXTURE_DETAIL_NORMAL]


static func prepare_textures(scene: Node) -> Dictionary:
	var textures := {}
	var materials := {}
	var generated := 0
	var unavailable := 0
	var stack: Array[Node] = [scene]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		if not node is MeshInstance3D:
			continue
		var candidates: Array[Material] = [node.material_override, node.material_overlay]
		if node.mesh != null:
			for surface in node.mesh.get_surface_count():
				candidates.append(node.mesh.surface_get_material(surface))
				candidates.append(node.get_surface_override_material(surface))
		for material in candidates:
			if not material is BaseMaterial3D or materials.has(material):
				continue
			materials[material] = true
			material.texture_filter = APPROXIMATION.texture_filter
			for slot in BaseMaterial3D.TEXTURE_MAX:
				var texture: Texture2D = material.get_texture(slot)
				if texture == null:
					continue
				var normal := slot in NORMAL_SLOTS
				var key := [texture, normal]
				if not textures.has(key):
					textures[key] = texture
					# A copy: ImageTexture.get_image() can hand back the texture's own Image, which mipmapping would mutate.
					var source := texture.get_image()
					var image: Image = source.duplicate() if source != null else null
					if image == null or image.is_empty():
						unavailable += 1
					elif not image.has_mipmaps():
						var error := image.decompress() if image.is_compressed() else OK
						if error == OK:
							error = image.generate_mipmaps(normal)
						if error == OK:
							textures[key] = ImageTexture.create_from_image(image)
							generated += 1
						else:
							unavailable += 1
				material.set_texture(slot, textures[key])
	return {"textures_processed": textures.size(), "mipmaps_generated": generated, "mipmap_failures": unavailable}


## Sky shader colours are sRGB uniforms, linearised once by source_color; strength stays on the Environment.
static func uniform_sky(mode: String) -> Sky:
	var shader := Shader.new()
	shader.code = APPROXIMATION.sky_shader
	var material := ShaderMaterial.new()
	material.shader = shader
	material.set_shader_parameter("colour", background(mode).colour)
	var sky := Sky.new()
	sky.sky_material = material
	return sky


## Global visual AABB, pruning hidden subtrees and runtime-imported collision proxies before merging meshes.
static func visual_bounds(scene: Node) -> AABB:
	var bounds := AABB()
	var found := false
	var stack: Array[Node] = [scene]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		if node is Node3D and (not node.visible or "-colonly" in str(node.name)):
			continue
		stack.append_array(node.get_children())
		if node is MeshInstance3D and node.mesh != null:
			var box: AABB = node.global_transform * node.get_aabb()
			bounds = bounds.merge(box) if found else box
			found = true
	return bounds


## Preserve sky ambient separately; the probe supplies box-projected room reflections, without ambient override.
## Grown by the blend distance so the weight is still 1 on the room's own floor and walls.
static func add_interior_probe(parent: Node3D) -> ReflectionProbe:
	var bounds := visual_bounds(parent)
	if not bounds.has_volume():
		return null
	bounds = bounds.grow(APPROXIMATION.reflection_probe_blend_distance_m)
	var probe := ReflectionProbe.new()
	probe.size = bounds.size
	probe.blend_distance = APPROXIMATION.reflection_probe_blend_distance_m
	probe.update_mode = APPROXIMATION.reflection_probe_update_mode
	probe.interior = APPROXIMATION.reflection_probe_interior
	probe.box_projection = APPROXIMATION.reflection_probe_box_projection
	probe.ambient_mode = APPROXIMATION.reflection_probe_ambient_mode
	parent.add_child(probe)
	probe.global_transform = Transform3D(Basis.IDENTITY, bounds.get_center())
	return probe


## Post-environment overrides, applied after configure_environment so exposure_ev adds to the layout's exposure.
## `exposure` is that layout exposure, 0 for a bare Environment (the test fixture). An empty tuning changes nothing.
static func apply_tuning(environment: Environment, tuning: Dictionary, exposure: float = 0.0) -> void:
	if tuning.has("agx_contrast"):
		environment.tonemap_agx_contrast = float(tuning.agx_contrast)
	if tuning.has("exposure_ev"):
		environment.tonemap_exposure = pow(2.0, exposure + float(tuning.exposure_ev))
	if tuning.has("ambient_energy"):
		environment.ambient_light_energy = float(tuning.ambient_energy)
	if tuning.has("ssao"):
		environment.ssao_enabled = bool(tuning.ssao)
	if tuning.get("gi", "none") == "sdfgi":
		environment.sdfgi_enabled = true
		if tuning.has("gi_energy"):
			environment.sdfgi_energy = float(tuning.gi_energy)


## The probe keeps APPROXIMATION's disabled ambient unless a sweep overrides it; no probe means nothing to apply.
## AMBIENT_COLOR also takes a colour: the parser only let it through with probe_ambient=color.
static func apply_probe_tuning(probe: ReflectionProbe, tuning: Dictionary) -> void:
	if probe == null:
		return
	if tuning.has("probe_ambient"):
		probe.ambient_mode = PROBE_AMBIENT_MODES[tuning.probe_ambient]
		if tuning.probe_ambient == "color":
			probe.ambient_color = probe_ambient_colour(tuning)
	if tuning.has("probe_ambient_energy"):
		probe.ambient_color_energy = float(tuning.probe_ambient_energy)


## `#rrggbb` is sRGB exactly as written, like every Color shown in the editor. Without one, ambient_color would stay
## black, which is why AMBIENT_COLOR defaults to APPROXIMATION.colour_linear made sRGB the way background() does.
static func probe_ambient_colour(tuning: Dictionary) -> Color:
	if tuning.has("probe_ambient_colour"):
		return Color.html(tuning.probe_ambient_colour)
	var linear: Array = APPROXIMATION.colour_linear
	return Color(linear[0], linear[1], linear[2]).linear_to_srgb()


## VoxelGI needs a non-degenerate box even for flat geometry (a floor slab, a facade), so every axis grows by a 0.5 m
## margin on each side with a 1 m minimum. Only empty bounds (no mesh at all) are an error; the caller returns null.
static func voxel_gi_box(bounds: AABB) -> AABB:
	if bounds.size == Vector3.ZERO:
		return AABB()
	var size := bounds.size + Vector3.ONE
	for axis in 3:
		size[axis] = maxf(size[axis], 1.0)
	return AABB(bounds.get_center() - size / 2.0, size)


## VoxelGI boxes the visible bounds like add_interior_probe, so its extents cover every mesh. bake() runs once the
## node is in the tree and before the first rendered frame; it needs a display, so the tests never call this.
static func add_voxel_gi(parent: Node3D) -> VoxelGI:
	var box := voxel_gi_box(visual_bounds(parent))
	if box.size == Vector3.ZERO:
		return null
	var voxel_gi := VoxelGI.new()
	voxel_gi.size = box.size
	parent.add_child(voxel_gi)
	voxel_gi.global_transform = Transform3D(Basis.IDENTITY, box.get_center())
	voxel_gi.bake()
	return voxel_gi


## Tag suffixes keep sweep runs apart; without a tag the names are exactly the G-4 ones.
## A tag ending in "_side" is rejected in parse_args because its stem would then equal another tag's
## "<stem>_side.png" side-by-side image, so one run would silently overwrite the other's file.
static func output_stem(layout: String, camera: String, tag: String) -> String:
	var stem := "%s_%s" % [layout, camera.validate_filename()]
	return stem + "_" + tag if not tag.is_empty() else stem


static func report_file_name(layout: String, tag: String) -> String:
	return "%s_%s_report.json" % [layout, tag] if not tag.is_empty() else layout + "_report.json"


## All four quadrants use the same subdivision, so many small spots cannot exhaust a tiny-light quadrant.
static func configure_shadow_atlas(viewport: Viewport) -> void:
	viewport.positional_shadow_atlas_size = APPROXIMATION.positional_shadow_atlas_size
	for quadrant in 4:
		viewport.set_positional_shadow_atlas_quadrant_subdiv(quadrant, APPROXIMATION.positional_shadow_atlas_quadrant_subdiv)


## One disk becomes one spot; a linear hint becomes evenly spaced spots following the imported hint's yaw.
## Blender local Y is glTF local -Z. Ignore colour_temp_k just as render_preview.py does; use its warm fixed colour.
## Input transform is already in Godot world coordinates. All resulting lights point down regardless of hint pitch.
static func hint_light_specs(extras: Dictionary, world: Transform3D, power: float) -> Array[Dictionary]:
	var kind := str(extras.get("kind", "linear_led"))
	var length := maxf(0.0, float(extras.get("length_m", APPROXIMATION.linear_led_default_length_m)))
	var watts := float(extras.get("watts", APPROXIMATION.disk_default_watts)) * power
	var count := 1
	if kind == "linear_led":
		watts = APPROXIMATION.linear_led_watts_per_m * length * power
		count = maxi(1, ceili(length / APPROXIMATION.linear_led_spacing_m))
	var axis := world.basis.x if str(extras.get("axis", "y")) == "x" else -world.basis.z
	axis.y = 0.0
	axis = axis.normalized()
	var colour := Color(1.0, 0.96, 0.9).linear_to_srgb()
	var specs: Array[Dictionary] = []
	for index in count:
		var offset := ((index + 0.5) / count - 0.5) * length if kind == "linear_led" else 0.0
		specs.append({
			"kind": kind,
			"position": world.origin + Vector3.DOWN * APPROXIMATION.hint_offset_m + axis * offset,
			"energy": maxf(0.0, watts) * APPROXIMATION.watts_to_energy / count,
			"colour": colour,
			"size_m": APPROXIMATION.linear_led_width_m if kind == "linear_led" else float(extras.get("size_m", APPROXIMATION.disk_default_size_m)),
		})
	return specs


## Read Godot 4.7's node metadata contract explicitly; never silently render a showcase whose extras were lost.
## This traversal only reads the node tree, so tests can use a tiny synthetic tree without any GLB or GPU.
## `*-colonly` nodes are collision proxies the export keeps visible; runtime GLTFDocument loading skips the editor
## importer's suffix handling, so they are returned for the caller to hide, as render_preview.py hides them.
static func inspect_scene(scene: Node) -> Dictionary:
	var showcase := {}
	var cameras := {}
	var hints: Array[Node3D] = []
	var collision_only: Array[Node3D] = []
	var errors: Array[String] = []
	var stack: Array[Node] = [scene]
	while not stack.is_empty():
		var node: Node = stack.pop_back()
		stack.append_array(node.get_children())
		var extras: Variant = node.get_meta("extras", {})
		if not extras is Dictionary:
			extras = {}
		if extras.get("gteki_showcase") is Dictionary:
			if not showcase.is_empty():
				errors.append("Multiple gteki_showcase nodes")
			showcase = extras.gteki_showcase
		if node is Camera3D:
			var name := str(node.name)
			if cameras.has(name):
				errors.append("Duplicate camera name: %s" % name)
			cameras[name] = node
		if str(node.name).begins_with("LIGHTHINT_") and node is Node3D:
			if not extras.has("light_hint"):
				errors.append("%s: missing light_hint in node metadata 'extras' (Godot 4.7 glTF contract)" % node.name)
			hints.append(node)
		if "-colonly" in str(node.name) and node is Node3D:
			collision_only.append(node)
	if showcase.is_empty():
		errors.append("No gteki_showcase node: expected node.get_meta(\"extras\")[\"gteki_showcase\"] (Godot 4.7 glTF contract)")
	return {"showcase": showcase, "cameras": cameras, "hints": hints, "collision_only": collision_only, "errors": errors}


static func find_repo_root(project_dir: String) -> String:
	var directory := project_dir.simplify_path().trim_suffix("/")
	while not directory.is_empty():
		if FileAccess.file_exists(directory.path_join("pnpm-workspace.yaml")):
			return directory
		var parent := directory.get_base_dir()
		if parent == directory:
			break
		directory = parent
	return ""


func fail(message: String) -> void:
	printerr("showcase_compare: ", message)
	quit(1)


func run() -> void:
	if DisplayServer.get_name() == "headless":
		print(HEADLESS_MESSAGE)
		quit(0)
		return
	var args := parse_args(OS.get_cmdline_user_args())
	if not args.errors.is_empty():
		fail("\n".join(args.errors))
		return
	if not FileAccess.file_exists(args.glb):
		fail("Missing GLB: %s" % args.glb)
		return
	var document := GLTFDocument.new()
	var state := GLTFState.new()
	var error := document.append_from_file(args.glb, state)
	if error != OK:
		fail("Cannot load GLB %s: %s" % [args.glb, error_string(error)])
		return
	var scene := document.generate_scene(state)
	if scene == null:
		fail("Cannot generate scene from GLB: %s" % args.glb)
		return
	var texture_report := prepare_textures(scene)
	root.add_child(scene)
	var info := inspect_scene(scene)
	if not info.errors.is_empty():
		fail("\n".join(info.errors))
		return
	for proxy: Node3D in info.collision_only:
		proxy.visible = false
	var layout := str(info.showcase.get("layout", ""))
	if layout.is_empty() or layout in [".", ".."] or layout.validate_filename() != layout:
		fail("gteki_showcase.layout must be a layout filename stem")
		return
	var repo := find_repo_root(ProjectSettings.globalize_path("res://"))
	var layout_path := repo.path_join("tools/blender/showcase/%s.json" % layout)
	if repo.is_empty() or not FileAccess.file_exists(layout_path):
		fail("Layout JSON missing: %s (find repo via pnpm-workspace.yaml)" % layout_path)
		return
	var parsed: Variant = JSON.parse_string(FileAccess.get_file_as_string(layout_path))
	if not parsed is Dictionary:
		fail("Cannot read layout JSON: %s" % layout_path)
		return
	var settings: Dictionary = parsed
	var cameras: Dictionary = info.cameras
	if cameras.is_empty() or (not args.camera.is_empty() and not cameras.has(args.camera)):
		fail("No matching imported Camera3D: %s" % args.camera)
		return
	for name: String in args.regions:
		if not cameras.has(name):
			fail("Region camera is not in the GLB: %s" % name)
			return
	var references := {}
	for name in args.refs:
		if not cameras.has(name):
			fail("Reference camera is not in the GLB: %s" % name)
			return
		var image := Image.load_from_file(args.refs[name])
		if image == null or image.is_empty():
			fail("Unreadable reference image: %s" % args.refs[name])
			return
		image.resize(WIDTH, HEIGHT, Image.INTERPOLATE_LANCZOS)
		image.convert(Image.FORMAT_RGBA8)
		references[name] = image
	var mode := str(settings.get("mode", "interior"))
	var exposure := float(settings.get("exposure", 0.0))
	apply_tuning(configure_environment(scene, mode, exposure), args.tuning, exposure)
	if mode == "studio":
		add_studio_lights(scene, bool(settings.get("ground", true)))
	var counts := {"linear_led": 0, "panel": 0, "indicator": 0}
	var spot_count := 0
	var hints_enabled := bool(settings.get("hint_lights", mode != "studio"))
	for hint: Node3D in info.hints:
		var extras: Dictionary = hint.get_meta("extras")
		var kind := str(extras.get("kind", "linear_led"))
		counts[kind] = int(counts.get(kind, 0)) + 1
		if hints_enabled:
			for spec in hint_light_specs(extras, hint.global_transform, float(settings.get("hint_power", 1.0))):
				add_hint_spot(scene, spec)
				spot_count += 1
	var probe := add_interior_probe(scene) if mode == "interior" else null
	apply_probe_tuning(probe, args.tuning)
	# VoxelGI is baked here: the scene is in the tree and no frame has been drawn yet.
	var voxel_gi: VoxelGI = null
	if args.tuning.get("gi", "none") == "voxelgi":
		voxel_gi = add_voxel_gi(scene)
		if voxel_gi == null:
			fail("VoxelGI needs visible mesh bounds")
			return
		if voxel_gi.data == null:
			fail("VoxelGI bake produced no data")
			return
		if args.tuning.has("gi_energy"):
			voxel_gi.data.energy = float(args.tuning.gi_energy)
	if DirAccess.make_dir_recursive_absolute(args.out_dir) != OK:
		fail("Cannot create output directory: %s" % args.out_dir)
		return
	root.size = Vector2i(WIDTH, HEIGHT)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	root.scaling_3d_scale = 1.0
	configure_shadow_atlas(root)
	var rendered: Array[String] = []
	var refs_used := {}
	var luminance := {}
	var names := cameras.keys()
	names.sort()
	for name: String in names:
		if not args.camera.is_empty() and args.camera != name:
			continue
		var camera: Camera3D = cameras[name]
		camera.keep_aspect = Camera3D.KEEP_HEIGHT
		camera.make_current()
		for frame in SETTLE_RENDER_FRAMES:
			await RenderingServer.frame_post_draw
		var image := root.get_texture().get_image()
		if image == null or image.is_empty() or image.get_size() != Vector2i(WIDTH, HEIGHT):
			fail("Viewport did not produce a 1600x900 image for %s" % name)
			return
		image.convert(Image.FORMAT_RGBA8)
		var stem := output_stem(layout, name, args.tag)
		error = image.save_png(str(args.out_dir).path_join(stem + ".png"))
		if error != OK:
			fail("Cannot save %s.png: %s" % [stem, error_string(error)])
			return
		if references.has(name):
			var side := Image.create(WIDTH * 2, HEIGHT, false, Image.FORMAT_RGBA8)
			side.blit_rect(references[name], Rect2i(0, 0, WIDTH, HEIGHT), Vector2i.ZERO)
			side.blit_rect(image, Rect2i(0, 0, WIDTH, HEIGHT), Vector2i(WIDTH, 0))
			error = side.save_png(str(args.out_dir).path_join(stem + "_side.png"))
			if error != OK:
				fail("Cannot save %s_side.png: %s" % [stem, error_string(error)])
				return
			refs_used[name] = args.refs[name]
			var luminance_regions := default_regions(Vector2i(WIDTH, HEIGHT))
			luminance_regions.append_array(args.regions.get(name, []))
			luminance[name] = luminance_stats(references[name], image, luminance_regions)
		rendered.append(name)
		print("showcase_compare: wrote ", stem)
	var report := {
		"contract": "gteki.showcase-compare/0.1",
		"glb": args.glb, "sha256": FileAccess.get_sha256(args.glb),
		"layout": layout, "mode": mode, "exposure": exposure, "tuning": args.tuning,
		"cameras": rendered, "refs": refs_used,
		"luminance": luminance, "luminance_method": LUMINANCE_METHOD,
		"renderer": RenderingServer.get_current_rendering_method(),
		"project_renderer": str(ProjectSettings.get_setting("rendering/renderer/rendering_method")),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"resolution": [WIDTH, HEIGHT], "hint_light_counts": counts,
		"hint_lights_enabled": hints_enabled, "spot_count": spot_count,
		"collision_only_hidden": info.collision_only.size(),
		"textures": texture_report,
		"reflection_probe_count": 1 if probe != null else 0,
		"reflection_probe_size_m": [probe.size.x, probe.size.y, probe.size.z] if probe != null else [],
		"reflection_probe_position_m": [probe.global_position.x, probe.global_position.y, probe.global_position.z] if probe != null else [],
		"approximation": APPROXIMATION, "settle_render_frames": SETTLE_RENDER_FRAMES,
	}
	var report_path: String = args.report
	if report_path.is_empty():
		report_path = str(args.out_dir).path_join(report_file_name(layout, args.tag))
	var report_dir := report_path.get_base_dir()
	if DirAccess.make_dir_recursive_absolute(report_dir) != OK:
		fail("Cannot create report directory: %s" % report_dir)
		return
	var file := FileAccess.open(report_path, FileAccess.WRITE)
	if file == null:
		fail("Cannot write report: %s" % report_path)
		return
	file.store_string(JSON.stringify(report, "\t") + "\n")
	file.close()
	quit(0)


static func configure_environment(parent: Node3D, mode: String, exposure: float) -> Environment:
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	var bg := background(mode)
	environment.background_mode = APPROXIMATION.background_mode
	environment.background_color = bg.colour
	environment.background_energy_multiplier = bg.strength
	environment.sky = uniform_sky(mode)
	environment.ambient_light_source = APPROXIMATION.ambient_light_source
	environment.ambient_light_sky_contribution = APPROXIMATION.ambient_light_sky_contribution
	environment.reflected_light_source = APPROXIMATION.reflected_light_source
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_agx_contrast = APPROXIMATION.agx_contrast
	environment.tonemap_exposure = pow(2.0, exposure)
	environment.ssao_enabled = true
	world.environment = environment
	parent.add_child(world)
	return environment


static func add_studio_lights(parent: Node3D, ground: bool) -> void:
	var sun := DirectionalLight3D.new()
	sun.basis = sun_basis()
	sun.light_energy = APPROXIMATION.sun_blender_energy * APPROXIMATION.sun_energy_factor
	sun.light_angular_distance = APPROXIMATION.sun_angular_distance_deg
	sun.shadow_enabled = true
	parent.add_child(sun)
	if ground:
		var floor_mesh := PlaneMesh.new()
		floor_mesh.size = Vector2(200.0, 200.0)
		var material := StandardMaterial3D.new()
		material.albedo_color = Color(0.32, 0.33, 0.34).linear_to_srgb()
		material.roughness = 0.8
		floor_mesh.material = material
		var floor_node := MeshInstance3D.new()
		floor_node.mesh = floor_mesh
		floor_node.position.y = -0.001
		parent.add_child(floor_node)


static func add_hint_spot(parent: Node3D, spec: Dictionary) -> SpotLight3D:
	var light := SpotLight3D.new()
	parent.add_child(light)
	light.global_position = spec.position
	# Spots emit along local -Z; -90 degrees about X maps -Z to world -Y.
	light.global_basis = Basis(Vector3.RIGHT, -PI / 2.0)
	light.light_color = spec.colour
	light.light_energy = spec.energy
	light.light_size = float(spec.size_m) / 2.0
	light.spot_angle = APPROXIMATION.spot_angle_deg
	light.spot_range = APPROXIMATION.spot_range_m
	light.spot_attenuation = APPROXIMATION.spot_attenuation
	light.spot_angle_attenuation = APPROXIMATION.spot_angle_attenuation
	light.shadow_enabled = true
	light.shadow_bias = APPROXIMATION.spot_shadow_bias
	light.shadow_normal_bias = APPROXIMATION.spot_shadow_normal_bias
	return light
