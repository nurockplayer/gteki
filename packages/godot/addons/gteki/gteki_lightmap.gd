extends RefCounted
## Applies a station's baked lightmap to the snapshot (G-4a of #164), mirroring the web exactly.
##
## Web side (stations/ikebukuro/scene/scene.ts ~399–413 and scene/materials.ts setLightmap):
##   three loads the WebP as an sRGB texture with flipY = false, samples it on TEXCOORD_1 (three's
##   `lightMap.channel = 1`) and gives every "baked" material `lightMapIntensity = scale * PI * LIGHTMAP_GAIN`.
##   three's lightmap path (renderers/shaders/ShaderChunk/lights_fragment_maps.glsl.js) does
##   `irradiance += texel * lightMapIntensity`, and RE_IndirectDiffuse_Physical then adds
##   `irradiance * RECIPROCAL_PI * diffuseColor * (1 - metalness)` to the output. So the lightmap contributes
##   `albedo * (1 - metalness) * texel * lightMapIntensity / PI` — the PI in the intensity and the RECIPROCAL_PI
##   in the BRDF cancel, leaving `albedo * (1 - metalness) * decoded * scale * LIGHTMAP_GAIN`.
##   The bake's stated encoding (ikebukuro_b1_lit.meta.json) is `value = (byte / 255)^2.2 * scale`, and the web
##   relies on the GPU's sRGB decode as a close approximation of that 2.2 gamma.
##
## Here: the lightmap file is read raw (no sRGB hint), decoded with the same `pow(texel, 2.2)`, multiplied by
## `lightMapIntensity / PI` and added as EMISSION, which Godot adds to the lighting result just as three adds the
## indirect term. The exporter records `lightMapIntensity` from the material and the mesh flag from the material
## state (`gteki_lightmap_surfaces`), so this file holds no station constant: scale and gain stay in scene.ts.
## Differences left to G-4: three's `(1 - singleScattering - multiScattering)` dielectric energy compensation is
## not modelled (a few percent at most), and specular comes from the web's envMap, which the snapshot does not carry.

const Bridge = preload("res://addons/gteki/gteki_bridge.gd")

## three's lightMap sampled channel 1 = TEXCOORD_1; Godot imports TEXCOORD_1 as UV2.
const REQUIRED_CHANNEL := 1
## The bake's stated decode (not the GPU sRGB transfer function; documented above).
const DECODE_GAMMA := 2.2

const SHADER_TEMPLATE := """shader_type spatial;
render_mode %s, diffuse_burley, specular_schlick_ggx;

uniform vec4 albedo_color = vec4(1.0);
uniform float roughness_value : hint_range(0.0, 1.0) = 0.5;
uniform float metallic_value : hint_range(0.0, 1.0) = 0.0;
// Raw texels (no source_color hint): the fragment decodes them with the bake's 2.2 gamma.
uniform sampler2D light_map : filter_linear_mipmap, repeat_disable;
// three's lightMapIntensity / PI (see this file's header).
uniform float light_map_factor = 0.0;

void fragment() {
	vec3 texel = texture(light_map, UV2).rgb;
	vec3 baked = pow(texel, vec3(2.2)) * light_map_factor;
	ALBEDO = albedo_color.rgb;
	ROUGHNESS = roughness_value;
	METALLIC = metallic_value;
	// Additive indirect diffuse exactly as three's RE_IndirectDiffuse: the metalness reduction is part of three's
	// diffuseContribution = diffuseColor * (1 - metalness).
	EMISSION = albedo_color.rgb * (1.0 - metallic_value) * baked;
	%s
}
"""

## The fragment's decode of one raw channel, `pow(texel, 2.2) * lightMapIntensity / PI`, exposed so the headless test
## can compare it with the bake's own metadata: `(byte/255)^2.2 * scale * LIGHTMAP_GAIN` (PI cancels).
static func decode_texel(raw: float, intensity: float) -> float:
	return pow(raw, DECODE_GAMMA) * intensity / PI


var issues: Array[String] = []
var meshes := 0
var surfaces := 0
var texture_size := Vector2i.ZERO
var texture_path := ""
var _shaders: Dictionary = {}


