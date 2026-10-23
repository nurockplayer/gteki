import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DESCENT, FOLLOW, FOV, NO_SLOPE, SLOPE, approachBoom, approachFov, avatarFade, boomSqueezed, clampDistance, descentAimDrop, fadeHold, constrainedPitch, easeRaise, followBoom, followDistance, followPose, patchCameraHold, raisedBack, solveRaisedBoom, stepSlope, targetFov, viewDirection } from "./followCamera.ts";

describe("follow camera", () => {
  it("stays under a 2.6 m ceiling at the default pitch and distance", () => {
    const head = new THREE.Vector3(0, 1.62, 0);
    const { pivot, back } = followPose(head, 0, -0.12);
    const cam = pivot.clone().addScaledVector(back, FOLLOW.defaultDistance);
    expect(cam.y).toBeLessThan(2.5);
    expect(cam.z).toBeGreaterThan(2.5); // behind a walker facing -Z
  });

  it("puts the pivot over the right shoulder for any yaw", () => {
    for (const yaw of [0, 1, -2.4]) {
      const head = new THREE.Vector3(3, 1.62, -4);
      const { pivot } = followPose(head, yaw, 0);
      const d = viewDirection(yaw, 0);
      // right = forward × up
      const right = d.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      expect(pivot.clone().sub(head).dot(right)).toBeCloseTo(FOLLOW.shoulder, 5);
    }
  });

  it("keeps clearance before an obstruction even when the preferred minimum is blocked", () => {
    expect(clampDistance(3, null)).toBe(3);
    expect(clampDistance(3, 2)).toBeCloseTo(2 - FOLLOW.clearance);
    expect(clampDistance(3, 0.1)).toBe(0);
    expect(clampDistance(3, 0.7)).toBeCloseTo(0.4);
  });
});

