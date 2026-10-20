"""Build the interior GLB; run with Blender --background --factory-startup.

blender -b --factory-startup --python blender_build_glb.py -- input.json output.glb
ENU metres stay unchanged in Blender. Only the glTF exporter changes axes.
"""
import json
import math
import sys
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

import bmesh
import bpy
from mathutils import Vector

ROLES = {
    "FloorSurface": "floor", "InteriorWallSurface": "wall",
    "CeilingSurface": "ceiling", "ClosureSurface": "portals",
    "EF_35": "stairs_ramps", "EF_80": "transport", "EF_25": "barriers",
    "EF_30": "floor_elements", "Door": "doors", "Window": "windows",
}
COLORS = {
    "floor": (0.65, 0.62, 0.57, 1), "wall": (0.83, 0.81, 0.76, 1),
    "ceiling": (0.72, 0.74, 0.75, 1), "stairs_ramps": (0.40, 0.42, 0.44, 1),
    "transport": (0.18, 0.20, 0.23, 1), "barriers": (0.65, 0.67, 0.69, 1),
    "floor_elements": (0.52, 0.50, 0.46, 1), "doors": (0.45, 0.40, 0.34, 1),
    "windows": (0.45, 0.63, 0.70, 1), "portals": (1, 0, 1, 0.5),
}
AREA_EPS = 1e-10  # square metres; substantially below a 1 mm square
ATTRIBUTION = ("Contains PLATEAU data (MLIT), CC BY 4.0. Modified: reprojected "
               "to a local ENU frame, triangulated and re-encoded as glTF by GTEki.")


def area_vector(ring):
    # Subtract in Python double precision before constructing float32 Vectors.
    origin = ring[0]
    local = [Vector(tuple(p[i] - origin[i] for i in range(3))) for p in ring]
    return sum((p.cross(q) for p, q in zip(local, local[1:] + local[:1])), Vector()) / 2


def area2(ring):
    return sum(p.x * q.y - q.x * p.y for p, q in zip(ring, ring[1:] + ring[:1])) / 2


def inside(p, ring):
    result = False
    for a, b in zip(ring, ring[1:] + ring[:1]):
        if (a.y > p.y) != (b.y > p.y):
            if p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x:
                result = not result
    return result


def triangulate(poly, stats, role):
    """Fill planar ring edges, checking hole coverage, area and boundary topology."""
    stats["input_polygons"] += 1
    stats["polygons_with_holes"] += bool(poly["holes"])
    rings = []
    for i, raw in enumerate([poly["outer"]] + poly["holes"]):
        ring = []
        for point in raw:
            if len(point) != 3 or not all(math.isfinite(v) for v in point):
                raise ValueError("non-finite or non-3D coordinate")
            if not ring or point != ring[-1]:
                ring.append(point)
        if len(ring) > 1 and ring[0] == ring[-1]:
            ring.pop()
        if len({tuple(p) for p in ring}) < 3 or area_vector(ring).length <= AREA_EPS:
            stats["degenerate_rings"] += 1
            print(f"DEGENERATE {role} {poly['id']} ring={i}", flush=True)
            if i == 0:
                stats["degenerate_polygons"] += 1
                return [], []
            continue
        rings.append(ring)
    if len(rings) == 1 and len(rings[0]) == 3:
        return rings[0], [(0, 1, 2)]

    origin = rings[0][0]
    normal = area_vector(rings[0]).normalized()
    reference = Vector((0, 0, 1) if abs(normal.z) < 0.9 else (1, 0, 0))
    u = reference.cross(normal).normalized()
    v = normal.cross(u)
    projected = []
    for ring in rings:
        points = [Vector(tuple(p[i] - origin[i] for i in range(3))) for p in ring]
        projected.append([Vector((p.dot(u), p.dot(v), 0)) for p in points])
    expected_area = abs(area2(projected[0])) - sum(abs(area2(r)) for r in projected[1:])
    if expected_area <= AREA_EPS:
        raise ValueError("holes consume the exterior area")

    bm = bmesh.new()
    try:
        coords, edges, boundary, indices = [], [], Counter(), {}
        for ri, ring in enumerate(projected):
            order = list(range(len(ring)))
            if (area2(ring) > 0) != (ri == 0):
                order.reverse()
            verts = []
            for j in order:
                vert = bm.verts.new(ring[j])
                indices[vert] = len(coords)
                coords.append(rings[ri][j])
                verts.append(vert)
            for a, b in zip(verts, verts[1:] + verts[:1]):
                edges.append(bm.edges.new((a, b)))
                boundary[tuple(sorted((indices[a], indices[b])))] += 1
        bmesh.ops.triangle_fill(bm, edges=edges, normal=Vector((0, 0, 1)), use_beauty=True)
        triangles, used_edges, filled_area = [], Counter(), 0.0
        for face in bm.faces:
            verts = list(face.verts)
            if len(verts) != 3 or face.calc_area() <= AREA_EPS:
                raise ValueError("fill produced a non-triangle or zero-area face")
            center = sum((p.co for p in verts), Vector()) / 3
            if not inside(center, projected[0]) or any(inside(center, r) for r in projected[1:]):
                raise ValueError("fill crossed the exterior or covered a hole")
            if (verts[1].co - verts[0].co).cross(verts[2].co - verts[0].co).z < 0:
                verts.reverse()
            tri = tuple(indices[p] for p in verts)
            triangles.append(tri)
            filled_area += face.calc_area()
            used_edges.update(tuple(sorted(e)) for e in zip(tri, tri[1:] + tri[:1]))
        if not math.isclose(filled_area, expected_area, rel_tol=2e-5, abs_tol=1e-7):
            raise ValueError(f"fill area mismatch: {filled_area} != {expected_area}")
        if any(n > 2 for n in used_edges.values()) or Counter({e: n for e, n in used_edges.items() if n == 1}) != boundary:
            raise ValueError("fill boundary mismatch (missing ring edge or overlapping faces)")
        return coords, triangles
    finally:
        bm.free()


