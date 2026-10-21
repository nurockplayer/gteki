"""Station furniture and equipment kit props (generic, unbranded).

Generators:
  bench            free-standing station bench, 3-4 seats, armrest dividers, perforated or slatted seat
  bin_trio         3-compartment recycling bin unit (colour-coded, round / slot / square openings)
  poster_lightbox  wall-mounted poster light box (glass front, poster via gteki_poster_0N)
  vending_machine  generic drink vending machine (lit window, abstract bottles/cans, buttons)
  column_clad      structural column cladding, round or square, kick plate, optional corner guards
  tactile_strip    tactile walking-indicator floor inlay strip (dots / bars), 0.3 m blocks
  barrier_rail     paid/unpaid boundary railing segment with chaining sockets
  ticket_kiosk     generic ticket / fare-charge machine with tilted touch screen and IC pad

Frame conventions (docs/assets/asset-contract.md): front faces Blender -Y (glTF +Z).
Wall-backed items (bin_trio, poster_lightbox, vending_machine, ticket_kiosk) have their
back plane at y = 0 and extend toward -Y, origin on the floor under the back centre,
so they can be placed against a wall face. Free-standing items (bench, column_clad,
barrier_rail, tactile_strip) are centred on their floor footprint; barrier_rail runs
along X (it extends a gate line), tactile_strip runs along +Y like the passage modules.

Dimensions: `dimension_basis` is synthetic (look-dev values, not measured anywhere),
except tactile_strip, whose 300 mm block pitch / 5x5 dots and bar layout follow the
widely published JIS T 9251 family (generic-typical) and poster_lightbox, whose
default poster area (0.73 x 1.03 m) is the widely published B1 sheet size
(generic-typical).

No logos, brand names, packaging, text, digits or pictograms: drinks are abstract
colour shapes, the bins carry colour only, screens are generic colour-block UIs.
"""

import hashlib
import math
import os
import zlib

import numpy as np
from mathutils import Matrix, Vector

from .. import contract, materials, texsynth
from ..asset import Asset
from ..mesh import rounded_rect
from .signage import (  # noqa: F401  (shared geometry helpers, see signage.py)
    ALU,
    DARK,
    PT_X,
    PT_Y,
    K,
    Kit,
    _choice,
    _face_stack,
    _merge,
    _sd_rect,
    _cov,
    _mix,
    _weld,
    face_quad,
    finish,
)

GEN = "tools/blender/gteki_assets/families/props.py"
TEX_V = 1

STEEL = "gteki_stainless_polished"
STEELB = "gteki_steel_brushed"

# ---------------------------------------------------------------------------
# materials (generic; names stay stable so runtime can swap by name)
# ---------------------------------------------------------------------------

_R = materials.register
_R(STEEL, color=(0.80, 0.81, 0.82), rough=0.24, metal=1.0)
_R("gteki_perforated_steel", gen="perforated_metal", repeat_m=0.3, seed=2311, kw=dict(v=TEX_V))
_R("gteki_plastic_light", color=(0.86, 0.87, 0.86), rough=0.35)
_R("gteki_plastic_glossy_dark", color=(0.025, 0.027, 0.03), rough=0.12)
_R("gteki_bin_blue", color=(0.07, 0.30, 0.62), rough=0.32)
_R("gteki_bin_green", color=(0.10, 0.48, 0.26), rough=0.32)
_R("gteki_bin_orange", color=(0.88, 0.42, 0.08), rough=0.32)
_R("gteki_bin_grey", color=(0.45, 0.47, 0.49), rough=0.32)
for _n, _c in (("slate", (0.20, 0.27, 0.34)), ("graphite", (0.13, 0.14, 0.15)), ("sage", (0.36, 0.47, 0.42)), ("sand", (0.70, 0.64, 0.52))):
    _R(f"gteki_vending_body_{_n}", color=_c, rough=0.28)
_R("gteki_vending_accent", color=(0.90, 0.90, 0.87), rough=0.3)
_R("gteki_vending_backlight", color=(0.9, 0.92, 0.93), rough=0.4, emit=(0.95, 0.97, 1.0), emit_strength=1.7)
_R("gteki_vending_header", color=(0.85, 0.88, 0.9), rough=0.4, emit=(0.85, 0.93, 1.0), emit_strength=2.0)
for _n, _c in (("tea", (0.45, 0.55, 0.12)), ("orange", (0.95, 0.50, 0.08)), ("red", (0.80, 0.12, 0.10)), ("blue", (0.15, 0.40, 0.80)),
               ("brown", (0.30, 0.15, 0.07)), ("clear", (0.62, 0.80, 0.88)), ("cream", (0.92, 0.88, 0.75)), ("violet", (0.45, 0.22, 0.60))):
    _R(f"gteki_drink_{_n}", color=_c, rough=0.3, emit=_c, emit_strength=1.3)
_R("gteki_glass_vending", color=(0.55, 0.62, 0.66), rough=0.04, alpha=0.07)
_R("gteki_kiosk_accent", color=(0.06, 0.34, 0.42), rough=0.3)
_R("gteki_screen_ui", gen="ui_screen", repeat_m=1.0, seed=4417, kw=dict(aspect=1.333, v=TEX_V), emit_from_albedo=True, emit_strength=1.5)
_R("gteki_emissive_amber", color=(0.30, 0.16, 0.02), rough=0.25, emit=(1.0, 0.6, 0.1), emit_strength=3.5)

POSTER_DIR = "assets/library/source/posters"
POSTER_ASPECT = 2.0 / 3.0  # source JPEGs are portrait 2:3


# ---------------------------------------------------------------------------
# extra texture: generic touch-screen UI (colour blocks only, no text)
# ---------------------------------------------------------------------------


