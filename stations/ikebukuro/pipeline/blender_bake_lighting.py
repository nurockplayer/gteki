"""Bake station lighting; stdlib + Blender only. Run from the repository root:

blender -b --factory-startup --python stations/ikebukuro/pipeline/blender_bake_lighting.py -- \
  stations/ikebukuro/assets/ikebukuro_b1.glb stations/ikebukuro/assets/ikebukuro_b1_lit.glb \
  stations/ikebukuro/assets/ikebukuro_b1_lightmap.png --size 4096 --samples 64

Start with --size 1024 --samples 16. CPU avoids headless Metal device discovery
inside Cycles (Blender itself may still crash during Metal startup in a sandbox).
PNG stores pow(linear / scale, 1/2.2); sample as DATA, without sRGB decoding.
"""
import argparse
from array import array
import hashlib
import json
import math
import os
from pathlib import Path
import struct
import sys
import time
import zlib

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree

BAKED = {"floor", "wall", "ceiling", "stairs_ramps", "barriers", "transport", "floor_elements"}
DOWN, UP = Vector((0, 0, -1)), Vector((0, 0, 1))


def select(objects):
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]


def geometry(objects, weld=None):
    """World-space soup of all objects, face order preserved. With weld (metres), coincident
    vertices are shared so connected surfaces become one UV island instead of one per triangle.
    A face that would collapse keeps private vertices, so loop correspondence never changes."""
    vertices, faces, index = [], [], {}
    for obj in objects:
        world = [obj.matrix_world @ v.co for v in obj.data.vertices]
        for p in obj.data.polygons:
            if weld is None:
                ids = []
                for i in p.vertices:
                    ids.append(len(vertices))
                    vertices.append(world[i])
                faces.append(tuple(ids))
                continue
            ids = []
            for i in p.vertices:
                co = world[i]
                key = (round(co.x / weld), round(co.y / weld), round(co.z / weld))
                if key not in index:
                    index[key] = len(vertices)
                    vertices.append(co)
                ids.append(index[key])
            if len(set(ids)) != len(ids):
                ids = []
                for i in p.vertices:
                    ids.append(len(vertices))
                    vertices.append(world[i])
            faces.append(tuple(ids))
    return vertices, faces


def mesh_object(name, vertices, faces):
    mesh = bpy.data.meshes.new(name)
    mesh.from_pydata(vertices, [], faces)
    mesh.update()
    obj = bpy.data.objects.new(name, mesh)
    bpy.context.collection.objects.link(obj)
    return obj


def emission(name, color, strength):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Color"].default_value = (*color, 1)
    bsdf.inputs["Emission Strength"].default_value = strength
    mat.diffuse_color = (*color, 1)
    return mat


