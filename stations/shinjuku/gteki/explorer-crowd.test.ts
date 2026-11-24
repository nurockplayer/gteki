// Shinjuku's explorer commuters (#938): the real graph adapted for Ikebukuro's instanced buildCrowd.
import * as THREE from "three";
import { describe, expect, it } from "vitest";
import type { GraphFile } from "@gteki/schema";
import { buildCrowd } from "../../ikebukuro/scene/crowd.ts";
import graph from "./graph.json";
import { crowdEdges } from "./explorer-crowd.ts";

const graphFile = graph as GraphFile;
const nodeById = new Map(graphFile.nodes.map((n) => [n.id, n]));
const edgeById = new Map(graphFile.edges.map((e) => [e.id, e]));
/** The adapter's node height, as the scene passes it: the node's own z, else its display height. */
const nodeZ = (id: string) => {
  const n = nodeById.get(id);
  return n ? n.position.z ?? n.renderZ ?? 0 : 0;
};
const { edges, lanes } = crowdEdges(graphFile, nodeZ);

describe("shinjuku explorer crowd edges", () => {
  it("keeps only verified, open walk/stairs/ramp/gate edges between present nodes", () => {
    const kept = new Set(edges.map((e) => e.id));
    const wanted = graphFile.edges.filter((e) =>
      (e.mode === "walk" || e.mode === "stairs" || e.mode === "ramp" || e.mode === "gate")
      && e.verification === "verified" && !e.closed
      && nodeById.has(e.from) && nodeById.has(e.to));
    expect(edges.map((e) => e.id).sort()).toEqual(wanted.map((e) => e.id).sort());
    // Escalators and lifts are walked in both directions by buildCrowd: never kept.
    const vertical = graphFile.edges.filter((e) => e.mode === "escalator" || e.mode === "elevator");
    expect(vertical.length).toBeGreaterThan(0);
    for (const e of vertical) expect(kept.has(e.id)).toBe(false);
  });

  it("gives every kept point a finite height from its node and every edge a lane", () => {
    expect(edges.length).toBeGreaterThan(0);
    for (const e of edges) {
      expect(e.geometry.length).toBeGreaterThanOrEqual(2);
      for (const p of e.geometry) expect(Number.isFinite(p.z)).toBe(true);
      expect(e.geometry[0]!.z).toBe(nodeZ(e.from));
      expect(e.geometry[e.geometry.length - 1]!.z).toBe(nodeZ(e.to));
      expect(lanes[e.id]).toBeDefined();
      expect(lanes[e.id]!.stepM).toBe(1000);
      const w = edgeById.get(e.id)!.mode === "stairs" ? 0.45 : 0.8;
      expect(lanes[e.id]!.left).toEqual([w]);
      expect(lanes[e.id]!.right).toEqual([w]);
    }
    expect(Object.keys(lanes).sort()).toEqual(edges.map((e) => e.id).sort());
  });
});

describe("shinjuku explorer crowd", () => {
  const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

  it.each([56, 150])("keeps %i commuters finite, moving and in constant draws over 2,000 frames", (count) => {
    const crowd = buildCrowd(THREE, edges, toRenderer, count, new THREE.Texture(), lanes);
    try {
      const meshes = crowd.group.children as THREE.InstancedMesh[];
      const people = meshes.find((m) => m.name === "crowd_torso" || m.name === "crowd_low")!;
      expect(people.count).toBe(count);
      // Low tier (56) packs every person into one InstancedMesh; the brief's budget is two draws.
      if (count === 56) expect(meshes.length).toBeLessThanOrEqual(2);

      const m = new THREE.Matrix4();
      const lastX = new Float64Array(count), lastZ = new Float64Array(count);
      const seen = new Uint8Array(count);
      let firstRead = true;
      const readPeople = () => {
        for (let i = 0; i < count; i++) {
          people.getMatrixAt(i, m);
          const x = m.elements[12]!, z = m.elements[14]!;
          if (!firstRead && !seen[i] && (x - lastX[i]!) ** 2 + (z - lastZ[i]!) ** 2 > 1e-8) seen[i] = 1;
          lastX[i] = x;
          lastZ[i] = z;
        }
        firstRead = false;
      };
      readPeople(); // buildCrowd already applied frame 0
      let finite = true;
      for (let frame = 0; frame < 2000 && finite; frame++) {
        crowd.update(1 / 60, frame / 60);
        for (const mesh of meshes) {
          const a = mesh.instanceMatrix.array;
          for (let k = 0; k < a.length; k++) if (!Number.isFinite(a[k]!)) { finite = false; break; }
          if (!finite) break;
        }
        readPeople();
      }
      expect(finite).toBe(true);
      let moved = 0;
      for (let i = 0; i < count; i++) moved += seen[i]!;
      expect(moved).toBeGreaterThanOrEqual(Math.ceil(count * 0.9));
    } finally {
      crowd.dispose();
    }
  }, 60_000);
});


