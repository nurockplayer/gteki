"""Blender glTF import check for GLBs produced by `gis citygml-to-glb`.

Usage (headless, Blender 4.x/5.x):
  blender -b --factory-startup -P tools/gis/scripts/blender_import_check.py -- \
      <glb> <provenance-or-conversion-json> <out_prefix>

Imports the GLB with Blender's bundled glTF importer, compares the imported world-space bbox with
the `bbox_local_ENU` recorded by the converter (Blender is Z-up, so after glTF import
x = East, y = North, z = Up), and renders a top and a perspective Workbench image for visual
review. Writes `<out_prefix>.import-check.json`. Exits non-zero when the bbox differs by more
than 1 mm. Renders are review evidence only; they inherit the source's CC BY 4.0 attribution
obligations and are not routing evidence.
"""
import json
import sys

import bpy
import mathutils

TOLERANCE_M = 0.001

argv = sys.argv[sys.argv.index("--") + 1:]
glb_path, record_path, out_prefix = argv[0], argv[1], argv[2]

with open(record_path, encoding="utf-8") as f:
    record = json.load(f)
expected = record["bbox_local_ENU"]

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=glb_path)
meshes = [o for o in bpy.context.scene.objects if o.type == "MESH"]

lo = mathutils.Vector((float("inf"),) * 3)
hi = mathutils.Vector((float("-inf"),) * 3)
for obj in meshes:
    for corner in obj.bound_box:
        w = obj.matrix_world @ mathutils.Vector(corner)
        lo = mathutils.Vector(map(min, lo, w))
        hi = mathutils.Vector(map(max, hi, w))

error = max(
    max(abs(a - b) for a, b in zip(lo, expected["min"])),
    max(abs(a - b) for a, b in zip(hi, expected["max"])),
)
status = "PASS" if error <= TOLERANCE_M else "FAIL"

scene = bpy.context.scene
scene.render.engine = "BLENDER_WORKBENCH"
scene.display.shading.light = "STUDIO"
scene.display.shading.show_cavity = True
scene.render.resolution_x, scene.render.resolution_y = 1600, 1200
scene.world = bpy.data.worlds.new("check")
cam_data = bpy.data.cameras.new("check")
cam = bpy.data.objects.new("check", cam_data)
scene.collection.objects.link(cam)
scene.camera = cam

centre = (lo + hi) / 2
extent = hi - lo
size = max(extent)
cam_data.clip_end = size * 10

# Top: orthographic, looking straight down, north up.
cam_data.type = "ORTHO"
cam_data.ortho_scale = max(extent.x, extent.y * 4 / 3) * 1.05
cam.location = centre + mathutils.Vector((0, 0, size))
cam.rotation_euler = (0, 0, 0)
scene.render.filepath = f"{out_prefix}_top.png"
bpy.ops.render.render(write_still=True)

# Perspective from the south-east.
cam_data.type = "PERSP"
cam_data.lens = 35
cam.location = centre + mathutils.Vector((0.6, -0.8, 0.55)).normalized() * size * 1.6
cam.rotation_euler = (centre - cam.location).to_track_quat("-Z", "Y").to_euler()
scene.render.filepath = f"{out_prefix}_persp.png"
bpy.ops.render.render(write_still=True)

report = {
    "glb": glb_path.rsplit("/", 1)[-1],
    "record": record_path.rsplit("/", 1)[-1],
    "blender_version": bpy.app.version_string,
    "mesh_objects": len(meshes),
    "imported_bbox_ENU": {"min": list(lo), "max": list(hi)},
    "expected_bbox_ENU": expected,
    "max_abs_error_m": error,
    "tolerance_m": TOLERANCE_M,
    "status": status,
    "navigation_use": "NOT_FOR_ROUTING",
}
with open(f"{out_prefix}.import-check.json", "w", encoding="utf-8") as f:
    json.dump(report, f, indent=2)
print("IMPORT_CHECK", json.dumps(report))
sys.exit(0 if status == "PASS" else 1)
