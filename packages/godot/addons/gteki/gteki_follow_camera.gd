extends Camera3D
## Third-person follow camera: a port of the web explorer's framing and clamping, so it never passes through a
## ceiling, slab underside, wall or floor the web camera would not pass. Mirrors (apps/web/src/explorer/):
##   FOLLOW constants, follow_pose      followCamera.ts:9-55
##   clamp_distance, follow_distance    followCamera.ts:62-78
##   follow_boom                        followCamera.ts:87-109
##   keep_below_blockers                raycast.ts:111-122
##   follow()                           explorer.ts:1085-1117 placeCamera (shoulder ray, boom, smoothing, blockers)
## The camera stops at walls (colliders, layer 1), ground (walkable, layer 4) and camera blockers (layer 2), as the web's
## `camera` target set does (raycast.ts:60-69). Wall SEGMENTS from the sidecar are analytic walker rules and, as on the
## web, do not stop the camera. FOV defaults to the web's 60 degrees; `fov` stays an ordinary Camera3D property.

const Scene = preload("res://addons/gteki/gteki_scene.gd")
const Assets = preload("res://addons/gteki/gteki_assets.gd")

const DEFAULT_FOV := 60.0
const EYE := 1.62
const LIFT := 0.14
const SHOULDER := 0.42
const AIM := 5.0
const CLEARANCE := 0.3
const MIN_DISTANCE := 0.55
const DROP := 0.45
const BOOM_STEPS := 6
const LOWEST_BOOM := -0.1
const BOOM_KEEP := 0.85
const BOOM_GAIN := 0.25
## Position smoothing rate (explorer.ts:1114), per second.
const SMOOTHING := 10.0
## Most hits collected along one ray (a ray is re-cast from just past each hit).
const MAX_HITS := 8
const CAMERA_MASK := Scene.COLLIDER_LAYER | Assets.CAMERA_LAYER | Scene.GROUND_LAYER

var last_pivot := Vector3.ZERO
var last_distance := 0.0
var _query := PhysicsRayQueryParameters3D.new()


func _init() -> void:
	fov = DEFAULT_FOV
	near = 0.05
	far = 2000.0
	_query.hit_back_faces = true


## Hits along origin + dir * far, nearest first: [{distance, camera_only}]. Godot reports one hit per ray, so the ray
## is re-cast from just past each one (three.js returns them all).
func cast_all(origin: Vector3, dir: Vector3, far_m: float, mask: int = CAMERA_MASK) -> Array:
	var hits: Array = []
	var start := origin
	var travelled := 0.0
	var space := get_world_3d().direct_space_state
	for _i in range(MAX_HITS):
		if travelled >= far_m:
			break
		_query.from = start
		_query.to = start + dir * (far_m - travelled)
		_query.collision_mask = mask
		var hit := space.intersect_ray(_query)
		if hit.is_empty():
			break
		var d := start.distance_to(hit.position)
		var layer: int = hit.collider.collision_layer
		hits.append({"distance": travelled + d, "camera_only": layer == Assets.CAMERA_LAYER})
		travelled += d + 0.002
		start = hit.position + dir * 0.002
	return hits


static func view_direction(yaw: float, pitch: float) -> Vector3:
	return Vector3(-sin(yaw) * cos(pitch), sin(pitch), -cos(yaw) * cos(pitch))


static func clamp_distance(wanted: float, hit_distance: Variant, camera_only: bool) -> float:
	if hit_distance == null:
		return wanted
	return maxf(0.0 if camera_only else MIN_DISTANCE, minf(wanted, float(hit_distance) - CLEARANCE))


## Distance for a ray's hits (nearest first): the nearest clamps as usual, and a camera-only blocker then bounds it on its own.
static func follow_distance(wanted: float, hits: Array) -> float:
	var first_distance: Variant = null
	var first_only := false
	if not hits.is_empty():
		first_distance = hits[0].distance
		first_only = hits[0].camera_only
	var distance := clamp_distance(wanted, first_distance, first_only)
	for h in hits:
		if h.camera_only:
			distance = minf(distance, maxf(0.0, float(h.distance) - CLEARANCE))
			break
	return distance