describe("cold-open crowd exclusion (#1373)", () => {
  // Place the seeded first walker on a flat path, then put the camera/cat around it.
  const path = [{ id: "opening", from: "a", to: "b", verification: "verified", geometry: [{ x: 0, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }] }];
  const toRenderer = (x: number, y: number, z: number) => new THREE.Vector3(x, z, -y);

  it.each([56, 150])("holds only excluded/returning walkers near the moving cat after release (%i tier, #1406)", (count) => {
    for (const state of ["excluded", "returning", "visible"] as const) {
      const crowd = buildCrowd(THREE, path, toRenderer, count, new THREE.Texture());
      // The same seeded first walker in the low mesh exposes its body transform without pose offsets.
      const reference = buildCrowd(THREE, path, toRenderer, 56, new THREE.Texture());
      try {
        const people = (crowd.group.children as THREE.InstancedMesh[]).find(m => m.name === "crowd_low" || m.name === "crowd_torso")!;
        const referencePeople = reference.group.children[0] as THREE.InstancedMesh;
        const matrix = new THREE.Matrix4();
        const centre = new THREE.Vector3(), cat = new THREE.Vector3();
        const followWalker = (distance: number) => {
          referencePeople.getMatrixAt(0, matrix);
          centre.set(0, 0.9, 0).applyMatrix4(matrix);
          cat.copy(centre).add(new THREE.Vector3(0, 0, -distance));
        };
        followWalker(1);
        const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
        camera.position.copy(centre).add(new THREE.Vector3(4, 0, 0));
        if (state === "visible") camera.position.copy(centre).add(new THREE.Vector3(6, 0, 4));
        camera.lookAt(cat);
        const opening = { camera, floorY: 0 };
        crowd.setCameraFocus(cat.x, cat.y, cat.z, null, opening, cat);
        const fade = () => people.geometry.getAttribute("openingFade").getX(0);
        expect(fade()).toBe(state === "visible" ? 1 : 0);
        if (state === "returning") {
          camera.position.copy(centre).add(new THREE.Vector3(6, 0, 4));
          camera.lookAt(cat);
          crowd.setCameraFocus(cat.x, cat.y, cat.z, null, opening, cat);
          reference.update(0.1, 0.1);
          crowd.update(0.1, 0.1);
          expect(fade()).toBeGreaterThan(0);
          expect(fade()).toBeLessThan(1);
          followWalker(1);
        }
        const focus = centre.clone().add(new THREE.Vector3(10, 0, 10));
        crowd.setCameraFocus(focus.x, focus.y, focus.z, null, null, cat);
        const assertHeld = () => {
          people.getMatrixAt(0, matrix);
          expect(matrix.determinant() === 0).toBe(state !== "visible");
          expect(fade()).toBe(state === "visible" ? 1 : 0);
        };
        assertHeld();
        // Keep their relative distance fixed for >3 s while both actually move.
        // A missing avatar on the first frame must also keep excluded walkers held.
        for (let frame = 1; frame <= 32; frame++) {
          reference.update(0.1, frame * 0.1);
          followWalker(frame === 32 ? 2.99 : 1);
          crowd.setCameraFocus(focus.x, focus.y, focus.z, null, null, frame === 1 ? null : cat);
          crowd.update(0.1, frame * 0.1);
          assertHeld();
        }
        // Beyond 3 m the held walker uses the existing half-second dither, with no new delay.
        for (let frame = 1; frame <= 5; frame++) {
          reference.update(0.1, 3.2 + frame * 0.1);
          followWalker(3.01);
          crowd.setCameraFocus(focus.x, focus.y, focus.z, null, null, cat);
          crowd.update(0.1, 3.2 + frame * 0.1);
          people.getMatrixAt(0, matrix);
          expect(matrix.determinant()).not.toBe(0);
          expect(fade()).toBeCloseTo(state === "visible" ? 1 : frame / 5);
        }
      } finally { crowd.dispose(); reference.dispose(); }
    }
  });

  it.each([56, 150])("keeps a commuter drawn through the 0.03 s single-frame focus overlap (#1454, %i tier)", (count) => {
    const crowd = buildCrowd(THREE, path, toRenderer, count, new THREE.Texture());
    try {
      const people = (crowd.group.children as THREE.InstancedMesh[]).find(m => m.name === "crowd_low" || m.name === "crowd_torso")!;
      const matrix = new THREE.Matrix4();
      people.getMatrixAt(0, matrix);
      const x = matrix.elements[12]!, z = matrix.elements[14]!;
      const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
      camera.position.set(x, 0.9, z + 7);
      camera.lookAt(x, 0.9, z);
      const away = new THREE.Vector3(x + 10, 0.9, z + 7);
      crowd.setCameraFocus(away.x, away.y, away.z, null, { camera, floorY: 0 }, away);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      crowd.setCameraFocus(away.x, away.y, away.z, null, null, away);
      crowd.update(1 / 60, 1 / 60);
      // The first guide focus crosses the walker for one update; the distant avatar is independent.
      const fade = people.geometry.getAttribute("openingFade");
      crowd.setCameraFocus(x, 0.9, z - 2, null, null, away);
      crowd.update(1 / 60, 2 / 60);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      expect(fade.getX(0)).toBeGreaterThan(0);
      expect(fade.getX(0)).toBeLessThan(1);
      // Conversely, an avatar behind the walker must not become a focus-line occluder.
      crowd.setCameraFocus(away.x, away.y, away.z, null, null, new THREE.Vector3(x, 0.9, z - 2));
      crowd.update(1 / 60, 3 / 60);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      expect(fade.getX(0)).toBeCloseTo(1);
      // A sustained overlap still clears the camera-to-focus line.
      crowd.setCameraFocus(x, 0.9, z - 2, null, null, away);
      crowd.update(0.2, 0.25);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).toBe(0);
    } finally { crowd.dispose(); }
  });

  it("fades a returned commuter when the guide focus crosses it at 3.87 s (#1454)", () => {
    const crowd = buildCrowd(THREE, path, toRenderer, 56, new THREE.Texture());
    try {
      const people = crowd.group.children[0] as THREE.InstancedMesh;
      const matrix = new THREE.Matrix4();
      people.getMatrixAt(0, matrix);
      const x = matrix.elements[12]!, z = matrix.elements[14]!;
      const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
      camera.position.set(x, 0.9, z + 4);
      camera.lookAt(x, 0.9, z);
      const avatar = new THREE.Vector3(x, 0.9, z + 4.7);
      crowd.setCameraFocus(null, 0, 0, null, { camera, floorY: 0 }, avatar);
      expect(people.geometry.getAttribute("openingFade").getX(0)).toBe(0);
      camera.position.set(x + 0.46, 0.9, z + 7);
      crowd.setCameraFocus(null, 0, 0, null, { camera, floorY: 0 }, avatar);
      crowd.setCameraFocus(null, 0, 0, null, null, avatar);
      crowd.update(0.5, 231 / 60);

      // The recorded update moves the guide focus line inside the 45 cm radius.
      // Re-centre on the returned walker's position after its half-second return.
      people.getMatrixAt(0, matrix);
      const returnedX = matrix.elements[12]!;
      const fade = people.geometry.getAttribute("openingFade");
      crowd.setCameraFocus(returnedX + 1, 0.9, z - 1, null, null, avatar);
      crowd.update(0, 231 / 60);
      people.getMatrixAt(0, matrix);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      expect(fade.getX(0)).toBe(1);
      crowd.setCameraFocus(returnedX + 0.20, 0.9, z - 1, null, null, avatar);
      crowd.update(1 / 60, 232 / 60);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      expect(fade.getX(0)).toBeGreaterThan(0);
      expect(fade.getX(0)).toBeLessThan(1);
    } finally { crowd.dispose(); }
  });

  it.each([56, 150])("excludes the three opening zones and keeps a walker 7 m ahead visible (%i tier)", (count) => {
    for (const zone of ["near", "segment", "half-sunk", "stairs"] as const) {
      const crowd = buildCrowd(THREE, path, toRenderer, count, new THREE.Texture());
      try {
        const meshes = crowd.group.children as THREE.InstancedMesh[];
        const people = meshes.find(m => m.name === "crowd_low" || m.name === "crowd_torso")!;
        const matrix = new THREE.Matrix4();
        people.getMatrixAt(0, matrix);
        const x = matrix.elements[12]!, z = matrix.elements[14]!;
        const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
        camera.position.set(x, 0.9, z + (zone === "near" ? 4 : zone === "segment" ? 6 : 7));
        camera.lookAt(x, 0.9, z);
        camera.updateMatrixWorld(true);
        const cat = zone === "segment" ? new THREE.Vector3(x, 0.9, z + 0.5)
          : zone === "near" ? new THREE.Vector3(x + 2, 0.9, z + 4)
          : zone === "half-sunk" ? new THREE.Vector3(x + 3, 1.3, z + 4)
          : new THREE.Vector3(x, -0.4, z + 4);
        const opening = { camera, floorY: zone === "half-sunk" ? 1 : zone === "stairs" ? -1 : 0 };
        // setCameraFocus applies the exclusion immediately, before any camera render callback.
        crowd.setCameraFocus(cat.x, cat.y, cat.z, null, opening);
        people.getMatrixAt(0, matrix);
        expect(matrix.determinant() === 0, zone).toBe(zone !== "stairs");
        crowd.update(0, 0);
        people.getMatrixAt(0, matrix);
        expect(matrix.determinant() === 0, zone).toBe(zone !== "stairs");
        crowd.setCameraFocus(null, 0, 0, null, null, new THREE.Vector3(x + 10, 0.9, z));
        crowd.update(0.5, 0.5);
        people.getMatrixAt(0, matrix);
        expect(matrix.determinant(), `${zone} after hold`).not.toBe(0);
        expect(people.geometry.getAttribute("openingFade").getX(0)).toBe(1);
      } finally { crowd.dispose(); }
    }
  });

  it.each([56, 150])("fades a walker back in only after it leaves the opening zone (%i tier)", (count) => {
    const crowd = buildCrowd(THREE, path, toRenderer, count, new THREE.Texture());
    try {
      const meshes = crowd.group.children as THREE.InstancedMesh[];
      const people = meshes.find(m => m.name === "crowd_low" || m.name === "crowd_torso")!;
      const matrix = new THREE.Matrix4();
      people.getMatrixAt(0, matrix);
      const x = matrix.elements[12]!, z = matrix.elements[14]!;
      const camera = new THREE.PerspectiveCamera(70, 1.5, 0.05, 100);
      const cat = new THREE.Vector3(x + 3, 0.9, z + 4);
      camera.position.set(x, 0.9, z + 4);
      camera.lookAt(cat);
      const opening = { camera, floorY: 0 };
      crowd.setCameraFocus(cat.x, cat.y, cat.z, null, opening);
      crowd.update(0.1, 0.1);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).toBe(0);
      camera.position.z += 2;
      camera.lookAt(cat);
      crowd.setCameraFocus(cat.x, cat.y, cat.z, null, opening);
      people.getMatrixAt(0, matrix);
      expect(matrix.determinant()).not.toBe(0);
      expect(people.geometry.getAttribute("openingFade").getX(0)).toBe(0);
      crowd.update(0.1, 0.2);
      // Optional meshes pack only wearers; their slot 0 may belong to another walker.
      const bodyParts = new Set(["crowd_low", "crowd_torso", "crowd_head", "crowd_upper_arm", "crowd_forearm", "crowd_hand", "crowd_thigh", "crowd_shin", "crowd_shoe"]);
      for (const mesh of meshes.filter(m => bodyParts.has(m.name))) {
        const fade = mesh.geometry.getAttribute("openingFade").getX(0);
        expect(fade).toBeGreaterThan(0);
        expect(fade).toBeLessThan(1);
      }
      crowd.update(0.4, 0.6);
      expect(people.geometry.getAttribute("openingFade").getX(0)).toBe(1);
    } finally { crowd.dispose(); }
  });
});
