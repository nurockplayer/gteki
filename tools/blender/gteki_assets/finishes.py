"""Finish packs (docs/assets/asset-contract.md section 9): materials a station can apply to its own geometry.

A finish is one `gteki_finish_*` material (tileable albedo / ORM / normal, repeat in metres) shipped
twice: as loose files plus `finish.json` (what a station loads) and inside a flat sample GLB (what the
validate / Godot / web pipeline checks). Both carry the same JPEG bytes. The materials derive from the
kit's own (`SOURCE`); this module only changes what a finish needs: the baked panel joint, the neutral
tint base, and keeping the maps a runtime tint multiplies.
"""

import hashlib
import json
import os

from . import contract, materials

FORMAT = "gteki-finish/0.1"
ROLES = ("floor", "wall", "ceiling", "band", "trim")
MAPS = ("albedo", "orm", "normal")
TINT_BASE = (0.949, 0.949, 0.941)  # sRGB #F2F2F0: near white, neutral

# finish id -> kit material it derives from
SOURCE = {
    "gteki_finish_floor_terrazzo": "gteki_floor_terrazzo",
    "gteki_finish_floor_granite_tile": "gteki_floor_granite_dark",
    "gteki_finish_floor_tile600": "gteki_floor_tile600",
    "gteki_finish_wall_enamel_panel": "gteki_wall_panel_enamel",
    "gteki_finish_wall_wainscot_blue": "gteki_wall_panel_accent",
    "gteki_finish_wall_kick_plate": "gteki_steel_brushed",
    "gteki_finish_ceiling_spandrel": "gteki_ceiling_spandrel",
    "gteki_finish_band_line_accent": None,
}


def _panel(src):
    """The kit's painted-metal wall material as a panel field: same colour, roughness and seed."""
    s = materials.SPECS[src]
    return dict(gen="panel_field", repeat_m=1.2, seed=s["seed"], kw=dict(s["kw"], repeat_m=1.2))


def _define():
    specs = {fid: dict(materials.SPECS[src]) for fid, src in SOURCE.items() if src and "panel" not in src}
    specs["gteki_finish_wall_enamel_panel"] = _panel("gteki_wall_panel_enamel")
    specs["gteki_finish_wall_wainscot_blue"] = _panel("gteki_wall_panel_accent")
    # tint base: albedo stays a texture (keep_maps) so `baseColorFactor` is a pure multiplier
    specs["gteki_finish_band_line_accent"] = dict(gen="painted_metal", repeat_m=0.25, seed=161, keep_maps=("albedo",),
                                                  kw=dict(base=TINT_BASE, rough=0.30, orange_peel=0.15))
    for fid, spec in specs.items():
        materials.register(fid, **dict(spec, finish=True))


_define()


def repeat_m(fid):
    r = materials.repeat_m(fid)
    return [r, r]


