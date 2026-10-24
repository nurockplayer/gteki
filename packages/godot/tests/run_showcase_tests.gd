extends SceneTree
## G-4 showcase helper checks: no GLB, display, GPU or reference images needed.
## Run: lockf -k /tmp/gteki-local-test.lock godot --headless --path packages/godot --script res://tests/run_showcase_tests.gd
## The actual tool's headless early exit can also be invoked under the same lock; it prints HEADLESS_MESSAGE and
## exits zero even with missing arguments, before importing a GLB or creating an output directory.

const Compare = preload("res://tools/showcase_compare.gd")

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
	check_arguments()
	check_sun()
	check_background()
	check_textures()
	check_reflections_and_shadows()
	check_hints()
	check_metadata()
	check_luminance()
	check_tuning()
	check_tuning_extras()
	check(DisplayServer.get_name() == "headless", "suite runs without a display")
	check(Compare.HEADLESS_MESSAGE == "showcase_compare needs a display", "headless early-exit message")
	if failures.is_empty():
		print("PASS: GTEki Godot showcase compare (%d checks)" % checks)
	else:
		printerr("FAIL: %d of %d showcase checks failed:\n  %s" % [failures.size(), checks, "\n  ".join(failures)])
	quit(0 if failures.is_empty() else 1)


func check_arguments() -> void:
	var defaults := Compare.parse_args(PackedStringArray(["/tmp/demo.glb", "/tmp/showcase"]))
	check(defaults.errors.is_empty() and defaults.camera == "" and defaults.refs.is_empty(), "absolute positional arguments, all cameras by default")
	var selected := Compare.parse_args(PackedStringArray([
		"/tmp/demo.glb", "/tmp/showcase", "--camera=gates_closed",
		"--ref=gates_closed=/tmp/reference=a.jpg", "--ref=hero=/tmp/hero image.jpg",
	]))
	check(selected.errors.is_empty() and selected.camera == "gates_closed", "camera and repeated references parse")
	check(selected.refs == {"gates_closed": "/tmp/reference=a.jpg", "hero": "/tmp/hero image.jpg"}, "reference paths preserve spaces and equals signs")
	for args in [
		[], ["/tmp/demo.glb"], ["/tmp/a", "/tmp/b", "/tmp/c"],
		["demo.glb", "/tmp/out"], ["/tmp/a", "out"], ["res://demo.glb", "/tmp/out"],
		["/tmp/a", "/tmp/b", "--ref=hero=ref.jpg"],
		["/tmp/a", "/tmp/b", "--ref=hero=user://ref.jpg"],
		["/tmp/a", "/tmp/b", "--ref=hero"], ["/tmp/a", "/tmp/b", "--ref==/tmp/ref"],
		["/tmp/a", "/tmp/b", "--ref=hero="], ["/tmp/a", "/tmp/b", "--camera="],
		["/tmp/a", "/tmp/b", "--unknown"],
		["/tmp/a", "/tmp/b", "--camera=a", "--camera=b"],
		["/tmp/a", "/tmp/b", "--ref=hero=/tmp/a", "--ref=hero=/tmp/b"],
	]:
		var bad := Compare.parse_args(PackedStringArray(args))
		check(not bad.errors.is_empty(), "reject malformed/relative arguments: %s" % str(args))
	check(Compare.find_repo_root(ProjectSettings.globalize_path("res://")).path_join("pnpm-workspace.yaml") == ProjectSettings.globalize_path("res://../../pnpm-workspace.yaml").simplify_path(), "find repository marker by walking up from project")


func check_sun() -> void:
	var basis := Compare.sun_basis()
	# Independent Rz * Ry * Rx evaluation, followed by (x,z,-y), for Blender's emission vector (0,0,-1).
	var expected := Vector3(-0.5308178895, -0.6330222216, -0.5634849024)
	check((-basis.z).distance_to(expected) < 0.000001, "Blender sun Euler XYZ keeps its emission direction in Godot")
	check(is_equal_approx(basis.determinant(), 1.0), "sun conversion preserves handedness")
	check(basis.is_equal_approx(basis.orthonormalized()), "sun basis is orthonormal")
	check((-Compare.sun_basis(Vector3.ZERO).z).is_equal_approx(Vector3.DOWN), "unrotated Blender sun shines down in Godot")
	check(is_equal_approx(Compare.APPROXIMATION.sun_energy_factor, 1.0 / PI), "nonphysical sun cancels Godot's PI energy multiplier")
	var scene := Node3D.new()
	Compare.add_studio_lights(scene, false)
	var sun: DirectionalLight3D = scene.get_child(0)
	check(is_equal_approx(sun.light_energy, 3.0 / PI), "studio sun uses Blender irradiance 3 / PI")
	scene.free()


## Independent IEC sRGB transfer, rather than expecting the helper's own Color conversion result.
static func encode_srgb(value: float) -> float:
	return value * 12.92 if value <= 0.0031308 else 1.055 * pow(value, 1.0 / 2.4) - 0.055