## Boom direction and distance; under a camera-only blocker the boom slides lower (never raised, never below LOWEST_BOOM).
## `cast_fn` takes a candidate `back` and returns its hits.
static func follow_boom(wanted: float, back: Vector3, cast_fn: Callable) -> Dictionary:
	var hits: Array = cast_fn.call(back)
	var d0 := follow_distance(wanted, hits)
	var wall_hits: Array = hits.filter(func(h: Dictionary) -> bool: return not h.camera_only)
	var d_walls := follow_distance(wanted, wall_hits)
	var unchanged := {"back": back, "distance": d0}
	if d0 >= d_walls - 0.05:
		return unchanged
	var flat := Vector2(back.x, back.z).length()
	if flat < 1e-6 or back.y <= LOWEST_BOOM:
		return unchanged
	var best: Dictionary = {}
	for i in range(1, BOOM_STEPS + 1):
		var s := back.y + (LOWEST_BOOM - back.y) * float(i) / BOOM_STEPS
		var c := sqrt(1.0 - s * s)
		var candidate := Vector3(back.x / flat * c, s, back.z / flat * c)
		var distance := follow_distance(wanted, cast_fn.call(candidate))
		if distance >= BOOM_KEEP * wanted:
			return {"back": candidate, "distance": distance}
		if best.is_empty() or distance > best.distance:
			best = {"back": candidate, "distance": distance}
	if not best.is_empty() and best.distance >= d0 + BOOM_GAIN:
		return best
	return unchanged


## Pull `position` in front of any camera-only blocker between the pivot and it (raycast.ts keepBelowBlockers).
func keep_below_blockers(pivot: Vector3, position_in: Vector3) -> Vector3:
	var offset := position_in - pivot
	var length := offset.length()
	if length < 1e-9:
		return position_in
	var hits := cast_all(pivot, offset / length, length + CLEARANCE, Assets.CAMERA_LAYER)
	if hits.is_empty():
		return position_in
	return pivot + offset * (minf(length, maxf(0.0, float(hits[0].distance) - CLEARANCE)) / length)


## Place the camera for `walker` (yaw, pitch, cam_distance, feet). `snap` skips smoothing (teleport, tests).
func follow(walker: Node3D, dt: float, snap: bool = false) -> void:
	var yaw: float = walker.yaw
	var pitch: float = walker.pitch
	var wanted: float = walker.cam_distance
	var head: Vector3 = walker.global_position + Vector3(0.0, EYE, 0.0)
	var direction := view_direction(yaw, pitch)
	var right := Vector3(cos(yaw), 0.0, -sin(yaw))
	# Over-the-shoulder framing; the pivot itself is pulled in if a wall is closer than the shoulder offset.
	var shoulder := SHOULDER
	var side := cast_all(head, right, SHOULDER + 0.25)
	if not side.is_empty():
		shoulder = maxf(0.0, float(side[0].distance) - 0.25)
	var pivot := head + right * shoulder
	var back := (-direction + Vector3(0.0, LIFT, 0.0)).normalized()
	var target := pivot + direction * AIM
	target.y -= DROP
	var cast_fn := func(b: Vector3) -> Array: return cast_all(pivot, b, wanted + CLEARANCE)
	var boom := follow_boom(wanted, back, cast_fn)
	var desired: Vector3 = pivot + boom.back * float(boom.distance)
	var weight := 1.0 if snap else 1.0 - exp(-dt * SMOOTHING)
	var next := global_position.lerp(desired, weight)
	# The smoothed position, not only the target, stays below camera-only blockers.
	next = keep_below_blockers(pivot, next)
	global_position = next
	last_pivot = pivot
	last_distance = pivot.distance_to(next)
	if target.distance_to(next) > 1e-4:
		look_at(target)
