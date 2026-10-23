"""Baked ambient occlusion: one map per asset, shared by all its visual materials.

Exported as the core glTF `occlusionTexture` (R channel, strength 1) on `texCoord` 1,
the `UVLightmap` layer that `asset._lightmap_uvs` lays out jointly for every visual
object (one atlas, so the islands of different meshes never overlap).

Determinism: Cycles on the CPU with a fixed seed and sample count and no denoiser
(per-pixel random streams do not depend on threads), then a numpy blur and edge
dilation; the PNG goes through `texsynth.png_bytes`. `build.sh repro` guards it.
"""

import bpy
import bmesh
import numpy as np

from . import contract, texsynth

DISTANCE_M = 0.4  # occluders further than this do not darken a point
SAMPLES = 256
SEED = 7
LARGE_EXTENT_M = 1.5  # assets with a larger bounds extent get the bigger map
HUGE_EXTENT_M = 6.0  # escalators and long runs: many small parts share one atlas, so they need more texels
RES_FULL, RES_MOBILE = (256, 512, 1024), (128, 256, 256)  # below LARGE / up to HUGE / at or above HUGE;
# mobile stays capped at 256 px (about 0.35 MB on the GPU with mips), the size agreed with Explorer (#134)
SIZES = (128, 256, 512, 1024)  # what a catalog `ao_res` override may ask for
MARGIN_PX = 5  # island gap used when packing; the contract asks for at least 4 px
DILATE_PX = 4  # baked texels copied into the gutter so mips and filtering do not bleed
FLOOR_REACH_M = 1.0  # the temporary floor extends this far past the asset
FLOOR_DROP_M = 0.001  # it sits a hair below Z=0, so surfaces resting on the floor do not hit it


def resolution(bounds, mobile=False):
    """Map size for an asset with glTF bounds (min, max). Full: 256 px below 1.5 m, 512 px below
    6 m, else 1024 px; mobile: 128 px below 1.5 m, else 256 px."""
    extent = max(hi - lo for lo, hi in zip(*bounds))
    return (RES_MOBILE if mobile else RES_FULL)[(extent >= LARGE_EXTENT_M) + (extent >= HUGE_EXTENT_M)]


def _floor(coll, vis_objs):
    """Occluder plane at Z=0 around the asset. Geometry below the floor (escalator pits) keeps
    a hole over its footprint, otherwise the plane would cover the pit and blacken it."""
    xs, ys, pit = [], [], []
    for o in vis_objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            xs.append(w.x)
            ys.append(w.y)
            if w.z < -1e-3:
                pit.append((w.x, w.y))
    x0, x1 = min(xs) - FLOOR_REACH_M, max(xs) + FLOOR_REACH_M
    y0, y1 = min(ys) - FLOOR_REACH_M, max(ys) + FLOOR_REACH_M
    bm = bmesh.new()
    if pit:
        px0, px1 = min(p[0] for p in pit), max(p[0] for p in pit)
        py0, py1 = min(p[1] for p in pit), max(p[1] for p in pit)
        rects = [(x0, y0, x1, py0), (x0, py1, x1, y1), (x0, py0, px0, py1), (px1, py0, x1, py1)]
    else:
        rects = [(x0, y0, x1, y1)]
    for ax, ay, bx, by in rects:
        if bx > ax and by > ay:
            bm.faces.new([bm.verts.new(c) for c in ((ax, ay, -FLOOR_DROP_M), (bx, ay, -FLOOR_DROP_M), (bx, by, -FLOOR_DROP_M), (ax, by, -FLOOR_DROP_M))])
    me = bpy.data.meshes.new("_ao_floor")
    bm.to_mesh(me)
    bm.free()
    obj = bpy.data.objects.new("_ao_floor", me)
    coll.objects.link(obj)
    return obj


def _is_glass(name):
    """Glass (and the mobile palette's blended variant, which only glass maps to) never occludes."""
    return name.startswith("gteki_glass") or name == contract.PALETTE_BLEND


def _copy(obj, glass, mat, coll):
    """Bake copy of the object's glass (or non-glass) faces with the bake material, or None."""
    me = obj.data.copy()
    bm = bmesh.new()
    bm.from_mesh(me)
    drop = [f for f in bm.faces if _is_glass(obj.data.materials[f.material_index].name) != glass]
    if drop:
        bmesh.ops.delete(bm, geom=drop, context="FACES")
    if not bm.faces:
        bm.free()
        bpy.data.meshes.remove(me)
        return None
    bm.to_mesh(me)
    bm.free()
    me.materials.clear()
    me.materials.append(mat)
    me.polygons.foreach_set("material_index", [0] * len(me.polygons))
    me.uv_layers.active = me.uv_layers["UVLightmap"]
    t = obj.copy()
    t.data = me
    t.name = f"_ao_{obj.name}"
    coll.objects.link(t)
    return t


