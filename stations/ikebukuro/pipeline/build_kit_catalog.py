"""Lane E station catalog for stair and escalator dressing, from the survey anchors.

    python3 -I stations/ikebukuro/pipeline/build_kit_catalog.py [--anchors scene/dressing_anchors.json]
        [--station gteki/station.json] [--glb gteki/assets/ikebukuro_b1.glb] [--out-dir scene]

Reads scene/dressing_anchors.json (and the committed base GLB for wall proximity) and writes

    scene/kit_catalog.json     Lane E catalog (tools/blender/catalog schema): `CATALOG=<path>` builds the GLBs
    scene/kit_placements.json  per anchor flight / lane: catalog ids plus the ENU transform of the piece origin

Stdlib only, deterministic: same inputs, same bytes. Nothing here changes the lit GLB, the bake or the graph.

Generator conventions (tools/blender/gteki_assets/families/dressing.py, PR #143):

* stair_dressing: `step_count` nosing lines, `riser_mm` apart in height and `tread_mm` apart along the flight;
  nosing i sits at y = i * tread, z = (i + 1) * riser. Origin: the floor under the first nosing, centred in X, so
  origin z = first nosing z - riser. The survey's `steps` counts nosing lines, so riser = rise / (steps - 1) and
  tread = the mean nosing-to-nosing run. A stair kit that mixes nosings with rails has no bake role, so every
  flight becomes two entries: `..._nosing` (parts [nosing], role stairs_ramps) and `..._rails` (parts [handrail],
  role barriers).
* escalator_dressing (Lane E, from vertical._escalator_path: transition run 0.8 m, flat run 0.8 m at each end):
  origin on the bottom comb line, rising toward +Y. The surveyed quad is the straight incline between the floors,
  so the entry passes `angle_deg` = atan2(rise, quad run) (no `run_mm`) and the kit's straight middle incline lies
  on the slab line. The bottom comb is ESC_COMB_OFFSET_M (1.2 m) before the quad's lower line along the travel
  direction, at the lower floor height; the top comb is 1.2 m past the upper line, so comb to comb is run + 2.4 m.
  Near the corners the easing rides up to ~6 cm off the slab corner. `width_mm` is the tread (step) width, read as
  the clear gap between the surveyed truss plates; the kit adds skirt +-(w/2 + 12), glass +-(w/2 + 160), overall
  w + 600. `direction` is not surveyed and is left out of the params (the generator default applies).

Rails entries carry `rail_segments` 6 (Lane E #143: integer 6-16, default 10) and leave `post_spacing_mm` at the
default. Placements carry `tiers` (per catalog id role: the quality tiers that draw it) and, for stairs, `main_route`:
true when a polyline of one of Lane F's golden guided routes (tests/e2e/specs/__goldens__/02-navigation.spec.ts/
ikebukuro-routes.json, built from the edges' `geometry` in gteki/graph.json) passes within 1.0 m horizontally of the
flight's centre line, between its bottom and top, at a height within the flight's z range +- 0.3 m (a route
whose stairs edge matches no flight, because the graph edge is a coarse straight segment, falls back to flights within
4 m of that edge, recorded as `fallback_radius_m` in the summary). Nosings draw on
low and high, escalators on high only (low waits for phone measurement), rails on high only and only on main-route
flights.

Frame of a placement: ENU metres. The piece's local +Y (travel, up the flight) maps to `dir`, local +X (width)
to the right of `dir`; `yaw_deg` is the counter-clockwise rotation about +Z that does that.
"""
import argparse
import hashlib
import json
import math
import os
import struct
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

CATALOG_NAME = "gteki-ikebukuro"
CATALOG_VERSION = "0.1.0"
PLACEMENTS_SCHEMA = "gteki.ikebukuro.kit-placements/0"
SOURCE_ID = "plateau-ubld-13116"
ID_PREFIX = "gteki_ik_"

