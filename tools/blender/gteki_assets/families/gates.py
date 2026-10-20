"""Automatic fare-gate arrays (generic design, not any manufacturer's product).

Generator:
  gate_array   n aisles side by side along X, passengers travel along +Y
               (glTF -Z). Cabinets sit between and beside the aisles.

Default dimensions are generic-typical values for automatic fare gates in
Japan as widely published (standard aisle about 0.55-0.60 m clear, wide /
accessible aisle about 0.90 m, cabinet height about 1.0 m, cabinet length
about 1.2-1.5 m). They are not measurements of any particular station.

Flap doors are exported per aisle side as separate nodes `VIS_flap_<i>_<L|R>`
in the retracted (open) state; runtime may slide them along local X by
`flap_close_dx_m` to show a closed gate. Flaps never collide: whether a
passenger may pass is runtime logic, not geometry.
"""

import math

from .. import contract
from ..asset import Asset
from ..mesh import stadium

GEN = "tools/blender/gteki_assets/families/gates.py"

DEFAULTS = dict(
    aisles=4,
    wide_aisles=[3],  # indices of accessible wide aisles
    aisle_w=0.60,
    wide_w=0.90,
    cab_w=0.22,
    cab_len=1.30,
    cab_h=0.92,  # top surface height
    bidirectional=True,
    floor_plate=True,
)


def _p(params):
    p = dict(DEFAULTS)
    p.update(params or {})
    return p


def _offset(poly, d):
    """Offset a convex CCW polygon outward by d (miter)."""
    n = len(poly)
    out = []
    for i in range(n):
        x0, y0 = poly[i - 1]
        x1, y1 = poly[i]
        x2, y2 = poly[(i + 1) % n]
        e0 = (x1 - x0, y1 - y0)
        e1 = (x2 - x1, y2 - y1)
        l0 = math.hypot(*e0) or 1
        l1 = math.hypot(*e1) or 1
        n0 = (e0[1] / l0, -e0[0] / l0)
        n1 = (e1[1] / l1, -e1[0] / l1)
        nx, ny = n0[0] + n1[0], n0[1] + n1[1]
        ln = math.hypot(nx, ny) or 1
        nx, ny = nx / ln, ny / ln
        cos_half = max(0.3, nx * n1[0] + ny * n1[1])
        out.append((x1 + nx * d / cos_half, y1 + ny * d / cos_half))
    return out


def _reader(part, deco, cx, y_near, y_far, z, mirror, L):
    """Slanted IC reader pedestal with emissive pad, facing the approaching passenger."""

    def Y(y):
        return L - y if mirror else y

    y0, y1 = y_near, y_far
    z_lo, z_hi = z + 0.025, z + 0.065
    prof = [(Y(y0), z), (Y(y1), z), (Y(y1), z_hi), (Y(y0), z_lo)]
    if mirror:
        prof = [prof[1], prof[0], prof[3], prof[2]]
    part.extrude_x(prof, cx - 0.075, cx + 0.075, "gteki_gate_top")
    # pad on the slanted face: dark target with an emissive ring, lifted along the face normal
    dy, dz = (y1 - y0), (z_hi - z_lo)
    ln = math.hypot(dy, dz)
    ny, nz = -dz / ln, dy / ln

    def on_face(x, t, lift):
        return (x, Y(y0 + dy * t + ny * lift), z_lo + dz * t + nz * lift)

    def rect(xa, xb, ta, tb, lift, mat):
        q = [on_face(xa, ta, lift), on_face(xb, ta, lift), on_face(xb, tb, lift), on_face(xa, tb, lift)]
        if mirror:
            q = [q[1], q[0], q[3], q[2]]
        deco.poly(q, mat, uv=[(0, 0), (1, 0), (1, 1), (0, 1)])

    hw, ta, tb, ring = 0.05, 0.16, 0.84, 0.009
    rt = ring / (ln)  # ring width in face parameter units
    rect(-hw + cx, hw + cx, ta, tb, 0.0015, "gteki_plastic_dark")
    rect(-hw + cx, hw + cx, ta, ta + rt, 0.0025, "gteki_emissive_ic_blue")
    rect(-hw + cx, hw + cx, tb - rt, tb, 0.0025, "gteki_emissive_ic_blue")
    rect(-hw + cx, -hw + cx + ring, ta + rt, tb - rt, 0.0025, "gteki_emissive_ic_blue")
    rect(hw + cx - ring, hw + cx, ta + rt, tb - rt, 0.0025, "gteki_emissive_ic_blue")


