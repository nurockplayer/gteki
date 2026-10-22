extends RefCounted
## G-3 route ribbon: the polyline as a flat strip a few cm above the floor, in renderer coordinates, with a procedural
## animated chevron pattern. Segments touching a point without a surveyed height (zKnown false) go on a second surface
## with a dashed, different-coloured style. One shared vertex strip (2 vertices per polyline point), two index sets.

const WIDTH := 0.7
const LIFT := 0.06

const SHADER := """
shader_type spatial;
render_mode unshaded, cull_disabled, depth_draw_never, shadows_disabled;
uniform vec4 tint : source_color = vec4(0.1, 0.75, 1.0, 0.9);
uniform bool dashed = false;
varying float along;
varying float across;
void vertex() { along = UV.x; across = UV.y * 2.0 - 1.0; }
void fragment() {
	float edge = abs(across);
	// Chevron ">" pointing along the route: the stripe phase shifts with distance from the centre line.
	float phase = fract(along * 0.9 - TIME * 0.8 + edge * 0.35);
	float chevron = smoothstep(0.0, 0.08, phase) * (1.0 - smoothstep(0.38, 0.46, phase));
	if (dashed && fract(along * 1.6) > 0.55) { discard; }
	ALBEDO = tint.rgb;
	ALPHA = tint.a * mix(0.35, 1.0, chevron) * (1.0 - smoothstep(0.8, 1.0, edge));
}
"""

var mesh: ArrayMesh
## Per surface: true when it holds the symbolic-height (dashed) segments.
var surface_symbolic: Array[bool] = []
var vertex_count := 0
var instance: MeshInstance3D


static func build(guide: RefCounted, lift := LIFT, width := WIDTH):
	var ribbon = new()
	if not guide.ok or guide.points.size() < 2:
		return null
	ribbon._build(guide, lift, width)
	return ribbon


func _build(guide: RefCounted, lift: float, width: float) -> void:
	var points: PackedVector3Array = guide.points
	var count := points.size()
	var directions := PackedVector2Array()
	var last := Vector2(0, -1)
	for i in count:
		var d := Vector2.ZERO
		if i > 0:
			d += _unit(points[i] - points[i - 1])
		if i < count - 1:
			d += _unit(points[i + 1] - points[i])
		last = d.normalized() if d.length() > 1e-6 else last
		directions.append(last)
	var vertices := PackedVector3Array()
	var uvs := PackedVector2Array()
	var normals := PackedVector3Array()
	for i in count:
		var side := Vector3(-directions[i].y, 0.0, directions[i].x) * (width * 0.5)
		var base := points[i] + Vector3(0, lift, 0)
		vertices.append(base - side)
		vertices.append(base + side)
		uvs.append(Vector2(guide.cumulative[i], 0.0))
		uvs.append(Vector2(guide.cumulative[i], 1.0))
		normals.append(Vector3.UP)
		normals.append(Vector3.UP)
	vertex_count = vertices.size()
	var known := PackedInt32Array()
	var symbolic := PackedInt32Array()
	for i in range(count - 1):
		var target := symbolic if (not guide.z_known[i] or not guide.z_known[i + 1]) else known
		target.append_array(PackedInt32Array([2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 1, 2 * i + 3, 2 * i + 2]))
	mesh = ArrayMesh.new()
	for pair in [[known, false], [symbolic, true]]:
		if pair[0].is_empty():
			continue
		var arrays := []
		arrays.resize(Mesh.ARRAY_MAX)
		arrays[Mesh.ARRAY_VERTEX] = vertices
		arrays[Mesh.ARRAY_NORMAL] = normals
		arrays[Mesh.ARRAY_TEX_UV] = uvs
		arrays[Mesh.ARRAY_INDEX] = pair[0]
		mesh.add_surface_from_arrays(Mesh.PRIMITIVE_TRIANGLES, arrays)
		surface_symbolic.append(pair[1])
	var shader := Shader.new()
	shader.code = SHADER
	for surface in surface_symbolic.size():
		var material := ShaderMaterial.new()
		material.shader = shader
		material.set_shader_parameter("dashed", surface_symbolic[surface])
		material.set_shader_parameter("tint", Color(1.0, 0.62, 0.1, 0.95) if surface_symbolic[surface] else Color(0.1, 0.75, 1.0, 0.9))
		mesh.surface_set_material(surface, material)
	instance = MeshInstance3D.new()
	instance.name = "GTEkiRouteRibbon"
	instance.mesh = mesh
	instance.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


static func _unit(v: Vector3) -> Vector2:
	var flat := Vector2(v.x, v.z)
	return flat.normalized() if flat.length() > 1e-6 else Vector2.ZERO


func has_symbolic() -> bool:
	return surface_symbolic.has(true)
