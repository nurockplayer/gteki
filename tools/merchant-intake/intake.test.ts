// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { describe, expect, it } from "vitest";
import { checksFor, identityFor, loadBundle, submissionShape, type QueueRecord } from "./intake.ts";
import type { MerchantSubmission } from "../../apps/web/src/merchant/submission.ts";

const submission: MerchantSubmission = {
  schema: "gteki.merchant-submission/0.1", clientRequestId: "fictional-1", submittedAt: "2026-11-01T00:00:00Z",
  station: { id: "ikebukuro", folder: "ikebukuro" }, shop: { names: [{ lang: "en", text: "Fictional Shop" }], aliases: [], category: "shop", facility: null },
  location: { floorId: "b1", anchor: { poiId: "exit-22", wording: "near exit" }, insideGates: "not_sure" },
  hours: { text: "10:00-18:00", asOf: "2026-11-01" }, url: "https://example.com/shop",
  contact: { kind: "email", value: "fictional@example.com" }, consent: { accepted: true, termsVersion: "2026-10-24", acceptedAt: "2026-11-01T00:00:00Z" },
};
const bundle = loadBundle("ikebukuro");
const now = new Date("2026-11-10T00:00:00Z");
const id = identityFor(submission.contact, "test key");
const check = (s = submission, queue: QueueRecord[] = []) => checksFor(s, identityFor(s.contact, "test key"), queue, bundle, now);
const failed = (s: MerchantSubmission, name: string, queue: QueueRecord[] = []) => expect(check(s, queue).find(c => c.id === name)?.pass).toBe(false);

describe("merchant intake checks", () => {
  it("accepts a fictional shop against the real station", () => {
    expect(submissionShape(submission)).toBe(true);
    expect(check().every(c => c.pass)).toBe(true);
    expect(id).not.toContain("fictional");
    expect(() => identityFor(submission.contact, "")).toThrow("MERCHANT_INTAKE_KEY");
  });
  it("flags identity, floor and content errors", () => {
    failed({ ...submission, contact: { kind: "phone", value: "0000000000" } }, "identity");
    failed({ ...submission, url: "https://example.jp" }, "identity");
    failed({ ...submission, location: { ...submission.location, floorId: "missing" } }, "floor");
    failed({ ...submission, hours: { text: "100円", asOf: "2026-11-01" } }, "content");
    expect(check({ ...submission, hours: { text: "hours", asOf: "2026-01-01" } }).find(c => c.id === "hours-age")?.detail).toContain("dropped");
  });
  it("detects duplicates, competing identities and rate limits", () => {
    const record: QueueRecord = { submission, identity: id, state: "ACCEPTED", checkedAt: "2026-11-09T23:00:00Z" };
    expect(check(submission, [record]).find(c => c.id === "duplicate")?.supersedes).toBe("fictional-1");
    failed({ ...submission, contact: { kind: "email", value: "other@example.com" } }, "duplicate", [record]);
    failed(submission, "rate", [record, record, record]);
  });
});
