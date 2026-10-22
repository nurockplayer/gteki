"""Placement anchors for kit dressing (stair nosings, escalator landings), from the PLATEAU survey.

    python3 -I stations/ikebukuro/pipeline/build_dressing_anchors.py [ubld_enu.json [dressing_anchors.json]]
        [--station gteki/station.json]

Reads build/ubld_enu.json (the ENU extract of the ubld GML, git-ignored) and writes
scene/dressing_anchors.json. Facts only: every position is derived from surveyed EF_35 (stairs_ramps) and
EF_80 (transport) triangles; nothing is invented, and nothing here changes the GLB, the bake or the graph.

Stairs. The survey models each step as a riser (2 vertical triangles) and a tread (horizontal triangles).
The top edge of a riser is the nosing line of the tread above it. The up-stair direction is the side of
that edge on which a tread at the same height lies. Nosings of consecutive steps (one rise up, one tread
deep along the direction) are chained into flights; a flight's `bottom` and `top` are its first and last
nosing lines.

Escalators. Each bank is modelled as one sloped quad (the walking envelope) plus thin vertical truss
side plates. The quad's low edge is the lower landing line and its high edge the upper landing line.
Plates inside the bank are paired (adjacent, 0.7-1.8 m apart) into lanes; a lane gets a landing at each
end, at the lane centre on those edges, with its clear width between plates. Without plates the whole
edge is one lane.

Output frame: ENU metres (x east, y north, z TP height), rounded to 1 mm. `dir` is the horizontal unit
vector of travel up the stair or escalator. Deterministic: same input, same bytes.
"""
import bisect
import hashlib
import json
import math
import os
import re
import sys
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SCHEMA = "gteki.ikebukuro.dressing-anchors/0"
EXTRACT_SCHEMA = "gteki.plateau-ubld-extract/0"
TREAD_Z_TOL = 0.004       # a riser top edge and its tread agree within this (m)
RISER_NZ = 0.02           # |n.z| below this: vertical face
FLAT_NZ = 0.98            # |n.z| above this: horizontal face
STEP_RISE = (0.08, 0.30)  # nosing to next nosing, height
STEP_RUN = (0.12, 0.60)   # nosing to next nosing, along the stair direction
STEP_LATERAL = 0.20       # allowed sideways drift between consecutive nosings
STEP_WIDTH = 0.30         # allowed width change between consecutive nosings
PLATE_THIN = 0.5          # side plates are thinner than this across the bank
LANE_GAP = (0.7, 1.8)     # clear distance between the two plates of one lane
MIN_EDGE = 0.05           # shorter horizontal edges are slivers


def r3(v):
    return round(v, 3) + 0.0  # + 0.0 folds -0.0 into 0.0


def vsub(a, b):
    return (a[0] - b[0], a[1] - b[1], a[2] - b[2])


def cross(a, b):
    return (a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0])


def normal(t):
    n = cross(vsub(t[1], t[0]), vsub(t[2], t[0]))
    length = math.sqrt(n[0] ** 2 + n[1] ** 2 + n[2] ** 2)
    return ((0.0, 0.0, 0.0), 0.0) if length == 0 else ((n[0] / length, n[1] / length, n[2] / length), length / 2)


def hunit(dx, dy):
    length = math.hypot(dx, dy)
    return (dx / length, dy / length)


def in_tri_xy(p, t):
    """Point-in-triangle on the xy projection (boundary counts as inside)."""
    (ax, ay, _), (bx, by, _), (cx, cy, _) = t
    d1 = (p[0] - bx) * (ay - by) - (ax - bx) * (p[1] - by)
    d2 = (p[0] - cx) * (by - cy) - (bx - cx) * (p[1] - cy)
    d3 = (p[0] - ax) * (cy - ay) - (cx - ax) * (p[1] - ay)
    neg = d1 < -1e-9 or d2 < -1e-9 or d3 < -1e-9
    pos = d1 > 1e-9 or d2 > 1e-9 or d3 > 1e-9
    return not (neg and pos)


