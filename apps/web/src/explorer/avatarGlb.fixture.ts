import * as THREE from "three";

/** Original CPU-only placeholder for #339 X1: centimetre-sized box, three bones, no asset files. */
export function skinnedAvatarFixture() {
  const scene = new THREE.Group();
  const geometry = new THREE.BoxGeometry(40, 170, 30).translate(20, 85, 5);
  const count = geometry.getAttribute("position").count;
  const indices = new Uint16Array(count * 4);
  const weights = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    indices[i * 4] = geometry.getAttribute("position").getY(i) > 85 ? 2 : 0;
    weights[i * 4] = 1;
  }
  geometry.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(indices, 4));
  geometry.setAttribute("skinWeight", new THREE.Float32BufferAttribute(weights, 4));
  const map = new THREE.Texture();
  const normalMap = new THREE.Texture();
  const materials = [new THREE.MeshStandardMaterial({ map, normalMap }), new THREE.MeshPhysicalMaterial({ map })];
  const mesh = new THREE.SkinnedMesh(geometry, [materials[0]!, materials[1]!, materials[0]!]);
  const hips = new THREE.Bone(); hips.name = "hips";
  const spine = new THREE.Bone(); spine.name = "spine"; spine.position.y = 85;
  const head = new THREE.Bone(); head.name = "head"; head.position.y = 85;
  hips.add(spine); spine.add(head); mesh.add(hips);
  const skeleton = new THREE.Skeleton([hips, spine, head]);
  mesh.bind(skeleton);
  const accessory = new THREE.Mesh(geometry, materials[0]);
  scene.add(mesh, accessory);
  const clip = (name: string, angle: number) => new THREE.AnimationClip(name, 1, [
    new THREE.NumberKeyframeTrack("spine.rotation[z]", [0, 0.5, 1], [0, angle, 0]),
  ]);
  const animations = [clip("idle", 0.1), clip("walk", 0.6), clip("run", 1)];
  return { scene, animations, mesh, accessory, skeleton, spine, geometry, materials, textures: [map, normalMap] };
}

export function fadeUniform(material: THREE.Material): THREE.IUniform {
  const shader = { uniforms: {} as Record<string, THREE.IUniform>, fragmentShader: THREE.ShaderLib.standard.fragmentShader };
  material.onBeforeCompile(shader as THREE.WebGLProgramParametersWithUniforms, null as unknown as THREE.WebGLRenderer);
  return shader.uniforms.uAvatarFade!;
}
