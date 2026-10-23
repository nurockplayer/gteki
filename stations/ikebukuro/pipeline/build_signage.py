"""Derive overhead wayfinding signs from the verified graph.

    python3 -I stations/ikebukuro/pipeline/build_signage.py

For each junction (degree >= 2 that is not an exit) and each incident verified
edge, list the routable POIs whose shortest path from that junction leaves
along that edge. One sign per (junction, edge) is placed a few metres along
the edge, facing back to the junction; its back face lists what lies ahead
through the junction. Signs therefore only ever state destinations that the
verified graph can actually route to.
Long verified edges (REPEAT_MIN_EDGE_M or more) also get repeater signs between the two end signs so
that no stretch of a passage goes more than REPEAT_SPACING_M without one (#108). A repeater is one
double-sided sign: its front faces walkers leaving the edge's `from` node and lists what lies ahead
toward `to`, its back is read walking the other way. Each exit / gate carries a distance counted down
along the graph's own edge lengths. Content is as factual as the end signs; positions are design.
Between the repeaters the same edge gets place boards (`kind: "place"`, #108): a blue board naming the
halls ahead and behind (the three B1 halls, whose names are the area names printed on the reference
map) with graph walking distances, so that a long passage alternates two visibly different kinds of
sign about every 12 m instead of repeating one.
Output: stations/ikebukuro/scene/signage.json (station-owned display data).
"""
import heapq
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from floorquery import CELL, Surfaces, _inside  # noqa: E402
from build_station import wall_segments, write_json  # noqa: E402
from sign_sightlines import Sightlines, placement_sign  # noqa: E402

CLEAR_BELOW_SIGN = 2.25  # m above walking surface
MIN_CLEAR = 2.0          # never lower than this; a low ceiling shrinks the panel instead
SIGN_H = 0.48            # the housing: a 0.42 m panel plus a 0.03 m frame top and bottom (scene/signs.ts)
MIN_SIGN_H = 0.23        # housing for a 0.2 m panel; smaller is unreadable: try elsewhere or omit it
FLUSH_GAP = 0.02         # under a low ceiling the panel is mounted flush
CEIL_GAP = 0.08
# Repeaters (#108). Each adds two atlas faces; lowering the spacing or the minimum edge length adds signs
# and grows the low-tier sign atlas (one 4096 x 2048 page with ~4 rows spare), so re-check
# scene/signage.test.ts's atlas budget if either is lowered.
REPEAT_MIN_EDGE_M = 100.0
REPEAT_SPACING_M = 24.0
REPEAT_MAX_EXITS = 3
REPEAT_MAX_GATES = 1
PLACE_MAX = 1  # halls named per face of a place board: the nearest one, so every board of a passage reads alike
# Areas a board may name: the three B1 halls (西口 / 西口（南） / 東口). Each POI's connector is the hall's own junction,
# so "~N m" is the walk to the hall. The passages (中央通路, 北通路, 南通路) are linear areas whose connector is an
# arbitrary junction inside them; a distance to it would misstate where the passage begins, so they are not named.
PLACE_IDS = {"west-exit-b1", "west-exit-south-b1", "east-exit-b1"}
PLACE_MIN_GAP_M = 6.0  # a place board stays at least this far (polyline m) from the neighbouring repeaters
DIST_STEP_M = 5.0


def name(p, lang):
    return next((t["text"] for t in p["names"] if t["lang"] == lang), None)


def exit_item(p):
    # Signs name the exit itself, as the real ones do, even where the route stops at the stair foot
    # (Exits 4 and 13, whose POI names say so).
    n = p["id"].split("-")[1]
    return {"id": p["id"], "label": n, "ja": f"{n}番出口", "en": f"Exit {n}"}


def gate_item(p):
    return {"id": p["id"], "ja": name(p, "ja"), "en": name(p, "en")}


