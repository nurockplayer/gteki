extends RefCounted
## G-3 route state shown by the HUD: the TypeScript `gteki.route/0.1` answer (polyline in renderer coordinates,
## instructions, result facts) plus guided-walk stepping that mirrors explorer.ts `stepGuide`/`samplePolyline`.
## Nothing is routed or guessed here. A failed answer keeps its reason/message and has no polyline at all.

const Walker = preload("res://addons/gteki/gteki_walker.gd")

## Web guide tier "run" (guidePace.ts DEFAULT_GUIDE_TIER): 3.4 m/s along the path, no collisions.
const GUIDE_SPEED := 3.4
const YAW_FOLLOW := 4.0
## A lift ride is read from the guided route itself (#287): inside an `elevator` step, a consecutive polyline pair that
## moves horizontally less than RIDE_MAX_FLAT while changing height by more than RIDE_MIN_DROP is the shaft. Measured on
## Shinjuku S4, the one shaft in the goldens: 0.473 m horizontal, 7.8 m drop (inside the 0.5 m gate; a flat elevator
## step's 1.29 m entry walk and any stair are outside it). Nothing is ever ridden that is not an `elevator` step.
const RIDE_MAX_FLAT := 0.5
const RIDE_MIN_DROP := 1.0
## How close the walker must be to a ride's start for it to be offered: the HQ walker cannot step onto the shaft's edge,
## so the last stretch of ground before it is not walkable (0.62 m on S4, measured).
const RIDE_TRIGGER := 1.0
## Result keys shown verbatim by the HUD (freshness / confidence); missing keys are skipped, nothing is invented.
const FACT_KEYS := ["totalLengthM", "estimatedSeconds", "waitSeconds", "floorChanges", "crossesFareBoundary", "evidenceCheckedDate", "oldestSourceDate", "undatedSourceIds", "expiredSourceIds", "stale", "synthetic", "unknowns", "timeRestricted", "sourceIds"]

var ok := false
var reason := ""
var message := ""
var result: Dictionary = {}
var instructions: Dictionary = {"ja": [], "en": []}
var points := PackedVector3Array()
var z_known: Array[bool] = []
var step_index: Array[int] = []
var cumulative := PackedFloat32Array()
## True when any polyline point has no surveyed height (zKnown false): heights are symbolic and drawn dashed.
var symbolic := false
## The rides this route states (#287), each {step, from_point, to_point, from, to, drop, plan_m, from_s, to_s}. Read
## from the route's own `elevator` steps in load_doc; empty on a route with no shaft.
var rides: Array = []
## Every vertical span the polyline makes, whatever its step's mode (`find_shafts`). A route that jumps more than
## RIDE_MIN_DROP over less than RIDE_MAX_FLAT on a step that is not an `elevator` is neither walkable nor a lift, and the
## evidence walk fails it explicitly instead of reporting the stall it causes.
var shafts: Array = []
## The step ids ridden on this route. Guided motion stops at a shaft that is not in here: E is the only way past it.
var ridden: Array[int] = []
var issues: Array[String] = []

# Guided walk
var guiding := false
var arrived := false
var s := 0.0


func total() -> float:
	return cumulative[cumulative.size() - 1] if cumulative.size() > 0 else 0.0


func clear() -> void:
	ok = false; reason = ""; message = ""; result = {}
	instructions = {"ja": [], "en": []}
	points = PackedVector3Array(); z_known.clear(); step_index.clear(); cumulative = PackedFloat32Array()
	rides.clear(); shafts.clear(); ridden.clear()
	symbolic = false; issues.clear(); guiding = false; arrived = false; s = 0.0


## Load a `gteki.route/0.1` document (from the bridge). False for a failed route (reason/message kept) or a malformed one
## (issues filled); in both cases there is no polyline.
func load_doc(doc: Dictionary) -> bool:
	clear()
	if doc.get("contract") != "gteki.route/0.1" or not doc.get("result") is Dictionary:
		issues.append("Not a gteki.route/0.1 document")
		return false
	result = doc.result
	if result.get("ok") != true:
		reason = str(result.get("reason", "unknown"))
		message = str(result.get("message", ""))
		return false
	if not doc.get("polyline") is Array or doc.polyline.size() < 2:
		issues.append("A found route needs a polyline of at least two points")
		return false
	var prev := Vector3.ZERO
	var run := 0.0
	cumulative.append(0.0)
	for i in doc.polyline.size():
		var p: Variant = doc.polyline[i]
		if not p is Dictionary or not p.get("renderer") is Array or p.renderer.size() != 3 or not p.renderer.all(func(v): return v is float or v is int):
			issues.append("Invalid polyline point %d" % i)
			points.clear()
			return false
		var q := Vector3(p.renderer[0], p.renderer[1], p.renderer[2])
		points.append(q)
		z_known.append(p.get("zKnown") != false)
		step_index.append(int(p.get("stepIndex", -1)))
		if i > 0:
			run += prev.distance_to(q)
			cumulative.append(run)
		prev = q
	symbolic = z_known.has(false)
	shafts = find_shafts(result.get("steps", []), points, step_index, cumulative)
	rides = find_rides(result.get("steps", []), points, step_index, cumulative)
	var ins: Variant = doc.get("instructions")
	if ins is Dictionary:
		instructions = {"ja": ins.get("ja", []), "en": ins.get("en", [])}
	ok = true
	return true


