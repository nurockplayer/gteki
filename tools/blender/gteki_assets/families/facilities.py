"""Facility anchor kit: the entrance to a room a station knows only as a point (toilets).

Generators:
  toilet_entrance  wall-mounted portal surround + toilet sign for one room entrance

Why this exists: the GSI indoor data gives Shinjuku one representative point per space,
not an equipment position (F001 / F002 / F003 = toilet male / female / unisex, see
docs/assets/gap-list.md finding 5). The kit therefore draws only what is visible from the
concourse: the trim around an opening the station already has in its wall, a sign, and an
optional privacy screen stub just inside. It never draws the room: no fixtures, no door
leaf, no floor, no ceiling.

Frame (docs/assets/asset-contract.md, `wall` placement): the wall plane is y = 0, the room
the sign faces is toward -Y (glTF +Z), and the wall's thickness recesses toward +Y (glTF -Z).
The origin is on the floor, centred on the opening. X is across the opening (+X is the
viewer's right). Everything sits at z >= 0.

  trim     jamb and lintel trim, `trim_proud_mm` proud of the wall face, flush with the opening
  reveal   thin lining of the opening through the wall (`wall_depth_mm`; 0 = none)
  frame    sign frame and standoff (aluminium, same idiom as signage.sign_wall)
  faces    ONE emissive quad per sign, own 0..1 UV island, material
           `gteki_sign_face_toilet_<kind>` (swap it at runtime like any sign face)
  screen   optional maze / privacy screen stub, a free-standing slab behind the wall

Pictograms are the one place the kit draws a symbol, and they are drawn here, not copied: a
signed-distance texture (same method as `signage.sign_face`) of circles, capsules, rounded
rectangles and convex polygons. They follow the general idea of public-information symbols
(ISO 7001 / JIS Z8210 style: a standing figure, a figure in a dress, a seated figure with a
wheel) but every shape and proportion below is GTEki's own; no artwork was traced or
imported. No text, no operator marks. Stations that want wording or a different symbol swap
the face material, as for any sign.

Collision: the opening is never blocked. The only colliders are a thin box on each jamb trim
(the skin proud of the wall; the station's wall collider owns the wall itself) and, when
present, the screen stub. Nothing spans the opening and nothing sits across the floor in it.

Dimensions: opening sizes are widely published typical values for a single door and a shared
maze entrance (`dimension_basis` generic-typical); trim, sign and screen sizes are look-dev
(synthetic). No station measurement lives here.
"""

import zlib

import numpy as np

from .. import contract, materials, texsynth
from ..asset import Asset
from .signage import (
    ALU,
    DARK,
    PT_Y,
    K,
    _cov,
    _choice,
    _face_grid,
    _face_stack,
    _finish_maps,
    _merge,
    _mix,
    _sd_poly,
    _sd_rect,
    finish,
)

GEN = "tools/blender/gteki_assets/families/facilities.py"
TEX_V = 1  # bump when the pictogram generator below changes output (part of the material spec hash)

KINDS = ("male", "female", "unisex", "accessible", "pair")
ASPECT = {"pair": 2.0}  # face width / height; every other kind is square
TRIMS = {
    "aluminium": ALU,
    "brushed": "gteki_steel_brushed",
    "dark": "gteki_steel_painted_dark",
    "accent": "gteki_gate_accent",
    "enamel": "gteki_wall_panel_enamel",
}
ENAMEL = "gteki_wall_panel_enamel"
KICK = "gteki_steel_painted_dark"

# ---------------------------------------------------------------------------
# pictogram texture (own shapes, signed-distance fields in figure-local units)
# ---------------------------------------------------------------------------

BLUE = (0.05, 0.24, 0.55)  # male field
RED = (0.70, 0.12, 0.18)  # female field
NAVY = (0.03, 0.085, 0.23)  # unisex / accessible field (same as the wayfinding navy)
INK = (0.97, 0.97, 0.96)
RIM = (0.86, 0.89, 0.93)
FIELDS = {"male": BLUE, "female": RED, "unisex": NAVY, "accessible": NAVY}

FIG_H = 0.60  # figure height as a fraction of the face height