def ui_screen(res, seed, aspect=1.333, v=TEX_V):
    """Dark UI with a top bar, a 3x2 grid of colour tiles with blank labels and a bottom pill row.
    Drawn for a face of width/height = aspect (pre-distorted onto the square texture)."""
    yy, xx = np.mgrid[0:res, 0:res].astype(np.float32)
    u, vv = (xx + 0.5) / res, 1.0 - (yy + 0.5) / res
    X, Y = u * aspect, vv
    aa = max(aspect, 1.0) / res * 1.1
    img = np.empty((res, res, 3), np.float32)
    img[:] = np.asarray((0.03, 0.07, 0.13), np.float32)
    inner = _cov(_sd_rect(X, Y, aspect / 2, 0.5, aspect / 2 - 0.02, 0.5 - 0.02), aa)  # dark margin: no wrap-around bleed
    # top bar + blank title pill
    img = _mix(img, (0.06, 0.34, 0.46), _cov(_sd_rect(X, Y, aspect / 2, 0.93, aspect / 2, 0.07), aa))
    img = _mix(img, (0.80, 0.90, 0.95), _cov(_sd_rect(X, Y, 0.45, 0.93, 0.28, 0.018, 0.018), aa))
    img = _mix(img, (0.35, 0.8, 0.5), _cov(np.hypot(X - (aspect - 0.1), Y - 0.93) - 0.03, aa))
    pal = [(0.10, 0.45, 0.70), (0.90, 0.62, 0.12), (0.16, 0.58, 0.40), (0.72, 0.28, 0.30), (0.45, 0.35, 0.70), (0.20, 0.55, 0.65)]
    cw, ch = (aspect - 0.2 - 0.08) / 3, 0.30
    for r in range(2):
        for c in range(3):
            cx = 0.1 + cw / 2 + c * (cw + 0.04)
            cy = 0.66 - r * (ch + 0.05)
            img = _mix(img, pal[r * 3 + c], _cov(_sd_rect(X, Y, cx, cy, cw / 2, ch / 2, 0.04), aa))
            img = _mix(img, (0.95, 0.96, 0.96), _cov(_sd_rect(X, Y, cx, cy - ch * 0.28, cw * 0.32, 0.018, 0.018), aa) * 0.9)
            img = _mix(img, (1.0, 1.0, 1.0), _cov(np.hypot(X - cx, Y - (cy + ch * 0.1)) - 0.05, aa) * 0.85)
    for c in range(3):
        cx = 0.1 + cw / 2 + c * (cw + 0.04)
        img = _mix(img, (0.18, 0.28, 0.38) if c < 2 else (0.85, 0.55, 0.10), _cov(_sd_rect(X, Y, cx, 0.075, cw / 2, 0.04, 0.04), aa))
    img = img * inner[..., None] + 0.02 * (1 - inner[..., None])
    n = texsynth.spectral_noise(res, seed, beta=0.8)
    img = img * (0.985 + 0.03 * n)[..., None]
    normal = texsynth.normal_from_height(n * 0.02, strength=0.3)
    rough = np.full((res, res), 0.2, np.float32)
    return texsynth._out(img, normal, rough, np.zeros_like(rough))


texsynth.GENERATORS["ui_screen"] = ui_screen


def _rot_pt(c, rot_x, off):
    v = Matrix.Rotation(math.radians(rot_x), 3, "X") @ Vector(off)
    return (c[0] + v.x, c[1] + v.y, c[2] + v.z)


def _asset(asset_id, prefix, p, tex_res, basis=contract.SYNTHETIC, notes=None):
    return Asset(asset_id, "props", asset_id.replace(prefix, "") or asset_id, p, GEN, basis, tex_res, notes=notes)


# ---------------------------------------------------------------------------
# bench
# ---------------------------------------------------------------------------


def bench(asset_id, params, tex_res):
    """Free-standing station bench. Origin: floor centre of the footprint, seats face -Y."""
    p = _merge(dict(length=2.4, seats=4, depth=0.42, seat_height=0.45, style="perforated", frame="stainless", backrest=True, tube_r=0.0125), params)
    _choice(p, "style", ("perforated", "slat"))
    _choice(p, "frame", ("stainless", "painted"))
    L, n, D, zs, tr = p["length"], int(p["seats"]), p["depth"], p["seat_height"], p["tube_r"]
    a = _asset(asset_id, "gteki_", p, tex_res, notes="Seats face -Y; armrest dividers at every frame line.")
    fm = STEEL if p["frame"] == "stainless" else "gteki_steel_painted_dark"
    yf, yb = -D / 2 + 0.035, D / 2 - 0.035
    xs = [-L / 2 + 0.06 + (L - 0.12) * i / n for i in range(n + 1)]
    zt = zs - 0.036  # centre line of the under-seat tube
    back_lean = 0.05  # backrest upright leans back by this much over its height
    z_top = zs + 0.36

    def y_up(z):
        return (yb - 0.01) + back_lean * (z - zt) / (z_top - zt)

    frames = K(a, "frame")
    pads = K(a, "frame", bevel=0.002, bevel_segments=1)
    for x in xs:
        frames.tube([(x, yf, 0.0), (x, yf, zt), (x, yb - 0.01, zt), (x, yb - 0.01, 0.0)], tr, fm, segments=8, corner_radius=0.07, corner_steps=3)
        for y in (yf, yb - 0.01):
            pads.box((x - 0.03, y - 0.04, 0), (x + 0.03, y + 0.04, 0.007), "gteki_rubber_black")
        # armrest: front post up from the rail, over, into the rear upright
        arm = [(x, yf + 0.05, zt), (x, yf + 0.05, zs + 0.20), (x, y_up(zs + 0.20), zs + 0.20)]
        if not p["backrest"]:
            arm.append((x, y_up(zs + 0.20), zt))
        frames.tube(arm, tr, fm, segments=8, corner_radius=0.045, corner_steps=3, caps=True)
        if p["backrest"]:
            frames.tube([(x, y_up(zt), zt), (x, y_up(z_top), z_top)], tr, fm, segments=8)
    frames.tube([(xs[0], 0.0, zt), (xs[-1], 0.0, zt)], tr * 0.8, fm, segments=8)  # cross beam under the seats
    seat_mat = "gteki_perforated_steel" if p["style"] == "perforated" else STEELB
    top = [(-0.21, 0.004), (-0.12, 0.0005), (0.0, -0.003), (0.12, 0.0005), (0.21, 0.006)]
    pan = K(a, "seat", bevel=0.003, bevel_segments=1)
    for i in range(n):
        x0, x1 = xs[i] + tr + 0.012, xs[i + 1] - tr - 0.012
        if p["style"] == "perforated":
            prof = [(y, zs + dz - 0.022) for y, dz in top] + [(y, zs + dz) for y, dz in reversed(top)]
            pan.extrude_x(prof, x0, x1, seat_mat, cap_mat=STEELB)
        else:
            for k in range(4):
                y0 = -0.205 + k * 0.1025
                pan.box((x0, y0, zs - 0.022), (x1, y0 + 0.088, zs), seat_mat)
        if p["backrest"]:
            zc = zs + 0.26
            yc = y_up(zc) - (tr + 0.009)
            ang = -math.degrees(math.atan2(back_lean, z_top - zt))
            pan.xbox((0.5 * (x0 + x1), yc, zc), (0.5 * (x1 - x0), 0.007, 0.095), seat_mat, rot_x=ang, mats={"-x": STEELB, "+x": STEELB})
    return finish(a, collision="bench")