describe("followBoom", () => {
  type Hit = { distance: number; cameraOnly: boolean };
  /** A horizontal slab `height` above the pivot, hit by any boom that rises. */
  const slab = (height: number, cameraOnly: boolean) => (b: THREE.Vector3): Hit[] => (b.y > 1e-9 ? [{ distance: height / b.y, cameraOnly }] : []);
  const merge = (...casts: ((b: THREE.Vector3) => Hit[])[]) => (b: THREE.Vector3) => casts.flatMap((c) => c(b)).sort((a, c) => a.distance - c.distance);
  const back = (sin: number) => new THREE.Vector3(0, sin, Math.sqrt(1 - sin * sin));
  const wanted = FOLLOW.defaultDistance;

  it("leaves a boom with no hits unchanged", () => {
    const b = back(0.3);
    const out = followBoom(wanted, b, () => []);
    expect(out.back).toBe(b);
    expect(out.distance).toBe(wanted);
  });

  it("does not lower the boom when a wall limits the camera", () => {
    const b = back(0.3);
    let calls = 0;
    const cast = (): Hit[] => {
      calls++;
      return [{ distance: 1.5, cameraOnly: false }];
    };
    const out = followBoom(wanted, b, cast);
    expect(calls).toBe(1);
    expect(out.back).toBe(b);
    expect(out.distance).toBe(followDistance(wanted, cast()));
  });

  it("ignores a blocker behind a nearer wall that already limits the camera more", () => {
    const b = back(0.3);
    const cast = () => [{ distance: 1, cameraOnly: false }, { distance: 2, cameraOnly: true }];
    const out = followBoom(wanted, b, cast);
    expect(out.back).toBe(b);
    expect(out.distance).toBe(followDistance(wanted, cast()));
  });

  it("slides under a hanging blocker instead of pulling the camera in", () => {
    const b = back(0.5);
    const cast = slab(0.6, true);
    const pulledIn = followDistance(wanted, cast(b));
    expect(pulledIn).toBeLessThan(FOLLOW.boomKeep * wanted);
    const out = followBoom(wanted, b, cast);
    expect(out.back.y).toBeLessThan(b.y);
    expect(out.distance).toBeGreaterThanOrEqual(FOLLOW.boomKeep * wanted);
    expect(out.distance).toBe(followDistance(wanted, cast(out.back)));
    expect(out.back.length()).toBeCloseTo(1, 9);
    // Same horizontal heading.
    expect(out.back.x).toBeCloseTo(0, 9);
    expect(out.back.z).toBeGreaterThan(0);
  });

  it("takes the least-lowered boom that keeps enough distance", () => {
    const b = back(0.5);
    const cast = slab(0.6, true);
    const out = followBoom(wanted, b, cast);
    // The previous (less lowered) step must not have qualified.
    const stepSin = (i: number) => b.y + ((FOLLOW.lowestBoom - b.y) * i) / FOLLOW.boomSteps;
    const i = Math.round(((b.y - out.back.y) * FOLLOW.boomSteps) / (b.y - FOLLOW.lowestBoom));
    expect(out.back.y).toBeCloseTo(stepSin(i), 9);
    if (i > 1) expect(followDistance(wanted, cast(back(stepSin(i - 1))))).toBeLessThan(FOLLOW.boomKeep * wanted);
  });

  it("never raises the boom and never goes below the lowest elevation", () => {
    for (const sin of [0.9, 0.5, 0.14, 0.0, -0.05]) {
      const seen: number[] = [];
      const b = back(sin);
      // A sealed blocker everywhere: every candidate is tried.
      followBoom(wanted, b, (c) => {
        seen.push(c.y);
        return [{ distance: 0.5, cameraOnly: true }];
      });
      for (const y of seen) {
        expect(y).toBeLessThanOrEqual(sin + 1e-9);
        expect(y).toBeGreaterThanOrEqual(FOLLOW.lowestBoom - 1e-9);
      }
      expect(seen.length).toBe(sin > FOLLOW.lowestBoom ? 1 + FOLLOW.boomSteps : 1);
      if (sin > FOLLOW.lowestBoom) expect(seen[seen.length - 1]).toBeCloseTo(FOLLOW.lowestBoom, 9);
    }
  });

  it("skips lowering for a boom already at or below the lowest elevation, and for a vertical boom", () => {
    let calls = 0;
    const cast = (): Hit[] => {
      calls++;
      return [{ distance: 0.5, cameraOnly: true }];
    };
    const low = back(FOLLOW.lowestBoom - 0.05);
    expect(followBoom(wanted, low, cast).back).toBe(low);
    const up = new THREE.Vector3(0, 1, 0);
    expect(followBoom(wanted, up, cast).back).toBe(up);
    expect(calls).toBe(2);
  });

  it("keeps the boom when no lowering gains enough", () => {
    const b = back(0.5);
    // A blocker pocket all around the pivot: every direction is stopped at the same distance.
    const out = followBoom(wanted, b, () => [{ distance: 0.5, cameraOnly: true }]);
    expect(out.back).toBe(b);
    expect(out.distance).toBe(followDistance(wanted, [{ distance: 0.5, cameraOnly: true }]));
  });

  it("falls back to the best lowered boom when none keeps the full share, if it clearly gains", () => {
    const b = back(0.5);
    // A cap right above the pivot plus a floor 0.5 m below: only a near-horizontal boom has room, and the floor
    // then limits it to ~2.2 m (short of 0.85 * wanted).
    const floor = (b2: THREE.Vector3): Hit[] => (b2.y < -1e-9 ? [{ distance: 0.5 / -b2.y, cameraOnly: false }] : []);
    const cast = merge(slab(0.02, true), floor);
    const d0 = followDistance(wanted, cast(b));
    const out = followBoom(wanted, b, cast);
    expect(out.distance).toBeGreaterThanOrEqual(d0 + FOLLOW.boomGain);
    expect(out.distance).toBe(followDistance(wanted, cast(out.back)));
    // Never reports a distance past what is clear along the chosen boom.
    for (const h of cast(out.back)) expect(out.distance).toBeLessThanOrEqual(Math.max(0, h.distance - FOLLOW.clearance) + 1e-9);
  });
});

