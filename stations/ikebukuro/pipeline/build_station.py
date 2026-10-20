"""Build stations/ikebukuro/gteki/{station,graph,pois}.json (gteki.station/0.1) from the
hand-authored graph source plus PLATEAU geometry checks.

    python3 -I stations/ikebukuro/pipeline/build_station.py [--report out.json]

Every edge is sampled every 0.5 m. A sample passes when a PLATEAU walking
surface (FloorSurface or EF_35 stair/ramp tread) exists within tolerance of
the height interpolated along the edge, and the segment does not cross a wall
or barrier face between 0.4 m and 1.8 m above the walking height. Any failure
exits non-zero: nothing unproven is emitted as `verified`.
"""
import datetime
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from floorquery import Surfaces  # noqa: E402
from gridnav import RES, Grid  # noqa: E402

ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data", "graph.src.json")
ENU = os.path.join(ROOT, "build", "ubld_enu.json")
OUT_DIR = os.path.join(ROOT, "gteki")
STEP = 0.5
WALK_TOL = 0.35   # m between interpolated and surveyed height on walk edges
STAIR_TOL = 0.9   # stairs/escalators: treads are discrete


WALL_PIECE = 0.5  # m


def write_json(path, obj, indent=None):
    """Write via a temp file and rename, so a watching dev server never reads a half-written file."""
    tmp = path + ".tmp"
    with open(tmp, "w") as f:
        json.dump(obj, f, ensure_ascii=False, indent=indent)
    os.replace(tmp, path)


def _z_at(tz, t):
    """Heights where a vertical polygon, given as (t along footprint, z) vertices, meets the line t."""
    out = []
    for (ta, za), (tb, zb) in zip(tz, tz[1:] + tz[:1]):
        if min(ta, tb) - 1e-6 <= t <= max(ta, tb) + 1e-6:
            if abs(tb - ta) < 1e-6:
                out += [za, zb]
            else:
                out.append(za + (zb - za) * (t - ta) / (tb - ta))
    return out


def wall_segments(enu):
    """Vertical wall/barrier faces as 2D segments with a z band."""
    segs = []
    d = json.load(open(enu))
    polys = []
    for r in d["rooms"]:
        for s in r["surfaces"]:
            if s["type"] == "InteriorWallSurface":
                polys += s["polygons"]
    for i in d["installations"]:
        if i["function"] == "EF_25" and i["scope"] != "building":
            polys += i["polygons"]
    for p in polys:
        o = p["outer"]
        zs = [q[2] for q in o]
        if max(zs) - min(zs) < 0.3:
            continue  # horizontal caps
        # footprint of a vertical triangle collapses to a segment: take the two farthest points
        best = (0, None, None)
        for a in range(len(o)):
            for b in range(a + 1, len(o)):
                dd = (o[a][0] - o[b][0]) ** 2 + (o[a][1] - o[b][1]) ** 2
                if dd > best[0]:
                    best = (dd, o[a], o[b])
        if best[1] is None or best[0] < 1e-4:
            continue
        # A sloped face (e.g. a stair flight's side wall) spans different heights along its length;
        # one bounding z band would wrongly block the flight passing beneath it. Split the footprint
        # into <= WALL_PIECE pieces, each with the face's own z extent over that piece.
        (ax, ay), (bx, by) = best[1][:2], best[2][:2]
        L = math.sqrt(best[0])
        tz = [(((q[0] - ax) * (bx - ax) + (q[1] - ay) * (by - ay)) / L, q[2]) for q in o]
        n = max(1, math.ceil(L / WALL_PIECE))
        prev = None
        for k in range(n):
            t0, t1 = L * k / n, L * (k + 1) / n
            band = _z_at(tz, t0) + _z_at(tz, t1) + [z for t, z in tz if t0 < t < t1]
            if not band:
                continue
            lo, hi = round(min(band), 2), round(max(band), 2)
            if prev and prev[4] == lo and prev[5] == hi:  # merge runs with the same band
                prev[2], prev[3] = ax + (bx - ax) * t1 / L, ay + (by - ay) * t1 / L
                continue
            if prev:
                segs.append(tuple(prev))
            prev = [ax + (bx - ax) * t0 / L, ay + (by - ay) * t0 / L,
                    ax + (bx - ax) * t1 / L, ay + (by - ay) * t1 / L, lo, hi]
        if prev:
            segs.append(tuple(prev))
    grid = {}
    for k, (x1, y1, x2, y2, _, _) in enumerate(segs):
        for gx in range(int(math.floor(min(x1, x2) / 4)), int(math.floor(max(x1, x2) / 4)) + 1):
            for gy in range(int(math.floor(min(y1, y2) / 4)), int(math.floor(max(y1, y2) / 4)) + 1):
                grid.setdefault((gx, gy), []).append(k)
    return segs, grid


