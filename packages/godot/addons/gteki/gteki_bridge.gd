extends RefCounted
## G-3 data bridge: runs the TypeScript CLIs (search ranking, router) through OS.execute and parses their JSON.
## Godot never ports the ranking or the routing. Every call returns a Dictionary with `ok` and, when not ok, `error`;
## a failure never carries a result, so the UI cannot show a fake one. Calls block while the CLI runs (about 1-3 s).

const Station = preload("res://addons/gteki/gteki_station.gd")

## Candidates tried in order; the first that can be launched is kept.
const PNPM_CANDIDATES := ["pnpm", "/opt/homebrew/bin/pnpm", "/usr/local/bin/pnpm"]

var pnpm_bin := ""
var repo_root := ""
## Last captured CLI output (for diagnostics).
var last_output := ""
var _indexes: Dictionary = {}


func _init() -> void:
	repo_root = find_repo_root()


## Walk up from the Godot project directory to the pnpm workspace root.
static func find_repo_root() -> String:
	var dir := ProjectSettings.globalize_path("res://").simplify_path()
	for i in 6:
		if FileAccess.file_exists(dir.path_join("pnpm-workspace.yaml")):
			return dir
		dir = dir.get_base_dir()
	return ""


func station_dir(station_id: String) -> String:
	return repo_root.path_join("stations").path_join(station_id)


## Run `pnpm --dir <root> --silent tsx <script> <args...>` and parse the JSON object it prints. A non-zero exit still
## parses (route.ts exits 1 for a "no route" answer that is valid JSON); `exit_code` is returned alongside.
func run_json(script: String, args: Array) -> Dictionary:
	if repo_root.is_empty():
		return _fail("Cannot find the repository root (pnpm-workspace.yaml) above %s" % ProjectSettings.globalize_path("res://"))
	var full: Array = ["--dir", repo_root, "--silent", "tsx", repo_root.path_join(script)]
	full.append_array(args)
	var output: Array = []
	var code := -1
	var candidates: Array = [pnpm_bin] if not pnpm_bin.is_empty() else PNPM_CANDIDATES
	for candidate in candidates:
		output.clear()
		code = OS.execute(candidate, full, output, true)
		# -1: could not start; 127: the shell did not find the program.
		if code != -1 and code != 127:
			pnpm_bin = candidate
			break
	last_output = "".join(output)
	if code == -1 or code == 127:
		return _fail("Cannot launch pnpm (tried %s)" % ", ".join(candidates))
	var start := last_output.find("{")
	if start < 0:
		return _fail("%s exited %d without JSON: %s" % [script.get_file(), code, last_output.strip_edges().left(400)], code)
	var json := JSON.new()
	if json.parse(last_output.substr(start)) != OK or not json.data is Dictionary:
		return _fail("%s printed invalid JSON (exit %d): %s" % [script.get_file(), code, last_output.strip_edges().left(400)], code)
	return {"ok": true, "data": json.data, "exit_code": code}


func _fail(message: String, code := -1) -> Dictionary:
	return {"ok": false, "error": message, "exit_code": code}


## `search-query.ts` ground truth. Returns {ok, query, normalized, hits:[{poiId, score, matched, routable, nodeIds}]}.
func search(station_id: String, query: String, limit := 8) -> Dictionary:
	var result := run_json("packages/godot/src/search-query.ts", [station_dir(station_id), query, "--limit", str(limit)])
	if not result.ok:
		return result
	var data: Dictionary = result.data
	if data.get("contract") != "gteki.search.result/0.1" or data.get("stationId") != station_id or not data.get("hits") is Array:
		return _fail("Unexpected search result contract for %s" % station_id)
	return {"ok": true, "query": data.query, "normalized": data.get("normalized", ""), "hits": data.hits}


