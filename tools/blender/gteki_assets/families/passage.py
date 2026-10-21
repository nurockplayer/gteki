"""Configurable underground passage / concourse shells.

Generators:
  passage_straight  straight segment, entry at y=0 (glTF z=0), far end y=length
  passage_node      square W x W junction: end cap, corner, tee or cross

Dimensions are synthetic look-dev defaults (not taken from any station);
station leads pass their own measured width/height/length.
"""

from .. import contract
from ..asset import Asset

GEN = "tools/blender/gteki_assets/families/passage.py"

DEFAULTS = dict(
    length=6.0,
    width=4.0,
    height=2.8,  # clear height to finished ceiling
    wall_left="panel",  # panel | tile | tile_accent | none
    wall_right="panel",
    floor="terrazzo",  # terrazzo | tile600
    border=0.3,  # dark granite band along walls (0 = none)
    ceiling="spandrel",  # spandrel | plaster
    light_rows=2,
    light_module=1.2,  # fixture length incl. gap
    wall_t=0.15,
    slab_t=0.25,
    plenum=0.25,
    panel_module=1.2,
    skirting=0.12,
    wainscot="none",  # lower wall band style (same keys as walls) or "none"
    wainscot_h=1.1,
)

FLOOR_MAT = {"terrazzo": "gteki_floor_terrazzo", "tile600": "gteki_floor_tile600"}
WALL_MAT = {"panel": "gteki_wall_panel_enamel", "panel_accent": "gteki_wall_panel_accent", "tile": "gteki_wall_tile_white", "tile_accent": "gteki_wall_tile_accent"}
CEIL_MAT = {"spandrel": "gteki_ceiling_spandrel", "plaster": "gteki_ceiling_plaster"}


def _p(params):
    p = dict(DEFAULTS)
    p.update(params or {})
    p["allow_below_floor"] = True  # structural slab sits under the walking surface (contract §1)
    return p


# ------------------------------------------------------------------ shell pieces


class _Frame:
    """Axis-aligned wall frame: u along the wall, d outward (into the wall), z up."""

    def __init__(self, origin, u_axis, out_axis):
        self.o = origin
        self.u = u_axis  # ('x'|'y', sign)
        self.d = out_axis

    def pt(self, u, d, z):
        p = [self.o[0], self.o[1], z]
        for (ax, sg), val in ((self.u, u), (self.d, d)):
            p["xy".index(ax)] += sg * val
        return p

    def box(self, part, u0, u1, d0, d1, z0, z1, mat, **kw):
        a = self.pt(u0, d0, z0)
        b = self.pt(u1, d1, z1)
        mn = [min(a[i], b[i]) for i in range(3)]
        mx = [max(a[i], b[i]) for i in range(3)]
        return part.box(mn, mx, mat, **kw)


def wall_run(asset, frame, length, p, style, name):
    """Inner finished face at d=0, wall body to d=wall_t. Adds collision."""
    H, t = p["height"], p["wall_t"]
    if style == "none":
        return
    back = asset.part("walls")
    # backing (shows through panel joints and the top shadow gap); its end
    # faces become stainless corner guards wherever a run ends at an opening
    ends = ("-x", "+x") if frame.u[0] == "x" else ("-y", "+y")
    frame.box(back, 0, length, 0.03, t, 0, H, "gteki_reveal_dark", mats={k: "gteki_steel_brushed" for k in ends})
    sk = p["skirting"]
    top = H - 0.06  # 60 mm shadow gap under the ceiling
    bands = [(sk + 0.01, top, style)]
    if p["wainscot"] != "none":
        wh = p["wainscot_h"]
        bands = [(sk + 0.01, wh, p["wainscot"]), (wh + 0.012, top, style)]
        # stainless chair rail between the bands
        rail = asset.part("walls", bevel=0.003, bevel_segments=1)
        frame.box(rail, 0, length, -0.008, 0.03, wh - 0.002, wh + 0.014, "gteki_steel_brushed")
    for z0, z1, st in bands:
        mat = WALL_MAT[st]
        if st.startswith("panel"):
            panels = asset.part("walls", bevel=0.004, bevel_segments=1)
            n = max(1, round(length / p["panel_module"]))
            w = length / n
            gap = 0.008
            for i in range(n):
                frame.box(panels, i * w + gap / 2, (i + 1) * w - gap / 2, 0.0, 0.03, z0, z1, mat)
        else:
            tiles = asset.part("walls")
            frame.box(tiles, 0, length, 0.0, 0.03, z0, z1, mat)
    skirt = asset.part("walls", bevel=0.003, bevel_segments=1)
    frame.box(skirt, 0, length, -0.012, 0.03, 0, sk, "gteki_steel_brushed")
    c0 = frame.pt(0, 0, 0)
    c1 = frame.pt(length, t, H)
    asset.col_box(name, [min(c0[0], c1[0]), min(c0[1], c1[1]), 0], [max(c0[0], c1[0]), max(c0[1], c1[1]), H])