def _cabinet(a, idx, cx, p, sides):
    """One gate cabinet centred on x=cx. `sides` = aisle-facing sides ('-x', '+x')."""
    w, L, H = p["cab_w"], p["cab_len"], p["cab_h"]
    body = a.part("cabinets", bevel=0.006, bevel_segments=2)
    trim = a.part("cabinets", bevel=0.003, bevel_segments=1)
    deco = a.part("cabinets")
    outline = stadium(cx - w / 2, cx + w / 2, 0.0, L, steps=10)
    plinth = _offset(outline, -0.014)
    body.prism(plinth, 0.0, 0.07, "gteki_steel_painted_dark", skip_bottom=True)
    body.prism(outline, 0.07, H - 0.075, "gteki_gate_body", skip_bottom=True)
    trim.prism(_offset(outline, 0.001), H - 0.075, H - 0.045, "gteki_gate_accent", skip_bottom=True, skip_top=True)
    body.prism(_offset(outline, 0.008), H - 0.045, H, "gteki_gate_top", skip_bottom=False)

    ends = [False, True] if p["bidirectional"] else [False]
    for mirror in ends:
        _reader(trim, deco, cx, 0.08, 0.36, H, mirror, L)

        def Y(y):
            return L - y if mirror else y

        # ticket slot and small LCD on the top surface
        ys0, ys1 = sorted((Y(0.44), Y(0.475)))
        trim.box([cx - 0.065, ys0, H], [cx + 0.065, ys1, H + 0.006], "gteki_plastic_dark", skip=("-z",))
        deco.box([cx - 0.05, ys0 + 0.012, H + 0.006], [cx + 0.05, ys1 - 0.012, H + 0.0072], "gteki_reveal_dark", skip=("-z",))
        yl0, yl1 = sorted((Y(0.52), Y(0.64)))
        deco.quad((cx - 0.07, yl0, H + 0.002), (cx + 0.07, yl0, H + 0.002), (cx + 0.07, yl1, H + 0.002), (cx - 0.07, yl1, H + 0.002), "gteki_screen_lcd", uv=[(0, 0), (1, 0), (1, 1), (0, 1)])
        # status indicator on the nose
        ny0, ny1 = sorted((Y(-0.006), Y(0.02)))
        ind = "gteki_emissive_green" if (p["bidirectional"] or not mirror) else "gteki_emissive_red"
        trim.box([cx - 0.04, ny0, 0.72], [cx + 0.04, ny1, 0.78], "gteki_plastic_dark")
        yf = Y(-0.0075)
        q = [(cx - 0.03, yf, 0.73), (cx + 0.03, yf, 0.73), (cx + 0.03, yf, 0.77), (cx - 0.03, yf, 0.77)]
        if mirror:  # face +Y at the far end
            q = [q[1], q[0], q[3], q[2]]
        deco.poly(q, ind, uv=[(0, 0), (1, 0), (1, 1), (0, 1)])

    r = w / 2
    for s in sides:
        sg = -1 if s == "-x" else 1
        xf = cx + sg * (w / 2 + 0.002)
        y0, y1 = r + 0.05, L - r - 0.05
        # slim dark sensor windows either side of the flap slot
        for ya, yb in ((y0, L / 2 - 0.09), (L / 2 + 0.09, y1)):
            q = [(xf, ya, 0.535), (xf, yb, 0.535), (xf, yb, 0.555), (xf, ya, 0.555)]
            deco.poly(q if sg > 0 else q[::-1], "gteki_plastic_dark")
        # flap slot (dark recess outline)
        ym = L / 2
        if sg > 0:
            deco.quad((xf, ym - 0.03, 0.42), (xf, ym + 0.03, 0.42), (xf, ym + 0.03, 0.86), (xf, ym - 0.03, 0.86), "gteki_reveal_dark")
        else:
            deco.quad((xf, ym + 0.03, 0.42), (xf, ym - 0.03, 0.42), (xf, ym - 0.03, 0.86), (xf, ym + 0.03, 0.86), "gteki_reveal_dark")

    a.col_box(f"cabinet_{idx}", [cx - w / 2 - 0.008, 0.0, 0.0], [cx + w / 2 + 0.008, L, H])


