"""Asset assembly and contract-compliant GLB export."""

import hashlib
import json
import math
import os
import struct

import bmesh
import bpy
from mathutils import Matrix, Vector

from . import ao, contract, materials
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
        self.provenance = contract.PROVENANCE  # families override these for supplied artwork
        self.license = contract.LICENSE
        self.license_spdx = contract.LICENSE_SPDX  # written only when contract.EMBED_SPDX
        self.placement = "free"
        self.ao_res_override = None  # catalog `ao_res`, applied to both tiers
        self.materials = []
        self.parts = []  # (group, Part)
        self.collision = []  # (name, Part)
        self.sockets = []
        self.light_hints = []
        self.shift = Vector((0.0, 0.0, 0.0))  # applied to everything at build time
        self.pivots = {}  # VIS group -> node origin (for runtime-animated parts)

    def drop_collision(self):
        """Catalog `"collision": false`: a visual-only GLB, with no COL_* nodes on either tier."""
        for _, part in self.collision:
            part.bm.free()
        self.collision = []

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
        # mobile: content as JPEG; palette and declared finish normals keep their PNG bytes
        normal_png = self.family == "finish" and materials.finish_normal_png(self.params, self.profile)
        mats = [materials.get(m, self.tex_res, jpeg=self.profile == "mobile", normal_png=normal_png) for m in self.materials]

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
        else:
            self.export_materials = list(self.materials)
            for m in mats:  # two UV layers: bind every texture to the base one (see _bind_uv)
                _bind_uv(m, "UVMap")
        bpy.context.view_layer.update()

        # one shared occlusion map per asset; baked before the colliders exist, so they never occlude
        # a station catalog may pin the size (`ao_res`) when it places many copies of a long piece
        self.ao_res = self.ao_res_override or ao.resolution(_gltf_bounds(vis_objs), mobile)
        while True:
            try:
                _lightmap_uvs(vis_objs, self.ao_res)
                break
            except LightmapOverflow:
                # too many charts to keep MARGIN_PX gaps on this map (mobile joins every static
                # part into one atlas): the next size up, never past the full tier's largest
                if self.ao_res_override or self.ao_res >= ao.RES_FULL[-1]:
                    raise
                self.ao_res *= 2
        self.ao_png = ao.png(*ao.bake(vis_objs, self.ao_res))

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
            "provenance": self.provenance,
            "license": self.license,
        }
        meta.update(contract.rights_fields(self.license_spdx))  # {} while contract.EMBED_SPDX is off
        if self.notes:
            meta["notes"] = self.notes
        if mobile:
            meta["profile"] = "mobile"
        root["gteki"] = _idprop_safe(meta)
        self.meta = meta
        self.root = root
        return root

    def _texture_plan(self, name):
        """Manifest plan of one exported material: its own maps plus the shared occlusion map
        (`occlusion_res` px, whatever the material's `res`)."""
        plan = _plan(name, self.tex_res) or {"res": 0, "maps": {}}
        return {"res": plan["res"], "maps": sorted([*plan["maps"], "occlusion"]), "occlusion_res": self.ao_res}

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
            export_copyright=contract.GLB_COPYRIGHT,
            use_selection=False,
            export_draco_mesh_compression_enable=False,
        )
        _patch_root_extras(path, self.id, self.meta, self.ao_png)
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
            "textures": {m: self._texture_plan(m) for m in self.export_materials},
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
            **contract.rights_fields(self.license_spdx),  # {} while contract.EMBED_SPDX is off
        }


NEAREST, NEAREST_MIPMAP_NEAREST = 9728, 9984  # glTF sampler filters


def _patch_root_extras(path, root_name, meta, ao_png):
    """Replace the exporter's IDProperty-flattened root extras with exact JSON
    (lists of strings, empty lists and booleans keep their types), keep
    nearest-sampled (palette) textures free of mipmaps, and attach the asset's
    baked occlusion map (PNG bytes) to every material as `occlusionTexture`."""
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
    for sampler in doc.get("samplers", []):
        # "Closest" exports as NEAREST_MIPMAP_NEAREST; the palette atlas must never be minified
        # through mips, where swatches average into each other (only the palette samples Closest)
        if sampler.get("magFilter") == NEAREST and sampler.get("minFilter") == NEAREST_MIPMAP_NEAREST:
            sampler["minFilter"] = NEAREST
    blen, btype = struct.unpack_from("<II", rest, 0)
    if btype != 0x004E4942 or doc["buffers"][0]["byteLength"] > blen:
        raise ValueError(f"{path}: unexpected BIN chunk")
    binary = rest[8 : 8 + doc["buffers"][0]["byteLength"]]
    binary += b"\0" * (-len(binary) % 4)
    views, images, samplers, textures = (doc.setdefault(k, []) for k in ("bufferViews", "images", "samplers", "textures"))
    views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(ao_png)})
    binary += ao_png
    doc["buffers"][0]["byteLength"] = len(binary)
    images.append({"name": f"{root_name}_ao", "mimeType": "image/png", "bufferView": len(views) - 1})
    samplers.append({"magFilter": 9729, "minFilter": 9987, "wrapS": 33071, "wrapT": 33071})  # linear + mips, clamped
    textures.append({"sampler": len(samplers) - 1, "source": len(images) - 1})
    for material in doc["materials"]:
        material["occlusionTexture"] = {"index": len(textures) - 1, "texCoord": 1}
    binary += b"\0" * (-len(binary) % 4)
    js = json.dumps(doc, separators=(",", ":"), ensure_ascii=False).encode()
    js += b" " * (-len(js) % 4)
    body = struct.pack("<II", len(js), 0x4E4F534A) + js + struct.pack("<II", len(binary), 0x004E4942) + binary
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


