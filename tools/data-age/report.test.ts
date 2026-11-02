// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { expect, it } from "vitest";
import type { Poi, Source, StationBundle, Tenant } from "../../packages/schema/src/index.ts";
import { ageRows, markdown } from "./report.ts";

const source = (id: string, retrievedAt: string): Source => ({
  id, retrievedAt, title: id, publisher: "fixture", url: "https://example.com", license: null,
  rights: "UNVERIFIED", attribution: "fixture", modified: false, datasetDate: null,
});
const poi = (id: string, hoursDate?: string): Poi => ({
  id, category: "shop", names: [{ lang: "ja", text: id }], aliases: [], floorId: null,
  displayPosition: { x: 0, y: 0, z: 0 }, connectorNodeIds: ["door"], paid: false,
  evidence: { sourceIds: ["door"], method: "field-survey", checkedDate: "2026-11-01" },
  ...(hoursDate ? { hours: { retrievedAt: hoursDate, sourceUrl: "https://example.com",
    basis: "undated-official" as const, status: "UNKNOWN" as const } } : {}),
});
const tenant = (id: string, sourceId: string): Tenant => ({
  id, poiId: "older", names: [{ lang: "ja", text: id }], aliases: [], floorLabel: [],
  evidence: { sourceIds: [sourceId], method: "directory", checkedDate: "2026-11-01" },
});
const fixture: StationBundle = {
  schema: "gteki.station/0.1",
  station: { id: "fixture", names: [], operators: [], frame: "ENU", datasetVersion: "test",
    generatedAt: "2026-11-01", synthetic: true,
    origin: { lat: 0, lon: 0, hM: null, datum: "JGD2011", crs: "EPSG:6697" } },
  sources: [source("door", "2026-11-01"), source("directory-old", "2026-10-01"),
    source("directory-new", "2026-10-30")],
  floors: [], nodes: [], edges: [], coverage: { summary: [], areas: [], gaps: [], freshness: null },
  pois: [poi("newer", "2026-10-25"), poi("older", "2026-10-20"), poi("missing")],
  tenants: [tenant("t1", "directory-new"), tenant("t2", "directory-old")],
};

it("lists three stores, missing hours first, then oldest evidence; ages use today's JST date", () => {
  const rows = ageRows([fixture], new Date("2026-11-02T15:30:00Z")); // 2026-11-03 JST
  expect(rows.map((row) => row.poiId)).toEqual(["missing", "older", "newer"]);
  expect(rows[0]).toMatchObject({ hoursDate: "—", tenantsDate: "—", entranceDate: "2026-11-01" });
  expect(rows[1]).toMatchObject({ station: "fixture", name: "older", hoursDate: "2026-10-20",
    tenantsDate: "2026-10-01", entranceDate: "2026-11-01", oldestDate: "2026-10-01", ageDays: 33 });
  expect(rows[2]).toMatchObject({ oldestDate: "2026-10-25", ageDays: 9 });
  expect(markdown(rows).split("\n")).toHaveLength(5);
});

it("does not treat a station tie or a map-read door as a verified entrance", () => {
  const tied = { ...fixture, pois: fixture.pois.map((p, i) => ({ ...p,
    evidence: { ...p.evidence, method: ["STATION_TIE", "P_MAP_DOOR", "SEARCH_ONLY"][i]! },
  })) };
  expect(ageRows([tied]).map((row) => row.entranceDate)).toEqual(["未確認", "未確認", "未確認"]);
});

it("uses exactly matched building hours when the store has no own hours", () => {
  const building = { ...fixture, buildingHours: [{
    building: [{ lang: "ja", text: "missing" }], floorRange: null,
    retrievedAt: "2026-10-15", sourceUrl: "https://example.com", basis: "undated-official" as const,
    status: "OK" as const, text: "10:00–20:00",
  }] };
  expect(ageRows([building]).find((row) => row.poiId === "missing"))
    .toMatchObject({ hoursDate: "2026-10-15", oldestDate: "2026-10-15", ageDays: expect.any(Number) });
});
