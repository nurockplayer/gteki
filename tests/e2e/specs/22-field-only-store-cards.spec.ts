import fs from "node:fs";
import path from "node:path";
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

/** `shopSearchOnly` from apps/web/src/i18n.ts: a search-only store says why there is no route (#209). */
const SHOP_SEARCH_ONLY = {
  ja: "入口未確認のため道案内なし（現地確認待ち）",
  en: "No directions: entrance not verified (field check pending)",
} as const;

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

// The same honesty in both languages: the row and the card say the entrance is unverified.
for (const store of [
  { station: "ikebukuro", id: "shop-ikb-tobudept", query: "東武百貨店", origin: "jr-central-gate-2" },
  { station: "shinjuku", id: "shop-sjk-newoman", query: "ニュウマン", origin: "poi:exit:1" },
] as const) {
  for (const lang of ["ja", "en"] as const) {
    test(`@phone ${store.station}: ${store.query} explains its missing route (${lang})`, async ({ page }, testInfo) => {
      await openStation(page, store.station);
      // By attribute, not name: on a phone the short label joins the text, so the name reads 日本語日本語.
      if (lang === "ja") await page.locator('button[data-short="日本語"]').click();
      expect(await hooks.setOrigin(page, store.origin)).toBe(true);
      await page.locator("#gteki-to").fill(store.query);
      const note = SHOP_SEARCH_ONLY[lang];
      const result = page.locator(`.result[data-poi="${store.id}"]`);
      await expect(result).toContainText(note);
      await expect(result).toHaveAccessibleName(new RegExp(escapeRegExp(note)));
      await result.click();
      const card = page.locator(`.card.merchant[data-poi-id="${store.id}"]`);
      await expect(card).toBeVisible();
      await expect(card.locator(".merchant-no-route")).toHaveText(note);
      await expect(page.locator(".card .actions button.primary")).toHaveCount(0);
      expect(await hooks.route(page)).toMatchObject({ ok: false });
      // Optional visual evidence for the lead; nothing is committed.
      const shots = process.env.GTEKI_SEARCH_SHOTS;
      if (shots) {
        fs.mkdirSync(shots, { recursive: true });
        await page.screenshot({ path: path.join(shots, `${testInfo.project.name}-${store.id}-${lang}.png`) });
      }
    });
  }
}


test("ikebukuro: 西武池袋本店 cannot confirm a step-free station connection point when access is unsurveyed", async ({ page }) => {
  await openStation(page, "ikebukuro");
  await page.getByRole("button", { name: "日本語", exact: true }).click();
  expect(await hooks.setOrigin(page, "jr-central-gate-2")).toBe(true);
  await page.getByRole("button", { name: "段差なし", exact: true }).click();
  await expect(page.getByRole("button", { name: "段差なし", exact: true })).toHaveAttribute("aria-pressed", "true");
  await page.locator("#gteki-to").fill("西武池袋本店");
  await page.locator('.result[data-poi="shop-ikb-seibu-honten"]').click();
  const message = "段差の有無が未調査のため、段差なしで行ける駅側の接続地点を確認できません（入口未確認）";
  await expect(page.locator(".card.no-route")).toContainText(message);
  await expect(page.locator(".card.no-route")).toContainText("段差の有無が未調査の通路");
  await expect(page.locator(".card.no-route")).not.toContainText("段差なしで行ける駅側の接続地点がありません");
  await expect(page.locator('.card.merchant[data-poi-id="shop-ikb-seibu-honten"]')).not.toContainText("段差なしで行ける駅側の接続地点まで（入口未確認）");
  await expect(page.locator('.card.merchant[data-poi-id="shop-ikb-seibu-honten"] .merchant-no-route')).toHaveText(message);
  await expect(page.locator(".card .actions button.primary")).toHaveCount(0);
  expect(await hooks.route(page)).toMatchObject({ ok: false, reason: "no_path" });
});
