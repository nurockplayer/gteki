"""Platform edge set and a generic platform screen-door module (generic, unbranded).

Generators:
  platform_edge          run along the platform edge: coping stone, yellow edge line, edge tactile
                         warning blocks (dots, or dots with an inner line) and an optional fall-gap
                         rubber lip, any subset by ``parts``
  platform_screen_door   one screen-door module: fixed panels, a pair of sliding leaves and a
                         header box (a station that draws its own doors does not need it)

Frame (Blender; the exporter turns +Y into -Z): the run starts at y = 0 and extends toward +Y,
sockets ``start`` and ``end`` sit on the edge line at floor level. The platform edge line is x = 0,
the track side is -X and the platform is +X, so the platform is on the right when walking along
the run. A placement yawed 180 degrees serves the platform on the other side.

Both pieces are visual only (the station owns the platform floor and its collision) and nothing is
below the floor: the coping, line and tactile are inlays that stand ``coping_h_mm`` above z = 0 as
one flush top surface. A station that wants them level with its own floor lowers that floor by
that amount, or accepts the 10 mm step.

Dimension basis: the 300 mm block pitch and 5x5 dot layout follow the widely published JIS T 9251
family, as in ``props.tactile_strip``; the inner-line form is a generic approximation of the
published edge block (a continuous raised line on the platform side of the dot band), not a
dimensioned copy. Every other size is a typical kit value in the catalog params
(``generic-typical`` for the edge, ``synthetic`` for the screen door).

No logos, text, digits or pictograms.
"""

from .. import contract
from ..asset import Asset
from .signage import ALU, K, _choice, finish
from .vertical import YELLOW

GEN = "tools/blender/gteki_assets/families/platform.py"

BLOCK = 0.3  # JIS T 9251 block pitch, one tactile texture repeat (props.BLOCK)
COPING = {"granite": "gteki_floor_granite_dark", "concrete": "gteki_concrete"}
TACTILE = "gteki_tactile_dots"
RUBBER = "gteki_rubber_black"
EDGE_PARTS = ("coping", "line", "tactile", "gap_strip")
INNER_LINE_W, INNER_LINE_GAP = 0.04, 0.03  # inner line width and its gap to the dot band

EDGE_DEFAULTS = dict(
    length_mm=6000, coping_depth_mm=600, coping_h_mm=10, coping="granite",
    line_offset_mm=40, line_w_mm=100,
    tactile="dots", tactile_setback_mm=200,
    gap_strip_w_mm=50,
    parts=("coping", "line", "tactile"),
)

PSD_DEFAULTS = dict(
    length_mm=5600, height_mm=2000, header_h_mm=400, inset_mm=60, depth_mm=180,
    opening_mm=2000, fixed_panels_per_side=2, open_mm=0,
)


def _params(defaults, params):
    p = dict(defaults)
    p.update(params or {})
    return p


