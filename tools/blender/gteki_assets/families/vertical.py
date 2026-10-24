"""Generic station stairs, escalators and closed elevator landing portals.

Dimension basis: ``generic-typical``; metres, Blender Z up, ascent along +Y.
These are original static game assets, never replicas or construction drawings.
Published dimensional references (consulted 2026-10-20):

* MLIT barrier-free architectural design standard, stair diagram, p. 2-59:
  https://www.mlit.go.jp/jutakukentiku/build/barrier-free.files/zenntaibann.pdf
  <=160 mm risers, >=300 mm treads, two rails at 750--850 / 600--650 mm,
  and 450 mm horizontal extensions. We use 160/300, 850/650 and 450 mm.
* MLIT tactile guidance: https://www.mlit.go.jp/notice/noticedata/sgml/069/79000102/79000102.html
  300 mm module family; warning texture uses the shared JIS-inspired pattern.
* Published escalator specification ranges (dimensions only, no product shape):
  https://www.mitsubishielectric.com/elevator/products/basic/escalators/z_type_es/pdf/brochure.pdf
  nominal S600/S1000 step widths, 30 degree incline. The kit rounds nominal
  widths to 600/1000 mm. 400 mm step pitch and 2/3 flat steps are generic layout
  choices; transition curves, casing, newels and details are original designs.
* Published elevator opening sizes:
  https://www.mebs.co.jp/elevator/new/emergency_use/
  1000/1100 x 2100 mm; 900 mm is also a common passenger opening size:
  https://www.mitsubishielectric.com/elevator/products/basic/elevators/nexiez_mrl_version_2/pdf/product_guide.pdf

Floor rises (3/4/5 m), clear stair width 2.4 m, 1.5 m intermediate landing,
0.6 m top landing, 0.3 m bottom approach, 1.1 m guards and all trim/finish
dimensions are adjustable typical kit proportions, not regulatory claims.
``stairs_landing`` is a collinear pair of flights, not a switchback stair.
``width`` is the clear tread width; side rails/stringers sit outside that width.
Horizontal rail extensions can overhang the short approach by 450 mm; the
start socket remains at the entry floor edge, y=0. Escalator length includes
flat steps, floor plates and eased transitions, and is recorded in params.
All four generators accept the defaults below as params; derived dimensions
are recorded alongside them. The elevator is a closed portal with no cabin.
"""

import math

import bmesh

from .. import contract, materials
from ..asset import Asset
from ..mesh import rounded_rect

GEN = "tools/blender/gteki_assets/families/vertical.py"

# Local extensions only: shared material names remain available for swapping.
materials.register("gteki_vertical_safety_yellow", color=(0.96, 0.69, 0.035), rough=0.48)
materials.register("gteki_vertical_nosing_light", color=(0.87, 0.86, 0.78), rough=0.65)
materials.register("gteki_vertical_mirror", color=(0.85, 0.88, 0.90), rough=0.065, metal=1.0)

STEEL = "gteki_steel_brushed"
DARK = "gteki_reveal_dark"
YELLOW = "gteki_vertical_safety_yellow"
NOSINGS = {"rubber": "gteki_rubber_nosing", "yellow": YELLOW,
           "light": "gteki_vertical_nosing_light"}
FLOORS = {"terrazzo": "gteki_floor_terrazzo", "granite": "gteki_floor_granite_dark"}
SIDES = ("wall", "balustrade_glass", "balustrade_solid", "none")

STAIR_DEFAULTS = dict(
    rise=3.0, width=2.4, riser_max=0.16, tread=0.30, nosing="rubber",
    side_left="balustrade_glass", side_right="balustrade_glass",
    handrails=True, rail_upper=0.85, rail_lower=0.65, rail_radius=0.018,
    rail_extension=0.45, rail_return=0.12, center_rail="auto",
    center_threshold=3.0, post_spacing=1.2, guard_height=1.1,
    wall_height=2.6, side_t=0.12, slab_t=0.20, stringer_height=0.10,
    bottom_approach=0.80, top_landing=0.60, landing_depth=1.50,  # approach covers the 0.45 m rail extension
    tactile_depth=0.30, tread_finish="terrazzo", riser_finish="gteki_wall_panel_enamel",
    soffit_finish="gteki_ceiling_plaster", step_lights=True, socket_height=2.4,
    allow_below_floor=True,
)

ESCALATOR_DEFAULTS = dict(
    rise=5.0, step_width=1.0, incline=30.0, flat_steps=2, direction="up",
    balustrade="glass", step_depth=0.40, transition_run=0.80,
    landing=0.80, handrail_height=0.95, handrail_radius=0.036,
    newel_radius=0.40, deck_width=0.30, skirt_height=0.18,
    truss_depth=0.65, panel_module=1.2, glass_t=0.014,
    socket_height=2.4, allow_below_floor=True,
)

LIFT_DEFAULTS = dict(
    door_width=1.0, door_height=2.1, depth=0.26, frame_width=0.14,
    header_height=0.25, surround_width=0.42, surround_height=2.7,
    approach=0.90, tactile_depth=0.30, tactile_setback=0.30,
    button_height=1.05, mirror=False, allow_below_floor=True,
)


