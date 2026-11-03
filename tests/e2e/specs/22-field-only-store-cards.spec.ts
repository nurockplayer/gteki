import { expect, test } from "@playwright/test";
import { hooks, openStation } from "../lib/gteki.ts";

// These public stores have no graph node for the gate/exit in their printed access wording.
for (const store of [
  { station: "ikebukuro", id: "shop-ikb-tobudept", query: "東武百貨店", origin: "jr-central-gate-2" },
  { station: "shinjuku", id: "shop-sjk-keio", query: "京王百貨店", origin: "poi:exit:1" },
] as const) {
  test(`${store.station}: ${store.query} labels its unverified entrance without offering a route`, async ({ page }) => {
    await openStation(page, store.station);
    await page.getByRole("button", { name: "日本語", exact: true }).click();
    expect(await hooks.setOrigin(page, store.origin)).toBe(true);
    await page.locator("#gteki-to").fill(store.query);
    const result = page.locator(`.result[data-poi="${store.id}"]`);
    await expect(result).toContainText("入口未確認");
    await expect(result).toHaveAccessibleName(/入口未確認/);
    await result.click();
    const card = page.locator(`.card.merchant[data-poi-id="${store.id}"]`);
    await expect(card).toBeVisible();
    await expect(card.locator(".merchant-meta")).toContainText("入口未確認");
    await expect(card.locator(".merchant-no-route")).toBeVisible();
    await expect(page.locator(".card .actions button.primary")).toHaveCount(0);
    expect(await hooks.route(page)).toMatchObject({ ok: false });
  });
}


test("ikebukuro: 西武池袋本店 cannot confirm a step-free gate when access is unsurveyed", async ({ page }) => {
  await openStation(page, "ikebukuro");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  expect(await hooks.setOrigin(page, "jr-central-gate-2")).toBe(true);
  await page.getByRole("button", { name: "段差なし", exact: true }).click();
  await expect(page.getByRole("button", { name: "段差なし", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#gteki-to").fill("西武池袋本店");
  await page.locator('.result[data-poi="shop-ikb-seibu-honten"]').click();
  const message = "段差の有無が未調査のため、段差なしで行ける改札を確認できません（入口未確認）";
  await expect(page.locator(".card.no-route")).toContainText(message);
  await expect(page.locator(".card.no-route")).toContainText("段差の有無が未調査の通路");
  await expect(page.locator(".card.no-route")).not.toContainText("段差なしで行ける改札がありません");
  await expect(page.locator('.card.merchant[data-poi-id="shop-ikb-seibu-honten"]')).not.toContainText("段差なしで行ける改札まで（入口未確認）");
  await expect(page.locator('.card.merchant[data-poi-id="shop-ikb-seibu-honten"] .merchant-no-route')).toHaveText(message);
  await expect(page.locator(".card .actions button.primary")).toHaveCount(0);
  expect(await hooks.route(page)).toMatchObject({ ok: false, reason: "no_path" });
});
