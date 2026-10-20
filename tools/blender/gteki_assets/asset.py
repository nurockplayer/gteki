"""Asset assembly and contract-compliant GLB export."""

import hashlib
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import contract, materials
from .mesh import Part


def reset_scene():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.unit_settings.system = "METRIC"
    scene.unit_settings.scale_length = 1.0


def _idprop_safe(v):
    """IDProperties cannot hold lists of dicts / mixed lists; JSON-encode those.
    The root `extras.gteki` is rewritten with exact JSON types after export
    (see `_patch_root_extras`); this only keeps the .blend copy readable."""
    if isinstance(v, dict):
        return {str(k): _idprop_safe(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        if all(isinstance(x, (int, float)) and not isinstance(x, bool) for x in v) and v:
            return [float(x) if any(isinstance(y, float) for y in v) else int(x) for x in v]
        if all(isinstance(x, str) for x in v) and v:
            return json.dumps(list(v))
        return json.dumps(v)
    if isinstance(v, bool):
        return int(v)
    return v


class Asset:
    """Collects parts, collision, sockets and light hints for one GLB."""

    # build profile (contract.PROFILES); build.py sets it before running generators,
    # because parts read it when they are created
    profile = "full"

    def __init__(self, asset_id, family, variant, params, generator, dimension_basis, tex_res=contract.DEFAULT_TEX_RES, notes=None):
        self.id = asset_id
        self.family = family
        self.variant = variant
        self.params = params
        self.generator = generator
        self.dimension_basis = dimension_basis
        self.tex_res = tex_res
        self.notes = notes
        self.placement = "free"
        self.materials = []
        self.parts = []  # (group, Part)
        self.collision = []  # (name, Part)
        self.sockets = []
        self.light_hints = []
        self.shift = Vector((0.0, 0.0, 0.0))  # applied to everything at build time
        self.pivots = {}  # VIS group -> node origin (for runtime-animated parts)

    def use_full_twin(self, twin):
        """Mobile: take collision from the same asset generated at full detail, so colliders are
        identical in both profiles. `twin` must come from the same generator and params; only its
        collision bmesh is used (nothing is built)."""
        for _, part in self.collision:
            part.bm.free()
        self.collision = twin.collision
        for _, part in twin.parts:
            part.bm.free()

    def mat_index(self, name):
        if name not in materials.SPECS:
            raise KeyError(f"unknown material {name}")
        if name not in self.materials:
            self.materials.append(name)
        return self.materials.index(name)

    def part(self, group="main", **kw):
        p = Part(self, f"{group}_{len(self.parts)}", **kw)
        self.parts.append((group, p))
        return p

    def col_part(self, name):
        p = Part(self, name, weighted=False, collision=True)
        self.collision.append((name, p))
        return p

    def col_box(self, name, mn, mx):
        p = self.col_part(name)
        p.box(mn, mx, "gteki_concrete")
        return p

    def col_ramp(self, name, x0, x1, y0, z0, y1, z1, thickness=0.05):
        """Sloped collision slab (stairs/escalators) from (y0,z0) up to (y1,z1)."""
        p = self.col_part(name)
        prof = [(y0, z0 - thickness), (y1, z1 - thickness), (y1, z1), (y0, z0)]
        p.extrude_x(prof, x0, x1, "gteki_concrete")
        return p

    def socket(self, name, loc, yaw_deg=0.0, **extras):
        """Snap point. Local +Y (Blender) == glTF -Z points out of the module."""
        self.sockets.append((name, Vector(loc), yaw_deg, extras))

    def light_hint(self, name, loc, **extras):
        self.light_hints.append((name, Vector(loc), extras))

    def pivot(self, group, loc):
        """Give VIS_<group> its own node origin at `loc` so runtime can rotate it in place."""
        self.pivots[group] = Vector(loc)

    # ---------------------------------------------------------------- build

    def build(self):
        reset_scene()
        coll = bpy.context.scene.collection
        # mobile: content textures (sign faces) as JPEG; the palette stays PNG
        mats = [materials.get(m, self.tex_res, jpeg=self.profile == "mobile") for m in self.materials]

        root = bpy.data.objects.new(self.id, None)
        coll.objects.link(root)

        if self.shift.length > 0:
            for _, part in self.parts + self.collision:
                bmesh.ops.translate(part.bm, vec=self.shift, verts=part.bm.verts)
            self.sockets = [(n, l + self.shift, y, e) for n, l, y, e in self.sockets]
            self.light_hints = [(n, l + self.shift, e) for n, l, e in self.light_hints]

        mobile = self.profile == "mobile"
        groups = {}
        for group, part in self.parts:
            if not part.bm.faces:  # optional pieces that produced no geometry
                part.bm.free()
                continue
            obj = _part_object(part, mats, coll)
            # mobile: every static group joins one VIS_body; animated (pivoted) groups stay
            groups.setdefault("body" if mobile and group not in self.pivots else group, []).append(obj)
        vis_objs = []
        for group, objs in groups.items():
            o = _join(objs, f"{contract.VIS}{group}")
            if group in self.pivots:
                pv = self.pivots[group] + self.shift
                o.data.transform(Matrix.Translation(-pv))
                o.location = pv
            o.parent = root
            vis_objs.append(o)
        if mobile:
            self.export_materials = _fold_to_palette(vis_objs)
            for o in vis_objs:
                _lightmap_uvs(o)
        else:
            self.export_materials = list(self.materials)
        bpy.context.view_layer.update()

        col_objs = []
        for name, part in self.collision:
            me = bpy.data.meshes.new(f"{contract.COL}{name}{contract.COL_SUFFIX}")
            part.bm.to_mesh(me)
            me.materials.clear()
            o = bpy.data.objects.new(f"{contract.COL}{name}{contract.COL_SUFFIX}", me)
            coll.objects.link(o)
            o.parent = root
            o.display_type = "WIRE"
            col_objs.append(o)

        for name, loc, yaw, extras in self.sockets:
            e = bpy.data.objects.new(f"{contract.SOCKET}{name}", None)
            e.empty_display_type = "SINGLE_ARROW"
            e.location = loc
            e.rotation_euler = (0.0, 0.0, math.radians(yaw))
            e["socket"] = name
            for k, v in extras.items():
                e[k] = _idprop_safe(v)
            coll.objects.link(e)
            e.parent = root

        for name, loc, extras in self.light_hints:
            e = bpy.data.objects.new(f"{contract.LIGHTHINT}{name}", None)
            e.empty_display_type = "PLAIN_AXES"
            e.location = loc
            e["light_hint"] = name
            for k, v in extras.items():
                e[k] = _idprop_safe(v)
            coll.objects.link(e)
            e.parent = root

        # mobile colliders come from the full-detail twin and may reach past the simplified
        # visuals, so bounds_m covers them too (the full profile keeps its exact bytes)
        bounds = _gltf_bounds(vis_objs + (col_objs if mobile else []))
        tris = sum(_tri_count(o) for o in vis_objs)
        meta = {
            "contract": contract.CONTRACT,
            "id": self.id,
            "family": self.family,
            "variant": self.variant,
            "version": contract.KIT_VERSION,
            "generator": self.generator,
            "params": self.params,
            "bounds_m": {"min": [round(v, 4) for v in bounds[0]], "max": [round(v, 4) for v in bounds[1]]},
            "triangles": tris,
            "dimension_basis": self.dimension_basis,
            "placement": self.placement,
            "fidelity": contract.FIDELITY,
            "navigation": contract.NAVIGATION,
            "provenance": contract.PROVENANCE,
            "license": contract.LICENSE,
        }
        if self.notes:
            meta["notes"] = self.notes
        if mobile:
            meta["profile"] = "mobile"
        root["gteki"] = _idprop_safe(meta)
        self.meta = meta
        self.root = root
        return root

    def export(self, out_dir, save_blend_dir=None, jpeg_quality=88):
        if not contract.is_asset_id(self.id):
            raise ValueError(f"asset id {self.id!r} must match {contract.ASSET_ID_PATTERN}")
        os.makedirs(out_dir, exist_ok=True)
        path = os.path.join(out_dir, f"{self.id}.glb")
        bpy.ops.object.select_all(action="DESELECT")
        bpy.ops.export_scene.gltf(
            filepath=path,
            export_format="GLB",
            export_yup=True,
            export_apply=True,
            export_extras=True,
            export_texcoords=True,
            export_normals=True,
            export_tangents=False,
            export_materials="EXPORT",
            # mobile keeps source formats: the palette PNG must stay lossless (JPEG
            # chroma subsampling would bleed neighbouring swatches into each other)
            export_image_format="JPEG" if self.profile == "full" else "AUTO",
            export_jpeg_quality=jpeg_quality,
            export_cameras=False,
            export_lights=False,
            export_animations=False,
            export_skins=False,
            export_morph=False,
            export_copyright="GTEki (original work; licence pending Owner decision)",
            use_selection=False,
            export_draco_mesh_compression_enable=False,
        )
        _patch_root_extras(path, self.id, self.meta)
        if save_blend_dir:
            os.makedirs(save_blend_dir, exist_ok=True)
            bpy.ops.wm.save_as_mainfile(filepath=os.path.join(save_blend_dir, f"{self.id}.blend"), compress=True)
        with open(path, "rb") as f:
            data = f.read()
        return {
            "id": self.id,
            "family": self.family,
            "variant": self.variant,
            "file": f"glb/{self.id}.glb",
            "sha256": hashlib.sha256(data).hexdigest(),
            "bytes": len(data),
            "triangles": self.meta["triangles"],
            "materials": list(self.export_materials),
            # exported texture size and which maps stayed textures (the rest became factors)
            "textures": {
                m: {"res": plan["res"], "maps": sorted(plan["maps"])}
                for m in self.export_materials
                if (plan := _plan(m, self.tex_res))
            },
            "bounds_m": self.meta["bounds_m"],
            "dimension_basis": self.dimension_basis,
            "placement": self.placement,
            "params": self.params,
            "sockets": [
                {"name": n, "position_gltf": _to_gltf(l), "yaw_deg": y, **{k: v for k, v in e.items()}}
                for n, l, y, e in self.sockets
            ],
            "light_hints": len(self.light_hints),
            "collision_nodes": [f"{contract.COL}{n}{contract.COL_SUFFIX}" for n, _ in self.collision],
            "generator": self.generator,
        }


def _patch_root_extras(path, root_name, meta):
    """Replace the exporter's IDProperty-flattened root extras with exact JSON
    (lists of strings, empty lists and booleans keep their types)."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<4sII", data, 0)
    jlen, jtype = struct.unpack_from("<II", data, 12)
    if magic != b"glTF" or version != 2 or jtype != 0x4E4F534A:
        raise ValueError(f"{path}: unexpected GLB layout")
    doc = json.loads(data[20 : 20 + jlen])
    rest = data[20 + jlen :]
    roots = doc["scenes"][doc.get("scene", 0)]["nodes"]
    node = doc["nodes"][roots[0]]
    if len(roots) != 1 or node.get("name") != root_name:
        raise ValueError(f"{path}: expected single root {root_name!r}")
    node.setdefault("extras", {})["gteki"] = json.loads(json.dumps(meta))
    js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + rest
    with open(path, "wb") as f:
        f.write(struct.pack("<4sII", b"glTF", 2, 12 + len(body)) + body)


def _to_gltf(v):
    return [round(v.x, 4), round(v.z, 4), round(-v.y, 4)]


def _plan(name, tex_res):
    if name in (contract.PALETTE, contract.PALETTE_BLEND):
        return materials.palette_plan()
    return materials.texture_plan(name, tex_res)


def _fold_to_palette(objs):
    """Mobile: map every eligible material onto the palette (UV0 = swatch centre).
    Returns the exported material names in first-use order."""
    import numpy as np

    used = []
    for o in objs:
        me = o.data
        names = [m.name for m in me.materials]
        targets = [materials.palette_target(n) if materials.palette_eligible(n) else n for n in names]
        slots = list(dict.fromkeys(targets))
        uv = me.uv_layers[0]
        buf = np.empty(len(uv.data) * 2, dtype=np.float32)
        uv.data.foreach_get("uv", buf)
        buf = buf.reshape(-1, 2)
        idx = []
        for poly in me.polygons:
            src = names[poly.material_index]
            if materials.palette_eligible(src):
                buf[poly.loop_start:poly.loop_start + poly.loop_total] = materials.palette_uv(src)
            idx.append(slots.index(targets[poly.material_index]))
        uv.data.foreach_set("uv", buf.reshape(-1))
        me.materials.clear()
        for s in slots:
            mat = (materials.palette_material(s) if s in (contract.PALETTE, contract.PALETTE_BLEND)
                   else bpy.data.materials[s])
            _bind_uv(mat, uv.name)
            me.materials.append(mat)
        for poly, i in zip(me.polygons, idx):
            poly.material_index = i
        used += [s for s in slots if s not in used]
    return used


def _bind_uv(mat, uv_name):
    """Mobile meshes carry two UV layers; without an explicit UV Map node the
    exporter guesses each texture's texCoord (it wrote -1 or 1). Bind every
    image to the base layer so all textures sample TEXCOORD_0."""
    nt = mat.node_tree
    for node in list(nt.nodes):
        if node.type == "TEX_IMAGE" and not node.inputs["Vector"].is_linked:
            uvn = nt.nodes.new("ShaderNodeUVMap")
            uvn.uv_map = uv_name
            uvn.location = (node.location.x - 250, node.location.y)
            nt.links.new(uvn.outputs["UV"], node.inputs["Vector"])


def _lightmap_uvs(obj):
    """Mobile: non-overlapping lightmap UVs in a second layer (exported as TEXCOORD_1).
    Smart UV Project keeps connected charts, so vertices stay shared and
    lightmaps get few seams."""
    me = obj.data
    base = me.uv_layers[0]
    lm = me.uv_layers.new(name="UVLightmap")
    me.uv_layers.active = lm
    view_layer = bpy.context.view_layer
    for o in view_layer.objects:
        o.select_set(o is obj)
    view_layer.objects.active = obj
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.01, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=True)
    _separate_overlaps(me, "UVLightmap")  # lm is invalid once in edit mode
    bpy.ops.object.mode_set(mode="OBJECT")
    obj.select_set(False)
    me.uv_layers.active = base
    base.active_render = True
    _quantize_uvs(me)
    bm = bmesh.new()  # snapping to the grid must not create an overlap either
    bm.from_mesh(me)
    try:
        if _lightmap_overlaps(bm, bm.loops.layers.uv["UVLightmap"])[0]:
            raise RuntimeError(f"{me.name}: lightmap UVs overlap after quantization")
    finally:
        bm.free()


def _lightmap_overlaps(bm, uv):
    """Faces whose lightmap triangles overlap, and the faces that fold over themselves.
    Uses Blender's own tessellation, which the glTF exporter writes."""
    from validate_glb import uv_overlaps  # stdlib; build.py puts tools/blender on sys.path

    bm.faces.index_update()
    bm.faces.ensure_lookup_table()
    loop_tris = bm.calc_loop_triangles()
    tris = [tuple(tuple(loop[uv].uv) for loop in t) for t in loop_tris]
    owner = [t[0].face.index for t in loop_tris]
    pairs = uv_overlaps(tris)
    bad = sorted({owner[i] for pair in pairs for i in pair})
    folded = sorted({owner[a] for a, b in pairs if owner[a] == owner[b]})
    return bad, folded


def _separate_overlaps(me, layer, attempts=4):
    """Smart UV Project can fold a chart over itself. Detach every face that overlaps another
    into its own chart (splitting faces that fold over themselves) and repack, until nothing
    overlaps (validate_glb checks the export)."""
    for attempt in range(attempts + 1):
        bm = bmesh.from_edit_mesh(me)
        uv = bm.loops.layers.uv[layer]
        bad, folded = _lightmap_overlaps(bm, uv)
        if not bad:
            return
        if attempt == attempts:
            break
        if folded:  # its triangles become faces of their own; detached on the next pass
            bmesh.ops.triangulate(bm, faces=[bm.faces[i] for i in folded], quad_method="FIXED", ngon_method="EAR_CLIP")
            bmesh.update_edit_mesh(me)
            continue
        for n, index in enumerate(bad):  # its own chart, outside the unit square until repacked
            for loop in bm.faces[index].loops:
                loop[uv].uv += Vector((2.0 + 2.0 * n, 0.0))
        bmesh.update_edit_mesh(me)
        bpy.ops.mesh.select_all(action="SELECT")
        bpy.ops.uv.select_all(action="SELECT")
        bpy.ops.uv.pack_islands(rotate=False, margin=0.01)
    raise RuntimeError(f"{me.name}: lightmap UVs still overlap after {attempts} repairs")


def _part_object(part, mats, coll):
    me = bpy.data.meshes.new(part.name)
    # faces are emitted with their own vertices; weld them so bevels, smoothing
    # and weighted normals see connected topology (UVs stay per-loop)
    bmesh.ops.remove_doubles(part.bm, verts=part.bm.verts, dist=1e-5)
    part.bm.normal_update()
    part.bm.to_mesh(me)
    part.bm.free()
    for m in mats:
        me.materials.append(m)
    obj = bpy.data.objects.new(part.name, me)
    coll.objects.link(obj)
    if part.bevel > 0 and not part.low_detail:  # mobile: no bevels
        b = obj.modifiers.new("bevel", "BEVEL")
        b.width = part.bevel
        b.segments = part.bevel_segments
        b.limit_method = "ANGLE"
        b.angle_limit = math.radians(40)
        b.harden_normals = False
        b.miter_outer = "MITER_ARC" if part.bevel_segments > 1 else "MITER_SHARP"
        b.use_clamp_overlap = True
    if part.weighted and part.bevel > 0 and not part.low_detail:
        # chamfer + weighted normals: flat faces stay flat, bevels catch light
        for poly in me.polygons:
            poly.use_smooth = True
        w = obj.modifiers.new("wnormal", "WEIGHTED_NORMAL")
        w.keep_sharp = True
        w.weight = 50
        w.mode = "FACE_AREA"
    _apply_modifiers(obj)
    return obj


def _apply_modifiers(obj):
    if not obj.modifiers:
        return
    dg = bpy.context.evaluated_depsgraph_get()
    ev = obj.evaluated_get(dg)
    me = bpy.data.meshes.new_from_object(ev, preserve_all_data_layers=True, depsgraph=dg)
    old = obj.data
    obj.modifiers.clear()
    obj.data = me
    bpy.data.meshes.remove(old)


def _join(objs, name):
    target = objs[0]
    if len(objs) > 1:
        with bpy.context.temp_override(active_object=target, selected_editable_objects=objs, object=target):
            bpy.ops.object.join()
    target.name = name
    target.data.name = name
    me = target.data
    _quantize_uvs(me)
    # drop material slots that ended up unused and keep the remaining order stable
    used = {p.material_index for p in me.polygons}
    if len(used) < len(me.materials):
        keep = [i for i in range(len(me.materials)) if i in used]
        remap = {old: new for new, old in enumerate(keep)}
        idx = [remap[p.material_index] for p in me.polygons]
        mats = [me.materials[i] for i in keep]
        me.materials.clear()
        for m in mats:
            me.materials.append(m)
        for p, i in zip(me.polygons, idx):
            p.material_index = i
    return target


def _quantize_uvs(me, step=1.0 / 65536.0):
    """Bevel UV interpolation can differ by 1 ULP between runs (threading);
    snapping to a fine grid makes exports byte-reproducible."""
    import numpy as np

    for layer in me.uv_layers:
        buf = np.empty(len(layer.data) * 2, dtype=np.float32)
        layer.data.foreach_get("uv", buf)
        layer.data.foreach_set("uv", (np.round(buf / step) * step).astype(np.float32))


def _tri_count(obj):
    me = obj.data
    me.calc_loop_triangles()
    return len(me.loop_triangles)


def _gltf_bounds(objs):
    mn = [math.inf] * 3
    mx = [-math.inf] * 3
    for o in objs:
        for v in o.data.vertices:
            w = o.matrix_world @ v.co
            g = (w.x, w.z, -w.y)
            for i in range(3):
                mn[i] = min(mn[i], g[i])
                mx[i] = max(mx[i], g[i])
    return mn, mx