def _sd_circle(x, y, cx, cy, r):
    return np.hypot(x - cx, y - cy) - r


def _sd_capsule(x, y, ax, ay, bx, by, r):
    """Segment a-b with round ends of radius r."""
    px, py, dx, dy = x - ax, y - ay, bx - ax, by - ay
    h = np.clip((px * dx + py * dy) / (dx * dx + dy * dy), 0.0, 1.0)
    return np.hypot(px - dx * h, py - dy * h) - r


def _union(*sds):
    out = sds[0]
    for s in sds[1:]:
        out = np.minimum(out, s)
    return out


def _legs(x, y, half_gap, top, r):
    return [_sd_capsule(x, y, s * half_gap, top, s * half_gap, 0.05, r) for s in (-1, 1)]


def _fig_male(x, y):
    """Head, rounded torso, two arms hanging clear of it, two straight legs."""
    parts = [_sd_circle(x, y, 0.0, 0.905, 0.085), _sd_rect(x, y, 0.0, 0.635, 0.115, 0.165, 0.05)]
    parts += [_sd_capsule(x, y, s * 0.175, 0.735, s * 0.195, 0.46, 0.04) for s in (-1, 1)]
    parts += _legs(x, y, 0.062, 0.50, 0.052)
    return None, _union(*parts)


# A-line dress: shoulders at the top, hem wider, convex and counter-clockwise.
_DRESS = [(-0.105, 0.80), (-0.215, 0.30), (0.215, 0.30), (0.105, 0.80)]
_DRESS_RIGHT = [(0.0, 0.30), (0.215, 0.30), (0.105, 0.80), (0.0, 0.80)]


def _arms_dress(x, y):
    return [_sd_capsule(x, y, s * 0.150, 0.745, s * 0.225, 0.47, 0.036) for s in (-1, 1)]


def _fig_female(x, y):
    """Head, shoulders and an A-line dress, two arms, two short legs under the hem."""
    parts = [_sd_circle(x, y, 0.0, 0.905, 0.085), _sd_poly(x, y, _DRESS), _sd_rect(x, y, 0.0, 0.765, 0.115, 0.04, 0.04)]
    parts += _arms_dress(x, y)
    parts += _legs(x, y, 0.052, 0.34, 0.040)
    return None, _union(*parts)


def _fig_unisex(x, y):
    """One figure, trousered on the left and in a dress on the right, split by a thin gap."""
    left = [_sd_rect(x, y, -0.0605, 0.635, 0.0545, 0.165, 0.03), _sd_capsule(x, y, -0.062, 0.50, -0.062, 0.05, 0.052),
            _sd_capsule(x, y, -0.175, 0.735, -0.195, 0.46, 0.04)]
    right = [_sd_poly(x, y, _DRESS_RIGHT), _sd_capsule(x, y, 0.150, 0.745, 0.225, 0.47, 0.036),
             _sd_capsule(x, y, 0.052, 0.34, 0.052, 0.05, 0.040)]
    whole = _union(_sd_circle(x, y, 0.0, 0.905, 0.085), *left, *right)
    return None, np.maximum(whole, 0.009 - np.abs(x))


def _fig_accessible(x, y):
    """A seated figure and one large wheel. The wheel is drawn first and the figure is haloed
    in the field colour so the two stay readable where they cross."""
    x = x + 0.0125  # centre the figure and wheel on the plate
    wheel_ring = np.abs(_sd_circle(x, y, -0.06, 0.28, 0.255)) - 0.0275
    person = _union(
        _sd_circle(x, y, -0.06, 0.905, 0.083),
        _sd_capsule(x, y, -0.085, 0.745, -0.10, 0.47, 0.075),  # torso, leaning back a little
        _sd_capsule(x, y, -0.10, 0.455, 0.16, 0.455, 0.055),  # thigh along the seat
        _sd_capsule(x, y, 0.16, 0.455, 0.235, 0.115, 0.048),  # shin
        _sd_capsule(x, y, 0.235, 0.085, 0.325, 0.085, 0.040),  # foot
        _sd_capsule(x, y, -0.06, 0.68, 0.095, 0.575, 0.040),  # arm
    )
    return wheel_ring, person


