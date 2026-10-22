/** Original procedural finishes; no photographs, operator artwork or font assets. */
import * as THREE from "three";
export const skyHorizon = new THREE.Color("#d5d8d6");
export const sun = new THREE.Vector3(-0.8, 0.48, 0.28).normalize();
export function hash(s: string) { let n = 2166136261; for (const c of s) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return n >>> 0; }
function texture(c: HTMLCanvasElement) {
  const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
export function pavingTexture(asphalt = false) {
  const c = document.createElement("canvas"); c.width = c.height = 256; const x = c.getContext("2d")!;
  x.fillStyle = asphalt ? "#55595a" : "#a4a6a4"; x.fillRect(0, 0, 256, 256);
  if (!asphalt) for (let y = 0; y < 16; y++) for (let i = -1; i < 8; i++) {
    const v = 174 + hash(`${i}:${y}`) % 15;
    x.fillStyle = `rgb(${v + 3},${v + 2},${v})`; x.fillRect(i * 32 + (y % 2 ? 16 : 0) + 1, y * 16 + 1, 30, 14);
  }
  for (let i = 0; i < 6000; i++) { const h = hash(`p${i}`); x.fillStyle = h & 1 ? "#ffffff10" : "#00000010"; x.fillRect(h % 256, (h >>> 8) % 256, 1, 1); }
  return texture(c);
}

/** 4 bays by 8 storeys; five original facade families with restrained lit rooms. */
export function facadeTexture(style: number) {
  const c = document.createElement("canvas"); c.width = 512; c.height = 1024; const x = c.getContext("2d")!;
  const bases = ["#50727d", "#bdbcb4", "#9caaa9", "#d1ccc0", "#626e76"];
  x.fillStyle = bases[style]!; x.fillRect(0, 0, c.width, c.height);
  for (let r = 0; r < 8; r++) for (let col = 0; col < 4; col++) {
    const u = col * 128, v = r * 128, seed = hash(`${style}:${r}:${col}`);
    const lit = seed % 17 === 0;
    const shades = ["#56737d", "#63808a", "#6c8790", "#45616e", "#789098"];
    const glass = lit ? "#b9b6a2" : shades[seed % shades.length]!;
    x.fillStyle = style === 0 ? "#a4b5b8" : "#7f898b"; x.fillRect(u, v, 128, 2);
    if (style === 0) {
      x.fillStyle = glass; x.fillRect(u + 3, v + 3, 122, 122);
      x.fillStyle = "#bac5c5"; x.fillRect(u + 62, v, 2, 128);
      x.fillStyle = "#90a4ac"; x.fillRect(u + 4, v + 88, 120, 3);
    } else if (style === 2 || style === 4) {
      x.fillStyle = glass; x.fillRect(u + 1, v + 22, 126, 80);
      x.fillStyle = "#aab2b1"; x.fillRect(u + 2, v + 22, 2, 80); x.fillRect(u + 64, v + 22, 2, 80);
      x.fillStyle = "#697b82"; x.fillRect(u, v + 104, 128, 3);
    } else {
      x.fillStyle = "#858b89"; x.fillRect(u + 22, v + 18, 86, 87);
      x.fillStyle = glass; x.fillRect(u + 26, v + 21, 78, 80);
      x.fillStyle = "#c2c6c1"; x.fillRect(u + 63, v + 21, 2, 80);
      x.fillStyle = "#939b98"; x.fillRect(u + 20, v + 106, 90, 3);
      x.fillStyle = "#ffffff12"; x.fillRect(u + 2, v + 4, 122, 2);
    }
    if (seed % 5 === 0) { x.fillStyle = "#cad2ce44"; x.fillRect(u + 28, v + 24, 34, 24); }
  }
  return texture(c);
}

/** Per-material sun, reflection and distance haze: never changes underground lights/fog. */
export function daylight(color: string, map: THREE.Texture | null = null, reflection = 0, glow = false) {
  const m = new THREE.MeshBasicMaterial({ color, map, side: THREE.DoubleSide, fog: false });
  m.onBeforeCompile = (s) => {
    s.uniforms.surfaceSun = { value: sun }; s.uniforms.surfaceHorizon = { value: skyHorizon };
    s.vertexShader = `varying vec3 surfaceNormal; varying vec3 surfaceWorld;\n${s.vertexShader}`.replace("#include <begin_vertex>", `#include <begin_vertex>
      vec4 localSurface = vec4(position,1.);
      vec3 localNormal = normal;
      #ifdef USE_INSTANCING
        localSurface = instanceMatrix * localSurface;
        localNormal = mat3(instanceMatrix) * localNormal;
      #endif
      surfaceNormal = normalize(mat3(modelMatrix) * localNormal);
      surfaceWorld = (modelMatrix * localSurface).xyz;`);
    s.fragmentShader = `uniform vec3 surfaceSun; uniform vec3 surfaceHorizon; varying vec3 surfaceNormal; varying vec3 surfaceWorld;\n${s.fragmentShader}`.replace("#include <opaque_fragment>", `
      vec3 n = normalize(surfaceNormal);
      float direct = max(0., dot(n, surfaceSun));
      outgoingLight *= ${glow ? "vec3(1.05)" : "vec3(.48,.53,.59) + vec3(.65,.51,.33)*direct"};
      ${reflection ? `vec3 v = normalize(cameraPosition - surfaceWorld);
      vec3 r = reflect(-v,n);
      vec3 reflected = mix(surfaceHorizon, vec3(.30,.47,.62), clamp(r.y,0.,1.));
      reflected += vec3(.8,.65,.4)*pow(max(dot(r,surfaceSun),0.),128.);
      float glassMask = smoothstep(.005,.055,diffuseColor.b-diffuseColor.r);
      outgoingLight = mix(outgoingLight,reflected,glassMask*${reflection.toFixed(2)}*(.4+.6*pow(1.-abs(dot(v,n)),3.)));` : ""}
      float haze = smoothstep(170., 370., distance(cameraPosition.xz, surfaceWorld.xz));
      outgoingLight = mix(outgoingLight, surfaceHorizon, haze * .96);
      #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => `surface-daylight-${reflection}-${glow}`;
  return m;
}
export function skyMaterial() {
  return new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { horizon: { value: skyHorizon }, zenith: { value: new THREE.Color("#668da9") }, sunDir: { value: sun } },
    vertexShader: "varying vec3 skyDir; void main(){ skyDir=position; vec4 p=projectionMatrix*modelViewMatrix*vec4(position,1.); gl_Position=p.xyww; }",
    fragmentShader: `uniform vec3 horizon; uniform vec3 zenith; uniform vec3 sunDir; varying vec3 skyDir;
      float noise(vec2 p){ vec2 i=floor(p),f=fract(p); f=f*f*(3.-2.*f); vec2 k=vec2(127.1,311.7); return mix(mix(fract(sin(dot(i,k))*43758.5453),fract(sin(dot(i+vec2(1,0),k))*43758.5453),f.x),mix(fract(sin(dot(i+vec2(0,1),k))*43758.5453),fract(sin(dot(i+vec2(1),k))*43758.5453),f.x),f.y); }
      void main(){ vec3 d=normalize(skyDir); vec3 c=mix(horizon,zenith,pow(max(d.y,0.),.55));
      vec2 p=d.xz/(max(d.y,.06)+.3)*3.; float clouds=noise(p)+.45*noise(p*2.2)+.2*noise(p*5.);
      c=mix(c,vec3(.87,.86,.82),smoothstep(.86,1.3,clouds)*smoothstep(0.,.25,d.y)*.6);
      float alignment=max(dot(d,sunDir),0.); c+=vec3(1.,.77,.44)*pow(alignment,64.)*.2;
      c=mix(c,vec3(1.,.95,.78),smoothstep(.99965,.99985,alignment)); gl_FragColor=vec4(c,1.);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
  });
}
