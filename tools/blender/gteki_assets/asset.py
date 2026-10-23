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
        self.role = None  # station bake role (contract §10); dressing generators set it
        self.anchor = None  # catalog `anchor` class (contract §10), for the Godot origin check
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

    def _fit_lightmap(self, vis_objs, res, nets, min_density):
        """Lay the lightmap out at `res`, a size up each time the charts do not fit (or, with
        `min_density`, are sparser than that), never past the full tier's largest map."""
        while True:
            try:
                _lightmap_uvs(vis_objs, res, nets, min_density=min_density)
                return res
            except LightmapOverflow as error:
                if self.ao_res_override or res >= ao.RES_FULL[-1]:
                    raise
                print(f"[gteki] {self.id}: AO {res}px: {error}; trying the next size", flush=True)
                res *= 2

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
        if self.role:
            if self.role not in contract.ROLES:
                raise ValueError(f"role {self.role!r} must be one of {contract.ROLES}")
            # custom properties export as node extras: a station reads the root or any VIS_* node
            root["gteki_role"] = self.role
            for o in vis_objs:
                o["gteki_role"] = self.role
        bpy.context.view_layer.update()

        # one shared occlusion map per asset; baked before the colliders exist, so they never occlude
        # a station catalog may pin the size (`ao_res`) when it places many copies of a long piece
        self.ao_res = self.ao_res_override or ao.resolution(_gltf_bounds(vis_objs), mobile)
        # mobile always lays out face nets; full does too when the catalog pins `ao_res`, because Smart UV
        # Project's 5 px margins would eat a small pinned atlas. A pinned full asset keeps the Smart UV
        # layout as its reference and is only switched to the face nets when they are no worse.
        nets = mobile or bool(self.ao_res_override)
        reference = _lightmap_reference(vis_objs, self.ao_res, bool(self.ao_res_override)) if nets else None
        # the face nets must at least match the old layout's density; they need not reach a fixed
        # px/m, or a small asset would grow its map and then fall back to the worse old layout
        minimum = reference[1] - 0.001 if reference and not self.ao_res_override else 0.0
        use_reference = False
        try:
            self.ao_res = self._fit_lightmap(vis_objs, self.ao_res, nets, minimum)
        except LightmapOverflow:
            if reference is None:
                raise
            use_reference = True
        except RuntimeError as error:
            if reference is not None:
                use_reference = True
            elif nets:
                raise
            else:
                # Smart UV Project can leave charts folded over each other after every repair
                # (a narrow, finely bevelled escalator): only then does full use the face nets
                print(f"[gteki] {self.id}: {error}; laying the lightmap out as face nets", flush=True)
                _drop_lightmap(vis_objs)
                self.ao_res = self._fit_lightmap(vis_objs, self.ao_res, True, 0.0)
        if reference:
            use_reference |= self.ao_res > reference[0]
            if not use_reference:
                quality = _object_lightmap_density(vis_objs, self.ao_res, with_metrics=True)
                prior = reference[3]
                # island count guards mobile's single joined body against fragmentation; full keeps
                # its parts as separate meshes, where the nets add islands but gain density and fill
                use_reference = (quality[0] + 0.001 < prior[0] or quality[1] + 1e-5 < prior[1]
                                 or (mobile and quality[2] > prior[2]))
            if bpy.context.mode != "OBJECT":
                bpy.ops.object.mode_set(mode="OBJECT")
            for obj, mesh in reference[2]:
                if use_reference:
                    current, name = obj.data, obj.data.name
                    obj.data = mesh
                    bpy.data.meshes.remove(current)
                    mesh.name = name
                else:
                    bpy.data.meshes.remove(mesh)
            if use_reference:
                self.ao_res = reference[0]
                print(f"[gteki] {self.id}: retaining the legacy lightmap to preserve atlas quality and map size", flush=True)
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
            **({"anchor": self.anchor} if self.anchor else {}),
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
        entry = {
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
        if self.role:  # keeps the manifest of role-less assets byte-identical
            entry["gteki_role"] = self.role
        if self.anchor:  # likewise for assets without an anchor class
            entry["anchor"] = self.anchor
        return entry


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


def _lightmap_uvs(objs, res, mobile=False, min_density=0.0):
    """Non-overlapping lightmap UVs in a second layer (exported as TEXCOORD_1), laid out jointly
    for every visual object: one atlas, because the asset's occlusion map is shared by all of
    them. Mobile conformal face nets keep connected pieces together without projecting their
    side faces edge-on; full keeps its original Smart UV Project layout."""
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
        _unwrap_lightmap(objs, margin, mobile, min_density)
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


def _unwrap_lightmap(objs, margin, mobile=False, min_density=0.0):
    if mobile:
        bms = [bmesh.from_edit_mesh(o.data) for o in objs]
        max_span = math.sqrt(2 * sum(f.calc_area() for bm in bms for f in bm.faces))
        for o, bm in zip(objs, bms):
            _lightmap_seams(bm, max_span)
            bmesh.update_edit_mesh(o.data)
        bpy.ops.uv.unwrap(method="CONFORMAL", fill_holes=False, correct_aspect=True, margin=0.0)
        bpy.ops.uv.average_islands_scale()
    else:
        bpy.ops.uv.smart_project(angle_limit=math.radians(66), island_margin=0.0, area_weight=0.0,
                                 correct_aspect=True, scale_to_bounds=False)
    _pack(objs, margin, mobile)
    _separate_overlaps(objs, margin, mobile=mobile)  # the layers are invalid once in edit mode
    if min_density:
        median = _lightmap_density([bmesh.from_edit_mesh(o.data) for o in objs], ao.MARGIN_PX / margin)
        if median < min_density:
            raise LightmapOverflow(f"lightmap density p50 {median:.2f} px/m is below {min_density:g} px/m")


def _lightmap_density(bms, res, with_metrics=False):
    from validate_glb import _area, VISIBLE_GEOMETRY_M2

    samples, parents, seen = [], [], {}
    fill, islands = 0.0, 0

    def root(i):
        while parents[i] != i:
            parents[i] = parents[parents[i]]
            i = parents[i]
        return i

    for bi, bm in enumerate(bms):
        uv = bm.loops.layers.uv["UVLightmap"]
        for tri in bm.calc_loop_triangles():
            coords = tuple(tuple(loop[uv].uv) for loop in tri)
            uv_area = abs(_area(coords))
            fill += uv_area
            if with_metrics:
                index = len(parents)
                parents.append(index)
                islands += 1
                for k in range(3):
                    key = bi, tuple(sorted((coords[k], coords[(k + 1) % 3])))
                    if key in seen:
                        a, b = root(index), root(seen[key])
                        if a != b:
                            parents[a] = b
                            islands -= 1
                    else:
                        seen[key] = index
            p, q, r = (loop.vert.co for loop in tri)
            area = (q - p).cross(r - p).length / 2
            if area >= VISIBLE_GEOMETRY_M2:
                samples.append((res * math.sqrt(uv_area / area), area))
    halfway = sum(area for _, area in samples) / 2
    covered, median = 0.0, 0.0
    for median, area in sorted(samples):
        covered += area
        if covered >= halfway:
            break
    return (median, fill, islands) if with_metrics else median


def _object_lightmap_density(objs, res, with_metrics=False):
    bms = []
    try:
        for obj in objs:
            bm = bmesh.new()
            bm.from_mesh(obj.data)
            bms.append(bm)
        return _lightmap_density(bms, res, with_metrics)
    finally:
        for bm in bms:
            bm.free()


def _lightmap_reference(objs, res, fixed):
    """Measure the old mobile layout on disposable meshes, without baking or changing UV0."""
    originals = [(obj, obj.data) for obj in objs]
    copies = [(obj, obj.data.copy()) for obj in objs]
    keep = False
    try:
        for obj, mesh in copies:
            obj.data = mesh
        while True:
            try:
                _lightmap_uvs(objs, res)
                break
            except LightmapOverflow:
                if fixed or res >= ao.RES_FULL[-1]:
                    return None
                res *= 2
        quality = _object_lightmap_density(objs, res, with_metrics=True)
        keep = True
        return res, quality[0], copies, quality
    except RuntimeError:  # an invalid legacy unwrap must not prevent a repaired mobile build
        return None
    finally:
        if bpy.context.mode != "OBJECT":
            bpy.ops.object.mode_set(mode="OBJECT")
        for obj, mesh in originals:
            obj.data = mesh
        if not keep:
            for _, mesh in copies:
                bpy.data.meshes.remove(mesh)


def _lightmap_seams(bm, max_span):
    """Grow non-overlapping face nets, keeping long, flat connections first."""
    import heapq
    from validate_glb import _area, _clip

    bm.faces.index_update()
    bm.edges.index_update()
    bm.faces.ensure_lookup_table()
    bm.edges.ensure_lookup_table()
    triangles = [[] for _ in bm.faces]
    for tri in bm.calc_loop_triangles():
        triangles[tri[0].face.index].append(tri)
    remaining = set(bm.faces)
    for edge in bm.edges:
        edge.seam = True

    def project(face, edge, a, b):
        p, q = (v.co for v in edge.verts)
        u = (q - p).normalized()
        v = face.normal.cross(u).normalized()
        x = (b - a).normalized()
        y = Vector((-x.y, x.x))
        coords = {}
        for loop in face.loops:
            d = loop.vert.co - p
            coords[loop] = a + x * d.dot(u) + y * d.dot(v)
            if loop.vert == edge.verts[0]:
                coords[loop] = a.copy()
            elif loop.vert == edge.verts[1]:
                coords[loop] = b.copy()
        return coords

    for seed in sorted(bm.faces, key=lambda f: (-round(f.calc_area(), 6), f.index)):
        if seed not in remaining:
            continue
        edge = max(seed.edges, key=lambda e: (round(e.calc_length(), 6), -e.index))
        pending = [(0, 0, edge.index, seed.index, None)]
        coords, occupied = {}, []
        area, bounds = 0.0, None
        while pending:
            _, _, ei, fi, parent = heapq.heappop(pending)
            face = bm.faces[fi]
            if face not in remaining:
                continue
            edge = bm.edges[ei]
            if parent is None:
                a, b = Vector((0.0, 0.0)), Vector((edge.calc_length(), 0.0))
            else:
                loops = {loop.vert: loop for loop in bm.faces[parent].loops}
                a, b = (coords[loops[v]] for v in edge.verts)
            candidate = project(face, edge, a, b)
            tris = [tuple(tuple(candidate[loop]) for loop in tri) for tri in triangles[fi]]
            tris = [tri if _area(tri) >= 0 else tri[::-1] for tri in tris]
            boxes = [(min(p[0] for p in tri), min(p[1] for p in tri),
                      max(p[0] for p in tri), max(p[1] for p in tri)) for tri in tris]
            new_area = area + sum(abs(_area(tri)) for tri in tris)
            all_boxes = boxes + ([bounds] if bounds else [])
            box = (min(b[0] for b in all_boxes), min(b[1] for b in all_boxes),
                   max(b[2] for b in all_boxes), max(b[3] for b in all_boxes))
            # Bent tube strips can enclose enormous empty regions. Cut those nets before
            # their gutters consume the atlas; ordinary box nets stay connected.
            if parent is not None and new_area < 0.35 * (box[2] - box[0]) * (box[3] - box[1]):
                continue
            # A dense but very long rim can set the scale of the entire square atlas.
            if parent is not None and max(box[2] - box[0], box[3] - box[1]) > max_span:
                continue
            if any(x[0] < y[2] and y[0] < x[2] and x[1] < y[3] and y[1] < x[3]
                   and abs(_area(_clip(t, s))) > 1e-9
                   for t, x in zip(tris, boxes) for s, y in occupied):
                continue
            remaining.remove(face)
            coords.update(candidate)
            occupied.extend(zip(tris, boxes))
            area, bounds = new_area, box
            if parent is not None:
                edge.seam = False
            for e in face.edges:
                if not e.is_manifold:
                    continue
                other = next(f for f in e.link_faces if f != face)
                if other in remaining:
                    heapq.heappush(pending, (-round(face.normal.dot(other.normal), 5),
                                            -round(e.calc_length(), 6), e.index, other.index, fi))


def _drop_lightmap(objs):
    """Undo a failed lightmap layout so it can be laid out again."""
    if bpy.context.mode != "OBJECT":
        bpy.ops.object.mode_set(mode="OBJECT")
    for o in objs:
        layer = o.data.uv_layers.get("UVLightmap")
        if layer:
            o.data.uv_layers.remove(layer)
        o.data.uv_layers.active = o.data.uv_layers[0]


class LightmapOverflow(RuntimeError):
    """The map cannot fit the charts with the requested margin or texel density."""


def _pack(objs, margin, mobile=False):
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.uv.select_all(action="SELECT")
    if not mobile:
        bpy.ops.uv.pack_islands(rotate=False, margin=margin, margin_method="FRACTION")
        return
    # FRACTION pads both islands: half the requested gap on each boundary.
    bpy.ops.uv.pack_islands(rotate=True, rotate_method="ANY", shape_method="AABB",
                           margin=margin / 2, margin_method="FRACTION")
    _pack_rectangles(objs, margin)


def _pack_rectangles(objs, margin):
    """Improve on Blender's placement when padded chart rectangles can fit at a larger scale."""
    from .uvpack import pack_rectangles

    charts = []
    for o in sorted(objs, key=lambda o: o.name):
        bm = bmesh.from_edit_mesh(o.data)
        bm.faces.index_update()
        bm.edges.index_update()
        uv = bm.loops.layers.uv["UVLightmap"]
        parents, seen = list(range(len(bm.faces))), {}

        def root(i):
            while parents[i] != i:
                parents[i] = parents[parents[i]]
                i = parents[i]
            return i

        for face in bm.faces:
            for loop in face.loops:
                a, b = tuple(loop[uv].uv), tuple(loop.link_loop_next[uv].uv)
                if loop.vert != loop.edge.verts[0]:
                    a, b = b, a
                key = loop.edge.index, a, b
                if key in seen:
                    parents[root(face.index)] = root(seen[key])
                else:
                    seen[key] = face.index
        groups = {}
        for face in bm.faces:
            groups.setdefault(root(face.index), []).extend(face.loops)
        for index in sorted(groups):
            loops = groups[index]
            x, y = (min(loop[uv].uv[k] for loop in loops) for k in (0, 1))
            w, h = (max(loop[uv].uv[k] for loop in loops) - low for k, low in ((0, x), (1, y)))
            charts.append((uv, loops, x, y, w, h))
    scale, placements = pack_rectangles([(c[4], c[5]) for c in charts], margin)
    if scale <= 1.0001:  # retain Blender's layout unless rectangle placement increases fill
        return
    for index, x, y, rotate in placements:
        uv, loops, lx, ly, w, h = charts[index]
        for loop in loops:
            u, v = loop[uv].uv.x - lx, loop[uv].uv.y - ly
            if rotate:
                u, v = v, w - u
            loop[uv].uv = (x + u * scale, y + v * scale)
    for o in objs:
        bmesh.update_edit_mesh(o.data)


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


def _separate_overlaps(objs, margin, attempts=4, mobile=False):
    """Unwrapping or quantization can fold a chart over itself. Detach every face that overlaps another
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
            _pack(objs, margin, mobile)
            continue
        outside = any(not -1e-6 <= c <= 1 + 1e-6 for bm in bms for f in bm.faces
                      for loop in f.loops for c in loop[bm.loops.layers.uv["UVLightmap"]].uv)
        if not any(bad) and not outside and not any(collapsed):
            return
        if attempt == attempts:
            break
        if not any(bad):  # a repack left charts parked outside the unit square: pack again
            _pack(objs, margin, mobile)
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
        _pack(objs, margin, mobile)
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