def _params(defaults, params):
    p = dict(defaults)
    p.update(params or {})
    return p


def _positive(p, *keys):
    for key in keys:
        value = p[key]
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError(f"{key} must be a finite positive number")


def _choice(p, key, choices):
    if p[key] not in choices:
        raise ValueError(f"{key} must be one of {choices}")


def _asset(asset_id, variant, p, tex_res):
    return Asset(asset_id, "vertical", variant, p, GEN, contract.GENERIC_TYPICAL,
                 tex_res, notes="Original generic static kit; no brand, station identity or navigation truth.")


def _finish(a):
    """Local mesh fixes: connected bevels, outward normals and metre-based UVs.

    Part primitives initially have separate face vertices and project UVs before
    normals exist. Weld here, orient closed components, then reproject only flat
    faces. Tubes/cylinder sides retain their explicit distance-based UVs.
    """
    for _, part in a.parts + a.collision:
        part.merge_doubles(dist=0.000001)
        bmesh.ops.recalc_face_normals(part.bm, faces=list(part.bm.faces))
        part.bm.normal_update()
        for face in part.bm.faces:
            if not face.smooth:
                part._box_uv(face, a.materials[face.material_index])
    return a


def _profile_part(a, group, path, x0, x1, lower, upper, mat, bevel=0.003):
    """Closed ribbon around a piecewise-linear floor datum in the YZ plane."""
    part = a.part(group, bevel=bevel, bevel_segments=1)
    profile = [(y, z + lower) for y, z in path]
    profile += [(y, z + upper) for y, z in reversed(path)]
    part.extrude_x(profile, x0, x1, mat)
    return part


def _height(path, y):
    if y <= path[0][0]:
        return path[0][1]
    for (y0, z0), (y1, z1) in zip(path, path[1:]):
        if y <= y1:
            return z0 + (z1 - z0) * (y - y0) / (y1 - y0)
    return path[-1][1]


def _slice(path, y0, y1):
    return [(y0, _height(path, y0))] + [(y, z) for y, z in path if y0 < y < y1] + [(y1, _height(path, y1))]


def _block_path(a, name, x0, x1, path, height, depth=0.20):
    for i, ((y0, z0), (y1, z1)) in enumerate(zip(path, path[1:])):
        if abs(z1 - z0) < 1e-8:
            a.col_box(f"{name}_{i}", (x0, y0, z0 - depth), (x1, y1, z1 + height))
        else:
            a.col_ramp(f"{name}_{i}", x0, x1, y0, z0 + height,
                       y1, z1 + height, thickness=height + depth)


def _flat(a, name, width, y0, y1, z, p):
    part = a.part("landings", bevel=0.002, bevel_segments=1)
    part.box((-width / 2, y0, z - p["slab_t"]), (width / 2, y1, z),
             p["soffit_finish"], mats={"+z": FLOORS[p["tread_finish"]]})
    a.col_box(name, (-width / 2, y0, z - p["slab_t"]), (width / 2, y1, z))


def _tactile(a, width, y0, z, depth):
    # A 3 mm recess-free overlay: no coincident floor faces or fragile decals.
    part = a.part("tactile", bevel=0.001, bevel_segments=1)
    part.box((-width / 2, y0, z + 0.002), (width / 2, y0 + depth, z + 0.005), "gteki_tactile_dots")


def _flight(a, p, y0, z0, n, riser, index):
    w, tread, slab = p["width"], p["tread"], p["slab_t"]
    end, top = y0 + n * tread, z0 + n * riser
    profile = [(y0, z0 - slab), (end, top - slab), (end, top)]
    for i in reversed(range(n)):
        profile += [(y0 + i * tread, z0 + (i + 1) * riser),
                    (y0 + i * tread, z0 + i * riser)]
    shell = a.part("stair_structure", bevel=0.002, bevel_segments=1)
    shell.extrude_x(profile, -w / 2, w / 2, p["riser_finish"], cap_mat=p["soffit_finish"])
    # The sloping underside is visible and finished, including open-sided kits.
    for face in shell.bm.faces:
        if all(v.co.z < _height([(y0, z0), (end, top)], v.co.y) - slab + 0.0001 for v in face.verts):
            face.material_index = a.mat_index(p["soffit_finish"])
    treads = a.part("treads", bevel=0.002, bevel_segments=1)
    strips = a.part("nosings", bevel=0.001, bevel_segments=1)
    for i in range(n):
        y, z = y0 + i * tread, z0 + (i + 1) * riser
        # Inset the cap into the shell, leaving only its finished surface exposed.
        treads.box((-w / 2, y + 0.002, z - 0.025), (w / 2, y + tread - 0.002, z + 0.002), FLOORS[p["tread_finish"]])
        strips.box((-w / 2 + 0.008, y + 0.010, z + 0.004),
                   (w / 2 - 0.008, y + 0.065, z + 0.008), NOSINGS[p["nosing"]])
        # Flush aluminium nosing lip, no projecting trip edge.
        strips.box((-w / 2, y - 0.002, z - 0.021), (w / 2, y + 0.006, z - 0.003), STEEL)
    a.col_ramp(f"flight_{index}", -w / 2, w / 2, y0, z0, end, top, thickness=slab)
    return end, top


