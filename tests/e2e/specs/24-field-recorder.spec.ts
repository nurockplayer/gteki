import { readFile } from "node:fs/promises";
import { test, expect } from "@playwright/test";

test.use({ viewport: { width: 390, height: 844 }, video: "off" });

test("@phone field recorder persists offline and exports an Ikebukuro receipt", async ({ page, context }) => {
  await page.goto("/field.html");
  await expect(page.getByRole("heading", { level: 2 })).toContainText("IK-01");
  await expect(page.getByText("Ready for offline reload")).toBeVisible();
  await page.getByRole("button", { name: "Add record" }).click();
  await page.getByLabel("対象 ID / Target").fill("w_c");
  await page.getByLabel("項目 / Item").selectOption("1");
  await page.getByLabel("左右 / Side").selectOption("left");
  await page.getByLabel("距離 m / Offset m").fill("2.5");
  await page.getByLabel("読んだ文言 / Observed text").fill("西口（地下）");
  await page.getByLabel("観察時刻 / Observed at").fill("2026-11-03T10:12:00+09:00");
  await page.getByRole("button", { name: "Add record" }).click();
  await page.getByRole("button", { name: "Remove record" }).last().click();
  await expect(page.getByRole("heading", { level: 3 })).toHaveCount(1);
  await page.getByRole("button", { name: "Next" }).click();
  await expect(page.getByRole("heading", { level: 2 })).toContainText("IK-02");
  await page.getByRole("button", { name: "Prev" }).click();
  await context.setOffline(true);
  await page.reload();
  await expect(page.getByLabel("読んだ文言 / Observed text")).toHaveValue("西口（地下）");
  await page.getByLabel("Station", { exact: true }).selectOption("shinjuku");
  await expect(page.getByRole("heading", { level: 2 })).toContainText("SJ-01");
  await expect(page.getByText("0 / 16 stops with notes")).toBeVisible();
  await page.getByLabel("Station", { exact: true }).selectOption("ikebukuro");
  const downloading = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export station JSON" }).click();
  const download = await downloading;
  expect(download.suggestedFilename()).toMatch(/^\d{4}-\d{2}-\d{2}-ikebukuro\.json$/);
  const receipt = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(receipt).toMatchObject({ version: 1, station: "ikebukuro", fieldRun: "docs/research/field/ikebukuro-route.md", sourceKind: "team_field", observer: "owner", items: [{ item: 1, status: "OPEN", nodeId: "w_c", observedText: "西口（地下）", observedAt: "2026-11-03T10:12:00+09:00", stepFree: null, stopId: "IK-01", side: "left", offsetM: 2.5 }] });
  expect(receipt.items).toHaveLength(1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
