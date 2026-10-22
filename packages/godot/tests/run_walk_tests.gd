extends SceneTree
## Headless walk replay (G-2): drives the web-rule walker (gteki_walker.gd) and follow camera (gteki_follow_camera.gd)
## with scripted input on a fixed step, against the exported station snapshots.
## Usage: --script res://tests/run_walk_tests.gd -- <scenesDir> <routesDir> <stationId> [<stationId> ...]
## <routesDir>/<stationId>.route.json (optional) is `packages/cli/src/route.ts` output (gteki.route/0.1); when present
## the walker replays its polyline.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Walker = preload("res://addons/gteki/gteki_walker.gd")
const FollowCamera = preload("res://addons/gteki/gteki_follow_camera.gd")
const Station = preload("res://addons/gteki/gteki_station.gd")

const DT := 1.0 / 60.0
const EPSILON := 0.001

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
	if args.size() < 3:
		printerr("Usage: -- <scenesDir> <routesDir> <stationId> [<stationId> ...]")
		quit(1)
		return
	test_rules()
	await test_synthetic_world()
	for i in range(2, args.size()):
		await test_station(args[0].path_join(args[i]), args[i], args[1].path_join("%s.route.json" % args[i]))
	finish()


# ---- pure rules ------------------------------------------------------------------------------------------------

func test_rules() -> void:
	check(Walker.accept_ground(0.0, 0.45) and not Walker.accept_ground(0.0, 0.46), "step-up limit is 0.45 m")
	check(Walker.accept_ground(0.0, -0.9) and not Walker.accept_ground(0.0, -0.91), "step-down limit is 0.9 m")
	check(not Walker.accept_ground(0.0, null), "no ground refuses the move")
	check(Walker.RADIUS == 0.3 and Walker.BODY_BOTTOM == 0.2 and Walker.BODY_TOP == 1.7 and Walker.EYE == 1.62, "WALKER_BODY constants")
	check(Walker.WALK == 1.45 and Walker.RUN == 3.4, "web walk / run speeds")
	check(FollowCamera.DEFAULT_FOV == 60.0, "default FOV is the web's 60 degrees")
	check(is_equal_approx(FollowCamera.clamp_distance(3.4, 1.0, false), 0.7), "camera stops CLEARANCE in front of a wall")
	check(is_equal_approx(FollowCamera.clamp_distance(3.4, 0.5, false), 0.55), "camera keeps the minimum distance from a wall")
	check(is_equal_approx(FollowCamera.clamp_distance(3.4, 0.5, true), 0.2), "a camera-only blocker may pull the camera past the minimum")
	var slid: Variant = Walker.slide_along(Vector3.ZERO, Vector3(1, 0, 1), Vector3(0, 0, -1))
	check(slid != null and slid.distance_to(Vector3(1, 0, 0)) < EPSILON, "slide_along keeps the component along the surface")
	check(Walker.slide_along(Vector3.ZERO, Vector3(0, 0, 1), Vector3(0, 0, -1)) == null, "a head-on move slides nowhere")


# ---- synthetic world: ground rules and the wall band rule on known geometry ------------------------------------

func add_slab(parent: Node3D, x0: float, x1: float, z: float, top: float) -> void:
	var body := StaticBody3D.new()
	body.collision_layer = Scene.GROUND_LAYER
	body.collision_mask = 0
	var shape := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(x1 - x0, 3.0, 6.0)
	shape.shape = box
	body.add_child(shape)
	body.position = Vector3((x0 + x1) * 0.5, top - 1.5, z)
	parent.add_child(body)


## A wall along north-south at renderer x, around renderer z (ENU y = -z).
func wall_at(x: float, z: float, z_min: float, z_max: float) -> Dictionary:
	return {"a": {"x": x, "y": -(z - 4.0)}, "b": {"x": x, "y": -(z + 4.0)}, "zMin": z_min, "zMax": z_max}


## Walk +x from x = -5 for 12 s; returns the walker's final feet position.
func walk_east(walker: Walker, z: float, y: float) -> Vector3:
	walker.global_position = Vector3(-5.0, y, z)
	check(walker.walk_from(Vector3(-5.0, y, z), 90.0), "synthetic row z=%d has ground at the start" % int(z))
	for _i in range(720):
		walker.step(DT, Vector2(0, 1), false)
	return walker.feet()


