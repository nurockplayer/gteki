extends CharacterBody3D
## Third-person walker: a GDScript port of the web explorer's walker, rule for rule, NOT Godot's slide physics.
## A Godot capsule would resolve walls, steps and slopes differently from the web, and "walkable" must mean the same
## thing on both clients, so this node moves by the web's algorithm and uses the physics server only for ray tests.
## The node itself is the walker's FEET position (the web's `pos`); it has no collision layer or mask of its own.
##
## Mirrors (apps/web/src/explorer/, line numbers as of this commit):
##   constants            explorer.ts:48-50 (RADIUS, WALK 1.45, RUN 3.4), WALKER_BODY in packages/scene-api/src/index.ts
##   resolve_walls        walker.ts:22-53   resolveWalls (wall band + 3 push-out passes)
##   accept_ground        walker.ts:65-69   acceptGround
##   body_block, touches  bodyCollision.ts:34-117  bodyBlock (rays at 0.5 / 1.2 m, 12 radial rays, side sweeps)
##   slide_along          bodyCollision.ts:124-136
##   step                 explorer.ts:991-1019 stepWalk (camera-relative move, walls, colliders, slide, ground)
##   ground_at            explorer.ts:572-579 groundAt
##   walk_from            explorer.ts:549-563 walkFrom (ground 1.5 m above the spawn, yaw = -heading)
##   look / zoom          explorer.ts:991-995 (sensitivities, pitch clamp, distance clamp)
## Differences, all deliberate: ray tests go through PhysicsDirectSpaceState3D (trimesh bodies from gteki_scene.gd)
## instead of three.js meshes; ground rays hit both faces (the web honours each material's side, Godot ground
## trimeshes are made double-sided in gteki_scene.gd); wall segments are found through a grid (same result, less work).

const Scene = preload("res://addons/gteki/gteki_scene.gd")

## WALKER_BODY (packages/scene-api/src/index.ts).
const RADIUS := 0.3
const BODY_BOTTOM := 0.2
const BODY_TOP := 1.7
const EYE := 1.62
const STEP_UP := 0.45
const STEP_DOWN := 0.9
## explorer.ts:49-50, metres per second.
const WALK := 1.45
const RUN := 3.4
## bodyCollision.ts:19-23.
const BODY_HEIGHTS: Array[float] = [0.5, 1.2]
const BODY_RAYS := 12
const INTO := -1e-6
## THREE.MathUtils.damp lambda for the feet height (explorer.ts:1018).
const HEIGHT_DAMP := 18.0
## Look sensitivities and limits (explorer.ts:992-995, 194-195); camera distance default is FOLLOW.defaultDistance.
const YAW_PER_PIXEL := 0.0042
const PITCH_PER_PIXEL := 0.0032
const ZOOM_PER_UNIT := 0.004
const PITCH_MIN := -1.1
const PITCH_MAX := 0.5
const DISTANCE_MIN := 1.8
const DISTANCE_MAX := 9.0
const DEFAULT_DISTANCE := 3.4
const DEFAULT_PITCH := -0.12
## Wall grid cell size (m) and padding. Padding exceeds 2 * RADIUS so a 3x3 cell lookup holds every wall in reach.
const CELL := 4.0
const WALL_PAD := 0.7
## Render layer the avatar draws on (Godot layer 2). Station meshes stay on the default layer 1, so the HQ lights can
## be masked to this layer alone while a station's baked lightmap is the station's light (gteki_hq_lights.gd, #251).
const AVATAR_LAYER := 1 << 1

## Camera yaw (radians, 0 = -Z, as the web's `yaw`) and pitch; movement is camera-relative.
var yaw := 0.0
var pitch := DEFAULT_PITCH
var cam_distance := DEFAULT_DISTANCE
## The avatar's facing, smoothed toward the direction of travel.
var body_yaw := 0.0
var avatar: Node3D

var _query := PhysicsRayQueryParameters3D.new()
var _radial: Array[Vector3] = []
# Walls in the renderer frame (wallToRenderer): x = east, z = -north, y band = zMin..zMax.
var _ax := PackedFloat64Array()
var _az := PackedFloat64Array()
var _bx := PackedFloat64Array()
var _bz := PackedFloat64Array()
var _ymin := PackedFloat64Array()
var _ymax := PackedFloat64Array()
var _grid: Dictionary = {}
## Wall segments with zMax < zMin (92 in Shinjuku). They are walls like any other here, see `blocks_wall`.
var inverted_walls := 0
## Which body_block stage refused the last blocked move (diagnostics for tests).
var last_block := ""


