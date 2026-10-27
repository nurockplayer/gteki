"""Shop openings from the PLATEAU survey, for the shopfront kit (#209).

    python3 -I stations/ikebukuro/pipeline/extract_shop_openings.py [ubld_enu.json [shop_openings.json]] \
        [--station gteki/station.json] [--graph gteki/graph.json]

Reads build/ubld_enu.json (the ENU extract of the ubld GML, git-ignored) and writes scene/shop_openings.json.
Facts only: every door and window panel is the surveyed bldg:Room opening triangle, listed as geometry; nothing
is invented, no kit piece is placed, and nothing here changes the GLB, the graph or the scene.

Why geometry. PLATEAU carries door and window openings as panels of triangles on a Room (bldg:opening with a
type, a host wall and its polygons), not as a placed object: one opening is several triangles, spanning one
panel or a band of them. The walk graph is a separate file (the station's bldg-level graph), so "which side of
the wall does this shopfront face" can be compared with the graph geometry.

 1. Triangles are welded by shared vertex (1 mm grid), opening type and 10-degree winding-normal heading bucket.
 2. Per component: `type`, `opening_id`, `polygon_ids`, `base_z`, `height`, `width` (largest horizontal
    vertex extent), `centre` (midpoint of that extent at base z), `normal_deg` (area-weighted horizontal
    winding normal, counter-clockwise from +X), `nearest_edge`, `edge_distance_m` and `faces_walk` (whether
    the winding normal points toward the nearest edge). The edge fields and `faces_walk` are null when no
    edge is within 1.0 m in z of the base.
 3. Rows are sorted by (type, centre x, centre y).

Top level: `schema`, `source` (gml file + sha256, as columns.json does), `frame`, `counts` (components per
type, triangles) and `openings`. Output frame: ENU metres (x east, y north, z TP height), rounded to 1 mm;
`normal_deg` is in [0, 360). Deterministic: same input, same bytes.
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

SCHEMA = "gteki.ikebukuro.shop-openings/0"
EXTRACT_SCHEMA = "gteki.plateau-ubld-extract/0"

MM = 1000.0
EDGE_Z_M = 1.0  # an edge only counts when its height at the closest point is this near the opening's base


# ---- geometry -----------------------------------------------------------------------------------------------

def read_triangles(rooms):
    """[(type, opening id, polygon id, ((x, y, z) mm) x 3)] for every opening polygon, fan-triangulated."""
    out, skipped = [], 0
    for room in rooms:
        for op in room.get("openings") or []:
            for p in op["polygons"]:
                pts = [tuple(int(round(c * MM)) for c in v) for v in p["outer"]]
                if len(pts) < 3 or p.get("holes"):
                    skipped += 1
                    continue
                for k in range(1, len(pts) - 1):
                    out.append((op["type"], op["id"], p["id"], (pts[0], pts[k], pts[k + 1])))
    return out, skipped


def winding_normal(t):
    a, b, c = t
    u = [(b[i] - a[i]) / MM for i in range(3)]
    v = [(c[i] - a[i]) / MM for i in range(3)]
    return (u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2])


def components(tris):
    """Triangle components by type, shared vertex and winding-normal heading bucket."""
    parent = {}

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for idx, (typ, _o, _p, t) in enumerate(tris):
        parent[idx] = idx
        n = winding_normal(t)
        bucket = round(degrees(n) / 10) % 36 if math.hypot(*n) >= 1e-9 else -1
        for v in t:
            key = (typ, v, bucket)
            if key in parent:
                ra, rb = find(idx), find(parent[key])
                if ra != rb:
                    parent[max(ra, rb)] = min(ra, rb)
            else:
                parent[key] = idx
    groups = defaultdict(list)
    for idx in range(len(tris)):
        groups[find(idx)].append(idx)
    return sorted(groups.values(), key=lambda g: g[0])


def extent(points):
    """(a, b) pair of distinct (x, y) mm points with the largest distance; lexicographic lowest on a tie."""
    pts = sorted(set(points))
    best, best_d2 = None, -1
    for i in range(len(pts)):
        for j in range(i + 1, len(pts)):
            dx, dy = pts[j][0] - pts[i][0], pts[j][1] - pts[i][1]
            d2 = dx * dx + dy * dy
            if d2 > best_d2:
                best, best_d2 = (pts[i], pts[j]), d2
    return best


def polyline_distance(cx, cy, pts):
    """(2D distance from (cx, cy) to the polyline, z at the closest point, closest x, closest y)."""
    best = None
    for (ax, ay, az), (bx, by, bz) in zip(pts, pts[1:]):
        dx, dy = bx - ax, by - ay
        ln = dx * dx + dy * dy
        t = 0.0 if ln == 0 else max(0.0, min(1.0, ((cx - ax) * dx + (cy - ay) * dy) / ln))
        px, py = ax + t * dx, ay + t * dy
        d = math.hypot(cx - px, cy - py)
        if best is None or d < best[0]:
            best = (d, az + t * (bz - az), px, py)
    return best


def nearest_edge(cx, cy, base_z, edges):
    """(edge id, 2D distance, closest x, closest y) of the closest edge whose z near (cx, cy) is within EDGE_Z_M
    of base_z, ties by id; None when no edge is that close."""
    best = None
    for eid, pts in edges:
        d, z, px, py = polyline_distance(cx, cy, pts)
        if abs(z - base_z) > EDGE_Z_M:
            continue
        if best is None or (d, eid) < (best[0], best[1]):
            best = (d, eid, px, py)
    return None if best is None else (best[1], best[0], best[2], best[3])


def degrees(n):
    return math.degrees(math.atan2(n[1], n[0])) % 360.0


# ---- driver ------------------------------------------------------------------------------------------------

def find_openings(rooms, edges):
    tris, skipped = read_triangles(rooms)
    comps = components(tris)
    found = []
    for comp in comps:
        verts = {v for i in comp for v in tris[i][3]}
        base = min(v[2] for v in verts)
        top = max(v[2] for v in verts)
        xy = sorted({(x, y) for x, y, _z in verts})
        pair = extent(xy)
        a, b = pair if pair else (xy[0], xy[0])  # one point only: no extent, no wall direction
        cx, cy = (a[0] + b[0]) / 2 / MM, (a[1] + b[1]) / 2 / MM
        edge = nearest_edge(cx, cy, base / MM, edges)
        normals = [winding_normal(tris[i][3]) for i in comp]
        nx, ny = sum(n[0] for n in normals), sum(n[1] for n in normals)
        normal = degrees((nx, ny)) if math.hypot(nx, ny) >= 1e-9 else None
        faces_walk = None if edge is None else nx * (edge[2] - cx) + ny * (edge[3] - cy) > 0
        found.append({
            "type": tris[comp[0]][0],
            "opening_ids": sorted({tris[i][1] for i in comp}),
            "polygon_ids": sorted({tris[i][2] for i in comp}),
            "base": base / MM, "top": top / MM,
            "width": (math.hypot(b[0] - a[0], b[1] - a[1]) / MM) if pair else 0.0,
            "centre": (cx, cy),
            "normal": normal,
            "faces_walk": faces_walk,
            "edge": None if edge is None else edge[0],
            "edge_d": None if edge is None else edge[1],
        })
    return found, {"triangles": len(tris), "skipped_polygons": skipped, "components": len(comps)}


def r3(v):
    return round(v + 0.0, 3)


def build(data, input_sha256, graph):
    if data.get("schema") != EXTRACT_SCHEMA:
        raise ValueError(f"unsupported extract schema {data.get('schema')!r}")
    edges = [(e["id"], [(p["x"], p["y"], p["z"]) for p in e["geometry"]]) for e in graph["edges"]]
    found, stats = find_openings(data["rooms"], edges)
    found.sort(key=lambda o: (o["type"], r3(o["centre"][0]), r3(o["centre"][1])))
    openings = []
    for o in found:
        openings.append({
            "type": o["type"],
            "opening_id": o["opening_ids"][0] if len(o["opening_ids"]) == 1 else o["opening_ids"],
            "polygon_ids": o["polygon_ids"],
            "base_z": r3(o["base"]),
            "height": r3(o["top"] - o["base"]),
            "width": r3(o["width"]),
            "centre": [r3(o["centre"][0]), r3(o["centre"][1]), r3(o["base"])],
            "normal_deg": None if o["normal"] is None else normal_round(o["normal"]),
            "faces_walk": o["faces_walk"],
            "nearest_edge": o["edge"],
            "edge_distance_m": None if o["edge_d"] is None else r3(o["edge_d"]),
        })
    by_type = Counter(o["type"] for o in openings)
    return {
        "schema": SCHEMA,
        "source": {
            "id": "plateau-ubld-13116",
            "extract": "build/ubld_enu.json (pipeline/extract_plateau_ubld.py)",
            "extract_sha256": input_sha256,
            "gml": data["source"]["file"],
            "gml_sha256": data["source"]["sha256"],
            "license": "CC BY 4.0 (PLATEAU / MLIT); modified: opening panels welded into components by GTEki",
            "attribution": "Contains PLATEAU data (MLIT), CC BY 4.0. Modified: reprojected to a local ENU frame; "
                           "door and window panels welded and measured by GTEki.",
        },
        "frame": {"axes": "ENU metres: x east, y north, z TP height", "origin": data["frame"]["origin"], "rounding_m": 0.001,
                  "normal_deg": "counter-clockwise from +X seen from above, in [0, 360), of the area-weighted "
                                "horizontal winding normal"},
        "counts": {"triangles": stats["triangles"], "skipped_polygons": stats["skipped_polygons"],
                   "components": dict(sorted(by_type.items())),
                   "total": len(openings)},
        "openings": openings,
    }


def normal_round(deg):
    ang = round(deg + 0.0, 2)
    return 0.0 if ang >= 360.0 else ang


def dumps(obj):
    """Indented JSON with every all-number and all-string array (positions, ids) on one line."""
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    text = re.sub(r"\[\s*(-?\d[^\[\]{}\"]*?)\s*\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]", text)
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
    args, station, graph_path = [], os.path.join(ROOT, "gteki", "station.json"), os.path.join(ROOT, "gteki", "graph.json")
    it = iter(argv)
    for a in it:
        if a == "--station":
            station = next(it)
        elif a == "--graph":
            graph_path = next(it)
        else:
            args.append(a)
    src = args[0] if args else os.path.join(ROOT, "build", "ubld_enu.json")
    dst = args[1] if len(args) > 1 else os.path.join(ROOT, "scene", "shop_openings.json")
    with open(src, "rb") as f:
        raw = f.read()
    data = json.loads(raw)
    check_station(data, station)
    with open(graph_path, encoding="utf-8") as f:
        graph = json.load(f)
    result = build(data, hashlib.sha256(raw).hexdigest(), graph)
    tmp = dst + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        f.write(dumps(result))
    os.replace(tmp, dst)
    print(json.dumps(result["counts"]))


if __name__ == "__main__":
    main(sys.argv[1:])
