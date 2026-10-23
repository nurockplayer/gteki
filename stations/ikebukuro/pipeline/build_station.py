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
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
from floorquery import Surfaces  # noqa: E402
from gridnav import FLOOR_EDGE_BAND, RES, Grid, _seg_dist, _seg_seg_dist  # noqa: E402

ROOT = os.path.dirname(HERE)
SRC = os.path.join(ROOT, "data", "graph.src.json")
ENU = os.path.join(ROOT, "build", "ubld_enu.json")
OUT_DIR = os.path.join(ROOT, "gteki")
STEP = 0.5
WALK_TOL = 0.35   # m between interpolated and surveyed height on walk edges
STAIR_TOL = 0.9   # stairs/escalators: treads are discrete
STATION_TZ = datetime.timezone(datetime.timedelta(hours=9), "JST")  # Japan: no DST


WALL_PIECE = 0.5  # m
EDGE_CLEAR = 0.35  # m: least plan distance from a polyline to a collider (walker radius 0.3 m + margin), #227
# A wall whose top is within FLOOR_EDGE_TOL of a walking surface no more than FLOOR_EDGE_REACH away (in plan)
# is that surface's edge (a stairwell wall ending flush with the floor above), not a body obstacle. The
# tolerance is fixed and small: a top 0.1 m above the neighbouring floor is a kerb and stays a collider.
FLOOR_EDGE_TOL = 0.05  # m
FLOOR_EDGE_REACH = 0.5  # m
# Per-edge clearance floors below EDGE_CLEAR, each one reviewed. ne_j__x26: near the head of the Exit 26 stairs a side
# wall's top (TP 32.25 m) is about 0.44 m above the tread at the narrowest point (TP 31.81 m), at the bottom of the
# 0.4-1.8 m body band; the explorer's bodyBlock walks
# the polyline (scene/route_clearance.test.ts). An edge below its own floor fails, and so does an entry whose edge
# already clears EDGE_CLEAR, so an exception never outlives the geometry it excuses. Refs #227.
CLEARANCE_EXCEPTIONS = {"ne_j__x26": 0.33}


def write_json(path, obj, indent=None):
    """Write via a temp file and rename, so a watching dev server never reads a half-written file."""
    tmp = path + ".tmp"
    text = json.dumps(obj, ensure_ascii=False, indent=indent)
    if indent is not None:  # source decisions stay one line, as in the hand-authored graph.src.json
        text = re.sub(r'"decision": \{\n\s+"url": ("[^"]*"),\n\s+"date": ("[^"]*")\n\s+\}', r'"decision": { "url": \1, "date": \2 }', text)
    try:
        with open(tmp, "w") as f:
            f.write(text)
        os.replace(tmp, path)
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


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


def wall_segments(enu, colliders=False):
    """Vertical wall/barrier faces as 2D segments with a z band.

    colliders=True adds what the explorer also collides with (scene.ts `assembleCollision`): escalators
    (EF_80, role `transport`) and the building-scope EF_25 barriers, so route clearance is measured against
    the walker's real colliders. Signage keeps the default set."""
    segs = []
    d = json.load(open(enu))
    polys = []
    for r in d["rooms"]:
        for s in r["surfaces"]:
            if s["type"] == "InteriorWallSurface":
                polys += s["polygons"]
    for i in d["installations"]:
        if (i["function"] == "EF_25" and (colliders or i["scope"] != "building")) or (colliders and i["function"] == "EF_80"):
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


