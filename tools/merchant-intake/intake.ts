// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, realpathSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { MERCHANT_LICENSE_ID, MERCHANT_TERMS_VERSION, MERCHANT_SUBMISSION_SCHEMA, type MerchantSubmission } from "../../apps/web/src/merchant/submission.ts";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";

export type QueueRecord = { submission: MerchantSubmission; identity: string; state: string; checkedAt: string; sourceId?: string; closedAt?: string };
export type Check = { id: string; pass: boolean; detail: string; supersedes?: string };
// Move this to the versioned terms page when that page exists.
export const MERCHANT_TERMS_URL = "https://github.com/nurockplayer/gteki/blob/main/docs/research/merchants/merchant-self-service-spec.md#4-consent-and-licence-reviewed-by-core-rights-a9-440";
const day = 86400000;
const text = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const date = (v: unknown): v is string => text(v) && Number.isFinite(Date.parse(v));
const localized = (v: unknown): v is { lang: string; text: string }[] => Array.isArray(v) && v.every(x => x && text(x.lang) && text(x.text));

/** Validate the submission shape before dereferencing its fields. */
export function submissionShape(value: any): value is MerchantSubmission {
  return !!value && value.schema === MERCHANT_SUBMISSION_SCHEMA && text(value.clientRequestId) && date(value.submittedAt)
    && text(value.station?.id) && text(value.station?.folder) && localized(value.shop?.names) && value.shop.names.length > 0
    && localized(value.shop.aliases) && ["shop", "locker", "atm", "service", "toilet"].includes(value.shop.category)
    && (value.shop.facility === null || typeof value.shop.facility === "string") && text(value.location?.floorId)
    && (value.location.anchor === null || (text(value.location.anchor?.poiId) && typeof value.location.anchor.wording === "string"))
    && ["inside", "outside", "not_sure"].includes(value.location.insideGates)
    && (value.hours === null || (text(value.hours?.text) && date(value.hours.asOf)))
    && (value.url === null || typeof value.url === "string") && ["email", "phone"].includes(value.contact?.kind)
    && text(value.contact.value) && !!value.consent && typeof value.consent.accepted === "boolean"
    && text(value.consent.termsVersion) && date(value.consent.acceptedAt);
}

export function identityFor(contact: MerchantSubmission["contact"], key: string): string {
  if (!key) throw new Error("MERCHANT_INTAKE_KEY is required");
  const normalized = contact.kind === "email" ? contact.value.trim().toLowerCase() : contact.value.replace(/[^\d+]/g, "");
  return createHmac("sha256", key).update(normalized).digest("hex");
}

export function loadBundle(folder: string, root = process.cwd()) {
  if (!/^[a-z0-9-]+$/.test(folder)) throw new Error("invalid station folder");
  const dir = join(root, "stations", folder, "gteki");
  const read = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), "utf8"));
  const parsed = parseStationFiles(read("station"), read("graph"), read("pois"), read("tenants"));
  if (!parsed.ok) throw new Error("invalid station bundle");
  return parsed.bundle;
}