QUANT_MM = 1                  # whole mm: flights are nearly all unique anyway, and coarser snapping accumulates over a flight
RISER_MM = (100, 220)         # a plausible stair riser, on the unquantised value
MIN_TREAD_MM = 200
# The generator spaces nosings by one uniform riser, and its nosing strip is 6 mm high (dressing.py _nosings): a
# flight whose surveyed nosings stray further than that from the uniform spacing would get buried or floating strips.
MAX_NOSING_DEV_MM = 6.0
STEP_COUNT = (2, 80)          # the generator's own limit
ESC_ANGLE_DEG = (15.0, 35.0)  # the generator's accepted incline
ESC_COMB_OFFSET_M = 1.2       # bottom comb line before the quad's lower line (and top comb past the upper line)
ESC_LANDING_MM = 800          # the generator default; the anchors say nothing different
ESC_PARTS = ["balustrade", "handrail", "newel", "comb"]
WALL_NEAR_M = 0.3
WALL_SIDE_SHARE = 0.5         # a side counts as walled when this share of its nosings has a wall within WALL_NEAR_M
# Baked-AO texture size per entry (px), pinned as Shinjuku does: unpinned, the kit stepped 29 full-tier pieces up to
# 1024 px (~285 MB of AO on the GPU). One pin applies to both tiers; a piece whose chart no longer fits fails its
# build (LightmapOverflow), so Lane E trial-builds both tiers before this lands. Allowed: 128, 256, 512, 1024.
AO_RES = {"stair_dressing": 128, "escalator_dressing": 256}
RAIL_SEGMENTS = 6             # rail_segments param of the rails entries (generator range 6-16, default 10)
ROUTE_NEAR_M = 1.0            # a golden route polyline within this of the flight's centre line uses the flight
ROUTE_FALLBACK_M = 4.0        # a route with a stairs edge but no flight within ROUTE_NEAR_M: flights this close to that edge
ROUTE_Z_PAD_M = 0.3
ROUTE_SAMPLE_M = 0.25
# Lane E triangle counts (#143): mobile profile, escalators 20.3k over the 5 ids and nosings 7.2k over the 61 ids;
# full profile, all 61 rails ids at rail_segments 6 153k. Per-id estimates scale these evenly.
TRIS_ESCALATORS_MOBILE = 20300
TRIS_NOSING_MOBILE = 7200
TRIS_RAILS_FULL_ALL = 153000
ROUTES_REL = os.path.join("tests", "e2e", "specs", "__goldens__", "02-navigation.spec.ts", "ikebukuro-routes.json")
RAIL_PROBE_M = 0.9            # height above the tread at which the wall probe is taken


def sha256_file(path):
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


def quant(mm):
    """Snap to QUANT_MM, halves up (not Python's banker's rounding), so the result never depends on float noise."""
    return int(math.floor(mm / QUANT_MM + 0.5)) * QUANT_MM


def median(values):
    s = sorted(values)
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def yaw_deg(direction):
    """CCW rotation about +Z taking local +Y (travel) to `direction`."""
    deg = math.degrees(math.atan2(direction[1], direction[0])) - 90.0
    deg = (deg + 180.0) % 360.0 - 180.0
    return round(deg, 3) + 0.0


# --------------------------------------------------------------------------------------- wall proximity

def read_wall_triangles(glb_path):
    """Triangles (ENU metres) of the `wall` role mesh of a plain GLB; glTF (x, y, z) is ENU (x, -z, y)."""
    with open(glb_path, "rb") as f:
        b = f.read()
    json_len = struct.unpack_from("<I", b, 12)[0]
    j = json.loads(b[20:20 + json_len])
    bin_start = 20 + json_len + 8
    tris = []
    for node in j["nodes"]:
        if (node.get("extras") or {}).get("gteki_role") != "wall" or "mesh" not in node:
            continue
        for prim in j["meshes"][node["mesh"]]["primitives"]:
            pos, idx = j["accessors"][prim["attributes"]["POSITION"]], j["accessors"][prim["indices"]]

            def base(acc):
                bv = j["bufferViews"][acc["bufferView"]]
                return bin_start + bv.get("byteOffset", 0) + acc.get("byteOffset", 0), bv.get("byteStride")

            p0, stride = base(pos)
            stride = stride or 12
            i0, _ = base(idx)
            wide = idx["componentType"] == 5125
            for t in range(0, idx["count"], 3):
                tri = []
                for k in range(3):
                    n = struct.unpack_from("<I" if wide else "<H", b, i0 + (t + k) * (4 if wide else 2))[0]
                    x, y, z = struct.unpack_from("<3f", b, p0 + n * stride)
                    tri.append((x, -z, y))
                tris.append(tuple(tri))
    return tris