describe("follow camera FOV", () => {
  it("narrows third person only; first person and overview keep 60", () => {
    expect(targetFov("walk", false)).toBe(FOV.follow);
    expect(targetFov("guide", false)).toBe(FOV.follow);
    expect(FOV.follow).toBe(50);
    expect(targetFov("walk", true)).toBe(60);
    expect(targetFov("guide", true)).toBe(60);
    expect(targetFov("overview", false)).toBe(60);
    expect(targetFov("overview", true)).toBe(60);
  });

  it("eases the same over one second at 30, 60 and 144 Hz", () => {
    const after = (hz: number, seconds: number) => {
      let f = 60;
      for (let i = 0; i < Math.round(hz * seconds); i++) f = approachFov(f, 50, 1 / hz);
      return f;
    };
    const at60 = after(60, 0.2);
    expect(after(30, 0.2)).toBeCloseTo(at60, 6);
    expect(after(144, 0.2)).toBeCloseTo(at60, 1);
    // One time constant covers about 63% of the way.
    expect(after(60, FOV.settle)).toBeCloseTo(50 + 10 * Math.exp(-1), 1);
  });

  it("never overshoots and lands exactly on the target", () => {
    for (const [from, to] of [[60, 50], [50, 60]] as const) {
      let f: number = from;
      for (let i = 0; i < 240; i++) {
        const next = approachFov(f, to, 1 / 60);
        expect(Math.abs(next - to)).toBeLessThanOrEqual(Math.abs(f - to));
        expect(Math.sign(next - to) * Math.sign(from - to)).toBeGreaterThanOrEqual(0);
        f = next;
      }
      expect(f).toBe(to);
    }
  });

  it("holds still for a zero or negative frame time", () => {
    expect(approachFov(55, 50, 0)).toBe(55);
    expect(approachFov(55, 50, -1)).toBe(55);
  });
});

describe("slope lens", () => {
  it("widens third person to 60 on a slope; overview is unchanged", () => {
    expect(targetFov("guide", false, true)).toBe(FOV.firstPerson);
    expect(targetFov("walk", false, true)).toBe(FOV.firstPerson);
    expect(targetFov("guide", false, false)).toBe(FOV.follow);
    expect(targetFov("overview", false, true)).toBe(FOV.overview);
  });

  it("widens third person when the boom is squeezed", () => {
    expect(targetFov("guide", false, true)).toBe(60);
  });

  const run = (state: typeof NO_SLOPE, vy: number, seconds: number, dt = 1 / 60) => {
    for (let i = 0; i < Math.round(seconds / dt); i++) state = stepSlope(state, vy * dt, dt);
    return state;
  };

  it("turns on for a climb or descent and off on level ground after the hold", () => {
    let s = run(NO_SLOPE, 0.8, 0.5);
    expect(s.on).toBe(true);
    s = run(s, -0.8, 0.5);
    expect(s.on).toBe(true);
    s = run(s, 0, SLOPE.hold * 0.5);
    expect(s.on).toBe(true);
    s = run(s, 0, 1.5);
    expect(s.on).toBe(false);
  });

  it("ignores slow drift and a single step-height blip", () => {
    expect(run(NO_SLOPE, 0.1, 5).on).toBe(false);
    const blip = stepSlope(NO_SLOPE, 0.15, 1 / 60);
    expect(stepSlope(run(NO_SLOPE, 0, 1), 0.02, 1 / 60).on).toBe(false);
  });

  it("keeps the teleport threshold above a frame of climbing", () => {
    expect(SLOPE.jump).toBeGreaterThanOrEqual(0.3);
    expect(stepSlope(NO_SLOPE, 0.05, 0.1).on).toBe(false);
    expect(run(NO_SLOPE, 0.5, 0.3).on).toBe(true);
  });

  it("does not flutter when a landing dips just under the exit speed briefly", () => {
    let s = run(NO_SLOPE, 0.8, 0.5);
    s = run(s, 0, 0.3);
    s = run(s, 0.8, 0.3);
    expect(s.on).toBe(true);
    expect(s.level).toBe(0);
  });

  it("is frame-rate independent", () => {
    const at = (hz: number) => run(NO_SLOPE, 0.5, 0.3, 1 / hz).speed;
    expect(at(30)).toBeCloseTo(at(144), 1);
  });

  it("keeps signed direction separately so reversing does not cancel the absolute-speed detector", () => {
    let s = run(NO_SLOPE, -0.4, 1);
    expect(s.velocity).toBeLessThan(-0.39);
    s = run(s, 0.4, 0.15);
    expect(s.velocity).toBeGreaterThan(0);
    expect(s.speed).toBeGreaterThan(0.39);
    expect(s.on).toBe(true);
  });

  it("recognises an explicit stair span even on a snap and keeps the ordinary landing hold", () => {
    let s = stepSlope(NO_SLOPE, 0, 0, true);
    expect(s.on).toBe(true);
    for (let frame = 0; frame < 120; frame++) s = stepSlope(s, 0.05 / 60, 1 / 60, true);
    expect(s.speed).toBeLessThan(SLOPE.enter);
    s = run(s, 0, SLOPE.hold - 1 / 60);
    expect(s.on).toBe(true);
    s = run(s, 0, 2 / 60);
    expect(s.on).toBe(false);
  });
});

