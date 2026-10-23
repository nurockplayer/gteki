"""Column footprints from the PLATEAU survey, for the Lane E kit column sleeves (#94 Part A, batch 2).

    python3 -I stations/ikebukuro/pipeline/extract_columns.py [ubld_enu.json [columns.json]] [--station gteki/station.json]

Reads build/ubld_enu.json (the ENU extract of the ubld GML, git-ignored) and writes scene/columns.json.
Facts only: every column is a closed or open vertical prism found in the surveyed EF_25 ("barriers")
triangles; nothing is invented, and nothing here changes the GLB, the bake or the graph.

Why geometry. The PLATEAU data carries no per-column object and no column class: the 10,992 EF_25 triangles
are one soup of stair side walls, parapets and columns, each triangle with its own polygon id. So columns are
found by shape:

 1. Triangles of the EF_25 installations are welded by vertex (1 mm grid) into connected components.
 2. A component is a vertical prism when every vertex lies on its lowest or its highest level (2 mm), the
    set of (x, y) points is the same at both levels, and the vertical triangles add up to the hull
    perimeter x height (so no side is missing and the footprint is convex). Sloped stair walls fail the
    first test, long parapets fail the size test, L-shaped pieces fail the area test.
 3. A prism is listed as a column when its height is >= MIN_H_M, its footprint fits within LIST_MAX_DIAM_M
    and, for rectangles and circles, its smaller extent is >= MIN_SIDE_M (thinner pieces are wall stubs).
 4. The footprint is fitted: 4 corners at right angles with equal opposite sides is `square` (sides within
    3 cm or 3 %) or `rect`; >= 8 hull corners within 4 % of one radius is `round`; anything else is
    `polygon`.
 5. `kit` names the library piece that can be scaled onto it (a square or round 0.4 to 1.0 m footprint,
    at least 1.96 m tall, rectangles up to 1:1.6), else null with a `reason`. The column stays listed.

Components that are not prisms are not listed (counted in `rejected`). A column that touches a wall at a
shared vertex is welded into the wall's component and is not found; the count of such cases is unknown.

Output frame: ENU metres (x east, y north, z TP height), rounded to 1 mm. `rotation_deg` is the angle of
the footprint's `width` axis counter-clockwise from +X seen from above. `level` is the base-height band
(bases closer than 0.5 m share a band, numbered upward from L0); it is not a surveyed floor name.
Deterministic: same input, same bytes.
"""
import hashlib
import json
import math
import os
import re
import sys
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SCHEMA = "gteki.ikebukuro.columns/0"
EXTRACT_SCHEMA = "gteki.plateau-ubld-extract/0"
SOURCE_FUNCTION = "EF_25"

MM = 1000.0
Z_TOL_MM = 2              # a vertex belongs to the bottom or top level within this
MIN_H_M = 1.5             # shorter prisms are not columns
LIST_MAX_DIAM_M = 3.0     # larger footprints (hull diameter) are not columns
MIN_SIDE_M = 0.15         # thinner rectangles / circles are wall stubs
SIDE_AREA_TOL = 0.02      # vertical area vs perimeter x height
CAP_AREA_TOL = 0.02       # a cap is "closed" when its triangles cover the footprint within this
RECT_SIDE_TOL_M = 0.02    # opposite sides of a rectangle agree within this
RECT_ANGLE_TOL = 0.03     # |cos| of the corner angle
SQUARE_TOL = (0.03, 0.03)  # (absolute m, relative): sides this close are a square
ROUND_MIN_SIDES = 8
ROUND_RADIUS_TOL = 0.04   # (rmax - rmin) / rmean
LEVEL_GAP_M = 0.5

# Library pieces (assets/library/manifest.json: bounds +-0.305 x 0..2.8 m) and the range they are scaled over.
SQUARE_PIECE = "gteki_column_square_600"
ROUND_PIECE = "gteki_column_round_d600"
PIECE_HEIGHT_M = 2.8
KIT_FOOT_MIN_M = 0.40
KIT_FOOT_MAX_M = 1.00
KIT_MAX_ASPECT = 1.6
KIT_MIN_H_M = 0.7 * PIECE_HEIGHT_M


# ---- geometry (integer millimetres until the end) -----------------------------------------------------------

