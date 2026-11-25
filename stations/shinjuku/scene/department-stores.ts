// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import data from "../data/department-stores.json";
import { inside } from "./surface-street.ts";
import {
  LANDMARK_FACADE, LANDMARK_FLOOR_JOINT_M, LANDMARK_PIER_SPACING_M,
  LANDMARK_GLASS_ROUGHNESS, LANDMARK_STREET_BAND, LANDMARK_SIGN,
  LANDMARK_MAX_TEXTURE_PX, type LandmarkFacade,
} from "../../ikebukuro/scene/landmark-style.ts";

type Point = number[];
type Face = { kind: string; rings: Point[][] };
const vector = (p: Point) => new THREE.Vector3(p[0]!, p[2]!, -p[1]!);

function facePlane(face: Face) {
  const points = face.rings[0]!.map(vector), normal = new THREE.Vector3();
  for (let i = 0; i < points.length; i++) normal.add(points[i]!.clone().cross(points[(i + 1) % points.length]!));
  normal.normalize();
  const u = Math.abs(normal.y) > .9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(normal.z, 0, -normal.x).normalize();
  const v = normal.clone().cross(u).normalize(), origin = points[0]!;
  const rings = face.rings.map(r => r.map(p => {
    const delta = vector(p).sub(origin);
    return new THREE.Vector2(delta.dot(u), delta.dot(v));
  }));
  return { origin, u, v, normal, rings };
}

function facadeGeometry(face: Face) {
  const { rings } = facePlane(face), points = face.rings.flat().map(vector), xy = rings.flat();
  const indices = THREE.ShapeUtils.triangulateShape(rings[0]!, rings.slice(1)).flat();
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(points.flatMap(p => p.toArray()), 3));
  const pier = (LANDMARK_PIER_SPACING_M[0] + LANDMARK_PIER_SPACING_M[1]) / 2;
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(xy.flatMap(p => [p.x / pier, p.y / LANDMARK_FLOOR_JOINT_M]), 2));
  geometry.setIndex(indices); geometry.computeVertexNormals();
  return geometry;
}

function panel(center: THREE.Vector3, u: THREE.Vector3, v: THREE.Vector3, width: number, height: number, top: number, bottom: number) {
  const geometry = new THREE.PlaneGeometry(width, height), uv = geometry.attributes.uv!;
  for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - bottom + uv.getY(i) * (bottom - top));
  const normal = u.clone().cross(v);
  geometry.applyMatrix4(new THREE.Matrix4().makeBasis(u, v, normal).setPosition(center));
  return geometry;
}

/** Three draws per source building: real LOD2 mass, shut street glazing, baked name bands.
 * The shared Keio/Lumine 1 part uses one name band per store (two on the building).
 * No entrance anchors are inferred from search-only POIs.
 */