def floor_edges(segs, surf):
    """Indices of wall pieces whose top is the edge of a walkable surface: a PLATEAU floor or stair tread
    within FLOOR_EDGE_REACH m (in plan) of the piece lies within FLOOR_EDGE_TOL m of the piece's top, as a
    stairwell wall ends flush with the floor at the head of the stairs. Such a top is where the walking
    surface begins, not something the body runs into, so for these pieces the grid and the clearance check start
    the body band at gridnav.FLOOR_EDGE_BAND above the feet instead of 0.4 m (#227): the top only drops out for
    feet within that height below it. Walls that stand above any neighbouring walking surface stay in."""
    probes = [k * FLOOR_EDGE_REACH / 5 for k in range(1, 6)]
    zr = [(min(q[2] for q in p[1]), max(q[2] for q in p[1])) for p in surf.polys]
    out = set()
    for k, (x1, y1, x2, y2, _, hi) in enumerate(segs):
        # cheap filter: some walking polygon indexed within reach of the piece spans the top height
        near = set()
        for gx in range(int(math.floor((min(x1, x2) - FLOOR_EDGE_REACH) / 4)), int(math.floor((max(x1, x2) + FLOOR_EDGE_REACH) / 4)) + 1):
            for gy in range(int(math.floor((min(y1, y2) - FLOOR_EDGE_REACH) / 4)), int(math.floor((max(y1, y2) + FLOOR_EDGE_REACH) / 4)) + 1):
                near.update(surf.grid.get((gx, gy), []))
        if not any(zr[i][0] - FLOOR_EDGE_TOL <= hi <= zr[i][1] + FLOOR_EDGE_TOL for i in near):
            continue
        # probe rings (8 directions) around both ends and the middle of the piece, out to FLOOR_EDGE_REACH
        hit = False
        for t in (0.0, 0.5, 1.0):
            px, py = x1 + (x2 - x1) * t, y1 + (y2 - y1) * t
            for d in probes:
                for a in range(8):
                    ux, uy = math.cos(a * math.pi / 4), math.sin(a * math.pi / 4)
                    if any(abs(z - hi) <= FLOOR_EDGE_TOL for z, _ in surf.heights(px + d * ux, py + d * uy)):
                        hit = True
                        break
                if hit:
                    break
            if hit:
                break
        if hit:
            out.add(k)
    return out


def collider_segments(enu, surf=None):
    """wall_segments with the explorer's full collider set: used by the grid and the clearance check.
    With `surf`, also the floor-edge pieces (see floor_edges) as a third value."""
    segs, grid = wall_segments(enu, colliders=True)
    if surf is None:
        return segs, grid
    return segs, grid, floor_edges(segs, surf)


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


def closures(enu):
    """Near-horizontal PLATEAU closure surfaces (stairwell tops at street level): (z, outer ring)."""
    out = []
    for r in json.load(open(enu))["rooms"]:
        for s in r["surfaces"]:
            if s["type"] != "ClosureSurface":
                continue
            for p in s["polygons"]:
                zs = [q[2] for q in p["outer"]]
                if len(p["outer"]) >= 3 and max(zs) - min(zs) < 0.3:
                    out.append((sum(zs) / len(zs), p["outer"]))
    return out


def exits_at_top(nodes, surf, caps, reach=4.0):
    """An `exit` node is the street end of its stairs: no surveyed tread within `reach` m rises above it,
    and a horizontal closure (the stairwell's street-level top) is just above it. A route that stops
    lower is a `stair_end` (Exits 4, 13, 36) and is named for where it stops."""
    bad = []
    for n in nodes.values():
        if n["kind"] != "exit":
            continue
        (x, y), z = n["xy"], n["z"]
        top = max((h for i in range(-40, 41) for j in range(-40, 41) if math.hypot(i, j) * 0.1 <= reach
                   for h, k in surf.heights(x + i * 0.1, y + j * 0.1) if k == "stairs" and z - 1.5 < h), default=z)
        if top > z + 0.05:
            bad.append(f"exit node {n['id']}: surveyed treads within {reach} m rise to {top:.2f} m, above the node at {z:.2f} m")
        near = [cz for cz, ring in caps if -0.05 <= cz - z <= 0.3
                and (_in_poly(x, y, [{"x": q[0], "y": q[1]} for q in ring])
                     or min(_seg_dist(x, y, a[0], a[1], b[0], b[1]) for a, b in zip(ring, ring[1:] + ring[:1])) <= 1.0)]
        if not near:
            bad.append(f"exit node {n['id']}: no street-level closure within 0.3 m above it")
    return bad


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