def along(geom, d):
    """Point d metres along a polyline (clamped to its end)."""
    acc = 0.0
    for a, b in zip(geom, geom[1:]):
        seg = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
        if acc + seg >= d and seg > 0:
            t = (d - acc) / seg
            return a["x"] + (b["x"] - a["x"]) * t, a["y"] + (b["y"] - a["y"]) * t
        acc += seg
    return geom[-1]["x"], geom[-1]["y"]


def turn(hin, hout):
    """Arrow for leaving a junction along hout when arriving along hin (ENU, x east, y north)."""
    ang = math.degrees(math.atan2(hin[0] * hout[1] - hin[1] * hout[0], hin[0] * hout[0] + hin[1] * hout[1]))
    return "up" if abs(ang) <= 45 else ("left" if ang > 0 else "right")


ARROW_ORDER = {"left": 0, "up": 1, "right": 2}
SIDE_MARGIN = 0.15  # m between a sign's end and the nearest wall or column
MAX_SIGN_W = 6.0


def wall_hit(segs, sgrid, px, py, dx, dy, zlo, zhi, maxd=12.0):
    """Distance along (dx, dy) to the first wall face spanning any of the sign's height band."""
    best = maxd
    cells = set()
    for k in range(int(maxd / 2) + 2):
        cx, cy = px + dx * k * 2, py + dy * k * 2
        for a in (-1, 0, 1):
            for b in (-1, 0, 1):
                cells.add((int(math.floor(cx / 4)) + a, int(math.floor(cy / 4)) + b))
    for c in cells:
        for k in sgrid.get(c, []):
            x1, y1, x2, y2, smin, smax = segs[k]
            if smax < zlo or smin > zhi:
                continue
            ex, ey = x2 - x1, y2 - y1
            den = dx * ey - dy * ex
            if abs(den) < 1e-9:
                continue
            t = ((x1 - px) * ey - (y1 - py) * ex) / den
            u = ((x1 - px) * dy - (y1 - py) * dx) / den
            if 0 < t < best and 0 <= u <= 1:
                best = t
    return best


def lowest_ceiling(ceil, ax, ay, bx, by, above):
    """Lowest ceiling height over segment a-b (exact, not sampled), counting only heights > above."""
    best = None
    dx, dy = bx - ax, by - ay
    seen = set()
    for gx in range(int(math.floor(min(ax, bx) / CELL)), int(math.floor(max(ax, bx) / CELL)) + 1):
        for gy in range(int(math.floor(min(ay, by) / CELL)), int(math.floor(max(ay, by) / CELL)) + 1):
            for idx in ceil.grid.get((gx, gy), []):
                if idx in seen:
                    continue
                seen.add(idx)
                _, outer, holes, (nx, ny, nz, d), bb = ceil.polys[idx]
                if max(ax, bx) < bb[0] or min(ax, bx) > bb[1] or max(ay, by) < bb[2] or min(ay, by) > bb[3]:
                    continue
                # Split the segment where it crosses any ring edge; each piece is wholly in or out.
                ts = {0.0, 1.0}
                for ring in [outer] + list(holes):
                    for i in range(len(ring)):
                        (x1, y1), (x2, y2) = ring[i - 1][:2], ring[i][:2]
                        ex, ey = x2 - x1, y2 - y1
                        den = dx * ey - dy * ex
                        if abs(den) < 1e-12:
                            continue
                        t = ((x1 - ax) * ey - (y1 - ay) * ex) / den
                        u = ((x1 - ax) * dy - (y1 - ay) * dx) / den
                        if 0 <= t <= 1 and 0 <= u <= 1:
                            ts.add(t)
                ts = sorted(ts)
                pieces = list(zip(ts, ts[1:])) or [(0.0, 0.0)]
                for t0, t1 in pieces:
                    tm = (t0 + t1) / 2
                    mx, my = ax + dx * tm, ay + dy * tm
                    if not _inside(mx, my, outer) or any(_inside(mx, my, h) for h in holes):
                        continue
                    # A plane is linear along the segment, so its minimum is at an end. A slope that
                    # crosses `above` reaches down to it inside the piece.
                    z0, z1 = ((d - nx * (ax + dx * t) - ny * (ay + dy * t)) / nz for t in (t0, t1))
                    lo, hi = min(z0, z1), max(z0, z1)
                    if hi <= above:
                        continue
                    z = lo if lo > above else above
                    if best is None or z < best:
                        best = z
    return None if best is None else round(best, 3)