def read_triangles(installations):
    """[(installation id, polygon id, ((x, y, z) mm) x 3)] for every EF_25 polygon, fan-triangulated."""
    out, skipped = [], 0
    for inst in installations:
        if inst["function"] != SOURCE_FUNCTION:
            continue
        for p in inst["polygons"]:
            pts = [tuple(int(round(c * MM)) for c in v) for v in p["outer"]]
            if len(pts) < 3 or p.get("holes"):
                skipped += 1
                continue
            for k in range(1, len(pts) - 1):
                out.append((inst["id"], p["id"], (pts[0], pts[k], pts[k + 1])))
    return out, skipped


def components(tris):
    """Triangle index lists, one per connected component (triangles sharing a vertex), in first-triangle order."""
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for _i, _p, t in tris:
        for v in t:
            parent.setdefault(v, v)
        for v in t[1:]:
            ra, rb = find(t[0]), find(v)
            if ra != rb:
                parent[max(ra, rb)] = min(ra, rb)
    groups = defaultdict(list)
    for idx, (_i, _p, t) in enumerate(tris):
        groups[find(t[0])].append(idx)
    return sorted(groups.values(), key=lambda g: g[0])


def cross2(o, a, b):
    return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])


def convex_hull(points):
    """Counter-clockwise hull without collinear points."""
    pts = sorted(set(points))
    if len(pts) < 3:
        return pts
    lo, up = [], []
    for p in pts:
        while len(lo) >= 2 and cross2(lo[-2], lo[-1], p) <= 0:
            lo.pop()
        lo.append(p)
    for p in reversed(pts):
        while len(up) >= 2 and cross2(up[-2], up[-1], p) <= 0:
            up.pop()
        up.append(p)
    return lo[:-1] + up[:-1]


def poly_area(pts):
    return abs(sum(pts[i][0] * pts[(i + 1) % len(pts)][1] - pts[(i + 1) % len(pts)][0] * pts[i][1] for i in range(len(pts)))) / 2


def tri_area3(t):
    a, b, c = t
    u = (b[0] - a[0], b[1] - a[1], b[2] - a[2])
    v = (c[0] - a[0], c[1] - a[1], c[2] - a[2])
    cx, cy, cz = u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]
    return math.sqrt(cx * cx + cy * cy + cz * cz) / 2


def prism(tri_list):
    """Return (info, None) for a vertical prism, or (None, reason). `info` has hull (mm), z0, z1 (mm), closed."""
    verts = {v for t in tri_list for v in t}
    z0 = min(v[2] for v in verts)
    z1 = max(v[2] for v in verts)
    if (z1 - z0) / MM < MIN_H_M:
        return None, "short"
    bottom, top = set(), set()
    for x, y, z in verts:
        if abs(z - z0) <= Z_TOL_MM:
            bottom.add((x, y))
        elif abs(z - z1) <= Z_TOL_MM:
            top.add((x, y))
        else:
            return None, "not_prism"
    if bottom != top or len(bottom) < 3:
        return None, "not_prism"
    hull = convex_hull(list(bottom))
    if len(hull) < 3:
        return None, "not_prism"
    per = sum(math.dist(hull[i], hull[(i + 1) % len(hull)]) for i in range(len(hull)))
    height = z1 - z0
    side = cap0 = cap1 = 0.0
    for t in tri_list:
        flat = cross2(t[0][:2], t[1][:2], t[2][:2]) == 0  # xy-projection is a segment: a vertical triangle
        if flat:
            side += tri_area3(t)
        elif all(abs(v[2] - z0) <= Z_TOL_MM for v in t):
            cap0 += tri_area3(t)
        elif all(abs(v[2] - z1) <= Z_TOL_MM for v in t):
            cap1 += tri_area3(t)
        else:
            return None, "not_prism"
    want = per * height
    if abs(side - want) > SIDE_AREA_TOL * want + 1e5:  # + 0.1 m2 of rounding slack at 1 mm resolution
        return None, "not_prism"
    foot = poly_area(hull)
    closed = abs(cap0 - foot) <= CAP_AREA_TOL * foot and abs(cap1 - foot) <= CAP_AREA_TOL * foot
    return {"hull": hull, "z0": z0, "z1": z1, "closed": closed}, None


