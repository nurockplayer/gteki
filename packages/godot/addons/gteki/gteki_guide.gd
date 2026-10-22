extends RefCounted
## G-3 route state shown by the HUD: the TypeScript `gteki.route/0.1` answer (polyline in renderer coordinates,
## instructions, result facts) plus guided-walk stepping that mirrors explorer.ts `stepGuide`/`samplePolyline`.
## Nothing is routed or guessed here. A failed answer keeps its reason/message and has no polyline at all.

## Web guide tier "run" (guidePace.ts DEFAULT_GUIDE_TIER): 3.4 m/s along the path, no collisions.
const GUIDE_SPEED := 3.4
const YAW_FOLLOW := 4.0
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
	var ins: Variant = doc.get("instructions")
	if ins is Dictionary:
		instructions = {"ja": ins.get("ja", []), "en": ins.get("en", [])}
	ok = true
	return true


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
	var seg: int = sample(at).segment
	var step := step_index[mini(step_index.size() - 1, seg + 1)]
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
func start_guide(from := 0.0) -> void:
	if not ok:
		return
	guiding = true
	arrived = false
	s = clampf(from, 0.0, total())


func stop_guide() -> void:
	guiding = false


## One guided tick: advance along the path and return the sample (position, tangent). Empty when not guiding.
func advance(dt: float) -> Dictionary:
	if not guiding or not ok:
		return {}
	s = minf(total(), s + GUIDE_SPEED * dt)
	if s >= total():
		arrived = true
	return sample(s)
