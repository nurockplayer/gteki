# Headless Godot collider check for Ikebukuro (issue #35).
#
# Loads the station through the addon's own code path (gteki_station.gd + gteki_assets.gd, the same
# classes packages/godot/tests/run_tests.gd uses), lets the physics server register the colliders the
# loader created, then:
#   a. lists every StaticBody3D / CollisionShape3D with its source mesh and role;
#   b. asserts none comes from a non-collision role (doors, portals, windows, ceiling, signs, ...);
#   c. walks every verified edge of gteki/graph.json at ~0.25 m and tests it against the physics space.
#
# Add --control after the station dir for the negative control (old role visual+collision must be detected).
# Run via pipeline/godot_colliders.sh (it passes --path packages/godot, because the addon lives there):
#   godot --headless --path packages/godot --script <this file> -- <stationDir> [report.json]
extends SceneTree

const Station = preload("res://addons/gteki/gteki_station.gd")
const Assets = preload("res://addons/gteki/gteki_assets.gd")

const STEP_M := 0.25
# WALKER_BODY from @gteki/scene-api: radiusM 0.3, bodyBottomM 0.2, bodyTopM 1.7.
const BODY_RADIUS := 0.3
const BODY_BOTTOM := 0.2
const BODY_TOP := 1.7
# Horizontal ray heights above the edge floor, spanning the body.
const RAY_HEIGHTS := [0.2, 0.6, 1.0, 1.4, 1.7]
# The walking body lives on layer 1; the loader moves camera_blocker bodies to layer 2 (CAMERA_LAYER).
const WALK_MASK := 1

var failures: Array[String] = []


func _initialize() -> void:
	call_deferred("run")


func fail(message: String) -> void:
	failures.append(message)
	printerr("FAIL: ", message)


## Role the loader gave a mesh: its own role, else the nearest ancestor's (as Assets._tag_roles inherits).
static func effective_role(node: Node) -> String:
	var cursor: Node = node
	while cursor != null:
		var own: String = Assets._own_role(cursor)
		if not own.is_empty():
			return own
		cursor = cursor.get_parent()
	return ""


static func authored_name(node: Node) -> String:
	var extras: Variant = node.get_meta("extras", {})
	if extras is Dictionary and extras.has(Assets.AUTHORED_NAME):
		return str(extras[Assets.AUTHORED_NAME])
	return str(node.name)


