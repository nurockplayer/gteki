import { describe, expect, it } from "vitest";
import { fitSignBlocks } from "../scene/signs";

type Blocks = Parameters<typeof fitSignBlocks>[0];
const widthOf = (blocks: Blocks) => blocks.reduce((sum, block) => sum
  + [...block.gates, ...(block.places ?? [])].reduce((n, item) => n + (item.ja?.length ?? 0) + (item.en?.length ?? 0), 0), 0);
const face = (): Blocks => [{ exits: [], gates: [
  { id: "first", ja: "一", en: "First" },
  { id: "second", ja: "二", en: "Second" },
] }];

describe("fitSignBlocks", () => {
  it("leaves a fitting face unchanged", () => {
    const blocks = face();
    expect(fitSignBlocks(blocks, widthOf, 13)).toEqual(blocks);
  });

  it("drops the last gate's English name before a destination", () => {
    const blocks = face();
    const fitted = fitSignBlocks(blocks, widthOf, 7);
    expect(fitted[0]!.gates).toEqual([blocks[0]!.gates[0], { ...blocks[0]!.gates[1], en: null }]);
    expect(blocks[0]!.gates[1]!.en).toBe("Second");
  });

  it("pops the second gate when the face still overflows without English names", () => {
    const blocks = face();
    expect(fitSignBlocks(blocks, widthOf, 1)[0]!.gates).toEqual([{ ...blocks[0]!.gates[0], en: null }]);
  });
});
