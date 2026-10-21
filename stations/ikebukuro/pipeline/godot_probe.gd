# Godot upgrade-path probe: headless glTF import of the station GLB; prints roles (extras), UV2, tris.
# Usage: copy the GLB next to a minimal project.godot, then: godot --headless --path <dir> -s godot_probe.gd
extends SceneTree

func _init():
	var path = "res://ikebukuro_b1_lit.glb"
	var doc = GLTFDocument.new()
	var state = GLTFState.new()
	var err = doc.append_from_file(ProjectSettings.globalize_path(path), state)
	if err != OK:
		print("PROBE_FAIL append ", err)
		quit(1)
		return
	var root = doc.generate_scene(state)
	var out = {"meshes": [], "nodes": state.get_nodes().size()}
	for n in root.find_children("*", "MeshInstance3D", true, false):
		var mi: MeshInstance3D = n
		var m = mi.mesh
		var arrays = m.surface_get_arrays(0)
		var has_uv2 = arrays[Mesh.ARRAY_TEX_UV2] != null and arrays[Mesh.ARRAY_TEX_UV2].size() > 0
		var tris = 0
		for s in m.get_surface_count():
			var a = m.surface_get_arrays(s)
			var idx = a[Mesh.ARRAY_INDEX]
			tris += (idx.size() if idx != null else a[Mesh.ARRAY_VERTEX].size()) / 3
		out["meshes"].append({"name": mi.name, "extras": mi.get_meta("extras", null), "uv2": has_uv2, "tris": tris, "aabb": str(mi.get_aabb())})
	print("PROBE ", JSON.stringify(out))
	quit(0)