def fit_footprint(hull_mm):
    """{shape, centre, width, depth, diameter?, rotation_deg, sides} from the hull (metres out)."""
    h = [(x / MM, y / MM) for x, y in hull_mm]
    n = len(h)
    area = poly_area(h)
    # area centroid
    a2 = sum(h[i][0] * h[(i + 1) % n][1] - h[(i + 1) % n][0] * h[i][1] for i in range(n))
    cx = sum((h[i][0] + h[(i + 1) % n][0]) * (h[i][0] * h[(i + 1) % n][1] - h[(i + 1) % n][0] * h[i][1]) for i in range(n)) / (3 * a2)
    cy = sum((h[i][1] + h[(i + 1) % n][1]) * (h[i][0] * h[(i + 1) % n][1] - h[(i + 1) % n][0] * h[i][1]) for i in range(n)) / (3 * a2)
    if n == 4:
        e = [(h[(i + 1) % 4][0] - h[i][0], h[(i + 1) % 4][1] - h[i][1]) for i in range(4)]
        ln = [math.hypot(*v) for v in e]
        right = all(abs(e[i][0] * e[(i + 1) % 4][0] + e[i][1] * e[(i + 1) % 4][1]) <= RECT_ANGLE_TOL * ln[i] * ln[(i + 1) % 4] for i in range(4))
        if right and abs(ln[0] - ln[2]) <= RECT_SIDE_TOL_M and abs(ln[1] - ln[3]) <= RECT_SIDE_TOL_M:
            a, b = (ln[0] + ln[2]) / 2, (ln[1] + ln[3]) / 2
            long_i = 0 if a >= b else 1
            ang = math.degrees(math.atan2(e[long_i][1], e[long_i][0]))
            if abs(a - b) <= max(SQUARE_TOL[0], SQUARE_TOL[1] * max(a, b)):
                s = (a + b) / 2
                return {"shape": "square", "centre": (cx, cy), "width": s, "depth": s, "rotation_deg": ang % 90.0, "sides": 4}
            return {"shape": "rect", "centre": (cx, cy), "width": max(a, b), "depth": min(a, b), "rotation_deg": ang % 180.0, "sides": 4}
    if n >= ROUND_MIN_SIDES:
        r = [math.hypot(x - cx, y - cy) for x, y in h]
        mean = sum(r) / n
        if (max(r) - min(r)) <= ROUND_RADIUS_TOL * mean:
            return {"shape": "round", "centre": (cx, cy), "width": 2 * mean, "depth": 2 * mean, "diameter": 2 * mean, "rotation_deg": 0.0, "sides": n}
    xs, ys = [p[0] for p in h], [p[1] for p in h]
    return {"shape": "polygon", "centre": ((min(xs) + max(xs)) / 2, (min(ys) + max(ys)) / 2), "width": max(xs) - min(xs),
            "depth": max(ys) - min(ys), "rotation_deg": 0.0, "sides": n, "area": area}


def assign_kit(shape, width, depth, height):
    """(piece id or None, reason or None) for a fitted footprint."""
    if shape == "polygon":
        return None, "irregular footprint, not a square, rectangle or circle"
    lo, hi = min(width, depth), max(width, depth)
    if lo < KIT_FOOT_MIN_M or hi > KIT_FOOT_MAX_M:
        return None, f"footprint {lo:.2f} x {hi:.2f} m is outside the scalable {KIT_FOOT_MIN_M:.2f} to {KIT_FOOT_MAX_M:.2f} m range"
    if hi / lo > KIT_MAX_ASPECT:
        return None, f"rectangle {lo:.2f} x {hi:.2f} m is beyond 1:{KIT_MAX_ASPECT} (the square piece would distort)"
    if height < KIT_MIN_H_M:
        return None, f"height {height:.2f} m is under {KIT_MIN_H_M:.2f} m (the piece would be squashed)"
    return (ROUND_PIECE if shape == "round" else SQUARE_PIECE), None


# ---- driver -----------------------------------------------------------------------------------------------