def point_tri_dist(p, tri):
    """Distance from p to a triangle (Ericson, Real-Time Collision Detection, closest point on triangle)."""
    a, b, c = tri
    sub = lambda u, v: (u[0] - v[0], u[1] - v[1], u[2] - v[2])
    dot = lambda u, v: u[0] * v[0] + u[1] * v[1] + u[2] * v[2]
    add = lambda u, v, s: (u[0] + v[0] * s, u[1] + v[1] * s, u[2] + v[2] * s)
    ab, ac, ap = sub(b, a), sub(c, a), sub(p, a)
    d1, d2 = dot(ab, ap), dot(ac, ap)
    bp = sub(p, b)
    d3, d4 = dot(ab, bp), dot(ac, bp)
    cp = sub(p, c)
    d5, d6 = dot(ab, cp), dot(ac, cp)
    vc, vb, va = d1 * d4 - d3 * d2, d5 * d2 - d1 * d6, d3 * d6 - d5 * d4
    if d1 <= 0 and d2 <= 0:
        q = a
    elif d3 >= 0 and d4 <= d3:
        q = b
    elif vc <= 0 and d1 >= 0 and d3 <= 0:
        q = add(a, ab, d1 / (d1 - d3))
    elif d6 >= 0 and d5 <= d6:
        q = c
    elif vb <= 0 and d2 >= 0 and d6 <= 0:
        q = add(a, ac, d2 / (d2 - d6))
    elif va <= 0 and d4 - d3 >= 0 and d5 - d6 >= 0:
        q = add(b, sub(c, b), (d4 - d3) / ((d4 - d3) + (d5 - d6)))
    else:
        den = 1.0 / (va + vb + vc)
        q = add(add(a, ab, vb * den), ac, vc * den)
    return math.dist(p, q)


class WallIndex:
    """1 m grid over the wall triangles' xy extents, grown by WALL_NEAR_M."""

    CELL = 1.0

    def __init__(self, tris):
        self.cells = {}
        for t in tris:
            xs, ys = [v[0] for v in t], [v[1] for v in t]
            for cx in range(int(math.floor((min(xs) - WALL_NEAR_M) / self.CELL)), int(math.floor((max(xs) + WALL_NEAR_M) / self.CELL)) + 1):
                for cy in range(int(math.floor((min(ys) - WALL_NEAR_M) / self.CELL)), int(math.floor((max(ys) + WALL_NEAR_M) / self.CELL)) + 1):
                    self.cells.setdefault((cx, cy), []).append(t)

    def near(self, p):
        key = (int(math.floor(p[0] / self.CELL)), int(math.floor(p[1] / self.CELL)))
        return any(point_tri_dist(p, t) <= WALL_NEAR_M for t in self.cells.get(key, ()))


def wall_share(flight, walls):
    """Share of the flight's nosings with a wall within WALL_NEAR_M of the left (a) and right (b) end, at rail height."""
    left = right = 0
    for ax, ay, bx, by, z in flight["nosings"]:
        left += walls.near((ax, ay, z + RAIL_PROBE_M))
        right += walls.near((bx, by, z + RAIL_PROBE_M))
    n = len(flight["nosings"])
    return left / n, right / n


# ------------------------------------------------------------------------------------------ main route

def route_polylines(routes, graph):
    """Golden route id -> (ENU polyline built from the walked edges' geometry, polyline of its stairs edges only)."""
    edges = {e["id"]: e for e in graph["edges"]}
    out = {}
    for rid in sorted(routes):
        steps = (routes[rid].get("result") or {}).get("steps") or []
        pts, stair_pts = [], []
        for step in steps:  # ">edge_id" walks the edge as drawn, "<edge_id" reversed
            edge = edges[step[1:]]
            line = [(g["x"], g["y"], g["z"]) for g in edge["geometry"]]
            if step[0] == "<":
                line.reverse()
            if edge["mode"] == "stairs":
                stair_pts.append(line)
            pts.extend(line if not pts or pts[-1] != line[0] else line[1:])
        if pts:
            out[rid] = (pts, stair_pts)
    return out