/** Run the checks that do not depend on acceptance-record or private-queue policy. */
export function checksFor(submission: MerchantSubmission, identity: string, queue: QueueRecord[], bundle: ReturnType<typeof loadBundle>, now: Date): Check[] {
  const s = submission;
  const checks: Check[] = [];
  const add = (id: string, pass: boolean, detail: string, extra: Partial<Check> = {}) => checks.push({ id, pass, detail, ...extra });
  add("schema", true, "Submission fields are present");
  add("consent", s.consent.accepted && s.consent.termsVersion === MERCHANT_TERMS_VERSION, "Current terms must be accepted");
  let match = false;
  try {
    const email = /^([^\s@]+)@([^\s@]+\.[^\s@]+)$/.exec(s.contact.value.trim());
    const url = new URL(s.url ?? "");
    const domain = email?.[2]?.toLowerCase().replace(/^www\./, "");
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    match = s.contact.kind === "email" && !!domain && ["http:", "https:"].includes(url.protocol)
      && (host === domain || host.endsWith(`.${domain}`) || domain.endsWith(`.${host}`));
  } catch { /* Missing or invalid URL is an identity exception. */ }
  add("identity", match, "Contact email domain must match the URL host");
  const recent = queue.filter(r => r.identity === identity && Date.parse(r.checkedAt) <= now.getTime());
  const count = (days: number) => 1 + recent.filter(r => Date.parse(r.checkedAt) > now.getTime() - days * day).length;
  add("rate", count(1) <= 3 && count(30) <= 10, "At most 3 per 24 hours and 10 per 30 days");
  const duplicates = queue.filter(r => r.submission.station.id === s.station.id && r.submission.shop.names.some(n => s.shop.names.some(x => x.text === n.text))
    && r.submission.location.floorId === s.location.floorId && r.submission.location.anchor?.poiId === s.location.anchor?.poiId);
  const same = duplicates.filter(r => r.identity === identity).sort((a, b) => Date.parse(b.checkedAt) - Date.parse(a.checkedAt))[0];
  add("duplicate", !duplicates.some(r => r.identity !== identity), "Duplicate submissions must have the same identity", same ? { supersedes: same.submission.clientRequestId } : {});
  add("floor", bundle.floors.some(f => f.id === s.location.floorId), "Floor must belong to the station");
  add("anchor", !s.location.anchor || bundle.pois.some(p => p.id === s.location.anchor?.poiId && ["exit", "ticket_gate"].includes(p.category)), "Anchor must be an exit or ticket gate");
  const targets = bundle.pois.filter(p => p.floorId === s.location.floorId && p.names.some(n => s.shop.names.some(x => x.text === n.text)));
  add("target", targets.length <= 1, "At most one station POI may match the name and floor");
  const target = targets[0];
  const claims = queue.filter(r => r.state === "ACCEPTED" && r.identity !== identity && r.submission.station.id === s.station.id
    && r.submission.location.floorId === s.location.floorId && r.submission.shop.names.some(n => (target?.names ?? s.shop.names).some(x => x.text === n.text)));
  add("claim", claims.length === 0, "An accepted POI claim must have the same identity");
  const fields = [...s.shop.names, ...s.shop.aliases].map(n => n.text).concat([s.shop.facility ?? "", s.location.anchor?.wording ?? "", s.hours?.text ?? ""]);
  const banned = /円|¥|yen|%\s*off|割引|セール|sale|https?:\/\/|www\./i;
  add("content", !fields.some(v => banned.test(v)) && !s.shop.names.some(n => [...n.text].length > 40), "No promotions, prices, URLs, or names over 40 characters");
  const stale = !!s.hours && Date.parse(s.hours.asOf) < now.getTime() - 180 * day;
  add("hours-age", true, stale ? "Hours are older than 180 days and will be dropped" : "Hours are within 180 days or absent");
  return checks;
}

/** Build a report without copying contact information into it. */
export function checkSubmission(s: MerchantSubmission, key: string, queue: QueueRecord[], bundle: ReturnType<typeof loadBundle>, now: Date, takenIds: string[] = []) {
  const identity = identityFor(s.contact, key);
  const checks = checksFor(s, identity, queue, bundle, now);
  if (bundle.station.id !== s.station.id) checks.find(c => c.id === "schema")!.pass = false;
  const matches = bundle.pois.filter(p => p.floorId === s.location.floorId && p.names.some(n => s.shop.names.some(x => x.text === n.text)));
  const existing = matches[0];
  let proposal: null | { source: unknown; poi: unknown; previous: Record<string, unknown> | null } = null;
  if (checks.every(c => c.pass)) {
    // Station POI IDs use shop-<short code>-...; otherwise the folder itself is a usable code.
    const code = bundle.pois.map(p => /^shop-([a-z0-9]+)-/.exec(p.id)?.[1]).find(Boolean) ?? s.station.folder;
    const ids = [...bundle.sources.map(source => source.id), ...queue.map(record => record.sourceId ?? ""), ...takenIds];
    let n = 1;
    while (ids.includes(`msub-${code}-${String(n).padStart(3, "0")}`) || bundle.pois.some(p => p.id === `shop-${code}-msub-${String(n).padStart(3, "0")}`)) n++;
    const suffix = String(n).padStart(3, "0");
    const sourceId = `msub-${code}-${suffix}`;
    const submittedDate = s.submittedAt.slice(0, 10);
    const checkedDate = now.toISOString().slice(0, 10);
    const notes = [
      { lang: "ja", text: `店舗提供の情報（${submittedDate}）・GTEki 未確認` },
      { lang: "en", text: `Merchant-submitted (${submittedDate}), not verified by GTEki` },
    ];
    const freshHours = !!s.hours && Date.parse(s.hours.asOf) >= now.getTime() - 180 * day;
    if (s.hours && freshHours) {
      notes.push({ lang: "ja", text: `${s.hours.text}（${s.hours.asOf}）出典日時点の情報です。変更されている場合があります` },
        { lang: "en", text: `${s.hours.text} (${s.hours.asOf}). As of the source date; may have changed` });
    }
    if (s.location.anchor?.wording) notes.push({ lang: "ja", text: `「${s.location.anchor.wording}（店舗申告）」` });
    if (s.shop.facility) notes.push({ lang: "ja", text: s.shop.facility });
    notes.push({ lang: "ja", text: `${{ inside: "改札内", outside: "改札外", not_sure: "改札内外不明" }[s.location.insideGates]}（店舗申告）` });
    const changes = {
      category: s.shop.category, names: s.shop.names, aliases: s.shop.aliases, floorId: s.location.floorId,
      evidence: { ...existing?.evidence, sourceIds: [sourceId, ...(existing?.evidence.sourceIds ?? [])], method: `merchant-submitted (${s.clientRequestId}, ${submittedDate}), UNVERIFIED`, checkedDate },
      notes: [...notes, ...(existing?.notes ?? [])],
    };
    const poi: Record<string, unknown> = existing
      ? { ...existing, ...changes }
      : { displayPosition: null, connectorNodeIds: [], paid: null, ...changes, id: `shop-${code}-msub-${suffix}` };
    const previous = existing ? Object.fromEntries(
      [...new Set([...Object.keys(existing), ...Object.keys(poi)])]
        .filter(k => JSON.stringify((existing as unknown as Record<string, unknown>)[k]) !== JSON.stringify(poi[k]))
        .map(k => [k, (existing as unknown as Record<string, unknown>)[k] ?? null])
    ) : null;
    const source = { id: sourceId, title: `Merchant submission ${s.clientRequestId}`, publisher: s.shop.names[0]!.text,
      url: s.url, license: { name: MERCHANT_LICENSE_ID, url: MERCHANT_TERMS_URL }, rights: "REUSABLE_WITH_CONDITIONS", usage: "data",
      decision: { url: "<acceptance record URL, added by the Owner>", date: checkedDate },
      attribution: `${s.shop.names[0]!.text} 店舗提供 / merchant-submitted, ${s.consent.termsVersion}`, modified: false,
      retrievedAt: submittedDate, datasetDate: submittedDate };
    proposal = { source, poi, previous };
  }
  return { clientRequestId: s.clientRequestId, station: s.station, identity, state: proposal ? "ACCEPTED" : "EXCEPTION", checks, proposal };
}

