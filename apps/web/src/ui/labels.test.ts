import { describe, expect, it } from "vitest";
import type { StationBundle } from "@gteki/schema";
import { strings } from "../i18n.ts";
import { nodeLabel, poiLabel } from "./labels.ts";

/** Only the fields the labels read: node kinds and the POIs reached from nodes. */
function fixture(): StationBundle {
  return {
    nodes: [
      { id: "x4f", kind: "stair_end" },
      { id: "x36f", kind: "junction" },
      { id: "c_e1", kind: "junction" },
    ],
    pois: [
      { id: "exit-4", category: "exit", names: [{ lang: "ja", text: "4番出口" }, { lang: "en", text: "Exit 4" }], connectorNodeIds: ["x4f"] },
      { id: "exit-36", category: "exit", names: [{ lang: "ja", text: "36番出口" }, { lang: "en", text: "Exit 36" }], connectorNodeIds: ["x36f"] },
    ],
  } as unknown as StationBundle;
}

describe("node and POI labels (#203 B11)", () => {
  const ja = strings("ja");
  const en = strings("en");

  it("never shows a raw graph id: an unnamed node takes a generic localized label", () => {
    expect(nodeLabel(fixture(), "c_e1", "ja", ja)).toBe("名称未登録の地点");
    expect(nodeLabel(fixture(), "c_e1", "en", en)).toBe("Unnamed point");
  });

  it("says an exit is reached at the foot of its stairs, and only when its connector is one", () => {
    const b = fixture();
    expect(nodeLabel(b, "x4f", "ja", ja)).toBe("4番出口（階段下）");
    expect(nodeLabel(b, "x4f", "en", en)).toBe("Exit 4 (stair foot)");
    expect(nodeLabel(b, "x36f", "ja", ja)).toBe("36番出口");
  });

  it("uses the POI name in the requested language for the 3D label", () => {
    const b = fixture();
    const exit4 = b.pois.find((p) => p.id === "exit-4")!;
    expect(poiLabel(b, exit4, "en", en)).toBe("Exit 4 (stair foot)");
    expect(poiLabel(b, b.pois.find((p) => p.id === "exit-36")!, "ja", ja)).toBe("36番出口");
  });
});