def _stair_rails(a, p, path, noses, x, side, wall=False, center=False, segments=10, support_segments=8):
    """Two continuous tiers; horizontal ends fold back toward their supports.

    ``segments`` / ``support_segments`` set the tube cross-sections only (dressing.py lowers them).
    """
    ext, ret = p["rail_extension"], p["rail_return"]
    rails = a.part("handrails")
    support = a.part("rail_supports", bevel=0.002, bevel_segments=1)
    rail_path = [(noses[0][0] - ext, 0)] + noses + [(noses[-1][0] + ext, path[-1][1])]
    # For a short approach, the horizontal extension deliberately overhangs it.
    for h in (p["rail_upper"], p["rail_lower"]):
        points = [(x + side * 0.065, rail_path[0][0], h - ret),
                  (x, rail_path[0][0], h - ret), (x, rail_path[0][0], h)]
        points += [(x, y, z + h) for y, z in rail_path[1:-1]]
        points += [(x, rail_path[-1][0], rail_path[-1][1] + h),
                   (x, rail_path[-1][0], rail_path[-1][1] + h - ret),
                   (x + side * 0.065, rail_path[-1][0], rail_path[-1][1] + h - ret)]
        rails.tube(points, p["rail_radius"], STEEL, segments=segments, corner_radius=0.085,
                   corner_steps=max(2, round(5 * segments / 10)))
    support_y0 = max(path[0][0], rail_path[0][0] + 0.12)
    support_y1 = min(path[-1][0], rail_path[-1][0] - 0.12)
    length = support_y1 - support_y0
    count = max(2, math.ceil(length / p["post_spacing"]))
    for i in range(count + 1):
        y = support_y0 + length * (i + 0.15) / (count + 0.30)
        z = _height(path, y)
        rail_z = _height(rail_path, y)
        if wall:
            for h in (p["rail_upper"], p["rail_lower"]):
                support.tube([(x + side * 0.085, y, rail_z + h - 0.075),
                              (x, y, rail_z + h - 0.075), (x, y, rail_z + h)],
                             0.010, STEEL, segments=support_segments, corner_radius=0.025)
        else:
            px = x if center else x + side * 0.065
            support.cylinder((px, y, z + 0.03), 0.021, rail_z - z + p["rail_upper"] - 0.03, STEEL, segments=10)
            support.cylinder((px, y, z + 0.01), 0.045, 0.025, STEEL, segments=12)
            if not center:
                for h in (p["rail_upper"], p["rail_lower"]):
                    support.tube([(px, y, rail_z + h - 0.05), (x, y, rail_z + h - 0.05), (x, y, rail_z + h)],
                                 0.010, STEEL, segments=support_segments, corner_radius=0.02)
    if center:
        blocker_path = _slice(rail_path, max(0, rail_path[0][0]), min(path[-1][0], rail_path[-1][0]))
        _block_path(a, "center_rail", -0.04, 0.04, blocker_path, p["rail_upper"])


def _stair_sides(a, p, path, noses):
    w, thickness = p["width"], p["side_t"]
    for side, key in ((-1, "side_left"), (1, "side_right")):
        style = p[key]
        # Rails live outside the clear walking width; stringers bridge the gap.
        xa, xb = sorted((side * w / 2, side * (w / 2 + thickness + 0.10)))
        _profile_part(a, "stringers", path, xa, xb, -p["slab_t"], p["stringer_height"], "gteki_floor_granite_dark")
        gx = side * (w / 2 + 0.115)
        if style == "wall":
            # Keep the inner wall face fixed outside the clear tread/rail zone;
            # thickness grows outward, never into the rail or walking width.
            wx0, wx1 = sorted((side * (w / 2 + 0.10), side * (w / 2 + 0.10 + thickness)))
            _profile_part(a, "walls", path, wx0, wx1,
                          0.10, p["wall_height"], "gteki_wall_panel_enamel")
            _profile_part(a, "wall_caps", path, wx0 - 0.005, wx1 + 0.005,
                          p["wall_height"], p["wall_height"] + 0.018, STEEL)
        elif style != "none":
            panel_h = p["guard_height"]
            count = max(1, math.ceil(path[-1][0] / p["post_spacing"]))
            module = path[-1][0] / count
            for i in range(count):
                panel_path = _slice(path, i * module + 0.009, (i + 1) * module - 0.009)
                glass = style == "balustrade_glass"
                t = 0.014 if glass else 0.045
                _profile_part(a, "balustrades", panel_path, gx - t / 2, gx + t / 2,
                              0.12, panel_h - 0.045,
                              "gteki_glass_clear" if glass else "gteki_wall_panel_enamel", bevel=0.001)
            _profile_part(a, "guard_caps", path, gx - 0.023, gx + 0.023,
                          panel_h - 0.045, panel_h, STEEL)
            _profile_part(a, "guard_shoes", path, gx - 0.035, gx + 0.035, 0.10, 0.17, STEEL)
        blocker_h = p["wall_height"] if style == "wall" else p["guard_height"] if style != "none" else p["stringer_height"]
        _block_path(a, f"side_{key}", xa, xb, path, blocker_h, p["slab_t"])
        if p["handrails"] and style != "none":
            _stair_rails(a, p, path, noses, side * (w / 2 + 0.025), side, wall=style == "wall")
        if p["step_lights"]:
            lights = a.part("step_lights", bevel=0.002, bevel_segments=1)
            for i in range(max(2, math.ceil(path[-1][0] / 2.4))):
                y = 0.15 + i * (path[-1][0] - 0.30) / max(1, math.ceil(path[-1][0] / 2.4) - 1)
                z = _height(path, y)
                # Down-facing lenses tucked under the inner edge of the stringer.
                lights.box((xa + 0.025, y - 0.065, z + 0.104), (xb - 0.025, y + 0.065, z + 0.116), DARK)
                lights.box((xa + 0.04, y - 0.045, z + 0.117), (xb - 0.04, y + 0.045, z + 0.122), "gteki_light_diffuser")
                a.light_hint(f"stair_{key}_{i}", (side * (w / 2 + 0.055), y, z + 0.12), kind="step_light", size_m=0.10, watts=2.0)
    if p["handrails"] and (p["center_rail"] is True or p["center_rail"] == "auto" and w >= p["center_threshold"]):
        _stair_rails(a, p, path, noses, 0.0, 1, center=True)


