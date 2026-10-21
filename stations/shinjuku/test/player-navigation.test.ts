import { describe, expect, it } from "vitest";
import { Player, chooseFollowCamera, type GuidePoint } from "../app/src/player.ts";
import type { WalkWorld } from "../scene/layout.ts";

function openWorld(
  groundAt: (x: number, y: number) => number | null = () => 0,
  firstWallHit: (a: { x: number; y: number }, b: { x: number; y: number }, z: number) => number = () => Infinity,
) {
  return {
    groundAt: (p: { x: number; y: number }) => groundAt(p.x, p.y),
    resolveWalls: (p: { x: number; y: number }) => p,
    firstWallHit,
  } as unknown as WalkWorld;
}

describe("guided corners", () => {
  // Fence ends can sit one body-width (0.32 m) off a verified route, so a fast guide must not swing
  // wide of a corner: before the fix ×4 + run overshot by up to 0.65 m.
  const outsideOvershoot = (turnDeg: number, multiplier: 1 | 2 | 4, fps: number) => {
    const t = (turnDeg * Math.PI) / 180;
    const corner = { x: 0, y: 10 };
    const end = { x: -10 * Math.sin(t), y: 10 + 10 * Math.cos(t) };
    const player = new Player(openWorld(), { x: 0, y: 0, z: 0 });
    let arrived = false;
    player.onGuideEvent = (event) => { if (event.type === "arrived") arrived = true; };
    player.startGuide([
      { x: 0, y: 0, z: 0, nodeId: "start" },
      { ...corner, z: 0, nodeId: "corner" },
      { ...end, z: 0, nodeId: "end" },
    ]);
    player.setGuideSpeed(multiplier);
    const dx = end.x - corner.x, dy = end.y - corner.y, len = Math.hypot(dx, dy);
    let worst = 0;
    for (let i = 0; i < 2000 && !arrived; i++) {
      player.update(1 / fps, { forward: 0, strafe: 0, run: true }, player.heading);
      // Left turn: the outside is +x of the first leg and the right of the second.
      const first = player.y <= corner.y ? player.x : -Infinity;
      const along = ((player.x - corner.x) * dx + (player.y - corner.y) * dy) / len;
      const second = along >= 0 ? ((player.x - corner.x) * dy - (player.y - corner.y) * dx) / len : -Infinity;
      worst = Math.max(worst, Math.min(Math.max(first, second), Math.hypot(player.x - corner.x, player.y - corner.y)));
    }
    expect(arrived).toBe(true);
    return worst;
  };

  it.each([30, 55, 90, 135])("stays within 0.1 m outside a %s° turn at ×1/×2/×4 + run, 20–60 fps", (turn) => {
    for (const multiplier of [1, 2, 4] as const)
      for (const fps of [20, 30, 60]) expect(outsideOvershoot(turn, multiplier, fps), `×${multiplier} ${fps} fps`).toBeLessThanOrEqual(0.1);
  });
});

