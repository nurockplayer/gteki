"""Fence free walking off surveyed links whose access is not established.

    python3 -I stations/ikebukuro/pipeline/build_access.py

The explorer lets a walker roam any surveyed floor, but the graph only vouches for
the routable coverage areas. Surveyed floor outside them can link two routable
places by a way the graph never verified, such as the JR-Tobu passage, which may
be a fare-paid transfer concourse (coverage gap `gap-tobu-jr-link`). Free walking
would present it as a public shortcut.

On the PLATEAU walkable grid (gridnav), every connected region of floor outside
the routable areas is tested. It is a *link* when going through it between two
of its mouths is more than SHORTCUT metres shorter than staying inside the
routable areas, or the routable areas do not connect those mouths at all. Its
mouths are put in groups, no two in a group being a shortcut apart. Next to each
group, a fence goes across the narrowest floor of the link: a minimum vertex cut
on the grid, with cells costing more the further they are from that group's
mouths. So every end of a link is closed, and what lies between stays visible
but out of reach. Dead ends stay explorable: they add no way through.
The build fails unless, with the fences in place, no link remains and no fence
comes near a verified edge. The fences are collision panels with an "access
unverified" label. They never change the graph, the gridnav or the rendered
station.
Output: stations/ikebukuro/scene/access_fences.json (ENU, metres).
"""
import heapq
import json
import math
import os
import struct
import sys
from collections import deque

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_station import ENU, SRC, _in_poly, wall_segments, write_json  # noqa: E402
from floorquery import Surfaces  # noqa: E402
from gridnav import Grid, _cross, _seg_dist  # noqa: E402

SHORTCUT = 20.0     # m a region must save before it counts as a link
FALLOFF = 10.0      # m: a cut cell this far from its group's mouths costs twice as much
STRAIGHT = 0.6      # m: a fence piece bends into two pieces past this deviation
EXTEND = 0.6        # m past the last cut cell where no wall is in REACH
REACH = 3.0         # m: a fence end is carried on to a wall, floor edge or routable area this close
WALL_OVERLAP = 0.15  # m into the wall or past the floor edge
JOIN = 0.3          # m of overlap where a bent fence turns
GAP_BRIDGE = 3.0    # m: cut cells this close are one fence
ROUTE_CLEAR = 0.75  # m: no fence this close to a verified edge
HEIGHT = 2.2        # m of fence above the highest floor it spans
SAMPLE = 0.25


def glb_collider_segments(path):
    """Vertical collider faces (wall, barriers, transport) of the station GLB as 2D segments with a z
    band: the faces the explorer's walker actually stops at. Renderer frame (x, z, -y) -> ENU."""
    b = open(path, "rb").read()
    n = struct.unpack("<I", b[12:16])[0]
    j = json.loads(b[20:20 + n])
    blob = b[20 + n + 8:]

    def acc(i):
        a = j["accessors"][i]
        v = j["bufferViews"][a["bufferView"]]
        fmt = {5126: "f", 5125: "I", 5123: "H"}[a["componentType"]]
        k = {"SCALAR": 1, "VEC3": 3}[a["type"]]
        return list(struct.iter_unpack("<" + fmt * k, blob[v.get("byteOffset", 0) + a.get("byteOffset", 0):][:a["count"] * k * struct.calcsize(fmt)]))
    out = []
    for node in j["nodes"]:
        if "mesh" not in node:
            continue
        mesh = j["meshes"][node["mesh"]]
        if ((node.get("extras") or {}).get("gteki_role") or mesh["name"]) not in ("wall", "barriers", "transport"):
            continue
        for prim in mesh["primitives"]:
            P = [(x, -z, y) for x, y, z in acc(prim["attributes"]["POSITION"])]
            I = [i[0] for i in acc(prim["indices"])]
            for t in range(0, len(I), 3):
                tri = [P[I[t]], P[I[t + 1]], P[I[t + 2]]]
                zs = [q[2] for q in tri]
                if max(zs) - min(zs) < 0.3:
                    continue
                p, q = max(((p, q) for p in tri for q in tri), key=lambda pq: math.dist(pq[0][:2], pq[1][:2]))
                if math.dist(p[:2], q[:2]) > 0.02:
                    out.append((p[0], p[1], q[0], q[1], min(zs), max(zs)))
    return out


