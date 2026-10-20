"""Render exported GLBs after re-importing them into an empty Blender scene.

This is a round-trip check (what a consumer sees), not a render of the
authoring scene. Interior lighting is placed from the GLB's LIGHTHINT_* empties.

  blender -b --factory-startup -P tools/blender/render_preview.py -- \
      --layout layout.json --out shot.png [--res 1600x900] [--samples 64]

layout.json:
  {"items": [{"glb": "assets/library/glb/x.glb", "pos": [x, y, z], "yaw": 0,
              "close_flaps": false}],
   "camera": {"pos": [x, y, z], "look_at": [x, y, z], "lens": 24},
   (or "cameras": {"name": {...}} with --camera name)
   "mode": "interior" | "studio", "exposure": 0.0}

Positions are Blender world coordinates (Z up). A consumer layout in glTF
(x, y, z) maps to Blender (x, -z, y).
"""

import argparse
import json
import math
import os
import sys

import bpy
from mathutils import Vector


def setup_scene(args, layout):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    sc = bpy.context.scene
    sc.render.engine = "BLENDER_EEVEE" if args.engine == "eevee" else "CYCLES"
    if sc.render.engine == "CYCLES":
        sc.cycles.samples = args.samples
        sc.cycles.use_denoising = True
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "METAL"
            prefs.get_devices()
            for d in prefs.devices:
                d.use = True
            sc.cycles.device = "GPU"
        except Exception:
            pass
    else:
        ee = sc.eevee
        ee.taa_render_samples = args.samples
        for attr, val in (("use_raytracing", True), ("use_shadows", True), ("use_gtao", True), ("fast_gi_method", "GLOBAL_ILLUMINATION")):
            if hasattr(ee, attr):
                try:
                    setattr(ee, attr, val)
                except Exception:
                    pass
        if hasattr(ee, "ray_tracing_options"):
            ee.ray_tracing_options.resolution_scale = "2"
    w, h = (int(v) for v in args.res.split("x"))
    sc.render.resolution_x, sc.render.resolution_y = w, h
    sc.render.film_transparent = False
    sc.view_settings.view_transform = "AgX"
    sc.view_settings.look = "AgX - Medium High Contrast" if "AgX - Medium High Contrast" in [l for l in _looks()] else "None"
    sc.view_settings.exposure = layout.get("exposure", 0.0)
    world = bpy.data.worlds.new("world")
    sc.world = world
    world.use_nodes = True
    bg = world.node_tree.nodes["Background"]
    if layout.get("mode") == "studio":
        bg.inputs["Color"].default_value = (0.55, 0.58, 0.62, 1)
        bg.inputs["Strength"].default_value = 0.9
    else:
        bg.inputs["Color"].default_value = (0.02, 0.022, 0.025, 1)
        bg.inputs["Strength"].default_value = 1.0
    return sc


def _looks():
    try:
        return [l.name for l in bpy.types.ColorManagedViewSettings.bl_rna.properties["look"].enum_items]
    except Exception:
        return []


def import_items(layout):
    hints = []
    for it in layout["items"]:
        before = set(bpy.data.objects)
        bpy.ops.import_scene.gltf(filepath=it["glb"])
        new = [o for o in bpy.data.objects if o not in before]
        roots = [o for o in new if o.parent is None]
        for r in roots:
            r.location = Vector(it.get("pos", (0, 0, 0)))
            r.rotation_mode = "XYZ"
            r.rotation_euler = (0, 0, math.radians(it.get("yaw", 0)))
        if it.get("close_flaps"):
            _close_flaps(roots, new)
        bpy.context.view_layer.update()
        for o in new:
            if o.name.endswith("-colonly") or "-colonly" in o.name:
                o.hide_render = True
                o.hide_viewport = True
            if o.name.startswith("LIGHTHINT_"):
                hints.append(o)
    return hints


def _close_flaps(roots, objs):
    """Pose gate flaps closed using the asset's own params (contract: yaw about the hinge)."""
    params = {}
    for r in roots:
        g = r.get("gteki")
        if g is not None and "params" in g:
            params = g["params"]
    yaw = params.get("flap_close_yaw_deg") if params else None
    if not yaw:
        return
    for o in objs:
        if o.name.startswith("VIS_flap_"):
            side = o.name.split(".")[0].rsplit("_", 1)[-1]
            o.rotation_mode = "XYZ"
            o.rotation_euler.z += math.radians(float(yaw[side]))