def find_columns(data):
    tris, skipped = read_triangles(data["installations"])
    comps = components(tris)
    rejected = Counter()
    found = []
    for comp in comps:
        tl = [tris[i][2] for i in comp]
        info, why = prism(tl)
        if info is None:
            rejected[why] += 1
            continue
        hull = info["hull"]
        diam = max(math.dist(a, b) for a in hull for b in hull) / MM
        if diam > LIST_MAX_DIAM_M:
            rejected["large"] += 1
            continue
        fp = fit_footprint(hull)
        if fp["shape"] in ("rect", "square", "round") and min(fp["width"], fp["depth"]) < MIN_SIDE_M:
            rejected["thin"] += 1
            continue
        height = (info["z1"] - info["z0"]) / MM
        piece, reason = assign_kit(fp["shape"], fp["width"], fp["depth"], height)
        found.append({
            "fp": fp, "base": info["z0"] / MM, "top": info["z1"] / MM, "height": height, "closed": info["closed"], "piece": piece, "reason": reason,
            "installations": sorted({tris[i][0] for i in comp}), "polygons": [tris[i][1] for i in comp],
        })
    return found, {"triangles": len(tris), "components": len(comps), "skipped_polygons": skipped, "rejected": dict(sorted(rejected.items()))}


def level_bands(bases):
    """Base heights (m) -> list of (lo, hi) bands, ascending; bases less than LEVEL_GAP_M apart share a band."""
    bands = []
    for b in sorted(set(bases)):
        if bands and b - bands[-1][1] < LEVEL_GAP_M:
            bands[-1][1] = b
        else:
            bands.append([b, b])
    return [(lo, hi) for lo, hi in bands]


def r3(v):
    return round(v + 0.0, 3)


def build(data, input_sha256):
    if data.get("schema") != EXTRACT_SCHEMA:
        raise ValueError(f"unsupported extract schema {data.get('schema')!r}")
    found, stats = find_columns(data)
    bands = level_bands([c["base"] for c in found])

    def level_of(base):
        return next(i for i, (lo, hi) in enumerate(bands) if lo - 1e-9 <= base <= hi + 1e-9)

    found.sort(key=lambda c: (level_of(c["base"]), r3(c["fp"]["centre"][0]), r3(c["fp"]["centre"][1])))
    columns = []
    for i, c in enumerate(found):
        fp = c["fp"]
        col = {
            "id": f"col_{i + 1:03d}",
            "source": {"installations": c["installations"], "polygons": c["polygons"]},
            "centre": [r3(fp["centre"][0]), r3(fp["centre"][1])],
            "shape": fp["shape"],
            "width": r3(fp["width"]),
            "depth": r3(fp["depth"]),
        }
        if fp["shape"] == "round":
            col["diameter"] = r3(fp["diameter"])
        if fp["shape"] == "polygon":
            col["sides"] = fp["sides"]
        ang = round(fp["rotation_deg"] + 0.0, 2)
        if ang >= {"square": 90.0, "rect": 180.0}.get(fp["shape"], 360.0):  # 89.996 rounds up to the period: same angle
            ang = 0.0
        col.update({
            "rotation_deg": ang,
            "base_z": r3(c["base"]), "top_z": r3(c["top"]), "height": r3(c["height"]),
            "level": f"L{level_of(c['base'])}",
            "closed": c["closed"],
            "kit": c["piece"],
        })
        if c["reason"]:
            col["reason"] = c["reason"]
        columns.append(col)
    kit = Counter(c["kit"] or "null" for c in columns)
    shapes = Counter(c["shape"] for c in columns)
    return {
        "schema": SCHEMA,
        "source": {
            "id": "plateau-ubld-13116",
            "extract": "build/ubld_enu.json (pipeline/extract_plateau_ubld.py)",
            "extract_sha256": input_sha256,
            "gml": data["source"]["file"],
            "gml_sha256": data["source"]["sha256"],
            "license": "CC BY 4.0 (PLATEAU / MLIT); modified: column footprints derived from survey triangles by GTEki",
            "attribution": "Contains PLATEAU data (MLIT), CC BY 4.0. Modified: reprojected to a local ENU frame; column footprints fitted by GTEki.",
        },
        "provenance": {
            "script": "stations/ikebukuro/pipeline/extract_columns.py",
            "input": f"installations with function {SOURCE_FUNCTION} (barriers), all scopes",
            "rule": "welded connected components that are vertical prisms (every vertex on the lowest or highest level, same xy set at both, "
                    "vertical triangle area = hull perimeter x height), listed when >= %.1f m tall, hull diameter <= %.1f m and, for "
                    "rectangles and circles, smaller side >= %.2f m. No per-column object or class exists in the data, so this is geometry, "
                    "not a PLATEAU classification." % (MIN_H_M, LIST_MAX_DIAM_M, MIN_SIDE_M),
            "kit_rule": "square or round, %.2f to %.2f m, rectangles up to 1:%.1f, height >= %.2f m; sleeve scaled from the 0.61 m x %.1f m piece"
                        % (KIT_FOOT_MIN_M, KIT_FOOT_MAX_M, KIT_MAX_ASPECT, KIT_MIN_H_M, PIECE_HEIGHT_M),
            "tolerances": {"z_mm": Z_TOL_MM, "side_area": SIDE_AREA_TOL, "cap_area": CAP_AREA_TOL, "rect_side_m": RECT_SIDE_TOL_M,
                           "rect_angle_cos": RECT_ANGLE_TOL, "round_radius": ROUND_RADIUS_TOL, "round_min_sides": ROUND_MIN_SIDES},
            "finish": "The kit column's finish is generic Lane E art (tile or enamel body), not a survey of the Ikebukuro columns.",
        },
        "frame": {"axes": "ENU metres: x east, y north, z TP height", "origin": data["frame"]["origin"], "rounding_m": 0.001,
                  "rotation_deg": "counter-clockwise from +X seen from above, of the `width` axis (square: 0 to 90, rect: 0 to 180, round: 0)"},
        "levels": [{"id": f"L{i}", "base_z_min": r3(lo), "base_z_max": r3(hi), "columns": sum(1 for c in columns if c["level"] == f"L{i}")}
                   for i, (lo, hi) in enumerate(bands)],
        "counts": {
            "triangles_read": stats["triangles"], "components": stats["components"], "skipped_polygons": stats["skipped_polygons"],
            "rejected": stats["rejected"],
            "columns": len(columns),
            "by_shape": dict(sorted(shapes.items())),
            "kit_square": kit.get(SQUARE_PIECE, 0), "kit_round": kit.get(ROUND_PIECE, 0), "kit_null": kit.get("null", 0),
            "open_prisms": sum(1 for c in columns if not c["closed"]),
        },
        "columns": columns,
    }