def floor_field(asset, x0, x1, y0, y1, p, bands):
    """Floor slab with optional dark border bands on the given sides ('-x','+x','-y','+y')."""
    slab = asset.part("floor")
    b = p["border"]
    fx0 = x0 + (b if "-x" in bands else 0)
    fx1 = x1 - (b if "+x" in bands else 0)
    fy0 = y0 + (b if "-y" in bands else 0)
    fy1 = y1 - (b if "+y" in bands else 0)
    st = p["slab_t"]
    fm = FLOOR_MAT[p["floor"]]
    slab.box([fx0, fy0, -st], [fx1, fy1, 0], "gteki_concrete", mats={"+z": fm})
    gm = "gteki_floor_granite_dark"
    if b > 0:
        if "-x" in bands:
            slab.box([x0, y0, -st], [fx0, y1, 0], "gteki_concrete", mats={"+z": gm})
        if "+x" in bands:
            slab.box([fx1, y0, -st], [x1, y1, 0], "gteki_concrete", mats={"+z": gm})
        if "-y" in bands:
            slab.box([fx0, y0, -st], [fx1, fy0, 0], "gteki_concrete", mats={"+z": gm})
        if "+y" in bands:
            slab.box([fx0, fy1, -st], [fx1, y1, 0], "gteki_concrete", mats={"+z": gm})


def ceiling_field(asset, x0, x1, y0, y1, p, rows_along="y", name="ceiling"):
    H = p["height"]
    ceil = asset.part("ceiling")
    ceil.box([x0, y0, H], [x1, y1, H + p["plenum"]], "gteki_concrete", mats={"-z": CEIL_MAT[p["ceiling"]]})
    asset.col_box(name, [x0, y0, H], [x1, y1, H + p["plenum"]])
    rows = p["light_rows"]
    if rows <= 0:
        return
    lights = asset.part("lights", bevel=0.003, bevel_segments=1)
    trims = asset.part("lights", bevel=0.002, bevel_segments=1)
    span_a = (x0, x1) if rows_along == "y" else (y0, y1)
    run = (y0, y1) if rows_along == "y" else (x0, x1)
    width = span_a[1] - span_a[0]
    run_len = run[1] - run[0]
    n = max(1, round(run_len / p["light_module"]))
    m = run_len / n
    fw = 0.12  # diffuser width
    for r in range(rows):
        c = span_a[0] + width * (r + 0.5) / rows
        for i in range(n):
            a0 = run[0] + i * m + 0.06
            a1 = run[0] + (i + 1) * m - 0.06
            if rows_along == "y":
                trims.box([c - fw / 2 - 0.015, a0 - 0.015, H - 0.012], [c + fw / 2 + 0.015, a1 + 0.015, H], "gteki_aluminium_anodised", skip=("+z",))
                lights.box([c - fw / 2, a0, H - 0.018], [c + fw / 2, a1, H - 0.012], "gteki_light_diffuser", skip=("+z",))
                loc = (c, (a0 + a1) / 2, H - 0.02)
            else:
                trims.box([a0 - 0.015, c - fw / 2 - 0.015, H - 0.012], [a1 + 0.015, c + fw / 2 + 0.015, H], "gteki_aluminium_anodised", skip=("+z",))
                lights.box([a0, c - fw / 2, H - 0.018], [a1, c + fw / 2, H - 0.012], "gteki_light_diffuser", skip=("+z",))
                loc = ((a0 + a1) / 2, c, H - 0.02)
            asset.light_hint(f"{name}_r{r}_{i}", loc, kind="linear_led", length_m=round(a1 - a0, 3), axis=rows_along, colour_temp_k=4000)


# ------------------------------------------------------------------ generators


