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
 * The failure-card text for a `no_path` cause, or null when there is nothing more specific to say
 * (`none`: keep the generic "verified passages don't connect" text).
 * "Unsurveyed" is only said when the relaxed route used UNKNOWN facts; "known" never goes beyond what the route showed.
 */
export function noPathView(t: Strings, cause: NoPathCause): NoPathView | null {
  const label = (o: NoPathOption): string => (o === "avoidModes" ? t.noPath.avoidModes : t[o]);
  const relaxable = (os: readonly NoPathOption[]): RelaxableOption[] => os.filter((o): o is RelaxableOption => o !== "avoidModes");
  switch (cause.kind) {
    case "none": return null;
    case "unknown": return { text: t.noPath.unknown, relax: [], all: false };
    case "combination": {
      const relax = relaxable(cause.options);
      // Without a chip for every option there is no one-tap fix; the text still says what to turn off.
      return { text: t.noPath.all(cause.options.map(label).join(t.noPath.joiner)), relax: relax.length === cause.options.length ? relax : [], all: true };
    }
    case "option": {
      const relax = relaxable(cause.options.map((c) => c.option));
      if (cause.options.length > 1) return { text: t.noPath.any(cause.options.map((c) => label(c.option)).join(t.noPath.joiner)), relax, all: false };
      const one = cause.options[0]!;
      const detail = one.evidence === "unknown" ? t.noPath.unsurveyed[one.option]
        : one.evidence === "known" && one.option === "stepFree" ? t.noPath.knownStepFree : undefined;
      return { text: [t.noPath.one(label(one.option)), detail].filter(Boolean).join(" "), relax, all: false };
    }
  }
}