describe("descent aim", () => {
  it("leaves level/upward motion and non-slope drift unchanged", () => {
    expect(descentAimDrop(NO_SLOPE)).toBe(0);
    expect(descentAimDrop({ ...NO_SLOPE, on: true, velocity: 0.5 })).toBe(0);
    expect(descentAimDrop({ ...NO_SLOPE, velocity: -0.1 })).toBe(0);
  });

  it("builds a bounded downward aim smoothly with descent speed", () => {
    let previous = 0;
    for (let speed = 0; speed <= 2; speed += 0.01) {
      const drop = descentAimDrop({ ...NO_SLOPE, on: true, velocity: -speed });
      expect(drop).toBeGreaterThanOrEqual(previous);
      expect(drop).toBeLessThanOrEqual(DESCENT.maxDrop);
      previous = drop;
    }
    expect(descentAimDrop({ ...NO_SLOPE, on: true, velocity: -0.001 })).toBeLessThan(0.001);
  });
});

describe("squeeze lens", () => {
  it("uses hysteresis around the comfortable boom distance", () => {
    expect(boomSqueezed(false, FOLLOW.comfortDistance)).toBe(false);
    expect(boomSqueezed(false, 1.59)).toBe(true);
    expect(boomSqueezed(true, 1.7)).toBe(true);
    expect(boomSqueezed(true, 1.91)).toBe(false);
    expect(boomSqueezed(false, 1.7)).toBe(false);
  });
});