def _positive(p, *keys):
    for key in keys:
        value = p[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(f"{key} must be a positive number")


def _asset(asset_id, family, variant, p, tex_res, basis, notes):
    return Asset(asset_id, family, variant, p, GEN, basis, tex_res, notes=notes)


def _mm(v):
    return round(v / 1000.0, 5)


# ---------------------------------------------------------------------------
# platform_edge
# ---------------------------------------------------------------------------


def _strips(p):
    """Strips across the run as (name, x0, x1, material) in metres, sorted from the edge. Coping
    fills whatever the line and the tactile leave of its depth."""
    depth = _mm(p["coping_depth_mm"])
    parts = p["parts"]
    taken = []
    if "line" in parts:
        x0 = _mm(p["line_offset_mm"])
        taken.append(("line", x0, x0 + _mm(p["line_w_mm"]), YELLOW))
    if "tactile" in parts:
        x0 = _mm(p["tactile_setback_mm"])
        taken.append(("tactile", x0, x0 + BLOCK, TACTILE))
        if p["tactile"] == "inner_line":
            x1 = x0 + BLOCK + INNER_LINE_GAP
            taken.append(("inner_line", x1, x1 + INNER_LINE_W, YELLOW))
    taken.sort(key=lambda s: s[1])
    for a, b in zip(taken, taken[1:]):
        if a[2] > b[1] + 1e-9:
            raise ValueError(f"{a[0]} overlaps {b[0]}: widen the spacing or move tactile_setback_mm / line_offset_mm")
    if taken and taken[-1][2] > depth + 1e-9 and "coping" in parts:
        raise ValueError("line and tactile must fit inside coping_depth_mm")
    if "coping" not in parts:
        return taken
    out, x = [], 0.0
    for name, x0, x1, mat in taken:
        if x0 > x + 1e-9:
            out.append(("coping", x, x0, COPING[p["coping"]]))
        out.append((name, x0, x1, mat))
        x = x1
    if depth > x + 1e-9:
        out.append(("coping", x, depth, COPING[p["coping"]]))
    return out


def platform_edge(asset_id, params, tex_res):
    p = _params(EDGE_DEFAULTS, params)
    _positive(p, "length_mm", "coping_depth_mm", "coping_h_mm", "line_w_mm", "gap_strip_w_mm")
    _choice(p, "coping", tuple(COPING))
    _choice(p, "tactile", ("dots", "inner_line"))
    p["parts"] = list(p["parts"])
    if not p["parts"] or len(set(p["parts"])) != len(p["parts"]) or any(part not in EDGE_PARTS for part in p["parts"]):
        raise ValueError(f"parts must be a non-empty list of distinct values from {EDGE_PARTS}")
    L, h = _mm(p["length_mm"]), _mm(p["coping_h_mm"])
    strips = _strips(p)
    depth = max([s[2] for s in strips] + [0.0])
    gap = _mm(p["gap_strip_w_mm"]) if "gap_strip" in p["parts"] else 0.0
    # derived, so a station can check the layout against its platform without reading the mesh
    p["strips_mm"] = [[n, round(x0 * 1000), round(x1 * 1000)] for n, x0, x1, _ in strips]
    a = _asset(asset_id, "platform", asset_id.replace("gteki_platform_", ""), p, tex_res, contract.GENERIC_TYPICAL,
               "Visual-only inlay, flush top at coping_h_mm above z=0; the platform edge line is x=0 (track side -X, platform +X), "
               "the run extends along the platform. Tactile block pitch follows JIS T 9251 (as tactile_strip); dots are texture "
               "relief mapped from the band's own start so blocks align with the repeat.")
    kits = {}

    def kit(group, bevel):
        if group not in kits:
            kits[group] = K(a, group, bevel=bevel, bevel_segments=1)
        return kits[group]

    for i, (name, x0, x1, mat) in enumerate(strips):
        # adjacent strips hide each other's side faces
        skip = ["-z"]
        if i > 0 and abs(strips[i - 1][2] - x0) < 1e-9:
            skip.append("-x")
        if i + 1 < len(strips) and abs(strips[i + 1][1] - x1) < 1e-9:
            skip.append("+x")
        stone = COPING[p["coping"]]
        if name == "coping":
            kit("coping", 0.002).box((x0, 0, 0), (x1, L, h), mat, skip=tuple(skip))
        elif name == "tactile":
            k = kit("tactile", 0.002)
            n0 = k.mark()
            k.part.box((x0, 0, 0), (x1, L, h), stone, skip=tuple(skip + ["+z"]))
            uv = [((x - x0) / BLOCK, y / BLOCK) for x, y in ((x0, 0), (x1, 0), (x1, L), (x0, L))]
            k.part.quad((x0, 0, h), (x1, 0, h), (x1, L, h), (x0, L, h), mat, smooth=False, uv=uv)
            k.weld(n0)
        else:  # painted inlays: yellow top, stone sides
            kit("line", 0.001).box((x0, 0, 0), (x1, L, h), stone, skip=tuple(skip), mats={"+z": mat})
    if "gap_strip" in p["parts"]:
        # rubber lip bridging the gap to the train, level with the coping, with two grip ribs
        rg = h - 0.002
        kit("gap", 0.002).box((-gap, 0, 0), (0, L, rg), RUBBER, skip=("-z", "+x"))
        for xc in (-gap * 0.7, -gap * 0.3):
            kit("gap", 0.0005).box((xc - 0.0015, 0, rg), (xc + 0.0015, L, rg + 0.002), RUBBER, skip=("-z",))
    a.socket("start", (0, 0, 0), 180.0, width=round(depth + gap, 4), height=h)
    a.socket("end", (0, L, 0), 0.0, width=round(depth + gap, 4), height=h)
    return finish(a)


# ---------------------------------------------------------------------------
# platform_screen_door
# ---------------------------------------------------------------------------

GLASS = "gteki_glass_clear"
FRAME = "gteki_steel_painted_dark"
BODY = "gteki_gate_body"
BAND = "gteki_gate_accent"
CAP = "gteki_gate_top"
SILL = "gteki_steel_brushed"
STILE, RAIL_TOP, RAIL_BOT = 0.045, 0.06, 0.12  # leaf frame sizes
POST = 0.06
BASE_H = 0.15


def _pane(frame, glass, y0, y1, z0, z1, x0, x1, stile=STILE, top=RAIL_TOP, bot=RAIL_BOT, frame_mat=FRAME):
    """Framed glass pane in a plane facing X: frame boxes x0..x1, glass in the middle third."""
    frame.box((x0, y0, z0), (x1, y0 + stile, z1), frame_mat)
    frame.box((x0, y1 - stile, z0), (x1, y1, z1), frame_mat)
    frame.box((x0, y0 + stile, z0), (x1, y1 - stile, z0 + bot), frame_mat)
    frame.box((x0, y0 + stile, z1 - top), (x1, y1 - stile, z1), frame_mat)
    t = (x1 - x0) / 3
    glass.box((x0 + t, y0 + stile, z0 + bot), (x1 - t, y1 - stile, z1 - top), GLASS)


def platform_screen_door(asset_id, params, tex_res):
    p = _params(PSD_DEFAULTS, params)
    _positive(p, "length_mm", "height_mm", "header_h_mm", "inset_mm", "depth_mm", "opening_mm")
    n_fixed = p["fixed_panels_per_side"]
    if isinstance(n_fixed, bool) or not isinstance(n_fixed, int) or not 1 <= n_fixed <= 4:
        raise ValueError("fixed_panels_per_side must be an integer from 1 to 4")
    L, H, hh = _mm(p["length_mm"]), _mm(p["height_mm"]), _mm(p["header_h_mm"])
    x0, D = _mm(p["inset_mm"]), _mm(p["depth_mm"])
    side = (L - _mm(p["opening_mm"])) / 2  # fixed zone on each side of the door opening
    if side < 2 * POST + 0.3 * n_fixed:
        raise ValueError("opening_mm leaves too little room for the fixed panels")
    leaf_w = _mm(p["opening_mm"]) / 2 + 0.02  # leaves overlap by 40 mm at the meeting stiles
    if isinstance(p["open_mm"], bool) or not 0 <= p["open_mm"] <= (side - 2 * POST) * 1000:
        raise ValueError("open_mm must be from 0 to the width of the fixed zone")
    xf, xa, xb = x0 + 0.02, x0 + 0.06, x0 + 0.095  # fixed glass plane, then the two leaf planes
    thin = 0.03
    a = _asset(asset_id, "platform", asset_id.replace("gteki_platform_", ""), p, tex_res, contract.SYNTHETIC,
               "Visual-only screen-door module along the run (y), track-side face at x = inset_mm, standing on the platform floor. "
               "open_mm slides the leaves apart (0 = closed); they travel on the platform side of the fixed panels. For a platform_edge "
               "run behind it, drop the yellow line and set tactile_setback_mm past inset_mm + depth_mm. No status lamps or text.")
    base = K(a, "base", bevel=0.003, bevel_segments=1)
    frame = K(a, "frame", bevel=0.002, bevel_segments=1)
    glass = K(a, "glass")
    head = K(a, "header", bevel=0.004, bevel_segments=1)
    cap = K(a, "header", bevel=0.003, bevel_segments=1)
    # dark plinth under the fixed zones, brushed threshold across the opening
    lo, hi = side, L - side
    base.box((x0, 0, 0), (x0 + D, lo, BASE_H), FRAME, skip=("-z",))
    base.box((x0, hi, 0), (x0 + D, L, BASE_H), FRAME, skip=("-z",))
    base.box((x0, lo, 0), (x0 + D, hi, 0.012), SILL, skip=("-z",))
    # posts at the ends, beside the opening and between fixed panels
    pw = (side - 2 * POST) / n_fixed
    for z0, z1 in ((0.0, side), (L - side, L)):
        ys = [z0 + POST + pw * i for i in range(n_fixed)]
        posts = [z0, *[y - POST / 2 for y in ys[1:]], z1 - POST]
        for y in posts:
            frame.box((xf - 0.01, y, BASE_H), (xf + 0.03, y + POST, H), FRAME)
        for y in ys:
            _pane(frame, glass, y, y + pw, BASE_H, H, xf, xf + 0.02, stile=0.02, top=0.03, bot=0.03)
    # sliding leaves hang 40 mm above the threshold: the first (toward the start) in the front plane, the second behind it
    op = _mm(p["open_mm"])
    _pane(frame, glass, lo - op, lo + leaf_w - op, 0.04, H, xa, xa + thin, frame_mat=ALU)
    _pane(frame, glass, hi - leaf_w + op, hi + op, 0.04, H, xb, xb + thin, frame_mat=ALU)
    # header box: light body, 30 mm blue band, black cap with an 8 mm overhang
    head.box((x0, 0, H), (x0 + D, L, H + 0.03), BAND)  # hangs at H: its underside is seen from the platform
    head.box((x0, 0, H + 0.03), (x0 + D, L, H + hh - 0.02), BODY)
    cap.box((x0 - 0.008, 0, H + hh - 0.02), (x0 + D + 0.008, L, H + hh), CAP)
    a.socket("start", (0, 0, 0), 180.0, width=round(x0 + D, 4), height=round(H + hh, 4))
    a.socket("end", (0, L, 0), 0.0, width=round(x0 + D, 4), height=round(H + hh, 4))
    return finish(a)


GENERATORS = {"platform_edge": platform_edge, "platform_screen_door": platform_screen_door}
