"""Street-exit canopy and street furniture (batch D4, docs/assets/gap-list.md).

Generators:
  street_canopy      glazed roof canopy over a stair or escalator exit: steel frame, glass in aluminium
                     ribs, a blank sign fascia, posts or a cantilever, optional glass side screens
  street_bollard     fixed bollard, or a removable one with a base collar and lock plate
  street_guard_rail  pedestrian guard rail along a polyline: posts, two rails, mitred corners
  street_lamp        pole with a gooseneck arm and a luminaire head (LIGHTHINT at the diffuser)
  street_planter     concrete planter, box or round, with an optional low shrub

Frame conventions (docs/assets/asset-contract.md):
  canopy      placement `linear`: origin on the ground, centred on the opening edge (y = 0), the roof
              extends toward +Y (glTF -Z) for `depth_mm`. `SOCKET_opening` sits at the origin and faces
              back toward the stair or escalator; `SOCKET_fascia` sits on the sign face at the far edge
              and faces +Y, so a station sign is mounted looking along the exit direction.
              `width_mm` is the outer width including the posts: the clear opening between posts is
              width_mm minus two post widths (100 mm, 140 mm for a cantilever).
  guard rail  placement `linear`: `points_mm` are plan offsets (x right, y forward = glTF -Z) from the first
              point, which is the origin. `SOCKET_start` and `SOCKET_end` chain runs.
  others      placement `free`: footprint centred on the origin, base at y = 0 (the lamp arm reaches
              toward -Y, glTF +Z).

Collision (contract section 2, colliders are boxes and simple hulls). The pieces stand in the street, outside
the walker footprint of any station interior, and the street-level ones are real blockers for a walker:
  bollard, lamp pole, planter  one box or 12-sided cylinder over the visual footprint
  canopy                       one box per post, one thin box per glass screen; the roof, frame and fascia
                               have none (they are overhead, above the 2.5 m a walker needs)
  guard rail                   one full-height thin box per segment, so a walker cannot slip between rails
Stations that keep their own merged wall collider ignore these nodes (Shinjuku); Ikebukuro's bake uses them.

Dimensions: `dimension_basis` is synthetic for every piece (look-dev proportions in a typical street range,
not measured anywhere and not taken from a standard); stations pass their own `*_mm` params.

The fascia is a blank sign panel: a recessed aluminium frame around a `gteki_sign_face_*` quad with a 0..1 UV
island, so a station mounts its own artwork at runtime. The kit draws no wording, station name or operator
graphic on it.
"""

import math

from .. import contract, materials
from ..asset import Asset
from . import props, vertical  # noqa: F401  (register gteki_stainless_polished and gteki_vertical_safety_yellow)
from .signage import ALU, DARK, PT_Y, TONES, K, _choice, _face_stack, _merge, face_material, finish

GEN = "tools/blender/gteki_assets/families/street.py"

# New colours are flat factors (no texture), so they cost no download or GPU memory.
# See docs/assets/style.md section 2 for the roles.
STEEL = "gteki_street_steel"  # painted graphite steel: canopy frame, posts, rails, bollards, lamps
CONCRETE = "gteki_street_concrete"  # precast concrete planter body
SOIL = "gteki_street_soil"
FOLIAGE = "gteki_street_foliage"  # one flat green for the generic shrub

materials.register(STEEL, color=(0.27, 0.28, 0.30), rough=0.45)
materials.register(CONCRETE, color=(0.56, 0.56, 0.54), rough=0.88)
materials.register(SOIL, color=(0.17, 0.12, 0.09), rough=0.95)
materials.register(FOLIAGE, color=(0.17, 0.36, 0.17), rough=0.72)

GLASS = "gteki_glass_clear"
STAINLESS = "gteki_stainless_polished"  # registered by props.py
YELLOW = "gteki_vertical_safety_yellow"  # registered by vertical.py
DIFFUSER = "gteki_light_diffuser"

_XY = lambda a, b, d: (a, b, d)  # noqa: E731  ring in a horizontal plane: a=x, b=y, d=z