def build_mesh(role, polygons):
    stats = dict.fromkeys(("input_polygons", "polygons_with_holes", "degenerate_rings",
                           "degenerate_polygons", "triangulation_failures"), 0)
    stats["failure_polygons"] = []
    coords, faces, lookup = [], [], {}
    for poly in polygons:
        try:
            points, triangles = triangulate(poly, stats, role)
        except (ValueError, RuntimeError) as error:
            stats["triangulation_failures"] += 1
            stats["failure_polygons"].append({"id": poly["id"], "reason": str(error)})
            print(f"FAILED {role} {poly['id']}: {error}", flush=True)
            continue
        local = []
        for point in points:
            key = tuple(point)
            if key not in lookup:
                lookup[key] = len(coords)
                coords.append(key)
            local.append(lookup[key])
        faces.extend(tuple(local[i] for i in tri) for tri in triangles)
    mesh = bpy.data.meshes.new(role)
    mesh.from_pydata(coords, [], faces)
    bm = bmesh.new()
    try:
        bm.from_mesh(mesh)
        before_vertices, before_faces = len(bm.verts), len(bm.faces)
        bmesh.ops.remove_doubles(bm, verts=list(bm.verts), dist=0.001)
        dead = [f for f in bm.faces if f.calc_area() <= AREA_EPS]
        bmesh.ops.delete(bm, geom=dead, context="FACES_ONLY")
        unused = [v for v in bm.verts if not v.link_faces]
        bmesh.ops.delete(bm, geom=unused, context="VERTS")
        stats["vertices_merged_or_unused"] = before_vertices - len(bm.verts)
        stats["faces_removed_by_merge"] = before_faces - len(bm.faces)
        print(f"MERGE {role}: {stats['vertices_merged_or_unused']} vertices, "
              f"{stats['faces_removed_by_merge']} faces removed", flush=True)
        bm.normal_update()
        orientation = None
        if role in ("floor", "ceiling"):
            sign = 1 if role == "floor" else -1
            count = sum(f.normal.z * sign > 0 for f in bm.faces)
            fraction = count / len(bm.faces) if bm.faces else None
            inverted = sum(f.normal.z * sign < 0 for f in bm.faces)
            flip = inverted > len(bm.faces) / 2
            if flip:
                bmesh.ops.reverse_faces(bm, faces=list(bm.faces))
                bm.normal_update()
                print(f"FLIPPED {role}: predominantly inverted", flush=True)
            after = sum(f.normal.z * sign > 0 for f in bm.faces)
            orientation = {"expected": "z > 0" if sign == 1 else "z < 0",
                           "before_fraction": fraction, "before_inverted_triangles": inverted,
                           "flipped": flip,
                           "after_fraction": after / len(bm.faces) if bm.faces else None,
                           "matching_triangles": after, "total_triangles": len(bm.faces)}
            print(f"NORMALS {role}: {orientation}", flush=True)
        uv = bm.loops.layers.uv.new("UVMap")
        for face in bm.faces:
            face.smooth = False  # Flat normals preserve architectural corners in glTF.
            n = face.normal
            horizontal = role in ("floor", "ceiling") or abs(n.z) >= max(abs(n.x), abs(n.y))
            tangent = Vector((-n.y, n.x, 0)).normalized() if not horizontal else None
            for loop in face.loops:
                p = loop.vert.co
                loop[uv].uv = (p.x, p.y) if horizontal else (p.dot(tangent), p.z)
        for edge in bm.edges:
            edge.smooth = edge.is_manifold and edge.calc_face_angle() <= math.radians(30)
        bm.to_mesh(mesh)
    finally:
        bm.free()
    mesh.update()
    obj = bpy.data.objects.new(role, mesh)
    bpy.context.collection.objects.link(obj)
    obj["gteki_role"] = role
    if role in ("portals", "doors", "windows"):
        obj["gteki_render"] = False
    mat = bpy.data.materials.new("mat_" + role)
    mat.diffuse_color = COLORS[role]
    if mat.node_tree is None:
        mat.use_nodes = True
    if role == "portals" and hasattr(mat, "blend_method"):  # Blender 4.0/4.1
        mat.blend_method = "BLEND"
    bsdf = mat.node_tree.nodes.get("Principled BSDF")
    bsdf.inputs["Base Color"].default_value = COLORS[role]
    bsdf.inputs["Alpha"].default_value = COLORS[role][3]
    bsdf.inputs["Roughness"].default_value = 0.8 if role != "transport" else 0.35
    bsdf.inputs["Metallic"].default_value = 0.75 if role == "transport" else 0.0
    mesh.materials.append(mat)
    xyz = [v.co for v in mesh.vertices]
    stats.update(vertices=len(xyz), triangles=len(mesh.polygons),
                 bbox_enu={"min": [min(p[i] for p in xyz) for i in range(3)],
                           "max": [max(p[i] for p in xyz) for i in range(3)]} if xyz else None)
    areas, lengths = [], []
    for face in mesh.polygons:
        pts = [mesh.vertices[i].co for i in face.vertices]
        areas.append(face.area)
        lengths.append(max((a - b).length for a, b in zip(pts, pts[1:] + pts[:1])))
    stats.update(max_triangle_area_m2=max(areas, default=0),
                 max_triangle_edge_m=max(lengths, default=0),
                 triangles_over_100_m2=sum(a > 100 for a in areas),
                 triangles_with_edge_over_50_m=sum(e > 50 for e in lengths))
    return stats, orientation


