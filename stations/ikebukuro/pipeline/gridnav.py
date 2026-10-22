"""Walkable grid over PLATEAU surfaces, used to derive edge polylines.

A cell is a (i, j, level) sample of a FloorSurface / EF_35 tread at 0.5 m
spacing with at least CLEAR metres to any wall/barrier face in the body
height band. Neighbouring cells connect when the height step is plausible
for walking (or for stairs on EF_35 cells) and the move does not cross a wall.
A* over this grid yields polylines that lie on surveyed floor by construction.
Stdlib only.
"""
import heapq
import math

RES = 0.5
CLEAR = 0.35
WALK_STEP = 0.12   # max height change per 0.5 m on floor (ramps up to ~1:4)
STAIR_STEP = 0.45  # per 0.5 m on stairs
RISER = 0.22       # a single step modelled as two floor levels (landings); stairs edges only
# Lower edge of the body band (m above the feet) for a floor-edge wall piece (build_station.floor_edges), instead
# of 0.4: such a piece only drops out when its top is within 0.5 m above the feet, i.e. at the head of the stairs
# whose floor it edges. 0.5 m is the explorer bodyBlock's lowest ray (BODY_HEIGHTS), so a top below it is a step
# the body passes over. Lower down the same wall is an ordinary collider.
FLOOR_EDGE_BAND = 0.5


def _seg_dist(px, py, x1, y1, x2, y2):
    dx, dy = x2 - x1, y2 - y1
    L = dx * dx + dy * dy
    t = 0.0 if L == 0 else max(0.0, min(1.0, ((px - x1) * dx + (py - y1) * dy) / L))
    return math.hypot(px - x1 - t * dx, py - y1 - t * dy)


def _cross(ax, ay, bx, by, cx, cy, dx, dy):
    def o(px, py, qx, qy, rx, ry):
        return (qx - px) * (ry - py) - (qy - py) * (rx - px)
    return (o(ax, ay, bx, by, cx, cy) > 0) != (o(ax, ay, bx, by, dx, dy) > 0) and \
        (o(cx, cy, dx, dy, ax, ay) > 0) != (o(cx, cy, dx, dy, bx, by) > 0)


def _seg_seg_dist(ax, ay, bx, by, cx, cy, dx, dy):
    """Shortest 2D distance between segments a-b and c-d (0 when they cross)."""
    if _cross(ax, ay, bx, by, cx, cy, dx, dy):
        return 0.0
    return min(_seg_dist(ax, ay, cx, cy, dx, dy), _seg_dist(bx, by, cx, cy, dx, dy),
               _seg_dist(cx, cy, ax, ay, bx, by), _seg_dist(dx, dy, ax, ay, bx, by))