func check_background() -> void:
	for mode in ["interior", "studio"]:
		var bg := Compare.background(mode)
		var linear := [0.55, 0.58, 0.62] if mode == "studio" else [0.02, 0.022, 0.025]
		var colour: Color = bg.colour
		check(absf(colour.r - encode_srgb(linear[0])) < 0.000001, "%s world red linear -> sRGB" % mode)
		check(absf(colour.g - encode_srgb(linear[1])) < 0.000001, "%s world green linear -> sRGB" % mode)
		check(absf(colour.b - encode_srgb(linear[2])) < 0.000001, "%s world blue linear -> sRGB" % mode)
		check(is_equal_approx(bg.strength, 0.9 if mode == "studio" else 1.0), "%s world strength is separate from colour" % mode)
		var scene := Node3D.new()
		var env := Compare.configure_environment(scene, mode, 0.5)
		var sky_material: ShaderMaterial = env.sky.sky_material
		check(sky_material.get_shader_parameter("colour") == colour, "%s uniform sky equals background colour" % mode)
		check("COLOR = colour.rgb;" in sky_material.shader.code and "source_color" in sky_material.shader.code, "%s sky is uniform and decodes its sRGB colour" % mode)
		check(env.background_mode == Environment.BG_SKY and is_equal_approx(env.background_energy_multiplier, bg.strength), "%s sky retains background strength" % mode)
		check(env.ambient_light_source == Environment.AMBIENT_SOURCE_SKY and env.reflected_light_source == Environment.REFLECTION_SOURCE_SKY and is_equal_approx(env.ambient_light_sky_contribution, 1.0), "%s sky supplies ambient and reflections" % mode)
		check(is_equal_approx(env.tonemap_agx_contrast, 1.5) and is_equal_approx(env.tonemap_exposure, sqrt(2.0)), "%s AgX contrast approximation retains layout exposure" % mode)
		scene.free()


func check_textures() -> void:
	var scene := Node3D.new()
	var image := Image.create(8, 8, false, Image.FORMAT_RGBA8)
	image.fill(Color(0.2, 0.4, 0.6))
	var shared := ImageTexture.create_from_image(image)
	check(not shared.get_image().has_mipmaps(), "synthetic shared texture starts without mipmaps")
	image.generate_mipmaps()
	var ready := ImageTexture.create_from_image(image)
	var materials: Array[StandardMaterial3D] = []
	for index in 4:
		var material := StandardMaterial3D.new()
		material.albedo_texture = shared
		materials.append(material)
	materials[0].normal_texture = shared
	materials[1].roughness_texture = ready
	var mesh := BoxMesh.new()
	mesh.material = materials[0]
	var node := MeshInstance3D.new()
	node.mesh = mesh
	node.set_surface_override_material(0, materials[1])
	node.material_override = materials[2]
	node.material_overlay = materials[3]
	scene.add_child(node)
	var report := Compare.prepare_textures(scene)
	check(report.textures_processed == 3 and report.mipmaps_generated == 2 and report.mipmap_failures == 0, "shared texture is processed once per mip kind (colour, normal) across slots and overrides")
	var replacement: Texture2D = materials[0].albedo_texture
	check(replacement != shared and replacement.get_image().has_mipmaps(), "missing mipmaps are generated in a rebuilt texture")
	check(replacement.get_image().get_pixel(0, 0).is_equal_approx(shared.get_image().get_pixel(0, 0)), "mipmap generation preserves base-level pixels")
	for material in materials:
		check(material.albedo_texture == replacement and material.texture_filter == BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS_ANISOTROPIC, "mesh, surface override, global override and overlay share the filtered replacement")
	var normal_replacement: Texture2D = materials[0].normal_texture
	check(normal_replacement != shared and normal_replacement != replacement and normal_replacement.get_image().has_mipmaps(), "a texture used as a normal map gets its own renormalised mip chain")
	check(materials[1].roughness_texture == ready, "all slots are visited and existing mipmapped textures retained")
	check(Compare.prepare_textures(scene).mipmaps_generated == 0, "second texture pass rebuilds nothing")
	scene.free()


func check_reflections_and_shadows() -> void:
	var scene := Node3D.new()
	root.add_child(scene)
	scene.position = Vector3(10, 1, -5)
	var node := MeshInstance3D.new()
	var mesh := BoxMesh.new()
	mesh.size = Vector3(4, 2, 6)
	node.mesh = mesh
	scene.add_child(node)
	var proxy := MeshInstance3D.new()
	proxy.name = "room-colonly"
	proxy.mesh = mesh
	proxy.position = Vector3(100, 100, 100)
	scene.add_child(proxy)
	var hidden := Node3D.new()
	hidden.visible = false
	scene.add_child(hidden)
	var hidden_mesh := MeshInstance3D.new()
	hidden_mesh.mesh = mesh
	hidden_mesh.position = Vector3(-100, -100, -100)
	hidden.add_child(hidden_mesh)
	var bounds := Compare.visual_bounds(scene)
	check(bounds.size.is_equal_approx(mesh.size) and bounds.get_center().is_equal_approx(scene.position), "visual bounds exclude collision proxies and hidden subtrees")
	var probe := Compare.add_interior_probe(scene)
	var blend: float = Compare.APPROXIMATION.reflection_probe_blend_distance_m
	check(probe != null and probe.size.is_equal_approx(bounds.size + Vector3.ONE * 2.0 * blend) and probe.global_position.is_equal_approx(bounds.get_center()), "room probe is the visible global AABB grown by its blend distance")
	check(is_equal_approx(probe.blend_distance, blend), "room probe blend distance comes from APPROXIMATION")
	check(probe.update_mode == ReflectionProbe.UPDATE_ONCE and not probe.interior and probe.box_projection and probe.ambient_mode == ReflectionProbe.AMBIENT_DISABLED, "room probe captures once with box projection, keeps the sky in reflections and preserves sky ambient")
	Compare.configure_shadow_atlas(root)
	check(root.positional_shadow_atlas_size == 8192, "shadow atlas is explicitly 8192 pixels")
	for quadrant in 4:
		check(root.get_positional_shadow_atlas_quadrant_subdiv(quadrant) == Viewport.SHADOW_ATLAS_QUADRANT_SUBDIV_64, "each atlas quadrant reserves 64 shadow maps (256 total, 512 px each)")
	var spot := Compare.add_hint_spot(scene, Compare.hint_light_specs({"kind": "panel"}, Transform3D.IDENTITY, 1.0)[0])
	check(spot.shadow_enabled and is_equal_approx(spot.shadow_bias, 0.06) and is_equal_approx(spot.shadow_normal_bias, 1.5), "spots use raised depth and normal biases")
	scene.free()


