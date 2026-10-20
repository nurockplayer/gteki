"""Bridge hairline cracks between adjacent PLATEAU walking surfaces.

    python3 -I stations/ikebukuro/pipeline/build_walkfix.py

The LOD4 floor and stair-tread polygons are triangulated independently, so
neighbouring polygons often meet along near-coincident but unshared edges,
leaving slivers 0.02-0.3 m wide. A downward ground ray that lands in such a
sliver finds no floor and the walker cannot step across. For each pair of
boundary edges from different walking polygons that are nearly parallel,
overlap along their length, sit at the same height (within DZ) and are less
than GAP apart, emit one thin quad spanning the gap. The quads are added to
the scene's walkable set (strips that would cover a surface at another height
are dropped: that gap is a step, not a crack) as an invisible mesh; they never change the graph,
the gridnav or the rendered geometry.
Output: stations/ikebukuro/scene/walk_bridges.json (ENU, metres).
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from floorquery import Surfaces  # noqa: E402
from build_station import write_json  # noqa: E402

GAP = 0.30        # widest crack bridged, metres
MIN_GAP = 0.005   # closer than this the edges already meet
MAX_ANGLE = math.radians(12)
MIN_OVERLAP = 0.15
DZ = 0.06         # same walking level
PAD = 0.03        # quad overlaps each surface by this much
CELL = 1.0


def _key(p):
    return (round(p[0], 3), round(p[1], 3), round(p[2], 3))


def edges(polys):
    """Boundary edges only: an edge shared by two polygons is interior to a surface."""
    rings = []
    seen = set()
    for pi, (_, outer, holes, _, _) in enumerate(polys):
        # The same tread/floor triangle is often repeated in several rooms.
        key = tuple(sorted(_key(q) for q in outer))
        if key in seen:
            continue
        seen.add(key)
        for ring in [outer] + list(holes):
            rings.append((pi, ring))
    count = {}
    for _, ring in rings:
        for i in range(len(ring)):
            k = frozenset((_key(ring[i]), _key(ring[(i + 1) % len(ring)])))
            count[k] = count.get(k, 0) + 1
    out = []
    for pi, ring in rings:
        n = len(ring)
        for i in range(n):
            a, b = ring[i], ring[(i + 1) % n]
            if count[frozenset((_key(a), _key(b)))] > 1:
                continue
            L = math.hypot(b[0] - a[0], b[1] - a[1])
            if L >= MIN_OVERLAP:
                out.append((pi, a, b, L))
    return out


def bridges(polys):
    es = edges(polys)
    grid = {}
    for k, (_, a, b, _) in enumerate(es):
        for gx in range(int(math.floor(min(a[0], b[0]) / CELL)), int(math.floor(max(a[0], b[0]) / CELL)) + 1):
            for gy in range(int(math.floor(min(a[1], b[1]) / CELL)), int(math.floor(max(a[1], b[1]) / CELL)) + 1):
                grid.setdefault((gx, gy), set()).add(k)
    seen = set()
    quads = []
    for cell, ks in grid.items():
        ks = sorted(ks)
        for ii, i in enumerate(ks):
            for j in ks[ii + 1:]:
                if (i, j) in seen:
                    continue
                seen.add((i, j))
                q = bridge(es[i], es[j])
                if q:
                    quads.append(q)
    return sorted({tuple(tuple(p) for p in q) for q in quads})


def bridge(e1, e2):
    p1, a, b, L = e1
    p2, c, d, M = e2
    if p1 == p2:
        return None
    ux, uy = (b[0] - a[0]) / L, (b[1] - a[1]) / L
    vx, vy = (d[0] - c[0]) / M, (d[1] - c[1]) / M
    if abs(ux * vy - uy * vx) > math.sin(MAX_ANGLE):
        return None
    # Project c, d onto a->b; overlap interval in a->b's parameter.
    tc = (c[0] - a[0]) * ux + (c[1] - a[1]) * uy
    td = (d[0] - a[0]) * ux + (d[1] - a[1]) * uy
    t0, t1 = max(0.0, min(tc, td)), min(L, max(tc, td))
    if t1 - t0 < MIN_OVERLAP:
        return None
    nx, ny = -uy, ux
    za = lambda t: a[2] + (b[2] - a[2]) * t / L
    # Point on c->d at the foot of a->b's parameter t (lines are near-parallel).
    def on_cd(t):
        px, py = a[0] + ux * t, a[1] + uy * t
        s = (px - c[0]) * vx + (py - c[1]) * vy
        s = max(0.0, min(M, s))
        return (c[0] + vx * s, c[1] + vy * s, c[2] + (d[2] - c[2]) * s / M)
    pts = []
    for t in (t0, t1):
        q = on_cd(t)
        px, py, pz = a[0] + ux * t, a[1] + uy * t, za(t)
        sep = (q[0] - px) * nx + (q[1] - py) * ny
        if not (MIN_GAP <= abs(sep) <= GAP) or abs(q[2] - pz) > DZ:
            return None
        pts.append(((px, py, pz), q, sep))
    # Extend each long side PAD past both surfaces so float slivers cannot remain.
    out = []
    for (px, py, pz), (qx, qy, qz), sep in pts:
        s = 1 if sep > 0 else -1
        out.append(((px - s * nx * PAD, py - s * ny * PAD, pz), (qx + s * nx * PAD, qy + s * ny * PAD, qz)))
    (A0, B0), (A1, B1) = out
    return [list(map(lambda v: round(v, 3), p)) for p in (A0, A1, B1, B0)]


def over_other_level(surf, q):
    """True when a walking surface at a different height lies under/over the strip: a step, not a crack."""
    A0, A1, B1, B0 = q
    bz = (A0[2] + A1[2] + B0[2] + B1[2]) / 4
    for t in (0.1, 0.3, 0.5, 0.7, 0.9):
        x = (A0[0] + B0[0]) / 2 * (1 - t) + (A1[0] + B1[0]) / 2 * t
        y = (A0[1] + B0[1]) / 2 * (1 - t) + (A1[1] + B1[1]) / 2 * t
        if any(DZ < abs(z - bz) < 1.0 for z, _ in surf.heights(x, y)):
            return True
    return False


def main():
    surf = Surfaces(os.path.join(ROOT, "build", "ubld_enu.json"))
    found = bridges(surf.polys)
    quads = [q for q in found if not over_other_level(surf, q)]
    print(f"dropped {len(found) - len(quads)} strips that span a step")
    write_json(os.path.join(ROOT, "scene", "walk_bridges.json"), {
        "schema": "gteki.ikebukuro.walk_bridges/1",
        "note": "Invisible walking strips over hairline cracks between adjacent PLATEAU floor/stair polygons (see pipeline/build_walkfix.py).",
        "frame": "station ENU, metres",
        "quads": quads,
    })
    print(f"walk_bridges: {len(quads)} quads")


if __name__ == "__main__":
    main()
