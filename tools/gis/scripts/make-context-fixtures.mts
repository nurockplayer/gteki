// Regenerates test/fixtures/context-bldg.gml and context-tran.gml: SYNTHETIC PLATEAU-shaped CityGML 2.0 around the
// Ikebukuro station origin (35.7297, 139.7114, hM 0). Invented geometry and ids, not copied from PLATEAU data.
// Local station-frame offsets are turned into lat/lon with packages/geo's StationFrame (read-only reference use):
//   pnpm exec tsx scripts/make-context-fixtures.mts
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { StationFrame } from '../../../packages/geo/src/index.ts';

const frame = new StationFrame({ lat: 35.7297, lon: 139.7114, h: 0 });
type P = [number, number, number]; // station x east, y north, z = TP height
const pos = ([x, y, z]: P): string => { const g = frame.toGeodetic({ x, y, z }); return `${g.lat} ${g.lon} ${g.h}`; };
const ring = (pts: P[]): string => `<gml:exterior><gml:LinearRing><gml:posList>${[...pts, pts[0]!].map(pos).join(' ')}</gml:posList></gml:LinearRing></gml:exterior>`;
const poly = (pts: P[], id?: string): string => `<gml:Polygon${id ? ` gml:id="${id}"` : ''}>${ring(pts)}</gml:Polygon>`;
const member = (inner: string): string => `<gml:surfaceMember>${inner}</gml:surfaceMember>`;
const ref = (id: string): string => `<gml:surfaceMember xlink:href="#${id}"/>`;
const box = (cx: number, cy: number, w: number, d: number, z0: number, z1: number, roofZ = z1) => {
  const x0 = cx - w / 2, x1 = cx + w / 2, y0 = cy - d / 2, y1 = cy + d / 2;
  const c = (x: number, y: number, z: number): P => [x, y, z];
  return {
    x0, x1, y0, y1,
    bottom: [c(x0, y0, z0), c(x0, y1, z0), c(x1, y1, z0), c(x1, y0, z0)],
    walls: [[c(x0, y0, z0), c(x1, y0, z0), c(x1, y0, roofZ), c(x0, y0, roofZ)], [c(x1, y0, z0), c(x1, y1, z0), c(x1, y1, roofZ), c(x1, y0, roofZ)], [c(x1, y1, z0), c(x0, y1, z0), c(x0, y1, roofZ), c(x1, y1, roofZ)], [c(x0, y1, z0), c(x0, y0, z0), c(x0, y0, roofZ), c(x0, y1, roofZ)]],
    top: [c(x0, y0, roofZ), c(x1, y0, roofZ), c(x1, y1, roofZ), c(x0, y1, roofZ)],
    flat: (z: number) => [c(x0, y0, z), c(x1, y0, z), c(x1, y1, z), c(x0, y1, z)],
  };
};
const lod0 = (b: ReturnType<typeof box>): string => `<bldg:lod0RoofEdge><gml:MultiSurface>${member(poly(b.flat(0)))}</gml:MultiSurface></bldg:lod0RoofEdge>`;
const lod1 = (b: ReturnType<typeof box>): string => `<bldg:lod1Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${[b.bottom, ...b.walls, b.top].map((p) => member(poly(p))).join('')}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod1Solid>`;
const header = (kind: string, bom: boolean) => `${bom ? '﻿' : ''}<?xml version="1.0" encoding="UTF-8"?>
<!-- SYNTHETIC test fixture (${kind}); invented geometry and identifiers around the Ikebukuro station origin, shaped like PLATEAU 2025 CityGML 2.0; not PLATEAU data. -->
<core:CityModel xmlns:app="http://www.opengis.net/citygml/appearance/2.0" xmlns:bldg="http://www.opengis.net/citygml/building/2.0" xmlns:core="http://www.opengis.net/citygml/2.0" xmlns:gen="http://www.opengis.net/citygml/generics/2.0" xmlns:gml="http://www.opengis.net/gml" xmlns:tran="http://www.opengis.net/citygml/transportation/2.0" xmlns:uro="https://www.geospatial.jp/iur/uro/3.2" xmlns:xlink="http://www.w3.org/1999/xlink">
<gml:boundedBy><gml:Envelope srsName="http://www.opengis.net/def/crs/EPSG/0/6697" srsDimension="3"><gml:lowerCorner>35.72 139.70 0</gml:lowerCorner><gml:upperCorner>35.74 139.72 60</gml:upperCorner></gml:Envelope></gml:boundedBy>
<app:appearanceMember><app:Appearance><app:theme>rgbTexture</app:theme><app:surfaceDataMember><app:X3DMaterial><app:diffuseColor>1 1 1</app:diffuseColor><app:target>#poly-ignored-texture-target</app:target></app:X3DMaterial></app:surfaceDataMember></app:Appearance></app:appearanceMember>
`;
const wrap = (id: string, tag: string, inner: string): string => `<core:cityObjectMember><${tag} gml:id="${id}"><core:creationDate>2024-03-15</core:creationDate><gen:stringAttribute name="synthetic"><gen:value>1</gen:value></gen:stringAttribute>${inner}</${tag}></core:cityObjectMember>\n`;