def crowd_lanes(grid, edges, areas):
    """Presentation data for scene/crowd.ts: per verified edge and per 1 m interval of horizontal
    distance (the last one ends at the end node), how far (m, up to 1) a pedestrian may stand
    left/right of the polyline anywhere in that interval: every point between the polyline and that
    offset is on a surveyed walkable cell (>= 0.35 m from walls) without crossing a wall, and inside
    the union of the routable coverage areas (the access fences stand on its outline, so a lane never
    reaches past them). Right = right of the edge's from->to direction.

    Each value is the minimum over probes every FINE of distance (so both interval ends are probed)
    and at every polyline vertex with both adjacent segment directions (the crowd's sideways vector
    turns there), and each probe tests the whole lateral span in FINE steps, so no narrowing or turn
    longer than FINE falls between probes."""
    FINE = 0.05
    STEPS = round(1.0 / FINE)
    routable = [a["polygon"] for a in areas if a.get("status") == "routable" and a.get("polygon")]

    def on_floor(px, py, z):
        if not any(_in_poly(px, py, P) for P in routable):
            return False
        cell = grid.cells.get((round((px - grid.x0) / RES), round((py - grid.y0) / RES)), [])
        return any(abs(cz - z) < 0.3 for cz, _ in cell)

    def clearance(x, y, z, ux, uy, side):
        rx, ry = side * uy, -side * ux
        n = 0
        while n < STEPS and on_floor(x + (n + 1) * FINE * rx, y + (n + 1) * FINE * ry, z):
            n += 1
        # one wall test covers the whole span from the polyline out to the offset
        while n and grid._blocked(x, y, x + n * FINE * rx, y + n * FINE * ry, z):
            n -= 1
        return round(n * FINE, 2)

    lanes = {}
    for e in edges:
        if e["verification"] != "verified":
            continue
        g = e["geometry"]
        # probes (d, x, y, z, ux, uy): every FINE of distance from the edge start (so every interval
        # end is probed exactly) plus each segment's two vertices with that segment's direction
        probes, acc = [], 0.0
        for a, b in zip(g, g[1:]):
            L = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
            if L < 1e-9:
                continue
            ux, uy = (b["x"] - a["x"]) / L, (b["y"] - a["y"]) / L
            ts = [0.0, 1.0] + [(m * FINE - acc) / L for m in range(math.ceil(acc / FINE), math.floor((acc + L) / FINE) + 1)]
            for t in ts:
                t = min(1.0, max(0.0, t))
                probes.append((acc + t * L, a["x"] + (b["x"] - a["x"]) * t, a["y"] + (b["y"] - a["y"]) * t,
                               a["z"] + (b["z"] - a["z"]) * t, ux, uy))
            acc += L
        left, right = [], []
        for k in range(math.ceil(acc - 1e-6)):
            lo, hi = float(k), min(k + 1.0, acc)
            inside = [q for q in probes if lo - 1e-6 <= q[0] <= hi + 1e-6]
            right.append(min(clearance(*q[1:], 1) for q in inside))
            left.append(min(clearance(*q[1:], -1) for q in inside))
        lanes[e["id"]] = {"stepM": 1.0, "left": left, "right": right}
    return lanes