def fixtures(objects):
    def tree(roles):
        vertices, faces = geometry([o for o in objects if o.get("gteki_role") in roles])
        return BVHTree.FromPolygons(vertices, faces, all_triangles=True) if faces else None

    ceiling, ground, obstacles = tree({"ceiling"}), tree({"floor", "stairs_ramps"}), tree({"wall", "barriers"})
    if ceiling is None or ground is None:
        raise ValueError("source requires ceiling and floor/stairs meshes")
    points, _ = geometry([o for o in objects if o.get("gteki_role") == "ceiling"])
    bearing = math.radians(110)
    along = Vector((math.sin(bearing), math.cos(bearing), 0))
    across = Vector((-along.y, along.x, 0))
    yaw = math.atan2(along.y, along.x)
    low, high = min(p.z for p in points), max(p.z for p in points)
    rays = [Vector((math.cos(i * math.tau / 16), math.sin(i * math.tau / 16), 0)) for i in range(16)]
    vertices, faces, records = [], [], []
    box = [(-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1),
           (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)]
    quads = [(0, 3, 2, 1), (4, 5, 6, 7), (0, 1, 5, 4), (1, 2, 6, 5), (2, 3, 7, 6), (3, 0, 4, 7)]
    ranges = [range(math.floor(min(p.dot(v) for p in points) / step),
                    math.ceil(max(p.dot(v) for p in points) / step) + 1)
              for v, step in ((along, 2.4), (across, 3.0))]
    for i in ranges[0]:
        for j in ranges[1]:
            xy = along * (i * 2.4) + across * (j * 3.0)
            origin = Vector((xy.x, xy.y, high + 0.1))
            while origin.z > low - 0.01:  # Also handle stacked concourses.
                c, normal, _, _ = ceiling.ray_cast(origin, DOWN, high - low + 0.2)
                if c is None:
                    break
                origin = c + DOWN * 0.01
                f, _, _, _ = ground.ray_cast(c + DOWN * 0.01, DOWN, 4.5)
                if abs(normal.z) < 0.9 or f is None or not 2.2 <= c.z - f.z <= 4.5:
                    continue
                top, _, _, _ = ceiling.ray_cast(f + UP * 0.01, UP, 4.6)
                if top is None or abs(top.z - c.z) > 0.02:
                    continue
                mid = Vector((xy.x, xy.y, (f.z + c.z) / 2))
                if obstacles and any(obstacles.ray_cast(mid, ray, 0.5)[0] is not None for ray in rays):
                    continue
                center = Vector((xy.x, xy.y, top.z - 0.03 - 0.02))
                offset = len(vertices)
                vertices.extend(center + along * (x * 0.6) + across * (y * 0.075) + UP * (z * 0.02)
                                for x, y, z in box)
                faces.extend(tuple(offset + k for k in face) for face in quads)
                records.append({"centre_enu_m": list(center), "yaw_radians": yaw})
    if not records:
        raise RuntimeError("no fixture candidates passed the geometry checks")
    obj = mesh_object("light_fixtures", vertices, faces)
    obj["gteki_role"] = "light_fixtures"
    obj.data.materials.append(emission("LED_4000K", (1.0, 0.62, 0.39), 20))
    print(f"FIXTURES {len(records)}; yaw={math.degrees(yaw):.1f} deg about ENU +Z", flush=True)
    return records


def pack(objects, size):
    # One world-space mesh gives all roles one atlas and one texel density.
    uv0 = {}
    for obj in objects:
        if len(obj.data.uv_layers) != 1:
            raise ValueError(f"{obj.name}: expected exactly one source UV map")
        values = array("f", [0]) * (len(obj.data.loops) * 2)
        obj.data.uv_layers[0].data.foreach_get("uv", values)
        uv0[obj.name] = values.tobytes()
    temp = mesh_object("_lightmap_pack", *geometry(objects, weld=0.002))
    temp.data.uv_layers.new(name="lightmap")
    select([temp])
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0, scale_to_bounds=False)
    bpy.ops.uv.average_islands_scale()
    bpy.ops.uv.pack_islands(rotate=True, scale=True, shape_method="CONCAVE", margin_method="FRACTION", margin=3 / size)
    bpy.ops.object.mode_set(mode="OBJECT")
    values = array("f", [0]) * (len(temp.data.loops) * 2)
    temp.data.uv_layers[0].data.foreach_get("uv", values)
    area, uv_area = sum(p.area for p in temp.data.polygons), 0.0
    for p in temp.data.polygons:
        uvs = [Vector(values[2 * i:2 * i + 2]) for i in p.loop_indices]
        uv_area += abs(sum(a.x * b.y - b.x * a.y for a, b in zip(uvs, uvs[1:] + uvs[:1]))) / 2
    cursor = 0
    for obj in objects:
        length = len(obj.data.loops) * 2
        layer = obj.data.uv_layers.new(name="lightmap")
        layer.data.foreach_set("uv", values[cursor:cursor + length])
        obj.data.uv_layers.active_index = 1
        obj.data.uv_layers[0].active_render = True
        check = array("f", [0]) * length
        obj.data.uv_layers[0].data.foreach_get("uv", check)
        assert check.tobytes() == uv0[obj.name], "UV0 changed"
        cursor += length
    assert cursor == len(values), "packing loop correspondence changed"
    mesh = temp.data
    bpy.data.objects.remove(temp, do_unlink=True)
    bpy.data.meshes.remove(mesh)
    density = math.sqrt(area / uv_area) / size
    print(f"ATLAS {area:.1f} m²; occupancy={uv_area:.3f}; {density:.4f} m/texel", flush=True)
    return {"metres_per_texel": density, "surface_area_m2": area, "uv_occupancy": uv_area, "margin_texels": 3}


