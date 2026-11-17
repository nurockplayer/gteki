// Pre-#1378 solver, pinned from a0312ad0 (2026-11-17 JST) for the requested before/after replay.
import * as THREE from "three";
import { FOLLOW, followBoom, followDistance, raisedBack, easeRaise } from "../followCamera.ts";
function constrainedPitch(
  wanted: number,
  back: THREE.Vector3,
  current: number,
  cast: (back: THREE.Vector3) => readonly { distance: number; cameraOnly: boolean }[],
  scratch: THREE.Vector3,
  bodyHidden?: (back: THREE.Vector3, distance: number) => boolean,
): number {
  const comfort = Math.min(FOLLOW.comfortDistance, wanted);
  if (current >= comfort && !bodyHidden?.(back, current)) return 0;
  let best = 0;
  let bestDistance = current + FOLLOW.raiseGain;
  for (let i = 1; i <= FOLLOW.raiseSteps; i++) {
    const raise = (FOLLOW.maxRaise * i) / FOLLOW.raiseSteps;
    const distance = followDistance(wanted, cast(raisedBack(back, raise, scratch)));
    if (distance >= comfort && !bodyHidden?.(scratch, distance)) return raise;
    if (distance > bestDistance) { best = raise; bestDistance = distance; }
  }
  return current >= comfort ? 0 : best;
}

function solveRaisedBoom(
  wanted: number,
  back: THREE.Vector3,
  cast: (back: THREE.Vector3) => readonly { distance: number; cameraOnly: boolean }[],
  currentRaise: number,
  dt: number,
  snap = false,
  bodyHidden?: (back: THREE.Vector3, distance: number) => boolean,
  bodyHold?: { seconds: number; target: number },
): { back: THREE.Vector3; distance: number; raise: number; bodyDriven: boolean } {
  const base = followBoom(wanted, back, cast);
  const scratch = new THREE.Vector3();
  let baseHidden = false;
  let bodyDriven = false;
  const checkBody = bodyHidden && ((b: THREE.Vector3, distance: number) => {
    const hidden = bodyHidden(b, distance);
    bodyDriven ||= hidden;
    if (b === base.back) baseHidden = hidden;
    return hidden;
  });
  let target = constrainedPitch(wanted, base.back, base.distance, cast, scratch, checkBody);
  bodyDriven &&= target > 0;
  if (bodyHold) {
    if (snap) bodyHold.seconds = bodyHold.target = 0;
    if (baseHidden && target > 0) {
      bodyHold.seconds = 0.5;
      bodyHold.target = target;
    } else if (bodyHold.seconds > 0 && bodyHidden) {
      bodyHold.seconds = Math.max(0, bodyHold.seconds - dt);
      if (bodyHold.seconds > 0) {
        target = Math.max(target, bodyHold.target);
        bodyDriven = true;
      }
    } else {
      bodyHold.seconds = bodyHold.target = 0;
    }
  }
  let raise = easeRaise(currentRaise, target, dt, snap);
  if (bodyDriven && !snap) {
    const step = FOLLOW.bodyRaiseSpeed * Math.max(0, dt);
    raise = Math.max(currentRaise - step, Math.min(target, currentRaise + step));
  }
  let raised = raisedBack(base.back, raise, new THREE.Vector3());
  let distance = raise > 0 ? followDistance(wanted, cast(raised)) : base.distance;
  if (!snap && !bodyDriven && target > raise && distance < Math.min(FOLLOW.comfortDistance, wanted)) {
    const solved = raisedBack(base.back, target, scratch);
    const clear = followDistance(wanted, cast(solved));
    if (clear >= distance + FOLLOW.raiseGain) {
      raise = target;
      raised = solved.clone();
      distance = clear;
    }
  }
  return { back: raised, distance, raise, bodyDriven };
}
export { solveRaisedBoom };