function checkExposure(submission: MerchantSubmission, report: ReturnType<typeof checkSubmission>) {
  const output = JSON.stringify(report);
  const contact = submission.contact.value.trim().toLowerCase();
  const digits = contact.replace(/\D/g, "");
  const exposed = submission.contact.kind === "email" ? output.toLowerCase().includes(contact)
    : output.includes(submission.contact.value.trim()) || (digits.length >= 8 && output.includes(digits));
  if (exposed) throw new Error("submission contains contact information in a report field");
}

/** Reserve a source ID and write the corresponding private queue record. */
export function reserveAndWrite(dir: string, submission: MerchantSubmission, key: string, queue: QueueRecord[], bundle: ReturnType<typeof loadBundle>, now: Date) {
  const recordPath = join(dir, `${submission.clientRequestId}.json`);
  if (existsSync(recordPath)) throw new Error("submission already in queue");
  const taken = readdirSync(dir).filter(name => name.endsWith(".reserved")).map(name => name.slice(0, -".reserved".length));
  for (let attempt = 0; attempt < 50; attempt++) {
    const report = checkSubmission(submission, key, queue, bundle, now, taken);
    checkExposure(submission, report);
    const sourceId = report.proposal ? (report.proposal.source as { id: string }).id : undefined;
    if (sourceId) {
      try {
        writeFileSync(join(dir, `${sourceId}.reserved`), submission.clientRequestId, { flag: "wx", mode: 0o600 });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
        taken.push(sourceId);
        continue;
      }
    }
    const record: QueueRecord = { submission, identity: report.identity, state: report.state, checkedAt: now.toISOString(), ...(sourceId ? { sourceId } : {}) };
    let fd: number | undefined;
    let created = false;
    try {
      fd = openSync(recordPath, "wx", 0o600);
      writeFileSync(fd, JSON.stringify(record, null, 2) + "\n");
      const written = fd;
      fd = undefined;
      created = true;
      closeSync(written);
    } catch (error) {
      // A failed close may already have released the descriptor; never let it skip the cleanup.
      if (fd !== undefined) try { closeSync(fd); } catch { /* already closed */ }
      if (created || fd !== undefined) unlinkSync(recordPath);
      if (sourceId) unlinkSync(join(dir, `${sourceId}.reserved`));
      throw error;
    }
    return report;
  }
  throw new Error("could not reserve a source ID after 50 attempts");
}

/** Select the records whose retention clock has passed. */
export function recordsToPrune(records: QueueRecord[], now: Date): QueueRecord[] {
  return records.filter(r => {
    const clock = r.state === "EXCEPTION" ? r.closedAt : ["ACCEPTED", "REJECTED", "WITHDRAWN", "ROLLED_BACK"].includes(r.state) ? r.checkedAt : undefined;
    return !!clock && Date.parse(clock) < now.getTime() - 90 * day;
  });
}

