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

import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkSubmission, recordsToPrune } from "./intake.ts";

const fixture = JSON.parse(readFileSync(resolve("tools/merchant-intake/fixtures/fictional.json"), "utf8")) as MerchantSubmission;
const fixtureId = identityFor(fixture.contact, "test key");
const run = (s: MerchantSubmission, queue: QueueRecord[] = []) => checkSubmission(s, "test key", queue, bundle, now);

it("proposes new IDs without contact data", () => {
  const report = run(fixture);
  expect(report.state).toBe("ACCEPTED");
  expect(report.proposal?.source).toMatchObject({ id: "msub-ikb-001" });
  expect(report.proposal?.poi).toMatchObject({ id: "shop-ikb-msub-001", displayPosition: null });
  expect(JSON.stringify(report)).not.toContain(fixture.contact.value);
  expect(JSON.stringify(report)).not.toContain("intake-fixture-739");
});

it("updates a matching station POI and retains previous fields", () => {
  const poi = bundle.pois.find(p => p.floorId === "b1")!;
  const report = run({ ...fixture, shop: { ...fixture.shop, names: [poi.names[0]!] } });
  expect(report.state).toBe("ACCEPTED");
  expect(report.proposal?.poi).toMatchObject({ id: poi.id, connectorNodeIds: poi.connectorNodeIds });
  expect(report.proposal?.previous).toMatchObject({ names: poi.names, displayPosition: poi.displayPosition });
});

it("drops stale hours and detects an accepted competing claim", () => {
  const stale = run({ ...fixture, hours: { text: "10:00-18:00", asOf: "2026-01-01" } });
  expect(stale.state).toBe("ACCEPTED");
  expect(JSON.stringify(stale.proposal)).not.toContain("10:00-18:00");
  const record: QueueRecord = { submission: fixture, identity: fixtureId, state: "ACCEPTED", checkedAt: "2026-11-09T00:00:00Z" };
  const other = run({ ...fixture, contact: { kind: "email", value: "other-739@example.com" } }, [record]);
  expect(other.checks.find(c => c.id === "claim")?.pass).toBe(false);
});

it("prunes only decided records past the appropriate 90-day clock", () => {
  const record: QueueRecord = { submission: fixture, identity: fixtureId, state: "ACCEPTED", checkedAt: "2026-01-01T00:00:00Z" };
  const open = { ...record, state: "EXCEPTION" };
  const closed = { ...open, closedAt: "2026-01-02T00:00:00Z" };
  const recent = { ...record, checkedAt: "2026-11-01T00:00:00Z" };
  expect(recordsToPrune([record, open, closed, recent, { ...record, state: "RECEIVED" }], now)).toEqual([record, closed]);
});

it("runs the CLI, writes the private record, prunes and rejects a missing key", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-intake-"));
  const input = join(dir, "input.txt");
  const queue = join(dir, "queue");
  // The input and queue are separate so only queue records are read.
  execFileSync("mkdir", [queue]);
  writeFileSync(input, JSON.stringify(fixture));
  const cli = resolve("tools/merchant-intake/intake.ts");
  // The tsx CLI opens an IPC socket, which the test container forbids. Its Node loader
  // executes the same entry point in a separate process without requiring that socket.
  const node = process.execPath;
  const args = ["--import", "tsx", cli, "check", input, "--queue", queue, "--now", "2026-11-10T00:00:00Z", "--write"];
  const env = { ...process.env, MERCHANT_INTAKE_KEY: "test key" };
  const missing = spawnSync(node, args, { env: { ...env, MERCHANT_INTAKE_KEY: "" }, encoding: "utf8" });
  expect(missing.status, missing.stderr).toBe(2);
  expect(missing.stderr).toContain("MERCHANT_INTAKE_KEY");
  const report = JSON.parse(execFileSync(node, args, { env, encoding: "utf8" }));
  expect(report.state).toBe("ACCEPTED");
  expect(readdirSync(queue)).toEqual(["fictional-1.json"]);
  const record = JSON.parse(readFileSync(join(queue, "fictional-1.json"), "utf8"));
  expect(record.submission.consent.termsVersion).toBe("2026-10-24");
  const prune = ["--import", "tsx", cli, "prune", "--queue", queue, "--now", "2027-03-01T00:00:00Z"];
  expect(JSON.parse(execFileSync(node, [...prune, "--dry-run"], { encoding: "utf8" }))).toEqual(["fictional-1"]);
  expect(readdirSync(queue)).toHaveLength(1);
  expect(JSON.parse(execFileSync(node, prune, { encoding: "utf8" }))).toEqual(["fictional-1"]);
  expect(readdirSync(queue)).toHaveLength(0);
});