FIGURES = {"male": _fig_male, "female": _fig_female, "unisex": _fig_unisex, "accessible": _fig_accessible}


def _draw_figure(img, X, Y, cx, y0, S, fig, field, aa):
    x, y = (X - cx) / S, (Y - y0) / S
    under, over = fig(x, y)
    if under is not None:
        img = _mix(img, INK, _cov(under * S, aa))
        img = _mix(img, field, _cov((over - 0.03) * S, aa))
    return _mix(img, INK, _cov(over * S, aa))


def toilet_pictogram(res, seed, kind="male", aspect=1.0, v=TEX_V):
    """Toilet sign face: colour field, inner rule and one or two figures. Physical frame:
    height 1, width `aspect` (pair: male | female halves in blue and red)."""
    Wd, Ht = aspect, 1.0
    u, vv = _face_grid(res, Wd, Ht)
    X, Y = u * Wd, vv * Ht
    aa = max(Wd, Ht) / res * 1.1
    img = np.empty(u.shape + (3,), np.float32)
    if kind == "pair":
        img[:] = np.where((X < Wd / 2)[..., None], np.asarray(BLUE, np.float32), np.asarray(RED, np.float32))
    else:
        img[:] = np.asarray(FIELDS[kind], np.float32)
    edge = np.minimum(np.minimum(u, 1 - u), np.minimum(vv, 1 - vv))
    img *= (0.94 + 0.06 * np.clip(edge / 0.15, 0, 1))[..., None]  # gentle light-box falloff
    sd_rim = np.abs(_sd_rect(X, Y, Wd / 2, 0.5, Wd / 2 - 0.045, 0.5 - 0.045, 0.06)) - 0.007
    img = _mix(img, RIM, _cov(sd_rim, aa))
    y0 = 0.5 - FIG_H / 2
    if kind == "pair":
        img = _mix(img, RIM, _cov(np.abs(X - Wd / 2) - 0.006, aa) * _cov(np.abs(Y - 0.5) - 0.5 + 0.09, aa))
        img = _draw_figure(img, X, Y, Wd / 2 - 0.5, y0, FIG_H, _fig_male, BLUE, aa)
        img = _draw_figure(img, X, Y, Wd / 2 + 0.5, y0, FIG_H, _fig_female, RED, aa)
    else:
        img = _draw_figure(img, X, Y, Wd / 2, y0, FIG_H, FIGURES[kind], FIELDS[kind], aa)
    return _finish_maps(img, res, seed)


texsynth.GENERATORS["toilet_pictogram"] = toilet_pictogram


def face_material(kind, aspect):
    """Register (idempotent) and return the emissive face material for a toilet sign face."""
    canon = ASPECT.get(kind, 1.0)
    tag = "" if abs(aspect / canon - 1.0) < 0.04 else "_a%d" % round(aspect * 100)
    name = f"gteki_sign_face_toilet_{kind}{tag}"
    materials.register(
        name,
        gen="toilet_pictogram",
        repeat_m=0.5 if canon < 1.5 else 1.0,
        seed=zlib.crc32(name.encode()) % 90000 + 1000,
        kw=dict(kind=kind, aspect=round(canon if not tag else aspect, 3), v=TEX_V),
        emit_from_albedo=True,
        emit_strength=1.5,
    )
    return name


# ---------------------------------------------------------------------------
# generator
# ---------------------------------------------------------------------------

DEFAULTS = dict(
    kind="male",
    opening_w_mm=1200,  # clear width between the jamb trims
    opening_h_mm=2100,  # clear height under the lintel trim
    wall_depth_mm=150,  # wall thickness lined by the reveal; 0 draws no reveal
    trim="aluminium",
    trim_w_mm=80,  # visible width of jamb and lintel trim
    trim_proud_mm=25,  # how far the trim stands off the wall face
    sign_pos="above",  # above | left | right | none
    sign_mm=300,  # outer height of the sign plate (a pair plate is twice as wide)
    sign_gap_mm=60,  # above: lintel trim to plate; left/right: trim to plate edge is `sign_side_gap_mm`
    sign_side_gap_mm=150,
    sign_centre_mm=1450,  # left/right: height of the plate centre
    screen="none",  # none | maze (privacy screen stub just inside the opening)
    screen_gap_mm=900,  # clear gap between the wall's back face and the screen
    screen_overlap_mm=150,  # how far the screen reaches past each side of the opening
    screen_t_mm=60,
    screen_h_mm=1900,
)