func test_synthetic_world() -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	var walker := Walker.new()
	holder.add_child(walker)
	# Row 5000: a 0.40 m rise is climbed, the next 0.47 m rise (> 0.45) is refused.
	add_slab(holder, -10, 0, 5000, 0.0)
	add_slab(holder, 0, 2, 5000, 0.4)
	add_slab(holder, 2, 4, 5000, 0.87)
	# Row 5100: a 0.80 m drop is taken, the next 0.93 m drop (> 0.9) is refused.
	add_slab(holder, -10, 0, 5100, 0.0)
	add_slab(holder, 0, 2, 5100, -0.8)
	add_slab(holder, 2, 4, 5100, -1.73)
	# Rows 5200-5600: flat floor for the wall band rule.
	for z in [5200, 5300, 5400, 5500, 5600]:
		add_slab(holder, -10, 20, z, 0.0)
	add_slab(holder, -10, 20, 5700, 1.0)
	await physics_frame
	await physics_frame
	walker.set_walls([])

	var end := walk_east(walker, 5000.0, 0.0)
	check(end.x <= 2.0 + EPSILON and end.x > 1.9, "0.47 m step-up is refused at the edge (x=%.3f)" % end.x)
	check(abs(end.y - 0.4) < 0.02, "0.40 m step-up was climbed (y=%.3f)" % end.y)
	end = walk_east(walker, 5100.0, 0.0)
	check(end.x <= 2.0 + EPSILON and end.x > 1.9, "0.93 m step-down is refused at the edge (x=%.3f)" % end.x)
	check(abs(end.y + 0.8) < 0.02, "0.80 m step-down was taken (y=%.3f)" % end.y)

	# A full-height wall blocks (pushed out to the body radius).
	walker.set_walls([wall_at(8.0, 5200.0, 0.0, 3.4)])
	end = walk_east(walker, 5200.0, 0.0)
	check(end.x < 8.0 - Walker.RADIUS + 0.02 and end.x > 8.0 - Walker.RADIUS - 0.1, "full-height wall stops the walker at its radius (x=%.3f)" % end.x)
	# A wall whose band lies above the body is walked through.
	walker.set_walls([wall_at(8.0, 5300.0, 5.0, 6.0)])
	end = walk_east(walker, 5300.0, 0.0)
	check(end.x > 11.5, "a wall above the body band does not block (x=%.3f)" % end.x)
	# The inverted band (zMin 1.2 > zMax 1.1) blocks while feet are in [zMin - 1.7, zMax - 0.2] = [-0.5, 0.9], as on the web.
	walker.set_walls([wall_at(8.0, 5400.0, 1.2, 1.1)])
	check(walker.inverted_walls == 1 and walker.blocks_wall(0, 0.0) and walker.blocks_wall(0, 0.85) and walker.blocks_wall(0, -0.45), "inverted band blocks for feet inside [-0.5, 0.9]")
	check(not walker.blocks_wall(0, 0.95) and not walker.blocks_wall(0, -0.55), "inverted band does not block outside that range")
	end = walk_east(walker, 5400.0, 0.0)
	check(end.x < 8.0 - Walker.RADIUS + 0.02 and end.x > 8.0 - Walker.RADIUS - 0.1, "inverted-band wall blocks feet at 0 m (x=%.3f)" % end.x)
	# ... and lets a walker standing at feet 1.0 m pass.
	walker.set_walls([wall_at(8.0, 5700.0, 1.2, 1.1)])
	end = walk_east(walker, 5700.0, 1.0)
	check(end.x > 11.5, "inverted-band wall does not block feet at 1.0 m (x=%.3f)" % end.x)
	holder.queue_free()
	await process_frame


# ---- stations --------------------------------------------------------------------------------------------------