func _init() -> void:
	collision_layer = 0
	collision_mask = 0
	_query.hit_back_faces = true
	for i in range(BODY_RAYS):
		var a := float(i) / BODY_RAYS * TAU
		_radial.append(Vector3(cos(a), 0.0, sin(a)))
	_build_avatar()


## Neutral placeholder figure (no asset, no mascot): a capsule body and a small nose box showing where it faces.
## Both meshes draw on AVATAR_LAYER, so the HQ lights can reach the avatar while leaving the station unlit.
func _build_avatar() -> void:
	avatar = Node3D.new()
	avatar.name = "avatar"
	add_child(avatar)
	var material := StandardMaterial3D.new()
	material.albedo_color = Color(0.62, 0.66, 0.72)
	material.roughness = 0.8
	var body := MeshInstance3D.new()
	var capsule := CapsuleMesh.new()
	capsule.radius = 0.25
	capsule.height = 1.7
	body.mesh = capsule
	body.material_override = material
	body.layers = AVATAR_LAYER
	body.position = Vector3(0.0, 0.85, 0.0)
	avatar.add_child(body)
	var nose := MeshInstance3D.new()
	var box := BoxMesh.new()
	box.size = Vector3(0.12, 0.12, 0.2)
	nose.mesh = box
	nose.material_override = material
	nose.layers = AVATAR_LAYER
	nose.position = Vector3(0.0, 1.45, -0.28)
	avatar.add_child(nose)


## Wall segments from the sidecar (ENU a, b, zMin, zMax) in renderer frame: walker.ts wallToRenderer.
func set_walls(walls: Array) -> void:
	_ax.clear(); _az.clear(); _bx.clear(); _bz.clear(); _ymin.clear(); _ymax.clear()
	_grid.clear()
	inverted_walls = 0
	for wall in walls:
		_ax.append(float(wall.a.x)); _az.append(-float(wall.a.y))
		_bx.append(float(wall.b.x)); _bz.append(-float(wall.b.y))
		_ymin.append(float(wall.zMin)); _ymax.append(float(wall.zMax))
		if float(wall.zMax) < float(wall.zMin):
			inverted_walls += 1
	for i in range(_ax.size()):
		var lo_x := minf(_ax[i], _bx[i]) - WALL_PAD
		var hi_x := maxf(_ax[i], _bx[i]) + WALL_PAD
		var lo_z := minf(_az[i], _bz[i]) - WALL_PAD
		var hi_z := maxf(_az[i], _bz[i]) + WALL_PAD
		for cx in range(int(floor(lo_x / CELL)), int(floor(hi_x / CELL)) + 1):
			for cz in range(int(floor(lo_z / CELL)), int(floor(hi_z / CELL)) + 1):
				var key := Vector2i(cx, cz)
				var list: PackedInt32Array = _grid.get(key, PackedInt32Array())
				list.append(i)
				_grid[key] = list


func wall_count() -> int:
	return _ax.size()


## The feet position (the web's `pos`).
func feet() -> Vector3:
	return global_position


func eye() -> Vector3:
	return global_position + Vector3(0.0, EYE, 0.0)


# ---- ray tests -------------------------------------------------------------------------------------------------

func _space() -> PhysicsDirectSpaceState3D:
	return get_world_3d().direct_space_state


## Nearest hit on `mask` along origin + dir * far: {} or {distance, normal, point, collider}. The normal faces the
## ray's origin whatever the winding is (bodyCollision.ts hitNormal).
func cast(origin: Vector3, dir: Vector3, far: float, mask: int) -> Dictionary:
	_query.from = origin
	_query.to = origin + dir * far
	_query.collision_mask = mask
	var hit := _space().intersect_ray(_query)
	if hit.is_empty():
		return {}
	var normal: Vector3 = hit.normal
	if normal.dot(dir) > 0.0:
		normal = -normal
	return {"distance": origin.distance_to(hit.position), "normal": normal, "point": hit.position, "collider": hit.collider}


## Walkable ground height under (x, z): ray from `from_y` down `max_drop` metres, or null (explorer.ts groundAt).
func ground_at(x: float, from_y: float, z: float, max_drop: float) -> Variant:
	var hit := cast(Vector3(x, from_y, z), Vector3.DOWN, max_drop, Scene.GROUND_LAYER)
	if hit.is_empty():
		return null
	return hit.point.y


static func accept_ground(current_y: float, ground: Variant) -> bool:
	if ground == null:
		return false
	var dy: float = float(ground) - current_y
	return dy <= STEP_UP and dy >= -STEP_DOWN