describe("guided escalator carry", () => {
  it("carries at 0.5 m/s in 3D while keeping the rider idle", () => {
    const world = openWorld((x) => x * 0.75);
    const player = new Player(world, { x: 0, y: 0, z: 0 });
    const route: GuidePoint[] = [
      { x: 0, y: 0, z: 0, nodeId: "start" },
      { x: 4, y: 0, z: 3, escalator: true, nodeId: "top" },
    ];
    player.startGuide(route);
    let previous = { x: player.x, z: player.z };
    let distance3d = 0;
    let carriedFrames = 0;
    for (let i = 0; i < 60; i++) {
      player.update(1 / 30, { forward: 0, strafe: 0, run: false }, player.heading);
      if (!player.carriedByEscalator) continue;
      carriedFrames++;
      distance3d += Math.hypot(player.x - previous.x, player.z - previous.z);
      expect(player.onRun).toBe(false);
      expect(player.stridePhase).toBe(0);
      previous = { x: player.x, z: player.z };
    }
    expect(carriedFrames).toBeGreaterThan(50);
    expect(distance3d / (carriedFrames / 30)).toBeCloseTo(0.5, 1);
  });

  it("scales guided travel at 1x, 2x and 4x while leaving free walking unchanged", () => {
    const guidedDistance = (multiplier: 1 | 2 | 4) => {
      const player = new Player(openWorld(), { x: 0, y: 0, z: 0 });
      player.startGuide([
        { x: 0, y: 0, z: 0, nodeId: "start" },
        { x: 0, y: 100, z: 0, nodeId: "end" },
      ]);
      player.setGuideSpeed(multiplier);
      for (let i = 0; i < 90; i++) player.update(1 / 30, { forward: 0, strafe: 0, run: false }, 0);
      return player.y;
    };
    const one = guidedDistance(1);
    const two = guidedDistance(2);
    const four = guidedDistance(4);
    expect(two).toBeGreaterThan(one * 1.8);
    expect(four).toBeGreaterThan(two * 1.8);

    const freeAtOne = new Player(openWorld(), { x: 0, y: 0, z: 0 });
    const freeAtFour = new Player(openWorld(), { x: 0, y: 0, z: 0 });
    freeAtOne.setGuideSpeed(1);
    freeAtFour.setGuideSpeed(4);
    const input = { forward: 1, strafe: 0, run: false };
    for (let i = 0; i < 60; i++) {
      freeAtOne.update(1 / 30, input, 0);
      freeAtFour.update(1 / 30, input, 0);
    }
    expect(freeAtFour.y).toBeCloseTo(freeAtOne.y, 8);
  });

  it("carries a descending escalator rider down in route order", () => {
    const player = new Player(openWorld((x) => x * 0.75), { x: 4, y: 0, z: 3 });
    player.startGuide([
      { x: 4, y: 0, z: 3, nodeId: "top" },
      { x: 0, y: 0, z: 0, escalator: true, nodeId: "bottom" },
    ]);
    let arrived = false;
    player.onGuideEvent = (event) => { if (event.type === "arrived") arrived = true; };
    let carriedFrames = 0;
    for (let i = 0; i < 300 && !arrived; i++) {
      player.update(1 / 30, { forward: 0, strafe: 0, run: false }, player.heading);
      if (player.carriedByEscalator) {
        carriedFrames++;
        expect(player.onRun).toBe(false);
        expect(player.stridePhase).toBe(0);
      }
    }
    expect(carriedFrames).toBeGreaterThan(100);
    expect(arrived).toBe(true);
    expect(player.x).toBeLessThan(0.1);
    expect(player.z).toBeLessThan(0.1);
  });
});

describe("follow camera candidate selection", () => {
  it("raises and tilts above a short wall before shortening its boom", () => {
    const wall = openWorld(() => 0, (a: { x: number; y: number }, b: { x: number; y: number }, z: number) => {
      const crossesWallPlane = Math.min(a.y, b.y) <= -1 && Math.max(a.y, b.y) >= -1;
      return crossesWallPlane && z < 1.9 ? 0 : Infinity;
    });
    const anchor = { x: 0, y: 0, z: 1.1 };
    const camera = chooseFollowCamera(anchor, 0, -0.1, 3.6, wall, []);
    expect(Math.hypot(camera.x - anchor.x, camera.y - anchor.y, camera.z - anchor.z)).toBeGreaterThanOrEqual(3.42);
    expect(camera.z).toBeGreaterThan(anchor.z + 1.2);
  });

  it("keeps all selected positions clear of a ceiling surface", () => {
    const world = openWorld();
    const anchor = { x: 0, y: 0, z: 1.1 };
    const ceiling = [{ z: 2.4, rings: [[{ x: -5, y: -5 }, { x: 5, y: -5 }, { x: 5, y: 0.5 }, { x: -5, y: 0.5 }]] }];
    const camera = chooseFollowCamera(anchor, 0, -0.1, 3.6, world, ceiling);
    expect(Math.hypot(camera.x - anchor.x, camera.y - anchor.y, camera.z - anchor.z)).toBeGreaterThanOrEqual(3.42);
    expect(camera.z).toBeLessThan(2.16);
  });
});