describe("constrainedPitch", () => {
  type Hit = { distance: number; cameraOnly: boolean };
  const wanted = FOLLOW.defaultDistance;
  const back0 = new THREE.Vector3(0, 0.14, 1).normalize();
  /** A wall `wallAt` m behind the pivot, `wallTop` above it, and a slab `slabAt` above. Counts casts. */
  const scene = (wallAt: number, wallTop: number, slabAt: number) => {
    const calls = { n: 0 };
    const cast = (b: THREE.Vector3): Hit[] => {
      calls.n++;
      const hits: Hit[] = [];
      const flat = Math.hypot(b.x, b.z);
      const wallD = wallAt / flat;
      if (b.y * wallD < wallTop) hits.push({ distance: wallD, cameraOnly: false });
      if (b.y > 1e-9) hits.push({ distance: slabAt / b.y, cameraOnly: true });
      return hits.sort((a, c) => a.distance - c.distance);
    };
    return { cast, calls };
  };

  it("raises the boom over a wall 0.5 m behind with a slab above, reaching the comfortable distance", () => {
    const { cast, calls } = scene(0.5, 0.25, 1.9);
    const current = followDistance(wanted, cast(back0));
    expect(current).toBeLessThan(FOLLOW.comfortDistance);
    calls.n = 0;
    const raise = constrainedPitch(wanted, back0, current, cast, new THREE.Vector3());
    expect(raise).toBeGreaterThan(0);
    expect(raise).toBeLessThanOrEqual(FOLLOW.maxRaise + 1e-9);
    expect(calls.n).toBeLessThanOrEqual(FOLLOW.raiseSteps);
    const raised = raisedBack(back0, raise, new THREE.Vector3());
    expect(raised.length()).toBeCloseTo(1, 6);
    expect(followDistance(wanted, cast(raised))).toBeGreaterThanOrEqual(FOLLOW.comfortDistance);
    // the smallest step that works: the one below it does not reach
    const step = FOLLOW.maxRaise / FOLLOW.raiseSteps;
    if (raise > step + 1e-9) {
      const lower = raisedBack(back0, raise - step, new THREE.Vector3());
      expect(followDistance(wanted, cast(lower))).toBeLessThan(FOLLOW.comfortDistance);
    }
  });

  it("leaves an open boom alone and casts no extra rays", () => {
    let n = 0;
    const cast = (): Hit[] => (n++, []);
    expect(constrainedPitch(wanted, back0, wanted, cast, new THREE.Vector3())).toBe(0);
    expect(n).toBe(0);
  });

  it("takes the best shortened raised boom when a tall wall prevents comfortable distance", () => {
    const { cast, calls } = scene(0.5, 5, 5); // a tall wall: no pitch gets over it
    const current = followDistance(wanted, cast(back0));
    calls.n = 0;
    const raise = constrainedPitch(wanted, back0, current, cast, new THREE.Vector3());
    expect(raise).toBeCloseTo(FOLLOW.maxRaise, 12);
    expect(calls.n).toBe(FOLLOW.raiseSteps);
    const distance = followDistance(wanted, cast(raisedBack(back0, raise, new THREE.Vector3())));
    expect(distance).toBeGreaterThan(current + FOLLOW.raiseGain);
    expect(distance).toBeLessThan(FOLLOW.comfortDistance);
  });

  /** Elevation raise (radians) of a candidate boom over `back0`. */
  const raiseOf = (b: THREE.Vector3) => Math.asin(b.y) - Math.asin(back0.y);
  const deg = (r: number) => (r * 180) / Math.PI;

  it("finds a raise that clears only at a steep angle (distance is not monotonic in the raise)", () => {
    let n = 0;
    // blocked at every middling angle, clear only in a 44-51 degree window
    const cast = (b: THREE.Vector3): Hit[] => {
      n++;
      const r = deg(raiseOf(b));
      return [{ distance: r > 44 && r < 51 ? 6 : 1.0, cameraOnly: false }];
    };
    const raise = constrainedPitch(wanted, back0, 0.74, cast, new THREE.Vector3());
    expect(deg(raise)).toBeGreaterThanOrEqual(45 - 1e-6);
    expect(deg(raise)).toBeLessThanOrEqual(50 + 1e-6);
    expect(n).toBeLessThanOrEqual(FOLLOW.raiseSteps);
  });

  it("takes the longest raised boom when none is comfortable, if it beats the unraised one", () => {
    // booms of 0.9, 1.1, 1.3 (best), 1.2, 1.0 m at 10..50 degrees; 0.7 m unraised
    const table = [0.9, 1.1, 1.3, 1.2, 1.0];
    const cast = (b: THREE.Vector3): Hit[] => {
      const step = Math.round(deg(raiseOf(b)) / 10);
      return [{ distance: table[step - 1]! + FOLLOW.clearance, cameraOnly: false }];
    };
    const raise = constrainedPitch(wanted, back0, 0.7, cast, new THREE.Vector3());
    expect(deg(raise)).toBeCloseTo(30, 6);
  });

  it("stays unraised when no raised boom beats the unraised one", () => {
    const cast = (): Hit[] => [{ distance: 0.5 + FOLLOW.clearance, cameraOnly: false }];
    expect(constrainedPitch(wanted, back0, 0.8, cast, new THREE.Vector3())).toBe(0);
  });

  it("eases the raise toward its target and snaps on request", () => {
    expect(easeRaise(0, 0.5, 0.016, true)).toBe(0.5);
    const a = easeRaise(0, 0.5, 0.016);
    expect(a).toBeGreaterThan(0);
    expect(a).toBeLessThan(0.5);
    expect(easeRaise(a, 0.5, 10)).toBe(0.5);
  });
});

