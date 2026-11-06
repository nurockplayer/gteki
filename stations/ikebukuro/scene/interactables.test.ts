import { expect, it } from "vitest";
import data from "./interactables.ts";
import placements from "./shop_placements.json";
import openings from "./shop_openings.json";

it("binds the simulated interaction to a placeholder window, not a POI", () => {
  const shop = placements.shops.find((entry) => entry.id === data.shopId)!;
  expect(shop.kind).toBe("placeholder");
  expect(shop).not.toHaveProperty("poiId");
  const opening = openings.openings.find((row) => row.polygon_ids.some((id) => shop.openings.includes(id)));
  expect(opening?.type).toBe("Window");
  expect(data.steps.map((step) => step.id)).toEqual(["look", "sit", "react", "give"]);
});
