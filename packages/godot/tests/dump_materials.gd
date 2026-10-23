extends SceneTree
## Lists a snapshot GLB's distinct surface materials with usage evidence: surface count, sample meshes and roles.
## Used to derive `looks/materials.json` (the snapshot loses the scene's own material names); read-only.
## Usage: godot --headless --path packages/godot --script res://tests/dump_materials.gd -- <scene.glb>

func _init() -> void:
	var args := OS.get_cmdline_user_args()
	if args.is_empty():
		push_error("usage: dump_materials.gd -- <scene.glb>")
		quit(1)
		return
	var doc := GLTFDocument.new()
	var state := GLTFState.new()
	var err := doc.append_from_file(args[0], state)
	if err != OK:
		push_error("load failed: %s" % error_string(err))
		quit(1)
		return
	var scene := doc.generate_scene(state)
	var found := {}
	_walk(scene, found)
	var rows := found.values()
	rows.sort_custom(func(a, b): return a.n > b.n)
	for row in rows:
		print("%-22s sRGB=#%s metal=%.2f rough=%.2f surfaces=%-5d meshes=%s roles=%s" % [row.name, row.color, row.metal, row.rough, row.n, str(row.meshes), str(row.roles)])
	print("distinct materials: %d, surfaces: %d" % [rows.size(), rows.reduce(func(sum, row): return sum + row.n, 0)])
	quit(0)


func _walk(node: Node, found: Dictionary) -> void:
	if node is MeshInstance3D and node.mesh != null:
		var extras: Variant = node.get_meta("extras", {})
		var role := ""
		if extras is Dictionary:
			role = str(extras.get("gteki_role", ""))
		for i in range(node.mesh.get_surface_count()):
			var material: Variant = node.get_active_material(i)
			if not material is BaseMaterial3D:
				continue
			var name := str(material.resource_name)
			if name.is_empty():
				name = "(unnamed)"
			if not found.has(name):
				found[name] = {
					"name": name,
					"color": material.albedo_color.to_html(false),
					"metal": material.metallic,
					"rough": material.roughness,
					"n": 0,
					"meshes": [],
					"roles": {},
				}
			var row: Dictionary = found[name]
			row.n += 1
			if row.meshes.size() < 3 and not str(node.name) in row.meshes:
				row.meshes.append(str(node.name))
			row.roles[role] = int(row.roles.get(role, 0)) + 1
	for child in node.get_children():
		_walk(child, found)