## Applies `block` (the sidecar's `lightmap`) to the meshes flagged in their extras. Returns true when every flagged
## surface was converted; any miss is an issue (a partial lightmap would misrepresent the scene).
func apply(root: Node3D, block: Dictionary, station_id: String) -> bool:
	issues.clear()
	meshes = 0
	surfaces = 0
	texture_size = Vector2i.ZERO
	texture_path = ""
	var uri := str(block.get("uri", ""))
	var intensity := float(block.get("light_map_intensity", 0.0))
	if int(block.get("channel", -1)) != REQUIRED_CHANNEL:
		issues.append("Lightmap uses channel %s; only channel 1 (TEXCOORD_1 → UV2) can be applied" % str(block.get("channel")))
		return false
	if uri.is_empty() or intensity <= 0.0:
		issues.append("Lightmap block lacks a texture URI or a positive lightMapIntensity")
		return false
	var repo_root := Bridge.find_repo_root()
	if repo_root.is_empty():
		issues.append("Cannot find the repository root (pnpm-workspace.yaml) above %s" % ProjectSettings.globalize_path("res://"))
		return false
	texture_path = repo_root.path_join("stations").path_join(station_id).path_join("gteki").path_join(uri)
	var image: Image = Image.load_from_file(texture_path)
	if image == null or image.is_empty():
		issues.append("Cannot decode the lightmap %s" % texture_path)
		return false
	texture_size = image.get_size()
	var texture := ImageTexture.create_from_image(image)
	var factor := intensity / PI
	_visit(root, texture, factor)
	return issues.is_empty()


func _visit(node: Node, texture: Texture2D, factor: float) -> void:
	if node is MeshInstance3D:
		var mesh: MeshInstance3D = node
		var extras: Variant = mesh.get_meta("extras", {})
		if extras is Dictionary and extras.has("gteki_lightmap_surfaces"):
			_apply_mesh(mesh, extras["gteki_lightmap_surfaces"], texture, factor)
	for child in node.get_children():
		_visit(child, texture, factor)


func _apply_mesh(mesh: MeshInstance3D, flagged: Variant, texture: Texture2D, factor: float) -> void:
	if mesh.mesh == null:
		issues.append("Lightmapped mesh %s has no mesh" % mesh.name)
		return
	if not flagged is Array:
		issues.append("Lightmapped mesh %s has a malformed gteki_lightmap_surfaces" % mesh.name)
		return
	var converted := 0
	for surface in flagged:
		var index := int(surface)
		if index < 0 or index >= mesh.mesh.get_surface_count():
			issues.append("Lightmapped mesh %s has no surface %d" % [mesh.name, index])
			continue
		if (mesh.mesh.surface_get_format(index) & Mesh.ARRAY_FORMAT_TEX_UV2) == 0:
			issues.append("Lightmapped surface %s/%d has no UV2 (TEXCOORD_1 was dropped)" % [mesh.name, index])
			continue
		mesh.set_surface_override_material(index, _material_for(mesh.get_active_material(index), texture, factor))
		converted += 1
	if converted > 0:
		meshes += 1
		surfaces += converted


## Copies the snapshot material's base colour, roughness, metallic and culling, then adds the baked light as emission.
func _material_for(source: Material, texture: Texture2D, factor: float) -> ShaderMaterial:
	var material := ShaderMaterial.new()
	var cull := BaseMaterial3D.CULL_BACK
	var blended := false
	var albedo := Color(0.8, 0.8, 0.8)
	var roughness := 0.5
	var metallic := 0.0
	if source is BaseMaterial3D:
		var base: BaseMaterial3D = source
		cull = base.cull_mode
		blended = base.transparency != BaseMaterial3D.TRANSPARENCY_DISABLED or base.albedo_color.a < 1.0
		albedo = base.albedo_color
		roughness = base.roughness
		metallic = base.metallic
	else:
		issues.append("Lightmapped surface material %s is not a BaseMaterial3D; using defaults" % str(source))
	material.shader = _shader(cull, blended)
	material.set_shader_parameter("albedo_color", albedo)
	material.set_shader_parameter("roughness_value", roughness)
	material.set_shader_parameter("metallic_value", metallic)
	material.set_shader_parameter("light_map", texture)
	material.set_shader_parameter("light_map_factor", factor)
	return material


func _shader(cull: BaseMaterial3D.CullMode, blended: bool) -> Shader:
	var key := "%d/%s" % [cull, blended]
	if _shaders.has(key):
		return _shaders[key]
	var cull_mode := "cull_back"
	if cull == BaseMaterial3D.CULL_FRONT:
		cull_mode = "cull_front"
	elif cull == BaseMaterial3D.CULL_DISABLED:
		cull_mode = "cull_disabled"
	if blended:
		cull_mode += ", blend_mix, depth_draw_opaque"
	var shader := Shader.new()
	shader.code = SHADER_TEMPLATE % [cull_mode, "ALPHA = albedo_color.a;" if blended else ""]
	_shaders[key] = shader
	return shader