func check_hints() -> void:
	var world := Transform3D(Basis(Vector3.UP, PI / 2.0), Vector3(2, 3, 4))
	var led := Compare.hint_light_specs({"kind": "linear_led", "length_m": 3.0, "axis": "x"}, world, 2.0)
	check(led.size() == 2, "3 m LED uses two spots")
	check(led[0].kind == "linear_led" and led[1].kind == "linear_led", "specs retain hint kind")
	check(led[0].position.is_equal_approx(Vector3(2, 2.97, 4.75)), "LED row follows transformed X and sits 3 cm below hint")
	check(led[1].position.is_equal_approx(Vector3(2, 2.97, 3.25)), "LED samples are symmetric cell midpoints")
	check(is_equal_approx(led[0].energy + led[1].energy, 6.6), "row conserves 55 W/m * 3 m * power 2 * energy factor 0.02")
	var y_led := Compare.hint_light_specs({"kind": "linear_led", "length_m": 3.0, "axis": "y"}, world, 1.0)
	check(y_led[0].position.is_equal_approx(Vector3(2.75, 2.97, 4)), "Blender Y row follows imported local -Z, including yaw")
	var short_led := Compare.hint_light_specs({"length_m": 0.5}, Transform3D.IDENTITY, 1.0)
	check(short_led.size() == 1 and is_equal_approx(short_led[0].energy, 0.55), "short default-kind LED uses one centered spot")
	for kind in ["panel", "indicator"]:
		var hint := {"kind": kind, "watts": 40.0, "size_m": 0.4, "colour_temp_k": 2000.0}
		var disk := Compare.hint_light_specs(hint, world, 0.5)
		check(disk.size() == 1 and disk[0].kind == kind, "%s disk uses one spot" % kind)
		check(disk[0].position.is_equal_approx(Vector3(2, 2.97, 4)), "%s centered below hint" % kind)
		check(is_equal_approx(disk[0].energy, 0.4) and is_equal_approx(disk[0].size_m, 0.4), "%s disk watts, power and size" % kind)
		hint.colour_temp_k = 9000.0
		check(disk[0].colour == Compare.hint_light_specs(hint, world, 0.5)[0].colour, "%s ignores colour temperature like Blender" % kind)
		var colour: Color = disk[0].colour
		check(absf(colour.g - encode_srgb(0.96)) < 0.000001 and absf(colour.b - encode_srgb(0.9)) < 0.000001, "%s uses Blender's fixed warm linear colour" % kind)
	check(is_zero_approx(Compare.hint_light_specs({"kind": "panel"}, world, 0.0)[0].energy), "zero hint_power emits no energy")


func check_metadata() -> void:
	var scene := Node3D.new()
	var showcase := Node3D.new()
	showcase.name = "SHOWCASE_fixture"
	showcase.set_meta("extras", {"gteki_showcase": {"layout": "fixture", "cameras": ["hero"]}})
	scene.add_child(showcase)
	var camera := Camera3D.new()
	camera.name = "hero"
	camera.fov = 48.0
	camera.set_meta("extras", {"gteki_camera": {"lens_mm": 22.0}})
	showcase.add_child(camera)
	var hint := Node3D.new()
	hint.name = "LIGHTHINT_fixture"
	hint.set_meta("extras", {"light_hint": "fixture", "kind": "panel", "watts": 40.0})
	showcase.add_child(hint)
	var proxy := MeshInstance3D.new()
	proxy.name = "COL_bench-colonly"
	showcase.add_child(proxy)
	var info := Compare.inspect_scene(scene)
	check(info.errors.is_empty() and info.showcase.layout == "fixture", "nested gteki_showcase comes from extras metadata")
	check(info.cameras.get("hero") == camera and camera.fov == 48.0, "inspection retains imported Camera3D and its FOV")
	check(info.hints.size() == 1 and info.hints[0] == hint, "inspection finds LIGHTHINT nodes with extras")
	check(info.collision_only.size() == 1 and info.collision_only[0] == proxy, "inspection returns -colonly proxies to hide")
	hint.remove_meta("extras")
	check("metadata 'extras'" in "\n".join(Compare.inspect_scene(scene).errors), "lost hint extras fail clearly")
	showcase.remove_meta("extras")
	check("No gteki_showcase node" in "\n".join(Compare.inspect_scene(scene).errors), "lost showcase extras fail clearly")
	scene.free()


