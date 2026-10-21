"""Finish sample GLB: a flat quad of repeats x repeats carrying exactly one finish material.

  finish_sample  floor finishes lie flat (u east, v north); every other role stands on the wall plane
                 (u along the wall, v up). The material is named like the asset (`gteki_finish_*`).

The quad is a swatch to check the finish end to end (validate, Godot, web); it has no collision.
"""

from .. import contract, finishes, materials
from ..asset import Asset
from .signage import _merge

GEN = "tools/blender/gteki_assets/families/finish_sample.py"


def finish_sample(asset_id, params, tex_res):
    if asset_id not in finishes.SOURCE:
        raise KeyError(f"unknown finish {asset_id}")
    p = _merge(dict(role="floor"), params)
    if p["role"] not in finishes.ROLES:
        raise ValueError(f"role must be one of {finishes.ROLES}, got {p['role']!r}")
    rep = finishes.repeat_m(asset_id)
    n = finishes.sample_repeats(asset_id)
    p["repeat_m"], p["repeats"] = rep, n
    w, h = n * rep[0], n * rep[1]
    a = Asset(asset_id, "finish", asset_id.replace("gteki_finish_", ""), p, GEN, contract.SYNTHETIC, tex_res,
              notes=f"Sample swatch of {n} x {n} repeats ({w:g} x {h:g} m) on the "
                    f"{'floor' if p['role'] == 'floor' else 'wall'} plane; the material {asset_id} is the finish.")
    part = a.part("swatch")
    uv = [(0.0, 0.0), (n, 0.0), (n, n), (0.0, n)]
    if p["role"] == "floor":
        corners = [(-w / 2, -h / 2, 0), (w / 2, -h / 2, 0), (w / 2, h / 2, 0), (-w / 2, h / 2, 0)]
    else:
        corners = [(-w / 2, 0, 0), (w / 2, 0, 0), (w / 2, 0, h), (-w / 2, 0, h)]
    part.quad(*corners, asset_id, smooth=False, uv=uv)
    return a


GENERATORS = {"finish_sample": finish_sample}
