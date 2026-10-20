"""Shared PBR material library.

Each material has a stable `gteki_*` name (runtime may swap by name) and is
either flat (factor-only) or backed by a seeded tileable texture set from
texsynth. `repeat_m` is the real-world size of one texture repeat; the mesh
builder bakes it into UVs (the contract forbids KHR_texture_transform).

Families can add materials with `register()`; keep names generic.

Texture budget (see docs/assets/texture-budget.md):
- `tex_res` is both the per-texture cap and the target density in texels per
  metre, so a material repeating every 0.25 m gets a 256 px texture at the
  default 1024 instead of being stored at 4096 px/m (`texture_res`).
- A map flatter than `FLAT_LEVELS` (per-channel standard deviation, in 8-bit
  levels) is exported as a material factor instead of a texture: it looks the
  same and costs no download or GPU memory (`texture_plan`).
"""

import hashlib
import json
import os

import bpy

from . import texsynth

# name -> spec. Colours are sRGB.
SPECS = {
    # floors
    "gteki_floor_terrazzo": dict(gen="terrazzo", repeat_m=1.0, seed=101),
    "gteki_floor_tile600": dict(gen="tile_grid", repeat_m=1.2, seed=102, kw=dict(tiles=(2, 2), grout_px=5, base=(0.70, 0.70, 0.68), grout=(0.50, 0.50, 0.49), rough_base=0.42)),
    "gteki_floor_granite_dark": dict(gen="tile_grid", repeat_m=1.2, seed=103, kw=dict(tiles=(2, 4), grout_px=3, base=(0.28, 0.28, 0.29), variation=0.05, grout=(0.18, 0.18, 0.18), rough_base=0.30, speckle=0.22)),
    "gteki_concrete": dict(gen="concrete", repeat_m=2.0, seed=104),
    # walls
    "gteki_wall_tile_white": dict(gen="tile_grid", repeat_m=0.9, seed=111, kw=dict(tiles=(6, 6), grout_px=5, base=(0.87, 0.87, 0.84), variation=0.02, grout=(0.70, 0.70, 0.68), rough_base=0.22, bevel_px=6, speckle=0.02)),
    "gteki_wall_tile_accent": dict(gen="tile_grid", repeat_m=0.9, seed=112, kw=dict(tiles=(6, 6), grout_px=5, base=(0.33, 0.42, 0.52), variation=0.05, grout=(0.62, 0.64, 0.66), rough_base=0.22, bevel_px=6, speckle=0.02)),
    "gteki_wall_panel_enamel": dict(gen="painted_metal", repeat_m=1.0, seed=113, kw=dict(base=(0.86, 0.86, 0.84), rough=0.28)),
    "gteki_wall_panel_accent": dict(gen="painted_metal", repeat_m=1.0, seed=114, kw=dict(base=(0.20, 0.31, 0.40), rough=0.30)),
    "gteki_reveal_dark": dict(color=(0.05, 0.05, 0.055), rough=0.7),
    # ceilings
    "gteki_ceiling_spandrel": dict(gen="linear_spandrel", repeat_m=1.0, seed=121),
    "gteki_ceiling_plaster": dict(color=(0.84, 0.84, 0.82), rough=0.9),
    # metals / trims
    "gteki_steel_brushed": dict(gen="brushed_metal", repeat_m=0.5, seed=131),
    "gteki_steel_painted_dark": dict(gen="painted_metal", repeat_m=0.5, seed=132, kw=dict(base=(0.11, 0.115, 0.12), rough=0.42)),
    "gteki_steel_painted_light": dict(gen="painted_metal", repeat_m=0.5, seed=133, kw=dict(base=(0.80, 0.80, 0.78), rough=0.34)),
    "gteki_aluminium_anodised": dict(color=(0.70, 0.71, 0.72), rough=0.38, metal=1.0),
    # floor details
    "gteki_tactile_dots": dict(gen="tactile", repeat_m=0.3, seed=141, kw=dict(kind="dots")),
    "gteki_tactile_bars": dict(gen="tactile", repeat_m=0.3, seed=142, kw=dict(kind="bars")),
    "gteki_rubber_nosing": dict(gen="rubber_grip", repeat_m=0.25, seed=143),
    "gteki_escalator_tread": dict(gen="escalator_tread", repeat_m=0.25, seed=144),
    # gates and equipment
    "gteki_gate_body": dict(gen="painted_metal", repeat_m=0.5, seed=151, kw=dict(base=(0.84, 0.84, 0.82), rough=0.22, orange_peel=0.12)),
    "gteki_gate_top": dict(color=(0.035, 0.037, 0.04), rough=0.18),
    "gteki_gate_accent": dict(color=(0.11, 0.33, 0.55), rough=0.3),
    "gteki_plastic_dark": dict(color=(0.06, 0.06, 0.065), rough=0.45),
    "gteki_rubber_black": dict(color=(0.025, 0.025, 0.025), rough=0.55),
    "gteki_glass_clear": dict(color=(0.80, 0.88, 0.90), rough=0.04, alpha=0.18),
    "gteki_glass_frosted": dict(color=(0.92, 0.94, 0.95), rough=0.35, alpha=0.55),
    # emissive
    "gteki_light_diffuser": dict(color=(0.95, 0.95, 0.93), rough=0.5, emit=(1.0, 0.97, 0.92), emit_strength=4.0),
    "gteki_emissive_ic_blue": dict(color=(0.03, 0.15, 0.35), rough=0.2, emit=(0.10, 0.45, 1.0), emit_strength=1.6),
    "gteki_emissive_green": dict(color=(0.02, 0.2, 0.06), rough=0.2, emit=(0.05, 1.0, 0.25), emit_strength=2.5),
    "gteki_emissive_red": dict(color=(0.2, 0.02, 0.02), rough=0.2, emit=(1.0, 0.06, 0.04), emit_strength=2.5),
    "gteki_screen_lcd": dict(color=(0.02, 0.03, 0.04), rough=0.1, emit=(0.30, 0.55, 0.80), emit_strength=1.2),
}