# ---------------------------------------------------------------------------
# bin_trio
# ---------------------------------------------------------------------------

BIN_COLOURS = {"blue": "gteki_bin_blue", "green": "gteki_bin_green", "orange": "gteki_bin_orange", "grey": "gteki_bin_grey"}


def bin_trio(asset_id, params, tex_res):
    """Three-compartment recycling unit. Back at y = 0; colour coding only (no text/pictograms)."""
    p = _merge(dict(width=1.26, depth=0.45, height=1.05, colours=["blue", "green", "orange"], openings=["round", "slot", "square"]), params)
    W, D, H = p["width"], p["depth"], p["height"]
    cols, opens = list(p["colours"]), list(p["openings"])
    for c in cols:
        _choice({"c": c}, "c", tuple(BIN_COLOURS))
    for o in opens:
        _choice({"o": o}, "o", ("round", "slot", "square"))
    a = _asset(asset_id, "gteki_", p, tex_res, notes="Colour-coded fronts; openings round / slot / square. Back plane at y=0.")
    cw = W / 3
    body = K(a, "body", bevel=0.005, bevel_segments=1)
    body.box((-W / 2 + 0.004, -D + 0.03, 0.08), (W / 2 - 0.004, 0, H - 0.07), "gteki_steel_painted_dark")
    body.box((-W / 2 + 0.03, -D + 0.05, 0), (W / 2 - 0.03, -0.01, 0.08), "gteki_steel_painted_dark")
    fronts = K(a, "fronts", bevel=0.004, bevel_segments=1)
    cap = K(a, "cap", bevel=0.009, bevel_segments=2)
    cap.box((-W / 2 - 0.01, -D - 0.012, H - 0.07), (W / 2 + 0.01, 0, H), STEELB)
    plates = K(a, "plates", bevel=0.003, bevel_segments=1)
    handles = K(a, "handles", bevel=0.002, bevel_segments=1)
    zc = H - 0.285
    for i in range(3):
        cx = -W / 2 + (i + 0.5) * cw
        x0, x1 = cx - cw / 2 + 0.006, cx + cw / 2 - 0.006
        mat = BIN_COLOURS[cols[i % len(cols)]]
        fronts.box((x0, -D, 0.62), (x1, -D + 0.03, H - 0.08), mat)  # coloured header panel
        fronts.box((x0, -D, 0.10), (x1, -D + 0.03, 0.60), STEELB)  # stainless door
        # opening plate (proud) with a recessed dark floor
        h = 0.11
        o = opens[i % len(opens)]
        outer = (cx - h, cx + h, zc - h, zc + h)
        d0, d1 = -D - 0.018, -D - 0.002
        if o == "round":
            plates.ring_radial(PT_Y, (cx, zc), 0.066, h, d0, d1, STEEL, hole_mat=DARK, bottom_mat=DARK, n=16, d_back=-D + 0.004)
        else:
            hw, hh = (0.078, 0.013) if o == "slot" else (0.07, 0.07)
            inner = (cx - hw, cx + hw, zc - hh, zc + hh)
            plates.ring(PT_Y, outer, inner, d0, -D + 0.004, STEEL, inner_mat=DARK)
            face_quad(plates.part, PT_Y, inner, d1, DARK, True)
        # door handle
        hz = 0.43
        handles.box((cx - 0.06, -D - 0.026, hz - 0.007), (cx + 0.06, -D - 0.012, hz + 0.007), STEEL)
        for sx in (-0.05, 0.05):
            handles.box((cx + sx - 0.006, -D - 0.012, hz - 0.006), (cx + sx + 0.006, -D, hz + 0.006), STEEL)
    return finish(a, collision="bins")


# ---------------------------------------------------------------------------
# poster_lightbox
# ---------------------------------------------------------------------------


