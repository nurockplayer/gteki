/**
 * URLs of the baked stairwell cut recipes (#650), one per quality tier. Imported by the scene only through a dynamic
 * import, so headless loads of gteki/scene.ts never see the binary `?url` imports.
 */
import high from "./stairwell-cut.high.bin?url";
import low from "./stairwell-cut.low.bin?url";

export const stairwellRecipeUrls: Readonly<Record<"high" | "low", string>> = { high, low };