def register(name, **spec):
    """Add a material spec (families call this at import time)."""
    assert name.startswith("gteki_"), name
    if name in SPECS and SPECS[name] != spec:
        raise ValueError(f"material {name} already registered with a different spec")
    SPECS[name] = spec


def repeat_m(name):
    return SPECS[name].get("repeat_m", 1.0)


# Per-channel standard deviation (8-bit levels) below which a map is a constant.
# Albedo: under one level is invisible (below the JPEG noise floor); roughness /
# metallic: 2 levels = 0.008; normal: 1.5 levels = 0.7 degrees of tilt, far below
# the GGX lobe width of the glossiest kit material.
FLAT_LEVELS = {"albedo": 1.0, "orm": 2.0, "normal": 1.5}
MIN_RES = 128


def texture_res(name, tex_res):
    """Power-of-two size giving at least `tex_res` texels per metre, capped at `tex_res`.

    Generators draw features in physical units (normalised UV x repeat), so the
    look stays the same; only oversampled small repeats shrink."""
    spec = SPECS[name]
    want = spec.get("repeat_m", 1.0) * tex_res
    res = MIN_RES
    while res < want and res < tex_res:
        res *= 2
    return min(res, tex_res)


def _cache_dir():
    d = os.environ.get("GTEKI_TEX_CACHE") or os.path.join(os.path.dirname(os.path.dirname(__file__)), ".cache", "textures")
    os.makedirs(d, exist_ok=True)
    return d


def _spec_hash(name, spec, res):
    blob = json.dumps({"n": name, "s": spec, "r": res, "v": texsynth.TEXSYNTH_VERSION}, sort_keys=True, default=list)
    return hashlib.sha256(blob.encode()).hexdigest()[:12]


def texture_paths(name, res):
    """Generate (or reuse cached) PNGs for a textured material. Returns dict or None.

    Also caches per-channel mean/std (0..1, as stored) in `<base>_stats.v2.json`."""
    spec = SPECS[name]
    if "gen" not in spec:
        return None
    h = _spec_hash(name, spec, res)
    base = os.path.join(_cache_dir(), f"{name}_{res}_{h}")
    paths = {k: f"{base}_{k}.png" for k in ("albedo", "normal", "orm")}
    stats_path = f"{base}_stats.v2.json"  # v2: exact quantisation, float64
    if not all(os.path.exists(p) for p in [*paths.values(), stats_path]):
        import numpy as np

        maps = texsynth.GENERATORS[spec["gen"]](res, spec["seed"], **spec.get("kw", {}))
        stats = {}
        for k, p in paths.items():
            tmp = p + ".tmp"
            texsynth.write_png(tmp, maps[k])
            os.replace(tmp, p)
            # statistics of the exact 8-bit values in the PNG, accumulated in float64
            # (float32 sums over a megapixel drift by more than the flatness threshold)
            q = texsynth.quantize8(maps[k]).reshape(-1, 3).astype(np.float64) / 255.0
            stats[k] = {"mean": [round(float(x), 6) for x in q.mean(0)],
                        "std": [round(float(x), 6) for x in q.std(0)]}
        with open(stats_path + ".tmp", "w") as f:
            json.dump(stats, f, sort_keys=True)
        os.replace(stats_path + ".tmp", stats_path)
    with open(stats_path) as f:
        return dict(paths, stats=json.load(f))


def _flat(stats, key, channels):
    return all(stats[key]["std"][c] * 255.0 < FLAT_LEVELS[key] for c in channels)