def densify(pts, step=ROUTE_SAMPLE_M):
    out = [pts[0]]
    for a, b in zip(pts, pts[1:]):
        n = max(1, int(math.ceil(math.dist(a, b) / step)))
        out.extend(tuple(a[k] + (b[k] - a[k]) * i / n for k in range(3)) for i in range(1, n + 1))
    return out


def flight_on_route(flight, samples, near=ROUTE_NEAR_M):
    ax, ay, az = flight["bottom"]["position"]
    bx, by, bz = flight["top"]["position"]
    dx, dy = bx - ax, by - ay
    len2 = dx * dx + dy * dy
    lo, hi = min(az, bz) - ROUTE_Z_PAD_M, max(az, bz) + ROUTE_Z_PAD_M
    for x, y, z in samples:
        if not lo <= z <= hi:
            continue
        t = ((x - ax) * dx + (y - ay) * dy) / len2 if len2 else 0.0
        if 0.0 <= t <= 1.0 and math.hypot(x - (ax + t * dx), y - (ay + t * dy)) <= near:
            return True
    return False


# --------------------------------------------------------------------------------------------- planning

def plan_stair(flight, walls):
    """(params, quantisation record, placement fields) or (None, reason, None)."""
    n = flight["steps"]
    if n < STEP_COUNT[0]:
        return None, f"{n}-step flight: no riser or tread to measure (generator needs step_count >= {STEP_COUNT[0]})", None
    if n > STEP_COUNT[1]:
        return None, f"{n} steps exceeds the generator's step_count limit {STEP_COUNT[1]}", None
    riser = flight["rise_m"] * 1000.0 / (n - 1)
    tread = (flight["run_m"] or 0.0) * 1000.0
    if not RISER_MM[0] <= riser <= RISER_MM[1]:
        return None, f"implausible riser {riser:.0f} mm ({n} steps, rise {flight['rise_m']} m); outside {RISER_MM[0]}-{RISER_MM[1]} mm", None
    if tread < MIN_TREAD_MM:
        return None, f"implausible tread {tread:.0f} mm (run {flight['run_m']} m per step); under {MIN_TREAD_MM} mm", None
    # Each surveyed nosing (not every step has one) against the strip the generator will actually build for that step:
    # the step index comes from the survey's own spacing, the height from the whole-millimetre riser the catalog ships,
    # stacked from the placement origin (the bottom nosing), so rounding drift over a long flight counts too.
    z0, step, built = flight["bottom"]["position"][2], flight["rise_m"] / (n - 1), quant(riser) / 1000.0
    dev = max((abs((r[4] - z0) - round((r[4] - z0) / step) * built) for r in flight["nosings"]), default=0.0) * 1000.0
    if round(dev, 1) > MAX_NOSING_DEV_MM:  # at 0.1 mm, so float noise never decides a flight sitting on the limit
        return None, f"nosing mismatch: a surveyed nosing is {dev:.1f} mm off the generated strip (uneven risers or riser rounding; strip is {MAX_NOSING_DEV_MM:g} mm high)", None
    width = median([math.hypot(r[2] - r[0], r[3] - r[1]) for r in flight["nosings"]]) * 1000.0
    params = {"step_count": n, "riser_mm": quant(riser), "tread_mm": quant(tread), "width_mm": quant(width)}
    err = {
        "riser_mm": round(abs(params["riser_mm"] - riser), 3),
        "tread_mm": round(abs(params["tread_mm"] - tread), 3),
        "width_mm": round(abs(params["width_mm"] - width), 3),
        # where the generated last nosing lands against the survey's, over the whole flight
        "top_height_mm": round(abs((params["riser_mm"] - riser) * (n - 1)), 3),
        "top_run_mm": round(abs((params["tread_mm"] - tread) * (n - 1)), 3),
    }
    mount, shares = "post", None
    if walls is not None:
        left, right = wall_share(flight, walls)
        shares = {"left": round(left, 3), "right": round(right, 3)}
        if left >= WALL_SIDE_SHARE and right >= WALL_SIDE_SHARE:
            mount = "wall"
    return params, err, {"rail_mount": mount, "wall_share": shares}