def build_instant(src):
    """One reproducible build time for generatedAt and the geometry checkedDate.

    SOURCE_DATE_EPOCH wins; otherwise the newest evidence date in the hand-authored source (source
    retrievedAt, access-fact checkedDate), so rebuilding unchanged inputs rewrites byte-identical
    artifacts and a source edit never depends on when it is committed.
    """
    epoch = os.environ.get("SOURCE_DATE_EPOCH")
    if epoch:
        return datetime.datetime.fromtimestamp(int(epoch), datetime.timezone.utc)
    # Sources used only by the visual street context (#39) are not route evidence: adding or refetching
    # them must not move the edges' geometry checkedDate.
    context_only = {i for a in src.get("assets", []) if a["id"] == "street-context" for i in a["sourceIds"]}
    stamps = [datetime.datetime.fromisoformat(s["retrievedAt"].replace("Z", "+00:00")) for s in src["sources"]
              if s.get("retrievedAt") and s["id"] not in context_only]
    # Date-only checks were made in Japan: they start at local midnight, never at a later UTC midnight.
    stamps += [datetime.datetime.fromisoformat(f["checkedDate"]).replace(tzinfo=STATION_TZ) for f in src["accessFacts"] if f.get("checkedDate")]
    return max(stamps).astimezone(datetime.timezone.utc)


def edge_clearance(grid, surf, pts):
    """Least plan distance (m) from an edge polyline to the colliders reaching its body band, and where.
    The band stands on the surveyed surface under each piece (on stairs a straight polyline runs below the
    treads), as in gridnav's `_line_ok`."""
    best = (math.inf, None)
    excluded = {}
    for p, q in zip(pts, pts[1:]):
        n = max(1, math.ceil(math.dist(p[:2], q[:2]) / 0.25))  # short pieces: the band follows the stairs
        for k in range(n):
            a = [p[c] + (q[c] - p[c]) * k / n for c in range(3)]
            b = [p[c] + (q[c] - p[c]) * (k + 1) / n for c in range(3)]
            zs = []
            for v in (a, b):
                hit = surf.height_near(v[0], v[1], v[2], 0.6)
                zs.append(hit[0] if hit else v[2])
            z = sum(zs) / 2
            d = grid.clearance(a[0], a[1], b[0], b[1], z)
            if d < best[0]:
                best = (d, [round((a[0] + b[0]) / 2, 2), round((a[1] + b[1]) / 2, 2), round((a[2] + b[2]) / 2, 2)])
            # audit: floor-edge pieces within EDGE_CLEAR that the ordinary band (from 0.4 m) would count and the
            # floor-edge band (from FLOOR_EDGE_BAND) lets pass
            for s in (grid._near_segs(a[0], a[1]) | grid._near_segs(b[0], b[1])) & grid.floor_edge:
                x1, y1, x2, y2, smin, smax = grid.segs[s]
                if smax < z + 0.4 or smax >= z + FLOOR_EDGE_BAND or smin > z + 1.8:
                    continue
                if _seg_seg_dist(a[0], a[1], b[0], b[1], x1, y1, x2, y2) < EDGE_CLEAR:
                    excluded[s] = smax
    return round(best[0], 3), best[1], [{"zTop": excluded[s], "piece": [round(v, 2) for v in grid.segs[s][:4]]} for s in sorted(excluded)]


