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
	for spec in [
		"hero=face:0,0,10", "hero=:0,0,10,10", "hero=face:1500,0,200,10", "hero=face:0,0,0,10",
		"hero=whole:0,0,10,10", "hero=face:a,0,1,1", "hero", "=face:0,0,1,1",
	]:
		var bad := Compare.parse_args(PackedStringArray(["/tmp/a", "/tmp/b", "--region=" + spec]))
		check(not bad.errors.is_empty(), "reject malformed --region value: %s" % spec)