def sample_repeats(fid):
    """Repeats per side of the sample quad: at least 2, and at least 1 m."""
    r = materials.repeat_m(fid)
    return max(2, int(-(-1.0 // r)))


def _sha(path):
    with open(path, "rb") as f:
        data = f.read()
    return hashlib.sha256(data).hexdigest(), len(data)


def _write_json(path, doc):
    with open(path, "w") as f:
        json.dump(doc, f, indent=2, ensure_ascii=False)
        f.write("\n")


def uv_note(role):
    if role == "floor":
        return {"u": "east", "v": "north", "surface": "floor, in the surface plane",
                "origin": "a repeat starts where u and v are whole multiples of repeat_m from the surface origin"}
    if role == "ceiling":
        return {"u": "east", "v": "south", "surface": "ceiling, seen from below (the kit's box UV)",
                "origin": "a repeat starts where u and v are whole multiples of repeat_m from the surface origin"}
    return {"u": "along the wall", "v": "up", "surface": "wall face",
            "origin": "a repeat starts at u = k x repeat_m along the wall and at v = 0 on the floor"}


def stage_pack(catalog, entries, tex_res, profile, staging):
    """Write `<staging>/<id>/` (maps + finish.json) for every finish; return the manifest `finishes` list."""
    section = []
    by_id = {e["id"]: e for e in entries}
    for item in catalog["assets"]:
        fid, p = item["id"], item["params"]
        plan = materials.texture_plan(fid, tex_res)
        d = os.path.join(staging, fid)
        os.makedirs(d, exist_ok=True)
        maps = {}
        for key in MAPS:
            if key in plan["maps"]:
                dst = os.path.join(d, f"{key}.jpg")
                src = materials._jpeg_copy(plan["maps"][key])
                with open(src, "rb") as f, open(dst, "wb") as g:
                    g.write(f.read())
                sha, size = _sha(dst)
                maps[key] = {"file": f"{key}.jpg", "size": [plan["res"], plan["res"]], "bytes": size, "sha256": sha}
        fac = plan["factors"]
        lin = materials._srgb_to_linear(fac["color"]) if "color" in fac else (1.0, 1.0, 1.0)
        factors = {"baseColorFactor": [round(v, 6) for v in lin] + [1.0],
                   "roughnessFactor": 1.0 if "orm" in maps else round(fac["rough"], 6),
                   "metallicFactor": 1.0 if "orm" in maps else round(fac["metal"], 6)}
        rep = repeat_m(fid)
        doc = {
            "format": FORMAT,
            "id": fid,
            "kit_version": contract.KIT_VERSION,
            "tier": profile,
            "role": p["role"],
            "gteki_role": p["gteki_role"],
            "facility": p["facility"],
            "use": p["use"],
            "pattern": p["pattern"],
            "source_material": SOURCE[fid],
            "repeat_m": rep,
            "uv": uv_note(p["role"]),
            "maps": maps,
            "factors": factors,
            "omitted_maps": [k for k in MAPS if k not in maps],
            "texel_density_px_per_m": [round(plan["res"] / r, 1) for r in rep],
            "tint": bool(p.get("tint")),
            "sample_glb": f"../glb/{fid}.glb",
            "sample": {"plane": "floor" if p["role"] == "floor" else "wall", "repeats": sample_repeats(fid),
                       "size_m": [round(sample_repeats(fid) * r, 4) for r in rep]},
            "dimension_basis": item.get("dimension_basis", contract.SYNTHETIC),
            "generator": "tools/blender/gteki_assets/finishes.py",
            "license": contract.LICENSE,
            "provenance": contract.PROVENANCE,
        }
        if doc["tint"]:
            doc["tint_info"] = tint_info(fid, plan)
        _write_json(os.path.join(d, "finish.json"), doc)
        fj_sha, fj_bytes = _sha(os.path.join(d, "finish.json"))
        glb = by_id[fid]
        section.append({
            "id": fid, "role": p["role"], "gteki_role": p["gteki_role"], "tint": doc["tint"], "repeat_m": rep,
            "dir": fid,
            "finish_json": {"file": f"{fid}/finish.json", "bytes": fj_bytes, "sha256": fj_sha},
            "files": {k: {"file": f"{fid}/{v['file']}", "bytes": v["bytes"], "sha256": v["sha256"]} for k, v in maps.items()},
            "sample_glb": glb["file"],
            "texture_bytes": sum(v["bytes"] for v in maps.values()),
        })
    return section


def tint_info(fid, plan):
    """How a station tints this finish (docs/assets/asset-contract.md section 9)."""
    return {
        "mode": "multiply",
        "formula": "rendered base colour = albedo texture (sRGB, decoded to linear) x baseColorFactor, per channel in linear light",
        "set": "baseColorFactor = the station line colour as linear RGB (three.js material.color.set('#rrggbb'), Godot albedo_color); leave the texture as shipped",
        "neutral_base_srgb": "#F2F2F0",
        "gain": "the base is about 0.89 in linear light, so the line colour renders about 11% darker than its hex; multiply the factor by 1.12 (clamped to 1) to match the hex",
        "example": {"line": "#b6007a", "baseColorFactor_srgb": "#b6007a"},
    }
