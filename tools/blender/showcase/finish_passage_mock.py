"""Look-dev aid for the finish pack contact sheet (not a kit asset): a small mock passage dressed with finishes.

  blender -b --factory-startup -P tools/blender/showcase/finish_passage_mock.py -- \
      --pack assets/library/finishes --out finish_passage_mock.glb [--line "#b6007a"]

It reads the loose maps and finish.json of the pack, builds scratch geometry (4 m wide, 8 m long,
2.8 m high) and writes one GLB with LIGHTHINT_* empties, so render_preview.py lights it like the kit
passages. Layout: terrazzo floor with a 0.30 m granite border, kick plate / wainscot / line band /
enamel on the walls (the line band is tinted with --line through baseColorFactor), spandrel ceiling.
"""

import argparse
import json
import os
import sys

import bpy

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.dirname(HERE))
from validate_glb import encode_glb, parse_glb  # noqa: E402

W, L, H = 4.0, 8.0, 2.8
SKIRT, WAINSCOT, BAND = 0.12, 1.1, (1.30, 1.45)


def srgb_to_linear(c):
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def material(pack, fid):
    doc = json.load(open(os.path.join(pack, fid, "finish.json")))
    mat = bpy.data.materials.new(fid)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = nt.nodes["Principled BSDF"]
    maps = doc["maps"]

    def image(key, non_color):
        node = nt.nodes.new("ShaderNodeTexImage")
        node.image = bpy.data.images.load(os.path.join(pack, fid, maps[key]["file"]))
        node.image.colorspace_settings.name = "Non-Color" if non_color else "sRGB"
        return node

    if "albedo" in maps:
        nt.links.new(image("albedo", False).outputs["Color"], bsdf.inputs["Base Color"])
    else:
        bsdf.inputs["Base Color"].default_value = doc["factors"]["baseColorFactor"]
    if "orm" in maps:
        sep = nt.nodes.new("ShaderNodeSeparateColor")
        nt.links.new(image("orm", True).outputs["Color"], sep.inputs["Color"])
        nt.links.new(sep.outputs["Green"], bsdf.inputs["Roughness"])
        nt.links.new(sep.outputs["Blue"], bsdf.inputs["Metallic"])
    else:
        bsdf.inputs["Roughness"].default_value = doc["factors"]["roughnessFactor"]
        bsdf.inputs["Metallic"].default_value = doc["factors"]["metallicFactor"]
    if "normal" in maps:
        nmap = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(image("normal", True).outputs["Color"], nmap.inputs["Color"])
        nt.links.new(nmap.outputs["Normal"], bsdf.inputs["Normal"])
    return mat, doc["repeat_m"]


def quad(name, mat, rep, corners, uv_of):
    me = bpy.data.meshes.new(name)
    me.from_pydata(corners, [], [(0, 1, 2, 3)])
    uv = me.uv_layers.new(name="UVMap")
    for loop, c in zip(me.loops, corners):
        uv.data[loop.index].uv = uv_of(c, rep)
    me.materials.append(mat)
    ob = bpy.data.objects.new(name, me)
    bpy.context.scene.collection.objects.link(ob)
    return ob


