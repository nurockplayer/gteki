"""Dressing for geometry a station already has: escalator, stair and railing pieces.

Generators:
  escalator_dressing  balustrade (glass or panel), moving handrail, newel ends, comb plates
                      (any subset, by ``parts``), optional side skirts and static treads
  stair_dressing      yellow nosing strips, handrail run along the pitch line, side skirts
  railing_run         glass or steel guard / fare-fence run along a 2D polyline

Dimension basis: ``generic-typical`` (the stair and escalator dimensions of ``vertical.py``;
guard 1100 mm and fare fence 1150 mm are typical kit heights, not regulatory claims). Every
size is a catalog param, so a station gets a piece that fits its own slab, truss or floor
plan while the kit stays free of station measurements.

The pieces are visual only (no colliders) and carry no structure of their own: no truss, slab,
treads (unless asked), walls or floor. Each carries a station bake role, ``gteki_role`` in
its root and ``VIS_*`` node extras (contract §10): ``transport`` for escalator parts,
``barriers`` for railings, ``stairs_ramps`` only for pieces that lie on a walkable surface
(the nosing strips). A stair kit that mixes both has no single role and carries none.

Origins (Blender frame; the exporter turns +Y into -Z):
  escalator_dressing  floor level, centred in X, on the bottom comb plate line; the
                      escalator rises toward +Y and its newel and handrail turnaround reach
                      about 0.55 m in front of the origin (-Y)
  stair_dressing      floor level under the first (bottom) nosing, centred in X; the
                      handrail's lower extension starts 0.75 m in front of it
  railing_run         the plan origin of the ``points`` (mm; +Y plan is -Z in glTF), floor level

The escalator and stair pieces reuse ``vertical.py``: the escalator is that generator's
output with the parts that belong to the station dropped, and the stair rails are its
``_stair_rails`` on the pitch line of the nosings.
"""

import math

from mathutils import Vector

from .. import contract
from ..asset import Asset
from . import vertical
from .vertical import STAIR_DEFAULTS, STEEL, YELLOW, _choice, _finish, _params, _positive, _stair_rails

GEN = "tools/blender/gteki_assets/families/dressing.py"

DARK_STEEL = "gteki_steel_painted_dark"
GLASS = "gteki_glass_clear"

# Escalator groups of vertical.escalator() that stay, by part and by param. The rest (truss,
# landing plates) is the station's own structure.
ESCALATOR_PARTS = {"balustrade": ("balustrades", "balustrade_shoes"),
                   "handrail": ("moving_handrails",),
                   "newel": ("newel_bases",),
                   "comb": ("comb_plates",)}
ESCALATOR_OPTIONAL = {"skirts": ("skirts", "skirt_brushes", "deck_boards"),
                      "treads": ("steps", "demarcation"),
                      "indicators": ("indicators",)}

ESCALATOR_DRESSING = dict(
    rise_mm=4000, width_mm=1000, angle_deg=30.0, landing_mm=800, flat_steps=2,
    balustrade="glass", direction="up", skirts=False, treads=False, indicators=False,
    parts=("balustrade", "handrail", "newel", "comb"),
)

STAIR_DRESSING = dict(
    step_count=18, riser_mm=160, tread_mm=300, width_mm=2400,
    parts=("nosing", "handrail", "skirt"), handrail_sides="both", skirt_sides="both",
    rail_mount="post", post_spacing_mm=1800, rail_segments=10, skirt_mm=140, skirt_drop_mm=200,
)
STAIR_PARTS = ("nosing", "handrail", "skirt")
SIDES = {"both": (-1, 1), "left": (-1,), "right": (1,), "none": ()}

RAILING_RUN = dict(
    points=[[0, 0], [4000, 0]], height_mm=1100, style="glass", post_spacing_mm=1200, mid_rails=2,
)
POST_R, CHANNEL_HALF, CHANNEL_H, RAIL_R, GLASS_T = 0.025, 0.03, 0.07, 0.02, 0.012


def _asset(asset_id, variant, p, tex_res):
    return Asset(asset_id, "dressing", variant, p, GEN, contract.GENERIC_TYPICAL, tex_res,
                 notes="Dressing only: visual, no colliders, no structure of its own; fit to the station's geometry "
                       "through params. Original generic static kit; no brand, station identity or navigation truth.")


def _count(p, key, lo, hi):
    value = p[key]
    if isinstance(value, bool) or not isinstance(value, int) or not lo <= value <= hi:
        raise ValueError(f"{key} must be an integer from {lo} to {hi}")


