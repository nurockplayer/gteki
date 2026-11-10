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
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { checkSubmission, recordsToPrune, reserveAndWrite } from "./intake.ts";

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

it("updates only submitted POI facts and records changed values", () => {
  const original = bundle.pois.find(p => p.floorId === "b1")!;
  const poi = { ...original, displayPosition: { x: 1, y: 2, z: 3 }, paid: true,
    connectorNodeIds: ["existing-node"], evidence: { sourceIds: ["old-source"], method: "survey", checkedDate: "2025-01-01" },
    notes: [{ lang: "en", text: "Existing note" }], hours: { text: "old hours" } };
  const station = { ...bundle, pois: bundle.pois.map(p => p.id === original.id ? poi : p) } as unknown as typeof bundle;
  const s = { ...fixture, shop: { ...fixture.shop, names: [poi.names[0]!] } };
  const report = checkSubmission(s, "test key", [], station, now);
  expect(report.state).toBe("ACCEPTED");
  const proposed = report.proposal!.poi as Record<string, any>;
  expect(proposed).toMatchObject({ id: poi.id, displayPosition: poi.displayPosition, paid: true, connectorNodeIds: poi.connectorNodeIds,
    evidence: { sourceIds: ["msub-ikb-001", "old-source"], checkedDate: "2026-11-10" } });
  expect(proposed.evidence.method).toContain("merchant-submitted");
  expect(proposed.notes.at(-1)).toEqual(poi.notes[0]);
  expect(proposed.hours).toEqual(poi.hours);
  const previous = report.proposal!.previous!;
  expect(previous).not.toHaveProperty("hours");
  expect(Object.keys(previous).sort()).toEqual(Object.keys(poi).filter(k => JSON.stringify((poi as Record<string, unknown>)[k]) !== JSON.stringify(proposed[k])).sort());
  const stale = checkSubmission({ ...s, hours: { text: "stale", asOf: "2026-01-01" } }, "test key", [], station, now);
  expect((stale.proposal!.poi as Record<string, unknown>).hours).toEqual(poi.hours);
  expect(stale.proposal!.previous).not.toHaveProperty("hours");
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
  expect(readdirSync(queue)).toEqual(["fictional-1.json", "msub-ikb-001.reserved"]);
  const record = JSON.parse(readFileSync(join(queue, "fictional-1.json"), "utf8"));
  expect(record.submission.consent.termsVersion).toBe("2026-10-24");
  const prune = ["--import", "tsx", cli, "prune", "--queue", queue, "--now", "2027-03-01T00:00:00Z"];
  expect(JSON.parse(execFileSync(node, [...prune, "--dry-run"], { encoding: "utf8" }))).toEqual(["fictional-1"]);
  expect(readdirSync(queue)).toHaveLength(2);
  expect(JSON.parse(execFileSync(node, prune, { encoding: "utf8" }))).toEqual(["fictional-1"]);
  expect(readdirSync(queue)).toHaveLength(0);
});

it("accepts an email whose domain appears in the report and writes the queue record", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-contact-"));
  const queue = join(dir, "queue");
  mkdirSync(queue);
  const input = join(dir, "input.json");
  writeFileSync(input, JSON.stringify({ ...fixture, contact: { kind: "email", value: "owner@fictionalshop.jp" }, url: "https://fictionalshop.jp" }));
  const report = JSON.parse(execFileSync(process.execPath, ["--import", "tsx", resolve("tools/merchant-intake/intake.ts"), "check", input, "--queue", queue, "--now", "2026-11-10T00:00:00Z", "--write"], { env: { ...process.env, MERCHANT_INTAKE_KEY: "test key" }, encoding: "utf8" }));
  expect(report.state).toBe("ACCEPTED");
  expect(readdirSync(queue)).toEqual(["fictional-1.json", "msub-ikb-001.reserved"]);
});

it("rejects a queue in the main checkout when invoked from a worktree", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-worktree-"));
  const repo = join(dir, "repo");
  const worktree = join(dir, "worktree");
  mkdirSync(repo);
  const git = (...args: string[]) => execFileSync("git", args, { cwd: repo, stdio: "ignore" });
  git("init");
  git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "--allow-empty", "-m", "initial");
  git("worktree", "add", "-b", "test-worktree", worktree);
  const toolDir = join(worktree, "tools", "merchant-intake");
  mkdirSync(toolDir, { recursive: true });
  copyFileSync(resolve("tools/merchant-intake/intake.ts"), join(toolDir, "intake.ts"));
  for (const name of ["apps", "packages", "node_modules"]) symlinkSync(resolve(name), join(worktree, name), "dir");
  const queue = join(repo, "queue");
  mkdirSync(queue);
  const result = spawnSync(process.execPath, ["--import", "tsx", join(toolDir, "intake.ts"), "prune", "--queue", queue], { encoding: "utf8", cwd: worktree });
  expect(result.status, result.stderr).toBe(2);
  expect(result.stderr).toContain("queue must be outside the public repository");
  const worktreeQueue = join(worktree, "private-queue");
  mkdirSync(worktreeQueue);
  const linked = spawnSync(process.execPath, ["--import", "tsx", join(toolDir, "intake.ts"), "prune", "--queue", worktreeQueue], { encoding: "utf8", cwd: worktree });
  expect(linked.status, linked.stderr).toBe(2);
  expect(linked.stderr).toContain("queue must be outside the public repository");
});


