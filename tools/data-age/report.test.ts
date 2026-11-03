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

it("converts source timestamps to JST dates before computing freshness", () => {
  const timestamp = "2026-11-02T16:30:00Z"; // 2026-11-03 01:30 JST
  const store = poi("older", "2026-11-03");
  store.evidence.checkedDate = "2026-11-03";
  const bundle: StationBundle = { ...fixture,
    sources: [source("door", timestamp), source("directory", timestamp)],
    pois: [store], tenants: [tenant("t1", "directory")],
  };
  expect(ageRows([bundle], new Date("2026-11-03T03:00:00Z"))[0]).toMatchObject({
    hoursDate: "2026-11-03", tenantsDate: "2026-11-03", entranceDate: "2026-11-03",
    oldestDate: "2026-11-03", ageDays: 0,
  });
});

it("uses the verified door's checked date in JST instead of its source retrieval date", () => {
  const door = poi("verified", "2026-11-03");
  door.evidence.checkedDate = "2026-11-02T16:30:00Z"; // 2026-11-03 01:30 JST
  const bundle: StationBundle = { ...fixture,
    sources: [source("door", "2026-10-20")], pois: [door], tenants: [],
  };
  expect(ageRows([bundle], new Date("2026-11-03T03:00:00Z"))[0]).toMatchObject({
    entranceDate: "2026-11-03", oldestDate: "2026-11-03", ageDays: 0,
  });
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

it("matches building-name prefixes only at half- or full-width space boundaries", () => {
  const bundle: StationBundle = { ...fixture,
    pois: [
      { ...poi("lumine1"), names: [{ lang: "ja", text: "ルミネ新宿 ルミネ1" }] },
      { ...poi("lumine2"), names: [{ lang: "ja", text: "ルミネ新宿　ルミネ2" }] },
      { ...poi("est"), names: [{ lang: "ja", text: "ルミネエスト新宿" }] },
    ],
    buildingHours: [{ building: [{ lang: "ja", text: "ルミネ新宿" }], floorRange: null,
      retrievedAt: "2026-10-24", sourceUrl: "https://example.com", basis: "undated-official",
      status: "OK", text: "11:00–21:00" }],
  };
  const rows = ageRows([bundle], new Date("2026-11-03T03:00:00Z"));
  expect(Object.fromEntries(rows.map((row) => [row.poiId, row.hoursDate])))
    .toEqual({ lumine1: "2026-10-24", lumine2: "2026-10-24", est: "—" });
});