export function buildDepartmentStores(track: <T extends { dispose(): void }>(resource: T) => T) {
  const root = new THREE.Group(); root.name = "department-stores-next";
  for (const building of data.buildings) {
    const stores = data.stores.filter(s => s.buildingId === building.id), store = stores[0]!;
    const group = new THREE.Group(); group.name = `department-store:${building.id}`;
    group.userData.poiIds = stores.map(s => s.poiId);
    group.userData.source = { tile: building.sourceTile, heightM: building.height, lod: 2 };
    const canvas = document.createElement("canvas"); canvas.width = canvas.height = LANDMARK_MAX_TEXTURE_PX;
    const ctx = canvas.getContext("2d")!;
    const jaM = Math.min(LANDMARK_SIGN.maxJaLetterM, LANDMARK_FLOOR_JOINT_M / (1 + LANDMARK_SIGN.enScale + .4));
    const widths = stores.map(s => (s.ja.length + 1) * jaM);
    let streetY = 0;
    const rows = widths.map(width => { const top = streetY; streetY += canvas.width * LANDMARK_FLOOR_JOINT_M / width; return { top, bottom: streetY }; });
    stores.forEach((s, i) => {
      const { top, bottom } = rows[i]!;
      ctx.fillStyle = LANDMARK_SIGN.band; ctx.fillRect(0, top, canvas.width, bottom - top);
      ctx.fillStyle = LANDMARK_SIGN.letters; ctx.textAlign = "center";
      const ja = canvas.width / (s.ja.length + 1);
      ctx.font = `600 ${ja}px 'GTEki Sign JP'`; ctx.fillText(s.ja, canvas.width / 2, top + ja * 1.05);
      ctx.font = `600 ${ja * LANDMARK_SIGN.enScale}px 'GTEki Sign JP'`;
      ctx.fillText(s.en, canvas.width / 2, top + ja * (1.15 + LANDMARK_SIGN.enScale), canvas.width * .94);
    });
    // A shallow, closed shopfront: warm glass, bronze frames, no content or void.
    const streetHeight = canvas.height - streetY;
    ctx.fillStyle = LANDMARK_SIGN.band; ctx.fillRect(0, streetY, canvas.width, streetHeight);
    ctx.fillStyle = LANDMARK_STREET_BAND.glow; ctx.fillRect(12, streetY + 12, canvas.width - 24, streetHeight - 24);
    const atlas = track(new THREE.CanvasTexture(canvas)); atlas.colorSpace = THREE.SRGBColorSpace;
    const relief = document.createElement("canvas"); relief.width = relief.height = LANDMARK_MAX_TEXTURE_PX;
    const bump = relief.getContext("2d")!;
    bump.fillStyle = "#ffffff"; bump.fillRect(0, 0, relief.width, relief.height);
    bump.fillStyle = "#555555"; bump.fillRect(0, 0, relief.width, 3); bump.fillRect(0, 0, 5, relief.height);
    if (store.upper === "glazed") bump.fillRect(0, relief.height * .75, relief.width, relief.height * .2);
    const joints = track(new THREE.CanvasTexture(relief)); joints.wrapS = joints.wrapT = THREE.RepeatWrapping;
    const facade = track(new THREE.MeshStandardMaterial({
      color: LANDMARK_FACADE[store.facade as LandmarkFacade], side: THREE.DoubleSide,
      roughness: store.upper === "glazed" ? LANDMARK_GLASS_ROUGHNESS : .8,
      bumpMap: joints, bumpScale: .08, fog: false,
    }));
    // 2026-11-22 JST: keep the two bright stone landmarks below the look-frame sky.
    if (store.poiId === "shop-sjk-isetan-honkan" || store.poiId === "shop-sjk-odakyudept") facade.color.multiplyScalar(.5);
    const street = track(new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas,
      emissive: LANDMARK_STREET_BAND.glow, emissiveIntensity: LANDMARK_STREET_BAND.maxEmissive,
      roughness: LANDMARK_GLASS_ROUGHNESS, side: THREE.DoubleSide, fog: false }));
    // 2026-11-22 JST: these sun-facing bands need diffuse atlas contrast without specular glare.
    const sign = track(["shop-sjk-keio", "shop-sjk-odakyudept", "shop-sjk-lumine2"].includes(store.poiId)
      ? new THREE.MeshBasicMaterial({ map: atlas, side: THREE.FrontSide, fog: false })
      : new THREE.MeshStandardMaterial({ map: atlas, emissiveMap: atlas,
      emissive: LANDMARK_SIGN.letters, emissiveIntensity: LANDMARK_SIGN.letterEmissive[0],
      roughness: LANDMARK_SIGN.bandRoughness, side: THREE.FrontSide, fog: false }));
    const surfaces = building.surfaces as Face[];
    const facadeParts = surfaces.map(facadeGeometry), streetParts: THREE.BufferGeometry[] = [], signParts: THREE.BufferGeometry[] = [];
    const ring = building.rings[0]!;
    for (let i = 1; i < ring.length; i++) {
      const a = vector([...ring[i - 1]!, 0]), b = vector([...ring[i]!, 0]), u = b.clone().sub(a).normalize();
      const outward = new THREE.Vector3(-u.z, 0, u.x), v = new THREE.Vector3(0, 1, 0);
      const height = LANDMARK_STREET_BAND.heightM[0];
      const bays = Math.ceil(a.distanceTo(b) / LANDMARK_STREET_BAND.mullionSpacingM[1]);
      const width = a.distanceTo(b) / bays;
      for (let bay = 0; bay < bays; bay++) streetParts.push(panel(a.clone().lerp(b, (bay + .5) / bays).addScaledVector(outward, .03).setY(height / 2), u.clone().negate(), v, width, height, streetY / canvas.height, 1));
    }
    const usedFaces = new Set<Face>();
    stores.forEach((s, row) => s.signs.forEach(({ edge, along }) => {
      const a = vector([...ring[edge]!, 0]), b = vector([...ring[(edge + 1) % ring.length]!, 0]), target = a.clone().lerp(b, along);
      // Use the real wall's span across the first-floor name band, below every roof.
      const candidates = surfaces.filter(f => f.kind === "wall" && !usedFaces.has(f)).map(source => ({ ...facePlane(source), source })).filter(f => Math.abs(f.normal.y) < .01).map(f => {
        const bottom = (LANDMARK_FLOOR_JOINT_M - f.origin.y) / f.v.y;
        const top = (2 * LANDMARK_FLOOR_JOINT_M - f.origin.y) / f.v.y;
        const spans = [bottom, (bottom + top) / 2, top].map(y => {
          const xs = f.rings[0]!.flatMap((a, i, ring) => {
            const b = ring[(i + 1) % ring.length]!;
            return (a.y > y) !== (b.y > y) ? [a.x + (b.x - a.x) * (y - a.y) / (b.y - a.y)] : [];
          });
          return { left: Math.min(...xs), right: Math.max(...xs) };
        });
        const left = Math.max(...spans.map(p => p.left)), right = Math.min(...spans.map(p => p.right));
        return { ...f, width: right - left, left, right, bottom, top };
      }).filter(f => f.width >= s.ja.length).sort((f, g) => {
        const distance = (p: typeof f) => p.origin.clone().addScaledVector(p.u, (p.left + p.right) / 2).setY(0).distanceTo(target);
        return distance(f) - distance(g);
      });
      const face = candidates[0]!;
      usedFaces.add(face.source);
      const width = Math.min(face.width * .9, widths[row]!);
      const height = LANDMARK_FLOOR_JOINT_M * width / widths[row]!;
      const center = face.origin.clone().addScaledVector(face.u, (face.left + face.right) / 2).setY(LANDMARK_FLOOR_JOINT_M + height / 2);
      // PLATEAU wall winding varies; the sign must face out of the footprint.
      const probe = center.clone().addScaledVector(face.normal, .2);
      if (inside({ x: probe.x, y: -probe.z }, [building.rings])) { face.normal.negate(); face.u.negate(); }
      center.addScaledVector(face.normal, .04);
      signParts.push(panel(center, face.u, face.v, width, height, rows[row]!.top / canvas.height, rows[row]!.bottom / canvas.height));
    }));
    for (const [name, parts, material] of [["facade", facadeParts, facade], ["street", streetParts, street], ["sign", signParts, sign]] as const) {
      const geometry = track(mergeGeometries(parts, false)!); parts.forEach(p => p.dispose());
      const mesh = new THREE.Mesh(geometry, material); mesh.name = `${group.name}:${name}`; group.add(mesh);
    }
    root.add(group);
  }
  return root;
}