def poster_lightbox(asset_id, params, tex_res):
    """Wall-mounted poster light box. Back at y = 0; poster area default 0.73 x 1.03 m (B1)."""
    p = _merge(dict(poster=1, width=0.80, height=1.10, depth=0.07, bar=0.035, mount_height=0.9, poster_image=None), params)
    n = int(p["poster"])
    if not 1 <= n <= 8:
        raise ValueError("poster must be 1..8")
    W, H, D, bar = p["width"], p["height"], p["depth"], p["bar"]
    z0, z1 = p["mount_height"], p["mount_height"] + H
    mname = f"gteki_poster_0{n}"
    rel = p["poster_image"] or f"{POSTER_DIR}/poster_0{n}.jpg"
    rights = None
    if p["poster_image"]:
        # one material per image, so posters sharing a number but not an image can coexist
        mname = "gteki_poster_custom_" + hashlib.sha256(os.path.normpath(rel).encode()).hexdigest()[:8]
        # the kit's provenance and licence cover only its own posters (assets/library/PROVENANCE.md)
        rights = (p.get("poster_provenance"), p.get("poster_license"))
        if not all(isinstance(x, str) and x.strip() for x in rights):
            raise ValueError("poster_image requires params.poster_provenance and params.poster_license "
                             "(non-empty strings) describing the supplied artwork")
    if not os.path.exists(materials.repo_path(rel)):
        raise FileNotFoundError(f"poster image {rel} not found (pass params.poster_image to override)")
    materials.register(mname, image=rel, emit_image=True, emit_strength=1.2, rough=0.15)
    a = _asset(asset_id, "gteki_", p, tex_res, basis=contract.GENERIC_TYPICAL,
               notes="Poster area defaults to the widely published B1 sheet (0.73 x 1.03 m) inside a 35 mm frame; poster art maps with cover-fit crop of a 2:3 image. Back plane at y=0.")
    if rights:
        a.provenance = f"{contract.PROVENANCE}; poster image {rel}: {rights[0]}"
        a.license = f"poster image: {rights[1]}; everything else: {contract.LICENSE}"
    gap = 0.012
    outer = (-W / 2, W / 2, z0, z1)
    inner = (-W / 2 + bar, W / 2 - bar, z0 + bar, z1 - bar)
    frame = K(a, "frame", bevel=0.0035, bevel_segments=2)
    frame.ring(PT_Y, outer, inner, -D, -gap, ALU)
    gasket = K(a, "frame", bevel=0.001, bevel_segments=1)
    faces = K(a, "faces")
    fw, fh = inner[1] - inner[0] - 0.012, inner[3] - inner[2] - 0.012
    fa = fw / fh
    if fa > POSTER_ASPECT:  # face is wider than the image: crop top/bottom
        vs = POSTER_ASPECT / fa
        uv = (0.0, 1.0, 0.5 - vs / 2, 0.5 + vs / 2)
    else:
        us = fa / POSTER_ASPECT
        uv = (0.5 - us / 2, 0.5 + us / 2, 0.0, 1.0)
    d_face = -D + 0.024
    _face_stack(frame, gasket, faces, PT_Y, inner, d_face, -1, mname, uv_rect=uv)
    # glass pane in front of the poster, recessed behind the rim
    gl = K(a, "glass")
    gin = (inner[0] + 0.006, inner[1] - 0.006, inner[2] + 0.006, inner[3] - 0.006)
    face_quad(gl.part, PT_Y, gin, -D + 0.011, "gteki_glass_clear", True)
    stand = K(a, "frame", bevel=0.002, bevel_segments=1)
    stand.box((-W / 2 + 0.03, -gap, z0 + 0.03), (W / 2 - 0.03, 0, z1 - 0.03), DARK, skip=("+y",))
    a.light_hint("poster", (0, -D, z0 + H / 2), kind="panel", size_m=round(min(W, H) * 0.8, 2), watts=25.0, colour_temp_k=5000)
    return finish(a, collision="box" if z0 < 2.05 else None)


# ---------------------------------------------------------------------------
# vending_machine
# ---------------------------------------------------------------------------

DRINKS = ["gteki_drink_tea", "gteki_drink_orange", "gteki_drink_red", "gteki_drink_blue", "gteki_drink_brown", "gteki_drink_clear", "gteki_drink_cream", "gteki_drink_violet"]