// ---- buildings ----
const lod1Only = box(60, 40, 20, 20, 32.5, 47.5);
const lod12 = box(-80, 30, 20, 20, 32.5, 50);
const surface = (type: string, id: string, p: P[]): string => `<bldg:boundedBy><bldg:${type} gml:id="s-${id}"><bldg:lod2MultiSurface><gml:MultiSurface>${member(poly(p, id))}</gml:MultiSurface></bldg:lod2MultiSurface></bldg:${type}></bldg:boundedBy>`;
const lod2Parts = (prefix: string, b: ReturnType<typeof box>, roofZ: number) => {
  const half1 = [[b.x0, b.y0], [(b.x0 + b.x1) / 2, b.y0], [(b.x0 + b.x1) / 2, b.y1], [b.x0, b.y1]].map(([x, y]) => [x, y, roofZ] as P);
  const half2 = [[(b.x0 + b.x1) / 2, b.y0], [b.x1, b.y0], [b.x1, b.y1], [(b.x0 + b.x1) / 2, b.y1]].map(([x, y]) => [x, y, roofZ] as P);
  const ids = { ground: `${prefix}-g`, walls: [0, 1, 2, 3].map((i) => `${prefix}-w${i}`), roofs: [`${prefix}-r0`, `${prefix}-r1`] };
  return {
    ids,
    solid: `<bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${[ids.ground, ...ids.walls, ...ids.roofs].map(ref).join('')}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>`,
    bounded: surface('GroundSurface', ids.ground, b.bottom) + b.walls.map((w, i) => surface('WallSurface', ids.walls[i]!, w)).join('') + surface('RoofSurface', ids.roofs[0]!, half1) + surface('RoofSurface', ids.roofs[1]!, half2),
  };
};
const parts = lod2Parts('bldg_lod12-p', lod12, 50);
const installation = `<bldg:outerBuildingInstallation><bldg:BuildingInstallation gml:id="bldg_lod12-inst"><bldg:lod2Geometry><gml:MultiSurface>${member(poly([[-85, 35, 50.5], [-82, 35, 50.5], [-82, 38, 50.5], [-85, 38, 50.5]], 'bldg_lod12-inst-p'))}</gml:MultiSurface></bldg:lod2Geometry></bldg:BuildingInstallation></bldg:outerBuildingInstallation>`;
const edge = box(255, 10, 30, 20, 32.5, 40);
const cornerOut = box(200, 180, 20, 20, 32.5, 40); // nearest corner (190,170) is 254.8 m from the origin although each axis range is within 250
const farOut = box(300, 300, 20, 20, 32.5, 40);
const lod0Only = box(-30, -60, 20, 20, 32.5, 40);
const unresolved = box(10, -120, 20, 20, 32.5, 45);
const unresolvedLod2 = `<bldg:lod2Solid><gml:Solid><gml:exterior><gml:CompositeSurface>${ref('bldg_lod2-unresolved-w0')}${ref('missing-polygon-id')}</gml:CompositeSurface></gml:exterior></gml:Solid></bldg:lod2Solid>`;
const bldg = header('bldg', true)
  + wrap('bldg_lod1only', 'bldg:Building', lod0(lod1Only) + lod1(lod1Only))
  + wrap('bldg_lod12', 'bldg:Building', lod0(lod12) + lod1(lod12) + parts.solid + installation + parts.bounded)
  + wrap('bldg_edge', 'bldg:Building', lod0(edge) + lod1(edge))
  + wrap('bldg_corner_out', 'bldg:Building', lod0(cornerOut) + lod1(cornerOut))
  + wrap('bldg_far_out', 'bldg:Building', lod0(farOut) + lod1(farOut))
  + wrap('bldg_lod0only', 'bldg:Building', lod0(lod0Only))
  + wrap('bldg_lod2_unresolved', 'bldg:Building', lod0(unresolved) + lod1(unresolved) + unresolvedLod2 + surface('WallSurface', 'bldg_lod2-unresolved-w0', unresolved.walls[0]!))
  + '</core:CityModel>\n';