def _lightmap_uvs(objs, res):
    """Non-overlapping lightmap UVs in a second layer (exported as TEXCOORD_1), laid out jointly
    for every visual object: one atlas, because the asset's occlusion map is shared by all of
    them. Islands keep `ao.MARGIN_PX` px of a `res` px map between them. Smart UV Project keeps
    connected charts, so vertices stay shared and lightmaps get few seams."""
    margin = ao.MARGIN_PX / res
    view_layer = bpy.context.view_layer
    for o in objs:
        o.data.uv_layers.active = o.data.uv_layers.new(name="UVLightmap")
    for o in view_layer.objects:
        o.select_set(o in objs)
    view_layer.objects.active = objs[0]
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    try:
        _unwrap_lightmap(objs, margin)
    except LightmapOverflow:  # leave the objects as they were, for a retry at another size
        bpy.ops.object.mode_set(mode="OBJECT")
        for o in objs:
            o.data.uv_layers.remove(o.data.uv_layers["UVLightmap"])
        raise
    bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        o.select_set(False)
        base = o.data.uv_layers[0]
        o.data.uv_layers.active = base
        base.active_render = True
        _quantize_uvs(o.data)
    bms = []
    try:  # snapping to the grid must not create an overlap either, nor leave the unit square
        for o in objs:
            bm = bmesh.new()
            bm.from_mesh(o.data)
            bms.append(bm)
            uv = bm.loops.layers.uv["UVLightmap"]
            if any(not -1e-6 <= c <= 1 + 1e-6 for f in bm.faces for loop in f.loops for c in loop[uv].uv):
                raise RuntimeError(f"{o.data.name}: lightmap UVs leave the unit square")
        if any(_lightmap_overlaps(bms)[0]):
            raise RuntimeError("lightmap UVs overlap after quantization")
    finally:
        for bm in bms:
            bm.free()


def _unwrap_lightmap(objs, margin):
    bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0,
                             correct_aspect=True, scale_to_bounds=False)
    _pack(margin)
    _separate_overlaps(objs, margin)  # the layers are invalid once in edit mode


class LightmapOverflow(RuntimeError):
    """The charts do not fit the unit square with the requested margin."""


def _pack(margin):
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    bpy.ops.uv.pack_islands(rotate=False, margin=margin, margin_method="FRACTION")


def _lightmap_overlaps(bms):
    """Per bmesh, the faces whose lightmap triangles overlap another's (in any of `bms`, which
    share one atlas) and the faces that fold over themselves. Uses Blender's own tessellation,
    which the glTF exporter writes."""
    from validate_glb import uv_overlaps  # stdlib; build.py puts tools/blender on sys.path

    tris, owner = [], []
    for k, bm in enumerate(bms):
        uv = bm.loops.layers.uv["UVLightmap"]
        bm.faces.index_update()
        bm.faces.ensure_lookup_table()
        for t in bm.calc_loop_triangles():
            tris.append(tuple(tuple(loop[uv].uv) for loop in t))
            owner.append((k, t[0].face.index))
    bad, folded = [set() for _ in bms], [set() for _ in bms]
    for a, b in uv_overlaps(tris):
        for k, face in (owner[a], owner[b]):
            bad[k].add(face)
        if owner[a] == owner[b]:
            folded[owner[a][0]].add(owner[a][1])
    return [sorted(x) for x in bad], [sorted(x) for x in folded]