const readJson = (file: string) => JSON.parse(readFileSync(file, "utf8"));
function queueFiles(dir: string) {
  return readdirSync(dir).filter(name => name.endsWith(".json")).sort().map(name => ({ name, record: readJson(join(dir, name)) as QueueRecord }));
}
function options(args: string[]) {
  const result: Record<string, string | boolean> = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (["--write", "--dry-run"].includes(arg)) result[arg] = true;
    else if (["--queue", "--now"].includes(arg) && args[i + 1] && !args[i + 1]!.startsWith("--")) result[arg] = args[++i]!;
    else throw new Error("invalid arguments");
  }
  if (typeof result["--queue"] !== "string") throw new Error("--queue <dir> is required");
  return result;
}
function privateQueue(dir: string) {
  const queue = realpathSync(dir);
  const root = resolve(import.meta.dirname, "../..");
  let repo = root;
  try {
    repo = resolve(execFileSync("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], { cwd: import.meta.dirname, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim(), "..");
  } catch { /* Git is unavailable; use the current repository root. */ }
  repo = realpathSync(repo);
  const worktree = realpathSync(root);
  if ([repo, worktree].some(boundary => queue === boundary || queue.startsWith(boundary + sep))) throw new Error("queue must be outside the public repository");
  return queue;
}

export function main(args: string[], env = process.env): number {
  try {
    const command = args[0];
    if (command !== "check" && command !== "prune") throw new Error("usage: intake check <submission.json> --queue <dir> [--now <ISO>] [--write] | intake prune --queue <dir> [--now <ISO>] [--dry-run]");
    const file = command === "check" ? args[1] : undefined;
    if (command === "check" && (!file || file.startsWith("--"))) throw new Error("submission file is required");
    const opts = options(args.slice(command === "check" ? 2 : 1));
    if ((command === "check" && opts["--dry-run"]) || (command === "prune" && opts["--write"])) throw new Error("invalid arguments");
    const now = opts["--now"] ? new Date(opts["--now"] as string) : new Date();
    if (!Number.isFinite(now.getTime()) || (opts["--now"] && !/T.*(?:Z|[+-]\d\d:\d\d)$/i.test(opts["--now"] as string))) throw new Error("--now must be an ISO timestamp with zone");
    const dir = privateQueue(opts["--queue"] as string);
    if (command === "prune") {
      const entries = queueFiles(dir);
      const selected = new Set(recordsToPrune(entries.map(e => e.record), now));
      const expired = entries.filter(e => selected.has(e.record));
      if (!opts["--dry-run"]) for (const entry of expired) {
        unlinkSync(join(dir, entry.name));
        if (entry.record.sourceId && /^msub-[a-z0-9-]+-\d{3,}$/.test(entry.record.sourceId)) {
          try { unlinkSync(join(dir, `${entry.record.sourceId}.reserved`)); }
          catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        }
      }
      console.log(JSON.stringify(expired.map(e => e.record.submission.clientRequestId)));
      return 0;
    }
    const key = env.MERCHANT_INTAKE_KEY;
    if (!key) throw new Error("MERCHANT_INTAKE_KEY is required");
    const submission = readJson(file!);
    if (!submissionShape(submission)) {
      console.log(JSON.stringify({ clientRequestId: null, station: null, identity: null, state: "EXCEPTION", checks: [{ id: "schema", pass: false, detail: "Invalid submission fields" }], proposal: null }));
      return 1;
    }
    if (!/^[a-zA-Z0-9_-]+$/.test(submission.clientRequestId)) throw new Error("invalid clientRequestId");
    const bundle = loadBundle(submission.station.folder, resolve(import.meta.dirname, "../.."));
    const lock = join(dir, ".lock");
    if (opts["--write"]) {
      const deadline = Date.now() + 10000;
      while (true) {
        try { mkdirSync(lock); break; }
        catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
          if (Date.now() >= deadline) throw new Error(`queue is locked (remove ${lock} if no intake is running)`);
          Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, Math.min(100, deadline - Date.now()));
        }
      }
    }
    let report: ReturnType<typeof checkSubmission>;
    try {
      const queue = queueFiles(dir).map(e => e.record);
      if (opts["--write"]) report = reserveAndWrite(dir, submission, key, queue, bundle, now);
      else {
        report = checkSubmission(submission, key, queue, bundle, now);
        checkExposure(submission, report);
      }
    } finally {
      if (opts["--write"]) rmSync(lock, { recursive: true });
    }
    const output = JSON.stringify(report);
    console.log(output);
    return report.state === "ACCEPTED" ? 0 : 1;
  } catch (error) {
    console.error(`intake: ${(error as Error).message}`);
    return 2;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main(process.argv.slice(2));