def bake(vis_objs, res):
    """Float AO of every visual object into one `res` x `res` image: (values, baked mask), row 0 at
    the bottom (Blender image order). Self-occlusion only: the visuals plus a temporary floor.
    Glass receives AO but does not occlude: its faces are baked in a second pass in which only the
    non-glass faces (and the floor) stand in the scene as occluders."""
    scene = bpy.context.scene
    coll = scene.collection
    view_layer = bpy.context.view_layer
    settings = dict(engine=scene.render.engine, world=scene.world)
    scene.render.engine = "CYCLES"
    cy = scene.cycles
    cy.device = "CPU"
    cy.samples = SAMPLES
    cy.seed = SEED
    cy.use_animated_seed = False
    cy.use_adaptive_sampling = False
    cy.use_denoising = False
    bk = scene.render.bake
    bk.margin = 0
    world = bpy.data.worlds.new("_ao_world")
    world.light_settings.distance = DISTANCE_M
    scene.world = world

    img = bpy.data.images.new("_ao", res, res, alpha=True, float_buffer=True)
    img.generated_color = (0.0, 0.0, 0.0, 0.0)
    img.colorspace_settings.name = "Non-Color"
    mat = bpy.data.materials.new("_ao")
    mat.use_nodes = True
    nt = mat.node_tree
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = img
    nt.nodes.active = tex
    floor = _floor(coll, vis_objs)
    solid = [t for t in (_copy(o, False, mat, coll) for o in vis_objs) if t]  # copies stand in for the originals
    glassy = [t for t in (_copy(o, True, mat, coll) for o in vis_objs) if t]
    for o in vis_objs:
        o.hide_render = True  # coincident surfaces would shadow each other
    view_layer.update()

    def run(targets, clear):
        for o in view_layer.objects:
            o.select_set(False)
        for t in targets:
            t.select_set(True)
        view_layer.objects.active = targets[0]
        bpy.ops.object.bake(type="AO", margin=0, use_clear=clear)

    for t in glassy:  # glass never casts occlusion: not on the solids (pass 1), not on other glass (pass 2)
        t.visible_diffuse = t.visible_glossy = t.visible_transmission = False
        t.visible_shadow = t.visible_volume_scatter = False
    try:
        if solid:
            for t in glassy:  # out of the scene entirely while the solids bake
                t.hide_render = True
            run(solid, True)
            for t in glassy:
                t.hide_render = False
        if glassy:
            run(glassy, not solid)
        px = np.empty(res * res * 4, dtype=np.float32)
        img.pixels.foreach_get(px)
        px = px.reshape(res, res, 4)
        values, mask = px[..., 0].copy(), px[..., 3] > 0.5
    finally:
        for o in vis_objs:
            o.hide_render = False
        for t in solid + glassy + [floor]:
            me = t.data
            bpy.data.objects.remove(t)
            bpy.data.meshes.remove(me)
        bpy.data.materials.remove(mat)
        bpy.data.images.remove(img)
        scene.world = settings["world"]
        bpy.data.worlds.remove(world)
        scene.render.engine = settings["engine"]
    return values, mask


def _spread(a):
    """Sum of the eight neighbours (zero beyond the border)."""
    p = np.pad(a, 1)
    h, w = a.shape
    return sum(p[dy:dy + h, dx:dx + w] for dy in range(3) for dx in range(3) if (dy, dx) != (1, 1))


def finish(values, mask):
    """Deterministic clean-up of a baked map: [1 2 1] blur over baked texels only (so charts
    never bleed into one another), dilation by `DILATE_PX` into the gutter, mean-filled beyond.
    Returns float32 in [0, 1]."""
    if not mask.any():
        raise RuntimeError("ambient occlusion bake produced no texels (UVLightmap missing?)")
    v = np.where(mask, np.clip(values, 0.0, 1.0), 0.0).astype(np.float32)
    m = mask.astype(np.float32)
    k = np.array([1.0, 2.0, 1.0], dtype=np.float32)

    def blur(a):
        p = np.pad(a, 1)
        h, w = a.shape
        a = sum(k[i] * p[i:i + h, 1:1 + w] for i in range(3))
        p = np.pad(a, ((0, 0), (1, 1)))
        return sum(k[i] * p[:, i:i + w] for i in range(3))

    v = np.where(mask, blur(v) / np.maximum(blur(m), 1e-6), 0.0).astype(np.float32)
    have = mask.copy()
    for _ in range(DILATE_PX):
        n = _spread(have.astype(np.float32))
        fill = ~have & (n > 0)
        v = np.where(fill, _spread(np.where(have, v, 0.0)) / np.maximum(n, 1.0), v).astype(np.float32)
        have |= fill
    v[~have] = v[have].mean()
    return np.clip(v, 0.0, 1.0)


def png(values, mask):
    """Greyscale 8-bit PNG bytes of a baked map, top row first (glTF image order)."""
    return texsynth.png_bytes(np.flipud(finish(values, mask)), gray=True)
