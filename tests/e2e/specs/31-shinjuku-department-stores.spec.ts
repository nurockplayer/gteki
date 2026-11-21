// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import fs from "node:fs";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { ARTIFACTS } from "../lib/gteki.ts";

test.use({ trace: "off", video: "off", screenshot: "off" });

// Art-direction evidence, not a visual acceptance verdict. Keep the visitor's UI in frame.
test("Shinjuku department stores: nearest-exit frames @phone", async ({ page }, info) => {
  test.setTimeout(600_000);
  const root = process.env.GTEKI_ROOT!;
  const read = (file: string) => JSON.parse(fs.readFileSync(path.join(root, "stations/shinjuku", file), "utf8"));
  const data = read("data/department-stores.json"), graph = read("gteki/graph.json"), pois = read("gteki/pois.json").pois;
  const next = process.env.JOURNEY_MODE === "next";
  const phone = info.project.name.startsWith("phone");
  await page.setViewportSize(phone ? { width: 390, height: 844 } : { width: 1440, height: 900 });
  await page.addInitScript(() => localStorage.setItem("gteki.firstRunDone", "1"));
  await page.goto(`/?station=shinjuku&qaCrowd=off&qaTimeBand=morning&qaEscalatorPhase=0${next ? "&next=1" : ""}`);
  await page.waitForFunction(() => (window as any).__gteki?.phase() === "ready", null, { timeout: 120_000, polling: 250 });
  await expect(page.locator(".boot-card")).toBeHidden({ timeout: 30_000 });
  const out = path.join(ARTIFACTS, "journey", info.project.name, "department-stores");
  fs.mkdirSync(out, { recursive: true });
  const exits = pois.filter((p: any) => /^poi:exit:[1-4]$/.test(p.id)).map((p: any) => ({ poi: p.id, node: graph.nodes.find((n: any) => n.id === p.connectorNodeIds[0]) }));
  const rows = [];
  for (const store of data.stores) {
    const building = data.buildings.find((b: any) => b.id === store.buildingId);
    const ring = building.rings[0].slice(0, -1);
    const center = { x: ring.reduce((s: number, p: number[]) => s + p[0], 0) / ring.length, y: ring.reduce((s: number, p: number[]) => s + p[1], 0) / ring.length };
    const nearest = exits.find(e => e.node.id === pois.find((p: any) => p.id === store.poiId).connectorNodeIds[0])!;
    const headingDeg = Math.atan2(center.x - nearest.node.position.x, center.y - nearest.node.position.y) * 180 / Math.PI;
    const pose = await page.evaluate(({ node, headingDeg }) => {
      const qa = (window as any).__gteki;
      qa.setCamera({ pitch: 0 });
      const result = qa.setView({ node, headingDeg });
      qa.goldenFrame();
      return { ...result, avatar: qa.avatar(), camera: qa.camera() };
    }, { node: nearest.node.id, headingDeg });
    expect(pose.placed, `${store.poiId}: nearest exit must be walkable`).toBe(true);
    const image = `${store.poiId.replace("shop-sjk-", "")}-${next ? "next" : "off"}.png`;
    await page.screenshot({ path: path.join(out, image), timeout: 120_000 });
    rows.push({ store: store.poiId, image, next, exit: nearest.poi, node: nearest.node.id, headingDeg, pose,
      entrance: { connectorNodeIds: pois.find((p: any) => p.id === store.poiId).connectorNodeIds, status: "Provisional nearest modeled exit; not a store entrance, station model is partial" } });
  }
  fs.writeFileSync(path.join(out, "frames.json"), JSON.stringify({ capturedAt: new Date().toISOString(), viewport: page.viewportSize(), rows }, null, 2));
});