def _separate_overlaps(objs, margin, attempts=4):
    """Smart UV Project can fold a chart over itself. Detach every face that overlaps another
    into its own chart (splitting faces that fold over themselves) and repack, until nothing
    overlaps (validate_glb checks the export)."""
    for attempt in range(attempts + 1):
        bms = [bmesh.from_edit_mesh(o.data) for o in objs]
        for o, bm in zip(objs, bms):  # check the coordinates _quantize_uvs will export: snapping
            _snap_lightmap(bm)        # can make bevel slivers overlap that did not before
            bmesh.update_edit_mesh(o.data)
        bad, folded = _lightmap_overlaps(bms)
        collapsed = _collapsed_lightmap_faces(bms)
        if any(collapsed) and attempt < attempts:  # a sliver projected edge-on: unwrap it alone
            _reproject_faces(objs, bms, collapsed)
            _pack(margin)
            continue
        outside = any(not -1e-6 <= c <= 1 + 1e-6 for bm in bms for f in bm.faces
                      for loop in f.loops for c in loop[bm.loops.layers.uv["UVLightmap"]].uv)
        if not any(bad) and not outside:
            return
        if attempt == attempts:
            break
        if not any(bad):  # a repack left charts parked outside the unit square: pack again
            _pack(margin)
            continue
        if any(folded):  # its triangles become faces of their own; detached on the next pass
            for o, bm, faces in zip(objs, bms, folded):
                if faces:
                    bmesh.ops.triangulate(bm, faces=[bm.faces[i] for i in faces], quad_method="FIXED", ngon_method="EAR_CLIP")
                    bmesh.update_edit_mesh(o.data)
            continue
        n = 0
        for o, bm, faces in zip(objs, bms, bad):
            uv = bm.loops.layers.uv["UVLightmap"]
            for index in faces:  # its own chart, outside the unit square until repacked
                for loop in bm.faces[index].loops:
                    loop[uv].uv += Vector((2.0 + 2.0 * n, 0.0))
                n += 1
            bmesh.update_edit_mesh(o.data)
        _pack(margin)
    if not any(bad):
        raise LightmapOverflow(f"lightmap charts do not fit the unit square at margin {margin:g}")
    raise RuntimeError(f"lightmap UVs still overlap after {attempts} repairs")


def _collapsed_lightmap_faces(bms):
    """Per bmesh, the faces with a lightmap triangle that validate_glb would call collapsed:
    visible geometry whose chart squeezed it to a point or a line."""
    from validate_glb import COLLAPSED_UV_AREA, VISIBLE_GEOMETRY_M2

    out = []
    for bm in bms:
        uv = bm.loops.layers.uv["UVLightmap"]
        bm.faces.index_update()
        faces = set()
        for t in bm.calc_loop_triangles():
            (a, b, c) = (loop[uv].uv for loop in t)
            uv_area = abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
            p, q, r = (loop.vert.co for loop in t)
            if uv_area <= COLLAPSED_UV_AREA and (q - p).cross(r - p).length / 2 >= VISIBLE_GEOMETRY_M2:
                faces.add(t[0].face.index)
        out.append(sorted(faces))
    return out


def _reproject_faces(objs, bms, faces_per_bm):
    """Give each face its own chart: projected onto its own plane at the atlas's mean texel
    density, parked outside the unit square until the next pack."""
    uv_area = mesh_area = 0.0
    for bm in bms:
        uv = bm.loops.layers.uv["UVLightmap"]
        for t in bm.calc_loop_triangles():
            (a, b, c) = (loop[uv].uv for loop in t)
            uv_area += abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2
            p, q, r = (loop.vert.co for loop in t)
            mesh_area += (q - p).cross(r - p).length / 2
    scale = math.sqrt(uv_area / mesh_area) if mesh_area > 0 else 1.0
    n = 0
    for o, bm, faces in zip(objs, bms, faces_per_bm):
        uv = bm.loops.layers.uv["UVLightmap"]
        bm.faces.ensure_lookup_table()
        for index in faces:
            face = bm.faces[index]
            origin = face.verts[0].co
            u = (face.verts[1].co - origin).normalized()
            v = face.normal.cross(u).normalized()
            for loop in face.loops:
                d = loop.vert.co - origin
                loop[uv].uv = Vector((2.0 + 2.0 * n + d.dot(u) * scale, d.dot(v) * scale))
            n += 1
        bmesh.update_edit_mesh(o.data)


def _snap_lightmap(bm, step=None):
    """The `_quantize_uvs` grid, applied to the lightmap layer of an edit-mode bmesh."""
    step = step or LIGHTMAP_UV_STEP
    uv = bm.loops.layers.uv["UVLightmap"]
    for f in bm.faces:
        for loop in f.loops:
            loop[uv].uv = Vector((round(loop[uv].uv.x / step) * step, round(loop[uv].uv.y / step) * step))


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


LIGHTMAP_UV_STEP = 1.0 / 1048576.0  # 2^-20: a long asset's thin slivers keep their area; still 16 ULPs below 1


def _quantize_uvs(me, step=1.0 / 65536.0):
    """Bevel UV interpolation can differ by 1 ULP between runs (threading);
    snapping to a fine grid makes exports byte-reproducible. The lightmap layer uses a finer grid."""
    import numpy as np

    for layer in me.uv_layers:
        grid = LIGHTMAP_UV_STEP if layer.name == "UVLightmap" else step
        buf = np.empty(len(layer.data) * 2, dtype=np.float32)
        layer.data.foreach_get("uv", buf)
        layer.data.foreach_set("uv", (np.round(buf / grid) * grid).astype(np.float32))


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
