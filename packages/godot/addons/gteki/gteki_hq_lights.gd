extends RefCounted
## The HQ client's added lights (G-4a follow-up of #251). The web's `environment.lighting: "scene"` adds no scene
## lights and lights only its own avatar, with a per-material environment map (packages/scene-api/src/index.ts:71-76,
## apps/web/src/explorer/explorer.ts:295-312). Three.js cannot mask a light per object; Godot can, so the lights are
## masked to the avatar's own render layer while a station bake is the station's light, and reach every layer only for
## the unlit snapshot (no lightmap, or `--lightmap=off`).
##
## Two directionals stand in for the web's image-based light: the key alone leaves the far side of the avatar black,
## which is what the #251 review found; key + fill keeps the figure readable without touching the station's materials.

const Walker = preload("res://addons/gteki/gteki_walker.gd")

## Station meshes keep Godot's default render layer; the added lights are masked off it while a bake is applied.
const WORLD_LAYER := 1 << 0
## Every render layer Godot exposes (20), i.e. the unlit-snapshot mask.
const ALL_LAYERS := 0xFFFFF
const FILL_ENERGY := 0.35


## Parented to `parent` (the HQ root), so the lights are freed with it.
static func build(parent: Node3D) -> Array[DirectionalLight3D]:
	var key := DirectionalLight3D.new()
	key.name = "avatar_key_light"
	key.rotation_degrees = Vector3(-50, 30, 0)
	var fill := DirectionalLight3D.new()
	fill.name = "avatar_fill_light"
	fill.rotation_degrees = Vector3(-20, -140, 0)
	fill.light_energy = FILL_ENERGY
	fill.light_color = Color(0.85, 0.9, 1.0)
	parent.add_child(key)
	parent.add_child(fill)
	return [key, fill]


## `baked`: the station's baked lightmap is applied, so these lights may light the avatar layer only.
static func apply(lights: Array[DirectionalLight3D], baked: bool) -> void:
	for light in lights:
		light.light_cull_mask = cull_mask(baked)


static func cull_mask(baked: bool) -> int:
	return Walker.AVATAR_LAYER if baked else ALL_LAYERS
