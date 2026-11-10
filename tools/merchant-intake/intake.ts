// SPDX-License-Identifier: Apache-2.0
// SPDX-FileCopyrightText: GTEki contributors
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { MERCHANT_TERMS_VERSION, MERCHANT_SUBMISSION_SCHEMA, type MerchantSubmission } from "../../apps/web/src/merchant/submission.ts";
import { parseStationFiles } from "../../packages/schema/src/parse.ts";

export type QueueRecord = { submission: MerchantSubmission; identity: string; state: string; checkedAt: string; sourceId?: string };
export type Check = { id: string; pass: boolean; detail: string; supersedes?: string };
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