def dumps(obj):
    """Indented JSON with every all-number and all-string array (positions, ids) on one line."""
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s*(-?\d[^\[\]{}\"]*?)\s*\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]", text)
    # arrays of strings (installation and polygon ids) too
    text = re.sub(r"\[\s*(\"[^\"\[\]]*\"(?:\s*,\s*\"[^\"\[\]]*\")*)\s*\]", lambda m: "[" + re.sub(r"\s*,\s*", ", ", m.group(1)) + "]", text)
    return text + "\n"


def check_station(data, station_path):
    """The extract must come from the GML that station.json cites."""
    with open(station_path, encoding="utf-8") as f:
        station = json.load(f)
    pinned = {name: h for s in station.get("sources", []) for name, h in (s.get("sha256") or {}).items()}
    want = pinned.get(data["source"]["file"])
    if want != data["source"]["sha256"]:
        raise SystemExit(f"extract source sha256 {data['source']['sha256']} does not match station.json ({want})")


def main(argv):
    args, station = [], os.path.join(ROOT, "gteki", "station.json")
    it = iter(argv)
    for a in it:
        if a == "--station":
            station = next(it)
        else:
            args.append(a)
    src = args[0] if args else os.path.join(ROOT, "build", "ubld_enu.json")
    dst = args[1] if len(args) > 1 else os.path.join(ROOT, "scene", "columns.json")
    with open(src, "rb") as f:
        raw = f.read()
    data = json.loads(raw)
    check_station(data, station)
    result = build(data, hashlib.sha256(raw).hexdigest())
    tmp = dst + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(dumps(result))
    os.replace(tmp, dst)
    print(json.dumps(result["counts"]))


if __name__ == "__main__":
    main(sys.argv[1:])
