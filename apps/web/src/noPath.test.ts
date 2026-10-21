import { describe, expect, it } from "vitest";
import type { NoPathCause } from "@gteki/navigation";
import { strings } from "./i18n.ts";
import { noPathView } from "./noPath.ts";

const stepFreeUnknown: NoPathCause = { kind: "option", options: [{ option: "stepFree", evidence: "unknown" }] };

describe("no_path failure card text", () => {
  it("names the one option, in the toggle's own label, and says unsurveyed only for UNKNOWN facts", () => {
    expect(noPathView(strings("en"), stepFreeUnknown)).toEqual({
      text: 'No verified route with "Step-free" on. The connection found uses passages whose step-free access is not surveyed.',
      relax: ["stepFree"], all: false,
    });
    expect(noPathView(strings("ja"), stepFreeUnknown)?.text).toBe("「段差なし」をオンにしたままでは、確認済みのルートがありません。 見つかった経路は、段差の有無が未調査の通路を通ります。");
    // A known-not step-free edge is not reported as unsurveyed.
    const known = noPathView(strings("en"), { kind: "option", options: [{ option: "stepFree", evidence: "known" }] });
    expect(known?.text).toContain("stairs, escalators");
    expect(known?.text).not.toContain("not surveyed");
    // Mixed evidence claims neither.
    expect(noPathView(strings("en"), { kind: "option", options: [{ option: "stepFree", evidence: "mixed" }] })?.text).toBe('No verified route with "Step-free" on.');
  });

  it("lists several sufficient options and offers one button per option", () => {
    const v = noPathView(strings("en"), { kind: "option", options: [{ option: "stepFree", evidence: "known" }, { option: "strictHours", evidence: "unknown" }] });
    expect(v).toEqual({ text: "Turning off any one of these finds a route: Step-free / Verified hours only", relax: ["stepFree", "strictHours"], all: false });
  });

  it("a combination lists all and offers a single turn-all-off button", () => {
    const v = noPathView(strings("en"), { kind: "combination", options: ["stepFree", "unpaidOnly", "strictHours"] });
    expect(v).toEqual({ text: "Turning off all of Step-free / Outside gates only / Verified hours only finds a route.", relax: ["stepFree", "unpaidOnly", "strictHours"], all: true });
    expect(noPathView(strings("ja"), { kind: "combination", options: ["stepFree", "strictHours"] })?.text).toBe("段差なし・営業時間確認済みのみをすべてオフにすると経路が見つかります。");
  });

  it("unknown is neutral with no button; none keeps the generic text", () => {
    expect(noPathView(strings("en"), { kind: "unknown" })).toEqual({ text: "Couldn't determine which option is responsible.", relax: [], all: false });
    expect(noPathView(strings("ja"), { kind: "unknown" })?.text).toBe("どの条件が原因か判定できませんでした。");
    expect(noPathView(strings("en"), { kind: "none" })).toBeNull();
  });

  it("avoided modes have no chip, so no one-tap fix", () => {
    const v = noPathView(strings("en"), { kind: "option", options: [{ option: "avoidModes", evidence: "known" }] });
    expect(v?.relax).toEqual([]);
    expect(noPathView(strings("en"), { kind: "combination", options: ["stepFree", "avoidModes"] })?.relax).toEqual([]);
  });
});
