"""Derive overhead wayfinding signs from the verified graph.

    python3 -I stations/ikebukuro/pipeline/build_signage.py

For each junction (degree >= 2 that is not an exit) and each incident verified
edge, list the routable POIs whose shortest path from that junction leaves
along that edge. One sign per (junction, edge) is placed a few metres along
the edge, facing back to the junction. Signs therefore only ever state
destinations that the verified graph can actually route to.
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

CLEAR_BELOW_SIGN = 2.25  # m above walking surface
SIGN_H = 0.42
CEIL_GAP = 0.08


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
            geom = e["geometry"][::-1] if rev else e["geometry"]
            # point ~4 m along the polyline (or 45% for short edges)
            total = sum(math.dist((a["x"], a["y"]), (b["x"], b["y"])) for a, b in zip(geom, geom[1:]))
            target_d = min(4.0, total * 0.45)
            acc = 0.0
            px = py = pz = None
            dirx = diry = 0.0
            for a, b in zip(geom, geom[1:]):
                seg = math.dist((a["x"], a["y"]), (b["x"], b["y"]))
                if acc + seg >= target_d and seg > 0:
                    t = (target_d - acc) / seg
                    px, py = a["x"] + (b["x"] - a["x"]) * t, a["y"] + (b["y"] - a["y"]) * t
                    pz = a["z"] + (b["z"] - a["z"]) * t
                    dirx, diry = (b["x"] - a["x"]) / seg, (b["y"] - a["y"]) / seg
                    break
                acc += seg
            if px is None:
                continue
            ch = [z for z, _ in ceil.heights(px, py) if z > pz + 2.0]
            ceiling_z = min(ch) if ch else None
            bottom = pz + CLEAR_BELOW_SIGN
            if ceiling_z is not None and bottom + SIGN_H > ceiling_z - CEIL_GAP:
                bottom = max(pz + 2.05, ceiling_z - CEIL_GAP - SIGN_H)
            signs.append({
                "id": f"sign-{nid}-{e['id']}{'-r' if rev else ''}",
                "atNode": nid,
                "position": {"x": round(px, 3), "y": round(py, 3), "z": round(bottom + SIGN_H / 2, 3)},
                # unit vector the readable face points to (back toward the junction)
                "facing": {"x": round(-dirx, 4), "y": round(-diry, 4)},
                "ceilingZ": ceiling_z,
                "exits": [{"id": p["id"], "label": p["id"].split("-")[1],
                           "ja": next((t["text"] for t in p["names"] if t["lang"] == "ja"), None),
                           "en": next((t["text"] for t in p["names"] if t["lang"] == "en"), None)} for p in exits],
                "gates": [{"id": p["id"],
                           "ja": next((t["text"] for t in p["names"] if t["lang"] == "ja"), None),
                           "en": next((t["text"] for t in p["names"] if t["lang"] == "en"), None)} for p in gates],
            })
    out = os.path.join(ROOT, "scene", "signage.json")
    json.dump({"generatedFrom": "gteki/graph.json + gteki/pois.json (verified edges only)", "signs": signs},
              open(out, "w"), ensure_ascii=False, indent=1)
    print(f"{len(signs)} signs -> {out}")


if __name__ == "__main__":
    main()