def plan_escalator(lane):
    rise, width = lane["rise_m"] * 1000.0, lane["width_m"] * 1000.0
    angle = round(math.degrees(math.atan2(lane["rise_m"], lane["run_m"])), 2)
    if not ESC_ANGLE_DEG[0] <= angle <= ESC_ANGLE_DEG[1]:
        return None, f"incline {angle} deg outside {ESC_ANGLE_DEG[0]:g}-{ESC_ANGLE_DEG[1]:g} deg"
    params = {"rise_mm": quant(rise), "width_mm": quant(width), "angle_deg": angle, "landing_mm": ESC_LANDING_MM}
    err = {"rise_mm": round(abs(params["rise_mm"] - rise), 3), "width_mm": round(abs(params["width_mm"] - width), 3)}
    return (params, angle, err), None


def tier_summary(placements, entries, route_flights, polylines, route_fallback):
    stairs = [p for p in placements if p["kind"] == "stair"]
    main = sorted(p["anchor"] for p in stairs if p["main_route"])
    rails_main = sorted({p["ids"]["rails"] for p in stairs if p["main_route"]})
    n_nosing = sum(1 for e in entries.values() if e["id"].endswith("_nosing"))
    n_rails = sum(1 for e in entries.values() if "_rails_" in e["id"])
    n_esc = sum(1 for e in entries.values() if e["generator"] == "escalator_dressing")
    nosing = round(TRIS_NOSING_MOBILE)
    esc = round(TRIS_ESCALATORS_MOBILE)
    rails = round(TRIS_RAILS_FULL_ALL * len(rails_main) / n_rails)
    return {
        "flights": main,
        "flight_count": len(main),
        "rails_ids": len(rails_main),
        "routes": {rid: {"stairs_edge": bool(polylines[rid][1]), "flights": route_flights[rid],
                                  "fallback_radius_m": ROUTE_FALLBACK_M if rid in route_fallback else None} for rid in sorted(route_flights)},
        "tiers": {
            "low": {"nosing_ids": n_nosing, "rails_ids": 0, "escalator_ids": 0},
            "high": {"nosing_ids": n_nosing, "rails_ids": len(rails_main), "escalator_ids": n_esc,
                     "rails_placements_dropped_vs_all": sum(1 for p in stairs if not p["main_route"])},
        },
        "triangle_estimate": {
            "basis": "Lane E (#143): mobile 20.3k escalators over 5 ids and 7.2k nosings over 61 ids; full 153k for all 61 "
                     "rails ids at rail_segments 6; per-id scaling is even, so rails are rough (they grow with step_count). "
                     "Unique GLB triangles, not instanced draw totals.",
            "low": {"nosing_mobile": nosing, "total": nosing},
            "high": {"nosing_mobile": nosing, "escalators_mobile": esc, "rails_full": rails,
                     "rails_full_if_all_61": TRIS_RAILS_FULL_ALL},
        },
    }


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--anchors", default=os.path.join(ROOT, "scene", "dressing_anchors.json"))
    ap.add_argument("--station", default=os.path.join(ROOT, "gteki", "station.json"))
    ap.add_argument("--graph", default=os.path.join(ROOT, "gteki", "graph.json"))
    ap.add_argument("--routes", default=os.path.join(os.path.dirname(os.path.dirname(ROOT)), ROUTES_REL))
    ap.add_argument("--glb", default=os.path.join(ROOT, "gteki", "assets", "ikebukuro_b1.glb"))
    ap.add_argument("--out-dir", default=os.path.join(ROOT, "scene"))
    args = ap.parse_args(argv)

    with open(args.anchors, encoding="utf8") as f:
        anchors = json.load(f)
    anchors_sha = sha256_file(args.anchors)
    with open(args.station, encoding="utf8") as f:
        station = json.load(f)
    pinned = next(s for s in station["sources"] if s["id"] == SOURCE_ID)["sha256"]
    gml, gml_sha = anchors["source"]["gml"], anchors["source"]["gml_sha256"]
    if pinned.get(gml) != gml_sha:
        sys.exit(f"build_kit_catalog: {gml} sha256 in {args.anchors} differs from {args.station}")

    with open(args.graph, encoding="utf8") as f:
        graph = json.load(f)
    with open(args.routes, encoding="utf8") as f:
        routes = json.load(f)
    polylines = route_polylines(routes, graph)
    samples = {rid: densify(pts) for rid, (pts, _) in polylines.items()}
    route_flights = {rid: sorted(fl["id"] for fl in anchors["stair_flights"] if flight_on_route(fl, samples[rid]))
                     for rid in samples}
    route_fallback = set()
    for rid, (_, stair_lines) in polylines.items():
        if stair_lines and not route_flights[rid]:  # the graph's stairs edge is coarse: widen around that edge only
            near = [pt for line in stair_lines for pt in densify(line)]
            route_flights[rid] = sorted(fl["id"] for fl in anchors["stair_flights"] if flight_on_route(fl, near, ROUTE_FALLBACK_M))
            route_fallback.add(rid)
    main_route_ids = {fid for ids in route_flights.values() for fid in ids}

    walls, glb_sha = None, None
    if os.path.exists(args.glb):
        glb_sha = sha256_file(args.glb)
        walls = WallIndex(read_wall_triangles(args.glb))
    wall_note = (f"rail_mount from the wall mesh of ikebukuro_b1.glb (sha256 {glb_sha}): 'wall' when a wall lies within "
                 f"{WALL_NEAR_M} m of both stair sides, else 'post'" if walls is not None else
                 "rail_mount 'post': no GLB to probe for walls")

    cite = f"dressing_anchors.json sha256 {anchors_sha}; PLATEAU ubld GML {gml} sha256 {gml_sha} (station.json source {SOURCE_ID})"

    stair_groups = {}   # nosing key -> flights
    placements, skipped = [], []
    quant_max = {k: (0.0, None) for k in ("riser_mm", "tread_mm", "width_mm", "top_height_mm", "top_run_mm")}
    for flight in anchors["stair_flights"]:
        params, err, extra = plan_stair(flight, walls)
        if params is None:
            skipped.append({"anchor": flight["id"], "kind": "stair", "reason": err})
            continue
        for k, v in err.items():
            if v > quant_max[k][0]:
                quant_max[k] = (v, flight["id"])
        key = (params["step_count"], params["riser_mm"], params["tread_mm"], params["width_mm"])
        stair_groups.setdefault(key, []).append((flight, params, err, extra))

    entries = {}
    rails_key_flights = {}
    for key in sorted(stair_groups):
        n, r, t, w = key
        base = f"{ID_PREFIX}stair_n{n}_r{r}_t{t}_w{w}"
        flights = sorted(f["id"] for f, *_ in stair_groups[key])
        nosing_id = f"{base}_nosing"
        entries[nosing_id] = {
            "id": nosing_id, "generator": "stair_dressing", "ao_res": AO_RES["stair_dressing"], "anchor": "linear_run",
            "params": {"step_count": n, "riser_mm": r, "tread_mm": t, "width_mm": w, "parts": ["nosing"]},
            "dimension_basis": "station-verified",
            "notes": (f"Nosing strips only (role stairs_ramps). Station-verified from the PLATEAU survey: {cite}. "
                      f"Flights: {', '.join(flights)} (step_count = surveyed nosing lines; riser = rise / (steps - 1); "
                      f"tread = mean nosing-to-nosing run; width = median nosing line; each snapped to {QUANT_MM} mm)."),
            "tags": ["dressing", "stair", "ikebukuro", "nosing"],
        }
        for flight, params, err, extra in stair_groups[key]:
            mount = extra["rail_mount"]
            rails_id = f"{base}_rails_{mount}"
            rails_key_flights.setdefault(rails_id, []).append(flight["id"])
            if rails_id not in entries:
                entries[rails_id] = {
                    "id": rails_id, "generator": "stair_dressing", "ao_res": AO_RES["stair_dressing"], "anchor": "linear_run",
                    "params": {"step_count": n, "riser_mm": r, "tread_mm": t, "width_mm": w, "parts": ["handrail"],
                               "handrail_sides": "both", "rail_mount": mount,
                               "rail_segments": RAIL_SEGMENTS},
                    "dimension_basis": "station-verified",
                    "notes": None, "tags": ["dressing", "stair", "ikebukuro", "rails"],
                }
            bottom = flight["bottom"]
            placements.append({
                "anchor": flight["id"], "kind": "stair", "scope": flight["scope"],
                "ids": {"nosing": nosing_id, "rails": rails_id},
                # floor under the first nosing: nosing z less one riser (the generator's nosing 0 is at z = riser)
                "origin": [bottom["position"][0], bottom["position"][1], round(bottom["position"][2] - r / 1000.0, 3)],
                "dir": bottom["dir"], "yaw_deg": yaw_deg(bottom["dir"]), "mirror": False,
                "main_route": flight["id"] in main_route_ids,
                "tiers": {"nosing": ["low", "high"], "rails": ["high"] if flight["id"] in main_route_ids else []},
                "rail_mount": mount, "wall_share": extra["wall_share"], "quantisation_mm": err,
            })
    for rails_id, flights in rails_key_flights.items():
        e = entries[rails_id]
        e["notes"] = (f"Handrails only (role barriers), both sides. Station-verified from the PLATEAU survey: {cite}. "
                      f"Flights: {', '.join(sorted(flights))}. Dimensions as the matching nosing entry. {wall_note}.")

    esc_groups = {}
    esc_angles = {}
    for lane in anchors["escalator_lanes"]:
        res, reason = plan_escalator(lane)
        if res is None:
            skipped.append({"anchor": lane["id"], "kind": "escalator", "reason": reason})
            continue
        params, angle, err = res
        key = (params["rise_mm"], params["width_mm"], angle)
        esc_groups.setdefault(key, []).append((lane, params, angle, err))
        esc_angles[key] = angle
    for key in sorted(esc_groups):
        rise, width, angle = key
        eid = f"{ID_PREFIX}escalator_w{width}_rise{rise}_a{int(round(angle * 100))}"
        lanes = sorted(l["id"] for l, *_ in esc_groups[key])
        entries[eid] = {
            "id": eid, "generator": "escalator_dressing", "ao_res": AO_RES["escalator_dressing"], "anchor": "linear_run",
            "params": {"rise_mm": rise, "width_mm": width, "angle_deg": angle, "landing_mm": ESC_LANDING_MM,
                       "treads": True, "parts": list(ESC_PARTS)},
            "dimension_basis": "station-verified",
            "notes": (f"Escalator balustrade, handrail, newels, comb plates and treads (role transport). Station-verified from the "
                      f"PLATEAU survey: {cite}. Lanes: {', '.join(lanes)} (rise and quad run between the surveyed landing "
                      f"lines; rise snapped to {QUANT_MM} mm). angle_deg = atan2(rise, quad run) = {angle}: the surveyed quad is the straight "
                      f"incline between the floors, so the kit's straight middle incline lies on the slab line; origin (bottom comb) is "
                      f"{ESC_COMB_OFFSET_M} m before the quad's lower line, comb to comb is quad run + {2 * ESC_COMB_OFFSET_M:g} m. "
                      f"Tread width read as the clear gap between surveyed truss plates; S600-class at 710 mm. landing_mm {ESC_LANDING_MM} "
                      f"is the generator default (not surveyed). Direction not surveyed and left out of the params; geometry is "
                      f"direction-agnostic."),
            "tags": ["dressing", "escalator", "ikebukuro"],
        }
        for lane, params, angle, err in esc_groups[key]:
            lower = lane["lower"]
            dx, dy = lower["dir"]
            origin = [round(lower["position"][0] - ESC_COMB_OFFSET_M * dx, 3) + 0.0,
                      round(lower["position"][1] - ESC_COMB_OFFSET_M * dy, 3) + 0.0, lower["position"][2]]
            placements.append({
                "anchor": lane["id"], "kind": "escalator", "scope": lane["scope"], "bank": lane["bank"],
                "ids": {"dressing": eid},
                "origin": origin, "dir": lower["dir"], "yaw_deg": yaw_deg(lower["dir"]), "mirror": False,
                "tiers": {"dressing": ["high"]},
                "incline_deg": angle, "quantisation_mm": err,
            })

    assets = [entries[k] for k in sorted(entries)]
    catalog = {
        "catalog": CATALOG_NAME, "version": CATALOG_VERSION,
        "notes": ("Ikebukuro stair and escalator dressing, parameterised from scene/dressing_anchors.json by "
                  "stations/ikebukuro/pipeline/build_kit_catalog.py (do not edit by hand). Every entry is station-verified and "
                  "cites its anchors and PLATEAU GML hashes. Stairs are split into a nosing GLB (one bake role) and a rails GLB. "
                  "Origins and yaw per anchor are in kit_placements.json. Contains PLATEAU data (MLIT), modified; terms per the PLATEAU Site Policy §3 (#161)."),
        "assets": assets,
    }
    placements.sort(key=lambda p: (p["kind"], p["anchor"]))
    skipped.sort(key=lambda s: (s["kind"], s["anchor"]))

    n_flights, n_lanes = len(anchors["stair_flights"]), len(anchors["escalator_lanes"])
    covered_flights = sum(1 for p in placements if p["kind"] == "stair")
    covered_lanes = sum(1 for p in placements if p["kind"] == "escalator")
    summary = {
        "unique_ids": len(assets),
        "stair_nosing_ids": sum(1 for a in assets if a["id"].endswith("_nosing")),
        "stair_rails_ids": sum(1 for a in assets if "_rails_" in a["id"]),
        "escalator_ids": sum(1 for a in assets if a["generator"] == "escalator_dressing"),
        "stair_flights": {"total": n_flights, "covered": covered_flights, "skipped": n_flights - covered_flights},
        "escalator_lanes": {"total": n_lanes, "covered": covered_lanes, "skipped": n_lanes - covered_lanes},
        "rail_mount": {m: sum(1 for p in placements if p.get("rail_mount") == m) for m in ("post", "wall")},
        "quantisation_max": {k: {"mm": v, "anchor": a} for k, (v, a) in quant_max.items()},
        "escalator_incline_deg": {eid: ang for eid, ang in sorted((e["id"], esc_angles_for(e, esc_angles)) for e in assets if e["generator"] == "escalator_dressing")},
        "main_route": tier_summary(placements, entries, route_flights, polylines, route_fallback),
        "skipped": skipped,
    }
    out = {
        "schema": PLACEMENTS_SCHEMA,
        "catalog": {"file": "kit_catalog.json", "name": CATALOG_NAME, "version": CATALOG_VERSION},
        "source": {"dressing_anchors_sha256": anchors_sha, "gml": gml, "gml_sha256": gml_sha,
                   "wall_probe_glb_sha256": glb_sha,
                   "golden_routes_sha256": sha256_file(args.routes), "graph_sha256": sha256_file(args.graph)},
        "frame": {"axes": "ENU metres: x east, y north, z TP height (as dressing_anchors.json)",
                  "origin": "stair: floor under the first nosing line (centre of the line, nosing z less one riser); "
                            f"escalator: bottom comb line, {ESC_COMB_OFFSET_M} m before the centre of the surveyed lower line along dir, "
                            "at the lower floor height",
                  "dir": "horizontal unit vector (east, north) up the flight or escalator",
                  "yaw_deg": "counter-clockwise rotation about +Z taking the piece's local +Y (travel) to dir",
                  "mirror": "false everywhere: rails are on both sides, escalators are symmetric"},
        "summary": summary,
        "placements": placements,
    }
    os.makedirs(args.out_dir, exist_ok=True)
    for name, doc in (("kit_catalog.json", catalog), ("kit_placements.json", out)):
        with open(os.path.join(args.out_dir, name), "w", encoding="utf8", newline="\n") as f:
            json.dump(doc, f, indent=1, ensure_ascii=False)
            f.write("\n")

    print(f"kit catalog: {len(assets)} unique ids ({summary['stair_nosing_ids']} nosing, {summary['stair_rails_ids']} rails, "
          f"{summary['escalator_ids']} escalator)")
    print(f"  flights {covered_flights}/{n_flights} covered, lanes {covered_lanes}/{n_lanes} covered, rail_mount {summary['rail_mount']}")
    for s in skipped:
        print(f"  skipped {s['anchor']}: {s['reason']}")
    for k, v in quant_max.items():
        print(f"  max quantisation error {k}: {v[0]} ({v[1]})")


def esc_angles_for(entry, esc_angles):
    p = entry["params"]
    return esc_angles[(p["rise_mm"], p["width_mm"], p["angle_deg"])]


if __name__ == "__main__":
    main()