func test_station(dir: String, id: String, route_path: String) -> void:
	var holder := Node3D.new()
	root.add_child(holder)
	var scene := Scene.new()
	var loaded := scene.load_snapshot(dir, holder)
	check(loaded, "%s: snapshot loads: %s" % [id, str(scene.issues)])
	if not loaded:
		holder.queue_free()
		return
	var walker := Walker.new()
	holder.add_child(walker)
	var camera := FollowCamera.new()
	holder.add_child(camera)
	walker.set_walls(scene.sidecar.get("walls", []))
	check(walker.wall_count() == scene.sidecar.walls.size(), "%s: every sidecar wall reaches the walker" % id)
	await physics_frame
	await physics_frame

	test_spawn_walks(scene, walker, id)
	if walker.wall_count() > 0:
		test_wall_stops(scene, walker, id)
	else:
		test_collider_stops(scene, walker, id)
	test_camera(scene, walker, camera, id)
	if FileAccess.file_exists(route_path):
		test_route(scene, walker, id, route_path)
	else:
		print("%s: no route file at %s, route replay skipped" % [id, route_path])
	holder.queue_free()
	await process_frame


func heading_to_yaw(forward_x: float, forward_z: float) -> float:
	return atan2(-forward_x, -forward_z)


## (a) From every spawn, walking forward in four headings keeps the walker on walkable ground.
func test_spawn_walks(scene: Scene, walker: Walker, id: String) -> void:
	var farthest_total := 0.0
	for spawn in scene.spawn_points:
		var farthest := 0.0
		for offset in [0.0, 90.0, 180.0, 270.0]:
			check(walker.walk_from(spawn.position, spawn.heading_deg + offset), "%s: spawn %s has ground" % [id, spawn.node_id])
			var start := walker.feet()
			var on_ground := true
			for _i in range(180):
				walker.step(DT, Vector2(0, 1), true)
				var here := walker.feet()
				var ground: Variant = walker.ground_at(here.x, here.y + 0.5, here.z, 1.5)
				if ground == null or abs(float(ground) - here.y) > Walker.STEP_UP + Walker.STEP_DOWN:
					on_ground = false
					break
			check(on_ground, "%s: spawn %s heading +%d stays on walkable ground" % [id, spawn.node_id, int(offset)])
			farthest = maxf(farthest, Vector2(walker.feet().x - start.x, walker.feet().z - start.z).length())
		check(farthest > 1.0, "%s: spawn %s can walk at least 1 m in some direction (%.2f m)" % [id, spawn.node_id, farthest])
		farthest_total += farthest
	print("%s: spawn walks ok, farthest per spawn averages %.1f m" % [id, farthest_total / maxf(1.0, scene.spawn_points.size())])


## (b) Stations with sidecar walls: walk into real wall segments from 1.5 m away; the body never gets closer than its
## radius to the segment, and at least some walks end touching it.
func test_wall_stops(scene: Scene, walker: Walker, id: String) -> void:
	var walls: Array = scene.sidecar.walls
	var stride := maxi(1, walls.size() / 80)
	var tried := 0
	var stopped := 0
	var violations := 0
	for i in range(0, walls.size(), stride):
		var wall: Dictionary = walls[i]
		var a := Vector3(wall.a.x, 0.0, -float(wall.a.y))
		var b := Vector3(wall.b.x, 0.0, -float(wall.b.y))
		var length := a.distance_to(b)
		if length < 2.0:
			continue
		var along := (b - a) / length
		var normal := Vector3(-along.z, 0.0, along.x)
		var band_low := minf(float(wall.zMin), float(wall.zMax))
		for side in [1.0, -1.0]:
			var mid := (a + b) * 0.5
			var start: Vector3 = mid + normal * side * 1.5
			if not walker.walk_from(Vector3(start.x, band_low + 0.5, start.z), 0.0):
				continue
			if not walker.blocks_wall(i, walker.feet().y):
				continue
			# Face the wall.
			var toward: Vector3 = -normal * side
			walker.yaw = heading_to_yaw(toward.x, toward.z)
			tried += 1
			var closest := INF
			for _s in range(240):
				walker.step(DT, Vector2(0, 1), false)
				var p := walker.feet()
				var t := clampf((p - a).dot(along) / length, 0.0, 1.0)
				var d := Vector2(p.x - (a + along * length * t).x, p.z - (a + along * length * t).z).length()
				# Only passes alongside the segment count; a corner round its end is another wall's business.
				if t > 0.0 and t < 1.0:
					closest = minf(closest, d)
			if closest < Walker.RADIUS - 0.02:
				violations += 1
				printerr("  %s wall %d: walker came within %.3f m of the segment" % [id, i, closest])
			elif closest <= Walker.RADIUS + 0.05:
				stopped += 1
			if tried >= 120:
				break
		if tried >= 120:
			break
	check(violations == 0, "%s: the walker never enters a wall's radius (%d violations in %d walks)" % [id, violations, tried])
	check(stopped >= 3, "%s: walking into real wall segments stops at the body radius (%d of %d walks)" % [id, stopped, tried])
	print("%s: wall stops: %d of %d walks ended touching a wall, no violations" % [id, stopped, tried])