# ---- walls -----------------------------------------------------------------------------------------------------

func _candidates(x: float, z: float) -> PackedInt32Array:
	var found := PackedInt32Array()
	var cx := int(floor(x / CELL))
	var cz := int(floor(z / CELL))
	for dx in range(-1, 2):
		for dz in range(-1, 2):
			var list: Variant = _grid.get(Vector2i(cx + dx, cz + dz))
			if list != null:
				found.append_array(list)
	# Ascending index order is the web's iteration order; a wall spanning several cells is listed once.
	found.sort()
	var unique := PackedInt32Array()
	for i in found:
		if unique.is_empty() or unique[unique.size() - 1] != i:
			unique.append(i)
	return unique


## walker.ts line 28 verbatim: the wall is skipped when yMax < feet + bodyBottom or yMin > feet + bodyHeight.
## With the 92 Shinjuku segments where zMax < zMin (the station lane folds a wall's bodyMin/bodyMax into the band) this
## is NOT an empty set: such a wall blocks while yMin - bodyHeight <= feet <= yMax - bodyBottom. The web treats them as
## ordinary blocking walls inside that feet range, so this port does too.
func blocks_wall(i: int, feet_y: float) -> bool:
	return not (_ymax[i] < feet_y + BODY_BOTTOM or _ymin[i] > feet_y + BODY_TOP)


## Push a circle (x, z, RADIUS) out of every wall whose band overlaps the body (walker.ts resolveWalls).
func resolve_walls(x: float, z: float, feet_y: float) -> Vector2:
	var px := x
	var pz := z
	for _iter in range(3):
		var moved := false
		for i in _candidates(px, pz):
			if not blocks_wall(i, feet_y):
				continue
			var dx := _bx[i] - _ax[i]
			var dz := _bz[i] - _az[i]
			var len2 := dx * dx + dz * dz
			var t := 0.0 if len2 == 0.0 else clampf(((px - _ax[i]) * dx + (pz - _az[i]) * dz) / len2, 0.0, 1.0)
			var cx := _ax[i] + dx * t
			var cz := _az[i] + dz * t
			var ox := px - cx
			var oz := pz - cz
			var d := sqrt(ox * ox + oz * oz)
			if d >= RADIUS:
				continue
			if d < 1e-9:
				var n := sqrt(dx * dx + dz * dz)
				if n == 0.0:
					n = 1.0
				px += (-dz / n) * RADIUS
				pz += (dx / n) * RADIUS
			else:
				px = cx + (ox / d) * RADIUS
				pz = cz + (oz / d) * RADIUS
			moved = true
		if not moved:
			break
	return Vector2(px, pz)


# ---- colliders (bodyCollision.ts) ------------------------------------------------------------------------------

func _touches(x: float, y: float, z: float) -> bool:
	var origin := Vector3(x, y, z)
	for dir in _radial:
		if not cast(origin, dir, RADIUS, Scene.COLLIDER_LAYER).is_empty():
			return true
	return false


## The normal of the collider surface that stops the body going from `from` to `to`, or null when the move is free.
func body_block(from: Vector3, to: Vector3) -> Variant:
	var m := to - from
	var length := m.length()
	if length < 1e-6:
		return null
	var flat := Vector2(m.x, m.z).length()
	var along_dir := m / length
	for h in BODY_HEIGHTS:
		var ahead := cast(from + Vector3(0.0, h, 0.0), along_dir, length + RADIUS, Scene.COLLIDER_LAYER)
		if not ahead.is_empty():
			last_block = "ahead h=%.1f d=%.3f" % [h, ahead.distance]
			return ahead.normal
		if flat <= 1e-6:
			continue
		var px := -m.z / flat * RADIUS
		var pz := m.x / flat * RADIUS
		for side in [1.0, -1.0]:
			# A side whose origin is already past a surface (the start disc overlaps it) is not swept.
			var perpendicular := Vector3(px * side, 0.0, pz * side) / RADIUS
			if not cast(from + Vector3(0.0, h, 0.0), perpendicular, RADIUS, Scene.COLLIDER_LAYER).is_empty():
				continue
			var beside := cast(Vector3(from.x + px * side, from.y + h, from.z + pz * side), along_dir, length, Scene.COLLIDER_LAYER)
			if not beside.is_empty():
				last_block = "beside h=%.1f side=%d d=%.3f" % [h, int(side), beside.distance]
				return beside.normal
		# Radial rays at the target: the surface the motion goes most directly into.
		var touched := Vector3.ZERO
		var have := false
		var deepest := INF
		var target_origin := Vector3(to.x, to.y + h, to.z)
		for dir in _radial:
			var hit := cast(target_origin, dir, RADIUS, Scene.COLLIDER_LAYER)
			if hit.is_empty():
				continue
			var along: float = (hit.normal.x * m.x + hit.normal.z * m.z) / flat
			if along < deepest:
				deepest = along
				touched = hit.normal
				have = true
		if not have:
			continue
		if deepest < INTO:
			last_block = "pushed-into h=%.1f along=%.3f" % [h, deepest]
			return touched
		# A body that was clear must not slip into touching (rounding a corner).
		if not _touches(from.x, from.y + h, from.z):
			last_block = "slipped-into-touch h=%.1f" % h
			return touched
	return null