describe("avatarFade", () => {
  it("is opaque from 1.0 m out, fadeMin at the closest camera distance, and never below that", () => {
    expect(avatarFade(FOLLOW.defaultDistance)).toBe(1);
    expect(avatarFade(FOLLOW.fadeStart)).toBe(1);
    expect(avatarFade(FOLLOW.minDistance)).toBeCloseTo(FOLLOW.fadeMin, 9);
    expect(avatarFade(0)).toBeCloseTo(FOLLOW.fadeMin, 9);
  });

  it("is monotonic non-decreasing with distance", () => {
    let last = -Infinity;
    for (let d = 0; d <= 4; d += 0.01) {
      const f = avatarFade(d);
      expect(f).toBeGreaterThanOrEqual(last - 1e-12);
      last = f;
    }
  });
});

describe("solved raise after a slab squeeze", () => {
  const back = new THREE.Vector3(0, 0.14, 1).normalize();
  // A slab lip behind the walker: the shallow boom hits its edge, the steeper boom clears it.
  const cast = (b: THREE.Vector3) => b.y / b.z < 0.6 ? [{ distance: 0.8, cameraOnly: false }] : [];

  it("takes the solved raise on the first seek/restart frame, independent of the old pose", () => {
    for (const oldRaise of [0, FOLLOW.maxRaise]) {
      const solved = solveRaisedBoom(FOLLOW.defaultDistance, back, cast, oldRaise, 1 / 60, true);
      expect(solved.raise).toBeGreaterThan(0);
      expect(solved.distance).toBe(FOLLOW.defaultDistance);
      expect(solved.back.y / solved.back.z).toBeGreaterThanOrEqual(0.6);
    }
  });

  it("does not ease through the lip while walking when the solved raised boom clears it", () => {
    const solved = solveRaisedBoom(FOLLOW.defaultDistance, back, cast, 0, 1 / 60);
    expect(solved.distance).toBe(FOLLOW.defaultDistance);
    expect(solved.raise).toBeGreaterThan(0);
    expect(cast(solved.back)).toEqual([]);
  });

  it("clears stale raise immediately on a seek to open space and eases it during walking", () => {
    expect(solveRaisedBoom(3, back, () => [], 0.5, 1 / 60, true).raise).toBe(0);
    const walking = solveRaisedBoom(3, back, () => [], 0.5, 1 / 60);
    expect(walking.raise).toBeGreaterThan(0);
    expect(walking.raise).toBeLessThan(0.5);
  });
});