class DSU:
    def __init__(self, n):
        self.p = list(range(n))

    def find(self, x):
        while self.p[x] != x:
            self.p[x] = self.p[self.p[x]]
            x = self.p[x]
        return x

    def union(self, a, b):
        ra, rb = self.find(a), self.find(b)
        if ra != rb:
            self.p[max(ra, rb)] = min(ra, rb)


# ---- stairs ---------------------------------------------------------------------------------------------

def riser_top_edges(tris):
    """Horizontal top edges (z, p, q) of the vertical triangles: apex below the edge."""
    edges = []
    for t in tris:
        n, _ = normal(t)
        if abs(n[2]) >= RISER_NZ:
            continue
        for j in range(3):
            p, q, apex = t[j], t[(j + 1) % 3], t[(j + 2) % 3]
            if abs(p[2] - q[2]) < 0.002 and math.hypot(p[0] - q[0], p[1] - q[1]) > MIN_EDGE and apex[2] < p[2]:
                edges.append(((p[2] + q[2]) / 2, (p[0], p[1]), (q[0], q[1])))
    return edges


def merge_collinear(edges):
    """Merge top edges of one tread that lie on one line and touch or overlap (split risers)."""
    edges = sorted(edges, key=lambda e: (round(e[0], 3), e[1], e[2]))
    out = []
    used = [False] * len(edges)
    for i, (z, p, q) in enumerate(edges):
        if used[i]:
            continue
        used[i] = True
        u = hunit(q[0] - p[0], q[1] - p[1])
        lo, hi = 0.0, math.hypot(q[0] - p[0], q[1] - p[1])
        grew = True
        while grew:
            grew = False
            for j in range(i + 1, len(edges)):
                if used[j]:
                    continue
                z2, p2, q2 = edges[j]
                if abs(z2 - z) > TREAD_Z_TOL:
                    continue
                d = (p2[0] - p[0], p2[1] - p[1])
                e = (q2[0] - p[0], q2[1] - p[1])
                if abs(-d[0] * u[1] + d[1] * u[0]) > 0.01 or abs(-e[0] * u[1] + e[1] * u[0]) > 0.01:
                    continue
                a, b = sorted((d[0] * u[0] + d[1] * u[1], e[0] * u[0] + e[1] * u[1]))
                if a > hi + 0.01 or b < lo - 0.01:
                    continue
                used[j] = True
                lo, hi = min(lo, a), max(hi, b)
                grew = True
        out.append((z, (p[0] + u[0] * lo, p[1] + u[1] * lo), (p[0] + u[0] * hi, p[1] + u[1] * hi)))
    return out