func solid(size: Vector2i, colour: Color) -> Image:
	var image := Image.create(size.x, size.y, false, Image.FORMAT_RGBA8)
	image.fill(colour)
	return image


func check_luminance() -> void:
	var whole := [{"name": "all", "rect": Rect2i(0, 0, 8, 8)}]
	var same := Compare.luminance_stats(solid(Vector2i(8, 8), Color(0.5, 0.25, 0.75)), solid(Vector2i(8, 8), Color(0.5, 0.25, 0.75)), whole)
	check(is_equal_approx(same.all.ratio, 1.0), "identical images give luminance ratio 1.0")
	# Halve the linear light of a grey reference; the expected ratio is decoded from the stored 8-bit pixels in the test.
	var reference := solid(Vector2i(8, 8), Color(0.8, 0.8, 0.8))
	var half := solid(Vector2i(8, 8), (Color(0.8, 0.8, 0.8).srgb_to_linear() * 0.5).linear_to_srgb())
	var expected := half.get_pixel(0, 0).srgb_to_linear().r / reference.get_pixel(0, 0).srgb_to_linear().r
	var halved := Compare.luminance_stats(reference, half, whole)
	check(absf(halved.all.ratio - snappedf(expected, 0.0001)) < 0.0001, "half-bright godot image gives the decoded linear ratio (%s)" % str(halved.all.ratio))
	check(is_equal_approx(halved.all.reference, snappedf(reference.get_pixel(0, 0).srgb_to_linear().r, 0.0001)), "grey reference mean equals its decoded linear value")
	# Rec.709 weighting: pure green is 0.7152 of linear luminance, pure red 0.2126.
	var colours := Compare.luminance_stats(solid(Vector2i(8, 8), Color.GREEN), solid(Vector2i(8, 8), Color.RED), whole)
	check(is_equal_approx(colours.all.reference, 0.7152) and is_equal_approx(colours.all.godot, 0.2126), "Rec.709 weights green 0.7152 and red 0.2126")
	# A black reference has a zero mean in its black half, so that region's ratio is null rather than a division by zero.
	var black := solid(Vector2i(8, 8), Color.BLACK)
	black.fill_rect(Rect2i(0, 4, 8, 4), Color(0.5, 0.5, 0.5))
	var split := Compare.luminance_stats(black, solid(Vector2i(8, 8), Color(0.5, 0.5, 0.5)), [
		{"name": "dark", "rect": Rect2i(0, 0, 8, 4)},
		{"name": "lit", "rect": Rect2i(0, 4, 8, 4)},
	])
	check(split.dark.ratio == null and split.dark.reference == 0.0, "zero reference mean gives a null ratio")
	check(is_equal_approx(split.lit.ratio, 1.0), "lit region of the same reference still gives a ratio")
	# Bands cover every row exactly once, with the bottom band taking the odd remainder.
	var rows := []
	rows.resize(7)
	rows.fill(0)
	var regions := Compare.default_regions(Vector2i(4, 7))
	check(regions.size() == 4 and regions[0].name == "whole" and regions[0].rect == Rect2i(0, 0, 4, 7), "default regions start with the whole frame")
	for region: Dictionary in regions.slice(1):
		var rect: Rect2i = region.rect
		for y in range(rect.position.y, rect.end.y):
			rows[y] += 1
	check(rows == [1, 1, 1, 1, 1, 1, 1], "top, middle and bottom thirds cover every row of a 7-row image exactly once")
	# --region= accepts a well-formed value and rejects malformed or out-of-frame ones.
	var good := Compare.parse_args(PackedStringArray(["/tmp/a", "/tmp/b", "--region=hero=face:0,0,10,20"]))
	check(good.errors.is_empty() and good.regions.hero.size() == 1 and good.regions.hero[0].name == "face" and good.regions.hero[0].rect == Rect2i(0, 0, 10, 20), "--region=<camera>=<name>:<x>,<y>,<w>,<h> parses")
	var odd := Compare.parse_args(PackedStringArray(["/tmp/a", "/tmp/b", "--region=hall=west:x=face:0,0,10,10"]))
	check(odd.errors.is_empty() and odd.regions.has("hall=west:x") and odd.regions["hall=west:x"][0].name == "face", "--region camera names may contain '=' and ':'")
	for spec in [
		"hero=face:0,0,10", "hero=:0,0,10,10", "hero=face:1500,0,200,10", "hero=face:0,0,0,10",
		"hero=whole:0,0,10,10", "hero=face:a,0,1,1", "hero", "=face:0,0,1,1",
		"hero=face:4294967297,0,10,10", "hero=face:0,0,4294967297,10", "hero=face:1599,0,9223372036854775807,1",
		"hero=   :0,0,10,10", "hero=gate:floor:0,0,10,10",
	]:
		var bad := Compare.parse_args(PackedStringArray(["/tmp/a", "/tmp/b", "--region=" + spec]))
		check(not bad.errors.is_empty(), "reject malformed --region value: %s" % spec)


func parse_with(extra: Array) -> Dictionary:
	var args := PackedStringArray(["/tmp/a.glb", "/tmp/out"])
	for arg: String in extra:
		args.append(arg)
	return Compare.parse_args(args)