def vending_machine(asset_id, params, tex_res):
    """Generic drink vending machine. Back at y = 0, front toward -Y. No logos or packaging."""
    p = _merge(dict(width=1.0, depth=0.75, height=1.83, body="slate", rows=4, seed=7), params)
    _choice(p, "body", ("slate", "graphite", "sage", "sand"))
    W, D, H = p["width"], p["depth"], p["height"]
    rows = int(p["rows"])
    BODY = f"gteki_vending_body_{p['body']}"
    a = _asset(asset_id, "gteki_", p, tex_res, notes="Display window holds abstract unbranded bottle/can shapes; header panel (gteki_vending_header) is blank for runtime art.")
    rng = np.random.default_rng(p["seed"])
    yC = -D + 0.16  # carcass front / window back
    xl, xr = -W / 2, W / 2
    win = (xl + 0.05, xl + 0.63, 0.64, 1.66)
    pick = (xl + 0.10, xl + 0.58, 0.13, 0.50)
    # carcass + plinth
    car = K(a, "body", bevel=0.01, bevel_segments=2)
    car.box((xl, yC, 0.07), (xr, 0, H), BODY)
    pl = K(a, "body", bevel=0.004, bevel_segments=1)
    pl.box((xl + 0.03, -D + 0.05, 0), (xr - 0.03, -0.02, 0.07), "gteki_steel_painted_dark")
    # front fascia with window and pickup openings
    fas = K(a, "fascia", bevel=0.006, bevel_segments=2)
    fas.plate(PT_Y, (xl, xr, 0.07, H), [(win, "gteki_vending_backlight"), (pick, DARK)], -D, yC, BODY, back=False)
    # window: back wall, bezel, glass, shelves, drinks
    lit = K(a, "window")
    face_quad(lit.part, PT_Y, win, yC - 0.003, "gteki_vending_backlight", True)
    bez = K(a, "trim", bevel=0.0025, bevel_segments=1)
    bez.ring(PT_Y, (win[0] - 0.014, win[1] + 0.014, win[2] - 0.014, win[3] + 0.014), win, -D - 0.005, -D + 0.004, ALU, front=True, back=False)
    glass = K(a, "glass")
    face_quad(glass.part, PT_Y, win, -D + 0.012, "gteki_glass_vending", True)
    shelf = K(a, "window", bevel=0.002, bevel_segments=1)
    tags = K(a, "window")
    pitch_z = (win[3] - win[2] - 0.04) / rows
    cols_n = 8
    pitch_x = (win[1] - win[0] - 0.02) / cols_n
    bot = K(a, "drinks")
    can = K(a, "drinks")
    for r in range(rows):
        zsf = win[2] + 0.02 + r * pitch_z
        shelf.box((win[0], yC - 0.13, zsf - 0.008), (win[1], yC - 0.003, zsf), "gteki_plastic_light")
        shelf.box((win[0], yC - 0.135, zsf - 0.008), (win[1], yC - 0.13, zsf + 0.012), STEEL)
        for c in range(cols_n):  # blank price tags on the shelf lip
            tx = win[0] + 0.01 + (c + 0.5) * pitch_x
            tags.box((tx - 0.026, yC - 0.1375, zsf - 0.004), (tx + 0.026, yC - 0.135, zsf + 0.0095), "gteki_plastic_light")
        kind = "bottle" if r % 2 == 0 else "can"
        order = list(rng.permutation(len(DRINKS)))
        for c in range(cols_n):
            cx = win[0] + 0.01 + (c + 0.5) * pitch_x
            col = DRINKS[order[(c // 2) % len(order)]]
            col2 = DRINKS[order[(c // 2 + 3) % len(order)]]
            cy = yC - 0.075
            if kind == "bottle":
                prof = [(0.0, 0.0), (0.029, 0.0), (0.0335, 0.01), (0.0335, 0.045), (0.0335, 0.125), (0.0225, 0.150), (0.0125, 0.168), (0.0125, 0.192), (0.0145, 0.194), (0.0145, 0.205), (0.0, 0.205)]
                mats = [col, col, col, col2, col, col, col, "gteki_drink_cream", "gteki_drink_cream", "gteki_drink_cream"]
                bot.lathe((cx, cy, zsf), prof, col, segments=8, mats=mats)
            else:
                for t in range(2):
                    zb = zsf + t * 0.1175
                    can.cylinder((cx, cy, zb), 0.0325, 0.115, col, segments=8, cap_mat=ALU)
    # label bands on cans
    bands = K(a, "drinks")
    for r in range(rows):
        if r % 2 == 1:
            zsf = win[2] + 0.02 + r * pitch_z
            for c in range(cols_n):
                cx = win[0] + 0.01 + (c + 0.5) * pitch_x
                col2 = DRINKS[list(rng.permutation(len(DRINKS)))[0]]
                for t in range(2):
                    zb = zsf + t * 0.1175
                    bands.cylinder((cx, yC - 0.075, zb + 0.035), 0.0346, 0.045, col2, segments=8, caps=(False, False))
    # header: blank emissive panel
    hdr = K(a, "trim", bevel=0.002, bevel_segments=1)
    hdr.box((xl + 0.06, -D - 0.004, H - 0.125), (xr - 0.06, -D, H - 0.045), "gteki_vending_header", skip=("+y",))
    # accent band under window
    hdr.box((win[0], -D - 0.003, 0.535), (win[1], -D, 0.605), "gteki_vending_accent", skip=("+y",))
    # control column
    cx0, cx1 = xl + 0.67, xl + 0.96
    cz0, cz1 = 0.72, 1.64
    ctl = K(a, "controls", bevel=0.004, bevel_segments=1)
    ctl.box((cx0, -D - 0.008, cz0), (cx1, -D, cz1), "gteki_plastic_glossy_dark")
    ccx = (cx0 + cx1) / 2
    ctl.box((cx0 + 0.02, -D - 0.011, 1.54), (cx1 - 0.02, -D - 0.008, 1.60), "gteki_screen_lcd")
    btn = K(a, "controls", bevel=0.0015, bevel_segments=1)
    dots = K(a, "dots")
    sold = {3, 8}
    k = 0
    for r in range(5):
        for c in range(2):
            bx = ccx + (c - 0.5) * 0.1
            bz = 1.40 - r * 0.078
            btn.box((bx - 0.026, -D - 0.022, bz - 0.014), (bx + 0.026, -D - 0.008, bz + 0.014), "gteki_plastic_light")
            dm = "gteki_emissive_red" if k in sold else "gteki_emissive_green"
            dots.box((bx - 0.026, -D - 0.011, bz + 0.024), (bx - 0.014, -D - 0.008, bz + 0.032), dm)
            k += 1
    # bill slot, coin slot, IC pad, coin return
    btn.box((cx0 + 0.035, -D - 0.014, 1.0), (cx1 - 0.07, -D - 0.008, 1.06), STEEL)
    btn.box((cx0 + 0.045, -D - 0.0165, 1.02), (cx1 - 0.08, -D - 0.014, 1.04), DARK)
    btn.box((cx1 - 0.055, -D - 0.014, 0.98), (cx1 - 0.015, -D - 0.008, 1.08), STEEL)
    btn.box((cx1 - 0.043, -D - 0.0165, 1.00), (cx1 - 0.027, -D - 0.014, 1.06), DARK)
    btn.box((ccx - 0.05, -D - 0.014, 0.84), (ccx + 0.05, -D - 0.008, 0.94), "gteki_steel_painted_dark")
    btn.box((ccx - 0.035, -D - 0.0175, 0.855), (ccx + 0.035, -D - 0.014, 0.925), "gteki_emissive_ic_blue")
    btn.box((ccx - 0.07, -D - 0.016, 0.74), (ccx + 0.07, -D - 0.008, 0.80), DARK)
    btn.box((ccx - 0.012, -D - 0.022, 0.755), (ccx + 0.012, -D - 0.016, 0.785), STEEL)
    # pickup pocket floor + flap
    pk = K(a, "pickup", bevel=0.003, bevel_segments=1)
    face_quad(pk.part, PT_Y, pick, yC - 0.003, DARK, True)
    pcx = (pick[0] + pick[1]) / 2
    pk.xbox((pcx, -D + 0.03, 0.315), (0.225, 0.006, 0.165), "gteki_plastic_glossy_dark", rot_x=7.0)
    pk.xbox(_rot_pt((pcx, -D + 0.03, 0.315), 7.0, (0, -0.012, -0.17)), (0.12, 0.007, 0.0075), STEEL, rot_x=7.0)
    a.light_hint("window", ((win[0] + win[1]) / 2, -D, (win[2] + win[3]) / 2), kind="panel", size_m=0.5, watts=24.0, colour_temp_k=5000)
    return finish(a, collision="body")


# ---------------------------------------------------------------------------
# column_clad
# ---------------------------------------------------------------------------

BODY_MAT = {"enamel": "gteki_wall_panel_enamel", "enamel_accent": "gteki_wall_panel_accent", "tile": "gteki_wall_tile_white", "tile_accent": "gteki_wall_tile_accent"}


def _corner_band(sx, sy, hx, hy, rc, wing, t, steps=4):
    """Stainless corner-guard outline (CCW) hugging the rounded corner of a (2hx x 2hy) column."""
    cx, cy = hx - rc, hy - rc
    outer = [(cx + rc + t, cy - wing)]
    arc_o, arc_i = [], []
    for s in range(steps + 1):
        a_ = math.radians(90.0 * s / steps)
        arc_o.append((cx + (rc + t) * math.cos(a_), cy + (rc + t) * math.sin(a_)))
        arc_i.append((cx + rc * math.cos(a_), cy + rc * math.sin(a_)))
    pts = outer + arc_o + [(cx - wing, cy + rc + t), (cx - wing, cy + rc)] + arc_i[::-1] + [(cx + rc, cy - wing)]
    pts = [(sx * x, sy * y) for x, y in pts]
    return pts[::-1] if sx * sy < 0 else pts


def column_clad(asset_id, params, tex_res):
    """Structural column cladding. Origin: floor centre of the column; height to ceiling."""
    p = _merge(dict(shape="round", size=0.6, height=2.8, overrun=0.0, kick=0.18, body="enamel", guards=True, band=True, seams=4, segments=40, corner_radius=0.03), params)
    _choice(p, "shape", ("round", "square"))
    _choice(p, "body", tuple(BODY_MAT))
    s, H, ov, kick = p["size"], p["height"], p["overrun"], p["kick"]
    seg = int(p["segments"])
    a = _asset(asset_id, "gteki_", p, tex_res, notes="size = diameter (round) or side (square); overrun extends the body above the ceiling plane to hide the joint.")
    bm = BODY_MAT[p["body"]]
    top = H + ov
    reveal = 0.03 if ov <= 0 else 0.0
    body = K(a, "body", bevel=0.003, bevel_segments=1)
    trim = K(a, "trim", bevel=0.003, bevel_segments=1)
    dark = K(a, "trim")
    zb = 1.1
    if p["shape"] == "round":
        r = s / 2
        trim.cylinder((0, 0, 0), r + 0.005, kick, STEELB, segments=seg, cap_mat=STEELB, caps=(False, True))
        body.cylinder((0, 0, kick), r, top - reveal - kick, bm, segments=seg, cap_mat=bm, caps=(False, True))
        if reveal:
            dark.cylinder((0, 0, top - reveal), r - 0.008, reveal, "gteki_reveal_dark", segments=seg, caps=(False, True))
        if p["band"]:
            trim.cylinder((0, 0, zb), r + 0.0035, 0.035, STEELB, segments=seg, cap_mat=STEELB)
        if p["seams"]:  # vertical panel joints: slim dark strips set 2 mm proud of the cladding
            for k in range(int(p["seams"])):
                th = math.radians(45.0 + 360.0 * k / p["seams"])
                tx, ty = -math.sin(th), math.cos(th)
                rx, ry = math.cos(th), math.sin(th)
                w = 0.0035
                quad = [(rx * (r - 0.004) + tx * w, ry * (r - 0.004) + ty * w), (rx * (r + 0.002) + tx * w, ry * (r + 0.002) + ty * w),
                        (rx * (r + 0.002) - tx * w, ry * (r + 0.002) - ty * w), (rx * (r - 0.004) - tx * w, ry * (r - 0.004) - ty * w)]
                dark.prism(quad[::-1], kick, top - reveal, "gteki_reveal_dark", skip_bottom=True)
    else:
        h = s / 2
        rc = p["corner_radius"]
        prof = rounded_rect(-h, -h, h, h, rc, steps=3)
        kp = rounded_rect(-h - 0.005, -h - 0.005, h + 0.005, h + 0.005, rc + 0.005, steps=3)
        trim.prism(kp, 0, kick, STEELB, cap_mat=STEELB, smooth_sides=True, skip_bottom=True)
        body.prism(prof, kick, top - reveal, bm, cap_mat=bm, smooth_sides=True, skip_bottom=True)
        if reveal:
            dark.prism(rounded_rect(-h + 0.008, -h + 0.008, h - 0.008, h - 0.008, rc, steps=3), top - reveal, top, "gteki_reveal_dark", smooth_sides=True, skip_bottom=True, skip_top=False)
        if p["band"]:
            trim.prism(rounded_rect(-h - 0.0035, -h - 0.0035, h + 0.0035, h + 0.0035, rc + 0.0035, steps=3), zb, zb + 0.035, STEELB, cap_mat=STEELB, smooth_sides=True)
        if p["guards"]:
            for sx in (-1, 1):
                for sy in (-1, 1):
                    trim.prism(_corner_band(sx, sy, h, h, rc, 0.045, 0.004), kick, 1.5, STEEL, cap_mat=STEEL, smooth_sides=True)
    return finish(a, collision="column")


# ---------------------------------------------------------------------------
# tactile_strip
# ---------------------------------------------------------------------------

BLOCK = 0.3


def tactile_strip(asset_id, params, tex_res):
    """Tactile walking-indicator inlay. Runs along +Y from y=0; one 0.3 m block = one texture repeat.

    Block pitch (300 mm; 5x5 domes / 4 bars) follows the widely published JIS T 9251 family:
    dimension_basis generic-typical. The top face is mapped from the strip's own start corner,
    so blocks always align with the texture repeat regardless of placement."""
    p = _merge(dict(length=3.0, width=0.3, kind="dots", height=0.004), params)
    _choice(p, "kind", ("dots", "bars"))
    nx = max(1, round(p["width"] / BLOCK))
    ny = max(1, round(p["length"] / BLOCK))
    p["width"], p["length"] = round(nx * BLOCK, 4), round(ny * BLOCK, 4)
    Wd, Ln, h = p["width"], p["length"], p["height"]
    mat = f"gteki_tactile_{p['kind']}"
    a = _asset(asset_id, "gteki_", p, tex_res, basis=contract.GENERIC_TYPICAL,
               notes="Floor overlay 4 mm high; sits on z=0. Texture repeat = one 300 mm block; bars run along the strip (+Y).")
    k = K(a, "strip", bevel=0.003, bevel_segments=1)
    n0 = k.mark()
    k.part.box((-Wd / 2, 0, 0), (Wd / 2, Ln, h), mat, skip=("+z", "-z"))
    uv = [((x + Wd / 2) / BLOCK, y / BLOCK) for x, y in ((-Wd / 2, 0), (Wd / 2, 0), (Wd / 2, Ln), (-Wd / 2, Ln))]
    k.part.quad((-Wd / 2, 0, h), (Wd / 2, 0, h), (Wd / 2, Ln, h), (-Wd / 2, Ln, h), mat, smooth=False, uv=uv)
    k.weld(n0)
    a.socket("start", (0, 0, 0), 180.0, width=Wd, height=h)
    a.socket("end", (0, Ln, 0), 0.0, width=Wd, height=h)
    return finish(a)


# ---------------------------------------------------------------------------
# barrier_rail
# ---------------------------------------------------------------------------


def barrier_rail(asset_id, params, tex_res):
    """Paid/unpaid boundary railing segment along X (centred), sockets at both ends."""
    p = _merge(dict(length=3.6, height=1.1, post_spacing=1.2, infill="glass", end_posts="both", post_r=0.028, rail_r=0.02, panel_colour="gteki_wall_panel_enamel"), params)
    _choice(p, "infill", ("glass", "solid", "rails", "none"))
    _choice(p, "end_posts", ("both", "start", "end", "none"))
    L, H, pr, rr = p["length"], p["height"], p["post_r"], p["rail_r"]
    n_span = max(1, round(L / p["post_spacing"]))
    xs = [-L / 2 + L * i / n_span for i in range(n_span + 1)]
    a = _asset(asset_id, "gteki_", p, tex_res, notes="Chain by coinciding start/end sockets; set end_posts to start/end/none to avoid doubled posts. Runs along X, symmetric front/back.")
    post_idx = list(range(n_span + 1))
    if p["end_posts"] in ("end", "none"):
        post_idx.remove(0)
    if p["end_posts"] in ("start", "none"):
        post_idx.remove(n_span)
    zr = H - 0.075  # top-rail centre line
    posts = K(a, "posts")
    plates = K(a, "posts", bevel=0.003, bevel_segments=1)
    for i in post_idx:
        x = xs[i]
        plates.cylinder((x, 0, 0), 0.07, 0.012, STEELB, segments=20, cap_mat=STEELB, caps=(False, True))
        arc = [(pr * math.cos(math.radians(t)), (H - pr) + pr * math.sin(math.radians(t))) for t in (22.5, 45, 67.5)]
        prof = [(0.034, 0.012), (0.034, 0.05), (pr, 0.056), (pr, H - pr)] + arc + [(0.0, H)]
        posts.lathe((x, 0, 0), prof, STEEL, segments=18, rep=1.0)
    rails = K(a, "rails", bevel=0.002, bevel_segments=1)
    rails.tube([(xs[0], 0, zr), (xs[-1], 0, zr)], rr, STEEL, segments=12)
    inf = p["infill"]
    glass = K(a, "glass")
    clamps = K(a, "rails", bevel=0.0015, bevel_segments=1)
    solid = K(a, "infill", bevel=0.004, bevel_segments=1)
    for i in range(n_span):
        xa, xb = xs[i] + pr + 0.012, xs[i + 1] - pr - 0.012
        if i == 0 and 0 not in post_idx:
            xa = xs[0]
        if i == n_span - 1 and n_span not in post_idx:
            xb = xs[-1]
        z_lo, z_hi = 0.15, zr - rr - 0.012
        if inf in ("glass", "solid"):
            clamps.box((xa, -0.025, 0.07), (xb, 0.025, 0.125), STEELB)  # bottom channel
        if inf == "glass":
            glass.box((xa + 0.004, -0.006, z_lo), (xb - 0.004, 0.006, z_hi), "gteki_glass_clear")
            for xc in (xa + 0.03, xb - 0.03):
                for zc in (z_lo + 0.03, z_hi - 0.03):
                    clamps.box((xc - 0.016, -0.019, zc - 0.016), (xc + 0.016, 0.019, zc + 0.016), STEEL)
        elif inf == "solid":
            solid.box((xa, -0.016, z_lo), (xb, 0.016, z_hi), p["panel_colour"])
        elif inf == "rails":
            for zq in (0.30, 0.62):
                rails.tube([(xs[i], 0, zq), (xs[i + 1], 0, zq)], rr * 0.8, STEEL, segments=10)
    a.socket("start", (-L / 2, 0, 0), 90.0, width=0.1, height=H)
    a.socket("end", (L / 2, 0, 0), -90.0, width=0.1, height=H)
    return finish(a, collision="rail")


# ---------------------------------------------------------------------------
# ticket_kiosk
# ---------------------------------------------------------------------------


def ticket_kiosk(asset_id, params, tex_res):
    """Generic ticket / fare machine. Back at y = 0, front toward -Y. No text."""
    p = _merge(dict(width=0.7, depth=0.6, height=1.75, accent=True), params)
    W, D, H = p["width"], p["depth"], p["height"]
    xl, xr = -W / 2, W / 2
    a = _asset(asset_id, "gteki_", p, tex_res, notes="Tilted touch screen (gteki_screen_ui, blank colour-block UI), IC pad (gteki_emissive_ic_blue), dispensing tray recess.")
    yc = -D + 0.04  # core front below the head
    # side profile in (y, z), CCW viewed from +X
    top_y, f_y, f_z = -0.30, -D, 1.28
    prof = [(-D + 0.05, 0.0), (0.0, 0.0), (0.0, H), (top_y, H), (top_y - 0.015, H - 0.02), (f_y, f_z), (f_y, 1.0), (yc, 1.0), (yc, 0.12), (-D + 0.05, 0.12)]
    shell = K(a, "body", bevel=0.007, bevel_segments=2)
    shell.extrude_x(prof, xl, xr, "gteki_gate_body", cap_mat="gteki_gate_body")
    # fascia plate with the dispensing-tray opening
    tray = (xl + 0.14, xr - 0.14, 0.20, 0.44)
    fas = K(a, "fascia", bevel=0.004, bevel_segments=1)
    fas.plate(PT_Y, (xl, xr, 0.12, 1.0), [(tray, DARK)], -D, yc, "gteki_gate_body", back=False)
    pocket = K(a, "pocket")
    face_quad(pocket.part, PT_Y, tray, yc - 0.003, DARK, True)
    # tray flap + lip
    pk = K(a, "pocket", bevel=0.0025, bevel_segments=1)
    tcx = (tray[0] + tray[1]) / 2
    pk.xbox((tcx, -D + 0.022, 0.32), ((tray[1] - tray[0]) / 2 - 0.01, 0.005, 0.105), "gteki_plastic_glossy_dark", rot_x=10.0)
    pk.box((tray[0] - 0.012, -D - 0.006, tray[2] - 0.012), (tray[1] + 0.012, -D, tray[2]), STEEL)
    # screen: tilted bezel + emissive UI face
    sy0, sz0 = top_y - 0.015, H - 0.02  # top of the sloped face
    dy, dz = f_y - sy0, f_z - sz0
    ln = math.hypot(dy, dz)
    ny, nz = dz / ln, -dy / ln  # outward normal (toward -y, +z)
    rot = math.degrees(math.atan2(-nz, -ny))  # xbox rot_x that turns local -y onto that normal
    c0 = (0.0, (sy0 + f_y) / 2, (sz0 + f_z) / 2)
    half_l = ln / 2 - 0.015
    bez = K(a, "screen", bevel=0.004, bevel_segments=1)
    bez.xbox((c0[0], c0[1] + ny * 0.005, c0[2] + nz * 0.005), (W / 2 - 0.045, 0.007, half_l), "gteki_plastic_glossy_dark", rot_x=rot)
    shh = min(0.5 * (W - 0.20) * 0.75, half_l - 0.03)
    sw = shh / 0.75
    scr = K(a, "screen")
    scr.xbox((c0[0], c0[1] + ny * 0.0125, c0[2] + nz * 0.0125), (sw, 0.0045, shh), "gteki_screen_ui", rot_x=rot, uv_front=True,
              mats={k: "gteki_plastic_glossy_dark" for k in ("-x", "+x", "+y", "-z", "+z")})
    # status lamp bar on the head top edge and IC pad on the lower right
    pad_c = (xr - 0.19, -D + 0.0, 1.10)
    pad = K(a, "details", bevel=0.003, bevel_segments=1)
    pad_rot = -25.0
    pad.xbox((pad_c[0], pad_c[1] - 0.012, pad_c[2]), (0.075, 0.012, 0.075), "gteki_plastic_glossy_dark", rot_x=pad_rot)
    pad_in = K(a, "pad")
    pad_in.xbox(_rot_pt((pad_c[0], pad_c[1] - 0.012, pad_c[2]), pad_rot, (0, -0.012 - 0.0015, 0)), (0.05, 0.003, 0.05), "gteki_emissive_ic_blue", rot_x=pad_rot)
    # ticket slot, coin slot, small stainless trims on the fascia
    sl = K(a, "details", bevel=0.0015, bevel_segments=1)
    sl.box((xl + 0.12, -D - 0.008, 0.62), (xl + 0.28, -D, 0.68), STEEL)
    sl.box((xl + 0.135, -D - 0.0105, 0.640), (xl + 0.265, -D - 0.008, 0.655), DARK)
    sl.box((xr - 0.30, -D - 0.008, 0.62), (xr - 0.14, -D, 0.68), STEEL)
    sl.box((xr - 0.285, -D - 0.0105, 0.640), (xr - 0.155, -D - 0.008, 0.655), DARK)
    # status lamp + speaker slits on the upper front, between slope and fascia
    sl.box((xl + 0.09, -D - 0.004, 1.14), (xl + 0.21, -D, 1.16), "gteki_emissive_amber", skip=("+y",))
    for k in range(4):
        sl.box((xl + 0.09, -D - 0.003, 1.05 + k * 0.0125), (xl + 0.21, -D, 1.056 + k * 0.0125), DARK, skip=("+y",))
    # accent band across the fascia
    if p["accent"]:
        sl.box((xl, -D - 0.003, 0.76), (xr, -D, 0.84), "gteki_kiosk_accent", skip=("+y",))
    a.light_hint("screen", (0, c0[1] - 0.02, c0[2]), kind="panel", size_m=0.3, watts=6.0, colour_temp_k=6500)
    return finish(a, collision="body")


GENERATORS = {
    "bench": bench,
    "bin_trio": bin_trio,
    "poster_lightbox": poster_lightbox,
    "vending_machine": vending_machine,
    "column_clad": column_clad,
    "tactile_strip": tactile_strip,
    "barrier_rail": barrier_rail,
    "ticket_kiosk": ticket_kiosk,
}