def _keep_groups(a, groups):
    """Drop every part outside `groups`, and the materials only those parts used."""
    kept = []
    for group, part in a.parts:
        if group in groups:
            kept.append((group, part))
        else:
            part.bm.free()
    a.parts = kept
    used = sorted({f.material_index for _, part in kept for f in part.bm.faces})
    remap = {old: new for new, old in enumerate(used)}
    names = [a.materials[i] for i in used]
    for _, part in kept:
        for f in part.bm.faces:
            f.material_index = remap[f.material_index]
    a.materials = names


# ----------------------------------------------------------------- escalator


def escalator_dressing(asset_id, params, tex_res):
    p = _params(ESCALATOR_DRESSING, params)
    _positive(p, "rise_mm", "width_mm", "landing_mm")
    for key in ("skirts", "treads", "indicators"):
        _choice(p, key, (True, False))
    p["parts"] = list(p["parts"])
    if not p["parts"] or any(part not in ESCALATOR_PARTS for part in p["parts"]) or len(set(p["parts"])) != len(p["parts"]):
        raise ValueError(f"parts must be a non-empty list of distinct values from {tuple(ESCALATOR_PARTS)}")
    if "run_mm" in p:  # optional; IDProperties cannot hold None, so it has no default
        if "angle_deg" in (params or {}):
            raise ValueError("give run_mm or angle_deg, not both")
        _positive(p, "run_mm")
        # run_mm is the horizontal run between the two flat sections: vertical.py eases the incline
        # in over one transition_run at each end, so the straight incline is rise / tan(angle) = run - one transition
        straight_mm = p["run_mm"] - vertical.ESCALATOR_DEFAULTS["transition_run"] * 1000
        if straight_mm <= 0:
            raise ValueError("run_mm must exceed the escalator's eased transition run")
        p["angle_deg"] = round(math.degrees(math.atan2(p["rise_mm"], straight_mm)), 4)
    _positive(p, "angle_deg")
    a = vertical.escalator(asset_id, dict(
        rise=p["rise_mm"] / 1000, step_width=p["width_mm"] / 1000, incline=p["angle_deg"],
        flat_steps=p["flat_steps"], direction=p["direction"], balustrade=p["balustrade"],
        landing=p["landing_mm"] / 1000), tex_res, handrail_segments=8, handrail_corner=0.0)
    inner = a.params
    keep = {group for part in p["parts"] for group in ESCALATOR_PARTS[part]}
    for key, groups in ESCALATOR_OPTIONAL.items():
        if p[key]:
            keep.update(groups)
    _keep_groups(a, keep)
    for _, part in a.collision:
        part.bm.free()
    a.collision = []
    if not p["indicators"]:
        a.light_hints = []
    landing, rise = inner["landing"], inner["rise"]
    # origin on the bottom comb plate line (the first step starts at y = landing)
    a.shift = Vector((0.0, -landing, 0.0))
    a.sockets = []
    a.socket("start", (0, landing, 0), 180.0, width=inner["step_width"], height=inner["socket_height"])
    a.socket("end", (0, inner["length"] - landing, rise), 0.0, width=inner["step_width"], height=inner["socket_height"])
    a.family, a.variant, a.generator = "dressing", "escalator_dressing", GEN
    a.notes = ("Dressing only: no truss, slabs or colliders. Origin on the bottom comb plate line; "
               "comb-to-comb run is params.comb_run_m.")
    a.params = dict(p, comb_run_m=round(inner["length"] - 2 * landing, 4), inclined_run_m=round(inner["inclined_run"], 4))
    if p["skirts"] or p["treads"]:  # skirts and the first tread sink a few cm into the station's slab
        a.params["allow_below_floor"] = True
    a.placement = "linear"
    a.role = "transport"
    return a


# --------------------------------------------------------------------- stair


def _nosings(a, p):
    n, riser, tread, w = p["step_count"], p["riser_mm"] / 1000, p["tread_mm"] / 1000, p["width_mm"] / 1000
    strips = a.part("nosings", bevel=0.001, bevel_segments=1)
    for i in range(n):
        y, z = i * tread, (i + 1) * riser  # tread nose; the station's tread top is at z
        strips.box((-w / 2 + 0.008, y + 0.010, z), (w / 2 - 0.008, y + 0.065, z + 0.006), YELLOW, skip=("-z",))