## --tune overrides and --tag: parsing, application to a bare Environment/ReflectionProbe, and file naming.
## VoxelGI baking needs a display, so add_voxel_gi itself is only exercised in the lead's GPU slot.
func check_tuning() -> void:
	var none := parse_with([])
	check(none.errors.is_empty() and none.tuning.is_empty() and none.tag == "", "no --tune gives an empty tuning dict and no tag")
	var tuned := parse_with([
		"--tune=agx_contrast=1.2", "--tune=exposure_ev=-1.5", "--tune=ambient_energy=3.5",
		"--tune=gi=sdfgi", "--tune=gi_energy=2.0", "--tune=probe_ambient=color",
		"--tune=probe_ambient_energy=4.0", "--tune=ssao=false", "--tag=sweep_1",
	])
	check(tuned.errors.is_empty(), "--tune and --tag parse: %s" % str(tuned.errors))
	check(tuned.tuning.size() == 8 and is_equal_approx(tuned.tuning.agx_contrast, 1.2) and is_equal_approx(tuned.tuning.exposure_ev, -1.5), "float overrides keep their parsed values")
	check(is_equal_approx(tuned.tuning.ambient_energy, 3.5) and is_equal_approx(tuned.tuning.gi_energy, 2.0) and is_equal_approx(tuned.tuning.probe_ambient_energy, 4.0), "energy overrides keep their parsed values")
	check(tuned.tuning.gi == "sdfgi" and tuned.tuning.probe_ambient == "color" and tuned.tuning.ssao == false, "enum and bool overrides keep their parsed types")
	check(tuned.tag == "sweep_1", "--tag keeps its name")
	for spec in [
		"--tune=agx_contrast=0.4", "--tune=agx_contrast=2.6", "--tune=agx_contrast=high",
		"--tune=exposure_ev=-4.1", "--tune=exposure_ev=4.1", "--tune=ambient_energy=-0.1",
		"--tune=ambient_energy=16.1", "--tune=probe_ambient_energy=16.5", "--tune=gi=rtx",
		"--tune=probe_ambient=sky", "--tune=ssao=yes", "--tune=ssao=TRUE", "--tune=sun_energy=2",
		"--tune", "--tune=", "--tune=ssao", "--tune==1", "--tag=", "--tag=two words", "--tag=bad/tag",
	]:
		check(not parse_with([spec]).errors.is_empty(), "reject malformed --tune/--tag value: %s" % spec)
	check(not parse_with(["--tune=gi_energy=1.0"]).errors.is_empty(), "gi_energy without a GI mode is rejected")
	check(not parse_with(["--tune=gi=none", "--tune=gi_energy=1.0"]).errors.is_empty(), "gi_energy with gi=none is rejected")
	check(not parse_with(["--tune=gi=sdfgi", "--tune=gi=voxelgi"]).errors.is_empty(), "duplicate --tune keys are rejected")
	check(not parse_with(["--tune=agx_contrast=9", "--tune=agx_contrast=1.0"]).errors.is_empty(), "a duplicate is rejected even when the first value was invalid")
	check(not parse_with(["--tag=a", "--tag=b"]).errors.is_empty(), "duplicate --tag arguments are rejected")
	# A tag ending in "_side" would make its stem collide with another tag's side-by-side image name.
	check(not parse_with(["--tag=baseline_side"]).errors.is_empty(), "a --tag ending in _side is rejected")
	check(parse_with(["--tag=side"]).errors.is_empty(), "--tag=side is accepted (the suffix is _side, not side)")
	check(parse_with(["--tag=sidewalk"]).errors.is_empty(), "--tag=sidewalk is accepted")
	check(parse_with(["--tag=side"]).tag == "side", "--tag=side keeps its name")
	for spec in [
		"--tune=agx_contrast=0.5", "--tune=agx_contrast=2.5", "--tune=exposure_ev=-4",
		"--tune=exposure_ev=4", "--tune=ambient_energy=0", "--tune=ambient_energy=16",
		"--tune=gi=none", "--tune=probe_ambient=disabled",
	]:
		check(parse_with([spec]).errors.is_empty(), "accept the range boundary: %s" % spec)
	check(parse_with(["--tune=gi=voxelgi", "--tune=gi_energy=16"]).errors.is_empty(), "gi_energy is accepted with voxelgi")
	# --report writes exactly where the sweep says; it must be absolute, and only once.
	check(parse_with(["--report=/tmp/out/custom_report.json"]).errors.is_empty() and parse_with(["--report=/tmp/out/custom_report.json"]).report == "/tmp/out/custom_report.json", "--report accepts and keeps an absolute path")
	check(not parse_with(["--report=custom_report.json"]).errors.is_empty(), "relative --report is rejected")
	check(not parse_with(["--report="]).errors.is_empty(), "empty --report is rejected")
	check(not parse_with(["--report=/tmp/a.json", "--report=/tmp/b.json"]).errors.is_empty(), "duplicate --report is rejected")
	check(parse_with([]).report == "", "no --report keeps the layout-derived report name")
	# ReflectionProbe's ambient colour and energy only reach the renderer in AMBIENT_COLOR mode.
	check(not parse_with(["--tune=probe_ambient_energy=1"]).errors.is_empty(), "probe_ambient_energy without probe_ambient=color is rejected")
	check(not parse_with(["--tune=probe_ambient=environment", "--tune=probe_ambient_energy=1"]).errors.is_empty(), "probe_ambient_energy with probe_ambient=environment is rejected")
	check(not parse_with(["--tune=probe_ambient_colour=#204060"]).errors.is_empty(), "probe_ambient_colour without probe_ambient=color is rejected")
	var coloured := parse_with(["--tune=probe_ambient=color", "--tune=probe_ambient_energy=2.5", "--tune=probe_ambient_colour=#204060"])
	check(coloured.errors.is_empty() and coloured.tuning.probe_ambient_colour == "#204060", "probe_ambient=color accepts a colour and its energy")
	for value in ["#fff", "204060", "#gg0000", "#2040607"]:
		check(not parse_with(["--tune=probe_ambient=color", "--tune=probe_ambient_colour=" + value]).errors.is_empty(), "reject malformed probe_ambient_colour: %s" % value)
	# Application on a bare Environment: exposure_ev adds to the layout exposure, 0 here.
	var untouched := Environment.new()
	var environment := Environment.new()
	Compare.apply_tuning(environment, {})
	check(not environment.ssao_enabled and not environment.sdfgi_enabled and is_equal_approx(environment.tonemap_agx_contrast, untouched.tonemap_agx_contrast) and is_equal_approx(environment.tonemap_exposure, untouched.tonemap_exposure) and is_equal_approx(environment.ambient_light_energy, untouched.ambient_light_energy), "empty tuning leaves every environment field at its default")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"agx_contrast": 0.7, "exposure_ev": -1.0, "ambient_energy": 4.0, "ssao": true})
	check(is_equal_approx(environment.tonemap_agx_contrast, 0.7), "agx_contrast applies to the environment")
	check(is_equal_approx(environment.tonemap_exposure, 0.5), "exposure_ev stops the layout exposure down")
	check(is_equal_approx(environment.ambient_light_energy, 4.0), "ambient_energy applies to the environment")
	check(environment.ssao_enabled, "ssao=true applies to the environment")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"exposure_ev": 1.0}, 0.5)
	check(is_equal_approx(environment.tonemap_exposure, pow(2.0, 1.5)), "exposure_ev adds to a layout exposure of 0.5 (2^1.5)")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"gi": "sdfgi", "gi_energy": 2.0})
	check(environment.sdfgi_enabled and is_equal_approx(environment.sdfgi_energy, 2.0), "gi=sdfgi enables SDFGI with gi_energy")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"gi": "sdfgi"})
	check(environment.sdfgi_enabled and is_equal_approx(environment.sdfgi_energy, untouched.sdfgi_energy), "sdfgi without gi_energy keeps the engine default energy")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"gi": "voxelgi", "gi_energy": 3.0})
	check(not environment.sdfgi_enabled, "gi=voxelgi does not enable SDFGI")
	# Probe overrides on a bare probe; VoxelGI itself is the node helper, tested only on the GPU.
	var probe := ReflectionProbe.new()
	# A bare probe defaults to AMBIENT_ENVIRONMENT; add_interior_probe is what applies APPROXIMATION's disabled mode.
	Compare.apply_probe_tuning(probe, {})
	check(probe.ambient_mode == ReflectionProbe.AMBIENT_ENVIRONMENT, "empty tuning leaves the bare probe's ambient mode untouched")
	Compare.apply_probe_tuning(probe, {"probe_ambient": "environment"})
	check(probe.ambient_mode == ReflectionProbe.AMBIENT_ENVIRONMENT, "probe_ambient=environment applies to the probe")
	Compare.apply_probe_tuning(probe, {"probe_ambient": "color", "probe_ambient_energy": 2.5})
	check(probe.ambient_mode == ReflectionProbe.AMBIENT_COLOR and is_equal_approx(probe.ambient_color_energy, 2.5), "probe_ambient=color applies its energy to the probe")
	check(probe.ambient_color.is_equal_approx(Color(1.0, 0.96, 0.9).linear_to_srgb()), "probe_ambient=color without a colour uses APPROXIMATION.colour_linear as sRGB")
	Compare.apply_probe_tuning(probe, {"probe_ambient": "color", "probe_ambient_colour": "#204060"})
	check(probe.ambient_color.is_equal_approx(Color.html("#204060")), "probe_ambient_colour is sRGB exactly as written")
	# A detached ReflectionProbe owns a scene-cull instance; free it so the suite exits without a leak warning.
	probe.free()
	# VoxelGI boxes flat geometry too: a 0.5 m margin per side, at least 1 m per axis, empty bounds skipped.
	var flat := AABB(Vector3(-2, 3, -1), Vector3(4, 0, 6))
	var flat_box := Compare.voxel_gi_box(flat)
	check(flat_box.size.is_equal_approx(Vector3(5, 1, 7)) and flat_box.get_center().is_equal_approx(flat.get_center()), "flat bounds grow by 0.5 m per side with a 1 m minimum axis")
	check(Compare.voxel_gi_box(AABB(Vector3(-2, 0, -3), Vector3(4, 2, 6))).size.is_equal_approx(Vector3(5, 3, 7)), "a normal box grows by 0.5 m on every side")
	check(Compare.voxel_gi_box(AABB()).size == Vector3.ZERO, "empty bounds stay empty so the caller can skip VoxelGI")
	# Names: no tag keeps the G-4 output names; a tag suffixes the PNG, side PNG and report alike.
	check(Compare.output_stem("concourse", "gates_closed", "") == "concourse_gates_closed", "no tag keeps the G-4 PNG name")
	check(Compare.output_stem("concourse", "gates_closed", "sdfgi") == "concourse_gates_closed_sdfgi", "a tag suffixes the PNG and side PNG names")
	check(Compare.report_file_name("concourse", "") == "concourse_report.json", "no tag keeps the G-4 report name")
	check(Compare.report_file_name("concourse", "sdfgi") == "concourse_sdfgi_report.json", "a tag suffixes the report name")


