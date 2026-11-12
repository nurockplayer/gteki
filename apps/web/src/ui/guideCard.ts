import type { Instruction } from "@gteki/navigation";

export function guideCardText(ins: Pick<Instruction, "text">, opts: { arrived: boolean; connector: boolean; name: string; lang: "en" | "ja"; next?: boolean; t: { arrived: string; arrivedAt: (name: string) => string } }): { line: string; detail: string | null } {
  if (!opts.arrived || opts.connector) {
    if (!opts.next) return { line: ins.text, detail: null };
    const clean = ins.text.replace(/GL[–-]B1 landing/g, "B1");
    const clauses = opts.lang === "ja"
      ? clean.split(/[、。…]/)
      : clean.split(/,|(?<!\d)\.|\.(?!\d)|…/);
    let clause = clauses.filter((part) => part.trim()).length === 1 && !clean.includes("…") ? clean.trim() : clauses[0]!.trim();
    const walkOnly = opts.lang === "ja"
      ? /^約\s*[\d.]+\s*m進み$/i.test(clause)
      : /^walk\s+(?:about|approximately|~)?\s*[\d.]+\s*m$/i.test(clause);
    if (walkOnly && clauses.length > 1) {
      clause = clauses[1]!.trim().replace(/^then\s+/i, "");
      if (opts.lang === "en") clause = clause.charAt(0).toUpperCase() + clause.slice(1);
    }
    const line = clause.length <= 36 ? clause : clause.slice(0, 36).replace(/\s+\S*$/, "");
    return { line: line || clause.slice(0, 36), detail: ins.text };
  }
  const bases = opts.lang === "ja"
    ? ["目的地に到着", "改札外側に到着（改札内は未モデル化）"]
    : ["Arrive at destination", "Arrived at the public side of the gate (inside the gate is not modelled)"];
  return { line: opts.name ? opts.t.arrivedAt(opts.name) : opts.t.arrived, detail: bases.includes(ins.text) ? null : ins.text };
}

export function escalatorArrow(startY: number, endY: number): string {
  return endY > startY ? "↑" : "↓";
}
