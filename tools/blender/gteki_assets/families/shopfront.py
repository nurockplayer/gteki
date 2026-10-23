"""Shopfront panel modules (generic, unbranded): glazing, door, roller shutter and fascia.

Generator:
  shopfront   one bay of a shop front, ``kind`` = glazing | door | shutter | fascia
                glazing  fixed glass over a stallboard, mid mullions by ``panes``
                door     pair of glass leaves with pull bars, jambs, threshold and a glass transom
                shutter  roller shutter (closed, or raised by ``shutter_open``) in guides under a housing
                fascia   the sign band alone, any width, to run over several bays

Frame (Blender; the exporter turns -Y into +Z): wall-backed. The back plane is y = 0 (the wall
face) and the bay projects toward -Y, the origin is on the floor under the bay centre. Bays chain
along X through the ``left`` and ``right`` sockets: each bay carries half a mullion on each side,
so two neighbours make one full ``mullion_mm`` post. A bay is ``bay_w_mm`` wide overall and
``height_mm`` tall including the fascia.

The fascia is a blank sign slot with no brand and no text. Its art face is one quad, material
``gteki_fascia_art`` (a flat warm white, lit from within), with its own 0..1 UV island; a station
or a later 2D pass swaps the material or its texture by name. Draw the art at the aspect recorded
in ``params.fascia_aspect`` (face width / face height). ``fascia_u`` selects the part of the art
a bay shows, so one wide sign can run across several chained bays (bay 1 ``[0, 0.5]``, bay 2
``[0.5, 1]``).

Pieces are visual only: the station's wall blocks. ``backing`` puts a dark plane behind the glass
and the shutter so the bay reads as a shop interior; turn it off where the station models one.

Dimensions are synthetic look-dev values (``dimension_basis`` synthetic): a 300 mm stallboard,
2100 mm doors, 600 mm fascia, 60 mm mullions. Nothing is measured at any station.
"""

import numpy as np

from .. import contract, materials, texsynth
from ..asset import Asset
from .signage import ALU, K, PT_Y, _choice, face_quad, finish

GEN = "tools/blender/gteki_assets/families/shopfront.py"
TEX_V = 1  # bump when fascia_blank changes output (part of the material spec hash)

FASCIA = "gteki_fascia_art"
GLASS = "gteki_glass_clear"
DARK_STEEL = "gteki_steel_painted_dark"
LIGHT_STEEL = "gteki_steel_painted_light"
BRUSHED = "gteki_steel_brushed"
ENAMEL = "gteki_wall_panel_enamel"
BACKING = "gteki_reveal_dark"

KINDS = ("glazing", "door", "shutter", "fascia")
DEFAULTS = dict(
    kind="glazing", bay_w_mm=2400, height_mm=2800, fascia_h_mm=600, mullion_mm=60, frame_depth_mm=90,
    sill_mm=300, panes=0, door_h_mm=2100, shutter_open=0.0, housing_h_mm=250,
    fascia=True, backing=True, fascia_u=[0.0, 1.0],
)
HEAD = 0.07  # head rail below the fascia and above the door
FASCIA_BAR = 0.025  # frame around the art face
FASCIA_RECESS = 0.012


# ---------------------------------------------------------------------------
# fascia slot material: a flat blank face, kept apart from the palette in the mobile tier
# ---------------------------------------------------------------------------


def fascia_blank(res, seed, base=(0.90, 0.90, 0.88), rough=0.45, v=TEX_V):
    """Constant warm white, so the build exports it as material factors (no image). It is
    generated rather than a plain colour because only a content material (`emit_from_albedo`)
    stays its own material in the mobile tier instead of folding into the palette, and the
    swap-by-name slot has to survive there."""
    albedo = np.empty((res, res, 3), np.float32)
    albedo[:] = base
    flat = np.zeros((res, res), np.float32)
    return texsynth._out(albedo, texsynth.normal_from_height(flat, strength=1.0),
                         np.full((res, res), rough, np.float32), flat)


texsynth.GENERATORS["fascia_blank"] = fascia_blank
materials.register(FASCIA, gen="fascia_blank", repeat_m=0.5, seed=7101, kw=dict(v=TEX_V),
                   emit_from_albedo=True, emit_strength=1.0)


def _params(params):
    p = dict(DEFAULTS)
    p.update(params or {})
    return p