BAR = 0.022  # sign frame bar
GASKET = 0.006
DEPTH = 0.035  # sign plate depth from the wall plane
STANDOFF = 0.008  # shadow gap between wall and plate
RECESS = 0.008  # face sits this far behind the frame front
LINER = 0.012  # thickness of the reveal lining


def _one_face(kit, mn, mx, mat, face):
    """A box of which only `face` is drawn (a thin lining seen from one side)."""
    kit.box(mn, mx, mat, skip=tuple(k for k in ("-x", "+x", "-y", "+y", "-z", "+z") if k != face))


def toilet_entrance(asset_id, params, tex_res):
    """Portal surround and sign for a toilet entrance. Wall plane y = 0, room toward -Y."""
    p = _merge(DEFAULTS, params)
    _choice(p, "kind", KINDS)
    _choice(p, "trim", tuple(TRIMS))
    _choice(p, "sign_pos", ("above", "left", "right", "none"))
    _choice(p, "screen", ("none", "maze"))
    for key in ("opening_w_mm", "opening_h_mm", "trim_w_mm", "trim_proud_mm", "sign_mm"):
        if not p[key] > 0:
            raise ValueError(f"{key} must be positive, got {p[key]!r}")
    if not 700 <= p["opening_w_mm"] <= 3000 or not 1800 <= p["opening_h_mm"] <= 2600:
        raise ValueError("opening must be 0.7-3.0 m wide and 1.8-2.6 m high")
    if p["wall_depth_mm"] < 0 or p["screen_gap_mm"] < 600 or p["screen_t_mm"] <= 0 or p["screen_overlap_mm"] < 0:
        raise ValueError("wall_depth_mm >= 0, screen_gap_mm >= 600 (a walker must fit), screen_t_mm > 0, screen_overlap_mm >= 0")
    if not 1.0 <= p["sign_centre_mm"] / 1000 <= 1.8 or not 150 <= p["sign_mm"] <= 600:
        raise ValueError("sign_centre_mm must be 1.0-1.8 m and sign_mm 150-600")
    if not 1200 <= p["screen_h_mm"] <= p["opening_h_mm"]:
        raise ValueError("screen_h_mm must be 1.2 m up to the opening height")
    w, h = p["opening_w_mm"] / 1000, p["opening_h_mm"] / 1000
    tw, proud, depth = p["trim_w_mm"] / 1000, p["trim_proud_mm"] / 1000, p["wall_depth_mm"] / 1000
    trim_mat = TRIMS[p["trim"]]
    kind = p["kind"]
    a = Asset(asset_id, "facilities", asset_id.replace("gteki_", ""), p, GEN, contract.GENERIC_TYPICAL, tex_res,
              notes="Entrance trim for a room the station already has in its wall; no fixtures, door or room are modelled. "
                    "Wall plane y=0, room toward -Y, wall thickness toward +Y. Sign face is gteki_sign_face_toilet_<kind>: swap it for other wording.")

    # --- jamb and lintel trim, standing `proud` off the wall, inner edges flush with the opening
    trim = K(a, "trim", bevel=0.003, bevel_segments=1)
    for s in (-1, 1):
        xa, xb = sorted((s * w / 2, s * (w / 2 + tw)))
        trim.box((xa, -proud, 0), (xb, 0, h + tw), trim_mat, skip=("-z", "+y"))  # jambs run to the top of the lintel
    trim.box((-w / 2, -proud, h), (w / 2, 0, h + tw), trim_mat, skip=("-x", "+x", "+y"))

    # --- reveal: the opening's lining through the wall thickness
    if depth > 0:
        rev = K(a, "reveal")
        _one_face(rev, (w / 2, 0, 0), (w / 2 + LINER, depth, h), ENAMEL, "-x")
        _one_face(rev, (-w / 2 - LINER, 0, 0), (-w / 2, depth, h), ENAMEL, "+x")
        _one_face(rev, (-w / 2, 0, h), (w / 2, depth, h + LINER), ENAMEL, "-z")

    # --- sign plate: aluminium frame, dark gasket, one emissive face, standoff block
    aspect = ASPECT.get(kind, 1.0)
    sh = p["sign_mm"] / 1000
    face_h = sh - 2 * BAR - 2 * GASKET
    face_w = aspect * face_h
    sw = face_w + 2 * BAR + 2 * GASKET
    sign_mid = None
    if p["sign_pos"] != "none":
        if p["sign_pos"] == "above":
            sx, z0 = 0.0, h + tw + p["sign_gap_mm"] / 1000
        else:
            side = -1 if p["sign_pos"] == "left" else 1
            sx = side * (w / 2 + tw + p["sign_side_gap_mm"] / 1000 + sw / 2)
            z0 = p["sign_centre_mm"] / 1000 - sh / 2
        z1 = z0 + sh
        outer = (sx - sw / 2, sx + sw / 2, z0, z1)
        inner = (outer[0] + BAR, outer[1] - BAR, z0 + BAR, z1 - BAR)
        frame = K(a, "frame", bevel=0.002, bevel_segments=1)
        frame.ring(PT_Y, outer, inner, -DEPTH, -STANDOFF, ALU, back=True)
        gasket = K(a, "frame", bevel=0.001, bevel_segments=1)
        faces = K(a, "faces")
        _face_stack(frame, gasket, faces, PT_Y, inner, -DEPTH + RECESS, -1, face_material(kind, face_w / face_h))
        stand = K(a, "frame", bevel=0.0015, bevel_segments=1)
        stand.box((outer[0] + 0.02, -STANDOFF, z0 + 0.02), (outer[1] - 0.02, 0, z1 - 0.02), DARK, skip=("+y",))
        sign_mid = (sx, z0 + sh / 2)
        a.light_hint("sign", (sx, -DEPTH, z0 - 0.02), kind="panel", size_m=round(min(sw, 0.5) * 0.6, 2), watts=round(min(12.0, 30.0 * sw * sh), 1), colour_temp_k=5000)

    # --- optional privacy / maze screen stub behind the wall: a plain slab with a dark kick plate
    if p["screen"] == "maze":
        sx0, sx1 = -(w / 2 + p["screen_overlap_mm"] / 1000), w / 2 + p["screen_overlap_mm"] / 1000
        sy0 = depth + p["screen_gap_mm"] / 1000
        sy1 = sy0 + p["screen_t_mm"] / 1000
        sh_ = p["screen_h_mm"] / 1000
        scr = K(a, "screen", bevel=0.003, bevel_segments=1)
        scr.box((sx0, sy0, 0), (sx1, sy1, sh_), ENAMEL, skip=("-z",))
        kick = K(a, "screen", bevel=0.002, bevel_segments=1)
        kick.box((sx0 - 0.004, sy0 - 0.004, 0), (sx1 + 0.004, sy1 + 0.004, 0.10), KICK, skip=("-z",))

    finish(a)

    # --- collision: jamb trims and the screen only; the opening stays clear
    for name, s in (("jamb_left", -1), ("jamb_right", 1)):
        xa, xb = sorted((s * w / 2, s * (w / 2 + tw)))
        a.col_box(name, (xa, -proud, 0), (xb, 0, h))
    if p["screen"] == "maze":
        a.col_box("screen", (sx0, sy0, 0), (sx1, sy1, sh_))

    # --- sockets: the wall opening (mating the station's wall) and the sign
    a.socket("wall", (0, 0, 0), 0.0, width=w, height=h, kind="wall_opening")
    if sign_mid:
        a.socket("sign", (sign_mid[0], -DEPTH, sign_mid[1]), 180.0, width=round(sw, 4), height=round(sh, 4), kind="sign_face")
    return a


GENERATORS = {"toilet_entrance": toilet_entrance}