def place(geom, ceil, segs, sgrid, target_d):
    """Sign at target_d m along the edge: centred across the passage, under the ceiling."""
    acc = 0.0
    for a, b in zip(geom, geom[1:]):
        seg = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
        if acc + seg >= target_d and seg > 0:
            t = (target_d - acc) / seg
            px, py = a["x"] + (b["x"] - a["x"]) * t, a["y"] + (b["y"] - a["y"]) * t
            pz = a["z"] + (b["z"] - a["z"]) * t
            dirx, diry = (b["x"] - a["x"]) / seg, (b["y"] - a["y"]) / seg
            break
        acc += seg
    else:
        return None
    def ceiling_over(cx, cy, half):
        """Lowest ceiling over the panel span. Any ceiling above the floor counts, low ones and
        beams included: one at or under 2 m must shrink, move or omit the sign."""
        return lowest_ceiling(ceil, cx - rx * half, cy - ry * half, cx + rx * half, cy + ry * half, pz + 0.3)

    def fit(ceiling_z):
        bottom, sign_h = pz + CLEAR_BELOW_SIGN, SIGN_H
        if ceiling_z is not None and bottom + SIGN_H > ceiling_z - CEIL_GAP:
            bottom = max(pz + MIN_CLEAR, ceiling_z - CEIL_GAP - SIGN_H)
            sign_h = min(SIGN_H, ceiling_z - FLUSH_GAP - bottom)
            if sign_h < MIN_SIGN_H:
                return None
        return bottom, sign_h

    rx, ry = diry, -dirx  # right of the walking direction
    x0, y0 = px, py
    fitted = fit(ceiling_over(x0, y0, 0.0))
    if fitted is None:
        return None
    # Walls are found within the panel's height band, and the band depends on the ceiling over
    # the panel's final span. Walls are checked over every band tried so far, which only grows,
    # so the loop settles once the fitted band lies inside it. Centring starts from the edge point.
    zlo, zhi = fitted[0], fitted[0] + fitted[1]
    for _ in range(6):
        dr = wall_hit(segs, sgrid, x0, y0, rx, ry, zlo, zhi)
        dl = wall_hit(segs, sgrid, x0, y0, -rx, -ry, zlo, zhi)
        if dl + dr < 2 * MAX_SIGN_W:  # bounded passage: centre between its walls
            shift = (dr - dl) / 2
            half = (dl + dr) / 2
        else:  # open on one side: ease away from the near wall (<= 1.5 m), stay symmetric
            want = MAX_SIGN_W / 2 + SIDE_MARGIN
            if dl < dr:
                shift = min(1.5, max(0.0, want - dl))
            else:
                shift = -min(1.5, max(0.0, want - dr))
            half = min(dl + shift, dr - shift)
        px, py = x0 + rx * shift, y0 + ry * shift
        room_w = round(max(0.6, min(MAX_SIGN_W, 2 * half - 2 * SIDE_MARGIN)), 2)
        # The ceiling across the whole panel at its final position bounds it (beams beside the
        # centre); where a beam leaves no room, a narrower panel (content trimmed) beats no sign.
        for max_w in [room_w] + [w for w in (4.5, 3.0, 2.0, 1.2) if w < room_w]:
            ceiling_z = ceiling_over(px, py, max_w / 2)
            refit = fit(ceiling_z)
            if refit is not None:
                break
        else:
            return None
        bottom, sign_h = refit
        if zlo <= bottom and bottom + sign_h <= zhi:
            break
        zlo, zhi = min(zlo, bottom), max(zhi, bottom + sign_h)
    else:
        return None
    return px, py, bottom, dirx, diry, ceiling_z, max_w, round(sign_h / SIGN_H, 3)