def main():
    report_path = sys.argv[sys.argv.index("--report") + 1] if "--report" in sys.argv else None
    src = json.load(open(SRC))
    surf = Surfaces(ENU)
    segs, sgrid, floor_edge = collider_segments(ENU, surf)
    built = build_instant(src)
    today = built.astimezone(STATION_TZ).date().isoformat()  # station-local date, like the access facts
    problems = []

    grid = Grid(surf, segs, sgrid, tuple(src["gridBBox"]), floor_edge)
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
    problems += exits_at_top(nodes, surf, closures(ENU))

    access = {a["id"]: a for a in src["accessFacts"]}
    edges_out = []
    clearance_report = {}
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
                    lo = grid.band_lo(k)  # a floor-edge piece's band starts higher (gridnav.FLOOR_EDGE_BAND)
                    if smax < zlo - 0.4 + lo or smin > zhi:
                        continue
                    t = _cross_t(p[0], p[1], q[0], q[1], x1, y1, x2, y2)
                    if t is None:
                        continue
                    zc = p[2] + (q[2] - p[2]) * t  # body height band at the crossing point
                    if smax >= zc + lo and smin <= zc + 1.8:
                        fails += 1
                        first_fail = first_fail or ("wall", round(x1, 1), round(y1, 1), round(x2, 1), round(y2, 1))
                        break
            geom.append({"x": round(p[0], 3), "y": round(p[1], 3), "z": round(p[2], 3)})
        geom.append({"x": round(pts[-1][0], 3), "y": round(pts[-1][1], 3), "z": round(pts[-1][2], 3)})
        if fails:
            problems.append(f"edge {e['from']}->{e['to']} ({mode}): {fails} failing samples, first {first_fail}")
        clear_m, clear_at, edge_floor = edge_clearance(grid, surf, pts)
        eid = f"{e['from']}__{e['to']}"
        need = CLEARANCE_EXCEPTIONS.get(eid, EDGE_CLEAR)
        clearance_report[eid] = {"minClearanceM": clear_m, "at": clear_at, "floorEdgeExcluded": edge_floor,
                                 **({"exception": True, "floorM": need} if eid in CLEARANCE_EXCEPTIONS else {})}
        if clear_m < need and mode != "elevator":
            fails += 1
            problems.append(f"edge {e['from']}->{e['to']} ({mode}): passes {clear_m} m from a collider at {clear_at} (needs {need} m)")
        elif eid in CLEARANCE_EXCEPTIONS and clear_m >= EDGE_CLEAR:
            problems.append(f"edge {eid}: clears {clear_m} m >= {EDGE_CLEAR} m; drop it from CLEARANCE_EXCEPTIONS")
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
            "wheelchair": e.get("wheelchair", False if mode == "stairs" else None),  # stairs are never step-free (#203 A6)
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

    problems += [f"CLEARANCE_EXCEPTIONS: no edge {k}" for k in CLEARANCE_EXCEPTIONS if k not in clearance_report]
    problems += outside_coverage(edges_out, src["coverage"]["areas"])
    if report_path:
        write_json(report_path, {"edgeClearM": EDGE_CLEAR, "floorEdgeTolM": FLOOR_EDGE_TOL, "floorEdgeReachM": FLOOR_EDGE_REACH,
                                 "floorEdgeBandM": FLOOR_EDGE_BAND, "floorEdgePieces": len(floor_edge), "edges": clearance_report}, indent=1)
    if problems:
        print("\n".join(problems))
        print(f"FAIL: {len(problems)} problem(s); station.json not written")
        sys.exit(1)

    station = {
        "schema": "gteki.station/0.1",
        "station": src["station"] | {"generatedAt": built.isoformat(timespec="seconds")},
        "sources": src["sources"],
        "floors": src["floors"],
        "coverage": src["coverage"],
        "spawnNodeIds": src.get("spawnNodeIds", []),
        "assets": src.get("assets", []),
        "dataFiles": src.get("dataFiles", []),
    }
    graph = {
        "schema": "gteki.station/0.1",
        "stationId": src["station"]["id"],
        "nodes": [{
            "id": n["id"], "floorId": n["floor"],
            "position": {"x": n["xy"][0], "y": n["xy"][1], "z": n["z"]},
            # MLIT in_out: an exit node is the opening onto the street (boundary); a stair_end foot is still
            # inside, since the climb past it is not modelled.
            "kind": n["kind"], "inOut": n.get("inOut") or ("boundary" if n["kind"] == "exit" else "inside"),
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
               {"generatedFrom": "gteki/graph.json + PLATEAU walkable grid", "lanes": crowd_lanes(grid, edges_out, src["coverage"]["areas"])})
    v = sum(1 for e in edges_out if e["verification"] == "verified")
    print(f"OK: {len(nodes)} nodes, {len(edges_out)} edges ({v} verified), "
          f"{sum(e['lengthM'] for e in edges_out if e['verification'] == 'verified'):.0f} m verified")


if __name__ == "__main__":
    main()
