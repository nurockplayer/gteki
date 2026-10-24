import { describe, expect, it } from "vitest";
import type { Tenant } from "@gteki/schema";
import { strings } from "../i18n.ts";
import { printedFloor, tenantCheckedDate, tenantDestinationTitle, tenantLabel, tenantResultTags } from "./tenantDisplay.ts";

const JA = strings("ja");
const EN = strings("en");

const hit = { tenant: { id: "tenant-store-1", name: "サンプル薬局", floorLabel: "8F", category: "薬局" } };

const tenant: Tenant = {
  id: "tenant-store-1", poiId: "store",
  names: [{ lang: "ja", text: "サンプル薬局" }, { lang: "en", text: "Sample Pharmacy" }],
  aliases: [], floorLabel: [{ lang: "ja", text: "本館 8F" }],
  evidence: { sourceIds: ["fixture-tenants"], method: "field-survey", checkedDate: "2026-10-22" },
};

describe("tenant display (#419)", () => {
  it("labels a result row with the printed floor and the brand, plus the other matching brands", () => {
    expect(tenantResultTags(hit, "ja", JA)).toEqual(["8F", "“サンプル薬局”"]);
    expect(tenantResultTags({ ...hit, moreTenants: 2 }, "ja", JA)).toEqual(["8F", "“サンプル薬局” (+2)"]);
    expect(tenantResultTags({ tenant: undefined }, "ja", JA)).toEqual([]);
  });

  it("marks a printed floor label as printed in English only", () => {
    expect(tenantResultTags(hit, "en", EN)).toEqual(["8F (as printed)", "“サンプル薬局”"]);
    expect(printedFloor("本館 8F", "ja", JA)).toBe("本館 8F");
    expect(printedFloor("本館 8F", "en", EN)).toBe("本館 8F (as printed)");
  });

  it("titles the destination with the store, the brand and its floor", () => {
    expect(tenantDestinationTitle("サンプル百貨店", { name: "サンプル薬局", floorLabel: "8F" }, "ja", JA))
      .toBe("サンプル百貨店 — サンプル薬局（8F）");
    expect(tenantDestinationTitle("Sample Department Store", { name: "Sample Pharmacy", floorLabel: "8F" }, "en", EN))
      .toBe("Sample Department Store — Sample Pharmacy (8F) (as printed)");
  });

  it("picks the tenant strings in the reader's language and reads the directory's check date", () => {
    expect(tenantLabel(tenant, "en")).toEqual({ name: "Sample Pharmacy", floorLabel: "本館 8F" });
    expect(tenantCheckedDate([tenant], "tenant-store-1")).toBe("2026-10-22");
    expect(tenantCheckedDate([tenant], "tenant-gone")).toBeNull();
    expect(tenantCheckedDate(undefined, "tenant-store-1")).toBeNull();
  });
});
