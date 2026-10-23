import { describe, expect, it } from 'vitest';
import type { Disc } from '../src/context-window.js';
import { geometryPaths, pathMeetsDiscs, pathsMeetDiscs, polygonMeetsDiscs, type Point } from '../src/window-geometry.js';

const disc = (x = 0, y = 0, r = 1): Disc => ({ x, y, r, origin: 'origin', id: 'test' });
const square = (r: number): Point[] => [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]];

describe('window geometry', () => {
  it('tests a single position at the disc centre, boundary and outside', () => {
    expect(pathMeetsDiscs([[0, 0]], [disc()])).toBe(true);
    expect(pathMeetsDiscs([[1, 0]], [disc()])).toBe(true);
    expect(pathMeetsDiscs([[1.01, 0]], [disc()])).toBe(false);
    expect(pathMeetsDiscs([], [disc()])).toBe(false);
    expect(pathMeetsDiscs([[0, 0]], [])).toBe(false);
  });

  it('tests GeoJSON points and multipoint members independently', () => {
    const meets = (type: string, coordinates: unknown): boolean => pathsMeetDiscs(geometryPaths({ type, coordinates }), [disc()], (x, y) => [x, y]);
    expect(meets('Point', [0, 0])).toBe(true);
    expect(meets('Point', [2, 0])).toBe(false);
    expect(meets('MultiPoint', [[0, 0]])).toBe(true);
    expect(meets('MultiPoint', [[-2, 0], [2, 0]])).toBe(false);
    expect(meets('MultiPoint', [[-2, 0], [1, 0], [2, 0]])).toBe(true);
  });

  it('uses all polygon rings for containment and counts intersections with hole edges', () => {
    const rings = [square(10), square(5)];
    expect(polygonMeetsDiscs(rings, [disc()])).toBe(false);
    expect(polygonMeetsDiscs(rings, [disc(0, 0, 7)])).toBe(true);
    expect(polygonMeetsDiscs(rings, [disc(7, 0)])).toBe(true);
    expect(polygonMeetsDiscs(rings, [disc(0, 0, 5)])).toBe(true);
    expect(polygonMeetsDiscs(rings, [disc(), disc(20, 0)])).toBe(false);
    expect(polygonMeetsDiscs(rings, [disc(), disc(7, 0)])).toBe(true);
    expect(polygonMeetsDiscs([square(10)], [disc()])).toBe(true);
  });
});