describe("boom contraction", () => {
  it("ramps distance and fade monotonically over multiple 60 Hz frames after a sudden occluder", () => {
    const hit = 1.05;
    const target = clampDistance(FOLLOW.defaultDistance, hit);
    let distance: number = FOLLOW.defaultDistance;
    let fade = avatarFade(distance);
    let rampFrames = 0;
    for (let frame = 0; frame < 60; frame++) {
      const next = approachBoom(distance, target, hit, 0.05, 1 / 60);
      const nextFade = avatarFade(next);
      expect(next).toBeLessThanOrEqual(distance);
      expect(next).toBeLessThanOrEqual(hit - 0.05 - FOLLOW.nearEpsilon + 1e-12);
      expect(nextFade).toBeLessThanOrEqual(fade);
      if (nextFade < fade) rampFrames++;
      if (frame > 0) expect(distance - next).toBeLessThanOrEqual(FOLLOW.contractSpeed / 60 + 1e-12);
      distance = next;
      fade = nextFade;
    }
    expect(rampFrames).toBeGreaterThanOrEqual(3);
    expect(distance).toBeCloseTo(target);
    expect(fade).toBeCloseTo(avatarFade(target));
  });

  it("only cuts to the safety margin first, then contracts at the bounded speed", () => {
    const first = approachBoom(3, 0.6, 0.9, 0.05, 1 / 60);
    expect(first).toBeCloseTo(0.83);
    expect(approachBoom(first, 0.6, 0.9, 0.05, 1 / 60)).toBeCloseTo(first - FOLLOW.contractSpeed / 60);
  });

  it.each([0.98, FOLLOW.defaultDistance])("settles at full clearance even when the caller's target is %s", (target) => {
    const hit = 1.05;
    let distance = approachBoom(FOLLOW.defaultDistance, target, hit, 0.05, 1 / 60);
    expect(distance).toBeCloseTo(hit - 0.05 - FOLLOW.nearEpsilon);
    for (let frame = 1; frame <= 60; frame++) {
      const next = approachBoom(distance, target, hit, 0.05, 1 / 60);
      expect(next).toBeLessThanOrEqual(distance);
      expect(distance - next).toBeLessThanOrEqual(FOLLOW.contractSpeed / 60 + 1e-12);
      distance = next;
    }
    expect(distance).toBeCloseTo(hit - FOLLOW.clearance, 9);
    expect(hit - distance).toBeGreaterThanOrEqual(FOLLOW.clearance - 1e-9);
  });

  it("snaps for reduced motion/placements, keeps extension damping, and ignores negative time", () => {
    expect(approachBoom(3, 0.75, 1.05, 0.05, 1 / 60, true)).toBe(0.75);
    expect(approachBoom(0.7, 0.8, null, 0.05, 1 / 60)).toBe(0.8);
    expect(approachBoom(0.9, 0.7, null, 0.05, -1)).toBe(0.9);
  });

  it("is independent of frame rate while contracting inside the safety band", () => {
    const run = (hz: number) => {
      let d = 0.98;
      for (let i = 0; i < hz / 5; i++) d = approachBoom(d, 0.6, 1.05, 0.05, 1 / hz);
      return d;
    };
    expect(run(30)).toBeCloseTo(run(60), 9);
    expect(run(60)).toBeCloseTo(run(120), 9);
  });
});

describe("close wall fallback", () => {
  it("permits a closer shoulder pose with near-plane clearance when the minimum is blocked", () => {
    for (const hit of [0.1, 0.4, 0.7]) {
      const target = followDistance(3, [{ distance: hit, cameraOnly: false }]);
      const actual = approachBoom(3, target, hit, 0.05, 1 / 60, true);
      expect(actual).toBeLessThan(FOLLOW.minDistance);
      expect(actual).toBeGreaterThanOrEqual(0);
      expect(hit - actual).toBeGreaterThanOrEqual(0.05 + FOLLOW.nearEpsilon);
    }
  });

  it("bounds the boom by a larger near plane as well as the preferred clearance", () => {
    expect(approachBoom(3, 0.5, 0.8, 0.4, 1 / 60, true)).toBeCloseTo(0.38);
    expect(approachBoom(3, 0, 0.01, 0.05, 1 / 60, true)).toBe(0);
  });
});

describe("QA camera holds", () => {
  it("merges only supplied finite controls, clamps them, and releases with null", () => {
    const initial = { yaw: 1, pitch: -0.2, distance: 2 };
    expect(patchCameraHold(initial, { pitch: -0.5 })).toEqual({ ...initial, pitch: -0.5 });
    expect(initial.pitch).toBe(-0.2);
    expect(patchCameraHold(initial, { yaw: NaN, pitch: Infinity, distance: -Infinity })).toEqual(initial);
    expect(patchCameraHold({}, { yaw: 10, pitch: 9, distance: -1 })).toEqual({ yaw: 10, pitch: 0.5, distance: 0 });
    expect(patchCameraHold({}, { pitch: -9, distance: 20 })).toEqual({ pitch: -1.1, distance: 9 });
    expect(patchCameraHold(initial, null)).toEqual({});
  });

  it("allows a reproducible mid fade and releases or sanitizes invalid overrides", () => {
    expect(fadeHold(0.5)).toBe(0.5);
    expect(fadeHold(0)).toBe(0);
    expect(fadeHold(-1)).toBe(0);
    expect(fadeHold(2)).toBe(1);
    expect(fadeHold(null)).toBeNull();
    expect(fadeHold(NaN)).toBeNull();
    expect(fadeHold(Infinity)).toBeNull();
  });
});