def bake(objects, size, samples, device="CPU"):
    scene = bpy.context.scene
    scene.render.engine = "CYCLES"
    if device == "GPU":
        prefs = bpy.context.preferences.addons["cycles"].preferences
        prefs.compute_device_type = "METAL"
        prefs.get_devices()
        for d in prefs.devices:
            d.use = d.type == "METAL"
        if not any(d.use for d in prefs.devices):
            raise RuntimeError("no Metal device available; use --device CPU")
    scene.cycles.device = device
    scene.cycles.samples = samples
    scene.cycles.use_denoising = True  # Honoured only by Blender versions supporting bake denoising.
    scene.cycles.seed = 0
    scene.world.use_nodes = True
    background = scene.world.node_tree.nodes.get("Background")
    background.inputs["Color"].default_value = (0.05, 0.05, 0.05, 1)
    background.inputs["Strength"].default_value = 0.02
    image = bpy.data.images.new("station_irradiance", width=size, height=size, alpha=True, float_buffer=True)
    image.generated_color = (0, 0, 0, 0)
    image.colorspace_settings.name = "Non-Color"
    mat = bpy.data.materials.new("_bake_neutral")
    mat.use_nodes = True
    nodes = mat.node_tree.nodes
    nodes.clear()
    diffuse = nodes.new("ShaderNodeBsdfDiffuse")
    diffuse.inputs["Color"].default_value = (0.7, 0.7, 0.7, 1)
    output = nodes.new("ShaderNodeOutputMaterial")
    mat.node_tree.links.new(diffuse.outputs[0], output.inputs["Surface"])
    target = nodes.new("ShaderNodeTexImage")
    target.image = image
    nodes.active = target
    hidden = [(o, o.hide_render) for o in bpy.context.scene.objects]
    saved, daylight = [], None
    try:
        vertices, faces = [], []
        for obj, _ in hidden:
            if obj.get("gteki_render") is False:
                obj.hide_render = True
            if obj.get("gteki_role") == "portals":
                for p in obj.data.polygons:
                    points = [obj.matrix_world @ obj.data.vertices[i].co for i in p.vertices]
                    normal = obj.matrix_world.to_3x3() @ p.normal
                    if abs(normal.normalized().z) > 0.95 and min(v.z for v in points) > 31:
                        faces.append(tuple(range(len(vertices), len(vertices) + len(points))))
                        vertices.extend(points)
        daylight = mesh_object("_bake_daylight", vertices, faces)
        daylight.data.materials.append(emission("_daylight", (0.72, 0.84, 1), 3))
        print(f"DAYLIGHT {len(faces)} horizontal portal faces above TP 31 m", flush=True)
        for obj in objects:
            saved.append((obj, list(obj.data.materials), [p.material_index for p in obj.data.polygons]))
            obj.hide_render = False
            obj.data.materials.clear()
            obj.data.materials.append(mat)
            for p in obj.data.polygons:
                p.material_index = 0
        select(objects)
        start = time.monotonic()
        result = bpy.ops.object.bake(type="DIFFUSE", pass_filter={"DIRECT", "INDIRECT"},
                                    uv_layer="lightmap", margin=3, use_clear=True, use_selected_to_active=False)
        if result != {"FINISHED"}:
            raise RuntimeError(f"bake failed: {result}")
        return image, time.monotonic() - start, len(faces)
    finally:
        for obj, materials, indices in saved:
            obj.data.materials.clear()
            for material in materials:
                obj.data.materials.append(material)
            for p, index in zip(obj.data.polygons, indices):
                p.material_index = index
        for obj, hide in hidden:
            obj.hide_render = hide
        if daylight:
            bpy.data.objects.remove(daylight, do_unlink=True)