## Every vertical span the polyline makes, whatever its step's mode: for each step, every consecutive polyline pair
## inside that step's span that moves horizontally < RIDE_MAX_FLAT and changes height by > RIDE_MIN_DROP. A step's span
## runs from the point before its first point to its last point (a point's stepIndex names the step that ends there).
## Pure, so the tests can state the gates. `find_rides` keeps only the spans on `elevator` steps; the others are jumps
## no step calls a lift, which the walk reports rather than stalling at.
static func find_shafts(steps: Array, points: PackedVector3Array, point_steps: Array[int], cumulative: PackedFloat32Array) -> Array:
	var found: Array = []
	for step_id in range(steps.size()):
		var first := -1
		var last := -1
		for k in point_steps.size():
			if point_steps[k] == step_id:
				if first < 0:
					first = k
				last = k
		if first < 0:
			continue
		var run := maxi(0, first - 1)
		for k in range(run + 1, last + 1):
			var p := points[k - 1]
			var q := points[k]
			var flat := Vector2(q.x - p.x, q.z - p.z).length()
			var drop := q.y - p.y
			if flat < RIDE_MAX_FLAT and absf(drop) > RIDE_MIN_DROP:
				found.append({"step": step_id, "from_point": k - 1, "to_point": k, "from": p, "to": q, "drop": drop, "plan_m": flat, "from_s": cumulative[k - 1], "to_s": cumulative[k]})
	return found


## The rides a route states: the vertical spans that sit on an `elevator` step. The same span under any other mode is no
## ride, so a vertical jump nobody calls a lift can never be ridden.
static func find_rides(steps: Array, points: PackedVector3Array, point_steps: Array[int], cumulative: PackedFloat32Array) -> Array:
	var found: Array = []
	for shaft in find_shafts(steps, points, point_steps, cumulative):
		if str((steps[int(shaft.step)] as Dictionary).get("mode", "")) == "elevator":
			found.append(shaft)
	return found


## The route step whose span holds the path distance `at` (the segment's end point names the step, as the web guide's
## highlight does); -1 for a route with no polyline.
func step_at(at: float) -> int:
	if step_index.is_empty() or points.size() < 2:
		return -1
	if at >= total():
		return step_index[step_index.size() - 1]
	var seg: int = sample(clampf(at, 0.0, total())).segment
	var step := step_index[mini(step_index.size() - 1, seg + 1)]
	# A lift ride belongs to the last stretch of its approach too (#287): on the segment that ends at the ride's start the
	# ride's own elevator step is already the active one, but only within RIDE_TRIGGER of the shaft — the same distance
	# the ride is offered over. The ground walker stops short of the shaft (the ground ends there), so without this the
	# lift's step would never be showing where a player is standing when the lift is offered; further back the walk
	# step keeps the highlight.
	if ride_on_step(step).is_empty() and seg + 2 < step_index.size():
		var ahead := ride_on_step(step_index[seg + 2])
		if not ahead.is_empty() and int(ahead.from_point) == seg + 1 and float(ahead.from_s) - at <= RIDE_TRIGGER:
			return step_index[seg + 2]
	return step


## The ride stated on `step`, or {} when that step is not a lift ride.
func ride_on_step(step: int) -> Dictionary:
	for ride in rides:
		if int(ride.step) == step:
			return ride
	return {}


## The ride the walker may take now: a ride on `step` whose start is within RIDE_TRIGGER of `position` (3D). {} when
## none — a ride is offered only on its own elevator step (or the approach that ends at its start), so no other step can
## trigger a teleport.
func ride_at(position: Vector3, step: int) -> Dictionary:
	var ride := ride_on_step(step)
	if ride.is_empty() or position.distance_to(ride.from) > RIDE_TRIGGER:
		return {}
	return ride


## The ride offered at distance `at` along the path, from where the walker stands. The one predicate the HQ HUD's prompt
## and the evidence walk both read, so the client and the replay can never disagree about when a lift is offered.
func ride_near(position: Vector3, at: float) -> Dictionary:
	return ride_at(position, step_at(at))