## (b') Stations with collider meshes only (Ikebukuro has no wall segments): the nearest collider seen from each spawn
## is walked into; no step may cross a collider surface (an independent ray at 0.8 m, a height the walker never casts at).
func test_collider_stops(scene: Scene, walker: Walker, id: String) -> void:
	var walks := 0
	var reached := 0
	var tunnelled := 0
	for spawn in scene.spawn_points:
		if not walker.walk_from(spawn.position, 0.0):
			continue
		var origin := walker.feet() + Vector3(0.0, 1.0, 0.0)
		var best: Dictionary = {}
		for k in range(24):
			var angle := float(k) / 24.0 * TAU
			var dir := Vector3(cos(angle), 0.0, sin(angle))
			var hit := walker.cast(origin, dir, 12.0, Scene.COLLIDER_LAYER)
			if hit.is_empty() or hit.distance < 1.5 or abs(hit.normal.y) > 0.3:
				continue
			if best.is_empty() or hit.distance < best.distance:
				best = hit
				best["dir"] = dir
		if best.is_empty():
			continue
		walks += 1
		var start_feet := walker.feet()
		walker.yaw = heading_to_yaw(best.dir.x, best.dir.z)
		var closest := INF
		for _s in range(420):
			var before := walker.feet()
			walker.step(DT, Vector2(0, 1), true)
			var after := walker.feet()
			var span := before.distance_to(after)
			if span > 1e-6:
				var crossing := walker.cast(before + Vector3(0.0, 0.8, 0.0), (after - before) / span, span, Scene.COLLIDER_LAYER)
				if not crossing.is_empty() and crossing.distance < span - 1e-4:
					tunnelled += 1
			closest = minf(closest, Vector2(after.x - best.point.x, after.z - best.point.z).length())
		if closest <= Walker.RADIUS + 0.5:
			reached += 1
		else:
			print("  %s spawn %s: stopped %.2f m from the target wall (something else in the way); start %s" % [id, spawn.node_id, closest, start_feet])
	check(walks > 0, "%s: at least one spawn has a collider within 12 m" % id)
	check(tunnelled == 0, "%s: no step crosses a collider surface (%d crossings in %d walks)" % [id, tunnelled, walks])
	check(reached >= 1, "%s: running into a collider ends at the wall (%d of %d walks)" % [id, reached, walks])
	print("%s: collider stops: %d of %d walks reached the wall, %d crossings" % [id, reached, walks, tunnelled])


## (d) The camera never ends up on the far side of a wall, ceiling, floor or blocker (except the web's minimum-distance floor).
func test_camera(scene: Scene, walker: Walker, camera: FollowCamera, id: String) -> void:
	var poses := 0
	var pulled_in := 0
	var violations := 0
	for spawn in scene.spawn_points:
		for yaw_deg in [0.0, 90.0, 180.0, 270.0]:
			for pitch in [-0.9, -0.12, 0.5]:
				if not walker.walk_from(spawn.position, yaw_deg):
					continue
				walker.pitch = pitch
				walker.cam_distance = Walker.DEFAULT_DISTANCE
				camera.follow(walker, DT, true)
				poses += 1
				var pivot := camera.last_pivot
				var position := camera.global_position
				var length := pivot.distance_to(position)
				if length < Walker.DEFAULT_DISTANCE - 0.01:
					pulled_in += 1
				if length > 1e-4:
					var hits := camera.cast_all(pivot, (position - pivot) / length, length, FollowCamera.CAMERA_MASK)
					for h in hits:
						# The web floors the distance at MIN_DISTANCE (a wall closer than that is crossed, not avoided).
						if h.distance < length - 0.02 and h.distance > FollowCamera.MIN_DISTANCE + 0.02:
							violations += 1
							printerr("  %s camera crossed a surface at %.2f of %.2f m (spawn %s yaw %d pitch %.2f)" % [id, h.distance, length, spawn.node_id, int(yaw_deg), pitch])
							break
				check(length <= Walker.DEFAULT_DISTANCE + 0.01, "%s: camera never farther than the wanted distance" % id)
	check(poses > 0, "%s: camera poses were sampled" % id)
	check(violations == 0, "%s: camera never passes through ceilings, floors or walls (%d violations in %d poses)" % [id, violations, poses])
	print("%s: camera: %d poses, %d pulled in by geometry, %d violations; fov %.0f" % [id, poses, pulled_in, violations, camera.fov])


