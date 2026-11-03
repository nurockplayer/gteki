// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { expect, it } from "vitest";
import { checkMatrix, coverageRows, loadPublicBundles } from "./report.ts";
import type { CoverageRow } from "./report.ts";
import { rowMap } from "./rows.ts";

it("derives Tobu tenants, the E27 graph and route, and M25 search-only coverage from public bundles", () => {
  const rows = coverageRows(loadPublicBundles(), rowMap.filter((row) =>
    ["池袋 東武百貨店", "新宿 都営大江戸線 E27", "池袋 Metro 丸ノ内線 M25"].includes(row.label)));
  expect(rows.find((row) => row.label === "池袋 東武百貨店"))
    .toMatchObject({ counts: { POIs: 1, tenants: 860 }, searchable: true, routable: false });
  expect(rows.find((row) => row.label === "新宿 都営大江戸線 E27"))
    .toMatchObject({ counts: { nodes: 233, edges: 263, gates: 3, platforms: 1 }, searchable: true, routable: true });
  expect(rows.find((row) => row.label === "池袋 Metro 丸ノ内線 M25"))
    .toMatchObject({ counts: { gates: 3, lifts: 2, escalators: 2 }, searchable: true, routable: false });
});

it("checks count and search/route assertions while leaving rights, 3D, Open and platform numbers as prose", () => {
  const rows: CoverageRow[] = [{ label: "store", counts: { POIs: 1, tenants: 860, "shop POIs": 5 }, searchable: true, routable: false, stepFree: { passed: 0, total: 0, pairs: [] } },
    { label: "line", counts: { gates: 3, lifts: 2, nodes: 233, edges: 263 }, searchable: true, routable: true, stepFree: { passed: 1, total: 2, pairs: [] } },
    { label: "directory", counts: { tenants: 1547 }, searchable: true, routable: false, stepFree: { passed: 0, total: 0, pairs: [] } },
    { label: "S01", counts: { exits: 9 }, searchable: true, routable: false, stepFree: { passed: 0, total: 0, pairs: [] } },
    { label: "JR", counts: { platforms: 2, gates: 10 }, searchable: true, routable: false, stepFree: { passed: 0, total: 0, pairs: [] } }];
  const text = `| Station · line/store | Source / rights | 3D | Walk / navmesh | POIs / tenants | Search / route | Open |
|---|---|---|---|---|---|---|
| store | 99 tenants | 9 gates | n | 1 POI + 5 shop POIs; 860 tenants | search y; route n | 7 lifts |
| line | source | y | 233-node / 263-edge graph; 196 of 238 paths incomplete | 3 gates + 2 lifts; platforms 14, 15 | search y; route y; step-free 1/2 | #684 |
| directory | source | n | n | 83 sections (本館 67, メンズ 16) + 1,464 brands (本館 1154, メンズ 310) | search y; route n | field |
| S01 | source | n | n | 9 Toei exits (1–8, A1), line unattributed except A1 | search y; route n | field |
| JR | source | n | n | platforms 14, 15 + 10 shared JR gates, s; facilities GAP (operator pages only) | search y; route n | field |`;
  expect(checkMatrix(text, rows)).toEqual([]);
  expect(checkMatrix(text.replace("860 tenants", "861 tenants").replace("3 gates + 2 lifts", "4 gates + 2 lifts")
    .replace("search y; route y", "search y; route n").replace("263-edge", "264-edge"), rows))
    .toEqual(["store: tenants: matrix 861, derived 860", "line: edges: matrix 264, derived 263",
      "line: gates: matrix 4, derived 3", "line: route: matrix n, derived y"]);
  expect(checkMatrix(text.replace("| store |", "| renamed |"), rows))
    .toEqual(["store: missing matrix row", "renamed: missing row map entry"]);
  expect(checkMatrix(text, rows.map((row) => row.label === "S01" ? { ...row, counts: { exits: 10 } }
    : row.label === "JR" ? { ...row, counts: { platforms: 2, gates: 11 } } : row)))
    .toEqual(["S01: exits: matrix 9, derived 10", "JR: gates: matrix 10, derived 11"]);
  expect(checkMatrix(text, rows.map((row) => row.label === "S01" ? { ...row, counts: {} } : row)))
    .toEqual(["S01: 9 Toei exits: not compared (no derived exits)"]);
});

it("counts E27 lift routes in both directions, refuses exit 1, and fails closed for IKB", () => {
  const rows = coverageRows(loadPublicBundles(), rowMap.filter((row) =>
    ["新宿 都営大江戸線 E27", "池袋 JR 山手線"].includes(row.label)));
  const e27 = rows.find((row) => row.label === "新宿 都営大江戸線 E27")!.stepFree;
  for (const [exit, ok] of [["3", true], ["1", false]] as const) {
    for (const reverse of [false, true]) {
      const pair = e27.pairs.find((pair) =>
        (reverse ? pair.to : pair.from).endsWith(`(poi:exit:${exit})`)
        && (reverse ? pair.from : pair.to).endsWith("(poi:platform:oedo)"));
      expect(pair?.ok).toBe(ok);
      if (!ok) expect(pair?.blocker?.evidence).toBe("known");
    }
  }
  expect(e27.passed).toBe(e27.pairs.filter((pair) => pair.ok).length);
  expect(new Set(e27.pairs.map((pair) => `${pair.from}→${pair.to}`)).size).toBe(e27.total);
  const ikb = rows.find((row) => row.label === "池袋 JR 山手線")!.stepFree;
  expect(ikb.passed).toBe(0);
  expect(ikb.total).toBeGreaterThan(0);
  expect(ikb.pairs.every((pair) => pair.blocker?.edgeId)).toBe(true);
  expect(ikb.pairs.some((pair) => pair.blocker?.reason.includes("unsurveyed"))).toBe(true);
  const row = rows[0]!;
  const text = `| ${row.label} | source | n | step-free 0/${row.stepFree.total} | POIs | search y | open |`;
  expect(checkMatrix(text, [row])).toEqual([]);
  expect(checkMatrix(text.replace("step-free 0/", "step-free 1/"), [row])[0]).toContain("step-free: matrix 1/");
  expect(checkMatrix(text.replace(/step-free \d+\/\d+/, ""), [row])).toEqual([`${row.label}: missing step-free k/n`]);
});