def add_hint_lights(hints, layout):
    power = layout.get("hint_power", 1.0)
    for h in hints:
        length = float(h.get("length_m", 1.0))
        axis = h.get("axis", "y")
        kind = h.get("kind", "linear_led")
        ld = bpy.data.lights.new(h.name + "_L", "AREA")
        if kind == "linear_led":
            ld.shape = "RECTANGLE"
            ld.size, ld.size_y = (0.12, length) if axis == "y" else (length, 0.12)
            ld.energy = 55.0 * length * power
        else:
            ld.shape = "DISK"
            ld.size = float(h.get("size_m", 0.4))
            ld.energy = float(h.get("watts", 40.0)) * power
        ld.color = (1.0, 0.96, 0.9)
        if hasattr(ld, "use_shadow"):
            ld.use_shadow = True
        lo = bpy.data.objects.new(h.name + "_L", ld)
        bpy.context.scene.collection.objects.link(lo)
        mw = h.matrix_world
        lo.location = mw.translation + Vector((0, 0, -0.03))
        # area lights emit along local -Z: keep them pointing down, but follow the
        # hint's yaw so rectangular lights line up with rotated modules
        yaw = mw.to_euler().z
        lo.rotation_euler = (0, 0, yaw)


def add_studio_lights(layout):
    sun = bpy.data.lights.new("sun", "SUN")
    sun.energy = 3.0
    sun.angle = math.radians(3)
    so = bpy.data.objects.new("sun", sun)
    bpy.context.scene.collection.objects.link(so)
    so.rotation_euler = (math.radians(50), math.radians(10), math.radians(35))
    if layout.get("ground", True):
        bpy.ops.mesh.primitive_plane_add(size=200, location=(0, 0, -0.001))
        g = bpy.context.active_object
        m = bpy.data.materials.new("ground")
        m.use_nodes = True
        m.node_tree.nodes["Principled BSDF"].inputs["Base Color"].default_value = (0.32, 0.33, 0.34, 1)
        m.node_tree.nodes["Principled BSDF"].inputs["Roughness"].default_value = 0.8
        g.data.materials.append(m)


def add_camera(layout):
    c = layout["camera"]
    cd = bpy.data.cameras.new("cam")
    cd.lens = c.get("lens", 24)
    cd.clip_start = 0.05
    cd.clip_end = 400
    co = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(co)
    co.location = Vector(c["pos"])
    d = Vector(c["look_at"]) - co.location
    co.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()
    bpy.context.scene.camera = co


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--res", default="1600x900")
    ap.add_argument("--samples", type=int, default=64)
    ap.add_argument("--engine", default="eevee", choices=["eevee", "cycles"])
    ap.add_argument("--camera", default="", help="key into layout['cameras']")
    args = ap.parse_args(argv)
    with open(args.layout) as f:
        layout = json.load(f)
    if args.camera:
        layout["camera"] = layout["cameras"][args.camera]
    elif "camera" not in layout and layout.get("cameras"):
        layout["camera"] = next(iter(layout["cameras"].values()))
    setup_scene(args, layout)
    hints = import_items(layout)
    if layout.get("mode") == "studio":
        add_studio_lights(layout)
    if layout.get("hint_lights", layout.get("mode") != "studio"):
        add_hint_lights(hints, layout)
    for extra in layout.get("lights", []):
        ld = bpy.data.lights.new("x", extra.get("type", "POINT"))
        ld.energy = extra.get("energy", 100)
        if "size" in extra and hasattr(ld, "size"):
            ld.size = extra["size"]
        if "color" in extra:
            ld.color = extra["color"]
        lo = bpy.data.objects.new("x", ld)
        bpy.context.scene.collection.objects.link(lo)
        lo.location = extra["pos"]
        if "rot" in extra:
            lo.rotation_euler = [math.radians(a) for a in extra["rot"]]
    add_camera(layout)
    sc = bpy.context.scene
    sc.render.filepath = os.path.abspath(args.out)
    sc.render.image_settings.file_format = "PNG"
    bpy.ops.render.render(write_still=True)
    print(f"[render] wrote {args.out}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