// ---- roads ----
const strip = (x0: number, x1: number, y0: number, y1: number, z: number): P[] => [[x0, y0, z], [x1, y0, z], [x1, y1, z], [x0, y1, z]];
const msurface = (tag: string, polys: string): string => `<tran:${tag}><gml:MultiSurface>${polys}</gml:MultiSurface></tran:${tag}>`;
const area = (id: string, lodTag: string, polys: string): string => `<tran:trafficArea><tran:TrafficArea gml:id="${id}"><tran:function codeSpace="../../codelists/TrafficArea_function.xml">1000</tran:function>${msurface(lodTag, polys)}</tran:TrafficArea></tran:trafficArea>`;
const roadRefs = (tag: string, ids: string[]): string => `<tran:${tag}><gml:MultiSurface><gml:surfaceMember><gml:CompositeSurface>${ids.map(ref).join('')}</gml:CompositeSurface></gml:surfaceMember></gml:MultiSurface></tran:${tag}>`;
const road123 = wrap('tran_lod123', 'tran:Road',
  area('tran_lod123-a2', 'lod2MultiSurface', member(poly(strip(-100, 100, 100, 108, 0), 'tran_lod123-p2')))
  + area('tran_lod123-a3', 'lod3MultiSurface', member(poly(strip(-100, 0, 100, 108, 32.4), 'tran_lod123-p3a')) + member(poly(strip(0, 100, 100, 108, 32.4), 'tran_lod123-p3b')))
  + msurface('lod1MultiSurface', member(poly(strip(-100, 100, 100, 108, 0))))
  + roadRefs('lod2MultiSurface', ['tran_lod123-p2']) + roadRefs('lod3MultiSurface', ['tran_lod123-p3a', 'tran_lod123-p3b']));
const road12 = wrap('tran_lod12only', 'tran:Road',
  area('tran_lod12only-a2', 'lod2MultiSurface', member(poly(strip(-100, 100, -108, -100, 0), 'tran_lod12only-p2')))
  + msurface('lod1MultiSurface', member(poly(strip(-100, 100, -108, -100, 0)))) + roadRefs('lod2MultiSurface', ['tran_lod12only-p2']));
const roadOut = wrap('tran_far_out', 'tran:Road', area('tran_far_out-a3', 'lod3MultiSurface', member(poly(strip(400, 420, 400, 410, 32.4), 'tran_far_out-p3'))) + msurface('lod1MultiSurface', member(poly(strip(400, 420, 400, 410, 0)))));
const roadFlat3 = wrap('tran_lod3_flat', 'tran:Road', area('tran_lod3_flat-a3', 'lod3MultiSurface', member(poly(strip(-100, 100, 150, 158, 0), 'tran_lod3_flat-p3'))));
const tran = header('tran', false) + road123 + road12 + roadOut + roadFlat3 + '</core:CityModel>\n';

const dir = fileURLToPath(new URL('../test/fixtures/', import.meta.url));
writeFileSync(`${dir}context-bldg.gml`, bldg);
writeFileSync(`${dir}context-tran.gml`, tran);
console.error('wrote context-bldg.gml and context-tran.gml');
