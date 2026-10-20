import * as THREE from "three";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRouter } from "@gteki/navigation";
import type { EdgeMode, PoiCategory, StationBundle } from "@gteki/schema";
import { createSyntheticBundle, syntheticEdge } from "../../../../packages/navigation/src/fixtures.ts";
import { loadShinjukuBundle } from "../../data/bundle.ts";
import planJson from "../../data/plan.json";
import { createAvatar, type Avatar } from "./avatar.ts";
import { createCrowd, type Crowd } from "./crowd.ts";

vi.mock("./avatar.ts", async () => {
  const { Group } = await import("three");
  return { createAvatar: vi.fn(() => ({
    object: new Group(), update: vi.fn(), setColorway: vi.fn(), setDistance: vi.fn(), dispose: vi.fn(),
  })) };
});

const focus = { x: 0, y: 10, z: 0 };
const crowds: Crowd[] = [];
beforeEach(() => vi.clearAllMocks());
afterEach(() => { for (const crowd of crowds) crowd.dispose(); crowds.length = 0; });

function fixture(mode: EdgeMode = "walk", z = 4, forward = false) {
  const bundle = createSyntheticBundle([
    syntheticEdge("a-b", "a", "b", { mode, lengthM: 20, direction: forward ? "forward" : "both" }),
  ]);
  bundle.nodes = [
    { ...bundle.nodes[0]!, id: "a", position: { x: 10, y: 10, z: -999 } },
    { ...bundle.nodes[0]!, id: "b", position: { x: mode === "elevator" ? 10 : 30, y: 10, z: -999 } },
  ];
  bundle.pois = bundle.nodes.map((node, i) => ({
    ...bundle.pois[0]!, id: `poi-${i}`, category: i === 0 ? "exit" : "platform", connectorNodeIds: [node.id],
  }));
  return { bundle, nodeZ: (id: string) => id === "b" ? z : 0 };
}
function crowdFor(f: ReturnType<typeof fixture>, max = 1, seed = 123) {
  const router = createRouter(f.bundle);
  const route = vi.spyOn(router, "route");
  const crowd = createCrowd(THREE, f.bundle, router, f.nodeZ, { max, seed });
  crowds.push(crowd);
  return { crowd, route };
}
function avatarAt(index: number): Avatar {
  return vi.mocked(createAvatar).mock.results[index]!.value as Avatar;
}

