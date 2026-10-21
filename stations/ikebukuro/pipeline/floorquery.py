"""Point queries against PLATEAU walking surfaces (FloorSurface + EF_35 stairs/ramps).

Used to derive node heights and to check that authored edges stay on real
floor geometry. Stdlib only.
"""
import json
import math

CELL = 4.0  # grid index cell size, metres


def _plane(ring):
    """Newell normal + point; returns (nx, ny, nz, d) with n·p = d."""
    nx = ny = nz = 0.0
    for i, a in enumerate(ring):
        b = ring[(i + 1) % len(ring)]
        nx += (a[1] - b[1]) * (a[2] + b[2])
        ny += (a[2] - b[2]) * (a[0] + b[0])
        nz += (a[0] - b[0]) * (a[1] + b[1])
    cx = sum(p[0] for p in ring) / len(ring)
    cy = sum(p[1] for p in ring) / len(ring)
    cz = sum(p[2] for p in ring) / len(ring)
    return nx, ny, nz, nx * cx + ny * cy + nz * cz


def _inside(x, y, ring):
    c = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            c = not c
        j = i
    return c


class Surfaces:
    def __init__(self, enu_json_path):
        d = json.load(open(enu_json_path))
        self.polys = []  # (kind, outer, holes, plane, bbox)
        for r in d["rooms"]:
            for s in r["surfaces"]:
                if s["type"] == "FloorSurface":
                    for p in s["polygons"]:
                        self._add("floor", p)
        for i in d["installations"]:
            if i["function"] == "EF_35" and i["scope"] != "building":
                for p in i["polygons"]:
                    self._add("stairs", p)
        self.grid = {}
        for idx, (_, outer, _, _, bb) in enumerate(self.polys):
            for gx in range(int(math.floor(bb[0] / CELL)), int(math.floor(bb[1] / CELL)) + 1):
                for gy in range(int(math.floor(bb[2] / CELL)), int(math.floor(bb[3] / CELL)) + 1):
                    self.grid.setdefault((gx, gy), []).append(idx)

    def _add(self, kind, p):
        outer = p["outer"]
        if len(outer) < 3:
            return
        pl = _plane(outer)
        # Only near-horizontal-ish faces carry walking height (stair risers are vertical).
        n = math.sqrt(pl[0] ** 2 + pl[1] ** 2 + pl[2] ** 2) or 1.0
        if abs(pl[2]) / n < 0.5:
            return
        xs = [q[0] for q in outer]
        ys = [q[1] for q in outer]
        self.polys.append((kind, outer, p["holes"], pl, (min(xs), max(xs), min(ys), max(ys))))

    def heights(self, x, y):
        """All (z, kind) walking surfaces above/below point (x, y), lowest first."""
        out = []
        for idx in self.grid.get((int(math.floor(x / CELL)), int(math.floor(y / CELL))), []):
            kind, outer, holes, (nx, ny, nz, d), bb = self.polys[idx]
            if not (bb[0] <= x <= bb[1] and bb[2] <= y <= bb[3]):
                continue
            if not _inside(x, y, outer) or any(_inside(x, y, h) for h in holes):
                continue
            out.append((round((d - nx * x - ny * y) / nz, 3), kind))
        return sorted(set(out))

    def height_near(self, x, y, z_hint, tol=1.2):
        """Walking height at (x, y) closest to z_hint within tol, else None."""
        best = None
        for z, kind in self.heights(x, y):
            if abs(z - z_hint) <= tol and (best is None or abs(z - z_hint) < abs(best[0] - z_hint)):
                best = (z, kind)
        return best
