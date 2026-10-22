import { describe, expect, it } from "vitest";
import type { NoPathCause } from "@gteki/navigation";
import { strings } from "./i18n.ts";
import { noPathView } from "./noPath.ts";

const one = (evidence: "unknown" | "known" | "mixed" | null, complete = true, option: "stepFree" | "unpaidOnly" | "strictHours" | "avoidModes" = "stepFree"): NoPathCause =>
  ({ kind: "option", options: [{ option, evidence, complete }] });

describe("no_path failure card text", () => {
  it("names the one option, in the toggle's own label, and says unsurveyed only for UNKNOWN facts", () => {
    expect(noPathView(strings("en"), one("unknown"))).toEqual({
      text: 'No verified route with "Step-free" on. The connection found uses passages whose step-free access is not surveyed.',
      relax: ["stepFree"], all: false,
    });
    expect(noPathView(strings("ja"), one("unknown"))?.text).toBe("「段差なし」をオンにしたままでは、確認済みのルートがありません。 見つかった経路は、段差の有無が未調査の通路を通ります。");
    const known = noPathView(strings("en"), one("known"));
    expect(known?.text).toContain("stairs, escalators");
    expect(known?.text).not.toContain("not surveyed");
    // Mixed or unattributable evidence claims neither.
    expect(noPathView(strings("en"), one("mixed"))?.text).toBe('No verified route with "Step-free" on.');
    expect(noPathView(strings("en"), one(null, false))?.text).toBe('No verified route with "Step-free" on.');
  });

  it("softens 'uses' to 'includes' when the refusal could not be fully attributed", () => {
    expect(noPathView(strings("en"), one("unknown", false))?.text).toContain("The connection found includes passages whose step-free access is not surveyed.");
    expect(noPathView(strings("ja"), one("unknown", false))?.text).toContain("未調査の通路を含みます。");
    expect(noPathView(strings("en"), one("known", false))?.text).toContain("includes stairs");
  });

  it("lists several sufficient options and offers one button per option", () => {
    const v = noPathView(strings("en"), { kind: "option", options: [{ option: "stepFree", evidence: "known", complete: true }, { option: "strictHours", evidence: "unknown", complete: true }] });
    expect(v).toEqual({ text: "Turning off any one of these finds a route: Step-free / Verified hours only", relax: ["stepFree", "strictHours"], all: false });
  });

  it("a combination lists all and offers a single turn-all-off button", () => {
    const v = noPathView(strings("en"), { kind: "combination", options: ["stepFree", "unpaidOnly", "strictHours"] });
    expect(v).toEqual({ text: "Turning off all of Step-free / Outside gates only / Verified hours only finds a route.", relax: ["stepFree", "unpaidOnly", "strictHours"], all: true });
    expect(noPathView(strings("ja"), { kind: "combination", options: ["stepFree", "strictHours"] })?.text).toBe("段差なし・営業時間確認済みのみをすべてオフにすると経路が見つかります。");
  });

  it("an endpoint refusal says which end, inside versus not known outside, with no passage evidence", () => {
    const inside = noPathView(strings("en"), { kind: "endpoint", ends: [{ end: "destination", paid: true }] });
    expect(inside).toEqual({
      text: 'The destination is inside the ticket gates. "Outside gates only" only routes between points known to be outside the gates.',
      relax: ["unpaidOnly"], all: false,
    });
    expect(noPathView(strings("en"), { kind: "endpoint", ends: [{ end: "origin", paid: null }, { end: "destination", paid: true }] })?.text)
      .toBe('The start is not known to be outside the ticket gates. The destination is inside the ticket gates. "Outside gates only" only routes between points known to be outside the gates.');
    expect(noPathView(strings("ja"), { kind: "endpoint", ends: [{ end: "destination", paid: true }] })?.text).toBe("目的地は改札内にあります。 「改札外のみ」は、改札外と確認できる地点の間だけ案内します。");
    expect(noPathView(strings("ja"), { kind: "endpoint", ends: [{ end: "destination", paid: null }] })?.text).toContain("目的地が改札外にあるか確認できません。");
  });

  it("none says even with every option off when an option was on; with none on it keeps the generic text", () => {
    expect(noPathView(strings("en"), { kind: "none", relaxed: ["stepFree"] })?.text).toBe("Even with every option off, verified passages don't connect these points; the link may not be surveyed yet.");
    expect(noPathView(strings("ja"), { kind: "none", relaxed: ["stepFree"] })?.text).toContain("すべての条件をオフにしても");
    expect(noPathView(strings("en"), { kind: "none", relaxed: [] })).toBeNull();
  });

  it("unknown is neutral with no button", () => {
    expect(noPathView(strings("en"), { kind: "unknown" })).toEqual({ text: "Couldn't determine which option is responsible.", relax: [], all: false });
    expect(noPathView(strings("ja"), { kind: "unknown" })?.text).toBe("どの条件が原因か判定できませんでした。");
  });

  it("avoided modes have no chip, so no one-tap fix", () => {
    expect(noPathView(strings("en"), one("known", true, "avoidModes"))?.relax).toEqual([]);
    expect(noPathView(strings("en"), { kind: "combination", options: ["stepFree", "avoidModes"] })?.relax).toEqual([]);
  });
});