def _asset(asset_id, p, tex_res, notes):
    return Asset(asset_id, "street", asset_id.replace("gteki_street_", ""), p, GEN, contract.SYNTHETIC, tex_res, notes=notes)


def _positive(p, *keys):
    for key in keys:
        if not p[key] > 0:
            raise ValueError(f"{key} must be positive, got {p[key]!r}")


def _segs(asset, n):
    """Round parts have about half the segments in the mobile profile (Part.cylinder does the same)."""
    return max(8, n // 2) if asset.profile == "mobile" else n


def _dome(asset, r, top):
    """Quarter-round cap profile for a vertical shaft of radius r that ends at height `top`."""
    angles = (30, 60) if asset.profile == "mobile" else (22.5, 45, 67.5)
    return [(r * math.cos(math.radians(t)), (top - r) + r * math.sin(math.radians(t))) for t in angles] + [(0.0, top)]


def _yaw_deg(dx, dy):
    """Socket yaw that turns local +Y (outward) to the direction (dx, dy)."""
    return round(math.degrees(math.atan2(0.0 - dx, dy)), 3) + 0.0


# ---------------------------------------------------------------------------
# street_canopy
# ---------------------------------------------------------------------------

POST_W = 0.10  # square steel post and edge beam width
POST_W_CANTILEVER = 0.14
BEAM_H = 0.14  # edge beam depth
RIB_W = 0.04  # aluminium rib / transom width
RIB_DEPTH = 0.10  # how far a rib reaches below the glass
GLASS_T = 0.012
CAP_H = 0.012  # rib cap stands this far above the glass
GLASS_GAP = 0.022  # glass stops this far from a rib centre line
FASCIA_DEPTH = 0.09
FASCIA_BAR = 0.03  # frame bar around the sign face (style.md section 6: 28-35 mm)


def _band(kit, nodes, x0, x1, dz0, dz1, mat):
    """Strip following the roof polyline: from `dz0` to `dz1` above the node heights, extruded across x0..x1."""
    prof = [(y, z + dz0) for y, z in nodes] + [(y, z + dz1) for y, z in reversed(nodes)]
    kit.extrude_x(prof, x0, x1, mat)


def _lerp(nodes, y):
    """Height of the node polyline at depth y."""
    for (y0, z0), (y1, z1) in zip(nodes, nodes[1:]):
        if y <= y1 + 1e-9:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return nodes[-1][1]


def street_canopy(asset_id, params, tex_res):
    """Glazed street-exit canopy. Opening edge at y = 0 (centred on x), roof toward +Y, fascia on the far edge."""
    p = _merge(dict(width_mm=3000, depth_mm=3000, height_mm=2600, roof="pitched", pitch_deg=6.0, rise_mm=350,
                    support="posts", fascia_mm=450, fascia_theme="white", screens="none"), params)
    _choice(p, "roof", ("flat", "pitched", "curved"))
    _choice(p, "support", ("posts", "cantilever"))
    _choice(p, "screens", ("none", "left", "right", "both"))
    _choice(p, "fascia_theme", tuple(TONES))
    _positive(p, "width_mm", "depth_mm", "height_mm", "fascia_mm", "rise_mm")
    if not 0 <= p["pitch_deg"] <= 20:
        raise ValueError(f"pitch_deg must be 0..20, got {p['pitch_deg']!r}")
    W, D, H, F = (p[k] / 1000.0 for k in ("width_mm", "depth_mm", "height_mm", "fascia_mm"))
    if F < BEAM_H + 0.08:
        raise ValueError(f"fascia_mm must be at least {round((BEAM_H + 0.08) * 1000)}, got {p['fascia_mm']!r}")
    if W < 1.2 or D < 1.2:
        raise ValueError("width_mm and depth_mm must be at least 1200")
    cant = p["support"] == "cantilever"
    pw = POST_W_CANTILEVER if cant else POST_W
    a = _asset(asset_id, p, tex_res,
               f"Origin on the ground at the centre of the opening edge; roof toward +Y, fascia on the far edge facing +Y. "
               f"SOCKET_fascia carries the blank sign face (0..1 UV island, swap the gteki_sign_face material); "
               f"clear opening between posts = width - 2 x {round(pw * 1000)} mm. Posts and screens collide, the roof does not.")

    # roof frame underside at depth y: the front edge sits just under the fascia top, the rest rises or arches
    z0 = H + F - BEAM_H - 0.03
    if p["roof"] == "pitched":
        slope = math.tan(math.radians(p["pitch_deg"]))

        def under(y):
            return z0 + (D - y) * slope
    elif p["roof"] == "curved":
        rise = p["rise_mm"] / 1000.0

        def under(y):
            return z0 + rise * (1.0 - (2.0 * y / D - 1.0) ** 2)
    else:
        def under(y):
            return z0
    ny = max(4, round(D / 0.8)) if p["roof"] == "curved" else max(1, round(D / 1.0))
    nx = max(1, round(W / 1.0))
    nodes = [(D * k / ny, under(D * k / ny)) for k in range(ny + 1)]
    top = [(y, z + BEAM_H) for y, z in nodes]  # glass seat
    xs = [-W / 2 + W * i / nx for i in range(nx + 1)]

    # frame: edge beams, ribs and transoms
    beams = K(a, "frame", bevel=0.003, bevel_segments=1)
    for s in (-1, 1):
        x0, x1 = (s * W / 2 - POST_W, s * W / 2) if s > 0 else (s * W / 2, s * W / 2 + POST_W)
        _band(beams, nodes, x0, x1, 0.0, BEAM_H, STEEL)
    beams.box((-W / 2, 0.0, nodes[0][1]), (W / 2, POST_W, top[0][1]), STEEL)
    beams.box((-W / 2, D - POST_W, nodes[-1][1]), (W / 2, D, top[-1][1]), STEEL)
    ribs = K(a, "ribs", bevel=0.002, bevel_segments=1)
    for x in xs[1:-1]:
        _band(ribs, top, x - RIB_W / 2, x + RIB_W / 2, -RIB_DEPTH, GLASS_T + CAP_H, ALU)
    for y, z in top[1:-1]:
        ribs.box((-W / 2 + POST_W, y - RIB_W / 2, z - RIB_DEPTH + 0.01), (W / 2 - POST_W, y + RIB_W / 2, z + GLASS_T + CAP_H), ALU)

    # glazing: one slab per cell, sitting on the frame
    glass = K(a, "glass")
    for i in range(nx):
        gx0 = xs[i] + (GLASS_GAP if i > 0 else 0.0)
        gx1 = xs[i + 1] - (GLASS_GAP if i < nx - 1 else 0.0)
        for k in range(ny):
            ya = top[k][0] + (GLASS_GAP if k > 0 else 0.0)
            yb = top[k + 1][0] - (GLASS_GAP if k < ny - 1 else 0.0)
            za, zb = _lerp(top, ya), _lerp(top, yb)
            glass.extrude_x([(ya, za), (yb, zb), (yb, zb + GLASS_T), (ya, za + GLASS_T)], gx0, gx1, GLASS)

    # supports: square posts under the edge beams (rear pair always, front pair for `posts`)
    posts = K(a, "posts", bevel=0.003, bevel_segments=1)
    plates = K(a, "posts", bevel=0.002, bevel_segments=1)
    post_y = [(0.0, pw)] if cant else [(0.0, pw), (D - pw, D)]
    for n, (py0, py1) in enumerate(post_y):
        zt = under((py0 + py1) / 2) + 0.02
        for s in (-1, 1):
            px0, px1 = (s * W / 2 - pw, s * W / 2) if s > 0 else (s * W / 2, s * W / 2 + pw)
            posts.box((px0, py0, 0.012), (px1, py1, zt), STEEL)
            plates.box((px0 - 0.03 if s > 0 else px0, py0 - 0.03 if py0 > 0 else py0, 0.0),
                       (px1 if s > 0 else px1 + 0.03, py1 + 0.03 if py1 < D else py1, 0.012), STEEL)
            a.col_box(f"post_{n}_{'R' if s > 0 else 'L'}", (min(px0, px1), py0, 0.0), (max(px0, px1), py1, zt))
    if cant:  # knee gussets from each rear post up into the edge beam
        gl = min(0.8, D * 0.4)
        gus = K(a, "posts", bevel=0.002, bevel_segments=1)
        for s in (-1, 1):
            xc = s * (W / 2 - POST_W / 2)
            gus.extrude_x([(pw, under(pw) - 0.55), (pw + gl, under(pw + gl)), (pw, under(pw))], xc - 0.015, xc + 0.015, STEEL)

    # glass side screens between the posts, under the edge beams
    if p["screens"] != "none":
        sy0, sy1 = pw, (D - 0.02 if cant else D - pw)
        inner = [n for n in nodes if sy0 < n[0] < sy1]
        screens = K(a, "glass")
        rails = K(a, "ribs", bevel=0.002, bevel_segments=1)
        for s, name in ((-1, "left"), (1, "right")):
            if p["screens"] not in ("both", name):
                continue
            xc = s * (W / 2 - POST_W / 2)
            top = [(sy1, under(sy1))] + [(y, z) for y, z in reversed(inner)] + [(sy0, under(sy0))]
            prof = [(sy0, 0.06), (sy1, 0.06)] + top
            screens.extrude_x(prof, xc - GLASS_T / 2, xc + GLASS_T / 2, GLASS)
            rails.box((xc - 0.03, sy0, 0.0), (xc + 0.03, sy1, 0.06), ALU)
            low = min(z for _, z in top)  # up to the lowest point of the glass's top edge, not its bottom rail
            a.col_box(f"screen_{name}", (xc - 0.03, sy0, 0.0), (xc + 0.03, sy1, low))

    # fascia: aluminium frame, blank backlit sign face, steel back plate
    fx = (-W / 2, W / 2, H, H + F)
    fin = (fx[0] + FASCIA_BAR, fx[1] - FASCIA_BAR, fx[2] + FASCIA_BAR, fx[3] - FASCIA_BAR)
    frame = K(a, "fascia", bevel=0.004, bevel_segments=2)
    frame.ring(PT_Y, fx, fin, D, D + FASCIA_DEPTH, ALU)
    back = K(a, "fascia")
    back.box((fin[0], D, fin[2]), (fin[1], D + 0.012, fin[3]), STEEL)
    gasket = K(a, "fascia", bevel=0.0012, bevel_segments=1)
    faces = K(a, "faces")
    face_w, face_h = fin[1] - fin[0] - 0.012, fin[3] - fin[2] - 0.012
    # half-metre aspect steps keep nearby widths on one shared face texture
    face = face_material("bar", p["fascia_theme"], "none", round(face_w / face_h * 2.0) / 2.0)
    _face_stack(frame, gasket, faces, PT_Y, fin, D + FASCIA_DEPTH - 0.014, +1, face)
    a.light_hint("fascia", (0, D + FASCIA_DEPTH + 0.02, H + F / 2), kind="panel", size_m=round(min(W, 1.2) * 0.5, 2),
                 watts=round(min(40.0, 30.0 * W * F), 1), colour_temp_k=5000)

    a.socket("opening", (0, 0, 0), 180.0, width=round(W - 2 * pw, 3), height=H)
    a.socket("fascia", (0, D + FASCIA_DEPTH - 0.014, H + F / 2), 0.0, width=round(face_w, 3), height=round(face_h, 3))
    return finish(a)


# ---------------------------------------------------------------------------
# street_bollard
# ---------------------------------------------------------------------------


def street_bollard(asset_id, params, tex_res):
    """Round bollard. `fixed` is stainless on a base cover; `removable` is painted steel in an aluminium collar."""
    p = _merge(dict(diameter_mm=114, height_mm=900, kind="fixed", band_mm=60), params)
    _choice(p, "kind", ("fixed", "removable"))
    _positive(p, "diameter_mm", "height_mm")
    r, H, band = p["diameter_mm"] / 2000.0, p["height_mm"] / 1000.0, p["band_mm"] / 1000.0
    removable = p["kind"] == "removable"
    if H < 4 * r + band + 0.2:
        raise ValueError("height_mm is too small for this diameter")
    a = _asset(asset_id, p, tex_res,
               "Free-standing, origin on the ground at the centre. Collider is a 12-sided cylinder over the footprint. "
               "A removable bollard has an aluminium collar with a lock plate on its -Y side.")
    n = _segs(a, 24)
    body = K(a, "body")
    if removable:
        rc = r + 0.034
        prof = [(r, 0.04), (r, H - r)] + _dome(a, r, H)
        body.lathe((0, 0, 0), prof, STEEL, segments=n, rep=1.0)
        collar = K(a, "collar")
        collar.lathe((0, 0, 0), [(rc, 0.0), (rc, 0.05), (r + 0.008, 0.05)], ALU, segments=n, rep=1.0)
        collar.lathe((0, 0, 0), [(r + 0.008, 0.05), (r + 0.008, 0.02)], DARK, segments=n, rep=1.0)
        lock = K(a, "collar", bevel=0.001, bevel_segments=1)
        lock.box((-0.02, -rc - 0.003, 0.014), (0.02, -rc + 0.002, 0.038), DARK)
    else:
        rc = r + 0.012
        prof = [(rc, 0.0), (rc, 0.012), (r, 0.024), (r, H - r)] + _dome(a, r, H)
        body.lathe((0, 0, 0), prof, STAINLESS, segments=n, rep=1.0)
    if band > 0:
        zb = H - r - 0.03 - band
        K(a, "band").lathe((0, 0, 0), [(r + 0.002, zb), (r + 0.002, zb + band)], YELLOW, segments=n, rep=1.0)
    a.col_part("bollard").cylinder((0, 0, 0), rc, H, "gteki_concrete", segments=12)
    return finish(a)


# ---------------------------------------------------------------------------
# street_guard_rail
# ---------------------------------------------------------------------------


def street_guard_rail(asset_id, params, tex_res):
    """Pedestrian guard rail along a polyline: posts at every vertex and at most `post_spacing_mm` apart, two rails."""
    p = _merge(dict(points_mm=[[0, 0], [0, 3000]], height_mm=1000, post_spacing_mm=1500, coating="painted"), params)
    _choice(p, "coating", ("painted", "stainless"))
    _positive(p, "height_mm", "post_spacing_mm")
    pts = [(float(x) / 1000.0, float(y) / 1000.0) for x, y in p["points_mm"]]
    if len(pts) < 2:
        raise ValueError("points_mm needs at least two points")
    pts = [(x - pts[0][0], y - pts[0][1]) for x, y in pts]
    segs = list(zip(pts, pts[1:]))
    if any(math.dist(u, v) < 0.3 for u, v in segs):
        raise ValueError("every guard rail segment must be at least 300 mm long")
    H, spacing = p["height_mm"] / 1000.0, p["post_spacing_mm"] / 1000.0
    mat = STEEL if p["coating"] == "painted" else STAINLESS
    a = _asset(asset_id, p, tex_res,
               "Starts at the origin; points_mm are plan offsets (x right, y forward) from the first point. Posts at every vertex "
               "and at most post_spacing_mm apart, two round rails, mitred corners. SOCKET_start / SOCKET_end chain runs.")
    post_r, rail_r = 0.03, 0.024
    n = _segs(a, 16)
    posts = K(a, "posts")
    xy = [pts[0]]
    for (x0, y0), (x1, y1) in segs:
        cuts = math.ceil(math.dist((x0, y0), (x1, y1)) / spacing - 1e-9)
        xy += [(x0 + (x1 - x0) * i / cuts, y0 + (y1 - y0) * i / cuts) for i in range(1, cuts + 1)]
    prof = [(0.052, 0.0), (0.052, 0.01), (0.034, 0.018), (post_r, 0.03), (post_r, H - post_r)] + _dome(a, post_r, H)
    for x, y in xy:
        posts.lathe((x, y, 0), prof, mat, segments=n, rep=1.0)
    rails = K(a, "rails", bevel=0.001, bevel_segments=1)
    for z, r in ((H - rail_r, rail_r), (H * 0.5, rail_r * 0.8)):
        rails.tube([(x, y, z) for x, y in pts], r, mat, segments=12)
    # one full-height thin box per segment: a walker cannot pass between the rails
    for i, ((x0, y0), (x1, y1)) in enumerate(segs):
        d = math.dist((x0, y0), (x1, y1))
        dx, dy = (x1 - x0) / d, (y1 - y0) / d
        e, h = post_r, 0.04
        prof = [(x0 - dx * e + dy * h, y0 - dy * e - dx * h), (x1 + dx * e + dy * h, y1 + dy * e - dx * h),
                (x1 + dx * e - dy * h, y1 + dy * e + dx * h), (x0 - dx * e - dy * h, y0 - dy * e + dx * h)]
        a.col_part(f"rail_{i}").prism(prof, 0.0, H, "gteki_concrete")
    (sx, sy), (sx1, sy1) = segs[0]
    (ex0, ey0), (ex1, ey1) = segs[-1]
    a.socket("start", (0, 0, 0), _yaw_deg(sx - sx1, sy - sy1), width=0.1, height=H)
    a.socket("end", (ex1, ey1, 0), _yaw_deg(ex1 - ex0, ey1 - ey0), width=0.1, height=H)
    return finish(a)


# ---------------------------------------------------------------------------
# street_lamp
# ---------------------------------------------------------------------------


def street_lamp(asset_id, params, tex_res):
    """Pole with a gooseneck arm reaching toward -Y and a luminaire head; `height_mm` is the diffuser underside."""
    p = _merge(dict(height_mm=5000, arm_mm=900), params)
    _positive(p, "height_mm", "arm_mm")
    H, arm = p["height_mm"] / 1000.0, p["arm_mm"] / 1000.0
    if H < 3.0:
        raise ValueError("height_mm must be at least 3000")
    a = _asset(asset_id, p, tex_res,
               "Free-standing, origin on the ground at the pole. The arm and head reach toward -Y (glTF +Z); yaw the instance to "
               "aim them. LIGHTHINT_head sits on the diffuser. Collider is the pole footprint, 12-sided.")
    n = _segs(a, 20)
    hp = H - 0.149  # pole top; the arm rises 180 mm above it and the diffuser underside lands on H
    pole = K(a, "pole")
    pole.lathe((0, 0, 0), [(0.11, 0.0), (0.11, 0.015), (0.075, 0.035), (0.075, 0.45), (0.062, 0.47), (0.034, hp), (0.0, hp)],
               STEEL, segments=n, rep=1.0)
    za = hp + 0.18  # arm centre line height
    gooseneck = K(a, "arm")
    gooseneck.tube([(0, 0, hp - 0.3), (0, 0, za), (0, -arm, za)], 0.025, STEEL, segments=12, corner_radius=0.22, corner_steps=4)
    yh = -arm - 0.15  # head centre
    head = K(a, "head", bevel=0.004, bevel_segments=2)
    head.box((-0.14, yh - 0.27, za - 0.025), (0.14, yh + 0.27, za + 0.065), STEEL)
    lens = K(a, "head")
    lens.box((-0.115, yh - 0.24, za - 0.031), (0.115, yh + 0.24, za - 0.025), DIFFUSER, skip=("+z",))
    a.light_hint("head", (0, yh, za - 0.045), kind="street_lamp", size_m=0.35, watts=60.0, colour_temp_k=4000)
    a.col_part("pole").cylinder((0, 0, 0), 0.11, hp, "gteki_concrete", segments=12)
    return finish(a)


# ---------------------------------------------------------------------------
# street_planter
# ---------------------------------------------------------------------------

PLANTER_WALL = 0.08
PLANTER_SOIL_DROP = 0.06  # soil surface below the rim
PLANTER_PLINTH = 0.04  # dark plinth, inset 14 mm (style.md section 5 stack)


def _shrub(kit, a, cx, cy, z, rs):
    """Low rounded shrub: a lathe dome of radius rs on the soil surface."""
    s = rs / 0.3
    prof = [(rs, 0.0), (rs * 0.98, 0.05 * s), (rs * 0.86, 0.17 * s), (rs * 0.62, 0.28 * s), (rs * 0.3, 0.35 * s), (0.0, 0.38 * s)]
    kit.lathe((cx, cy, z), prof, FOLIAGE, segments=_segs(a, 16), rep=1.0)


def street_planter(asset_id, params, tex_res):
    """Concrete planter on a dark plinth, soil recessed under the rim, optional low shrubs."""
    p = _merge(dict(shape="box", width_mm=1200, depth_mm=600, diameter_mm=800, height_mm=600, planting="shrub"), params)
    _choice(p, "shape", ("box", "round"))
    _choice(p, "planting", ("shrub", "none"))
    _positive(p, "width_mm", "depth_mm", "diameter_mm", "height_mm")
    h = p["height_mm"] / 1000.0
    if h < 0.3:
        raise ValueError("height_mm must be at least 300")
    a = _asset(asset_id, p, tex_res,
               "Free-standing, origin on the ground at the centre. Collider is the body only (box, or 12-sided cylinder for round); "
               "shrubs do not collide. box uses width_mm x depth_mm, round uses diameter_mm.")
    zs = h - PLANTER_SOIL_DROP
    if p["shape"] == "box":
        W, D = p["width_mm"] / 1000.0, p["depth_mm"] / 1000.0
        if min(W, D) < 2 * PLANTER_WALL + 0.2:
            raise ValueError("planter is too small for its wall thickness")
        plinth = K(a, "base", bevel=0.003, bevel_segments=1)
        plinth.box((-W / 2 + 0.014, -D / 2 + 0.014, 0.0), (W / 2 - 0.014, D / 2 - 0.014, PLANTER_PLINTH), STEEL)
        body = K(a, "body", bevel=0.004, bevel_segments=1)
        body.ring(_XY, (-W / 2, W / 2, -D / 2, D / 2), (-W / 2 + PLANTER_WALL, W / 2 - PLANTER_WALL, -D / 2 + PLANTER_WALL, D / 2 - PLANTER_WALL),
                  PLANTER_PLINTH, h, CONCRETE)
        iw, idp = W - 2 * PLANTER_WALL, D - 2 * PLANTER_WALL
        K(a, "soil").box((-iw / 2 + 0.002, -idp / 2 + 0.002, PLANTER_PLINTH), (iw / 2 - 0.002, idp / 2 - 0.002, zs), SOIL)
        if p["planting"] == "shrub":
            count = max(1, round(iw / 0.5))
            rs = min(idp / 2 - 0.03, 0.3, iw / count / 2)
            plants = K(a, "plants")
            for i in range(count):
                _shrub(plants, a, -iw / 2 + iw * (i + 0.5) / count, 0.0, zs, rs)
        a.col_box("body", (-W / 2, -D / 2, 0.0), (W / 2, D / 2, h))
    else:
        R = p["diameter_mm"] / 2000.0
        if R < PLANTER_WALL + 0.1:
            raise ValueError("planter is too small for its wall thickness")
        w = PLANTER_WALL
        # plinth, outer wall, rim, inner wall, then the soil disc: one profile, one material per profile segment
        prof = [(R - 0.014, 0.0), (R - 0.014, PLANTER_PLINTH), (R, PLANTER_PLINTH), (R, h - 0.01), (R - 0.01, h), (R - w + 0.01, h),
                (R - w, h - 0.01), (R - w, zs), (0.0, zs)]
        mats = [STEEL, STEEL, CONCRETE, CONCRETE, CONCRETE, CONCRETE, CONCRETE, SOIL]
        K(a, "body").lathe((0, 0, 0), prof, STEEL, segments=_segs(a, 32), mats=mats, rep=1.0)
        if p["planting"] == "shrub":
            rs = min(R - w - 0.03, 0.3)
            _shrub(K(a, "plants"), a, 0.0, 0.0, zs, rs)
        a.col_part("body").cylinder((0, 0, 0), R, h, "gteki_concrete", segments=12)
    return finish(a)


GENERATORS = {
    "street_canopy": street_canopy,
    "street_bollard": street_bollard,
    "street_guard_rail": street_guard_rail,
    "street_lamp": street_lamp,
    "street_planter": street_planter,
}
