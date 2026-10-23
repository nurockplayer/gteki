"""Generator registry: catalog `generator` name -> callable(asset_id, params, tex_res) -> Asset."""

import importlib

REGISTRY = {}

for _mod in ("passage", "gates", "vertical", "signage", "props", "dressing", "finish_sample", "facilities"):
    try:
        m = importlib.import_module(f"{__name__}.{_mod}")
    except ModuleNotFoundError as e:
        if e.name != f"{__name__}.{_mod}":
            raise
        continue
    for _name, _fn in m.GENERATORS.items():
        if _name in REGISTRY:
            raise ValueError(f"duplicate generator {_name}")
        REGISTRY[_name] = _fn

# Placement class per generator (contract §1): how the origin relates to the room.
#   linear  - entry edge at z=0, module extends toward -Z, walking surface y=0
#   wall    - wall plane at z=0, item projects into the room (+Z); may recess into -Z
#   free    - free-standing, footprint centred on the origin, base at y=0
#   ceiling - hangs from above; origin at the floor below its centre
PLACEMENT = {
    "passage_straight": "linear", "passage_node": "linear", "gate_array": "linear",
    "stairs_straight": "linear", "stairs_landing": "linear", "escalator": "linear",
    "tactile_strip": "linear",
    "lift_portal": "wall", "sign_wall": "wall", "sign_blade": "wall", "poster_lightbox": "wall",
    "vending_machine": "wall", "bin_trio": "wall", "ticket_kiosk": "wall",
    "bench": "free", "column_clad": "free", "sign_totem": "free", "barrier_rail": "free",
    "sign_hanging": "ceiling", "sign_frame_9slice": "ceiling",
    "escalator_dressing": "linear", "stair_dressing": "linear", "railing_run": "free",
    "finish_sample": "wall",
    "toilet_entrance": "wall",
}