def _skirt(a, p, side):
    """Side board along the stair: from the nose line (plus 40 mm) down to `skirt_drop_mm` below the
    riser corners, cut at the floor."""
    n, riser, tread, w = p["step_count"], p["riser_mm"] / 1000, p["tread_mm"] / 1000, p["width_mm"] / 1000
    drop, up, length, top = p["skirt_drop_mm"] / 1000, 0.04, n * tread, n * riser
    lower = [(0.0, 0.0)]
    if drop < top:  # the lower edge follows the riser corners down to the floor
        lower += [(drop * tread / riser, 0.0), (length, top - drop)]
    else:
        lower.append((length, 0.0))
    upper = [(0.0, riser + up), (length - tread, top + up), (length, top + up)]
    x0, x1 = sorted((side * w / 2, side * (w / 2 + p["skirt_mm"] / 1000)))
    board = a.part("side_skirts", bevel=0.002, bevel_segments=1)
    board.extrude_x(lower + upper[::-1], x0, x1, DARK_STEEL)


def stair_dressing(asset_id, params, tex_res):
    p = _params(STAIR_DRESSING, params)
    _count(p, "step_count", 2, 80)
    _positive(p, "riser_mm", "tread_mm", "width_mm", "post_spacing_mm", "skirt_mm", "skirt_drop_mm")
    p["parts"] = list(p["parts"])
    if not p["parts"] or any(part not in STAIR_PARTS for part in p["parts"]) or len(set(p["parts"])) != len(p["parts"]):
        raise ValueError(f"parts must be a non-empty list of distinct values from {STAIR_PARTS}")
    for key in ("handrail_sides", "skirt_sides"):
        _choice(p, key, SIDES)
    _choice(p, "rail_mount", ("post", "wall"))
    # tube cross-section sides (the mobile profile halves them, to at least 6)
    _count(p, "rail_segments", 6, 16)
    n, riser, tread, w = p["step_count"], p["riser_mm"] / 1000, p["tread_mm"] / 1000, p["width_mm"] / 1000
    length, top = n * tread, n * riser
    a = _asset(asset_id, "stair_dressing", p, tex_res)
    if "nosing" in p["parts"]:
        _nosings(a, p)
    if "handrail" in p["parts"]:
        # the rail tiers run parallel to the line through the nose tips, with the usual horizontal
        # extensions; posts stand on the skirt (or on the station's own stringer)
        vp = _params(STAIR_DEFAULTS, dict(width=w, tread=tread, post_spacing=p["post_spacing_mm"] / 1000))
        path = [(0.0, 0.0), (length, top)]
        noses = [(-tread, 0.0), (length - tread, top)]
        for side in SIDES[p["handrail_sides"]]:
            _stair_rails(a, vp, path, noses, side * (w / 2 + 0.025), side, wall=p["rail_mount"] == "wall",
                         segments=p["rail_segments"], support_segments=min(8, p["rail_segments"]))
    if "skirt" in p["parts"]:
        for side in SIDES[p["skirt_sides"]]:
            _skirt(a, p, side)
    if not any(part.bm.faces for _, part in a.parts):
        raise ValueError("parts, handrail_sides and skirt_sides leave nothing to build")
    a.socket("start", (0, 0, 0), 180.0, width=w, height=STAIR_DEFAULTS["socket_height"])
    a.socket("end", (0, length, top), 0.0, width=w, height=STAIR_DEFAULTS["socket_height"])
    a.params = dict(p, length_m=round(length, 4), rise_m=round(top, 4))
    a.placement = "linear"
    # nosing strips lie on the walking surface; rails and skirts are guard hardware
    walkable = set(p["parts"]) == {"nosing"}
    a.role = "stairs_ramps" if walkable else None if "nosing" in p["parts"] else "barriers"
    return _finish(a)


# ------------------------------------------------------------------- railing


def _unit(a, b):
    dx, dy = b[0] - a[0], b[1] - a[1]
    d = math.hypot(dx, dy)
    return (dx / d, dy / d), d


def _outline(pts, half):
    """Closed CCW plan outline `half` either side of a polyline: mitred joints, square ends."""
    dirs = [_unit(a, b)[0] for a, b in zip(pts, pts[1:])]
    left, right = [], []
    for i, (x, y) in enumerate(pts):
        nx, ny = (-dirs[0][1], dirs[0][0]) if i == 0 else (-dirs[-1][1], dirs[-1][0])
        scale = 1.0
        if 0 < i < len(pts) - 1:
            n0, n1 = (-dirs[i - 1][1], dirs[i - 1][0]), (-dirs[i][1], dirs[i][0])
            mx, my = n0[0] + n1[0], n0[1] + n1[1]
            m = math.hypot(mx, my)
            if m > 1e-6:  # a full reversal keeps the plain normal
                nx, ny = mx / m, my / m
                scale = 1.0 / max(0.25, nx * n0[0] + ny * n0[1])
        left.append((x + nx * half * scale, y + ny * half * scale))
        right.append((x - nx * half * scale, y - ny * half * scale))
    return right + left[::-1]