def choose_place(geom, ceil, segs, sgrid, cands, sight=None, sides=("front", "back")):
    """First acceptable of the candidate offsets along geom, preferring full-size, wide panels.
    Returns (placement, offset) or (None, None)."""
    best, best_d = None, None
    for d in cands:
        r = place(geom, ceil, segs, sgrid, d)
        if r is None:
            continue
        if best is None or r[7] > best[7] + 0.05 or (r[7] >= best[7] - 0.05 and r[6] > best[6] + 0.5):
            best, best_d = r, d
        if best[6] >= 4.2 and best[7] == 1:
            break
    if best is not None and sight is not None:
        # Generated geometry may never initiate relocation. The rendered sleeve
        # bounds still constrain candidates when real PLATEAU structure blocks
        # the preferred position; sleeve-only conflicts require a margin ruling.
        hits = sight.blocked(geom, placement_sign(best), sides)
        if not any(h['role'] in {'wall', 'ceiling', 'barriers'} for h in hits):
            return best, best_d
        # Preserve the old preferred placement when clear; otherwise take the
        # nearest clear existing candidate. If all are blocked, retain it: the
        # final audit reports the sign and each obstructed painted face.
        for d in sorted(cands, key=lambda d: abs(d - best_d)):
            r = best if d == best_d else place(geom, ceil, segs, sgrid, d)
            if r is not None and not sight.blocked(geom, placement_sign(r), sides):
                return r, d
    return best, best_d


def step_dist(m):
    """Distance shown on a sign: rounded to DIST_STEP_M, never below one step."""
    return int(max(DIST_STEP_M, round(m / DIST_STEP_M) * DIST_STEP_M))


def uniq(pois, cap):
    seen, res = set(), []
    for p in pois:
        if p["id"] not in seen:
            seen.add(p["id"])
            res.append(p)
    return res[:cap]


def place_dists(adj, dest, start, banned_edge):
    """Graph distance from `start` to each nameable hall (PLACE_IDS) over verified edges, never
    using `banned_edge` (the passage being signed): {poi id: (distance, poi)}."""
    dist = {start: 0.0}
    pq = [(0.0, start)]
    while pq:
        d, u = heapq.heappop(pq)
        if d > dist[u]:
            continue
        for v, e, _ in adj.get(u, []):
            if e["id"] == banned_edge:
                continue
            if d + e["lengthM"] < dist.get(v, 1e18):
                dist[v] = d + e["lengthM"]
                heapq.heappush(pq, (dist[v], v))
    best = {}
    for node, d in dist.items():
        for p in dest.get(node, []):
            if p["id"] in PLACE_IDS and d < best.get(p["id"], (1e18, None))[0]:
                best[p["id"]] = (d, p)
    return best


def place_item(p, d):
    return {"id": p["id"], "ja": name(p, "ja"), "en": name(p, "en"), "distanceM": step_dist(d)}