def passage_straight(asset_id, params, tex_res):
    p = _p(params)
    L, W, H, t = p["length"], p["width"], p["height"], p["wall_t"]
    a = Asset(asset_id, "passage", asset_id.replace("gteki_passage_", ""), p, GEN, contract.SYNTHETIC, tex_res)
    bands = []
    wl, wr = p["wall_left"], p["wall_right"]
    if wl != "none":
        bands.append("-x")
    if wr != "none":
        bands.append("+x")
    floor_field(a, -W / 2, W / 2, 0, L, p, bands)
    # slab continues under the wall thickness
    under = a.part("floor")
    if wl != "none":
        under.box([-W / 2 - t, 0, -p["slab_t"]], [-W / 2, L, 0], "gteki_concrete", skip=("+z",))
    if wr != "none":
        under.box([W / 2, 0, -p["slab_t"]], [W / 2 + t, L, 0], "gteki_concrete", skip=("+z",))
    a.col_box("floor", [-W / 2 - t, 0, -p["slab_t"]], [W / 2 + t, L, 0])
    # walls: left inner face at x=-W/2 facing +x, outward is -x
    wall_run(a, _Frame((-W / 2, 0), ("y", 1), ("x", -1)), L, p, wl, "wall_left")
    wall_run(a, _Frame((W / 2, 0), ("y", 1), ("x", 1)), L, p, wr, "wall_right")
    ceiling_field(a, -W / 2 - t, W / 2 + t, 0, L, p)
    a.socket("start", (0, 0, 0), 180.0, width=W, height=H)
    a.socket("end", (0, L, 0), 0.0, width=W, height=H)
    return a


NODE_OPENINGS = {"end": "S", "corner": "SE", "tee": "SEW", "cross": "SNEW", "through": "SN"}


def passage_node(asset_id, params, tex_res):
    """Square junction W x W. `kind` = end|corner|tee|cross; S (y=0) is the entry."""
    p = _p(params)
    kind = p.get("kind", "corner")
    p["kind"] = kind
    open_sides = set(NODE_OPENINGS[kind])
    W, H, t = p["width"], p["height"], p["wall_t"]
    a = Asset(asset_id, "passage", asset_id.replace("gteki_passage_", ""), p, GEN, contract.SYNTHETIC, tex_res)
    x0, x1, y0, y1 = -W / 2, W / 2, 0.0, W
    side_band = {"W": "-x", "E": "+x", "S": "-y", "N": "+y"}
    bands = [side_band[s] for s in "SNEW" if s not in open_sides]
    floor_field(a, x0, x1, y0, y1, p, bands)
    st = p["slab_t"]
    a.col_box("floor", [x0 - t, y0 - (0 if "S" in open_sides else t), -st], [x1 + t, y1 + (0 if "N" in open_sides else t), 0])
    frames = {
        "W": (_Frame((x0, y0), ("y", 1), ("x", -1)), W),
        "E": (_Frame((x1, y0), ("y", 1), ("x", 1)), W),
        "S": (_Frame((x0, y0), ("x", 1), ("y", -1)), W),
        "N": (_Frame((x0, y1), ("x", 1), ("y", 1)), W),
    }
    under = a.part("floor")
    for s, (fr, ln) in frames.items():
        if s not in open_sides:
            wall_run(a, fr, ln, p, p["wall_left"], f"wall_{s}")
            c0, c1 = fr.pt(0, 0, -st), fr.pt(ln, t, 0)
            under.box([min(c0[0], c1[0]), min(c0[1], c1[1]), -st], [max(c0[0], c1[0]), max(c0[1], c1[1]), 0], "gteki_concrete", skip=("+z",))
    # corner posts fill the wall-thickness square where two closed sides meet,
    # or where two open sides meet (neighbouring modules' walls end there)
    corners = {("S", "W"): (x0 - t, y0 - t), ("S", "E"): (x1, y0 - t), ("N", "W"): (x0 - t, y1), ("N", "E"): (x1, y1)}
    post = a.part("walls")
    for (s1, s2), (cx, cy) in corners.items():
        closed = (s1 not in open_sides) + (s2 not in open_sides)
        if closed == 2:
            post.box([cx, cy, 0], [cx + t, cy + t, H], "gteki_reveal_dark")
            a.col_box(f"corner_{s1}{s2}", [cx, cy, 0], [cx + t, cy + t, H])
    ceiling_field(a, x0 - t, x1 + t, y0 - (0 if "S" in open_sides else t), y1 + (0 if "N" in open_sides else t), p)
    sock = {"S": ((0, y0, 0), 180.0), "N": ((0, y1, 0), 0.0), "E": ((x1, W / 2, 0), -90.0), "W": ((x0, W / 2, 0), 90.0)}
    names = {"S": "start", "N": "north", "E": "east", "W": "west"}
    for s in "SNEW":
        if s in open_sides:
            loc, yaw = sock[s]
            a.socket(names[s], loc, yaw, width=W, height=H)
    return a


GENERATORS = {"passage_straight": passage_straight, "passage_node": passage_node}
