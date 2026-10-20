"""Derive overhead wayfinding signs from the verified graph.

    python3 -I stations/ikebukuro/pipeline/build_signage.py

For each junction (degree >= 2 that is not an exit) and each incident verified
edge, list the routable POIs whose shortest path from that junction leaves
along that edge. One sign per (junction, edge) is placed a few metres along
the edge, facing back to the junction; its back face lists what lies ahead
through the junction. Signs therefore only ever state destinations that the
verified graph can actually route to.
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
from floorquery import Surfaces  # noqa: E402
from build_station import wall_segments, write_json  # noqa: E402

CLEAR_BELOW_SIGN = 2.25  # m above walking surface
MIN_CLEAR = 2.0          # never lower than this; a low ceiling shrinks the panel instead
SIGN_H = 0.42
MIN_SIGN_H = 0.2         # below this a sign is unreadable: try elsewhere or omit it
FLUSH_GAP = 0.02         # under a low ceiling the panel is mounted flush
CEIL_GAP = 0.08


def name(p, lang):
    return next((t["text"] for t in p["names"] if t["lang"] == lang), None)


def exit_item(p):
    return {"id": p["id"], "label": p["id"].split("-")[1], "ja": name(p, "ja"), "en": name(p, "en")}


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

    def out_dir(nid, key):
        e = edges[key[0]]
        geom = e["geometry"][::-1] if key[1] else e["geometry"]
        x, y = along(geom, 5.0)
        n = nodes[nid]["position"]
        L = math.hypot(x - n["x"], y - n["y"]) or 1.0
        return (x - n["x"]) / L, (y - n["y"]) / L

    signs = []
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

            def place(target_d):
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
                ch = [z for z, _ in ceil.heights(px, py) if z > pz + 2.0]
                ceiling_z = min(ch) if ch else None
                bottom, sign_h = pz + CLEAR_BELOW_SIGN, SIGN_H
                if ceiling_z is not None and bottom + SIGN_H > ceiling_z - CEIL_GAP:
                    bottom = max(pz + MIN_CLEAR, ceiling_z - CEIL_GAP - SIGN_H)
                    sign_h = min(SIGN_H, ceiling_z - FLUSH_GAP - bottom)
                    if sign_h < MIN_SIGN_H:
                        return None
                rx, ry = diry, -dirx  # right of the walking direction
                zlo, zhi = bottom, bottom + sign_h
                dr = wall_hit(segs, sgrid, px, py, rx, ry, zlo, zhi)
                dl = wall_hit(segs, sgrid, px, py, -rx, -ry, zlo, zhi)
                if dl + dr < 2 * MAX_SIGN_W:  # bounded passage: centre between its walls
                    shift = (dr - dl) / 2
                    px, py = px + rx * shift, py + ry * shift
                    half = (dl + dr) / 2
                else:  # open on one side: ease away from the near wall (<= 1.5 m), stay symmetric
                    want = MAX_SIGN_W / 2 + SIDE_MARGIN
                    if dl < dr:
                        shift = min(1.5, max(0.0, want - dl))
                    else:
                        shift = -min(1.5, max(0.0, want - dr))
                    px, py = px + rx * shift, py + ry * shift
                    half = min(dl + shift, dr - shift)
                max_w = round(max(0.6, min(MAX_SIGN_W, 2 * half - 2 * SIDE_MARGIN)), 2)
                return px, py, bottom, dirx, diry, ceiling_z, max_w, round(sign_h / SIGN_H, 3)

            # ~4 m from the junction (45% of short edges); slide along the edge if a low ceiling, a
            # column or a narrowing leaves too little room there, preferring positions close to 4 m.
            base = min(4.0, total * 0.45)
            cands = [base] + [base + k for k in (1, -1, 2, -1.5, 3, 4, 5) if 1.5 <= base + k <= total * 0.6]
            best = None
            for d in cands:
                r = place(d)
                if r is None:
                    continue
                if best is None or r[7] > best[7] + 0.05 or (r[7] >= best[7] - 0.05 and r[6] > best[6] + 0.5):
                    best = r
                if best[6] >= 4.2 and best[7] == 1:
                    break
            if best is None:
                continue
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
    out = os.path.join(ROOT, "scene", "signage.json")
    write_json(out, {"generatedFrom": "gteki/graph.json + gteki/pois.json (verified edges only)", "signs": signs}, indent=1)
    print(f"{len(signs)} signs -> {out}")


if __name__ == "__main__":
    main()
