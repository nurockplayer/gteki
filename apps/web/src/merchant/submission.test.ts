import { describe, expect, it } from "vitest";
import {
  buildSubmission, emptyDraft, MERCHANT_SUBMISSION_SCHEMA, MERCHANT_TERMS_VERSION, validateDraft,
  type MerchantDraft, type StationChoices,
} from "./submission.ts";

const choices: StationChoices = {
  floors: [
    { id: "toei-nwd-1", labels: [{ lang: "ja", text: "1階" }, { lang: "en", text: "1F" }] },
    { id: "toei-nwd-3", labels: [{ lang: "ja", text: "3階" }] },
  ],
  anchors: [
    { id: "poi:gate:1", labels: [{ lang: "ja", text: "改札（北）" }] },
    { id: "poi:exit:1", labels: [{ lang: "ja", text: "出口（地上・北側）" }] },
  ],
};

const meta = {
  stationFolder: "shinjuku", clientRequestId: "11111111-2222-3333-4444-555555555555",
  submittedAt: "2026-10-25T03:10:00.000Z", consentAcceptedAt: "2026-10-25T03:09:00.000Z",
};

function draft(over: Partial<MerchantDraft> = {}): MerchantDraft {
  return {
    ...emptyDraft("shinjuku"),
    nameText: "サンプル薬局",
    floorId: "toei-nwd-1",
    insideGates: "outside",
    contactValue: "shop@example.co.jp",
    consent: true,
    ...over,
  };
}

describe("merchant submission (#438)", () => {
  it("accepts a filled-in draft and reports each missing or malformed field", () => {
    expect(validateDraft(draft(), choices)).toEqual([]);
    const codes = (d: MerchantDraft) => validateDraft(d, choices).map((p) => p.code);
    expect(codes(draft({ nameText: "  " }))).toEqual(["name.required"]);
    expect(codes(draft({ floorId: "" }))).toEqual(["floor.required"]);
    expect(codes(draft({ floorId: "toei-nwd-9" }))).toEqual(["floor.unknown"]);
    expect(codes(draft({ insideGates: "" }))).toEqual(["gates.required"]);
    expect(codes(draft({ contactValue: "" }))).toEqual(["contact.required"]);
    expect(codes(draft({ contactValue: "not-an-address" }))).toEqual(["contact.email"]);
    expect(codes(draft({ contactKind: "phone", contactValue: "123" }))).toEqual(["contact.phone"]);
    expect(codes(draft({ consent: false }))).toEqual(["consent.required"]);
    expect(codes(draft({ url: "javascript:alert(1)" }))).toEqual(["url.invalid"]);
  });

  it("keeps hours a dated statement: text needs its date, a date needs its text", () => {
    expect(validateDraft(draft({ hoursText: "10:00–20:00" }), choices).map((p) => p.code)).toEqual(["hours.asOf"]);
    expect(validateDraft(draft({ hoursText: "10:00–20:00", hoursAsOf: "2026/10/25" }), choices).map((p) => p.code)).toEqual(["hours.asOf"]);
    expect(validateDraft(draft({ hoursAsOf: "2026-10-25" }), choices).map((p) => p.code)).toEqual(["hours.text"]);
    expect(validateDraft(draft({ hoursText: "10:00–20:00", hoursAsOf: "2026-10-25" }), choices)).toEqual([]);
  });

  it("only accepts an entrance wording next to a real anchor", () => {
    expect(validateDraft(draft({ entranceWording: "北改札付近" }), choices).map((p) => p.code)).toEqual(["anchor.missing"]);
    expect(validateDraft(draft({ nearPoiId: "poi:nope" }), choices).map((p) => p.code)).toEqual(["anchor.unknown"]);
    expect(validateDraft(draft({ nearPoiId: "poi:gate:1", entranceWording: "北改札付近" }), choices)).toEqual([]);
  });

  it("builds the submission JSON with nothing invented and nothing routable", () => {
    const sub = buildSubmission(draft({ aliasesText: "サンプル\nさんぷる\n", facility: "南館" }), choices, meta);
    expect(sub).toEqual({
      schema: MERCHANT_SUBMISSION_SCHEMA,
      clientRequestId: meta.clientRequestId,
      submittedAt: meta.submittedAt,
      station: { id: "shinjuku", folder: "shinjuku" },
      shop: {
        names: [{ lang: "ja", text: "サンプル薬局" }],
        aliases: [{ lang: "ja", text: "サンプル" }, { lang: "ja", text: "さんぷる" }],
        category: "shop",
        facility: "南館",
      },
      location: { floorId: "toei-nwd-1", anchor: null, insideGates: "outside" },
      hours: null,
      url: null,
      contact: { kind: "email", value: "shop@example.co.jp" },
      // The tick time, not the preview time (they differ here on purpose).
      consent: { termsVersion: MERCHANT_TERMS_VERSION, accepted: true, acceptedAt: meta.consentAcceptedAt },
    });
  });

  it("refuses to build from a floor the station does not have", () => {
    expect(() => buildSubmission(draft({ floorId: "toei-nwd-9" }), choices, meta)).toThrow(/not one of the station's floors/);
  });

  it("refuses an accepted consent with no tick time", () => {
    expect(() => buildSubmission(draft(), choices, { ...meta, consentAcceptedAt: "" })).toThrow(/no acceptance time/);
  });
});
