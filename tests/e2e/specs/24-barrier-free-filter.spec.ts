import { expect, test } from "@playwright/test";
import { hooks, openStation, stationData } from "../lib/gteki.ts";

for (const station of [
  { key: "ikebukuro", origin: "metro-m-central-west-gate", count: 42, positioned: 0 },
  { key: "shinjuku", origin: "poi:gate:1", count: 9, positioned: 3 },
] as const) {
  test(`${station.key}: barrier-free facilities near the origin`, async ({ page }) => {
    await openStation(page, station.key);
    expect(await hooks.setOrigin(page, station.origin)).toBe(true);
    await page.locator(".category-filter").selectOption("barrier_free");
    const rows = page.locator("#gteki-to-listbox button.result");
    await expect(rows).toHaveCount(station.count);
    if (station.key === "ikebukuro") {
      await expect(rows.first()).toHaveAttribute("data-poi", "metro-m-lift-1");
      await expect(rows.first()).toContainText("Connects to your gate");
      await expect(rows.first()).toContainText("Distance unknown");
    }
    const data = stationData(station.key);
    const pois = data.pois;
    const values = await rows.evaluateAll((elements) => elements.map((row) => ({
      id: (row as HTMLElement).dataset.poi,
      meta: row.querySelector(".result-meta")!.textContent!,
    })));
    const distances: number[] = [];
    for (const [i, row] of values.entries()) {
      const poi = pois.find((p) => p.id === row.id)!;
      expect(poi).toBeDefined();
      expect(["elevator", "escalator"].includes(poi.category) ||
        (poi.category === "toilet" && poi.names.some((n) => /車いす|多機能|多目的|バリアフリー|accessible/i.test(n.text)))).toBe(true);
      if (i < station.positioned) {
        const match = row.meta.match(/(\d+) m/);
        expect(match).not.toBeNull();
        distances.push(Number(match![1]));
        expect(row.meta).not.toContain("Floor unknown");
      } else expect(row.meta).toContain("Distance unknown");
    }
    expect(distances).toHaveLength(station.positioned);
    expect(distances).toEqual([...distances].sort((a, b) => a - b));
    await page.locator("#gteki-to").fill(station.key === "ikebukuro" ? "トイレ" : "エレベーター");
    await expect(rows).toHaveCount(station.key === "ikebukuro" ? 19 : 7);
    if (station.key === "ikebukuro")
      await expect(page.locator('#gteki-to-listbox [data-poi="toilet-ikb-metro-001"]')).toContainText("中央通路東改札外広場");
  });
}