def _positive(p, *keys):
    for key in keys:
        value = p[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(f"{key} must be a positive number")


def _mm(v):
    return round(v / 1000.0, 5)


def _leaf(frame, glass, x0, x1, z0, z1, y0=-0.065, y1=-0.025):
    """Glass door leaf: aluminium stiles and rails around a pane."""
    stile, top, bot = 0.05, 0.07, 0.14
    frame.box((x0, y0, z0), (x0 + stile, y1, z1), ALU, skip=("-z",))
    frame.box((x1 - stile, y0, z0), (x1, y1, z1), ALU, skip=("-z",))
    frame.box((x0 + stile, y0, z0), (x1 - stile, y1, z0 + bot), ALU, skip=("-z",))
    frame.box((x0 + stile, y0, z1 - top), (x1 - stile, y1, z1), ALU)
    glass.box((x0 + stile, y0 + 0.015, z0 + bot), (x1 - stile, y1 - 0.015, z1 - top), GLASS)


def _curtain_profile(z0, z1, pitch):
    """Slatted curtain section in the (y, z) plane, CCW viewed from +X: flat back, ridged front."""
    yb, yg, yf = -0.032, -0.038, -0.044
    n = max(1, round((z1 - z0) / pitch))
    p = (z1 - z0) / n
    pts = [(yg, z0), (yb, z0), (yb, z1)]
    for i in range(n, 0, -1):
        pts += [(yg, z0 + i * p), (yf, z0 + i * p - p / 2)]
    return pts


def shopfront(asset_id, params, tex_res):
    p = _params(params)
    _choice(p, "kind", KINDS)
    _positive(p, "bay_w_mm", "height_mm", "fascia_h_mm", "mullion_mm", "frame_depth_mm")
    for key in ("fascia", "backing"):
        _choice(p, key, (True, False))
    u0, u1 = p["fascia_u"]
    if not 0.0 <= u0 < u1 <= 1.0:
        raise ValueError("fascia_u must be [u0, u1] with 0 <= u0 < u1 <= 1")
    p["fascia_u"] = [u0, u1]
    kind = p["kind"]
    W, H, fh, m, fd = _mm(p["bay_w_mm"]), _mm(p["height_mm"]), _mm(p["fascia_h_mm"]), _mm(p["mullion_mm"]), _mm(p["frame_depth_mm"])
    has_fascia = kind == "fascia" or p["fascia"]
    top = H - fh if has_fascia else H  # top of the glazed / shuttered zone
    if H <= fh + (0.0 if kind == "fascia" else 1.2):
        raise ValueError("height_mm must leave at least 1200 mm below the fascia")
    if W < 0.6 or m * 3 > W:
        raise ValueError("bay_w_mm must be at least 600 mm and wider than three mullions")
    xl, xr, hm = -W / 2, W / 2, m / 2
    xi0, xi1 = xl + hm, xr - hm
    a = Asset(asset_id, "shopfront", asset_id.replace("gteki_shopfront_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes="Visual-only shop front bay; wall plane y=0, projecting toward -Y; chain through the left/right sockets. "
                    "Fascia art face: material gteki_fascia_art, own 0..1 UV island, swap by name; draw it at params.fascia_aspect.")
    frame = K(a, "frame", bevel=0.002, bevel_segments=1)
    panels = K(a, "panels", bevel=0.003, bevel_segments=1)
    glass = K(a, "glass")
    back = K(a, "backing")
    nb = ("+y", "-z")  # faces against the wall and the floor stay out

    if kind != "fascia":
        frame.box((xl, -fd, 0), (xl + hm, 0, top), ALU, skip=nb)
        frame.box((xr - hm, -fd, 0), (xr, 0, top), ALU, skip=nb)
        if kind != "shutter":  # the shutter housing closes the top itself
            frame.box((xi0, -fd, top - HEAD), (xi1, 0, top), ALU, skip=("+y",))
    if kind == "glazing":
        sill = _mm(p["sill_mm"])
        if not 0 < sill < top - HEAD - 0.4:
            raise ValueError("sill_mm must leave at least 400 mm of glass")
        panels.box((xi0, -0.07, 0), (xi1, 0, 0.08), DARK_STEEL, skip=nb)
        panels.box((xi0, -0.06, 0.08), (xi1, 0, sill), ENAMEL, skip=nb)
        frame.box((xi0, -0.075, sill), (xi1, 0, sill + 0.03), ALU, skip=("+y",))
        g0, g1 = sill + 0.03, top - HEAD
        n = p["panes"] or max(1, round((xi1 - xi0) / 1.5))
        if isinstance(n, bool) or not isinstance(n, int) or n < 1:
            raise ValueError("panes must be a positive integer (0 = by width)")
        xs = [xi0 + (xi1 - xi0) * i / n for i in range(n + 1)]
        for i in range(1, n):
            frame.box((xs[i] - hm, -fd, g0), (xs[i] + hm, 0, g1), ALU, skip=("+y",))
        for i in range(n):
            ga = xs[i] + (hm if i else 0.0)
            gb = xs[i + 1] - (hm if i + 1 < n else 0.0)
            glass.box((ga, -0.05, g0), (gb, -0.044, g1), GLASS)
        if p["backing"]:
            face_quad(back.part, PT_Y, (xi0, xi1, g0, g1), -0.02, BACKING, True)
    elif kind == "door":
        dh = _mm(p["door_h_mm"])
        gap = top - dh  # room above the door for a head rail, or a rail, a transom and the top rail
        if not 1.8 <= dh or gap < HEAD:
            raise ValueError("door_h_mm must be at least 1800 mm and leave 70 mm below the fascia")
        transom = gap >= 2 * HEAD + 0.1
        head = dh + HEAD if transom else top - HEAD
        jamb = 0.04
        leaf_w = (xi1 - xi0 - 2 * jamb) / 2
        if leaf_w < 0.4:
            raise ValueError("bay_w_mm is too narrow for a door pair")
        frame.box((xi0, -fd, 0), (xi1, 0, 0.01), BRUSHED, skip=("+y",))  # threshold
        frame.box((xi0, -0.08, 0.01), (xi0 + jamb, 0, head), ALU, skip=("+y",))
        frame.box((xi1 - jamb, -0.08, 0.01), (xi1, 0, head), ALU, skip=("+y",))
        if head > dh:
            frame.box((xi0 + jamb, -0.08, dh), (xi1 - jamb, 0, head), ALU, skip=("+y",))
        xm = (xi0 + xi1) / 2
        _leaf(frame, glass, xi0 + jamb, xm - 0.002, 0.01, dh)
        _leaf(frame, glass, xm + 0.002, xi1 - jamb, 0.01, dh)
        for x in (xm - 0.06, xm + 0.06):  # vertical pull bars at the meeting stiles
            frame.box((x - 0.015, -0.1, 0.9), (x + 0.015, -0.065, 1.6), BRUSHED)
        g0, g1 = head, top - HEAD
        if transom:
            glass.box((xi0, -0.05, g0), (xi1, -0.044, g1), GLASS)
        if p["backing"]:
            face_quad(back.part, PT_Y, (xi0 + jamb, xi1 - jamb, 0.01, dh), -0.02, BACKING, True)
            if transom:
                face_quad(back.part, PT_Y, (xi0, xi1, g0, g1), -0.02, BACKING, True)
    elif kind == "shutter":
        hb = _mm(p["housing_h_mm"])
        oh = top - hb  # clear opening under the housing
        up = p["shutter_open"]
        if isinstance(up, bool) or not isinstance(up, (int, float)) or not 0.0 <= up <= 0.9:
            raise ValueError("shutter_open must be from 0 (closed) to 0.9 (nearly raised)")
        if oh < 1.2 or hb <= 0:
            raise ValueError("housing_h_mm leaves too little opening")
        rail = 0.06  # guide rails
        # the housing hangs above the opening: only its wall face stays out, the underside is seen from below
        panels.box((xi0, -0.13, oh), (xi1, 0, top), LIGHT_STEEL, skip=("+y",))
        frame.box((xi0, -0.08, 0), (xi0 + rail, 0, oh), BRUSHED, skip=nb)
        frame.box((xi1 - rail, -0.08, 0), (xi1, 0, oh), BRUSHED, skip=nb)
        xc0, xc1 = xi0 + rail, xi1 - rail
        if p["backing"]:
            face_quad(back.part, PT_Y, (xc0, xc1, 0.0, oh), -0.02, BACKING, True)
        zb = up * oh  # bottom rail
        frame.box((xc0, -0.06, zb), (xc1, -0.02, zb + 0.05), DARK_STEEL, skip=("+y",) if zb else nb)
        if oh - (zb + 0.05) > 0.1:
            curtain = K(a, "curtain")
            curtain.extrude_x(_curtain_profile(zb + 0.05, oh, 0.15 if a.profile == "mobile" else 0.075),
                              xc0, xc1, LIGHT_STEEL, cap_mat=LIGHT_STEEL)
    if has_fascia:
        fz0 = H - fh
        if fh < 2 * FASCIA_BAR + 0.1:
            raise ValueError("fascia_h_mm is too small for a sign face")
        fdf = fd + 0.05  # the sign band stands proud of the glazing
        outer = (xl, xr, fz0, H)
        inner = (xl + FASCIA_BAR, xr - FASCIA_BAR, fz0 + FASCIA_BAR, H - FASCIA_BAR)
        p["fascia_aspect"] = round((inner[1] - inner[0]) / (inner[3] - inner[2]), 3)
        K(a, "fascia", bevel=0.003, bevel_segments=1).ring(PT_Y, outer, inner, -fdf, 0.0, ALU, back=False)
        face_quad(K(a, "art").part, PT_Y, inner, -fdf + FASCIA_RECESS, FASCIA, True, (u0, u1, 0.0, 1.0))
        a.light_hint("fascia", (0.0, -fdf - 0.02, (fz0 + H) / 2), kind="panel",
                     size_m=round(min(inner[1] - inner[0], inner[3] - inner[2]) * 0.8, 2), watts=15.0, colour_temp_k=4000)
    a.socket("left", (xl, 0, 0), 90.0, width=0.1, height=H)
    a.socket("right", (xr, 0, 0), -90.0, width=0.1, height=H)
    return finish(a)


GENERATORS = {"shopfront": shopfront}
