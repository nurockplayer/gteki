import { describe, expect, it } from "vitest";
import { classifyEscape, classifyRay, footprintContains, type OpeningFootprint } from "./helpers/escape-classify.ts";

const underground = { point: { y: -4.7 } };
const aboveStreet = { point: { y: 1.2 } };

// A 4 m wide x 6 m long street opening, running along +x.
const opening: OpeningFootprint = { kind: "band", id: "e:flight", a: { x: 0, y: 0 }, b: { x: 6, y: 0 }, halfWidth: 2 };

describe("escape ray classification", () => {
  it("encloses a near hit at or below the street", () => {
    expect(classifyRay(underground, underground)).toBe("enclosed");
    expect(classifyRay({ point: { y: -0.001 } }, { point: { y: -0.001 } })).toBe("enclosed");
  });

  it("escapes a near hit above the street", () => {
    expect(classifyRay(aboveStreet, aboveStreet)).toBe("escape");
  });

  it("escapes a hit above the street at the 250 m horizon", () => {
    expect(classifyRay(null, aboveStreet)).toBe("escape");
  });

  it("escapes when nothing is hit at 250 m", () => {
    expect(classifyRay(null, null)).toBe("escape");
  });

  it("reports a range miss for an underground hit at the 250 m horizon", () => {
    expect(classifyRay(null, underground)).toBe("rangeMiss");
  });
});

describe("street opening footprint", () => {
  it("contains a point on the band and its width", () => {
    expect(footprintContains(opening, { x: 3, y: 0 })).toBe(true);
    expect(footprintContains(opening, { x: 0, y: 1.9 })).toBe(true);
  });

  it("rejects a point just past the side and past the end", () => {
    expect(footprintContains(opening, { x: 3, y: 2.1 })).toBe(false);
    expect(footprintContains(opening, { x: 6.1, y: 0 })).toBe(false);
  });

  it("widens by the stated margin on every side", () => {
    expect(footprintContains(opening, { x: 3, y: 2.2 }, 0.3)).toBe(true);
    expect(footprintContains(opening, { x: 6.2, y: 0 }, 0.3)).toBe(true);
    expect(footprintContains(opening, { x: 3, y: 2.4 }, 0.3)).toBe(false);
    expect(footprintContains(opening, { x: 6.4, y: 0 }, 0.3)).toBe(false);
  });
});

describe("voided connector footprint", () => {
  // A 4 m square street plaza the layout removes from the slab, with a 1 m hole.
  const square = [
    { x: 0, y: 0 },
    { x: 4, y: 0 },
    { x: 4, y: 4 },
    { x: 0, y: 4 },
    { x: 0, y: 0 },
  ];
  const hole = [
    { x: 1, y: 1 },
    { x: 2, y: 1 },
    { x: 2, y: 2 },
    { x: 1, y: 2 },
    { x: 1, y: 1 },
  ];
  const plaza: OpeningFootprint = { kind: "rings", id: "void:plaza", rings: [square] };
  const plazaWithHole: OpeningFootprint = { kind: "rings", id: "void:plaza", rings: [square, hole] };

  it("contains a point inside the polygon", () => {
    expect(footprintContains(plaza, { x: 2, y: 3 })).toBe(true);
    expect(footprintContains(plaza, { x: 0.1, y: 0.1 })).toBe(true);
  });

  it("rejects a point beyond the margin", () => {
    expect(footprintContains(plaza, { x: 5, y: 2 })).toBe(false);
    expect(footprintContains(plaza, { x: -1, y: -1 })).toBe(false);
  });

  it("widens by the stated margin from the polygon edge", () => {
    expect(footprintContains(plaza, { x: 4.2, y: 2 }, 0.3)).toBe(true);
    expect(footprintContains(plaza, { x: 4.4, y: 2 }, 0.3)).toBe(false);
    expect(footprintContains(plaza, { x: -0.2, y: 2 }, 0.3)).toBe(true);
  });

  it("excludes a hole and its margin", () => {
    expect(footprintContains(plazaWithHole, { x: 1.5, y: 1.5 })).toBe(false);
    expect(footprintContains(plazaWithHole, { x: 0.9, y: 1.5 }, 0.3)).toBe(false);
    expect(footprintContains(plazaWithHole, { x: 3, y: 3 })).toBe(true);
  });
});

describe("escape class", () => {
  it("classes a crossing inside an opening as a street opening", () => {
    expect(classifyEscape({ x: 3, y: 0.5 }, [opening])).toBe("streetOpening");
  });

  it("classes a crossing outside every opening as a shell gap", () => {
    expect(classifyEscape({ x: 3, y: 4 }, [opening])).toBe("shellGap");
    expect(classifyEscape({ x: 10, y: 0 }, [opening])).toBe("shellGap");
  });

  it("uses the default 0.3 m margin at the cut edge", () => {
    expect(classifyEscape({ x: 3, y: 2.2 }, [opening])).toBe("streetOpening");
    expect(classifyEscape({ x: 3, y: 2.4 }, [opening])).toBe("shellGap");
  });

  it("classes a ray that never climbs as a shell gap", () => {
    expect(classifyEscape(null, [opening])).toBe("shellGap");
  });

  it("accepts a crossing inside any of several openings", () => {
    const neighbour: OpeningFootprint = { kind: "band", id: "e:neighbour", a: { x: 10, y: 10 }, b: { x: 10, y: 16 }, halfWidth: 1 };
    expect(classifyEscape({ x: 10.5, y: 13 }, [opening, neighbour])).toBe("streetOpening");
  });
});