def stair_nosings(tris):
    """Oriented nosing lines (z, left, right, dir) for the stair triangles. Also returns the unresolved count."""
    treads = defaultdict(list)  # z bucket (2 mm) -> horizontal triangles
    for t in tris:
        n, _ = normal(t)
        if abs(n[2]) > FLAT_NZ:
            treads[round(sum(p[2] for p in t) / 3 / 0.002)].append(t)

    def tread_at(z, point):
        base = round(z / 0.002)
        return any(in_tri_xy(point, t) for k in (base - 1, base, base + 1) for t in treads.get(k, ()))

    nosings, unresolved = [], 0
    for z, p, q in merge_collinear(riser_top_edges(tris)):
        length = math.hypot(q[0] - p[0], q[1] - p[1])
        e = hunit(q[0] - p[0], q[1] - p[1])
        left = (-e[1], e[0])
        mid = ((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)
        # Sample along the edge, 0.08 m to each side: the up-stair side is the one with the tread.
        side = [0, 0]
        for f in (0.25, 0.5, 0.75):
            c = (p[0] + (q[0] - p[0]) * f, p[1] + (q[1] - p[1]) * f)
            for k, s in enumerate((1, -1)):
                if tread_at(z, (c[0] + left[0] * 0.08 * s, c[1] + left[1] * 0.08 * s)):
                    side[k] += 1
        if (side[0] > 0) == (side[1] > 0):
            unresolved += 1
            continue
        up = left if side[0] else (-left[0], -left[1])
        # a = left end, b = right end, facing up the stair
        a, b = sorted((p, q), key=lambda e: -(e[0] * -up[1] + e[1] * up[0]))
        nosings.append({"z": z, "a": a, "b": b, "dir": up, "width": length, "mid": mid})
    return nosings, unresolved


def chain_flights(nosings):
    """Link each nosing to the next one up (best candidate = least run), then group the links."""
    n = len(nosings)
    order = sorted(range(n), key=lambda i: (round(nosings[i]["z"], 3), round(nosings[i]["mid"][0], 3), round(nosings[i]["mid"][1], 3)))
    by_z = sorted(order, key=lambda i: nosings[i]["z"])
    dsu = DSU(n)
    nxt = {}
    zs = [nosings[i]["z"] for i in by_z]
    for i in order:
        a = nosings[i]
        lo = bisect.bisect_left(zs, a["z"] + STEP_RISE[0])
        hi = bisect.bisect_right(zs, a["z"] + STEP_RISE[1])
        best = None
        for k in range(lo, hi):
            j = by_z[k]
            b = nosings[j]
            if a["dir"][0] * b["dir"][0] + a["dir"][1] * b["dir"][1] < 0.99:
                continue
            dx, dy = b["mid"][0] - a["mid"][0], b["mid"][1] - a["mid"][1]
            along = dx * a["dir"][0] + dy * a["dir"][1]
            lateral = abs(-dx * a["dir"][1] + dy * a["dir"][0])
            if not STEP_RUN[0] <= along <= STEP_RUN[1] or lateral > STEP_LATERAL or abs(a["width"] - b["width"]) > STEP_WIDTH:
                continue
            key = (round(along, 3), round(b["z"], 3), j)
            if best is None or key < best[0]:
                best = (key, j)
        if best:
            nxt[i] = best[1]
            dsu.union(i, best[1])
    groups = defaultdict(list)
    for i in range(n):
        groups[dsu.find(i)].append(i)
    flights = [sorted(g, key=lambda i: (nosings[i]["z"], nosings[i]["mid"][0], nosings[i]["mid"][1])) for g in groups.values()]
    flights.sort(key=lambda g: (round(nosings[g[0]]["z"], 3), round(nosings[g[0]]["mid"][0], 3), round(nosings[g[0]]["mid"][1], 3)))
    return flights


def nosing_anchor(n):
    """Full anchor for one nosing line: midpoint, direction, width, both ends."""
    return {
        "position": [r3(n["mid"][0]), r3(n["mid"][1]), r3(n["z"])],
        "dir": [round(n["dir"][0], 4) + 0.0, round(n["dir"][1], 4) + 0.0],
        "width_m": r3(n["width"]),
        "a": [r3(n["a"][0]), r3(n["a"][1]), r3(n["z"])],
        "b": [r3(n["b"][0]), r3(n["b"][1]), r3(n["z"])],
    }


def build_stairs(installations):
    flights_out, unresolved, step_count = [], 0, 0
    serial = 0
    for inst in installations:
        if inst["function"] != "EF_35":
            continue
        nosings, bad = stair_nosings([p["outer"] for p in inst["polygons"]])
        unresolved += bad
        step_count += len(nosings)
        for g in chain_flights(nosings):
            first, last = nosings[g[0]], nosings[g[-1]]
            runs = [
                (nosings[g[k + 1]]["mid"][0] - nosings[g[k]]["mid"][0]) * nosings[g[k]]["dir"][0]
                + (nosings[g[k + 1]]["mid"][1] - nosings[g[k]]["mid"][1]) * nosings[g[k]]["dir"][1]
                for k in range(len(g) - 1)
            ]
            serial += 1
            flights_out.append({
                "id": f"stair{serial:03d}",
                "scope": inst["scope"].rsplit("_", 1)[-1] if inst["scope"] != "building" else "building",
                "steps": len(g),
                "rise_m": r3(last["z"] - first["z"]),
                "run_m": r3(sum(runs) / len(runs)) if runs else None,
                "bottom": nosing_anchor(first),
                "top": nosing_anchor(last),
                "nosings": [[r3(nosings[i]["a"][0]), r3(nosings[i]["a"][1]), r3(nosings[i]["b"][0]), r3(nosings[i]["b"][1]), r3(nosings[i]["z"])] for i in g],
            })
    return flights_out, {"steps": step_count, "unresolved_steps": unresolved}


# ---- escalators -----------------------------------------------------------------------------------------

def components(tris):
    key = lambda p: (round(p[0] * 500), round(p[1] * 500), round(p[2] * 500))
    dsu = DSU(len(tris))
    first = {}
    for i, t in enumerate(tris):
        for p in t:
            k = key(p)
            if k in first:
                dsu.union(i, first[k])
            else:
                first[k] = i
    groups = defaultdict(list)
    for i, t in enumerate(tris):
        groups[dsu.find(i)].append(t)
    return [groups[k] for k in sorted(groups)]


def build_escalators(installations):
    banks, plates = [], []
    for inst in installations:
        if inst["function"] != "EF_80":
            continue
        scope = inst["scope"].rsplit("_", 1)[-1] if inst["scope"] != "building" else "building"
        for comp in components([p["outer"] for p in inst["polygons"]]):
            sloped = [t for t in comp if 0.2 < abs(normal(t)[0][2]) < FLAT_NZ]
            if not sloped:
                continue
            # up-slope: the downward tilt of an upward-facing sloped normal, area weighted
            ux = uy = 0.0
            for t in sloped:
                n, area = normal(t)
                s = 1.0 if n[2] > 0 else -1.0
                ux -= s * n[0] * area
                uy -= s * n[1] * area
            u = hunit(ux, uy)
            pts = [tuple(p) for t in sloped for p in t]
            across = [-p[0] * u[1] + p[1] * u[0] for p in pts]
            along = [p[0] * u[0] + p[1] * u[1] for p in pts]
            rec = {"scope": scope, "tris": sloped, "u": u, "t": (min(across), max(across)), "s": (min(along), max(along)), "pts": pts}
            (plates if max(across) - min(across) < PLATE_THIN else banks).append(rec)
    banks.sort(key=lambda b: (b["scope"],) + tuple(round(v, 3) for v in min(b["pts"])))

    out, skipped = [], 0
    for bank in banks:
        zs = sorted({round(p[2], 3) for p in bank["pts"]})
        low = sorted(p for p in bank["pts"] if abs(p[2] - zs[0]) < 0.005)
        high = sorted(p for p in bank["pts"] if abs(p[2] - zs[-1]) < 0.005)
        low, high = sorted(set(low)), sorted(set(high))
        if len(low) < 2 or len(high) < 2:
            skipped += 1
            continue
        lo0, lo1 = low[0], low[-1]
        hi0, hi1 = high[0], high[-1]
        u = hunit((hi0[0] + hi1[0]) / 2 - (lo0[0] + lo1[0]) / 2, (hi0[1] + hi1[1]) / 2 - (lo0[1] + lo1[1]) / 2)
        left = (-u[1], u[0])
        tc = lambda p: p[0] * left[0] + p[1] * left[1]
        # orient both edges left to right
        lo0, lo1 = sorted((lo0, lo1), key=tc)
        hi0, hi1 = sorted((hi0, hi1), key=tc)
        mine = [pl for pl in plates if pl["scope"] == bank["scope"] and bank["t"][0] - 0.3 <= (pl["t"][0] + pl["t"][1]) / 2 <= bank["t"][1] + 0.3
                and pl["s"][0] < bank["s"][1] and pl["s"][1] > bank["s"][0]]
        # plates measured in the bank frame
        spans = sorted((min(tc(p) for p in pl["pts"]), max(tc(p) for p in pl["pts"])) for pl in mine)
        lanes, i = [], 0
        while i + 1 < len(spans):
            gap = spans[i + 1][0] - spans[i][1]
            if LANE_GAP[0] <= gap <= LANE_GAP[1]:
                lanes.append((spans[i][1], spans[i + 1][0]))
                i += 2
            else:
                i += 1
        edge_lo = (tc(lo0), tc(lo1))
        if not lanes:
            lanes = [edge_lo]
        bank_id = f"esc{len(set(o['bank'] for o in out)) + 1:02d}"
        for k, (t0, t1) in enumerate(sorted(lanes)):
            tmid = (t0 + t1) / 2
            if not (edge_lo[0] - 0.05 <= tmid <= edge_lo[1] + 0.05):
                continue

            def at(a, b, ta, tb):
                f = 0.0 if tb == ta else min(1.0, max(0.0, (tmid - ta) / (tb - ta)))
                return (a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f)

            lower, upper = at(lo0, lo1, tc(lo0), tc(lo1)), at(hi0, hi1, tc(hi0), tc(hi1))
            run = math.hypot(upper[0] - lower[0], upper[1] - lower[1])
            rise = upper[2] - lower[2]
            anchor = lambda p: {"position": [r3(p[0]), r3(p[1]), r3(p[2])], "dir": [round(u[0], 4) + 0.0, round(u[1], 4) + 0.0], "width_m": r3(t1 - t0)}
            out.append({
                "id": f"{bank_id}_l{k + 1}",
                "bank": bank_id,
                "scope": bank["scope"],
                "width_m": r3(t1 - t0),
                "rise_m": r3(rise),
                "run_m": r3(run),
                "slope_deg": round(math.degrees(math.atan2(rise, run)), 1),
                "lower": anchor(lower),
                "upper": anchor(upper),
            })
    return out, {"banks": len({o["bank"] for o in out}), "lanes": len(out), "skipped_banks": skipped}


# ---- driver -----------------------------------------------------------------------------------------------

def build(data, input_sha256):
    if data.get("schema") != EXTRACT_SCHEMA:
        raise ValueError(f"unsupported extract schema {data.get('schema')!r}")
    flights, stair_stats = build_stairs(data["installations"])
    lanes, esc_stats = build_escalators(data["installations"])
    return {
        "schema": SCHEMA,
        "source": {
            "id": "plateau-ubld-13116",
            "extract": "build/ubld_enu.json (pipeline/extract_plateau_ubld.py)",
            "extract_sha256": input_sha256,
            "gml": data["source"]["file"],
            "gml_sha256": data["source"]["sha256"],
            "license": "PLATEAU Site Policy 「３．著作権について」に拠る; modified: positions derived from survey triangles by GTEki",
            "attribution": "出典：国土交通省 Project PLATEAU（3D都市モデル）を加工して作成 Modified: reprojected to a local ENU frame; nosing and landing lines derived by GTEki.",
        },
        "frame": {"axes": "ENU metres: x east, y north, z TP height", "origin": data["frame"]["origin"], "rounding_m": 0.001,
                  "dir": "horizontal unit vector (east, north) of travel up the stair or escalator"},
        "counts": {"stair_flights": len(flights), "stair_nosings": stair_stats["steps"], "unresolved_nosings": stair_stats["unresolved_steps"],
                   "escalator_banks": esc_stats["banks"], "escalator_lanes": esc_stats["lanes"], "escalator_landings": esc_stats["lanes"] * 2,
                   "skipped_escalator_banks": esc_stats["skipped_banks"]},
        "stair_flights": flights,
        "escalator_lanes": lanes,
    }


def dumps(obj):
    """Indented JSON with every all-number array (positions, nosing rows) on one line."""
    text = json.dumps(obj, ensure_ascii=False, indent=1)
    return re.sub(r"\[\s*(-?\d[^\[\]{}\"]*?)\s*\]", lambda m: "[" + re.sub(r"\s+", " ", m.group(1)) + "]", text) + "\n"


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
    dst = args[1] if len(args) > 1 else os.path.join(ROOT, "scene", "dressing_anchors.json")
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