func run() -> void:
	var args := Array(OS.get_cmdline_user_args())
	# --control: negative control. Forces the pre-c68a689 asset role (visual+collision) so the same checks must
	# FAIL (door/portal colliders appear and verified edges get blocked); proves the check can see the bug.
	var control: bool = args.has("--control")
	args.erase("--control")
	if args.size() < 1 or args.size() > 2:
		printerr("Usage: -- <stationDir> [report.json]")
		quit(2)
		return
	var station_dir: String = args[0]
	var report := {"stationDir": station_dir}

	var station := Station.new()
	if not station.load_station(station_dir):
		printerr("station load failed: ", station.issues)
		quit(2)
		return

	if control:
		for asset in station.manifest.get("assets", []):
			asset["role"] = "visual+collision"
	# Real loader path: manifest assets -> GLB import -> role tagging -> trimesh colliders.
	var station_root := Node3D.new()
	station_root.name = "station"
	root.add_child(station_root)
	var assets := Assets.new()
	var loaded := assets.load_assets(station.manifest, station_dir.path_join("gteki"), station_root)
	if not loaded:
		fail("loader reported issues: %s" % str(assets.issues))
	report["manifestAssetRoles"] = station.manifest.assets.map(func(a): return {"id": a.get("id"), "role": a.get("role")})
	report["loaderCounts"] = assets.counts

	# Static bodies join the physics space on the next physics frames.
	await physics_frame
	await physics_frame

	# ---- a. collider inventory -------------------------------------------------------------
	var bodies: Array = station_root.find_children("*", "StaticBody3D", true, false)
	var colliders: Array = []
	var by_role := {}
	var shape_count := 0
	for body in bodies:
		var mesh: Node = body.get_parent()
		var role: String = effective_role(mesh)
		var shapes: Array = body.get_children().filter(func(c): return c is CollisionShape3D)
		shape_count += shapes.size()
		var camera_only: bool = (body.collision_layer & WALK_MASK) == 0
		var key: String = "%s%s" % [role if not role.is_empty() else "(none)", " [camera layer]" if camera_only else ""]
		by_role[key] = by_role.get(key, 0) + 1
		colliders.append({
			"mesh": str(mesh.name), "authored": authored_name(mesh), "role": role,
			"shapes": shapes.size(), "layer": body.collision_layer,
			"tags": {"collider": mesh.has_meta("gteki_collider"), "camera_blocker": mesh.has_meta("gteki_camera_blocker"), "walkable": mesh.has_meta("gteki_walkable")},
		})
		print("COLLIDER mesh=%s authored=%s role=%s shapes=%d layer=%d" % [mesh.name, authored_name(mesh), role, shapes.size(), body.collision_layer])
	report["colliders"] = colliders
	report["staticBodies"] = bodies.size()
	report["collisionShapes"] = shape_count
	report["byRole"] = by_role
	print("COLLIDER_SUMMARY bodies=%d shapes=%d byRole=%s" % [bodies.size(), shape_count, JSON.stringify(by_role)])

	# ---- b. non-collision roles must not own a collider ------------------------------------
	var allowed: Array = Assets.COLLIDER + Assets.CAMERA
	var role_mesh_counts := {}
	var role_with_body := {}
	for mesh in station_root.find_children("*", "MeshInstance3D", true, false):
		var role: String = effective_role(mesh)
		var label: String = role if not role.is_empty() else "(none)"
		role_mesh_counts[label] = role_mesh_counts.get(label, 0) + 1
		var has_body := false
		for child in mesh.get_children():
			if child is StaticBody3D:
				has_body = true
		if has_body:
			role_with_body[label] = role_with_body.get(label, 0) + 1
			if not (role in allowed):
				fail("mesh %s (authored %s) has role '%s' but owns a collider" % [mesh.name, authored_name(mesh), role])
	report["meshesByRole"] = role_mesh_counts
	report["meshesWithColliderByRole"] = role_with_body
	var forbidden := ["doors", "portals", "windows"]
	var forbidden_bodies := 0
	for role in forbidden:
		forbidden_bodies += int(role_with_body.get(role, 0))
	report["doorPortalWindowColliders"] = forbidden_bodies
	print("ROLE_MESHES %s" % JSON.stringify(role_mesh_counts))
	print("ROLE_MESHES_WITH_COLLIDER %s" % JSON.stringify(role_with_body))
	print("DOOR_PORTAL_WINDOW_COLLIDERS %d" % forbidden_bodies)
	if forbidden_bodies != 0:
		fail("doors/portals/windows own %d collider(s)" % forbidden_bodies)

	# ---- c. verified edges are traversable --------------------------------------------------
	var graph := Station.read_json(station_dir.path_join("gteki/graph.json"), failures)
	var space := root.get_world_3d().direct_space_state
	var capsule := CapsuleShape3D.new()
	capsule.radius = BODY_RADIUS
	capsule.height = BODY_TOP - BODY_BOTTOM
	var overlap := PhysicsShapeQueryParameters3D.new()
	overlap.shape = capsule
	overlap.collision_mask = WALK_MASK
	var edges_checked := 0
	var samples_total := 0
	var ray_blocked: Array = []
	var capsule_blocked: Array = []
	for edge in graph.get("edges", []):
		if edge.get("verification") != "verified":
			continue
		var geometry: Array = edge.get("geometry", [])
		if geometry.size() < 2:
			fail("verified edge %s has no polyline" % edge.get("id"))
			continue
		edges_checked += 1
		# ENU -> Godot with the loader's own mapping (x, z, -y); asserted against the documented mapping.
		var pts: Array[Vector3] = []
		for g in geometry:
			var p: Vector3 = station.enu_to_godot({"x": g.x, "y": g.y, "z": g.get("z"), "floorId": "b1"})
			if not is_equal_approx(p.x, float(g.x)) or not is_equal_approx(p.z, -float(g.y)) or not is_equal_approx(p.y, float(g.z)):
				fail("ENU->Godot mapping is not (x, z, -y) for edge %s" % edge.id)
			pts.append(p)
		# Dense samples at <= STEP_M, keeping every polyline vertex.
		var dense: Array[Vector3] = [pts[0]]
		for i in range(1, pts.size()):
			var a := pts[i - 1]
			var b := pts[i]
			var n := maxi(1, int(ceil(a.distance_to(b) / STEP_M)))
			for k in range(1, n + 1):
				dense.append(a.lerp(b, float(k) / n))
		samples_total += dense.size()
		for i in range(dense.size()):
			var here := dense[i]
			# Capsule (radius 0.3, 0.2..1.7 m above the floor) overlap at the sample.
			overlap.transform = Transform3D(Basis.IDENTITY, here + Vector3(0, (BODY_BOTTOM + BODY_TOP) * 0.5, 0))
			var hits: Array = space.intersect_shape(overlap, 4)
			if not hits.is_empty():
				capsule_blocked.append({"edge": edge.id, "index": i, "godot": _v(here), "enu": _enu(here), "collider": _who(hits[0].collider)})
			# Horizontal rays along the segment to the next sample, at each body height.
			if i + 1 < dense.size():
				for h in RAY_HEIGHTS:
					var q := PhysicsRayQueryParameters3D.create(here + Vector3(0, h, 0), dense[i + 1] + Vector3(0, h, 0), WALK_MASK)
					var hit: Dictionary = space.intersect_ray(q)
					if not hit.is_empty():
						ray_blocked.append({"edge": edge.id, "index": i, "height": h, "godot": _v(here), "enu": _enu(here), "hit": _v(hit.position), "collider": _who(hit.collider)})
	report["verifiedEdgesChecked"] = edges_checked
	report["samples"] = samples_total
	report["rayHeights"] = RAY_HEIGHTS
	report["rayBlocked"] = ray_blocked
	report["capsuleBlocked"] = capsule_blocked
	print("EDGES verified=%d samples=%d rayBlocked=%d capsuleBlockedSamples=%d" % [edges_checked, samples_total, ray_blocked.size(), capsule_blocked.size()])
	for b in ray_blocked:
		print("RAY_BLOCKED %s" % JSON.stringify(b))
	var capsule_edges := {}
	for b in capsule_blocked:
		capsule_edges[b.edge] = capsule_edges.get(b.edge, 0) + 1
		print("CAPSULE_BLOCKED %s" % JSON.stringify(b))
	report["capsuleBlockedByEdge"] = capsule_edges
	if edges_checked == 0:
		fail("no verified edges found")
	if not ray_blocked.is_empty():
		fail("%d horizontal ray(s) blocked along verified edges" % ray_blocked.size())

	report["failures"] = failures
	report["control"] = control
	if args.size() == 2:
		var out := FileAccess.open(args[1], FileAccess.WRITE)
		if out != null:
			out.store_string(JSON.stringify(report, "  "))
	if control:
		# Expected to fail; the control passes only when the check detects the old behaviour.
		var detected := forbidden_bodies > 0 and not ray_blocked.is_empty()
		print("CONTROL (role visual+collision) %s: doorPortalWindowColliders=%d rayBlocked=%d" % ["DETECTED" if detected else "NOT DETECTED", forbidden_bodies, ray_blocked.size()])
		quit(0 if detected else 1)
		return
	print("RESULT %s (%d failure(s))" % ["FAIL" if failures.size() > 0 else "PASS", failures.size()])
	quit(1 if failures.size() > 0 else 0)


static func _v(v: Vector3) -> Array:
	return [snappedf(v.x, 0.001), snappedf(v.y, 0.001), snappedf(v.z, 0.001)]


## Godot (x, y, z) -> ENU (x, y, z) = (x, -z, y).
static func _enu(v: Vector3) -> Array:
	return [snappedf(v.x, 0.001), snappedf(-v.z, 0.001), snappedf(v.y, 0.001)]


static func _who(collider: Object) -> String:
	if collider is Node and collider.get_parent() != null:
		var mesh: Node = collider.get_parent()
		return "%s(role=%s)" % [authored_name(mesh), effective_role(mesh)]
	return str(collider)
