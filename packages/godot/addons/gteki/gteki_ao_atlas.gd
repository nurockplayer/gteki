extends RefCounted
## Applies the kit's shared AO atlases to the snapshot (Lane E #391 of #164), mirroring the web loader.
##
## Web side: one atlas per kind (`kit/catalog/<tier>/atlas/<kind>_ao.png`), an 8-bit grey PNG with AO in the R
## channel, linear data (not sRGB), unused texels 255. The loader puts it on `material.aoMap` with `channel = 1`
## (TEXCOORD_1, which glTF keeps and Godot imports as UV2), `flipY = false` and `colorSpace = NoColorSpace`; all
## meshes of one kind share one material, and the texture carries `userData.gteki_uri` / `userData.gteki_atlas_kind`.
##
## Here: textures are stripped from the snapshot, so the exporter records the material slots that carried an atlas in
## each mesh's extras `gteki_ao_atlas_surfaces` ({ "<surface index>": "<kind>" }) and describes each kind once in the
## sidecar `ao_atlas_bindings` block (URI, sha256, channel, colour space, flipY, counts). Each kind's PNG is read raw
## (`Image.load_from_file` does not convert colour spaces), its sha256 is checked against the sidecar, and one
## `ImageTexture` per kind is shared by every surface bound to it. Every flagged surface gets a duplicate of the
## snapshot material with `ao_enabled`, `ao_texture`, `ao_on_uv2` and `ao_texture_channel = TEXTURE_CHANNEL_RED`;
## `ao_light_affect` keeps Godot's default. Unflagged surfaces and the shared snapshot material are never mutated.

const Bridge = preload("res://addons/gteki/gteki_bridge.gd")

## The atlas samples TEXCOORD_1, which glTF keeps and Godot imports as UV2.
const REQUIRED_CHANNEL := 1
const FLAG := "gteki_ao_atlas_surfaces"

var issues: Array[String] = []
var meshes := 0
var surfaces := 0
## kind → the one Texture2D every surface of that kind uses.
var textures: Dictionary = {}
## kind → absolute atlas path and size, for diagnostics and the headless check.
var texture_paths: Dictionary = {}
var texture_sizes: Dictionary = {}
## [snapshot material, kind] → the AO copy every surface with that pair shares.
var materials: Dictionary = {}


## Applies `block` (the sidecar's `ao_atlas_bindings`) to the meshes flagged in their extras. `station_dir` overrides
## the station folder (the headless test's temp atlas); empty means <repo>/stations/<station_id>/gteki. Returns true
## when every flagged surface was converted; any miss is an issue (a partial atlas would misrepresent the kit).
func apply(root: Node3D, block: Dictionary, station_id: String, station_dir := "") -> bool:
	issues.clear()
	meshes = 0
	surfaces = 0
	textures.clear()
	texture_paths.clear()
	texture_sizes.clear()
	materials.clear()
	if block.is_empty():
		issues.append("AO atlas block is empty")
		return false
	var base_dir := station_dir
	if base_dir.is_empty():
		var repo_root := Bridge.find_repo_root()
		if repo_root.is_empty():
			issues.append("Cannot find the repository root (pnpm-workspace.yaml) above %s" % ProjectSettings.globalize_path("res://"))
			return false
		base_dir = repo_root.path_join("stations").path_join(station_id).path_join("gteki")
	var missing := {}
	for kind in block.keys():
		var name := str(kind)
		var entry: Variant = block[kind]
		if not entry is Dictionary:
			issues.append("AO atlas %s is not a dictionary" % name)
			missing[name] = true
			continue
		var uri := str(entry.get("uri", ""))
		var want_sha := str(entry.get("sha256", ""))
		if int(entry.get("channel", -1)) != REQUIRED_CHANNEL:
			issues.append("AO atlas %s uses channel %s; only channel 1 (TEXCOORD_1 → UV2) can be applied" % [name, str(entry.get("channel"))])
			missing[name] = true
			continue
		if uri.is_empty() or want_sha.is_empty():
			issues.append("AO atlas %s lacks a texture URI or a sha256" % name)
			missing[name] = true
			continue
		var path := base_dir.path_join(uri)
		if not FileAccess.file_exists(path):
			issues.append("Missing AO atlas %s (%s)" % [name, path])
			missing[name] = true
			continue
		var actual_sha := FileAccess.get_sha256(path)
		if actual_sha != want_sha:
			issues.append("AO atlas %s sha256 %s does not match the sidecar %s" % [name, actual_sha, want_sha])
			missing[name] = true
			continue
		var image: Image = Image.load_from_file(path)
		if image == null or image.is_empty():
			issues.append("Cannot decode AO atlas %s (%s)" % [name, path])
			missing[name] = true
			continue
		# Mipmapped like the web's texture, so the atlas does not shimmer at a distance (unused texels are 255, so mip
		# bleed across cell edges can only lighten).
		if not image.has_mipmaps():
			image.generate_mipmaps()
		textures[name] = ImageTexture.create_from_image(image)
		texture_paths[name] = path
		texture_sizes[name] = image.get_size()
	_visit(root, missing)
	return issues.is_empty()


func _visit(node: Node, missing: Dictionary) -> void:
	if node is MeshInstance3D:
		var extras: Variant = node.get_meta("extras", {})
		if extras is Dictionary and extras.has(FLAG):
			_apply_mesh(node, extras[FLAG], missing)
	for child in node.get_children():
		_visit(child, missing)


func _apply_mesh(mesh: MeshInstance3D, flagged: Variant, missing: Dictionary) -> void:
	if mesh.mesh == null:
		issues.append("AO-flagged mesh %s has no mesh" % mesh.name)
		return
	if not flagged is Dictionary:
		issues.append("AO-flagged mesh %s has a malformed %s" % [mesh.name, FLAG])
		return
	var converted := 0
	for key in flagged.keys():
		var kind := str(flagged[key])
		if not textures.has(kind):
			# A failed atlas was already reported; only a kind the sidecar never described is new.
			if not missing.has(kind):
				issues.append("AO-flagged mesh %s references unknown atlas kind %s" % [mesh.name, kind])
				missing[kind] = true
			continue
		var index := int(key)
		if index < 0 or index >= mesh.mesh.get_surface_count():
			issues.append("AO-flagged mesh %s has no surface %d" % [mesh.name, index])
			continue
		if (mesh.mesh.surface_get_format(index) & Mesh.ARRAY_FORMAT_TEX_UV2) == 0:
			issues.append("AO-flagged surface %s/%d has no UV2 (TEXCOORD_1 was dropped)" % [mesh.name, index])
			continue
		var source: Material = mesh.get_active_material(index)
		if not source is BaseMaterial3D:
			issues.append("AO-flagged surface %s/%d material %s is not a BaseMaterial3D" % [mesh.name, index, str(source)])
			continue
		# One AO copy per (snapshot material, kind), shared like the web's one material per kind, so surfaces that
		# shared a material still share one and can batch.
		var cache_key := [source, kind]
		if not materials.has(cache_key):
			var copy := (source as BaseMaterial3D).duplicate() as BaseMaterial3D
			copy.ao_enabled = true
			copy.ao_texture = textures[kind]
			copy.ao_on_uv2 = true
			copy.ao_texture_channel = BaseMaterial3D.TEXTURE_CHANNEL_RED
			materials[cache_key] = copy
		mesh.set_surface_override_material(index, materials[cache_key])
		converted += 1
	if converted > 0:
		meshes += 1
		surfaces += converted