def main():
    src = json.load(open(SRC))
    station = json.load(open(os.path.join(ROOT, "gteki", "station.json")))
    graph = json.load(open(os.path.join(ROOT, "gteki", "graph.json")))
    segs, sgrid = wall_segments(ENU)
    grid = Grid(Surfaces(ENU), segs, sgrid, tuple(src["gridBBox"]))
    polys = [a["polygon"] for a in station["coverage"]["areas"] if a["status"] == "routable" and a.get("polygon")]
    walls = segs + glb_collider_segments(os.path.join(ROOT, "gteki", "assets", "ikebukuro_b1.glb"))
    wall_cells = {}
    for k, (x1, y1, x2, y2, _, _) in enumerate(walls):
        for gx in range(int(math.floor(min(x1, x2))), int(math.floor(max(x1, x2))) + 1):
            for gy in range(int(math.floor(min(y1, y2))), int(math.floor(max(y1, y2))) + 1):
                wall_cells.setdefault((gx, gy), []).append(k)

    def walls_near(x, y, r=1):
        gx, gy = int(math.floor(x)), int(math.floor(y))
        return {k for a in range(-r, r + 1) for b in range(-r, r + 1) for k in wall_cells.get((gx + a, gy + b), [])}

    nodes = [(i, j, lv) for (i, j), hs in grid.cells.items() for lv in range(len(hs))]
    adj = {n: [(m, w) for m, w, _ in grid._neighbours(n)] for n in nodes}
    in_r = {n: any(_in_poly(*grid.xy(n[0], n[1]), p) for p in polys) for n in nodes}
    xy = lambda n: grid.xy(n[0], n[1])  # noqa: E731
    zof = lambda n: grid.cells[(n[0], n[1])][n[2]][0]  # noqa: E731

    def dijkstra(starts, ok, moves):
        d = {s: 0.0 for s in starts}
        pq = [(0.0, s) for s in starts]
        while pq:
            du, u = heapq.heappop(pq)
            if du > d[u]:
                continue
            for v, w in moves(u):
                if ok(v) and du + w < d.get(v, math.inf):
                    d[v] = du + w
                    heapq.heappush(pq, (d[v], v))
        return d

    def find_links(moves, usable):
        """Regions of usable floor outside the routable areas with a shortcut between two of their mouths."""
        comp, links = set(), []
        for n in nodes:
            if in_r[n] or n in comp or not usable(n):
                continue
            stack, members = [n], []
            comp.add(n)
            while stack:
                u = stack.pop()
                members.append(u)
                for v, _ in moves(u):
                    if not in_r[v] and v not in comp:
                        comp.add(v)
                        stack.append(v)
            mouth = [u for u in members if any(in_r[v] for v, _ in moves(u))]
            clusters, left = [], set(mouth)
            while left:  # mouth cells within 1.5 m form one mouth
                seed = left.pop()
                cl, queue = [seed], [seed]
                while queue:
                    u = queue.pop()
                    for w in [w for w in left if abs(w[0] - u[0]) <= 3 and abs(w[1] - u[1]) <= 3]:
                        left.remove(w)
                        cl.append(w)
                        queue.append(w)
                clusters.append(cl)
            if len(clusters) < 2:
                continue
            inside = set(members)
            contacts = [sorted({v for u in cl for v, _ in moves(u) if in_r[v]}) for cl in clusters]
            short = set()
            best = None
            for a in range(len(clusters)):
                via_u = dijkstra(clusters[a], lambda v: v in inside, moves)
                via_r = dijkstra(contacts[a], lambda v: in_r[v], moves)
                for b in range(a + 1, len(clusters)):
                    du = min(via_u.get(x, math.inf) for x in clusters[b])
                    dr = min(via_r.get(x, math.inf) for x in contacts[b])
                    if dr - du > SHORTCUT:
                        short.add((a, b))
                        if best is None or dr - du > best[0]:
                            best = (dr - du, du, dr, xy(clusters[a][0]), xy(clusters[b][0]))
            if best is None:
                continue
            groups = []  # no two mouths in one group are a shortcut apart
            for k in range(len(clusters)):
                g = next((g for g in groups if all((min(k, h), max(k, h)) not in short for h in g)), None)
                if g is None:
                    groups.append([k])
                else:
                    g.append(k)
            links.append({"members": inside, "groups": [[c for k in g for c in clusters[k]] for g in groups], "best": best})
        return links

    def plain(u):
        return adj[u]

    links = find_links(plain, lambda n: True)

    def min_cut(members, sources, sinks, cost):
        """Minimum vertex cut between two cell sets inside `members` (Dinic on split nodes)."""
        idx = {n: k for k, n in enumerate(members)}
        N = 2 * len(members) + 2
        S, T = N - 2, N - 1
        head, to, cap, nxt = [-1] * N, [], [], []

        def arc(a, b, c):
            for x, y, cc in ((a, b, c), (b, a, 0.0)):
                to.append(y)
                cap.append(cc)
                nxt.append(head[x])
                head[x] = len(to) - 1
        for n, k in idx.items():
            arc(2 * k, 2 * k + 1, cost(n))
            for v, _ in adj[n]:
                if v in idx:
                    arc(2 * k + 1, 2 * idx[v], math.inf)
        for n in sources:
            arc(S, 2 * idx[n], math.inf)
        for n in sinks:
            arc(2 * idx[n] + 1, T, math.inf)
        while True:
            level = [-1] * N
            level[S] = 0
            q = deque([S])
            while q:
                x = q.popleft()
                e = head[x]
                while e != -1:
                    if cap[e] > 1e-9 and level[to[e]] < 0:
                        level[to[e]] = level[x] + 1
                        q.append(to[e])
                    e = nxt[e]
            if level[T] < 0:
                break
            it = head[:]
            while True:  # augment along one level-graph path at a time
                path, x = [], S
                while x != T:
                    e = it[x]
                    while e != -1 and not (cap[e] > 1e-9 and level[to[e]] == level[x] + 1):
                        e = nxt[e]
                    it[x] = e
                    if e != -1:
                        path.append(e)
                        x = to[e]
                    elif path:  # dead end: retreat
                        level[x] = -1
                        x = to[path.pop() ^ 1]
                    else:
                        break
                if x != T:
                    break
                f = min(cap[e] for e in path)
                for e in path:
                    cap[e] -= f
                    cap[e ^ 1] += f
        seen = {S}
        q = deque([S])
        while q:
            x = q.popleft()
            e = head[x]
            while e != -1:
                if cap[e] > 1e-9 and to[e] not in seen:
                    seen.add(to[e])
                    q.append(to[e])
                e = nxt[e]
        return [n for n, k in idx.items() if 2 * k in seen and 2 * k + 1 not in seen]

    def pieces(cells, bends=frozenset()):
        """Straight fence pieces through a chain of cut cells. An end on a `bends` cell meets the next piece."""
        pts = [xy(c) for c in cells]
        mx, my = sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
        sxx = sum((p[0] - mx) ** 2 for p in pts)
        syy = sum((p[1] - my) ** 2 for p in pts)
        sxy = sum((p[0] - mx) * (p[1] - my) for p in pts)
        ang = 0.5 * math.atan2(2 * sxy, sxx - syy)
        ux, uy = math.cos(ang), math.sin(ang)
        order = sorted(range(len(cells)), key=lambda k: (pts[k][0] - mx) * ux + (pts[k][1] - my) * uy)
        dev = [abs(-(pts[k][0] - mx) * uy + (pts[k][1] - my) * ux) for k in order]
        worst = max(range(len(order)), key=lambda k: dev[k])
        if dev[worst] > STRAIGHT and 0 < worst < len(order) - 1:
            bend = bends | {cells[order[worst]]}
            return pieces([cells[k] for k in order[:worst + 1]], bend) + pieces([cells[k] for k in order[worst:]], bend)
        zs = [zof(c) for c in cells]

        def to_wall(t, sign):
            """Carry a fence end on along its line to the first wall face, floor edge or routable area
            (cut cells keep clear of walls; a walker can't step where there is no floor)."""
            x0, y0 = mx + ux * t, my + uy * t
            for k in range(1, int(REACH / 0.05) + 1):
                x1, y1 = x0 + sign * ux * 0.05 * k, y0 + sign * uy * 0.05 * k
                if not any(min(zs) - 0.5 < z < max(zs) + 0.5 for z, _ in grid.surf.heights(x1, y1)):
                    return t + sign * (0.05 * k + WALL_OVERLAP)
                if any(_in_poly(x1, y1, p) for p in polys):
                    return t + sign * 0.05 * k  # verified floor: walking round this end is no shortcut
                for i in walls_near(x1, y1):
                    wx1, wy1, wx2, wy2, lo, hi = walls[i]
                    if hi > min(zs) + 0.4 and lo < max(zs) + 1.8 and _cross(x0, y0, x1, y1, wx1, wy1, wx2, wy2):
                        return t + sign * (0.05 * k + WALL_OVERLAP)
            return None
        t0 = (pts[order[0]][0] - mx) * ux + (pts[order[0]][1] - my) * uy
        t1 = (pts[order[-1]][0] - mx) * ux + (pts[order[-1]][1] - my) * uy
        w0 = t0 - JOIN if cells[order[0]] in bends else to_wall(t0, -1)
        w1 = t1 + JOIN if cells[order[-1]] in bends else to_wall(t1, 1)
        at = lambda t: [round(mx + ux * t, 2), round(my + uy * t, 2)]  # noqa: E731
        return [{"a": at(t0 if w0 is None else w0), "b": at(t1 if w1 is None else w1),
                 "z0": round(min(zs) - 0.05, 2), "z1": round(max(zs) + HEIGHT, 2),
                 "open": [k for k, w in (("a", w0), ("b", w1)) if w is None]}]

    fences = []
    for link in links:
        members = link["members"]
        for g, mouth in enumerate(link["groups"]):
            others = [c for h, m in enumerate(link["groups"]) if h != g for c in m]
            near = dijkstra(mouth, lambda v: v in members, plain)
            cut = set(min_cut(members, mouth, others, lambda n: 1.0 + (near.get(n, 1e3) / FALLOFF) ** 2))
            # Chains of cut cells. The grid keeps CLEAR from every wall face, so it is stricter than the
            # explorer's walker: a gap in a cut may still be walkable. Bridge gaps up to GAP_BRIDGE.
            while cut:
                seed = cut.pop()
                chain, queue = [seed], [seed]
                while queue:
                    u = queue.pop()
                    for w in [w for w in cut if math.dist(xy(w), xy(u)) <= GAP_BRIDGE]:
                        cut.remove(w)
                        chain.append(w)
                        queue.append(w)
                fences.extend(pieces(chain))

    # An end still open may run on into another fence (two cuts meeting in an L).
    problems, connectors = [], []
    for f in fences:
        for end in f.pop("open"):
            (x0, y0), (ox, oy) = (f["a"], f["b"]) if end == "a" else (f["b"], f["a"])
            L = math.dist((x0, y0), (ox, oy)) or 1.0
            ux, uy = (x0 - ox) / L, (y0 - oy) / L
            hit = next((0.05 * k for k in range(1, int(REACH / 0.05) + 1) for o in fences
                        if o is not f and o["z0"] < f["z1"] and f["z0"] < o["z1"]
                        and _cross(x0, y0, x0 + ux * 0.05 * k, y0 + uy * 0.05 * k, *o["a"], *o["b"])), None)
            if hit is not None:
                f[end] = [round(x0 + ux * (hit + JOIN), 2), round(y0 + uy * (hit + JOIN), 2)]
                continue
            # Off its line: a short connector to the nearest collider face or fence.
            cands = [(wx1, wy1, wx2, wy2) for wx1, wy1, wx2, wy2, lo, hi in (walls[i] for i in walls_near(x0, y0, 3))
                     if hi > f["z0"] + 0.45 and lo < f["z0"] + 1.8]
            cands += [(*o["a"], *o["b"]) for o in fences if o is not f and o["z0"] < f["z1"] and f["z0"] < o["z1"]]
            best = None
            for wx1, wy1, wx2, wy2 in cands:
                dx, dy = wx2 - wx1, wy2 - wy1
                tt = max(0.0, min(1.0, ((x0 - wx1) * dx + (y0 - wy1) * dy) / ((dx * dx + dy * dy) or 1)))
                px, py = wx1 + dx * tt, wy1 + dy * tt
                if best is None or math.dist((x0, y0), (px, py)) < best[0]:
                    best = (math.dist((x0, y0), (px, py)), px, py)
            if best is None or best[0] > REACH:
                problems.append(f"fence end at {[x0, y0]} meets no wall, floor edge, routable area or fence within {REACH} m")
                continue
            d, px, py = best
            cx, cy = (px - x0) / (d or 1), (py - y0) / (d or 1)
            connectors.append({"a": [x0, y0], "b": [round(px + cx * WALL_OVERLAP, 2), round(py + cy * WALL_OVERLAP, 2)],
                               "z0": f["z0"], "z1": f["z1"]})
    fences += connectors
    route = [(p, q) for e in graph["edges"] if e["verification"] == "verified" for p, q in zip(e["geometry"], e["geometry"][1:])]
    for f in fences:
        for p, q in route:
            n = max(1, math.ceil(math.dist((p["x"], p["y"]), (q["x"], q["y"])) / SAMPLE))
            for k in range(n + 1):
                x, y = p["x"] + (q["x"] - p["x"]) * k / n, p["y"] + (q["y"] - p["y"]) * k / n
                z = p["z"] + (q["z"] - p["z"]) * k / n
                if _seg_dist(x, y, *f["a"], *f["b"]) < ROUTE_CLEAR and f["z0"] - 0.5 < z < f["z1"]:
                    problems.append(f"fence {f['a']}-{f['b']} within {ROUTE_CLEAR} m of a verified edge at ({x:.1f}, {y:.1f})")
                    break

    # With the fences as walls, find the links again: there must be none. Grid points can sit exactly
    # on a fence line; those count as part of the fence, as touching it stops a walker.
    def on_fence(n):
        (x, y), z = xy(n), zof(n)
        return any(f["z0"] <= z + 1.0 <= f["z1"] and _seg_dist(x, y, *f["a"], *f["b"]) < 0.05 for f in fences)
    open_cell = {n: not on_fence(n) for n in nodes}

    def fenced_moves(u):
        (x, y), z = xy(u), zof(u)
        return [(v, w) for v, w in adj[u] if open_cell[v] and not any(
            f["z0"] <= z + 1.0 <= f["z1"] and _cross(x, y, *xy(v), *f["a"], *f["b"]) for f in fences)]
    for link in find_links(fenced_moves, lambda n: open_cell[n]):
        s, du, dr, pa, pb = link["best"]
        problems.append(f"still a link: {pa} -> {pb} saves {s:.0f} m")
    if problems:
        print("\n".join(problems[:20]))
        write_json(os.path.join(ROOT, "build", "access_fences.rejected.json"), fences, indent=1)
        print(f"FAIL: {len(problems)} problem(s); access_fences.json not written (candidates in build/access_fences.rejected.json)")
        sys.exit(1)

    # For the walker-level check (a replay of the explorer's movement rules): each link's mouths by group.
    os.makedirs(os.path.join(ROOT, "build"), exist_ok=True)
    write_json(os.path.join(ROOT, "build", "access_links.json"), {
        "routable": polys,
        "links": [{"groups": [[[*xy(c), zof(c)] for c in g] for g in link["groups"]]} for link in links],
    })
    out = os.path.join(ROOT, "scene", "access_fences.json")
    write_json(out, {
        "generatedFrom": "gteki/station.json routable coverage + PLATEAU walkable grid (pipeline/build_access.py)",
        "label": {"ja": "通行可否 未確認", "en": "Access unverified"},
        "links": [{"savesM": round(s, 1), "throughM": round(du, 1), "routableM": None if math.isinf(dr) else round(dr, 1),
                   "mouths": [[round(v, 1) for v in pa], [round(v, 1) for v in pb]]}
                  for s, du, dr, pa, pb in (link["best"] for link in links)],
        "fences": fences,
    }, indent=1)
    print(f"{len(links)} link(s), {len(fences)} fence(s), {sum(math.dist(f['a'], f['b']) for f in fences):.0f} m -> {out}")


if __name__ == "__main__":
    main()
