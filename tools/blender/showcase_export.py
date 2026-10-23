"""Export a showcase layout as ONE GLB: placed kit items + the layout's reference cameras.

Godot renders the same cameras as render_preview.py. Placement and camera maths are
render_preview's own. The export drops everything render-only (studio lights, hint area
lights, world, floor); LIGHTHINT_* / SOCKET_* empties and `*-colonly` nodes stay.

  blender -b --factory-startup -P tools/blender/showcase_export.py -- \
      --layout tools/blender/showcase/vertical_demo.json --out vertical_demo.glb \
      [--library-root DIR]

--library-root DIR replaces the leading "assets/library" of each item path (scratch builds).
Layout paths are repo-relative; the repo root is two levels above this script.
"""

import argparse
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import render_preview as rp  # noqa: E402
from gteki_assets import contract  # noqa: E402

REPO = os.path.dirname(os.path.dirname(HERE))


def resolve_glb(path, library_root):
    if library_root and path.replace("\\", "/").startswith("assets/library/"):
        path = os.path.join(library_root, path[len("assets/library/") :])
    return path if os.path.isabs(path) else os.path.join(REPO, path)


def add_cameras(layout, source):
    cams = dict(layout.get("cameras", {}))
    if "camera" in layout:
        cams["camera"] = layout["camera"]
    out = []
    for name, c in cams.items():
        co = rp.make_camera(name, c)
        co["gteki_camera"] = {"lens_mm": float(c.get("lens", 24)), "look_at": [float(v) for v in c["look_at"]], "source_layout": source}
        out.append(co)
    return out


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--layout", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--library-root", default="", help="replaces the leading assets/library of item paths")
    args = ap.parse_args(argv)
    with open(args.layout) as f:
        layout = json.load(f)
    source = os.path.basename(args.layout)
    stem = os.path.splitext(source)[0]
    for it in layout["items"]:
        it["glb"] = resolve_glb(it["glb"], args.library_root)

    bpy.ops.wm.read_factory_settings(use_empty=True)  # no default cube / camera / light
    sc = bpy.context.scene
    sc.render.resolution_x, sc.render.resolution_y = 1600, 900  # render_preview's default; sets the exported yfov
    hints = rp.import_items(layout)
    cams = add_cameras(layout, source)

    # import_items hides collision for rendering; the export must keep those nodes
    for o in bpy.data.objects:
        if "-colonly" in o.name:
            o.hide_render = o.hide_viewport = False
            o.hide_set(False)

    root = bpy.data.objects.new(f"SHOWCASE_{stem}", None)
    sc.collection.objects.link(root)
    root["gteki_showcase"] = {
        "layout": stem,
        "title": layout.get("title", stem),
        "cameras": [c.name for c in cams],
        "note": "synthetic kit demo, not a station layout",
    }
    for o in list(bpy.data.objects):
        if o is not root and o.parent is None:
            o.parent = root
    bpy.context.view_layer.update()

    out = os.path.abspath(args.out)
    os.makedirs(os.path.dirname(out), exist_ok=True)
    bpy.ops.object.select_all(action="DESELECT")
    bpy.ops.export_scene.gltf(
        filepath=out,
        export_format="GLB",
        export_yup=True,
        export_apply=False,
        export_extras=True,
        export_texcoords=True,
        export_normals=True,
        export_tangents=False,
        export_materials="EXPORT",
        export_image_format="AUTO",
        export_cameras=True,
        export_lights=False,
        export_animations=False,
        export_skins=False,
        export_morph=False,
        export_copyright=contract.GLB_COPYRIGHT,
        use_selection=False,
        export_draco_mesh_compression_enable=False,
    )
    print(f"[showcase] {out}: {len(bpy.data.objects)} nodes, cameras={[c.name for c in cams]}, lighthints={len(hints)}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else [])
