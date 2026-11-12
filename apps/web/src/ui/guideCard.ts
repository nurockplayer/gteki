import type { Instruction } from "@gteki/navigation";

export function guideCardText(ins: Pick<Instruction, "text">, opts: { arrived: boolean; connector: boolean; name: string; lang: "en" | "ja"; t: { arrived: string; arrivedAt: (name: string) => string } }): { line: string; detail: string | null } {
  if (!opts.arrived || opts.connector) return { line: ins.text, detail: null };
  const bases = opts.lang === "ja"
    ? ["目的地に到着", "改札外側に到着（改札内は未モデル化）"]
    : ["Arrive at destination", "Arrived at the public side of the gate (inside the gate is not modelled)"];
  return { line: opts.name ? opts.t.arrivedAt(opts.name) : opts.t.arrived, detail: bases.includes(ins.text) ? null : ins.text };
}