## G-5 extras: hint spot overrides, SSIL, SDFGI and AgX white. Range edges, prerequisites and duplicates are parse checks;
## application runs on bare Environment and SpotLight3D nodes only. VoxelGI is never baked here.
func check_tuning_extras() -> void:
	for spec in [
		"--tune=light_scale=0.1", "--tune=light_scale=8", "--tune=spot_range_m=1", "--tune=spot_range_m=60",
		"--tune=spot_angle_deg=10", "--tune=spot_angle_deg=89", "--tune=ssil=false", "--tune=agx_white=1", "--tune=agx_white=64",
	]:
		check(parse_with([spec]).errors.is_empty(), "accept the extras range boundary: %s" % spec)
	for pair in [
		["--tune=ssil=true", "--tune=ssil_intensity=0"], ["--tune=ssil=true", "--tune=ssil_intensity=16"],
		["--tune=gi=sdfgi", "--tune=sdfgi_bounce=0"], ["--tune=gi=sdfgi", "--tune=sdfgi_bounce=1.99"],
		["--tune=gi=sdfgi", "--tune=sdfgi_occlusion=true"], ["--tune=gi=sdfgi", "--tune=sdfgi_sky=false"],
		["--tune=gi=sdfgi", "--tune=sdfgi_min_cell=0.05"], ["--tune=gi=sdfgi", "--tune=sdfgi_min_cell=2"],
		["--tune=gi=voxelgi", "--tune=voxelgi_subdiv=64"], ["--tune=gi=voxelgi", "--tune=voxelgi_subdiv=512"],
		["--tune=gi=voxelgi", "--tune=voxelgi_propagation=0"], ["--tune=gi=voxelgi", "--tune=voxelgi_propagation=1"],
	]:
		check(parse_with(pair).errors.is_empty(), "accept the extras prerequisite pair: %s %s" % pair)
	# Malformed values get the prerequisite they need, so each rejection is for the value alone.
	for spec in [
		"--tune=light_scale=0.09", "--tune=light_scale=8.1", "--tune=light_scale=", "--tune=spot_range_m=0.9",
		"--tune=spot_range_m=60.1", "--tune=spot_angle_deg=9.9", "--tune=spot_angle_deg=89.5", "--tune=spot_angle_deg=high",
		"--tune=ssil=yes", "--tune=ssil=1", "--tune=agx_white=0.9", "--tune=agx_white=64.5",
	]:
		check(not parse_with([spec]).errors.is_empty(), "reject malformed extras value: %s" % spec)
	for spec in ["--tune=ssil_intensity=-0.1", "--tune=ssil_intensity=16.1"]:
		check(not parse_with(["--tune=ssil=true", spec]).errors.is_empty(), "reject ssil_intensity out of range: %s" % spec)
	for spec in [
		"--tune=sdfgi_occlusion=maybe", "--tune=sdfgi_sky=TRUE", "--tune=sdfgi_bounce=2.0",
		"--tune=sdfgi_min_cell=0.04", "--tune=sdfgi_min_cell=2.1",
	]:
		check(not parse_with(["--tune=gi=sdfgi", spec]).errors.is_empty(), "reject malformed sdfgi value: %s" % spec)
	for spec in ["--tune=voxelgi_subdiv=32", "--tune=voxelgi_subdiv=1024", "--tune=voxelgi_subdiv=", "--tune=voxelgi_propagation=1.01"]:
		check(not parse_with(["--tune=gi=voxelgi", spec]).errors.is_empty(), "reject malformed voxelgi value: %s" % spec)
	# Missing prerequisites.
	check(not parse_with(["--tune=ssil_intensity=4"]).errors.is_empty(), "ssil_intensity without ssil is rejected")
	check(not parse_with(["--tune=ssil=false", "--tune=ssil_intensity=4"]).errors.is_empty(), "ssil_intensity with ssil=false is rejected")
	check(not parse_with(["--tune=gi=none", "--tune=sdfgi_bounce=1"]).errors.is_empty(), "sdfgi_bounce with gi=none is rejected")
	check(not parse_with(["--tune=gi=voxelgi", "--tune=sdfgi_sky=true"]).errors.is_empty(), "sdfgi_sky with gi=voxelgi is rejected")
	check(not parse_with(["--tune=sdfgi_min_cell=0.5"]).errors.is_empty(), "sdfgi_min_cell without gi is rejected")
	check(not parse_with(["--tune=gi=sdfgi", "--tune=voxelgi_subdiv=256"]).errors.is_empty(), "voxelgi_subdiv with gi=sdfgi is rejected")
	check(not parse_with(["--tune=gi=sdfgi", "--tune=voxelgi_propagation=0.5"]).errors.is_empty(), "voxelgi_propagation with gi=sdfgi is rejected")
	check(not parse_with(["--tune=voxelgi_propagation=0.5"]).errors.is_empty(), "voxelgi_propagation without gi is rejected")
	# Duplicates are rejected, even for the new keys.
	for pair in [
		["--tune=light_scale=2", "--tune=light_scale=3"], ["--tune=ssil=true", "--tune=ssil=false"],
		["--tune=gi=voxelgi", "--tune=voxelgi_subdiv=64", "--tune=voxelgi_subdiv=64"], ["--tune=gi=sdfgi", "--tune=sdfgi_sky=true", "--tune=sdfgi_sky=true"],
	]:
		check(not parse_with(pair).errors.is_empty(), "duplicate extras key is rejected: %s" % str(pair))
	# Parsed types: the enum stays its string, bools and floats keep their values.
	var typed := parse_with([
		"--tune=gi=voxelgi", "--tune=voxelgi_subdiv=256", "--tune=voxelgi_propagation=0.25", "--tune=light_scale=2.5",
		"--tune=ssil=true", "--tune=ssil_intensity=6", "--tune=agx_white=12",
	])
	check(typed.errors.is_empty() and typed.tuning.voxelgi_subdiv == "256", "voxelgi_subdiv stays its string value in the report")
	check(is_equal_approx(typed.tuning.voxelgi_propagation, 0.25) and is_equal_approx(typed.tuning.light_scale, 2.5), "extras floats keep their parsed values")
	check(typed.tuning.ssil == true and is_equal_approx(typed.tuning.ssil_intensity, 6.0) and is_equal_approx(typed.tuning.agx_white, 12.0), "ssil and agx_white keep their parsed values")
	check(parse_with(["--tune=gi=sdfgi", "--tune=sdfgi_occlusion=false"]).tuning.sdfgi_occlusion == false, "sdfgi_occlusion=false keeps its bool")
	check(Compare.VOXEL_SUBDIVS["512"] == VoxelGI.SUBDIV_512 and Compare.VOXEL_SUBDIVS["64"] == VoxelGI.SUBDIV_64, "voxelgi_subdiv names map to VoxelGI.SUBDIV_*")
	# Application on a bare Environment: an empty tuning leaves every new field at its default.
	var untouched := Environment.new()
	var environment := Environment.new()
	Compare.apply_tuning(environment, {})
	check(environment.ssil_enabled == untouched.ssil_enabled and is_equal_approx(environment.ssil_intensity, untouched.ssil_intensity), "empty tuning leaves SSIL at its defaults")
	check(is_equal_approx(environment.tonemap_agx_white, untouched.tonemap_agx_white), "empty tuning leaves agx_white at its default")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"ssil": true, "ssil_intensity": 6.0, "agx_white": 12.0})
	check(environment.ssil_enabled and is_equal_approx(environment.ssil_intensity, 6.0), "ssil and ssil_intensity apply to the environment")
	check(is_equal_approx(environment.tonemap_agx_white, 12.0), "agx_white applies to the environment")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"ssil": false})
	check(not environment.ssil_enabled, "ssil=false disables SSIL")
	environment = Environment.new()
	Compare.apply_tuning(environment, {"gi": "sdfgi", "sdfgi_bounce": 1.2, "sdfgi_occlusion": true, "sdfgi_sky": false, "sdfgi_min_cell": 0.5})
	check(is_equal_approx(environment.sdfgi_bounce_feedback, 1.2), "sdfgi_bounce applies to sdfgi_bounce_feedback")
	check(environment.sdfgi_use_occlusion and not environment.sdfgi_read_sky_light, "sdfgi_occlusion and sdfgi_sky apply to the environment")
	check(is_equal_approx(environment.sdfgi_min_cell_size, 0.5), "sdfgi_min_cell applies to sdfgi_min_cell_size")
	# Hint spots: an empty tuning is the unscaled APPROXIMATION spot; the overrides replace range and angle.
	var defaults := Compare.hint_spot_params({})
	check(is_equal_approx(defaults.energy_scale, 1.0) and is_equal_approx(defaults.range_m, Compare.APPROXIMATION.spot_range_m) and is_equal_approx(defaults.angle_deg, Compare.APPROXIMATION.spot_angle_deg), "empty tuning gives unscaled APPROXIMATION spot parameters")
	var tuned_params := Compare.hint_spot_params({"light_scale": 2.5, "spot_range_m": 20.0, "spot_angle_deg": 45.0})
	check(is_equal_approx(tuned_params.energy_scale, 2.5) and is_equal_approx(tuned_params.range_m, 20.0) and is_equal_approx(tuned_params.angle_deg, 45.0), "light_scale, spot_range_m and spot_angle_deg become spot parameters")
	var holder := Node3D.new()
	root.add_child(holder)
	var spot_spec := Compare.hint_light_specs({"kind": "panel"}, Transform3D.IDENTITY, 1.0)[0]
	var plain := Compare.add_hint_spot(holder, spot_spec)
	check(is_equal_approx(plain.light_energy, spot_spec.energy) and is_equal_approx(plain.spot_range, Compare.APPROXIMATION.spot_range_m) and is_equal_approx(plain.spot_angle, Compare.APPROXIMATION.spot_angle_deg), "add_hint_spot without params keeps the APPROXIMATION spot")
	var scaled := Compare.add_hint_spot(holder, spot_spec, tuned_params)
	check(is_equal_approx(scaled.light_energy, spot_spec.energy * 2.5) and is_equal_approx(scaled.spot_range, 20.0) and is_equal_approx(scaled.spot_angle, 45.0), "add_hint_spot applies light_scale, spot_range_m and spot_angle_deg")
	# Removing the holder from the tree and freeing it frees its spot children, so the suite exits without leaked lights.
	root.remove_child(holder)
	holder.free()