## The part of the horizontal move from -> to that runs along the surface `normal`, or null (bodyCollision.ts slideAlong).
static func slide_along(from: Vector3, to: Vector3, normal: Vector3) -> Variant:
	var nl := Vector2(normal.x, normal.z).length()
	if nl < 1e-6:
		return null
	var nx := normal.x / nl
	var nz := normal.z / nl
	var mx := to.x - from.x
	var mz := to.z - from.z
	var into := mx * nx + mz * nz
	var sx := mx - into * nx
	var sz := mz - into * nz
	if Vector2(sx, sz).length() < 1e-6:
		return null
	return Vector3(from.x + sx, to.y, from.z + sz)


# ---- control ---------------------------------------------------------------------------------------------------

## Start walking at `position` (Godot frame): nearest walkable ground from 1.5 m above it, 4 m of reach. `heading_deg` is
## the compass heading, clockwise from north; yaw = -heading (explorer.ts walkFrom). False when there is no ground.
func walk_from(position_godot: Vector3, heading_deg: float = 0.0) -> bool:
	var ground: Variant = ground_at(position_godot.x, position_godot.y + 1.5, position_godot.z, 4.0)
	if ground == null:
		return false
	global_position = Vector3(position_godot.x, float(ground), position_godot.z)
	yaw = -deg_to_rad(heading_deg)
	body_yaw = yaw
	_sync_avatar()
	return true


func _sync_avatar() -> void:
	avatar.rotation.y = body_yaw


## Mouse/stick look and wheel zoom, in the web's units (pixels, wheel delta) and clamps.
func apply_look(dx: float, dy: float, zoom: float) -> void:
	yaw -= dx * YAW_PER_PIXEL
	pitch = clampf(pitch - dy * PITCH_PER_PIXEL, PITCH_MIN, PITCH_MAX)
	cam_distance = clampf(cam_distance + zoom * ZOOM_PER_UNIT, DISTANCE_MIN, DISTANCE_MAX)


## One fixed step of explorer.ts stepWalk. `move.x` strafes right, `move.y` goes forward (both in [-1, 1], camera-relative).
## Returns true when the walker moved.
func step(dt: float, move: Vector2, run: bool) -> bool:
	if move.x == 0.0 and move.y == 0.0:
		return false
	var speed := RUN if run else WALK
	var fx := -sin(yaw)
	var fz := -cos(yaw)
	var rx := cos(yaw)
	var rz := -sin(yaw)
	var stride := speed * dt
	var here := global_position
	var nx := here.x + (fx * move.y + rx * move.x) * stride
	var nz := here.z + (fz * move.y + rz * move.x) * stride
	var pushed := resolve_walls(nx, nz, here.y)
	var target := Vector3(pushed.x, here.y, pushed.y)
	var block: Variant = body_block(here, target)
	if block != null:
		# Slide along the surface that stopped the move rather than sticking to it.
		var slid: Variant = slide_along(here, target, block)
		if slid == null:
			return false
		var along := resolve_walls(slid.x, slid.z, here.y)
		target = Vector3(along.x, here.y, along.y)
		if body_block(here, target) != null:
			return false
	var ground: Variant = ground_at(target.x, here.y + STEP_UP + 0.05, target.z, STEP_UP + STEP_DOWN + 0.1)
	if not accept_ground(here.y, ground):
		return false
	var new_y := lerpf(here.y, float(ground), 1.0 - exp(-HEIGHT_DAMP * dt))
	global_position = Vector3(target.x, new_y, target.z)
	# The avatar turns toward the direction of travel (the web blends the same way; avatarMotion.ts is not ported).
	var travel := Vector2(target.x - here.x, target.z - here.z)
	if travel.length() > 1e-6:
		var want := atan2(-travel.x, -travel.y)
		body_yaw += angle_difference(body_yaw, want) * (1.0 - exp(-12.0 * dt))
	_sync_avatar()
	return true