def railing_run(asset_id, params, tex_res):
    p = _params(RAILING_RUN, params)
    pts = p["points"]
    if (not isinstance(pts, (list, tuple)) or not 2 <= len(pts) <= 64
            or any(not isinstance(q, (list, tuple)) or len(q) != 2 or any(
                isinstance(c, bool) or not isinstance(c, (int, float)) or not math.isfinite(c) for c in q) for q in pts)):
        raise ValueError("points must be 2 to 64 [x_mm, y_mm] pairs")
    pts = [(q[0] / 1000, q[1] / 1000) for q in pts]
    lengths = [_unit(u, v)[1] if u != v else 0.0 for u, v in zip(pts, pts[1:])]
    if min(lengths) < 0.1:
        raise ValueError("points must be at least 100 mm apart")
    dirs = [_unit(u, v)[0] for u, v in zip(pts, pts[1:])]
    if any(d0[0] * d1[0] + d0[1] * d1[1] < -0.5 for d0, d1 in zip(dirs, dirs[1:])):
        raise ValueError("points may turn by at most 120 degrees at a corner")
    _positive(p, "height_mm", "post_spacing_mm")
    _choice(p, "style", ("glass", "steel"))
    _count(p, "mid_rails", 1, 4)
    if not 600 <= p["height_mm"] <= 1500 or p["post_spacing_mm"] < 400:
        raise ValueError("height_mm must be 600 to 1500 and post_spacing_mm at least 400")
    height = p["height_mm"] / 1000
    glass = p["style"] == "glass"
    a = _asset(asset_id, "railing_run", p, tex_res)
    rail_z, infill_top = height - RAIL_R, height - 2 * RAIL_R  # rail centre line; underside of the top rail

    channel = a.part("base_channel", bevel=0.002, bevel_segments=1)
    channel.prism(_outline(pts, CHANNEL_HALF), 0.0, CHANNEL_H, DARK_STEEL)

    posts = a.part("posts")
    panes = a.part("glass", bevel=0.001, bevel_segments=1)
    n_posts = 0
    for s, (p0, p1) in enumerate(zip(pts, pts[1:])):
        (dx, dy), length = _unit(p0, p1)
        bays = max(1, math.ceil(length / (p["post_spacing_mm"] / 1000)))
        for i in range(0 if s == 0 else 1, bays + 1):  # a corner post is shared by its two runs
            t = length * i / bays
            posts.cylinder((p0[0] + dx * t, p0[1] + dy * t, CHANNEL_H), POST_R, infill_top - CHANNEL_H, STEEL,
                           segments=16, caps=(False, True))
            n_posts += 1
        if not glass:
            continue
        gap = POST_R + 0.006
        nx, ny = -dy * GLASS_T / 2, dx * GLASS_T / 2
        for i in range(bays):
            t0, t1 = length * i / bays + gap, length * (i + 1) / bays - gap
            if t1 - t0 < 0.05:
                continue
            u = (p0[0] + dx * t0, p0[1] + dy * t0)
            v = (p0[0] + dx * t1, p0[1] + dy * t1)
            panes.prism([(u[0] - nx, u[1] - ny), (v[0] - nx, v[1] - ny), (v[0] + nx, v[1] + ny), (u[0] + nx, u[1] + ny)],
                        CHANNEL_H, infill_top, GLASS)

    rails = a.part("rails")
    rails.tube([(x, y, rail_z) for x, y in pts], RAIL_R, STEEL, segments=14, corner_radius=0.08)
    if not glass:
        for k in range(1, p["mid_rails"] + 1):
            z = CHANNEL_H + (infill_top - CHANNEL_H) * k / (p["mid_rails"] + 1)
            rails.tube([(x, y, z) for x, y in pts], 0.012, STEEL, segments=8, corner_radius=0.05)

    (sx, sy), _ = _unit(pts[0], pts[1])
    (ex, ey), _ = _unit(pts[-2], pts[-1])
    # local +Y of a socket points out of the module: backward at the start, forward at the end
    a.socket("start", (*pts[0], 0), math.degrees(math.atan2(sx, -sy)), width=2 * CHANNEL_HALF, height=height)
    a.socket("end", (*pts[-1], 0), math.degrees(math.atan2(-ex, ey)), width=2 * CHANNEL_HALF, height=height)
    a.params = dict(p, length_m=round(sum(lengths), 4), posts=n_posts)
    a.placement = "free"
    a.role = "barriers"
    return _finish(a)


GENERATORS = {"escalator_dressing": escalator_dressing, "stair_dressing": stair_dressing,
              "railing_run": railing_run}