def texture_plan(name, tex_res):
    """What a textured material exports: {res, maps: {albedo|orm|normal: path},
    factors: {color (sRGB), rough, metal}}; None for factor-only materials."""
    tex = texture_paths(name, texture_res(name, tex_res))
    if tex is None:
        return None
    st = tex["stats"]
    plan = {"res": texture_res(name, tex_res), "maps": {}, "factors": {}}
    if _flat(st, "albedo", (0, 1, 2)):
        plan["factors"]["color"] = tuple(st["albedo"]["mean"])
    else:
        plan["maps"]["albedo"] = tex["albedo"]
    if _flat(st, "orm", (1, 2)):
        plan["factors"]["rough"] = st["orm"]["mean"][1]
        plan["factors"]["metal"] = st["orm"]["mean"][2]
    else:
        plan["maps"]["orm"] = tex["orm"]
    if not _flat(st, "normal", (0, 1)):
        plan["maps"]["normal"] = tex["normal"]
    return plan


def _repo_root():
    return os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))


def _load_image(path, non_color):
    img = bpy.data.images.load(path, check_existing=True)
    img.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
    return img


def get(name, tex_res):
    """Return (creating once per Blender session) the bpy material for `name`."""
    mat = bpy.data.materials.get(name)
    if mat is not None:
        return mat
    spec = SPECS[name]
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    out.location = (400, 0)
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    bsdf.location = (100, 0)
    nt.links.new(bsdf.outputs["BSDF"], out.inputs["Surface"])

    plan = texture_plan(name, tex_res)
    if "image" in spec:
        # externally supplied image (e.g. generated poster art), path relative to repo root
        img = _load_image(os.path.join(_repo_root(), spec["image"]), False)
        tex = nt.nodes.new("ShaderNodeTexImage")
        tex.image = img
        tex.location = (-500, 250)
        nt.links.new(tex.outputs["Color"], bsdf.inputs["Base Color"])
        bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.5)
        bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)
        if spec.get("emit_image"):
            nt.links.new(tex.outputs["Color"], bsdf.inputs["Emission Color"])
            bsdf.inputs["Emission Strength"].default_value = spec.get("emit_strength", 1.0)
    elif plan:
        maps, fac = plan["maps"], plan["factors"]
        alb = None
        if "albedo" in maps:
            alb = nt.nodes.new("ShaderNodeTexImage")
            alb.image = _load_image(maps["albedo"], False)
            alb.location = (-500, 250)
            nt.links.new(alb.outputs["Color"], bsdf.inputs["Base Color"])
        else:
            bsdf.inputs["Base Color"].default_value = (*_srgb_to_linear(fac["color"]), 1.0)
        if "orm" in maps:
            orm = nt.nodes.new("ShaderNodeTexImage")
            orm.image = _load_image(maps["orm"], True)
            orm.location = (-500, 0)
            sep = nt.nodes.new("ShaderNodeSeparateColor")
            sep.location = (-200, 0)
            nt.links.new(orm.outputs["Color"], sep.inputs["Color"])
            nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
            nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
        else:
            bsdf.inputs["Roughness"].default_value = fac["rough"]
            bsdf.inputs["Metallic"].default_value = fac["metal"]
        if "normal" in maps:
            nrm = nt.nodes.new("ShaderNodeTexImage")
            nrm.image = _load_image(maps["normal"], True)
            nrm.location = (-500, -250)
            nmap = nt.nodes.new("ShaderNodeNormalMap")
            nmap.location = (-200, -250)
            nt.links.new(nrm.outputs["Color"], nmap.inputs["Color"])
            nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
        if spec.get("emit_from_albedo"):
            # self-lit faces (sign boxes, screens): emission = albedo * strength
            if alb is not None:
                nt.links.new(alb.outputs["Color"], bsdf.inputs["Emission Color"])
            else:
                bsdf.inputs["Emission Color"].default_value = (*_srgb_to_linear(fac["color"]), 1.0)
            bsdf.inputs["Emission Strength"].default_value = spec.get("emit_strength", 1.0)
    else:
        c = spec.get("color", (0.8, 0.8, 0.8))
        bsdf.inputs["Base Color"].default_value = (*_srgb_to_linear(c), 1.0)
        bsdf.inputs["Roughness"].default_value = spec.get("rough", 0.5)
        bsdf.inputs["Metallic"].default_value = spec.get("metal", 0.0)

    if "emit" in spec and not spec.get("emit_image") and not spec.get("emit_from_albedo"):
        bsdf.inputs["Emission Color"].default_value = (*_srgb_to_linear(spec["emit"]), 1.0)
        bsdf.inputs["Emission Strength"].default_value = spec.get("emit_strength", 1.0)
    if "alpha" in spec:
        bsdf.inputs["Alpha"].default_value = spec["alpha"]
        if hasattr(mat, "surface_render_method"):
            mat.surface_render_method = "BLENDED"
        if hasattr(mat, "blend_method"):
            mat.blend_method = "BLEND"
    mat.diffuse_color = (*_srgb_to_linear(spec.get("color", (0.7, 0.7, 0.7))), spec.get("alpha", 1.0))
    return mat


def _srgb_to_linear(c):
    def f(x):
        return x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4

    return tuple(f(x) for x in c)
