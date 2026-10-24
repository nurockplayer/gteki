import { describe, expect, it } from "vitest";
import { createSyntheticBundle } from "../../navigation/src/fixtures.ts";
import { checkShape, parseStationFiles, validateBundle, type StationIdentity } from "./index.ts";

const names = [{ lang: "ja", text: "池袋" }, { lang: "en", text: "Ikebukuro" }];
function fixture() {
  const b = createSyntheticBundle([]);
  b.station.identity = { names: structuredClone(names), sides: [{
    side: "west", exit: names, landmark: names,
    evidence: { sourceIds: [b.sources[0]!.id], method: "public-page-facts-only", checkedDate: "2026-10-24" },
    verification: "unverified",
  }] };
  return b;
}
const errors = (b: ReturnType<typeof fixture>) => validateBundle(b).filter((i) => i.level === "error").map((i) => i.code);
function files(b = fixture()) {
  const { nodes, edges, pois, ...manifest } = b;
  return [manifest, { schema: b.schema, stationId: b.station.id, nodes, edges }, { schema: b.schema, stationId: b.station.id, pois }] as const;
}

describe("optional station identity", () => {
  it("parses both legacy stations and evidenced identity", () => {
    expect(parseStationFiles(...files()).ok).toBe(true);
    const b = fixture();
    delete b.station.identity;
    expect(parseStationFiles(...files(b)).ok).toBe(true);
  });
  it.each(["ja", "en"])("requires %s", (lang) => {
    const b = fixture(); b.station.identity!.names = names.filter((n) => n.lang !== lang);
    expect(errors(b)).toContain("identity.names");
  });
  it.each(["names", "exit", "landmark"])("rejects empty %s text", (field) => {
    const b = fixture(); const id = b.station.identity!;
    if (field === "names") id.names = [{ lang: "ja", text: " " }];
    else id.sides![0]![field as "exit" | "landmark"] = [{ lang: "ja", text: " " }];
    expect(errors(b)).toContain("identity.text");
  });
  it.each([{ ids: [] }, { ids: ["unknown"] }])("rejects missing or unknown source IDs: %j", ({ ids }) => {
    const b = fixture(); b.station.identity!.sides![0]!.evidence.sourceIds = ids;
    expect(errors(b)).toContain("identity.evidence");
  });
  it("rejects duplicate or invalid sides and invalid verification", () => {
    const b = fixture(); const side = b.station.identity!.sides![0]!;
    b.station.identity!.sides!.push(structuredClone(side));
    expect(errors(b)).toContain("identity.side.dup");
    side.side = "up" as typeof side.side;
    side.verification = "assumed" as typeof side.verification;
    expect(errors(b)).toContain("identity.side");
    expect(errors(b)).toContain("identity.verification");
  });
  it("requires independent publishers for confirmed sides, not two IDs", () => {
    const b = fixture(); const side = b.station.identity!.sides![0]!;
    side.verification = "confirmed";
    expect(errors(b)).toContain("identity.verification");
    b.sources.push({ ...b.sources[0]!, id: "second" });
    side.evidence.sourceIds.push("second");
    expect(errors(b)).toContain("identity.verification");
    b.sources.at(-1)!.publisher = "Independent publisher";
    expect(errors(b)).not.toContain("identity.verification");
  });
  it.each([null, { names: null }, { names: [null] }, { names, sides: [null] }, { names, sides: [{ side: "east", exit: names, landmark: names, verification: "unverified", evidence: { sourceIds: [2], method: "x", checkedDate: "2026-10-24" } }] }])("fails closed on malformed identity: %j", (identity) => {
    const [m, g, p] = files(); m.station.identity = identity as unknown as StationIdentity;
    expect(checkShape(m, g, p).length).toBeGreaterThan(0);
    expect(parseStationFiles(m, g, p).ok).toBe(false);
  });
});
