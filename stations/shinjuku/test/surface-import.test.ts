import { describe, expect, it } from "vitest";
import { parseBuildings, parseRoads, surfaceEnu } from "../tools/import-surface.ts";

const crs = '<core:CityModel srsName="http://www.opengis.net/def/crs/EPSG/0/6697">';
const ring = "35.687 139.6994 0 35.687 139.6995 0 35.6871 139.6995 0 35.6871 139.6994 0 35.687 139.6994 0";
const building = (fields = "") => `${crs}<bldg:Building gml:id="bldg:fixture">${fields}<bldg:lod1Solid><gml:Solid><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring.replaceAll(" 0", " 12")}</gml:posList></gml:LinearRing></gml:exterior></gml:Polygon></gml:Solid></bldg:lod1Solid></bldg:Building></core:CityModel>`;
const road = `${crs}<tran:Road gml:id="tran:road-a"><tran:lod1MultiSurface><gml:MultiSurface><gml:surfaceMember><gml:Polygon><gml:exterior><gml:LinearRing><gml:posList>${ring}</gml:posList></gml:LinearRing></gml:exterior><gml:interior><gml:LinearRing><gml:posList>35.68702 139.69942 0 35.68702 139.69944 0 35.68704 139.69944 0 35.68704 139.69942 0 35.68702 139.69942 0</gml:posList></gml:LinearRing></gml:interior></gml:Polygon></gml:surfaceMember></gml:MultiSurface></tran:lod1MultiSurface></tran:Road></core:CityModel>`;

describe("PLATEAU surface import records", () => {
  it("preserves usage and valid storeys while treating the source sentinel as unknown", () => {
    const rich = parseBuildings(building('<bldg:usage codeSpace="usage.xml">412</bldg:usage><bldg:storeysAboveGround>7</bldg:storeysAboveGround>'), [[0, 0]]);
    expect(rich[0]).toMatchObject({ usage: "412", storeys: 7 });
    const sentinel = parseBuildings(building('<bldg:storeysAboveGround>9999</bldg:storeysAboveGround>'), [[0, 0]]);
    expect(sentinel[0]).toMatchObject({ usage: null, storeys: null });
  });

  it("imports road LOD1 surfaces as deterministic ENU exterior and interior rings", () => {
    const first = parseRoads(road, [[0, 0]]), again = parseRoads(road, [[0, 0]]);
    expect(JSON.stringify(first)).toBe(JSON.stringify(again));
    expect(first).toHaveLength(1);
    expect(first[0]!.id).toBe("tran:road-a:0");
    expect(first[0]!.rings).toHaveLength(2);
    expect(first[0]!.rings[0]![0]).toEqual([0, 0]);
    expect(first[0]!.rings[0]!.at(-1)).toEqual([0, 0]);
    expect(first[0]!.rings[1]![0]).toEqual([1.8, 2.2]);
    expect(parseRoads(road, [[1000, 1000]])).toEqual([]);
  });

  it("rejects a non EPSG:6697 roads source and keeps the local axis convention", () => {
    expect(() => parseRoads(road.replace("6697", "4326"), [[0, 0]])).toThrow(/6697/);
    const origin = surfaceEnu(35.687, 139.6994, 0);
    expect(origin.x).toBeCloseTo(0); expect(origin.y).toBeCloseTo(0);
  });
});