## `route.ts` answer. `from_id`/`goal_id` are node ids unless the matching *_is_poi flag is set. Returns
## {ok, doc} for a found route; {ok:false, error, reason, message, doc} when the router answers "no route" (doc kept so the
## UI can show the reason; it has no polyline); {ok:false, error} when the bridge itself failed.
func route(station_id: String, from_id: String, goal_id: String, from_is_poi := false, goal_is_poi := false, extra: Array = []) -> Dictionary:
	var args: Array = [station_dir(station_id), from_id, goal_id]
	if from_is_poi:
		args.append("--from-poi")
	if goal_is_poi:
		args.append("--goal-poi")
	args.append_array(extra)
	var out := run_json("packages/cli/src/route.ts", args)
	if not out.ok:
		return out
	var doc: Dictionary = out.data
	if doc.get("contract") != "gteki.route/0.1" or doc.get("stationId") != station_id or not doc.get("result") is Dictionary:
		return _fail("Unexpected route contract for %s" % station_id)
	if doc.result.get("ok") != true:
		var reason := str(doc.result.get("reason", "unknown"))
		var message := str(doc.result.get("message", ""))
		return {"ok": false, "error": "%s: %s" % [reason, message], "reason": reason, "message": message, "doc": doc}
	return {"ok": true, "doc": doc}


## The exported `gteki.search/0.1` index of a station (display names, floors, categories), loaded once. It is exported
## through export-search.ts into .cache/search/<id>.search.json when missing.
func load_index(station_id: String) -> Dictionary:
	if _indexes.has(station_id):
		return {"ok": true, "index": _indexes[station_id]}
	if repo_root.is_empty():
		return _fail("Cannot find the repository root")
	var path := ProjectSettings.globalize_path("res://.cache/search/%s.search.json" % station_id)
	if not FileAccess.file_exists(path):
		DirAccess.make_dir_recursive_absolute(path.get_base_dir())
		var export_out: Array = []
		var code := -1
		var candidates: Array = [pnpm_bin] if not pnpm_bin.is_empty() else PNPM_CANDIDATES
		for candidate in candidates:
			code = OS.execute(candidate, ["--dir", repo_root, "--silent", "tsx", repo_root.path_join("packages/godot/src/export-search.ts"), station_dir(station_id), path], export_out, true)
			if code != -1 and code != 127:
				pnpm_bin = candidate
				break
		if code != 0 or not FileAccess.file_exists(path):
			return _fail("Search index export failed (exit %d): %s" % [code, "".join(export_out).strip_edges().left(400)])
	var errors: Array[String] = []
	var data := Station.read_json(path, errors)
	if not errors.is_empty() or data.get("contract") != "gteki.search/0.1" or data.get("stationId") != station_id or not data.get("entries") is Array:
		return _fail("Search index %s is invalid: %s" % [path, str(errors)])
	var by_id: Dictionary = {}
	for entry in data.entries:
		by_id[entry.poiId] = entry
	var floors: Dictionary = {}
	for floor_record in data.get("floors", []):
		floors[floor_record.id] = floor_record
	var index := {"entries": by_id, "floors": floors, "raw": data}
	_indexes[station_id] = index
	return {"ok": true, "index": index}


## Display name of a POI in `lang` (falls back ja, en, then the id). `index` is load_index().index.
static func poi_name(index: Dictionary, poi_id: String, lang: String) -> String:
	var entry: Variant = index.entries.get(poi_id)
	if entry == null:
		return poi_id
	for key in [lang, "ja", "en", "zh-Hant"]:
		var text: Variant = entry.names.get(key)
		if text is String and not text.is_empty():
			return text
	return poi_id


static func floor_label(index: Dictionary, floor_id: Variant, lang: String) -> String:
	if floor_id == null:
		return "?"
	var record: Variant = index.floors.get(floor_id)
	if record == null:
		return str(floor_id)
	for name in record.get("displayNames", []):
		if name.get("lang") == lang:
			return name.text
	var labels: Array = record.get("sourceLabels", [])
	return labels[0] if not labels.is_empty() else str(floor_id)