describe("decorative crowd", () => {
  it("passes viewer distance to LOD, pauses distant rig animation and keeps the same route moving", () => {
    const { crowd } = crowdFor(fixture("walk", 0, true));
    crowd.update(0, focus);
    const avatar = avatarAt(0), start = avatar.object.position.x;
    crowd.update(1, { x: -55, y: 10, z: 0 });
    expect(avatar.object.visible).toBe(true);
    expect(avatar.object.position.x).toBeGreaterThan(start);
    expect(vi.mocked(avatar.setDistance).mock.lastCall![0]).toBeGreaterThan(60);
    expect(avatar.update).not.toHaveBeenCalled();
    crowd.update(1 / 60, focus);
    expect(vi.mocked(avatar.setDistance).mock.lastCall![0]).toBeLessThan(25);
    expect(avatar.update).toHaveBeenCalledOnce();
  });

  it("uses routed POI connectors, personal speeds, ENU conversion and interpolated nodeZ", () => {
    const { crowd, route } = crowdFor(fixture());
    expect(route).toHaveBeenCalledWith("a", "b", { fare: "ticketed", stepFree: false });
    expect(route).toHaveBeenCalledWith("b", "a", { fare: "ticketed", stepFree: false });
    const calls = route.mock.calls.length;
    crowd.update(0, focus);
    expect(crowd.count).toBe(1);
    const object = crowd.group.children[0]!;
    const startX = object.position.x;
    crowd.update(1, focus);
    const travelled = Math.abs(object.position.x - startX) * Math.hypot(20, 4) / 20;
    expect(travelled).toBeGreaterThanOrEqual(1.15);
    expect(travelled).toBeLessThanOrEqual(1.55);
    expect(object.rotation.y).toBeCloseTo(startX === 10 ? -Math.PI / 2 : Math.PI / 2);
    for (let frame = 0; frame < 120; frame++) {
      crowd.update(1 / 60, focus);
      const t = (object.position.x - 10) / 20;
      expect(object.position.y).toBeCloseTo(t * 4, 8);
      expect(object.position.y).toBeGreaterThanOrEqual(0);
      expect(object.position.y).toBeLessThanOrEqual(4);
      expect(Math.abs(-object.position.z - 10)).toBeLessThanOrEqual(0.6);
    }
    expect(route).toHaveBeenCalledTimes(calls);
    expect(createAvatar).toHaveBeenCalledExactlyOnceWith(THREE, 1);
    expect(crowd.group.userData.decorative).toBe(true);
    expect(crowd.group.userData.disclaimer).toContain("not real crowd data");
  });

  it.each(["stairs", "escalator"] as const)("uses %s speed and stays inside the narrow run", (mode) => {
    const { crowd } = crowdFor(fixture(mode));
    crowd.update(0, focus);
    const object = crowd.group.children[0]!;
    const startX = object.position.x;
    crowd.update(1, focus);
    expect(Math.abs(object.position.x - startX) * Math.hypot(20, 4) / 20).toBeCloseTo(mode === "stairs" ? 0.7 : 0.5);
    for (let frame = 0; frame < 180; frame++) {
      crowd.update(1 / 60, focus);
      expect(Math.abs(-object.position.z - 10)).toBeLessThanOrEqual(0.25);
      expect(object.position.y).toBeCloseTo((object.position.x - 10) / 20 * 4, 8);
    }
    const update = vi.mocked(avatarAt(0).update);
    expect(update.mock.lastCall![1]).toBe(mode === "stairs" ? 0.7 : 0);
    expect(update.mock.lastCall![2]!.onStairs).toBe(mode === "stairs");
    if (mode === "escalator") expect(update.mock.lastCall![2]!.climbing).toBe(0);
    else expect(Math.abs(update.mock.lastCall![2]!.climbing!)).toBeGreaterThan(0);
  });

  it("carries time over directed edges and changes height and mode at each node", () => {
    const f = fixture("walk", 0, true);
    const middle = f.bundle.nodes[1]!;
    middle.position.x = 12;
    f.bundle.nodes.push({ ...middle, id: "c", position: { x: 16, y: 10, z: -999 } });
    f.bundle.edges.push(syntheticEdge("b-c", "b", "c", { mode: "stairs", lengthM: 5, direction: "forward" }));
    f.bundle.pois[1]!.connectorNodeIds = ["c"];
    f.nodeZ = (id: string) => id === "c" ? 3 : 0;
    const { crowd } = crowdFor(f);
    crowd.update(0, focus);
    const object = crowd.group.children[0]!;
    crowd.update(3, focus);
    expect(object.position.x).toBeGreaterThan(12);
    expect(object.position.x).toBeLessThan(16);
    expect(object.position.y).toBeCloseTo((object.position.x - 12) / 4 * 3, 8);
    expect(vi.mocked(avatarAt(0).update).mock.lastCall![1]).toBe(0.7);
  });

  it("despawns in an elevator for 20 seconds and reappears at its destination", () => {
    const { crowd } = crowdFor(fixture("elevator", 4, true));
    crowd.update(0, focus);
    const object = crowd.group.children[0]!;
    expect(object.visible).toBe(false);
    crowd.update(19.9, focus);
    expect(object.visible).toBe(false);
    expect(object.position.y).toBe(0);
    expect(avatarAt(0).update).not.toHaveBeenCalled();
    crowd.update(0.1, focus);
    expect(object.visible).toBe(true);
    expect(object.position.toArray()).toEqual([10, 4, -10]);
    expect(crowd.count).toBe(1);
  });

  it("prefers origins within 70 weighted metres, avoids nearby spawns, and culls other levels", () => {
    const f = fixture("walk", 0);
    f.bundle.nodes[0]!.position.x = 2;
    const { crowd } = crowdFor(f);
    crowd.update(0, focus);
    const object = crowd.group.children[0]!;
    expect(object.position.x).toBe(30);
    crowd.update(1 / 60, { ...focus, z: -9 });
    expect(object.visible).toBe(false);
    expect(avatarAt(0).update).not.toHaveBeenCalled();
    const x = object.position.x;
    crowd.update(1, { ...focus, z: -9 });
    expect(object.position.x).toBeLessThan(x); // hidden agents still travel
    crowd.update(0, focus);
    expect(object.visible).toBe(true);

    const far = fixture("walk", 0);
    far.bundle.nodes[1]!.position.x = 85;
    const { crowd: preferred } = crowdFor(far);
    preferred.update(0, focus);
    expect(preferred.group.children[0]!.position.x).toBe(10);
    const { crowd: fallback } = crowdFor(far);
    fallback.update(0, { ...focus, x: 10 });
    expect(fallback.group.children[0]!.position.x).toBe(85);
  });

  it("recycles completed/far routes without recreating avatars or querying the router", () => {
    const { crowd, route } = crowdFor(fixture("walk", 0));
    const calls = route.mock.calls.length;
    crowd.update(100, focus);
    const object = crowd.group.children[0]!;
    const end = object.position.x;
    expect([10, 30]).toContain(end);
    crowd.update(0.1, focus);
    expect(object.position.x).not.toBe(end);
    expect(route).toHaveBeenCalledTimes(calls);
    expect(createAvatar).toHaveBeenCalledTimes(1);
    crowd.update(0, { x: 1000, y: 1000, z: 0 });
    expect(crowd.count).toBe(0);
    expect(object.visible).toBe(false);
    crowd.update(0, focus);
    expect(crowd.count).toBe(1);
  });

  it("is reproducible with a seed, including recycling and separation", () => {
    const f = fixture("walk", 0);
    const a = crowdFor(f, 8, 765).crowd;
    const b = crowdFor(f, 8, 765).crowd;
    for (let frame = 0; frame < 1200; frame++) {
      a.update(1 / 30, focus);
      b.update(1 / 30, focus);
      expect(a.count).toBe(b.count);
      for (let i = 0; i < a.group.children.length; i++) {
        expect(a.group.children[i]!.position.toArray()).toEqual(b.group.children[i]!.position.toArray());
        expect(a.group.children[i]!.visible).toBe(b.group.children[i]!.visible);
      }
    }
    expect(a.count).toBeGreaterThan(2);
    // Passing agents stay on the route's lateral strip.
    for (const object of a.group.children) if (object.visible) expect(Math.abs(-object.position.z - 10)).toBeLessThanOrEqual(0.6);
  });

  it("keeps nearby agents separated on a busy corridor", () => {
    const { crowd } = crowdFor(fixture("walk", 0), 10, 8);
    let closest = Infinity;
    for (let frame = 0; frame < 900; frame++) {
      crowd.update(1 / 60, focus);
      const objects = crowd.group.children.filter((o) => o.visible);
      for (let i = 0; i < objects.length; i++) for (let j = i + 1; j < objects.length; j++) {
        closest = Math.min(closest, objects[i]!.position.distanceTo(objects[j]!.position));
      }
    }
    expect(crowd.count).toBeGreaterThan(2);
    expect(closest).toBeGreaterThanOrEqual(0.49);
  });

  it("walks the real station graph using the layout's render heights", () => {
    const { bundle } = loadShinjukuBundle();
    const heights: Record<string, number> = planJson.nodeRenderZ;
    const nodeZ = (id: string) => heights[id] ?? 0;
    const { crowd } = crowdFor({ bundle, nodeZ }, 40);
    const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
    const start = nodes.get(bundle.pois.find((p) => p.category === "ticket_gate")!.connectorNodeIds[0]!)!;
    const player = { x: start.position.x, y: start.position.y, z: nodeZ(start.id) };
    let visibleSamples = 0;
    for (let frame = 0; frame < 30; frame++) {
      crowd.update(0.1, player);
      for (const object of crowd.group.children) {
        if (!object.visible) continue;
        visibleSamples++;
        const x = object.position.x;
        const y = -object.position.z;
        const z = object.position.y;
        const onEdge = bundle.edges.some((e) => {
          if (e.verification !== "verified" || e.mode === "elevator") return false;
          const a = nodes.get(e.from)!.position;
          const b = nodes.get(e.to)!.position;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const length2 = dx * dx + dy * dy;
          if (length2 < 1e-10) return Math.hypot(x - a.x, y - a.y) < 1e-6 && Math.abs(z - nodeZ(e.from)) < 1e-6;
          const t = ((x - a.x) * dx + (y - a.y) * dy) / length2;
          const width = e.mode === "stairs" || e.mode === "escalator" ? 0.25 : 0.6;
          return t >= -1e-6 && t <= 1 + 1e-6
            && Math.hypot(x - a.x - t * dx, y - a.y - t * dy) <= width + 1e-6
            && Math.abs(z - (nodeZ(e.from) + (nodeZ(e.to) - nodeZ(e.from)) * t)) < 1e-6;
        });
        expect(onEdge).toBe(true);
        expect(Math.abs(z - player.z)).toBeLessThanOrEqual(8);
      }
    }
    expect(crowd.count).toBeGreaterThan(0);
    expect(visibleSamples).toBeGreaterThan(0);
  });

  it("tolerates unroutable/invalid connectors, and disposes resized pools exactly once", () => {
    const f = fixture("walk", 0);
    f.bundle.pois.push({ ...f.bundle.pois[0]!, id: "invalid", connectorNodeIds: ["missing", "a"] });
    const { crowd } = crowdFor(f, 3);
    expect(createAvatar).toHaveBeenNthCalledWith(3, THREE, 3);
    crowd.update(0, focus);
    expect(crowd.count).toBeLessThanOrEqual(3);
    crowd.setMax(1);
    expect(crowd.count).toBeLessThanOrEqual(1);
    expect(avatarAt(1).dispose).toHaveBeenCalledOnce();
    expect(avatarAt(2).dispose).toHaveBeenCalledOnce();
    crowd.setMax(8);
    expect(createAvatar).toHaveBeenLastCalledWith(THREE, 1);
    crowd.setMax(-1);
    expect(crowd.count).toBe(0);
    expect(crowd.group.children).toHaveLength(0);
    crowd.setMax(1);
    const last = avatarAt(10);
    const parent = new THREE.Group();
    parent.add(crowd.group);
    crowd.dispose();
    crowd.dispose();
    crowd.update(1, focus);
    crowd.setMax(20);
    expect(last.dispose).toHaveBeenCalledOnce();
    expect(crowd.count).toBe(0);
    expect(parent.children).toHaveLength(0);

    for (const category of ["shop", "exit"] as PoiCategory[]) {
      const empty = fixture();
      empty.bundle.edges = [];
      for (const poi of empty.bundle.pois) poi.category = category;
      const c = crowdFor(empty).crowd;
      c.update(1, focus);
      expect(c.count).toBe(0);
      expect(c.group.children[0]!.visible).toBe(false);
    }
  });
});