class Grid:
    def __init__(self, surf, segs, sgrid, bbox, floor_edge=frozenset()):
        # floor_edge: indices of wall pieces whose top is a walking surface's edge (build_station.floor_edges);
        # everywhere the grid tests the body band, their band starts FLOOR_EDGE_BAND above the feet, not 0.4 m
        self.surf, self.segs, self.sgrid, self.floor_edge = surf, segs, sgrid, floor_edge
        x0, x1, y0, y1 = bbox
        self.x0, self.y0 = x0, y0
        self.cells = {}  # (i, j) -> [(z, kind)]
        for i in range(int((x1 - x0) / RES) + 1):
            for j in range(int((y1 - y0) / RES) + 1):
                x, y = x0 + i * RES, y0 + j * RES
                all_h = surf.heights(x, y)
                # Headroom: no other walking surface 0.25-2.1 m overhead (e.g. floor under a stair flight).
                hs = [(z, k) for z, k in all_h
                      if not any(0.25 < oz - z < 2.1 for oz, _ in all_h) and self._clear(x, y, z)]
                if hs:
                    self.cells[(i, j)] = hs

    def _near_segs(self, x, y):
        out = set()
        gx, gy = int(math.floor(x / 4)), int(math.floor(y / 4))
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                out.update(self.sgrid.get((gx + a, gy + b), []))
        return out

    def _clear(self, x, y, z):
        for k in self._near_segs(x, y):
            x1, y1, x2, y2, smin, smax = self.segs[k]
            if smax < z + self.band_lo(k) or smin > z + 1.8:
                continue
            if _seg_dist(x, y, x1, y1, x2, y2) < CLEAR:
                return False
        return True

    def band_lo(self, k):
        """Lower edge of the body band (m above the feet) for wall piece k."""
        return FLOOR_EDGE_BAND if k in self.floor_edge else 0.4

    def xy(self, i, j):
        return self.x0 + i * RES, self.y0 + j * RES

    def nearest(self, x, y, z, max_r=3.0):
        """Closest cell (i, j, level) to a point, preferring matching height."""
        ci, cj = round((x - self.x0) / RES), round((y - self.y0) / RES)
        best = None
        r = int(max_r / RES)
        for i in range(ci - r, ci + r + 1):
            for j in range(cj - r, cj + r + 1):
                for lv, (cz, _) in enumerate(self.cells.get((i, j), [])):
                    if abs(cz - z) > 1.0:
                        continue
                    cx, cy = self.xy(i, j)
                    d = math.hypot(cx - x, cy - y) + 2 * abs(cz - z)
                    if best is None or d < best[0]:
                        best = (d, (i, j, lv))
        return None if best is None else best[1]

    def _neighbours(self, node):
        i, j, lv = node
        z, kind = self.cells[(i, j)][lv]
        x, y = self.xy(i, j)
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                if di == 0 and dj == 0:
                    continue
                c = self.cells.get((i + di, j + dj))
                if not c:
                    continue
                nx, ny = self.xy(i + di, j + dj)
                h = math.hypot(nx - x, ny - y)
                for nlv, (nz, nkind) in enumerate(c):
                    lim = (STAIR_STEP if "stairs" in (kind, nkind) else WALK_STEP) * h / RES
                    step = abs(nz - z)
                    if step > lim and not (step <= RISER and kind == nkind == "floor"):
                        continue
                    if self._blocked(x, y, nx, ny, min(z, nz)):
                        continue
                    # both cells are CLEAR of every face, but a diagonal move can still cut past a corner
                    if self.clearance(x, y, nx, ny, (z + nz) / 2) < CLEAR:
                        continue
                    yield (i + di, j + dj, nlv), math.sqrt(h * h + (nz - z) ** 2), "riser" if step > lim else nkind

    def clearance(self, x, y, nx, ny, z):
        """Least plan distance from the short segment (x, y)-(nx, ny), feet at z, to any face in the body band
        (0.4-1.8 m above z, the band the wall-crossing checks use), capped at 4 m (the index reach)."""
        best = 4.0
        for k in self._near_segs(x, y) | self._near_segs(nx, ny):
            x1, y1, x2, y2, smin, smax = self.segs[k]
            if smax < z + self.band_lo(k) or smin > z + 1.8:
                continue
            best = min(best, _seg_seg_dist(x, y, nx, ny, x1, y1, x2, y2))
        return best

    def _blocked(self, x, y, nx, ny, z):
        for k in self._near_segs(x, y):
            x1, y1, x2, y2, smin, smax = self.segs[k]
            if smax < z + self.band_lo(k) or smin > z + 1.8:
                continue
            if _cross(x, y, nx, ny, x1, y1, x2, y2):
                return True
        return False

    def astar(self, a, b, allow_stairs=True, max_ratio=1.8):
        ax, ay = self.xy(a[0], a[1])
        bx, by = self.xy(b[0], b[1])
        straight = math.hypot(bx - ax, by - ay)
        openq = [(0.0, 0.0, a)]
        g = {a: 0.0}
        prev = {}
        stairs_used = False
        while openq:
            _, gc, cur = heapq.heappop(openq)
            if cur == b:
                break
            if gc > g.get(cur, 1e18):
                continue
            if gc > straight * max_ratio + 20:
                continue
            for nb, cost, nkind in self._neighbours(cur):
                if nkind in ("stairs", "riser") and not allow_stairs:
                    continue
                ng = gc + cost
                if ng < g.get(nb, 1e18):
                    g[nb] = ng
                    prev[nb] = cur
                    nx, ny = self.xy(nb[0], nb[1])
                    heapq.heappush(openq, (ng + math.hypot(bx - nx, by - ny), ng, nb))
        if b not in g:
            return None
        path = [b]
        while path[-1] != a:
            path.append(prev[path[-1]])
        path.reverse()
        pts = []
        for i, j, lv in path:
            z, kind = self.cells[(i, j)][lv]
            stairs_used |= kind == "stairs"
            x, y = self.xy(i, j)
            if pts and abs(z - pts[-1][2]) > WALK_STEP * math.hypot(x - pts[-1][0], y - pts[-1][1]) / RES:
                stairs_used = True  # a riser between landings
            pts.append((x, y, z))
        return {"points": pts, "length": g[b], "stairs": stairs_used,
                "ratio": g[b] / straight if straight > 0 else 1.0}

    def simplify(self, pts, max_z_err=0.08):
        """Keep the polyline on walkable cells while dropping redundant vertices:
        a shortcut is accepted only if every 0.25 m sample hits a cell at the
        interpolated height and no wall is crossed."""
        out = [pts[0]]
        k = 0
        while k < len(pts) - 1:
            best = k + 1
            for m in range(len(pts) - 1, k + 1, -1):
                if self._line_ok(pts[k], pts[m], max_z_err):
                    best = m
                    break
            out.append(pts[best])
            k = best
        return out

    def _line_ok(self, p, q, max_z_err):
        d = math.hypot(q[0] - p[0], q[1] - p[1])
        n = max(1, math.ceil(d / 0.25))  # spacing never exceeds 0.25 m
        hz = []
        for s in range(n + 1):
            t = s / n
            x, y, z = p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t
            hit = self.surf.height_near(x, y, z, 0.6)
            if hit is None or abs(hit[0] - z) > max(max_z_err, 0.5 if hit[1] == "stairs" else 0):
                return False
            hz.append(hit[0])
        # Check walls at the walking height along the line, in short pieces: no crossing, and CLEAR over the
        # whole piece (not only at its ends, which let a wall corner come to ~0.33 m between samples).
        for s in range(n):
            t0, t1 = s / n, (s + 1) / n
            ax, ay = p[0] + (q[0] - p[0]) * t0, p[1] + (q[1] - p[1]) * t0
            bx, by = p[0] + (q[0] - p[0]) * t1, p[1] + (q[1] - p[1]) * t1
            if self._blocked(ax, ay, bx, by, p[2] + (q[2] - p[2]) * t0):
                return False
            if self.clearance(ax, ay, bx, by, (hz[s] + hz[s + 1]) / 2) < CLEAR:
                return False
        return True