def main(argv):
    ap = argparse.ArgumentParser()
    ap.add_argument("--pack", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--line", default="#b6007a")
    args = ap.parse_args(argv)
    bpy.ops.wm.read_factory_settings(use_empty=True)
    mats = {fid: material(args.pack, fid) for fid in (
        "gteki_finish_floor_terrazzo", "gteki_finish_floor_granite_tile", "gteki_finish_wall_enamel_panel",
        "gteki_finish_wall_wainscot_blue", "gteki_finish_wall_kick_plate", "gteki_finish_ceiling_spandrel",
        "gteki_finish_band_line_accent")}
    x0, x1, border = -W / 2, W / 2, 0.30

    def floor(fid, xa, xb):
        m, r = mats[fid]
        quad("floor_" + fid, m, r, [(xa, 0, 0), (xb, 0, 0), (xb, L, 0), (xa, L, 0)], lambda c, r: (c[0] / r[0], c[1] / r[1]))

    floor("gteki_finish_floor_terrazzo", x0 + border, x1 - border)
    floor("gteki_finish_floor_granite_tile", x0, x0 + border)
    floor("gteki_finish_floor_granite_tile", x1 - border, x1)

    def wall(fid, x, z0, z1, right):
        """Wall at x facing into the passage; u runs along +y, v up."""
        m, r = mats[fid]
        c = [(x, 0, z0), (x, L, z0), (x, L, z1), (x, 0, z1)]
        if right:  # faces -x: counter-clockwise seen from the passage
            c = [c[1], c[0], c[3], c[2]]
        quad(f"wall_{fid}_{x}_{z0}", m, r, c, lambda p, r: (p[1] / r[0], p[2] / r[1]))

    for x, right in ((x0, False), (x1, True)):
        wall("gteki_finish_wall_kick_plate", x, 0, SKIRT, right)
        wall("gteki_finish_wall_wainscot_blue", x, SKIRT, WAINSCOT, right)
        wall("gteki_finish_wall_enamel_panel", x, WAINSCOT, BAND[0], right)
        wall("gteki_finish_band_line_accent", x, BAND[0], BAND[1], right)
        wall("gteki_finish_wall_enamel_panel", x, BAND[1], H - 0.06, right)
    for fid, z0, z1 in (("gteki_finish_wall_kick_plate", 0, SKIRT), ("gteki_finish_wall_wainscot_blue", SKIRT, WAINSCOT),
                        ("gteki_finish_wall_enamel_panel", WAINSCOT, H - 0.06)):  # end wall, faces -y
        m, r = mats[fid]
        quad(f"end_{fid}", m, r, [(x0, L, z0), (x1, L, z0), (x1, L, z1), (x0, L, z1)], lambda p, r: (p[0] / r[0], p[2] / r[1]))
    m, r = mats["gteki_finish_ceiling_spandrel"]
    quad("ceiling", m, r, [(x0, 0, H), (x0, L, H), (x1, L, H), (x1, 0, H)], lambda p, r: (p[1] / r[0], -p[0] / r[1]))

    # ceiling fixtures: emissive diffusers plus LIGHTHINT empties, as the kit passages do
    em = bpy.data.materials.new("gteki_light_diffuser")
    em.use_nodes = True
    b = em.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (0.9, 0.9, 0.88, 1)
    b.inputs["Emission Color"].default_value = (1.0, 0.97, 0.92, 1)
    b.inputs["Emission Strength"].default_value = 4.0
    n = 0
    for x in (-0.9, 0.9):
        for i in range(6):
            cy = 0.6 + i * 1.2
            quad(f"diffuser_{n}", em, [1, 1], [(x - 0.06, cy - 0.5, H - 0.01), (x - 0.06, cy + 0.5, H - 0.01),
                                              (x + 0.06, cy + 0.5, H - 0.01), (x + 0.06, cy - 0.5, H - 0.01)], lambda p, r: (0, 0))
            e = bpy.data.objects.new(f"LIGHTHINT_mock_{n}", None)
            e.location = (x, cy, H - 0.02)
            e["light_hint"], e["kind"], e["length_m"], e["axis"] = f"mock_{n}", "linear_led", 1.0, "y"
            bpy.context.scene.collection.objects.link(e)
            n += 1

    root = bpy.data.objects.new("finish_passage_mock", None)
    bpy.context.scene.collection.objects.link(root)
    for ob in list(bpy.context.scene.collection.objects):
        if ob is not root:
            ob.parent = root
    bpy.ops.export_scene.gltf(filepath=args.out, export_format="GLB", export_yup=True, export_apply=True, export_extras=True,
                              export_image_format="JPEG", export_cameras=False, export_lights=False)
    # tint the line band: baseColorFactor = line colour (linear), the texture stays neutral
    doc, binary = parse_glb(open(args.out, "rb").read())
    rgb = [int(args.line.lstrip("#")[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    for mt in doc["materials"]:
        if mt["name"].startswith("gteki_finish_band_line_accent"):
            mt["pbrMetallicRoughness"]["baseColorFactor"] = [round(v, 6) for v in srgb_to_linear(rgb)] + [1.0]
    open(args.out, "wb").write(encode_glb(doc, binary))
    print(f"[mock] wrote {args.out}")


if __name__ == "__main__":
    main(sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else [])
