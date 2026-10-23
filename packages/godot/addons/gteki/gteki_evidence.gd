extends RefCounted
## G-5 evidence routes: the routes the evidence walk covers (`tests/run_evidence_tests.gd` `PLANS`) and the bridge call
## that produces them. The capture poses (`hq/hq_capture.gd`) read the same routes, so every route in the G-5a table has
## its own captures; `tests/run_capture_tests.gd` fails if this list and the walk's plan ever disagree.
## Nothing is routed or guessed here: a route is the TypeScript router's answer through `gteki_bridge.gd`, exactly the
## call the evidence walk makes.

const Station = preload("res://addons/gteki/gteki_station.gd")

## The web's own route goldens, written by `tests/e2e/specs/02-navigation.spec.ts`.
const GOLDEN_DIR := "tests/e2e/specs/__goldens__/02-navigation.spec.ts"

## Evidence label -> golden scenario id, for the scenarios whose golden route exists. A scenario the router must refuse
## has no polyline, so it has no pose either: there is nothing to stand the camera on.
const ROUTES := {
	"ikebukuro": [
		{"label": "W1", "golden": "I1"},
		{"label": "W2", "golden": "I2"},
		{"label": "W3", "golden": "I3"},
		{"label": "W4", "golden": "I4"},
		{"label": "I7", "golden": "I7"},
	],
	"shinjuku": [
		{"label": "S1", "golden": "S1"},
		{"label": "S2", "golden": "S2"},
		{"label": "S3", "golden": "S3"},
		{"label": "S4", "golden": "S4"},
	],
}


static func routes(station_id: String) -> Array:
	return ROUTES.get(station_id, [])


static func golden_path(golden_name: String) -> String:
	return GOLDEN_DIR.path_join(golden_name)


## A station's golden file, scenario id -> {from, to, profile?, result}. Empty when it does not parse, with the reason
## printed; nothing downstream may then pretend to have a route.
static func load_golden(repo_root: String, station_id: String) -> Dictionary:
	var name := "%s-routes.json" % station_id
	var path := repo_root.path_join(golden_path(name))
	var errors: Array[String] = []
	var data := Station.read_json(path, errors)
	if not errors.is_empty():
		printerr("Golden %s does not parse: %s" % [path, str(errors)])
		return {}
	return data


## The route.ts flags for a golden scenario's `profile` block: the same three toggles the web's 02-navigation spec sets.
static func profile_args(profile: Dictionary) -> Array:
	var args: Array = []
	if bool(profile.get("stepFree", false)):
		args.append("--step-free")
	if bool(profile.get("unpaidOnly", false)):
		args.append("--unpaid-only")
	if bool(profile.get("strictHours", false)):
		args.append("--strict-hours")
	return args


## The route the bridge returns for one golden scenario, with the scenario's own profile flags. Same call the evidence
## walk makes, so a pose can only describe a route the walk checks.
static func route_for(bridge: Object, station_id: String, scenario: Dictionary) -> Dictionary:
	return bridge.route(station_id, str(scenario.from), str(scenario.to), true, true, profile_args(scenario.get("profile", {})))