def _cross(ax, ay, bx, by, cx, cy, dx, dy):
    def orient(px, py, qx, qy, rx, ry):
        return (qx - px) * (ry - py) - (qy - py) * (rx - px)
    o1 = orient(ax, ay, bx, by, cx, cy)
    o2 = orient(ax, ay, bx, by, dx, dy)
    o3 = orient(cx, cy, dx, dy, ax, ay)
    o4 = orient(cx, cy, dx, dy, bx, by)
    return (o1 > 0) != (o2 > 0) and (o3 > 0) != (o4 > 0)


def _cross_t(ax, ay, bx, by, cx, cy, dx, dy):
    """Parameter t along a->b where it properly crosses c-d, else None."""
    if not _cross(ax, ay, bx, by, cx, cy, dx, dy):
        return None
    rx, ry, sx, sy = bx - ax, by - ay, dx - cx, dy - cy
    den = rx * sy - ry * sx
    return None if den == 0 else ((cx - ax) * sy - (cy - ay) * sx) / den


def _in_poly(x, y, poly):
    inside = False
    for a, b in zip(poly, poly[1:] + poly[:1]):
        if (a["y"] > y) != (b["y"] > y) and x < (b["x"] - a["x"]) * (y - a["y"]) / (b["y"] - a["y"]) + a["x"]:
            inside = not inside
    return inside


def outside_coverage(edges, areas):
    """Verified edges with samples outside every routable coverage area (coverage must not under-claim)."""
    polys = [a["polygon"] for a in areas if a.get("status") == "routable" and a.get("polygon")]
    bad = []
    for e in edges:
        if e["verification"] != "verified":
            continue
        g = e["geometry"]
        for p, q in zip(g, g[1:]):
            n = max(1, math.ceil(math.dist((p["x"], p["y"]), (q["x"], q["y"])) / STEP))
            pts = [(p["x"] + (q["x"] - p["x"]) * k / n, p["y"] + (q["y"] - p["y"]) * k / n) for k in range(n + 1)]
            miss = next(((round(x, 1), round(y, 1)) for x, y in pts if not any(_in_poly(x, y, P) for P in polys)), None)
            if miss:
                bad.append(f"edge {e['id']}: verified geometry at {miss} is outside every routable coverage area")
                break
    return bad


def crowd_lanes(grid, edges):
    """Presentation data for scene/crowd.ts: per verified edge, every 1 m, how far (m) a pedestrian
    may stand left/right of the polyline and still be on a surveyed walkable cell (>= 0.35 m from
    walls) without crossing a wall. Right = right of the edge's from->to direction."""
    lanes = {}
    for e in edges:
        if e["verification"] != "verified":
            continue
        g = e["geometry"]
        left, right = [], []
        seg = [(g[i], g[i + 1]) for i in range(len(g) - 1)]
        total = sum(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a, b in seg)
        d = 0.0
        while d <= total + 1e-6:
            acc = 0.0
            for a, b in seg:
                L = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
                if acc + L >= d or (a, b) == seg[-1]:
                    t = 0.0 if L == 0 else min(1.0, (d - acc) / L)
                    x, y = a["x"] + (b["x"] - a["x"]) * t, a["y"] + (b["y"] - a["y"]) * t
                    z = a["z"] + (b["z"] - a["z"]) * t
                    ux, uy = ((b["x"] - a["x"]) / L, (b["y"] - a["y"]) / L) if L else (1.0, 0.0)
                    break
                acc += L
            rx, ry = uy, -ux
            for side, out in ((1, right), (-1, left)):
                ok = 0.0
                for k in range(1, 5):
                    o = 0.25 * k
                    px, py = x + side * o * rx, y + side * o * ry
                    cell = grid.cells.get((round((px - grid.x0) / RES), round((py - grid.y0) / RES)), [])
                    if not any(abs(cz - z) < 0.3 for cz, _ in cell) or grid._blocked(x, y, px, py, z):
                        break
                    ok = o
                out.append(ok)
            d += 1.0
        lanes[e["id"]] = {"stepM": 1.0, "left": left, "right": right}
    return lanes