def denoise(rgba, sigma):
    """Mask-aware Gaussian (numpy, bundled with Blender): averages only covered texels, so
    island borders do not darken. Station lighting is low-frequency; sigma is in texels."""
    import numpy as np
    if sigma <= 0:
        return rgba
    radius = int(math.ceil(3 * sigma))
    k = np.exp(-0.5 * (np.arange(-radius, radius + 1) / sigma) ** 2).astype(np.float32)
    k /= k.sum()
    mask = (rgba[..., 3] > 0).astype(np.float32)
    stack = np.concatenate([rgba[..., :3] * mask[..., None], mask[..., None]], axis=2)
    for axis in (0, 1):
        padded = np.pad(stack, [(radius, radius) if a == axis else (0, 0) for a in range(3)])
        out = np.zeros_like(stack)
        n = stack.shape[axis]
        for i, w in enumerate(k):
            out += w * (padded[i:i + n] if axis == 0 else padded[:, i:i + n])
        stack = out
    result = rgba.copy()
    weight = np.maximum(stack[..., 3:4], 1e-6)
    result[..., :3] = np.where(mask[..., None] > 0, stack[..., :3] / weight, 0)
    return result


def save_lightmap(image, path, sigma):
    # Write RGB PNG ourselves: no display transform, hidden exposure or sRGB conversion.
    import numpy as np
    size = image.size[0]
    rgba = np.empty(size * size * 4, dtype=np.float32)
    image.pixels.foreach_get(rgba)
    rgba = rgba.reshape(size, size, 4)
    if not np.isfinite(rgba).all():
        raise RuntimeError("non-finite bake pixels")
    covered = rgba[..., 3] > 0
    if not covered.any() or rgba[..., :3].max() < 1e-6:
        raise RuntimeError("lightmap is black or contains no covered pixels")
    rgba = denoise(rgba, sigma)
    rgb = rgba[..., :3]
    lin = rgb[covered]
    # Fixture hot spots would waste the 8-bit range; clip the top 0.2 % (they read as white anyway).
    scale = max(1.0, float(np.percentile(lin.max(axis=1), 99.8)) * 1.05)
    enc = np.round(255 * np.clip(rgb / scale, 0, 1) ** (1 / 2.2)).astype(np.uint8)
    enc[~covered] = 0
    rows = enc[::-1]  # Blender pixels bottom-up; PNG rows top-down.
    raw = np.concatenate([np.zeros((size, 1), np.uint8), rows.reshape(size, size * 3)], axis=1).tobytes()
    def chunk(handle, kind, data):
        handle.write(struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data)))
    with path.open("wb") as handle:
        handle.write(b"\x89PNG\r\n\x1a\n")
        chunk(handle, b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0))
        chunk(handle, b"IDAT", zlib.compress(raw, 6))
        chunk(handle, b"IEND", b"")
    e = enc[covered].astype(np.float64)
    stats = {"covered_linear_rgb": {"min": float(lin.min()), "mean": float(lin.mean()), "max": float(lin.max())},
             "covered_png_rgb_0_255": {"min": int(e.min()), "mean": float(e.mean()), "max": int(e.max())},
             "covered_pixel_fraction_including_margin": float(covered.mean())}
    print("IMAGE " + json.dumps(stats), flush=True)
    return stats, {"decode": "value = (png_byte / 255)^2.2 * scale (top 0.2% clipped)", "scale": scale,
                   "sampling": "raw DATA, no automatic sRGB decode", "denoise_sigma_texels": sigma, "exr": None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("source", "output", "lightmap"):
        parser.add_argument(name, type=Path)
    parser.add_argument("--size", type=int, default=4096)
    parser.add_argument("--samples", type=int, default=64)
    parser.add_argument("--device", choices=("CPU", "GPU"), default="CPU", help="GPU = Metal (outside sandboxes)")
    parser.add_argument("--denoise", type=float, default=1.5, help="mask-aware blur sigma in texels; 0 = off")
    args = parser.parse_args(sys.argv[sys.argv.index("--") + 1:])
    if args.size < 64 or args.samples < 1 or args.source.resolve() == args.output.resolve():
        parser.error("size >= 64, samples >= 1, and a separate output GLB are required")
    start = time.monotonic()
    source_hash = hashlib.sha256(args.source.read_bytes()).hexdigest()
    for path in (args.output, args.lightmap):
        path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.source.resolve()))
    objects = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    expected = {o.name: dict(o.items()) for o in objects}
    records = fixtures(objects)
    fixture_path = args.output.parent / (args.source.stem + "_fixtures.json")
    fixture_path.write_text(json.dumps({"frame": "ENU metres, z=TP height", "yaw": "radians CCW from east about +Z",
                                       "bearing_degrees": 110, "fixtures": records}, indent=2) + "\n")
    baked = [o for o in objects if o.get("gteki_role") in BAKED]
    atlas = pack(baked, args.size)
    image, bake_seconds, daylight_faces = bake(baked, args.size, args.samples, args.device)
    projected = bake_seconds * (4096 / args.size) ** 2 * (64 / args.samples)
    print(f"BAKE {bake_seconds:.1f}s; projected 4096/64: {projected:.1f}s (pixel × sample estimate)", flush=True)
    stats, encoding = save_lightmap(image, args.lightmap, args.denoise)
    for obj in baked:
        obj.data.uv_layers.active_index = 0
    options = dict(filepath=str(args.output.resolve()), export_format="GLB", export_extras=True,
                   export_texcoords=True, export_yup=True, export_draco_mesh_compression_enable=False)
    if "export_meshopt_compression_enable" in bpy.ops.export_scene.gltf.get_rna_type().properties:
        options["export_meshopt_compression_enable"] = False
    if bpy.ops.export_scene.gltf(**options) != {"FINISHED"}:
        raise RuntimeError("GLB export failed")
    # A real headless round-trip verifies exported UV sets and extras, not just the working meshes.
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(args.output.resolve()))
    imported = [o for o in bpy.context.scene.objects if o.type == "MESH"]
    assert len(imported) == len(expected) + 1
    assert set(expected) == {o.name for o in imported if o.get("gteki_role") != "light_fixtures"}
    for obj in imported:
        if obj.get("gteki_role") in BAKED:
            assert len(obj.data.uv_layers) == 2, f"{obj.name}: missing UV1"
        if obj.name in expected:
            assert all(obj.get(k) == v for k, v in expected[obj.name].items()), f"{obj.name}: extras changed"
    assert any(o.name == "light_fixtures" and o.get("gteki_role") == "light_fixtures" for o in imported)
    meta = {"fixture_count": len(records), "lightmap_size": args.size, "texel_density": atlas,
            "bake_samples": args.samples, "encoding": encoding, "bake_time_seconds": bake_seconds,
            "total_time_seconds": time.monotonic() - start, "blender_version": bpy.app.version_string,
            "source_glb_sha256": source_hash, "daylight_portal_faces": daylight_faces, "image_stats": stats,
            "bake": f"Cycles {args.device} DIFFUSE DIRECT+INDIRECT, no COLOR; neutral diffuse 0.7",
            "denoising": f"mask-aware Gaussian, sigma {args.denoise} texels (numpy)",
            "verification": "headless GLB re-import: 2 UV maps, fixture mesh and original extras"}
    files = [args.output, args.lightmap, fixture_path]
    if encoding["exr"]:
        files.append(args.lightmap.with_suffix(".exr"))
    meta["file_sizes_bytes"] = {p.name: p.stat().st_size for p in files}
    args.output.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print("DONE " + json.dumps(meta), flush=True)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(1)  # Blender otherwise reports success for Python exceptions.
