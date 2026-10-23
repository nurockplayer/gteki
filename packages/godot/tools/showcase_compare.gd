extends SceneTree
## G-4: render Lane E's showcase GLBs through their exported cameras, beside the Blender references.
## Run in the lead's GPU slot; a headless display exits successfully before reading inputs or writing anything.
## Usage: --script res://tools/showcase_compare.gd -- <absolute.glb> <absolute out_dir>
##        [--camera=<name>] [--ref=<camera>=<absolute image>]...
## Imported geometry, materials and camera transforms/FOV stay the GLB's. Lighting approximates render_preview.py;
## neither Godot spots nor its AgX implementation reproduce Blender area lights / Medium High Contrast exactly.

const WIDTH := 1600
const HEIGHT := 900
const SETTLE_RENDER_FRAMES := 60
const HEADLESS_MESSAGE := "showcase_compare needs a display"
## Approximation constants, not a physical match: Godot's non-physical energy has no Blender-watt equivalence.
## 0.02 gives a 1 m LED energy 1.1; 1.5 m spacing bounds the number of shadowed spots. A wide 75 degree half-cone
## and 8 m reach spread light over a concourse bay. Split watts equally so a longer row never multiplies its power.
## The sun keeps Blender's numeric energy 3 at a 1:1 factor, also without claiming radiometric equivalence.
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
	"colour_linear": [1.0, 0.96, 0.9],
	"sun_blender_energy": 3.0,
	"sun_energy_factor": 1.0,
	"sun_angular_distance_deg": 3.0,
}


func _initialize() -> void:
	call_deferred("run")


## Absolute filesystem paths only: res:// and user:// are not host file arguments either.
static func absolute_file_path(path: String) -> bool:
	return path.is_absolute_path() and not path.contains("://")


## Parse independently of the display and filesystem; validate references against the imported cameras later.
static func parse_args(args: PackedStringArray) -> Dictionary:
	var positional: Array[String] = []
	var camera := ""
	var refs := {}
	var errors: Array[String] = []
	for arg in args:
		if arg.begins_with("--camera="):
			if not camera.is_empty():
				errors.append("--camera may appear only once")
			camera = arg.trim_prefix("--camera=")
			if camera.is_empty():
				errors.append("--camera needs a name")
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
		elif arg.begins_with("--"):
			errors.append("Unknown argument: %s" % arg)
		else:
			positional.append(arg)
	if positional.size() != 2:
		errors.append("Usage: showcase_compare.gd -- <absolute.glb> <absolute out_dir> [--camera=<name>] [--ref=<camera>=<absolute image>]...")
	for path in positional:
		if not absolute_file_path(path):
			errors.append("File arguments must be absolute: %s" % path)
	return {
		"glb": positional[0] if positional.size() > 0 else "",
		"out_dir": positional[1] if positional.size() > 1 else "",
		"camera": camera, "refs": refs, "errors": errors,
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
static func inspect_scene(scene: Node) -> Dictionary:
	var showcase := {}
	var cameras := {}
	var hints: Array[Node3D] = []
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
	if showcase.is_empty():
		errors.append("No gteki_showcase node: expected node.get_meta(\"extras\")[\"gteki_showcase\"] (Godot 4.7 glTF contract)")
	return {"showcase": showcase, "cameras": cameras, "hints": hints, "errors": errors}


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
	root.add_child(scene)
	var info := inspect_scene(scene)
	if not info.errors.is_empty():
		fail("\n".join(info.errors))
		return
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
	configure_environment(scene, mode, exposure)
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
	if DirAccess.make_dir_recursive_absolute(args.out_dir) != OK:
		fail("Cannot create output directory: %s" % args.out_dir)
		return
	root.size = Vector2i(WIDTH, HEIGHT)
	root.content_scale_mode = Window.CONTENT_SCALE_MODE_DISABLED
	root.scaling_3d_scale = 1.0
	var rendered: Array[String] = []
	var refs_used := {}
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
		var stem := "%s_%s" % [layout, name.validate_filename()]
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
		rendered.append(name)
		print("showcase_compare: wrote ", stem)
	var report := {
		"contract": "gteki.showcase-compare/0.1",
		"glb": args.glb, "sha256": FileAccess.get_sha256(args.glb),
		"layout": layout, "mode": mode, "exposure": exposure,
		"cameras": rendered, "refs": refs_used,
		"renderer": RenderingServer.get_current_rendering_method(),
		"project_renderer": str(ProjectSettings.get_setting("rendering/renderer/rendering_method")),
		"driver": RenderingServer.get_current_rendering_driver_name(),
		"adapter": RenderingServer.get_video_adapter_name(),
		"resolution": [WIDTH, HEIGHT], "hint_light_counts": counts,
		"hint_lights_enabled": hints_enabled, "spot_count": spot_count,
		"approximation": APPROXIMATION, "settle_render_frames": SETTLE_RENDER_FRAMES,
	}
	var report_path := str(args.out_dir).path_join(layout + "_report.json")
	var file := FileAccess.open(report_path, FileAccess.WRITE)
	if file == null:
		fail("Cannot write report: %s" % report_path)
		return
	file.store_string(JSON.stringify(report, "\t") + "\n")
	file.close()
	quit(0)


func configure_environment(parent: Node3D, mode: String, exposure: float) -> void:
	var world := WorldEnvironment.new()
	var environment := Environment.new()
	var bg := background(mode)
	environment.background_mode = Environment.BG_COLOR
	environment.background_color = bg.colour
	environment.background_energy_multiplier = bg.strength
	environment.ambient_light_source = Environment.AMBIENT_SOURCE_BG
	environment.tonemap_mode = Environment.TONE_MAPPER_AGX
	environment.tonemap_exposure = pow(2.0, exposure)
	environment.ssao_enabled = true
	world.environment = environment
	parent.add_child(world)


func add_studio_lights(parent: Node3D, ground: bool) -> void:
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


func add_hint_spot(parent: Node3D, spec: Dictionary) -> void:
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