## Take a detected ride: the walker's feet go to the shaft's exit by its own rules (`walker.ride_to`, which accepts only
## ground `accept_ground` allows, on the exit's level, forward along the route and in the clear) and the guide moves to
## the exit, so the next tick continues from where the lift put the walker. False when nothing qualifies: a ride never
## lands on nothing, across a wall or behind the shaft. Shared by the HQ HUD and the evidence walk.
func take_ride(walker: Object, ride: Dictionary) -> bool:
	var to_point := int(ride.to_point)
	var forward := Vector3.ZERO
	if to_point + 1 < points.size():
		forward = points[to_point + 1] - points[to_point]
	elif to_point > 0:
		forward = points[to_point] - points[to_point - 1]
	if not walker.ride_to(ride.to, forward):
		return false
	# Guided motion continues from where the lift put the feet, never from the exit vertex over the opening: the guide
	# moves to the projected landing (never back, so at least the shaft's exit), and the shaft is marked as ridden so the
	# gate below lets the walk on (#287 review).
	var landed: Vector3 = walker.feet() if walker.has_method("feet") else walker.global_position
	# Never before the exit and never more than the landing's own reach past it: on a route that doubles back near the
	# exit the projection could otherwise jump `s` over later vertices.
	var limit := minf(total(), float(ride.to_s) + Walker.RIDE_LANDING_REACH)
	s = clampf(maxf(float(ride.to_s), float(project(landed).s)), minf(float(ride.to_s), limit), limit)
	if not ridden.has(int(ride.step)):
		ridden.append(int(ride.step))
	return true


## The ride a guided tick from `at` to `next_s` would pass without riding it, or {} when the stretch is free. Guided
## motion never crosses a shaft the route states until the ride is taken: E is the only way past it.
func ride_ahead(at: float, next_s: float) -> Dictionary:
	for ride in rides:
		if ridden.has(int(ride.step)):
			continue
		if at < float(ride.to_s) and next_s > float(ride.from_s):
			return ride
	return {}


## explorer samplePolyline: position and horizontal tangent at distance `at` along the path, plus the segment index.
func sample(at: float) -> Dictionary:
	var count := points.size()
	if count == 0:
		return {}
	var clamped := clampf(at, 0.0, total())
	var i := 1
	while i < count - 1 and cumulative[i] < clamped:
		i += 1
	var a := points[i - 1]
	var b := points[mini(i, count - 1)]
	var seg := cumulative[i] - cumulative[i - 1]
	var t := (clamped - cumulative[i - 1]) / seg if seg > 0.0 else 0.0
	var tangent := Vector2(b.x - a.x, b.z - a.z)
	tangent = tangent.normalized() if tangent.length() > 1e-6 else Vector2.ZERO
	return {"position": a.lerp(b, t), "tx": tangent.x, "tz": tangent.y, "segment": i - 1}


## Distance along the path of the point nearest to `position` (3D), and how far away it is.
func project(position: Vector3) -> Dictionary:
	var best_s := 0.0
	var best_d := INF
	for i in range(1, points.size()):
		var a := points[i - 1]
		var ab := points[i] - a
		var len2 := ab.length_squared()
		var t := clampf((position - a).dot(ab) / len2, 0.0, 1.0) if len2 > 0.0 else 0.0
		var d := position.distance_to(a + ab * t)
		if d < best_d:
			best_d = d
			best_s = cumulative[i - 1] + sqrt(len2) * t
	return {"s": best_s, "distance": best_d}


## Index into instructions[lang] of the step that `at` (distance along the path) lies in. Same rule as the web guide:
## the segment's end point names the step; start before any step, arrive at the end.
func instruction_at(at: float, lang: String) -> int:
	var list: Array = instructions.get(lang, [])
	if list.is_empty():
		return -1
	if at >= total() - 0.3:
		return list.size() - 1
	var step := step_at(at)
	if step < 0:
		return 0
	for i in list.size():
		if list[i].get("stepIndexes", []).has(step):
			return i
	return 0


func facts() -> Array:
	var out: Array = []
	for key in FACT_KEYS:
		if result.has(key):
			out.append([key, result[key]])
	return out


## Start guided walking at distance `from`; stops at the end, no collision, same as the web guide.
## A shaft ahead of the new start counts as not ridden again — toggling guided walking back on at the departure floor
## must offer the same lift and clamp at it, not fly through it — and a start strictly inside a shaft backs up to the
## shaft's start, where the lift is offered: a clamped advance inside the span would otherwise freeze with no prompt.
func start_guide(from := 0.0) -> void:
	if not ok:
		return
	guiding = true
	arrived = false
	s = clampf(from, 0.0, total())
	for step in ridden.duplicate():
		var taken := ride_on_step(step)
		if not taken.is_empty() and float(taken.from_s) >= s:
			ridden.erase(step)
	for ride in rides:
		if float(ride.from_s) < s and s < float(ride.to_s):
			s = float(ride.from_s)
			break


func stop_guide() -> void:
	guiding = false


## One guided tick: advance along the path and return the sample (position, tangent). Empty when not guiding. Motion
## stops at a shaft the route states and has not ridden yet: the tick lands on the shaft's start and stays there until
## take_ride() succeeds, so guided walking can never skip a lift the route asks for.
func advance(dt: float) -> Dictionary:
	if not guiding or not ok:
		return {}
	var next_s := minf(total(), s + GUIDE_SPEED * dt)
	var gate := ride_ahead(s, next_s)
	if not gate.is_empty():
		next_s = maxf(s, minf(next_s, float(gate.from_s)))
	s = next_s
	if s >= total():
		arrived = true
	return sample(s)