def _stairs(asset_id, params, tex_res, landing):
    p = _params(STAIR_DEFAULTS, params)
    if landing and "rise" not in (params or {}):
        p["rise"] = 4.0
    _positive(p, "rise", "width", "riser_max", "tread", "top_landing", "bottom_approach", "slab_t", "side_t",
              "tactile_depth", "rail_upper", "rail_lower", "rail_radius", "rail_extension", "rail_return",
              "post_spacing", "guard_height", "wall_height", "stringer_height", "socket_height", "center_threshold")
    for key in ("side_left", "side_right"):
        _choice(p, key, SIDES)
    _choice(p, "nosing", NOSINGS)
    _choice(p, "tread_finish", FLOORS)
    _choice(p, "center_rail", (True, False, "auto"))
    if p["top_landing"] < p["tactile_depth"] or p["bottom_approach"] < p["tactile_depth"]:
        raise ValueError("approach and top landing must fit tactile_depth")
    if not p["rail_lower"] < p["rail_upper"] < p["guard_height"]:
        raise ValueError("rail_lower < rail_upper < guard_height is required")
    n = math.ceil(p["rise"] / p["riser_max"])
    if landing and n < 2:
        raise ValueError("two flights require at least two risers")
    if landing and (not isinstance(p["landing_depth"], (int, float)) or not math.isfinite(p["landing_depth"]) or p["landing_depth"] < 1.2):
        raise ValueError("landing_depth must be at least 1.2 m")
    p.update(n_risers=n, riser=p["rise"] / n, flights=2 if landing else 1)
    a = _asset(asset_id, "stairs_landing" if landing else "stairs_straight", p, tex_res)
    y, z = p["bottom_approach"], 0.0
    path = [(0.0, 0.0), (y, z)]
    _flat(a, "bottom", p["width"], 0, y, 0, p)
    flights = (n // 2, n - n // 2) if landing else (n,)
    noses = []
    for index, count in enumerate(flights):
        # Extrapolate the nosing line one tread before the first riser so the
        # sloped rail is exactly rail_upper/lower above every tread nose.
        noses.append((y - p["tread"], z))
        y, z = _flight(a, p, y, z, count, p["riser"], index)
        noses.append((y - p["tread"], z))
        path.append((y, z))
        if index < len(flights) - 1:
            _flat(a, "intermediate", p["width"], y, y + p["landing_depth"], z, p)
            y += p["landing_depth"]
            path.append((y, z))
    _flat(a, "top", p["width"], y, y + p["top_landing"], z, p)
    _tactile(a, p["width"], p["bottom_approach"] - p["tactile_depth"], 0, p["tactile_depth"])
    _tactile(a, p["width"], y + (p["top_landing"] - p["tactile_depth"]) / 2, z, p["tactile_depth"])
    y += p["top_landing"]
    path.append((y, z))
    _stair_sides(a, p, path, noses)
    p["length"] = y
    a.socket("start", (0, 0, 0), 180.0, width=p["width"], height=p["socket_height"])
    a.socket("end", (0, y, p["rise"]), 0.0, width=p["width"], height=p["socket_height"])
    return _finish(a)


def stairs_straight(asset_id, params, tex_res):
    return _stairs(asset_id, params, tex_res, False)


def stairs_landing(asset_id, params, tex_res):
    return _stairs(asset_id, params, tex_res, True)


def _indicator(a, x, y, z, permitted, facing=-1, name="entry"):
    """Geometric green arrow or red no-entry disc; facing is +/- Blender Y."""
    part = a.part("indicators", bevel=0.001, bevel_segments=1)
    y0 = y if facing == -1 else y - 0.018
    part.cylinder((x, y0, z), 0.067, 0.018, DARK, segments=24, axis="y")
    front = y - 0.003 if facing == -1 else y + 0.003
    mat = "gteki_emissive_green" if permitted else "gteki_emissive_red"
    if permitted:
        points = [(-0.013, -0.034), (0.013, -0.034), (0.013, 0.006),
                  (0.036, 0.006), (0, 0.043), (-0.036, 0.006), (-0.013, 0.006)]
        verts = [(x + u, front, z + v) for u, v in points]
        part.poly(verts if facing == -1 else list(reversed(verts)), mat)
    else:
        part.cylinder((x, front, z), 0.049, 0.001, mat, segments=24, axis="y")
        bar_y = front - 0.003 if facing == -1 else front + 0.004
        part.box((x - 0.037, bar_y, z - 0.009), (x + 0.037, bar_y + 0.002, z + 0.009), "gteki_vertical_nosing_light")
    a.light_hint(name, (x, front, z), kind="indicator", size_m=0.08, watts=0.4)


def _escalator_path(p):
    slope = math.tan(math.radians(p["incline"]))
    t, rise = p["transition_run"], p["rise"]
    main = rise / slope - t
    if main <= 0:
        raise ValueError("rise is too small for transition_run and incline")
    flat = p["flat_steps"] * p["step_depth"]
    y0 = p["landing"] + flat
    path = [(p["landing"], 0.0), (y0, 0.0)]
    # Quadratic elevation yields a continuous tangent 0 -> incline -> 0.
    for i in range(1, 9):
        u = i / 8
        path.append((y0 + t * u, slope * t * u * u / 2))
    y1, z1 = path[-1]
    path.append((y1 + main, rise - slope * t / 2))
    y2, z2 = path[-1]
    for i in range(1, 9):
        u = i / 8
        path.append((y2 + t * u, z2 + slope * t * (u - u * u / 2)))
    path.append((path[-1][0] + flat, rise))
    length = path[-1][0] + p["landing"]
    p.update(length=length, inclined_run=main, flat_run_each=flat,
             transition_run_each=t, transition_allowance=t,
             nominal_incline_run=rise / slope, landing_run_total=2 * (flat + p["landing"]))
    return [(0.0, 0.0)] + path + [(length, rise)]


def escalator(asset_id, params, tex_res, handrail_segments=10, handrail_corner=0.035):
    """``handrail_*`` shape the moving handrail's sweep only (not params); dressing.py thins it."""
    p = _params(ESCALATOR_DEFAULTS, params)
    _positive(p, "rise", "step_width", "incline", "step_depth", "transition_run", "landing",
              "handrail_height", "handrail_radius", "newel_radius", "deck_width", "skirt_height",
              "truss_depth", "panel_module", "glass_t", "socket_height")
    if not 15 <= p["incline"] <= 35:
        raise ValueError("incline must be between 15 and 35 degrees")
    if isinstance(p["flat_steps"], bool) or not isinstance(p["flat_steps"], int) or p["flat_steps"] not in (2, 3):
        raise ValueError("flat_steps must be 2 or 3")
    _choice(p, "direction", ("up", "down"))
    _choice(p, "balustrade", ("glass", "panel"))
    if p["landing"] <= p["newel_radius"] + 0.15 or p["handrail_height"] <= 2 * p["newel_radius"] + 0.05:
        raise ValueError("landing/handrail height must accommodate the newel radius")
    if p["deck_width"] < 0.22 or p["skirt_height"] >= p["handrail_height"] - 0.12:
        raise ValueError("deck_width >= 0.22 and sufficient balustrade height are required")
    path = _escalator_path(p)
    a = _asset(asset_id, "escalator", p, tex_res)
    w, length, landing = p["step_width"], p["length"], p["landing"]
    moving_start, moving_end = landing, length - landing
    # Preserve exactly flat_steps at both ends, then subdivide each transition
    # and the main incline independently (never stretch a tread across a bend).
    bounds = [moving_start + i * p["step_depth"] for i in range(p["flat_steps"] + 1)]
    y = bounds[-1]
    for run in (p["transition_run"], p["inclined_run"], p["transition_run"]):
        count = max(1, math.ceil(run / p["step_depth"]))
        bounds += [y + run * i / count for i in range(1, count + 1)]
        y += run
    bounds += [y + i * p["step_depth"] for i in range(1, p["flat_steps"] + 1)]
    p["n_steps"] = len(bounds) - 1
    treads = a.part("steps", bevel=0.0015, bevel_segments=1)
    edges = a.part("demarcation", bevel=0.0008, bevel_segments=1)
    previous = 0.0
    for i, (y0, y1) in enumerate(zip(bounds, bounds[1:])):
        # Sample the step centre, not its leading boundary: the first eased
        # step must already rise, otherwise it becomes an unintended extra
        # flat step. The collision datum also meets each tread at its centre.
        z = _height(path, (y0 + y1) / 2)
        treads.box((-w / 2, y0 + 0.001, previous - 0.045),
                   (w / 2, y1 - 0.001, z), "gteki_escalator_tread")
        edges.box((-w / 2 + 0.005, y0 + 0.006, z + 0.002), (w / 2 - 0.005, y0 + 0.022, z + 0.005), YELLOW)
        for side in (-1, 1):
            xa, xb = sorted((side * (w / 2 - 0.021), side * (w / 2 - 0.005)))
            edges.box((xa, y0 + 0.024, z + 0.002), (xb, y1 - 0.006, z + 0.005), YELLOW)
        previous = z
    plates = a.part("landing_plates", bevel=0.002, bevel_segments=1)
    combs = a.part("comb_plates", bevel=0.001, bevel_segments=1)
    overall = w + 2 * p["deck_width"]
    for top in (False, True):
        y0, y1, z = (length - landing, length, p["rise"]) if top else (0.0, landing, 0.0)
        plates.box((-overall / 2, y0, z - 0.18), (overall / 2, y1, z - 0.003), "gteki_steel_painted_light")
        plates.box((-w / 2 - 0.02, y0 + 0.005, z - 0.003), (w / 2 + 0.02, y1 - 0.005, z), "gteki_escalator_tread")
        cy = y0 if top else y1 - 0.08
        combs.box((-w / 2, cy, z + 0.002), (w / 2, cy + 0.08, z + 0.006), STEEL)
        ty0, ty1 = (cy - 0.025, cy + 0.040) if top else (cy + 0.040, cy + 0.105)
        for i in range(max(1, round(w / 0.025))):
            x = -w / 2 + (i + 0.5) * w / max(1, round(w / 0.025))
            combs.box((x - 0.006, ty0, z + 0.008), (x + 0.006, ty1, z + 0.012), YELLOW)
    # Stay below the *back* of each horizontal tread, not only its front.
    # The casing otherwise cuts through the steps on the main incline.
    tread_clearance = p["step_depth"] * math.tan(math.radians(p["incline"])) + 0.06
    if p["truss_depth"] <= tread_clearance + 0.04:
        raise ValueError("truss_depth must clear the horizontal step profile")
    _profile_part(a, "truss_soffit", path, -overall / 2, overall / 2,
                  -p["truss_depth"], -tread_clearance, "gteki_steel_painted_light", bevel=0.006)
    rail_y0, rail_y1 = landing - 0.12, length - landing + 0.12
    railpath = _slice(path, rail_y0, rail_y1)
    for side in (-1, 1):
        xa, xb = sorted((side * (w / 2 + 0.012), side * overall / 2))
        gx = side * (w / 2 + 0.16)
        # Dark backing behind independent side panels gives deliberate seams.
        # The floor plates close the end of the casing. Recess the backing and
        # skirt ends 8 mm so their caps cannot fight the floor plate end faces.
        inset_path = _slice(path, 0.008, length - 0.008)
        backing = _profile_part(a, "truss_reveals", inset_path, xa, xb,
                                -p["truss_depth"] + 0.02, 0.07, DARK)
        for face in backing.bm.faces:
            if any(all(abs(v.co.y - end_y) < 0.000001 for v in face.verts)
                   for end_y in (0.008, length - 0.008)):
                face.material_index = a.mat_index("gteki_steel_painted_light")
        count = max(1, math.ceil(length / p["panel_module"]))
        for i in range(count):
            span = _slice(path, i * length / count + 0.006, (i + 1) * length / count - 0.006)
            outer = side * (overall / 2 + 0.003)
            part = _profile_part(a, "truss_cladding", span, min(outer, outer - side * 0.015), max(outer, outer - side * 0.015),
                                 -p["truss_depth"] + 0.035, 0.09, "gteki_steel_painted_light", bevel=0.002)
            # Darken inner cap faces so panel gaps read as reveals without AO.
            inner_ends = ([span[0][0]] if i > 0 else []) + ([span[-1][0]] if i < count - 1 else [])
            for face in part.bm.faces:
                if any(all(abs(v.co.y - end_y) < 0.000001 for v in face.verts) for end_y in inner_ends):
                    face.material_index = a.mat_index(DARK)
        _profile_part(a, "skirts", inset_path, xa, xb, -0.06, p["skirt_height"], STEEL)
        brushx = side * (w / 2 + 0.016)
        _profile_part(a, "skirt_brushes", path, brushx - 0.014, brushx + 0.014,
                      0.055, 0.073, "gteki_rubber_black", bevel=0.001)
        _profile_part(a, "deck_boards", railpath, xa, xb, p["skirt_height"], p["skirt_height"] + 0.033, STEEL)
        h, r = p["handrail_height"], p["newel_radius"]
        lower = h - 2 * r
        # Newel glass/panel profile has rounded ends, not square cliff edges.
        profile = [(y, z + min(lower, p["skirt_height"]) - 0.015) for y, z in railpath]
        for i in range(1, 13):
            ang = -math.pi / 2 + math.pi * i / 12
            profile.append((rail_y1 + r * math.cos(ang), p["rise"] + h - r + r * math.sin(ang)))
        profile += [(y, z + h - 0.035) for y, z in reversed(railpath)]
        for i in range(1, 13):
            ang = math.pi / 2 + math.pi * i / 12
            profile.append((rail_y0 + r * math.cos(ang), h - r + r * math.sin(ang)))
        glass = a.part("balustrades", bevel=0.001, bevel_segments=1)
        bt = p["glass_t"] if p["balustrade"] == "glass" else 0.035
        glass.extrude_x(profile, gx - bt / 2, gx + bt / 2,
                        "gteki_glass_clear" if p["balustrade"] == "glass" else "gteki_wall_panel_enamel")
        _profile_part(a, "balustrade_shoes", railpath, gx - 0.028, gx + 0.028,
                      p["skirt_height"] + 0.025, p["skirt_height"] + 0.085, STEEL)
        # Closed moving handrail, including a lower return run and semicircular
        # turnarounds. tube's rounding also softens transition sampling corners.
        # Put the seam in a straight horizontal section: both endpoint tangents
        # then match exactly, so the swept rings weld into a watertight loop.
        points = [(gx, rail_y0 + 0.06, h)]
        points += [(gx, y, z + h) for y, z in railpath[1:]]
        for i in range(1, 17):
            ang = math.pi / 2 - math.pi * i / 16
            points.append((gx, rail_y1 + r * math.cos(ang), p["rise"] + h - r + r * math.sin(ang)))
        points += [(gx, y, z + lower) for y, z in reversed(railpath[:-1])]
        for i in range(1, 17):
            ang = -math.pi / 2 - math.pi * i / 16
            points.append((gx, rail_y0 + r * math.cos(ang), h - r + r * math.sin(ang)))
        points.append(points[0])
        handrail = a.part("moving_handrails")
        handrail.tube(points, p["handrail_radius"], "gteki_rubber_black", segments=handrail_segments,
                      caps=False, corner_radius=handrail_corner, corner_steps=3)
        bases = a.part("newel_bases", bevel=0.004, bevel_segments=2)
        for top in (False, True):
            cy, z = (rail_y1, p["rise"]) if top else (rail_y0, 0)
            bases.prism(rounded_rect(gx - 0.10, cy - 0.29, gx + 0.10, cy + 0.29, 0.07, steps=5),
                        z + 0.015, z + max(0.38, lower + 0.01), STEEL)
            iy = cy + 0.292 if top else cy - 0.292
            # Badge sits below the front turnaround, where the rubber belt
            # cannot obscure the arrow/no-entry symbol from an approaching eye.
            _indicator(a, gx, iy, z + 0.16, (p["direction"] == "down") if top else (p["direction"] == "up"),
                       facing=1 if top else -1, name=f"newel_{side}_{int(top)}")
        _block_path(a, f"balustrade_{side}", xa, xb, path, h, p["truss_depth"])
    # Floor plates are flat, while the boarding line and transition collisions
    # share the same eased datum as the mechanical step surface.
    _block_path(a, "walking", -w / 2, w / 2, path, 0.0, 0.12)
    a.socket("start", (0, 0, 0), 180.0, width=w, height=p["socket_height"])
    a.socket("end", (0, length, p["rise"]), 0.0, width=w, height=p["socket_height"])
    return _finish(a)


def lift_portal(asset_id, params, tex_res):
    p = _params(LIFT_DEFAULTS, params)
    _positive(p, "door_width", "door_height", "depth", "frame_width", "header_height",
              "surround_width", "surround_height", "approach", "tactile_depth", "tactile_setback", "button_height")
    if not 0.9 <= p["door_width"] <= 1.1:
        raise ValueError("door_width must be between 0.9 and 1.1 m")
    if p["surround_height"] < p["door_height"] + p["header_height"]:
        raise ValueError("surround_height must contain the door and header")
    if p["approach"] < p["tactile_depth"] + p["tactile_setback"] or p["surround_width"] < p["frame_width"] + 0.18:
        raise ValueError("approach/surround must accommodate tactile band and call panel")
    if not 0.75 <= p["button_height"] <= p["door_height"] - 0.20:
        raise ValueError("button_height must fit the accessible side panel")
    a = _asset(asset_id, "lift_portal", p, tex_res)
    w, h, d, fw = p["door_width"], p["door_height"], p["depth"], p["frame_width"]
    outer = w / 2 + p["surround_width"]
    surround = a.part("surround", bevel=0.003, bevel_segments=1)
    for side in (-1, 1):
        xa, xb = sorted((side * (w / 2 + fw), side * outer))
        surround.box((xa, 0.02, 0), (xb, d, p["surround_height"]), "gteki_wall_tile_white")
    # Side pieces already reach the full surround height. Restrict the lintel
    # to their inner edges to avoid coplanar tile faces at the two upper corners.
    if p["surround_height"] > h + p["header_height"]:
        surround.box((-w / 2 - fw, 0.02, h + p["header_height"]),
                     (w / 2 + fw, d, p["surround_height"]), "gteki_wall_tile_white")
    backing = a.part("door_reveals")
    backing.box((-w / 2 - 0.012, 0.055, 0), (w / 2 + 0.012, d, h + 0.012), DARK)
    frame = a.part("portal_frame", bevel=0.004, bevel_segments=2)
    for side in (-1, 1):
        xa, xb = sorted((side * w / 2, side * (w / 2 + fw)))
        frame.box((xa, -0.045, 0), (xb, d, h), STEEL)
    frame.box((-w / 2 - fw, -0.045, h), (w / 2 + fw, d, h + p["header_height"]), STEEL)
    doors = a.part("doors", bevel=0.003, bevel_segments=2, uv_rotate=True)
    doors.box((-w / 2 + 0.012, 0, 0.012), (-0.004, 0.055, h - 0.010), STEEL)
    doors.box((0.004, 0, 0.012), (w / 2 - 0.012, 0.055, h - 0.010), STEEL)
    floor = a.part("approach_floor", bevel=0.002, bevel_segments=1)
    floor.box((-outer, -p["approach"], -0.16), (outer, 0.12, 0),
              "gteki_concrete", mats={"+z": "gteki_floor_terrazzo"})
    frame.box((-w / 2 - 0.025, -0.12, 0), (w / 2 + 0.025, 0.12, 0.003), STEEL)
    tracks = a.part("threshold_tracks")
    for y in (-0.025, 0.025, 0.065):
        tracks.box((-w / 2, y - 0.003, 0.005), (w / 2, y + 0.003, 0.008), DARK)
    skirting = a.part("skirting", bevel=0.002, bevel_segments=1)
    for side in (-1, 1):
        xa, xb = sorted((side * (w / 2 + fw), side * outer))
        skirting.box((xa, -0.005, 0), (xb, 0.02, 0.10), STEEL)
    _tactile(a, w, -p["tactile_setback"] - p["tactile_depth"], 0, p["tactile_depth"])
    call = a.part("call_panel", bevel=0.003, bevel_segments=2)
    cx = w / 2 + fw + (p["surround_width"] - fw) / 2
    cz = p["button_height"]
    call.box((cx - 0.062, -0.022, cz - 0.13), (cx + 0.062, 0.018, cz + 0.17), STEEL)
    buttons = a.part("buttons")
    for i, z in enumerate((cz + 0.065, cz - 0.050)):
        buttons.cylinder((cx, -0.035, z), 0.031, 0.013, DARK, segments=24, axis="y")
        buttons.cylinder((cx, -0.039, z), 0.024, 0.004, "gteki_emissive_green", segments=24, axis="y")
        s = 1 if i == 0 else -1
        buttons.poly([(cx - 0.011, -0.042, z - s * 0.005), (cx + 0.011, -0.042, z - s * 0.005),
                      (cx, -0.042, z + s * 0.011)], "gteki_vertical_nosing_light")
        a.light_hint(f"call_{i}", (cx, -0.04, z), kind="indicator", size_m=0.04, watts=0.2)
    # Small tactile locator studs carry no text or invented Braille message.
    for dx in (-0.012, 0, 0.012):
        buttons.cylinder((cx + dx, -0.030, cz + 0.125), 0.0025, 0.006, DARK, segments=8, axis="y")
    display = a.part("floor_indicator", bevel=0.003, bevel_segments=1)
    iz = h + p["header_height"] / 2
    display.box((-0.15, -0.055, iz - 0.050), (0.15, -0.046, iz + 0.050), DARK)
    dots = a.part("indicator_dots")
    for row in range(3):
        for col in range(7):
            # Abstract symmetric progress pattern, deliberately not digits.
            mat = "gteki_emissive_red" if row == 1 or col in (2, 4) else "gteki_plastic_dark"
            dots.cylinder(((col - 3) * 0.031, -0.060, iz + (row - 1) * 0.022), 0.004, 0.003, mat, segments=10, axis="y")
    a.light_hint("floor_indicator", (0, -0.062, iz), kind="indicator", size_m=0.15, watts=0.3)
    light = a.part("portal_light", bevel=0.002, bevel_segments=1)
    light.box((-w / 2 + 0.025, -0.037, h - 0.014), (w / 2 - 0.025, -0.006, h - 0.004), "gteki_light_diffuser")
    a.light_hint("portal_downlight", (0, -0.035, h - 0.018), kind="linear_led", length_m=w - 0.05, axis="x", colour_temp_k=4000)
    if p["mirror"]:
        mirror = a.part("accessible_mirror", bevel=0.004, bevel_segments=1)
        mx = -cx
        mirror.box((mx - 0.105, -0.016, 0.80), (mx + 0.105, 0.018, 1.55), STEEL)
        mirror.box((mx - 0.093, -0.020, 0.812), (mx + 0.093, -0.017, 1.538), "gteki_vertical_mirror")
    a.col_box("closed_portal", (-outer, -0.045, 0), (outer, d, p["surround_height"]))
    a.col_box("approach", (-outer, -p["approach"], -0.16), (outer, 0.12, 0))
    a.socket("start", (0, 0, 0), 180.0, width=w, height=h)
    a.socket("end", (0, d, 0), 0.0, width=w, height=h, closed_portal=True)
    p["length"] = d
    return _finish(a)


GENERATORS = {"stairs_straight": stairs_straight, "stairs_landing": stairs_landing,
              "escalator": escalator, "lift_portal": lift_portal}