## (e) Replay a TypeScript route polyline: walk to each point in turn; the walker must never be blocked and must reach the goal.
func test_route(scene: Scene, walker: Walker, id: String, route_path: String) -> void:
	var errors: Array[String] = []
	var route: Dictionary = Station.read_json(route_path, errors)
	check(errors.is_empty() and route.get("contract") == "gteki.route/0.1", "%s: route JSON loads (%s)" % [id, str(errors)])
	if route.is_empty() or not route.get("result", {}).get("ok", false):
		check(false, "%s: route JSON holds a found route" % id)
		return
	var points: Array[Vector3] = []
	for p in route.polyline:
		var q := Vector3(p.renderer[0], p.renderer[1], p.renderer[2])
		if points.is_empty() or Vector2(q.x - points[-1].x, q.z - points[-1].z).length() > 0.05:
			points.append(q)
	check(points.size() >= 2, "%s: route polyline has points" % id)
	if points.size() < 2:
		return
	var first_dir := Vector2(points[1].x - points[0].x, points[1].z - points[0].z).normalized()
	check(walker.walk_from(points[0], 0.0), "%s: route start has ground" % id)
	walker.yaw = heading_to_yaw(first_dir.x, first_dir.y)
	var blocked_at := -1
	var total_steps := 0
	for i in range(1, points.size()):
		var goal := points[i]
		var stalled := 0
		var guard := 0
		while true:
			var here := walker.feet()
			var to_goal := Vector2(goal.x - here.x, goal.z - here.z)
			if to_goal.length() < 0.2:
				break
			walker.yaw = heading_to_yaw(to_goal.x / to_goal.length(), to_goal.y / to_goal.length())
			var before := Vector2(here.x, here.z)
			walker.step(DT, Vector2(0, 1), false)
			total_steps += 1
			guard += 1
			var after := Vector2(walker.feet().x, walker.feet().z)
			stalled = stalled + 1 if before.distance_to(after) < 1e-4 else 0
			if stalled > 60 or guard > 4000:
				blocked_at = i
				break
		if blocked_at >= 0:
			break
	var end := walker.feet()
	var goal_point := points[points.size() - 1]
	var miss := Vector2(end.x - goal_point.x, end.z - goal_point.z).length()
	check(blocked_at < 0, "%s: route replay was never blocked (stuck walking to polyline point %d of %d at %s, wanted %s)" % [id, blocked_at, points.size(), end, points[maxi(blocked_at, 0)]])
	check(blocked_at >= 0 or miss < 1.0, "%s: route replay ends within 1 m of the goal (%.2f m)" % [id, miss])
	check(blocked_at >= 0 or abs(end.y - goal_point.y) < 1.5, "%s: route replay ends at the goal's height (dy %.2f)" % [id, end.y - goal_point.y])
	print("%s: route replay %d points, %d steps (%.0f s), ended %.2f m from the goal" % [id, points.size(), total_steps, total_steps * DT, miss])


func finish() -> void:
	if failures.is_empty():
		print("PASS: GTEki Godot walk replay (%d checks)" % checks)
		quit(0)
	else:
		printerr("FAIL: GTEki Godot walk replay (%d failures / %d checks)" % [failures.size(), checks])
		quit(1)
