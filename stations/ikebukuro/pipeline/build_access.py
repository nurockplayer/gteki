"""Keep free walking on floor whose access is verified.

    python3 -I stations/ikebukuro/pipeline/build_access.py

The explorer lets a walker roam any surveyed floor, but the graph only vouches for
the routable coverage areas. Surveyed floor outside them, such as the JR-Tobu
passage (`gap-tobu-jr-link`, possibly a fare-paid transfer concourse) or the
Yurakucho gate area (`gap-south-west`), has no established access, so the walker
must not enter it, however short or dead-ended it is.

So the whole outline of the routable areas (their union) is fenced: every stretch of
it with surveyed floor within PROBE metres on either side gets an invisible
full-height collision panel, and pieces overlap by OVERLAP at their ends, so the
outline has no gap a walker could slip through. Where floor carries on at the same
level outside, the fence also shows an "access unverified" panel. What lies outside
stays visible. The build fails if a fence comes within ROUTE_CLEAR of a verified edge.
The fences never change the graph, the gridnav or the rendered station;
pipeline/check_access.ts (pnpm check:access) and scene/access.test.ts check them
for gaps and against the explorer's own walker.
Output: stations/ikebukuro/scene/access_fences.json (ENU, metres).
"""
import json
import math
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)
from build_station import ENU, SRC, _in_poly, write_json  # noqa: E402
from floorquery import Surfaces  # noqa: E402
from gridnav import _seg_dist  # noqa: E402

STEP = 0.1          # m between samples along the outline
PROBE = (0.05, 0.3, 0.6)  # m off the outline, both sides, where floor is looked for
OVERLAP = 0.15      # m each fence piece runs on past its ends
LEVEL = 0.3         # m: outside floor this close in height to inside floor continues it
HEIGHT = 2.2        # m of fence above the highest floor next to it
ROUTE_CLEAR = 0.35  # m: no fence this close (in plan, overlapping in height) to a verified edge
MIN_MARK = 0.5      # m: shorter open stretches get no label panel
END_ALLOW = 0.6     # m around a dead-end node (gate, exit) where a fence may close in: the walker still arrives


def main():
    src = json.load(open(SRC))
    polys = [a["polygon"] for a in src["coverage"]["areas"] if a.get("status") == "routable" and a.get("polygon")]
    surf = Surfaces(ENU)
    inside = lambda x, y: any(_in_poly(x, y, p) for p in polys)  # noqa: E731

    fences, marks = [], []
    for poly in polys:
        ring = [(p["x"], p["y"]) for p in poly]
        for (ax, ay), (bx, by) in zip(ring, ring[1:] + ring[:1]):
            L = math.dist((ax, ay), (bx, by))
            if L < 1e-6:
                continue
            ux, uy = (bx - ax) / L, (by - ay) / L
            nx, ny = uy, -ux  # one normal; flipped below so it points out of this polygon
            mx, my = (ax + bx) / 2, (ay + by) / 2
            if _in_poly(mx + nx * 0.05, my + ny * 0.05, poly):
                nx, ny = -nx, -ny
            n = max(1, math.ceil(L / STEP))
            samples = []
            for k in range(n + 1):
                t = L * k / n
                x, y = ax + ux * t, ay + uy * t
                if inside(x + nx * 0.05, y + ny * 0.05):
                    samples.append(None)  # inner edge between two routable areas
                    continue
                ins = [h for d in PROBE for h, _ in surf.heights(x - nx * d, y - ny * d)]
                outs = [h for d in PROBE for h, _ in surf.heights(x + nx * d, y + ny * d)]
                samples.append((t, ins, outs))
            # Runs of outline samples with floor near them: one fence piece each.
            run = []
            for s in samples + [None]:
                if s is not None and (s[1] or s[2]):
                    run.append(s)
                    continue
                if run:
                    fences.append(piece(ax, ay, ux, uy, run))
                    marks.extend(open_stretches(ax, ay, ux, uy, run))
                run = []

    problems = route_clearance(fences, json.load(open(os.path.join(ROOT, "gteki", "graph.json")))["edges"])
    if problems:
        print("\n".join(problems))
        print(f"FAIL: {len(problems)} problem(s); access_fences.json not written")
        sys.exit(1)
    write_json(os.path.join(ROOT, "scene", "access_fences.json"), {
        "generatedFrom": "pipeline/build_access.py: outline of the routable coverage areas over PLATEAU floor",
        "label": {"ja": "通行可否 未確認", "en": "Access unverified"},
        "fences": fences,
        "marks": marks,
    }, indent=1)
    print(f"{len(fences)} fence piece(s), {sum(math.dist(f['a'], f['b']) for f in fences):.0f} m; "
          f"{len(marks)} label stretch(es), {sum(math.dist(m['a'], m['b']) for m in marks):.0f} m")


