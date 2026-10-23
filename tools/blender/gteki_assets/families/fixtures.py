"""Ceiling luminaires, wall trim runs and column cladding sleeves (batch D1, docs/assets/gap-list.md).

Generators:
  luminaire_linear      linear LED module (1.2 m): anodised side rails, dark end caps, flush light_diffuser face
  luminaire_panel       600 x 600 recessed LED panel: anodised flush frame, dark gasket, light_diffuser face
  luminaire_downlight   round downlight: anodised trim ring, dark gasket, recessed light_diffuser disc
  trim_run              wall trim run (chair rail, skirting): one profile extruded along X, plain or mitred ends
  column_sleeve         rectangular column cladding: enamel panels on a 1.2 m module, dark shadow gaps,
                        brushed kick plate, stainless corner guards

Frame conventions (docs/assets/asset-contract.md):
  luminaires    placement `ceiling`: origin on the floor under the fixture centre, mounting plane at
                z = ceiling_height_mm, long axis along Y (the passage travel axis), face looking down.
                `SOCKET_ceiling` sits on the mounting plane (extras: mount "ceiling", width = plan width,
                height = how far the fixture hangs below the plane). A station with another ceiling height
                lifts the instance by (its ceiling - ceiling_height_mm) instead of asking for a new variant,
                so one geometry serves every fixture of a kind. luminaire_linear also has start/end sockets
                to chain rows end to end. No fixture needs a hole in the station's ceiling.
  trim_run      placement `wall`: wall plane at y = 0, the profile projects toward -Y (glTF +Z), run centred
                on X, origin on the floor under the back centre. `bottom_mm` is the height of the lower edge
                above the floor (skirting 0, chair rail ~1100). start/end sockets chain runs along a wall.
  column_sleeve placement `free`: footprint centred on the origin, base at y = 0.

Collision: none for any D1 piece. Luminaires hang from the ceiling and trim is a few centimetres proud of a
wall, so walkers never touch them; a column sleeve dresses a column the station already has, whose collider
stays the station's (Shinjuku: kit pieces are visual-only; Ikebukuro: the column's own collider covers it).
The validator reports the missing collision node as a WARN for each piece, as it does for tactile strips.

Dimensions: `dimension_basis` is generic-typical for the luminaires (published nominal module sizes: 1200 mm
linear body, 600 x 600 panel, 150 mm downlight trim) and synthetic for trim and sleeves (look-dev defaults;
stations pass their own length, width, depth and height as `*_mm` params). All materials come from the style
palette (docs/assets/style.md section 2); this module registers none.
"""

import math

from .. import contract, materials
from ..asset import Asset
from .signage import ALU, DARK, K, _choice, _merge, finish

GEN = "tools/blender/gteki_assets/families/fixtures.py"

DIFFUSER = "gteki_light_diffuser"
REVEAL = "gteki_reveal_dark"
STEELB = "gteki_steel_brushed"
STEEL = "gteki_stainless_polished"  # registered by props.py

# trim_run: `material` key -> palette material
TRIM_MAT = {
    "steel_brushed": "gteki_steel_brushed",
    "wall_panel_accent": "gteki_wall_panel_accent",
    "floor_granite_dark": "gteki_floor_granite_dark",
}
# column_sleeve: `panel` key -> palette material
PANEL_MAT = {"enamel": "gteki_wall_panel_enamel", "accent": "gteki_wall_panel_accent"}

# trim_run profiles and their bevel width in metres, 1 segment (style.md section 5: "Trim and small" is
# 2-3 mm; the bullnose is already rounded, so it takes the "Fine" class)
PROFILE_BEVEL = {"flat": 0.0025, "stepped": 0.0025, "bullnose": 0.001}
MITRES = ("none", "inside", "outside")

_XY = lambda a, b, d: (a, b, d)  # noqa: E731  ring in a horizontal plane: a=x, b=y, d=z