def repeaters(graph, edges, ahead, offset, ceil, segs, sgrid, adj, dest, sight):
    """Repeater signs along long verified edges (see the module docstring), in edge-id order."""
    src = json.load(open(os.path.join(ROOT, "data", "graph.src.json")))
    fact_of = {(e["from"], e["to"]): e.get("access") for e in src["edges"]}
    out = []
    for eid in sorted(edges):
        e = edges[eid]
        if e["verification"] != "verified" or e["lengthM"] < REPEAT_MIN_EDGE_M:
            continue
        fwd, bwd = (eid, False), (eid, True)
        if fwd not in ahead or bwd not in ahead:
            continue
        geom = e["geometry"]
        total = sum(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a, b in zip(geom, geom[1:]))
        a_end = offset.get(fwd, 0.0)  # end signs; an end without one counts from the node itself
        b_end = total - offset.get(bwd, 0.0)
        gap = b_end - a_end
        n = math.ceil(gap / REPEAT_SPACING_M) - 1
        if n < 1:
            continue
        k_len = e["lengthM"] / total  # polyline metres -> graph metres
        f_exits, f_gates, f_dist = ahead[fwd]
        b_exits, b_gates, b_dist = ahead[bwd]
        f_exits, f_gates = uniq(f_exits, REPEAT_MAX_EXITS), uniq(f_gates, REPEAT_MAX_GATES)
        b_exits, b_gates = uniq(b_exits, REPEAT_MAX_EXITS), uniq(b_gates, REPEAT_MAX_GATES)

        def counted(exits, gates, dmap, at):
            return ([{**exit_item(p), "distanceM": step_dist(dmap[p["id"]] - at)} for p in exits],
                    [{**gate_item(p), "distanceM": step_dist(dmap[p["id"]] - at)} for p in gates])

        rep_pos = [a_end] + [a_end + gap * k / (n + 1) for k in range(1, n + 1)] + [b_end]
        for k in range(1, n + 1):
            want = a_end + gap * k / (n + 1)
            cands = [want] + [want + s * j for j in (1, 2, 3) for s in (1, -1)]
            cands = [c for c in cands if a_end + 2.0 <= c <= b_end - 2.0]
            best, pos = choose_place(geom, ceil, segs, sgrid, cands, sight)
            if best is None:
                print(f"warning: no repeater {eid} #{k}", file=sys.stderr)
                continue
            px, py, bottom, dirx, diry, ceiling_z, max_w, scale = best
            rep_pos[k] = pos
            fe, fg = counted(f_exits, f_gates, f_dist, pos * k_len)
            be, bg = counted(b_exits, b_gates, b_dist, (total - pos) * k_len)
            fact = fact_of.get((e["from"], e["to"]))
            basis = [f"graph:{eid}"] + [f"poi:{i}" for i in sorted({p["id"] for p in f_exits + f_gates + b_exits + b_gates})]
            if fact:
                basis.append(f"fact:{fact}")
            out.append({
                "id": f"sign-rep-{eid}-{k}",
                "kind": "repeat",
                "atNode": e["from"],
                "position": {"x": round(px, 3), "y": round(py, 3), "z": round(bottom + SIGN_H * scale / 2, 3)},
                "maxWidthM": max_w,
                "scale": scale,
                # toward the edge's `from` node: the front is read walking from -> to
                "facing": {"x": round(-dirx, 4), "y": round(-diry, 4)},
                "ceilingZ": ceiling_z,
                "exits": fe,
                "gates": fg,
                "arrow": "up",
                "back": [{"arrow": "up", "exits": be, "gates": bg}],
                "basis": basis,
            })
        # Place boards in the middle of each stretch between neighbouring signs (end sign, repeaters, end sign).
        ahead_places = place_dists(adj, dest, e["to"], eid)
        behind_places = place_dists(adj, dest, e["from"], eid)

        def near(table, at):
            items = sorted(((d + at, pid, p) for pid, (d, p) in table.items()), key=lambda t: (t[0], t[1]))
            return [place_item(p, d) for d, _, p in items[:PLACE_MAX]]

        for j in range(n + 1):
            lo, hi = rep_pos[j], rep_pos[j + 1]
            # Keep the original target; use the actual repeaters for the same
            # minimum spacing constraint after a repeater has moved.
            want = a_end + gap * (j + 0.5) / (n + 1)
            cands = [want] + [want + sg * q for q in (1, 2, 3) for sg in (1, -1)]
            cands = [c for c in cands if lo + PLACE_MIN_GAP_M <= c <= hi - PLACE_MIN_GAP_M]
            best, pos = choose_place(geom, ceil, segs, sgrid, cands, sight)
            if best is None:
                print(f"warning: no place board {eid} #{j + 1}", file=sys.stderr)
                continue
            px, py, bottom, dirx, diry, ceiling_z, max_w, scale = best
            fp = near(ahead_places, (total - pos) * k_len)
            bp = near(behind_places, pos * k_len)
            if not fp or not bp:
                continue
            fact = fact_of.get((e["from"], e["to"]))
            basis = [f"graph:{eid}"] + [f"poi:{i}" for i in sorted({q["id"] for q in fp + bp})]
            if fact:
                basis.append(f"fact:{fact}")
            out.append({
                "id": f"sign-place-{eid}-{j + 1}",
                "kind": "place",
                "atNode": e["from"],
                "position": {"x": round(px, 3), "y": round(py, 3), "z": round(bottom + SIGN_H * scale / 2, 3)},
                "maxWidthM": max_w,
                "scale": scale,
                "facing": {"x": round(-dirx, 4), "y": round(-diry, 4)},
                "ceilingZ": ceiling_z,
                "exits": [],
                "gates": [],
                "places": fp,
                "arrow": "up",
                "back": [{"arrow": "up", "exits": [], "gates": [], "places": bp}],
                "basis": basis,
            })
    return out


