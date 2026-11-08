import { nodeDisplayZ } from "@gteki/navigation";
import type { Floor, Node } from "@gteki/schema";
import { R } from "./geometry.ts";

/** The kind of space a walk position sits in; see classifyZone for the rules. */
export type StationZone = "outdoor" | "platform" | "concourse" | "passage";

/** A zone anchor in renderer coordinates (the explorer's frame: x east, y up, z south). */
export interface ZoneAnchor {
  kind: "platform" | "ticket_gate" | "exit";
  x: number;
  y: number;
  z: number;
}

/**
 * Platform and ticket-gate graph nodes, plus exits on street-level floors and above (ordinal >= 0), in
 * renderer coordinates: the anchors classifyZone measures against. Exits on lower floors are underground
 * passages, and an exit whose floor is missing or has no ordinal is skipped.
 */
export function zoneAnchors(nodes: readonly Node[], floors: readonly Floor[]): ZoneAnchor[] {
  const byId = new Map(floors.map((f): [string, Floor] => [f.id, f]));
  const anchors: ZoneAnchor[] = [];
  for (const node of nodes) {
    if (node.kind !== "platform" && node.kind !== "ticket_gate" && node.kind !== "exit") continue;
    const floor = byId.get(node.floorId);
    if (node.kind === "exit" && !(floor && floor.ordinal !== null && floor.ordinal >= 0)) continue;
    const at = R(node.position.x, node.position.y, nodeDisplayZ(node, floor).z);
    anchors.push({ kind: node.kind, x: at.x, y: at.y, z: at.z });
  }
  return anchors;
}

const PLATFORM_RADIUS_M = 40;
const TICKET_GATE_RADIUS_M = 25;
const VERTICAL_LIMIT_M = 3;
const EXIT_RADIUS_M = 4;
const EXIT_VERTICAL_M = 1.5;

/**
 * First match wins: outdoors, then a street-level exit, then a platform anchor, then a ticket-gate anchor,
 * else passage.
 */
export function classifyZone(pos: { x: number; y: number; z: number }, outdoors: boolean, anchors: readonly ZoneAnchor[]): StationZone {
  if (outdoors) return "outdoor";
  // A walker standing at a street-level exit is outdoors, whether or not a canopy caps the sky probe.
  for (const anchor of anchors) {
    if (anchor.kind !== "exit") continue;
    if (Math.abs(pos.y - anchor.y) <= EXIT_VERTICAL_M && Math.hypot(pos.x - anchor.x, pos.z - anchor.z) <= EXIT_RADIUS_M) return "outdoor";
  }
  let concourse = false;
  for (const anchor of anchors) {
    if (Math.abs(pos.y - anchor.y) > VERTICAL_LIMIT_M) continue;
    const horizontal = Math.hypot(pos.x - anchor.x, pos.z - anchor.z);
    if (anchor.kind === "platform" && horizontal <= PLATFORM_RADIUS_M) return "platform";
    if (anchor.kind === "ticket_gate" && horizontal <= TICKET_GATE_RADIUS_M) concourse = true;
  }
  return concourse ? "concourse" : "passage";
}

/**
 * Art direction, not measured. Weak anchors from docs/research/gaps/DR-station-lighting-standards.md:
 * DR-LT-02 (Fukuoka Nanakuma example, concourse 400 lx, platform 300 lx or more, 5000 K).
 * No Toei, Tokyo Metro or JR East figure exists.
 */
export const ZONE_LOOK: Record<StationZone, { exposure: number; fogFar: number; tint: readonly [number, number, number] }> = {
  outdoor: { exposure: 1, fogFar: 1, tint: [1, 1, 1] },
  concourse: { exposure: 1.1, fogFar: 1, tint: [1, 0.95, 0.86] },
  platform: { exposure: 0.88, fogFar: 0.75, tint: [0.88, 0.95, 1] },
  passage: { exposure: 0.7, fogFar: 0.5, tint: [1, 0.9, 0.74] },
};