def _asset(asset_id, prefix, family, p, tex_res, basis, notes):
    return Asset(asset_id, family, asset_id.replace(prefix, "") or asset_id, p, GEN, basis, tex_res, notes=notes)


def _m(p, *keys):
    """Millimetre params -> metres."""
    return [p[k] / 1000.0 for k in keys]


def _positive(p, *keys):
    for key in keys:
        if not p[key] > 0:
            raise ValueError(f"{key} must be positive, got {p[key]!r}")


def _segments(asset, n):
    """Mobile: half the segments, like Part.cylinder."""
    return max(8, n // 2) if asset.profile == "mobile" else n


# ---------------------------------------------------------------------------
# flat and round primitives (all faces look down, toward the floor)
# ---------------------------------------------------------------------------


def _down_quad(k, x0, x1, y0, y1, z, mat):
    k.quad((x0, y0, z), (x0, y1, z), (x1, y1, z), (x1, y0, z), mat, smooth=False)


def _flat_ring(k, outer, inner, z, mat):
    """Picture-frame ring between two rectangles (x0, x1, y0, y1), one flat face deep, facing down."""

    def corners(r):
        x0, x1, y0, y1 = r
        return [(x0, y0), (x1, y0), (x1, y1), (x0, y1)]

    o, i = corners(outer), corners(inner)
    for n in range(4):
        m = (n + 1) % 4
        k.quad((*o[n], z), (*i[n], z), (*i[m], z), (*o[m], z), mat, smooth=False)


def _circle(r, z, n):
    return [(r * math.cos(2 * math.pi * i / n), r * math.sin(2 * math.pi * i / n), z) for i in range(n)]


def _annulus(k, z0, z1, r_in, r_out, mat, n):
    """Closed hollow ring about the Z axis: outer wall, inner wall and the two annular faces."""
    n0 = k.mark()
    ob, ot, ib, it = _circle(r_out, z0, n), _circle(r_out, z1, n), _circle(r_in, z0, n), _circle(r_in, z1, n)
    for i in range(n):
        j = (i + 1) % n
        k.poly([ob[i], ob[j], ot[j], ot[i]], mat, smooth=True)
        k.poly([ib[j], ib[i], it[i], it[j]], mat, smooth=True)
        k.poly([ot[i], ot[j], it[j], it[i]], mat, smooth=False)
        k.poly([ob[i], ib[i], ib[j], ob[j]], mat, smooth=False)
    k.weld(n0)


def _flat_annulus(k, z, r_in, r_out, mat, n):
    o, i = _circle(r_out, z, n), _circle(r_in, z, n)
    for a in range(n):
        b = (a + 1) % n
        k.quad(o[a], i[a], i[b], o[b], mat, smooth=False)


def _down_disc(k, z, r, mat, n):
    k.poly(list(reversed(_circle(r, z, n))), mat, smooth=False)


# ---------------------------------------------------------------------------
# luminaires
# ---------------------------------------------------------------------------


def luminaire_linear(asset_id, params, tex_res):
    """Linear LED module. Long axis along Y, centred; the diffuser sits 4 mm inside the rail lip."""
    p = _merge(dict(length_mm=1200, width_mm=130, depth_mm=40, cap_mm=20, rail_mm=16, recess_mm=4, ceiling_height_mm=2800), params)
    _positive(p, "length_mm", "width_mm", "depth_mm", "cap_mm", "rail_mm", "recess_mm", "ceiling_height_mm")
    L, W, D, cap, rail, rec, H = _m(p, "length_mm", "width_mm", "depth_mm", "cap_mm", "rail_mm", "recess_mm", "ceiling_height_mm")
    if 2 * cap >= L or 2 * rail >= W or rec >= D or D >= H:
        raise ValueError("luminaire_linear: caps, rails, recess and depth must fit inside length, width and ceiling height")
    a = _asset(asset_id, "gteki_luminaire_", "luminaire", p, tex_res, contract.GENERIC_TYPICAL,
               notes="Instance per fixture; lift the instance for another ceiling height. Diffuser face is gteki_light_diffuser; "
                     "LIGHTHINT_linear drives render_preview. start/end sockets chain rows end to end.")
    z0 = H - D  # lower edge of the body
    zl = z0 + rec  # diffuser plane
    rails = K(a, "body", bevel=0.0025, bevel_segments=1)
    for s in (-1, 1):
        x0, x1 = sorted((s * (W / 2 - rail), s * W / 2))
        rails.box((x0, -L / 2 + cap, z0), (x1, L / 2 - cap, H), ALU)
    caps = K(a, "caps", bevel=0.0025, bevel_segments=1)
    for s in (-1, 1):
        y0, y1 = sorted((s * (L / 2 - cap), s * L / 2))
        caps.box((-W / 2, y0, z0), (W / 2, y1, H), DARK)
    lens = K(a, "lens")
    _down_quad(lens, -W / 2 + rail, W / 2 - rail, -L / 2 + cap, L / 2 - cap, zl, DIFFUSER)
    a.light_hint("linear", (0, 0, zl), kind="linear_led", length_m=round(L - 2 * cap, 3), axis="y", colour_temp_k=4000)
    a.socket("ceiling", (0, 0, H), 0.0, width=W, height=D, mount="ceiling")
    a.socket("start", (0, -L / 2, H), 180.0, width=W, height=D)
    a.socket("end", (0, L / 2, H), 0.0, width=W, height=D)
    return finish(a)


def luminaire_panel(asset_id, params, tex_res):
    """Recessed LED panel (default 600 x 600): flush anodised frame, dark gasket, recessed diffuser."""
    p = _merge(dict(width_mm=600, length_mm=600, frame_mm=22, lip_mm=12, gasket_mm=6, recess_mm=3, ceiling_height_mm=2800), params)
    _positive(p, "width_mm", "length_mm", "frame_mm", "lip_mm", "gasket_mm", "recess_mm", "ceiling_height_mm")
    W, Ln, bar, lip, gk, rec, H = _m(p, "width_mm", "length_mm", "frame_mm", "lip_mm", "gasket_mm", "recess_mm", "ceiling_height_mm")
    if 2 * (bar + gk) >= min(W, Ln) or rec >= lip or lip >= H:
        raise ValueError("luminaire_panel: frame, gasket and recess must fit inside the panel and ceiling height")
    a = _asset(asset_id, "gteki_luminaire_", "luminaire", p, tex_res, contract.GENERIC_TYPICAL,
               notes="Flush-mount trim: the frame lip hangs lip_mm below the ceiling plane, so the station's ceiling needs no opening. "
                     "Diffuser face is gteki_light_diffuser; LIGHTHINT_panel drives render_preview.")
    zl = H - lip + rec
    outer = (-W / 2, W / 2, -Ln / 2, Ln / 2)
    inner = (-W / 2 + bar, W / 2 - bar, -Ln / 2 + bar, Ln / 2 - bar)
    gin = (inner[0] + gk, inner[1] - gk, inner[2] + gk, inner[3] - gk)
    frame = K(a, "body", bevel=0.0025, bevel_segments=1)
    frame.ring(_XY, outer, inner, H - lip, H, ALU)
    lens = K(a, "lens")
    _flat_ring(lens, inner, gin, zl, REVEAL)
    _down_quad(lens, gin[0], gin[1], gin[2], gin[3], zl, DIFFUSER)
    a.light_hint("panel", (0, 0, zl), kind="panel", size_m=round(min(W, Ln), 2), watts=40.0, colour_temp_k=4000)
    a.socket("ceiling", (0, 0, H), 0.0, width=W, height=lip, mount="ceiling")
    return finish(a)


def luminaire_downlight(asset_id, params, tex_res):
    """Round downlight: anodised trim ring, dark gasket, diffuser disc recessed behind the ring face."""
    p = _merge(dict(diameter_mm=150, aperture_mm=100, lip_mm=12, gasket_mm=6, recess_mm=4, segments=24, ceiling_height_mm=2800), params)
    _positive(p, "diameter_mm", "aperture_mm", "lip_mm", "gasket_mm", "recess_mm", "ceiling_height_mm")
    D, ap, lip, gk, rec, H = _m(p, "diameter_mm", "aperture_mm", "lip_mm", "gasket_mm", "recess_mm", "ceiling_height_mm")
    if ap >= D or 2 * gk >= ap or rec >= lip or lip >= H or int(p["segments"]) < 8:
        raise ValueError("luminaire_downlight: aperture, gasket and recess must fit inside the trim ring; segments >= 8")
    a = _asset(asset_id, "gteki_luminaire_", "luminaire", p, tex_res, contract.GENERIC_TYPICAL,
               notes="Flush-mount trim ring: it hangs lip_mm below the ceiling plane, so the station's ceiling needs no opening. "
                     "Diffuser disc is gteki_light_diffuser; LIGHTHINT_downlight drives render_preview.")
    seg = _segments(a, int(p["segments"]))
    zl = H - lip + rec
    ring = K(a, "body", bevel=0.0025, bevel_segments=1)
    _annulus(ring, H - lip, H, ap / 2, D / 2, ALU, seg)
    lens = K(a, "lens")
    _flat_annulus(lens, zl, ap / 2 - gk, ap / 2, REVEAL, seg)
    _down_disc(lens, zl, ap / 2 - gk, DIFFUSER, seg)
    a.light_hint("downlight", (0, 0, zl), kind="downlight", size_m=round(D, 3), watts=12.0, colour_temp_k=4000)
    a.socket("ceiling", (0, 0, H), 0.0, width=D, height=lip, mount="ceiling")
    return finish(a)


# ---------------------------------------------------------------------------
# trim_run
# ---------------------------------------------------------------------------


def _profile(name, d, h, steps):
    """Closed outline in (y, z), counter-clockwise viewed from +X. The wall is y = 0; the trim projects to -d."""
    if name == "flat":
        return [(0.0, 0.0), (0.0, h), (-d, h), (-d, 0.0)]
    if name == "stepped":
        # skirting with a stepped cap: full projection up to 80 % of the height, then a lip half as deep
        zs = 0.8 * h
        return [(0.0, 0.0), (0.0, h), (-0.5 * d, h), (-0.5 * d, zs), (-d, zs), (-d, 0.0)]
    # bullnose: both front corners rounded (radius 45 % of the smaller side)
    r = 0.45 * min(d, h)
    pts = [(0.0, 0.0), (0.0, h), (-d + r, h)]
    for s in range(1, steps + 1):  # top front corner, 90 -> 180 degrees
        a = math.radians(90.0 + 90.0 * s / steps)
        pts.append((-d + r + r * math.cos(a), h - r + r * math.sin(a)))
    for s in range(steps):  # bottom front corner, 180 -> 270 degrees
        a = math.radians(180.0 + 90.0 * s / steps)
        pts.append((-d + r + r * math.cos(a), r + r * math.sin(a)))
    pts.append((-d + r, 0.0))
    return pts


def _end_x(length, y, end, kind):
    """X of one run end at profile depth y (<= 0), with an optional 45 degree mitre.

    length_mm is measured on the wall face (y = 0). An outside corner (wall turns away from the room)
    leaves the front edge longer, an inside corner leaves it shorter."""
    cut = {"none": 0.0, "outside": -y, "inside": y}[kind]
    return (-1.0 if end == "start" else 1.0) * (length / 2 + cut)


def trim_run(asset_id, params, tex_res):
    """Wall trim run: one profile extruded along X. Skirting, chair rail, or any other run by params."""
    p = _merge(dict(length_mm=3000, height_mm=120, depth_mm=12, bottom_mm=0, profile="flat", material="steel_brushed",
                    miter_start="none", miter_end="none"), params)
    _choice(p, "profile", tuple(PROFILE_BEVEL))
    _choice(p, "material", tuple(TRIM_MAT))
    _choice(p, "miter_start", MITRES)
    _choice(p, "miter_end", MITRES)
    _positive(p, "length_mm", "height_mm", "depth_mm")
    if p["bottom_mm"] < 0:
        raise ValueError(f"bottom_mm must not be negative, got {p['bottom_mm']!r}")
    L, h, d, z0 = _m(p, "length_mm", "height_mm", "depth_mm", "bottom_mm")
    if d >= L / 2:
        raise ValueError("trim_run: depth_mm must be well below half of length_mm")
    mat = TRIM_MAT[p["material"]]
    a = _asset(asset_id, "gteki_trim_", "trim", p, tex_res, contract.SYNTHETIC,
               notes="length_mm is measured on the wall face; mitred ends (miter_start/miter_end inside|outside, 45 degrees) are "
                     "cut on the profile depth. Texture runs along the trim. Defaults are look-dev values, not a measured trim.")
    k = K(a, "trim", bevel=PROFILE_BEVEL[p["profile"]], bevel_segments=1)
    steps = 1 if a.profile == "mobile" else 3
    prof = [(y, z0 + z) for y, z in _profile(p["profile"], d, h, steps)]
    n = len(prof)
    xs = [_end_x(L, y, "start", p["miter_start"]) for y, _ in prof]
    xe = [_end_x(L, y, "end", p["miter_end"]) for y, _ in prof]
    cum = [0.0]  # arc length along the outline, for the V coordinate
    for i in range(n):
        (y0, zz0), (y1, zz1) = prof[i], prof[(i + 1) % n]
        cum.append(cum[-1] + math.hypot(y1 - y0, zz1 - zz0))
    rep = materials.repeat_m(mat)
    rounded = p["profile"] == "bullnose"
    n0 = k.mark()
    for i in range(n):
        j = (i + 1) % n
        (yi, zi), (yj, zj) = prof[i], prof[j]
        uv = [(xs[i] / rep, cum[i] / rep), (xs[j] / rep, cum[i + 1] / rep), (xe[j] / rep, cum[i + 1] / rep), (xe[i] / rep, cum[i] / rep)]
        k.poly([(xs[i], yi, zi), (xs[j], yj, zj), (xe[j], yj, zj), (xe[i], yi, zi)], mat, smooth=rounded, uv=uv)
    k.poly([(xe[i], y, z) for i, (y, z) in enumerate(prof)], mat, smooth=False)
    k.poly([(xs[i], y, z) for i, (y, z) in reversed(list(enumerate(prof)))], mat, smooth=False)
    k.weld(n0)
    zc = z0 + h / 2
    a.socket("start", (-L / 2, 0, zc), 90.0, width=d, height=h)
    a.socket("end", (L / 2, 0, zc), -90.0, width=d, height=h)
    return finish(a)


# ---------------------------------------------------------------------------
# column_sleeve
# ---------------------------------------------------------------------------

PANEL_T = 0.018  # enamel panel thickness
JOINT = 0.008  # shadow gap between panels (style.md: 8 mm joints on a 1.2 m module)
PLINTH_GAP = 0.012  # shadow gap between kick plate and panels (style.md: 12 mm at a change of material)
CORNER = 0.010  # shadow gap at each corner
CORE_INSET = 0.004  # dark backing sits this far behind the panel faces
GUARD_LEG = 0.040  # stainless corner guard leg length
GUARD_T = 0.003  # guard sheet thickness (it sits on the panel faces)


def _split(lo, hi, module, gap):
    """[lo, hi] cut into round((hi - lo) / module) equal panels separated by `gap`."""
    n = max(1, round((hi - lo) / module))
    w = (hi - lo - (n - 1) * gap) / n
    return [(lo + i * (w + gap), lo + i * (w + gap) + w) for i in range(n)]


def _guard_outline(sx, sy, W, D):
    """Plan outline (CCW) of the L-shaped guard on corner (sx, sy): inner corner on the panel corner."""
    g, t = GUARD_LEG, GUARD_T
    rel = [(t, t), (-g, t), (-g, 0.0), (0.0, 0.0), (0.0, -g), (t, -g)]
    pts = [(sx * (W / 2 + dx), sy * (D / 2 + dy)) for dx, dy in rel]
    return pts if sx * sy > 0 else pts[::-1]


def column_sleeve(asset_id, params, tex_res):
    """Rectangular column cladding sleeve. Origin: floor centre; width along X, depth along Y."""
    p = _merge(dict(width_mm=600, depth_mm=600, height_mm=2800, plinth_mm=120, ceiling_gap_mm=30, panel="enamel",
                    corner_guard=True, guard_height_mm=1500, module_mm=1200), params)
    _choice(p, "panel", tuple(PANEL_MAT))
    _positive(p, "width_mm", "depth_mm", "height_mm", "plinth_mm", "ceiling_gap_mm", "guard_height_mm", "module_mm")
    W, D, H, plinth, gap_top, guard_h, module = _m(p, "width_mm", "depth_mm", "height_mm", "plinth_mm", "ceiling_gap_mm", "guard_height_mm", "module_mm")
    z_lo, z_hi = plinth + PLINTH_GAP, H - gap_top  # panel zone: above the kick plate gap, below the ceiling gap
    if min(W, D) < 0.2 or z_hi - z_lo < 0.3:
        raise ValueError("column_sleeve: width and depth must be >= 200 mm and leave 300 mm of panel between plinth and ceiling gap")
    a = _asset(asset_id, "gteki_column_sleeve_", "cladding", p, tex_res, contract.SYNTHETIC,
               notes="Dresses a column the station already has: width_mm x depth_mm is the finished cladding envelope (stainless guards "
                     "add 3 mm), the column itself is not modelled. Panels split on module_mm with 8 mm shadow gaps (gteki_reveal_dark "
                     "backing); no collider, the station's column collider stays.")
    pm = PANEL_MAT[p["panel"]]
    # dark backing: shows through every gap; its faces sit 4 mm behind the panels
    core = K(a, "core")
    core.box((-W / 2 + CORE_INSET, -D / 2 + CORE_INSET, plinth), (W / 2 - CORE_INSET, D / 2 - CORE_INSET, H), REVEAL)
    kick = K(a, "plinth", bevel=0.003, bevel_segments=1)
    kick.box((-W / 2, -D / 2, 0.0), (W / 2, D / 2, plinth), STEELB)
    panels = K(a, "panels", bevel=0.003, bevel_segments=1)
    xs = _split(-W / 2 + CORNER, W / 2 - CORNER, module, JOINT)
    ys = _split(-D / 2 + CORNER, D / 2 - CORNER, module, JOINT)
    for z0, z1 in _split(z_lo, z_hi, module, JOINT):
        for x0, x1 in xs:  # front and back faces
            for s in (-1, 1):
                y0, y1 = sorted((s * D / 2, s * (D / 2 - PANEL_T)))
                panels.box((x0, y0, z0), (x1, y1, z1), pm)
        for y0, y1 in ys:  # left and right faces
            for s in (-1, 1):
                x0, x1 = sorted((s * W / 2, s * (W / 2 - PANEL_T)))
                panels.box((x0, y0, z0), (x1, y1, z1), pm)
    if p["corner_guard"]:
        guards = K(a, "guards", bevel=0.001, bevel_segments=1)
        zg1 = min(guard_h, z_hi - 0.05)
        if zg1 - z_lo < 0.1:
            raise ValueError("column_sleeve: guard_height_mm leaves no guard above the plinth")
        for sx in (-1, 1):
            for sy in (-1, 1):
                guards.prism(_guard_outline(sx, sy, W, D), z_lo, zg1, STEEL)
    return finish(a)


GENERATORS = {
    "luminaire_linear": luminaire_linear,
    "luminaire_panel": luminaire_panel,
    "luminaire_downlight": luminaire_downlight,
    "trim_run": trim_run,
    "column_sleeve": column_sleeve,
}