def main():
    graph = json.load(open(os.path.join(ROOT, "gteki", "graph.json")))
    pois = json.load(open(os.path.join(ROOT, "gteki", "pois.json")))["pois"]
    enu = json.load(open(os.path.join(ROOT, "build", "ubld_enu.json")))
    ceil = Surfaces.__new__(Surfaces)
    ceil.polys, ceil.grid = [], {}
    for r in enu["rooms"]:
        for s in r["surfaces"]:
            if s["type"] == "CeilingSurface":
                for p in s["polygons"]:
                    Surfaces._add(ceil, "ceiling", p)
    import math as _m
    from floorquery import CELL
    for idx, (_, _, _, _, bb) in enumerate(ceil.polys):
        for gx in range(int(_m.floor(bb[0] / CELL)), int(_m.floor(bb[1] / CELL)) + 1):
            for gy in range(int(_m.floor(bb[2] / CELL)), int(_m.floor(bb[3] / CELL)) + 1):
                ceil.grid.setdefault((gx, gy), []).append(idx)

    nodes = {n["id"]: n for n in graph["nodes"]}
    adj = {}
    for e in graph["edges"]:
        if e["verification"] != "verified":
            continue
        adj.setdefault(e["from"], []).append((e["to"], e, False))
        if e["direction"] == "both":
            adj.setdefault(e["to"], []).append((e["from"], e, True))
    dest = {}
    for p in pois:
        for c in p["connectorNodeIds"]:
            dest.setdefault(c, []).append(p)

    edges = {e["id"]: e for e in graph["edges"]}
    segs, sgrid = wall_segments(os.path.join(ROOT, "build", "ubld_enu.json"))
    # Generated LED housings yield to signs in blender_bake_lighting.py. Keep
    # the rendered column bounds for candidate clearance; audit bare PLATEAU
    # columns separately without changing the sleeve margin or sign positions.
    sight = Sightlines(include_fittings=False)

    def out_dir(nid, key):
        e = edges[key[0]]
        geom = e["geometry"][::-1] if key[1] else e["geometry"]
        x, y = along(geom, 5.0)
        n = nodes[nid]["position"]
        L = math.hypot(x - n["x"], y - n["y"]) or 1.0
        return (x - n["x"]) / L, (y - n["y"]) / L

    signs = []
    ahead = {}   # (edge id, rev) -> (exits, gates, {poi id: graph distance from the edge's start node})
    offset = {}  # (edge id, rev) -> metres along the edge (in that direction) where its end sign sits
    for nid, n in nodes.items():
        if n["kind"] == "exit" or len(adj.get(nid, [])) < 2:
            continue
        # Dijkstra from nid remembering the first edge taken
        dist = {nid: 0.0}
        first = {}
        pq = [(0.0, nid)]
        while pq:
            d, u = heapq.heappop(pq)
            if d > dist[u]:
                continue
            for v, e, rev in adj.get(u, []):
                nd = d + e["lengthM"]
                if nd < dist.get(v, 1e18):
                    dist[v] = nd
                    first[v] = first.get(u) if u != nid else (e["id"], rev)
                    heapq.heappush(pq, (nd, v))
        for v, e, rev in adj[nid]:
            key = (e["id"], rev)
            items = []
            for target, plist in dest.items():
                if target == nid or first.get(target) != key:
                    continue
                for p in plist:
                    items.append((dist[target], p))
            if not items:
                continue
            items.sort(key=lambda t: t[0])
            exits = [p for _, p in items if p["category"] == "exit"][:5]
            gates = [p for _, p in items if p["category"] == "ticket_gate"][:2]
            # Back face, read by people walking toward the junction: everything reached through it,
            # grouped by the turn they take there (left / straight on / right).
            back = sorted(((dist[t], t, p) for t, plist in dest.items() if t in dist and first.get(t) != key
                           for p in plist), key=lambda t: t[0])
            back_exits = [(t, p) for _, t, p in back if p["category"] == "exit"][:5]
            back_gates = [(t, p) for _, t, p in back if p["category"] == "ticket_gate"][:2]
            ox, oy = out_dir(nid, key)
            hin = (-ox, -oy)  # reader walks along this edge toward the junction
            arrow_of = {t: "up" if t == nid else turn(hin, out_dir(nid, first[t])) for t, _ in back_exits + back_gates}
            blocks = {}
            for t, p in back_exits:
                blocks.setdefault(arrow_of[t], {"arrow": arrow_of[t], "exits": [], "gates": []})["exits"].append(exit_item(p))
            for t, p in back_gates:
                blocks.setdefault(arrow_of[t], {"arrow": arrow_of[t], "exits": [], "gates": []})["gates"].append(gate_item(p))
            geom = e["geometry"][::-1] if rev else e["geometry"]
            total = sum(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a, b in zip(geom, geom[1:]))

            # ~4 m from the junction (45% of short edges); slide along the edge if a low ceiling, a
            # column or a narrowing leaves too little room there, preferring positions close to 4 m.
            base = min(4.0, total * 0.45)
            cands = [base] + [base + k for k in (1, -1, 2, -1.5, 3, 4, 5) if 1.5 <= base + k <= total * 0.6]
            sides = ("front", "back") if blocks else ("front",)
            best, best_d = choose_place(geom, ceil, segs, sgrid, cands, sight, sides)
            dist_map = {}
            for dd, p in items:
                dist_map[p["id"]] = min(dd, dist_map.get(p["id"], 1e18))
            ahead[key] = (exits, gates, dist_map)
            if best is None:
                continue
            offset[key] = best_d
            px, py, bottom, dirx, diry, ceiling_z, max_w, scale = best
            signs.append({
                "id": f"sign-{nid}-{e['id']}{'-r' if rev else ''}",
                "atNode": nid,
                "position": {"x": round(px, 3), "y": round(py, 3), "z": round(bottom + SIGN_H * scale / 2, 3)},
                "maxWidthM": max_w,
                "scale": scale,
                # unit vector the readable face points to (back toward the junction)
                "facing": {"x": round(-dirx, 4), "y": round(-diry, 4)},
                "ceilingZ": ceiling_z,
                "exits": [exit_item(p) for p in exits],
                "gates": [gate_item(p) for p in gates],
                "arrow": "up",
                "back": sorted(blocks.values(), key=lambda b: ARROW_ORDER[b["arrow"]]),
            })
    signs += repeaters(graph, edges, ahead, offset, ceil, segs, sgrid, adj, dest, sight)
    for sign in signs:
        # End signs carry no basis; their id still records their verified edge.
        eid = next((b[6:] for b in sign.get("basis", []) if b.startswith("graph:")), None)
        if eid is None:
            eid = next(eid for eid in edges if sign["id"].endswith(eid) or sign["id"].endswith(eid + "-r"))
        sides = ("front", "back") if sign["back"] else ("front",)
        hits = sight.blocked(edges[eid]["geometry"], sign, sides)
        for face in sides:
            blocked = [h for h in hits if h["face"] == face]
            if blocked:
                print(f"blocked: {sign['id']} {face}: {json.dumps(blocked[:3])}")
    out = os.path.join(ROOT, "scene", "signage.json")
    write_json(out, {"generatedFrom": "gteki/graph.json + gteki/pois.json (verified edges only)", "signs": signs}, indent=1)
    print(f"{len(signs)} signs -> {out}")


if __name__ == "__main__":
    main()
