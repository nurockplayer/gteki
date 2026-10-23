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
	check_hints()
	check_metadata()
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
	var info := Compare.inspect_scene(scene)
	check(info.errors.is_empty() and info.showcase.layout == "fixture", "nested gteki_showcase comes from extras metadata")
	check(info.cameras.get("hero") == camera and camera.fov == 48.0, "inspection retains imported Camera3D and its FOV")
	check(info.hints.size() == 1 and info.hints[0] == hint, "inspection finds LIGHTHINT nodes with extras")
	hint.remove_meta("extras")
	check("metadata 'extras'" in "\n".join(Compare.inspect_scene(scene).errors), "lost hint extras fail clearly")
	showcase.remove_meta("extras")
	check("No gteki_showcase node" in "\n".join(Compare.inspect_scene(scene).errors), "lost showcase extras fail clearly")
	scene.free()