def main():
    src = json.load(open(SRC))
    surf = Surfaces(ENU)
    segs, sgrid = wall_segments(ENU)
    today = datetime.date.today().isoformat()
    problems = []

    grid = Grid(surf, segs, sgrid, tuple(src["gridBBox"]))
    nodes = {}
    for n in src["nodes"]:
        x, y = n["xy"]
        cell = grid.nearest(x, y, n.get("zHint", 27.9), max_r=n.get("snapR", 2.0))
        if cell is None:
            problems.append(f"node {n['id']}: no walkable cell within {n.get('snapR', 2.0)} m of ({x},{y}) near z={n.get('zHint', 27.9)}; surfaces={surf.heights(x, y)}")
            continue
        cx, cy = grid.xy(cell[0], cell[1])
        z, how = grid.cells[(cell[0], cell[1])][cell[2]]
        nodes[n["id"]] = {**n, "xy": [round(cx, 2), round(cy, 2)], "z": z, "zHow": how, "cell": cell,
                          "snapM": round(math.hypot(cx - x, cy - y), 2)}

    access = {a["id"]: a for a in src["accessFacts"]}
    edges_out = []
    for e in src["edges"]:
        a, b = nodes.get(e["from"]), nodes.get(e["to"])
        if a is None or b is None:
            problems.append(f"edge {e['from']}->{e['to']}: missing node")
            continue
        path = grid.astar(a["cell"], b["cell"], allow_stairs=e.get("mode") != "walk",
                          max_ratio=e.get("maxRatio", 1.5))
        if path is None:
            problems.append(f"edge {e['from']}->{e['to']}: no walkable path on the PLATEAU grid")
            continue
        if path["ratio"] > e.get("maxRatio", 1.5):
            problems.append(f"edge {e['from']}->{e['to']}: path detour ratio {path['ratio']:.2f}")
        pts = [list(p) for p in grid.simplify(path["points"])]
        mode = e.get("mode") or ("stairs" if path["stairs"] else "walk")
        tol = STAIR_TOL if path["stairs"] else WALK_TOL
        fails = 0
        first_fail = None
        length3d = 0.0
        geom = []
        for i in range(len(pts) - 1):
            p, q = pts[i], pts[i + 1]
            seg_len = math.dist(p[:2], q[:2])
            length3d += math.dist(p, q)
            nstep = max(1, math.ceil(seg_len / STEP))  # spacing never exceeds STEP
            for k in range(nstep + 1):
                t = k / nstep
                x, y, z = (p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t)
                if e.get("skipEndSamples") and ((i == 0 and k == 0) or (i == len(pts) - 2 and k == nstep)):
                    continue
                if mode in ("walk", "gate", "stairs", "ramp", "escalator"):
                    hit = surf.height_near(x, y, z, tol)
                    if hit is None:
                        fails += 1
                        first_fail = first_fail or (round(x, 1), round(y, 1), round(z, 2), surf.heights(x, y))
            # wall crossing in 2D, only faces spanning the body height band
            zlo = min(p[2], q[2]) + 0.4
            zhi = max(p[2], q[2]) + 1.8
            cand = set()
            for gx in range(int(math.floor(min(p[0], q[0]) / 4)), int(math.floor(max(p[0], q[0]) / 4)) + 1):
                for gy in range(int(math.floor(min(p[1], q[1]) / 4)), int(math.floor(max(p[1], q[1]) / 4)) + 1):
                    cand.update(sgrid.get((gx, gy), []))
            if mode not in ("elevator",):
                for k in cand:
                    x1, y1, x2, y2, smin, smax = segs[k]
                    if smax < zlo or smin > zhi:
                        continue
                    t = _cross_t(p[0], p[1], q[0], q[1], x1, y1, x2, y2)
                    if t is None:
                        continue
                    zc = p[2] + (q[2] - p[2]) * t  # body height band at the crossing point
                    if smax >= zc + 0.4 and smin <= zc + 1.8:
                        fails += 1
                        first_fail = first_fail or ("wall", round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1))
                        break
            geom.append({"x": round(p[0], 3), "y": round(p[1], 3), "z": round(p[2], 3)})
        geom.append({"x": round(pts[-1][0], 3), "y": round(pts[-1][1], 3), "z": round(pts[-1][2], 3)})
        if fails:
            problems.append(f"edge {e['from']}->{e['to']} ({mode}): {fails} failing samples, first {first_fail}")
        acc_fact = access.get(e.get("access"))
        verified = fails == 0 and acc_fact is not None and mode != "elevator"
        edges_out.append({
            "id": f"{e['from']}__{e['to']}",
            "from": e["from"], "to": e["to"],
            "direction": e.get("direction", "both"),
            "mode": mode,
            "lengthM": round(length3d, 1),
            "geometry": geom,
            "paid": e.get("paid", False if acc_fact else None),
            "crossesFareBoundary": e.get("crossesFareBoundary", False if acc_fact else None),
            "wheelchair": e.get("wheelchair", None),
            "steps": e.get("steps", True if mode == "stairs" else (False if mode in ("walk", "ramp") else None)),
            "hours": None,
            "closed": False,
            "verification": "verified" if verified else ("geometry_only" if fails == 0 else "unverified"),
            "geometryEvidence": {
                "sourceIds": ["plateau-ubld-13116"],
                "method": f"sampled-on-plateau-surface:step={STEP}m,tol={tol}m;no-wall-crossing",
                "checkedDate": today,
            },
            "accessEvidence": None if acc_fact is None else {
                "sourceIds": acc_fact["sourceIds"],
                "method": acc_fact["method"],
                "checkedDate": acc_fact["checkedDate"],
                "note": acc_fact["text"],
            },
            "attributes": {k: v for k, v in e.items() if k in ("note",)},
        })

    problems += outside_coverage(edges_out, src["coverage"]["areas"])
    if problems:
        print("\n".join(problems))
        print(f"FAIL: {len(problems)} problem(s); station.json not written")
        sys.exit(1)

    station = {
        "schema": "gteki.station/0.1",
        "station": src["station"] | {"generatedAt": datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds")},
        "sources": src["sources"],
        "floors": src["floors"],
        "coverage": src["coverage"],
        "spawnNodeIds": src.get("spawnNodeIds", []),
        "assets": src.get("assets", []),
    }
    graph = {
        "schema": "gteki.station/0.1",
        "stationId": src["station"]["id"],
        "nodes": [{
            "id": n["id"], "floorId": n["floor"],
            "position": {"x": n["xy"][0], "y": n["xy"][1], "z": n["z"]},
            "kind": n["kind"], "inOut": n.get("inOut", "inside"),
            "sourceRefs": n.get("sourceRefs", [{"sourceId": "plateau-ubld-13116", "featureId": "walkable-grid-cell"}]),
        } for n in nodes.values()],
        "edges": edges_out,
    }
    pois = {"schema": "gteki.station/0.1", "stationId": src["station"]["id"], "pois": src["pois"]}
    node_ids = {n["id"] for n in graph["nodes"]}
    for p in src["pois"]:
        for c in p["connectorNodeIds"]:
            if c not in node_ids:
                print(f"FAIL: poi {p['id']} connector {c} missing")
                sys.exit(1)
    os.makedirs(OUT_DIR, exist_ok=True)
    for name, obj in (("station.json", station), ("graph.json", graph), ("pois.json", pois)):
        write_json(os.path.join(OUT_DIR, name), obj, indent=1)
    write_json(os.path.join(ROOT, "scene", "crowd_lanes.json"),
               {"generatedFrom": "gteki/graph.json + PLATEAU walkable grid", "lanes": crowd_lanes(grid, edges_out)})
    v = sum(1 for e in edges_out if e["verification"] == "verified")
    print(f"OK: {len(nodes)} nodes, {len(edges_out)} edges ({v} verified), "
          f"{sum(e['lengthM'] for e in edges_out if e['verification'] == 'verified'):.0f} m verified")


if __name__ == "__main__":
    main()
