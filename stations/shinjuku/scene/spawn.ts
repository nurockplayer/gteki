import type { StationBundle } from "@gteki/schema";
import type { WalkWorld } from "./layout.ts";

/** Lane app's normal spawn, shared with identity placement and its CPU recognition proxy. */
export function stationSpawn(bundle: StationBundle, nodeZ: ReadonlyMap<string, number>, world: Pick<WalkWorld, "groundAt">, requestedNodeId?: string) {
  const gate = bundle.pois.find((p) => p.category === "ticket_gate");
  const nodes = new Map(bundle.nodes.map((n) => [n.id, n]));
  const node = nodes.get(requestedNodeId ?? "") ?? nodes.get(gate?.connectorNodeIds[0] ?? "") ?? bundle.nodes[0]!;
  let position = { x: node.position.x, y: node.position.y, z: nodeZ.get(node.id) ?? 0 };
  if (gate?.displayPosition) {
    const gp = gate.displayPosition;
    const dx = position.x - gp.x, dy = position.y - gp.y, length = Math.hypot(dx, dy) || 1;
    const back = { x: position.x + dx / length * 4, y: position.y + dy / length * 4 };
    const ground = world.groundAt(back, position.z);
    if (ground !== null) position = { ...back, z: ground };
  }
  const heading = gate?.displayPosition ? Math.atan2(gate.displayPosition.x - position.x, gate.displayPosition.y - position.y) : 0;
  return { position, heading, nodeId: node.id };
}
