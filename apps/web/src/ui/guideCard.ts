import type { Instruction } from "@gteki/navigation";

export function guideCardText(ins: Pick<Instruction, "text">, opts: { arrived: boolean; connector: boolean; name: string; lang: "en" | "ja"; next?: boolean; t: { arrived: string; arrivedAt: (name: string) => string } }): { line: string; detail: string | null } {
  if (!opts.arrived || opts.connector) {
    if (!opts.next) return { line: ins.text, detail: null };
    const clean = ins.text.replace(/GL[–-]B1 landing/g, "B1");
    const clause = opts.lang === "ja"
      ? clean.split(/[、。]/)[0]!.replace(/約\s*[\d.]+\s*m/gi, "").trim()
      : clean.split(/[,.。]|…/)[0]!.replace(/(?:about|approximately|~)\s*[\d.]+\s*m\b/gi, "").trim();
    const line = clause.length <= 36 ? clause : clause.slice(0, 36).replace(/\s+\S*$/, "");
    return { line: line || clause.slice(0, 36), detail: ins.text };
  }
  const bases = opts.lang === "ja"
    ? ["目的地に到着", "改札外側に到着（改札内は未モデル化）"]
    : ["Arrive at destination", "Arrived at the public side of the gate (inside the gate is not modelled)"];
  return { line: opts.name ? opts.t.arrivedAt(opts.name) : opts.t.arrived, detail: bases.includes(ins.text) ? null : ins.text };
}
