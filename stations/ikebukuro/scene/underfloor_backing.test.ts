import { expect, it } from "vitest";
import backing from "./underfloor_backing.json";

it("covers the exit 18 floor edge with the surveyed underfloor triangles", () => {
  expect(backing.triangles).toHaveLength(3);
  expect(backing.triangles.flatMap((triangle) => triangle.enu.map((vertex) => vertex[2]))).toEqual(Array(9).fill(27.81));
  const [x, y] = [-100.7575, 153.9115];
  const covers = backing.triangles.some(({ enu }) => {
    const signs = enu.map((a, i) => {
      const b = enu[(i + 1) % 3]!;
      return (b[0]! - a[0]!) * (y! - a[1]!) - (b[1]! - a[1]!) * (x! - a[0]!);
    });
    return signs.every((s) => s >= 0) || signs.every((s) => s <= 0);
  });
  expect(covers).toBe(true);
});