def _flap(a, name, x_face, sg, y_mid, protrude):
    """Fan-shaped flap door retracted into the cabinet; `sg` = direction toward the aisle."""
    f = a.part(f"flap_{name}", bevel=0.004, bevel_segments=2)
    reach, R = 0.30, 0.14
    z0, z1 = 0.42, 0.84
    # local profile: u = distance from the hidden inner end toward the aisle
    u_out = reach
    local = [(0.0, z0), (u_out, z0), (u_out, z1 - R)]
    for k in range(1, 7):
        ang = math.radians(90 * k / 6)
        local.append((u_out - R + math.cos(ang) * R, z1 - R + math.sin(ang) * R))
    local.append((0.0, z1))
    x_in = x_face - sg * (reach - protrude)
    prof = [(x_in + sg * u, z) for u, z in local]
    if sg < 0:  # mirroring flips the winding; restore CCW (viewed from -Y)
        prof.reverse()
    f.extrude_y(prof, y_mid - 0.011, y_mid + 0.011, "gteki_plastic_dark")
    # rubber leading edge
    xe = x_face + sg * protrude
    xa, xb = sorted((xe, xe - sg * 0.012))
    f.box([xa, y_mid - 0.013, z0], [xb, y_mid + 0.013, z1 - R], "gteki_rubber_black")


def gate_array(asset_id, params, tex_res):
    p = _p(params)
    n = int(p["aisles"])
    wide = set(int(i) for i in p["wide_aisles"])
    widths = [p["wide_w"] if i in wide else p["aisle_w"] for i in range(n)]
    w = p["cab_w"]
    total = sum(widths) + (n + 1) * w
    a = Asset(asset_id, "gate", asset_id.replace("gteki_gate_", ""), p, GEN, contract.GENERIC_TYPICAL, tex_res)

    x = -total / 2
    cab_x = []
    aisle_c = []
    for i in range(n + 1):
        cab_x.append(x + w / 2)
        x += w
        if i < n:
            aisle_c.append(x + widths[i] / 2)
            x += widths[i]
    for i, cx in enumerate(cab_x):
        sides = []
        if i > 0:
            sides.append("-x")
        if i < n:
            sides.append("+x")
        _cabinet(a, i, cx, p, sides)

    L = p["cab_len"]
    for i, ac in enumerate(aisle_c):
        hw = widths[i] / 2
        # left flap lives in the cabinet on the aisle's -x side and opens toward +x
        _flap(a, f"{i}_L", ac - hw, 1, L / 2, 0.010)
        _flap(a, f"{i}_R", ac + hw, -1, L / 2, 0.010)

    if p["floor_plate"]:
        fp = a.part("floor", bevel=0.002, bevel_segments=1)
        m = 0.30
        fp.box([-total / 2 - 0.05, -m, -0.0], [total / 2 + 0.05, L + m, 0.006], "gteki_floor_granite_dark", skip=("-z",))

    # keep the contract's entry edge at y=0: the approach plate starts there
    m = 0.30 if p["floor_plate"] else 0.0
    a.shift.y = m
    p["aisle_centers_x_m"] = [round(c, 4) for c in aisle_c]
    p["aisle_widths_m"] = widths
    p["flap_close_dx_m"] = [round(wd / 2 - 0.010 - 0.01, 4) for wd in widths]
    p["total_width_m"] = round(total, 4)
    p["cabinet_span_z_m"] = [round(-m, 4), round(-(m + L), 4)]  # glTF z of cabinet entry / exit faces
    a.socket("start", (0, -m, 0), 180.0, width=round(total, 4), height=p["cab_h"])
    a.socket("end", (0, L + m, 0), 0.0, width=round(total, 4), height=p["cab_h"])
    return a


GENERATORS = {"gate_array": gate_array}