it("reserves distinct IDs for writes using the same queue snapshot and preserves orphan reservations", () => {
  const queue = mkdtempSync(join(tmpdir(), "merchant-reservation-"));
  const snapshot: QueueRecord[] = [];
  writeFileSync(join(queue, "msub-ikb-001.reserved"), "orphan");
  for (const [request, source] of [["fictional-a", "msub-ikb-002"], ["fictional-b", "msub-ikb-003"]]) {
    const report = reserveAndWrite(queue, { ...fixture, clientRequestId: request! }, "test key", snapshot, bundle, now);
    expect(report.proposal?.source).toMatchObject({ id: source });
    expect(JSON.parse(readFileSync(join(queue, `${request}.json`), "utf8")).sourceId).toBe(source);
    expect(readFileSync(join(queue, `${source}.reserved`), "utf8")).toBe(request);
  }
  const cli = resolve("tools/merchant-intake/intake.ts");
  execFileSync(process.execPath, ["--import", "tsx", cli, "prune", "--queue", queue, "--now", "2027-03-01T00:00:00Z"]);
  expect(readdirSync(queue)).toEqual(["msub-ikb-001.reserved"]);
});


it("does not prune reservations outside the selected queue", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-prune-boundary-"));
  const queue = join(dir, "queue");
  const sibling = join(dir, "other-queue");
  mkdirSync(queue);
  mkdirSync(sibling);
  const reservation = join(sibling, "msub-ikb-001.reserved");
  writeFileSync(reservation, "other");
  const record: QueueRecord = { submission: fixture, identity: fixtureId, state: "ACCEPTED", checkedAt: "2026-01-01T00:00:00Z", sourceId: "../other-queue/msub-ikb-001" };
  writeFileSync(join(queue, "fictional-1.json"), JSON.stringify(record));
  execFileSync(process.execPath, ["--import", "tsx", resolve("tools/merchant-intake/intake.ts"), "prune", "--queue", queue, "--now", "2026-11-10T00:00:00Z"]);
  expect(readdirSync(queue)).toEqual([]);
  expect(readFileSync(reservation, "utf8")).toBe("other");
});

it("serializes writes and rejects repeated request IDs without orphan reservations", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-lock-"));
  const queue = join(dir, "queue");
  mkdirSync(queue);
  const input = join(dir, "submission.txt");
  writeFileSync(input, JSON.stringify(fixture));
  const args = ["--import", "tsx", resolve("tools/merchant-intake/intake.ts"), "check", input, "--queue", queue, "--now", "2026-11-10T00:00:00Z", "--write"];
  const env = { ...process.env, MERCHANT_INTAKE_KEY: "test key" };
  mkdirSync(join(queue, ".lock"));
  const locked = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  expect(locked.status).toBe(2);
  expect(locked.stderr).toContain(`queue is locked (remove ${join(queue, ".lock")} if no intake is running)`);
  expect(readdirSync(queue)).toEqual([".lock"]);
  rmSync(join(queue, ".lock"), { recursive: true });
  expect(JSON.parse(execFileSync(process.execPath, args, { env, encoding: "utf8" })).state).toBe("ACCEPTED");
  const repeated = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  expect(repeated.status).toBe(2);
  expect(repeated.stderr).toContain("submission already in queue");
  expect(readdirSync(queue)).toEqual(["fictional-1.json", "msub-ikb-001.reserved"]);
  writeFileSync(input, JSON.stringify({ ...fixture, clientRequestId: "fictional-2", contact: { kind: "email", value: "other-739@example.com" } }));
  const second = spawnSync(process.execPath, args, { env, encoding: "utf8" });
  expect(second.status).toBe(1);
  const report = JSON.parse(second.stdout);
  expect(report.state).toBe("EXCEPTION");
  expect(report.checks.find((c: { id: string }) => c.id === "duplicate").pass).toBe(false);
  expect(report.checks.find((c: { id: string }) => c.id === "claim").pass).toBe(false);
}, 20000);

it("removes a partially written record and its reservation when the write fails", () => {
  const dir = mkdtempSync(join(tmpdir(), "merchant-write-failure-"));
  const queue = join(dir, "queue");
  mkdirSync(queue);
  const input = join(dir, "submission.txt");
  writeFileSync(input, JSON.stringify(fixture));
  const fault = join(dir, "fault.mjs");
  writeFileSync(fault, `import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
const write = fs.writeFileSync;
fs.writeFileSync = function (file, ...args) {
  if (typeof file === "number") { write(file, "{partial"); throw new Error("simulated disk full"); }
  return write(file, ...args);
};
syncBuiltinESMExports();
`);
  const args = ["--import", "tsx", "--import", fault, resolve("tools/merchant-intake/intake.ts"), "check", input, "--queue", queue, "--write"];
  const result = spawnSync(process.execPath, args, { env: { ...process.env, MERCHANT_INTAKE_KEY: "test key" }, encoding: "utf8" });
  expect(result.status).toBe(2);
  expect(result.stderr).toContain("simulated disk full");
  expect(readdirSync(queue)).toEqual([]);
});