def main(src, dst):
    source, output = Path(src), Path(dst)
    data = json.loads(source.read_text())
    if data["schema"] != "gteki.plateau-ubld-extract/0":
        raise ValueError("unsupported extract schema")
    grouped = {role: [] for role in COLORS}
    for room in data["rooms"]:
        for surface in room["surfaces"] + room["openings"]:
            grouped[ROLES[surface["type"]]].extend(surface["polygons"])
    for installation in data["installations"]:
        grouped[ROLES[installation["function"]]].extend(installation["polygons"])
    # Exterior shell deliberately never enters grouped.
    for obj in list(bpy.data.objects):
        bpy.data.objects.remove(obj, do_unlink=True)
    for mat in list(bpy.data.materials):
        bpy.data.materials.remove(mat)
    meta = {"source": data["source"], "frame": data["frame"],
            "axis_mapping": {"blender": {"x": "east", "y": "north", "z": "height (TP)"},
                             "gltf": {"x": "east", "y": "height (TP)", "z": "-north"},
                             "enu_to_gltf": ["x", "z", "-y"], "units": "metres"},
            "vertex_count_basis": "Blender mesh after 1 mm merge; glTF splits at UV/normal seams",
            "categories": {}, "normal_orientation": {}, "blender_version": bpy.app.version_string,
            "attribution": ATTRIBUTION}
    for role, polygons in grouped.items():
        stats, orientation = build_mesh(role, polygons)
        meta["categories"][role] = stats
        if orientation is not None:
            meta["normal_orientation"][role] = orientation
    output.parent.mkdir(parents=True, exist_ok=True)
    options = dict(filepath=str(output.resolve()), export_format="GLB", export_extras=True,
                   export_yup=True, export_apply=True, export_draco_mesh_compression_enable=False)
    if "export_meshopt_compression_enable" in bpy.ops.export_scene.gltf.get_rna_type().properties:
        options["export_meshopt_compression_enable"] = False
    result = bpy.ops.export_scene.gltf(**options)
    if result != {"FINISHED"}:
        raise RuntimeError(f"glTF export failed: {result}")
    meta["triangulation_failures"] = sum(s["triangulation_failures"] for s in meta["categories"].values())
    meta["build_timestamp_utc"] = datetime.now(timezone.utc).isoformat()
    output.with_suffix(".meta.json").write_text(json.dumps(meta, indent=2) + "\n")
    print(f"{'category':16} {'triangles':>10} {'vertices':>10} {'failed':>8} {'degen':>8}")
    for role, stats in meta["categories"].items():
        print(f"{role:16} {stats['triangles']:10,d} {stats['vertices']:10,d} "
              f"{stats['triangulation_failures']:8d} {stats['degenerate_rings']:8d}")
    print(f"GLB: {output.stat().st_size:,} bytes ({output.stat().st_size / 1048576:.2f} MiB)")


if __name__ == "__main__":
    try:
        args = sys.argv[sys.argv.index("--") + 1:]
        if len(args) != 2:
            raise ValueError("expected: -- input.json output.glb")
        main(*args)
    except Exception:
        import traceback
        traceback.print_exc()
        sys.stdout.flush()
        sys.stderr.flush()
        # Blender otherwise exits successfully after an uncaught script exception.
        import os
        os._exit(1)
