import type { NoPathCause, NoPathOption } from "@gteki/navigation";
import type { Strings } from "./i18n.ts";

/** The options the profile chips can turn off (avoided modes have no chip). */
export type RelaxableOption = Exclude<NoPathOption, "avoidModes">;

export interface NoPathView {
  text: string;
  /** Options a one-tap button can turn off; `all` = one button turning every listed option off. */
  relax: RelaxableOption[];
  all: boolean;
}

/**
 * The failure-card text for a `no_path` cause, or null when the generic "verified passages don't connect"
 * text is right (`none` with no option on).
 * "Unsurveyed" is only said when the refusing passages rest on UNKNOWN facts; "known" never goes beyond what
 * they showed; when the refusal couldn't be fully attributed the text says "includes", not "uses".
 */
export function noPathView(t: Strings, cause: NoPathCause): NoPathView | null {
  const label = (o: NoPathOption): string => (o === "avoidModes" ? t.noPath.avoidModes : t[o]);
  const relaxable = (os: readonly NoPathOption[]): RelaxableOption[] => os.filter((o): o is RelaxableOption => o !== "avoidModes");
  /** "The station has no data for this option": missing data, said apart from any known barrier. */
  const noData = (os: readonly NoPathOption[]): string[] => os.flatMap((o) => t.noPath.noData[o] ?? []);
  switch (cause.kind) {
    case "none": return cause.relaxed.length > 0 ? { text: t.noPath.none, relax: [], all: false } : null;
    case "unknown": return { text: t.noPath.unknown, relax: [], all: false };
    case "endpoint": {
      const sentences = cause.ends.map((e) => t.noPath.endpoint[e.end][e.paid === true ? "inside" : "unknown"]);
      return { text: [...sentences, t.noPath.endpoint.rule(t.unpaidOnly)].join(" "), relax: ["unpaidOnly"], all: false };
    }
    case "combination": {
      const relax = relaxable(cause.options);
      // Without a chip for every option there is no one-tap fix; the text still says what to turn off.
      return { text: [t.noPath.all(cause.options.map(label).join(t.noPath.joiner)), ...noData(cause.noData ?? [])].join(" "), relax: relax.length === cause.options.length ? relax : [], all: true };
    }
    case "option": {
      const relax = relaxable(cause.options.map((c) => c.option));
      if (cause.options.length > 1) {
        const missing = noData(cause.options.filter((c) => c.noData).map((c) => c.option));
        return { text: [t.noPath.any(cause.options.map((c) => label(c.option)).join(t.noPath.joiner)), ...missing].join(" "), relax, all: false };
      }
      const one = cause.options[0]!;
      // No station data at all outranks the route's own evidence: the option could not pass anywhere here.
      const detail = one.noData ? t.noPath.noData[one.option] : one.evidence === "unknown" ? t.noPath.unsurveyed[one.option]?.(one.complete)
        : one.evidence === "known" && one.option === "stepFree" ? t.noPath.knownStepFree(one.complete) : undefined;
      return { text: [t.noPath.one(label(one.option)), detail].filter(Boolean).join(" "), relax, all: false };
    }
  }
}