def piece(ax, ay, ux, uy, run):
    """Collision panel over a run of samples, OVERLAP past both ends, from the lowest floor next to it
    to HEIGHT above the highest."""
    zs = [h for _, ins, outs in run for h in ins + outs]
    t0, t1 = run[0][0] - OVERLAP, run[-1][0] + OVERLAP
    return {"a": [round(ax + ux * t0, 3), round(ay + uy * t0, 3)], "b": [round(ax + ux * t1, 3), round(ay + uy * t1, 3)],
            "z0": round(min(zs) - 0.05, 2), "z1": round(max(zs) + HEIGHT, 2)}


def open_stretches(ax, ay, ux, uy, run):
    """Where floor carries on outside at an inside floor's level: there the fence shows its label."""
    out, cur = [], []
    for t, ins, outs in run + [(None, [], [])]:
        level = [h for h in ins if any(abs(h - o) <= LEVEL for o in outs)]
        if t is not None and level and (not cur or t - cur[-1][0] <= 2 * STEP):
            cur.append((t, min(level)))
            continue
        if cur and cur[-1][0] - cur[0][0] >= MIN_MARK:
            out.append({"a": [round(ax + ux * cur[0][0], 3), round(ay + uy * cur[0][0], 3)],
                        "b": [round(ax + ux * cur[-1][0], 3), round(ay + uy * cur[-1][0], 3)],
                        "z": round(min(z for _, z in cur), 2)})
        cur = [(t, min(level))] if t is not None and level else []
    return out


def route_clearance(fences, edges):
    """Verified edges that pass within ROUTE_CLEAR of a fence at a height the fence covers, except within
    END_ALLOW of a dead end, such as a ticket gate whose gate line is the outline."""
    bad = []
    degree = {}
    for e in edges:
        for k in ("from", "to"):
            degree[e[k]] = degree.get(e[k], 0) + 1
    for e in edges:
        if e["verification"] != "verified":
            continue
        g = e["geometry"]
        ends = [(g[0]["x"], g[0]["y"])] if degree[e["from"]] == 1 else []
        ends += [(g[-1]["x"], g[-1]["y"])] if degree[e["to"]] == 1 else []
        hit = None
        for p, q in zip(g, g[1:]):
            n = max(1, math.ceil(math.dist((p["x"], p["y"]), (q["x"], q["y"])) / 0.1))
            for k in range(n + 1):
                x, y, z = (p[c] + (q[c] - p[c]) * k / n for c in "xyz")
                if any(math.dist((x, y), end) < END_ALLOW for end in ends):
                    continue
                hit = next((f for f in fences if f["z0"] < z + 1.8 and z < f["z1"]
                            and _seg_dist(x, y, *f["a"], *f["b"]) < ROUTE_CLEAR), None)
                if hit:
                    bad.append(f"edge {e['id']}: fence {hit['a']}-{hit['b']} is within {ROUTE_CLEAR} m at ({x:.2f}, {y:.2f})")
                    break
            if hit:
                break
    return bad


if __name__ == "__main__":
    main()
