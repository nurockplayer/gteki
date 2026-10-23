import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { FOLLOW, FOV, NO_SLOPE, SLOPE, approachFov, avatarFade, boomSqueezed, clampDistance, constrainedPitch, easeRaise, followBoom, followDistance, followPose, raisedBack, stepSlope, targetFov, viewDirection } from "./followCamera.ts";

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

  it("keeps clearance before an obstruction but never collapses below the minimum", () => {
    expect(clampDistance(3, null)).toBe(3);
    expect(clampDistance(3, 2)).toBeCloseTo(2 - FOLLOW.clearance);
    expect(clampDistance(3, 0.1)).toBe(FOLLOW.minDistance);
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
    for (const h of cast(out.back)) expect(out.distance).toBeLessThanOrEqual(Math.max(FOLLOW.minDistance, h.distance - FOLLOW.clearance) + 1e-9);
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

  it("falls back to the shortened boom when no raise reaches the comfortable distance", () => {
    const { cast, calls } = scene(0.5, 5, 5); // a tall wall: no pitch gets over it
    const current = followDistance(wanted, cast(back0));
    calls.n = 0;
    expect(constrainedPitch(wanted, back0, current, cast, new THREE.Vector3())).toBe(0);
    expect(calls.n).toBe(FOLLOW.raiseSteps);
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
