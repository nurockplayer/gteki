import type { LocalizedText, Source } from "@gteki/schema";

/**
 * A shop's own submission (#438 Phase 2, option A of docs/research/merchants/merchant-self-service-spec.md):
 * the form collects the facts in §3, checks what a browser can check, and writes one JSON document in the
 * shape below. Nothing is sent anywhere — the submission is a file the shop hands over — and the receiving
 * side assigns the `msub-` source id and runs the §5 automatic checks.
 *
 * A submission never creates a route and never claims the shop is open: `connectorNodeIds` stays as it is
 * and `paid` stays null, both handled by the station writer, not here.
 */
export const MERCHANT_SUBMISSION_SCHEMA = "gteki.merchant-submission/0.1" as const;

/** The consent version the box refers to (§4). Bump it whenever the grant's wording changes. */
export const MERCHANT_TERMS_VERSION = "2026-10-24";

/** The grant's identifier (§4.2). Its LICENSES/ text is added when the first submission ships. */
export const MERCHANT_LICENSE_ID = "LicenseRef-GTEki-merchant-grant";

/** The categories a shop may claim for itself (§3): the shop-like ones, never a station structure. */
export const MERCHANT_CATEGORIES = ["shop", "locker", "atm", "service", "toilet"] as const;
export type MerchantCategory = (typeof MERCHANT_CATEGORIES)[number];

export const INSIDE_GATES = ["inside", "outside", "not_sure"] as const;
export type InsideGates = (typeof INSIDE_GATES)[number];

export const CONTACT_KINDS = ["email", "phone"] as const;
export type ContactKind = (typeof CONTACT_KINDS)[number];

/** What the form holds while it is being filled in. Empty strings are "not filled in yet". */
export interface MerchantDraft {
  /** The station's own id (`station.id`), not the folder name. */
  stationId: string;
  /** One language, exactly as it appears on the shop's signage (§3). */
  nameLang: string;
  nameText: string;
  /** One alias or reading per line; only what the shop states. */
  aliasesText: string;
  category: MerchantCategory;
  /** A facility or building name ("南館", "エチカ池袋"); stored as a note, never as a Floor. */
  facility: string;
  /** A `Floor.id` picked from the station's own floor list. */
  floorId: string;
  /** A nearby exit / ticket_gate POI id, or "" for no anchor. */
  nearPoiId: string;
  /** The entrance wording the shop gives ("〇〇改札付近"); a note only, never a position. */
  entranceWording: string;
  insideGates: InsideGates | "";
  hoursText: string;
  hoursAsOf: string;
  url: string;
  contactKind: ContactKind;
  contactValue: string;
  consent: boolean;
}

export function emptyDraft(stationId: string): MerchantDraft {
  return {
    stationId, nameLang: "ja", nameText: "", aliasesText: "", category: "shop", facility: "", floorId: "",
    nearPoiId: "", entranceWording: "", insideGates: "", hoursText: "", hoursAsOf: "", url: "",
    contactKind: "email", contactValue: "", consent: false,
  };
}

/** A floor offered by the picker: the station's own id and its display names (§3, operator-scoped). */
export interface FloorChoice {
  id: string;
  labels: LocalizedText[];
}

/** An anchor the picker offers: an existing exit or ticket gate of the same station. */
export interface AnchorChoice {
  id: string;
  labels: LocalizedText[];
}

/** What the station files offer the form; built by the page from `manifest()` and `pois()`. */
export interface StationChoices {
  floors: FloorChoice[];
  anchors: AnchorChoice[];
}

/** A field the form must fix before a submission can be built. `code` is stable; `labels.ts` words it. */
export interface SubmissionProblem {
  field: keyof MerchantDraft;
  code: string;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Digits of a phone number, ignoring the usual separators; the shop's own formatting is kept in the value. */
function digits(value: string): string {
  return value.replace(/[^\d]/g, "");
}

function httpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The checks a browser can make on its own (§3 and the client-checkable half of §5). Identity, spam,
 * duplicates and the anomaly flags need the receiving side and are not attempted here.
 */
export function validateDraft(draft: MerchantDraft, choices: StationChoices): SubmissionProblem[] {
  const problems: SubmissionProblem[] = [];
  const add = (field: keyof MerchantDraft, code: string) => problems.push({ field, code });

  if (!draft.nameText.trim()) add("nameText", "name.required");
  else if (draft.nameText.trim().length > 120) add("nameText", "name.too_long");
  if (!draft.nameLang.trim()) add("nameLang", "name.lang");
  if (!(MERCHANT_CATEGORIES as readonly string[]).includes(draft.category)) add("category", "category.invalid");

  if (!draft.floorId) add("floorId", "floor.required");
  else if (!choices.floors.some((f) => f.id === draft.floorId)) add("floorId", "floor.unknown");

  if (draft.nearPoiId && !choices.anchors.some((a) => a.id === draft.nearPoiId)) add("nearPoiId", "anchor.unknown");
  if (draft.entranceWording.trim() && !draft.nearPoiId) add("nearPoiId", "anchor.missing");
  if (!(INSIDE_GATES as readonly string[]).includes(draft.insideGates)) add("insideGates", "gates.required");

  // Hours are a dated statement, never a live status (OD-32): text without its date is refused.
  if (draft.hoursText.trim() && !ISO_DATE.test(draft.hoursAsOf)) add("hoursAsOf", "hours.asOf");
  else if (draft.hoursAsOf && !ISO_DATE.test(draft.hoursAsOf)) add("hoursAsOf", "hours.date");
  if (draft.hoursAsOf && !draft.hoursText.trim()) add("hoursText", "hours.text");

  if (draft.url.trim() && !httpUrl(draft.url.trim())) add("url", "url.invalid");

  const contact = draft.contactValue.trim();
  if (!contact) add("contactValue", "contact.required");
  else if (draft.contactKind === "email" && !EMAIL.test(contact)) add("contactValue", "contact.email");
  else if (draft.contactKind === "phone" && (digits(contact).length < 8 || digits(contact).length > 15)) add("contactValue", "contact.phone");

  if (!draft.consent) add("consent", "consent.required");
  return problems;
}

/** The JSON document a shop hands over. `receivedAt` and the `msub-` id are the receiver's, not the form's. */
export interface MerchantSubmission {
  schema: typeof MERCHANT_SUBMISSION_SCHEMA;
  /** Generated by the form so a resend can be recognised; never used as the source id. */
  clientRequestId: string;
  /** The form's own clock, not a receipt time; the receiver records its own. */
  submittedAt: string;
  station: { id: string; folder: string };
  shop: {
    names: LocalizedText[];
    aliases: LocalizedText[];
    category: MerchantCategory;
    /** As the shop wrote it, a note; null when it gave none. */
    facility: string | null;
  };
  location: {
    floorId: string;
    /** A nearby exit / gate plus the shop's own wording; never a position. */
    anchor: { poiId: string; wording: string } | null;
    insideGates: InsideGates;
  };
  /** Dated hours as the shop states them, or null. Never "open now" (OD-32). */
  hours: { text: string; asOf: string } | null;
  /** The shop's own page, when it has one. */
  url: string | null;
  /** One contact point; it must stay out of every public file (§2). */
  contact: { kind: ContactKind; value: string };
  consent: { termsVersion: string; accepted: true; acceptedAt: string };
}

/**
 * Build the submission JSON. Call `validateDraft` first: this only assembles what the form holds, so no
 * value is invented and an optional field left empty stays null.
 */
export function buildSubmission(
  draft: MerchantDraft,
  choices: StationChoices,
  meta: { stationFolder: string; clientRequestId: string; submittedAt: string },
): MerchantSubmission {
  // The floor must be one the station itself lists: a submission can never name a floor the picker did not offer.
  if (!choices.floors.some((f) => f.id === draft.floorId)) throw new Error(`buildSubmission: ${draft.floorId || "(none)"} is not one of the station's floors`);
  const anchor = draft.nearPoiId ? { poiId: draft.nearPoiId, wording: draft.entranceWording.trim() } : null;
  const aliasLines = draft.aliasesText.split("\n").map((line) => line.trim()).filter(Boolean);
  return {
    schema: MERCHANT_SUBMISSION_SCHEMA,
    clientRequestId: meta.clientRequestId,
    submittedAt: meta.submittedAt,
    station: { id: draft.stationId, folder: meta.stationFolder },
    shop: {
      names: [{ lang: draft.nameLang.trim(), text: draft.nameText.trim() }],
      aliases: aliasLines.map((text) => ({ lang: draft.nameLang.trim(), text })),
      category: draft.category,
      facility: draft.facility.trim() || null,
    },
    location: { floorId: draft.floorId, anchor, insideGates: draft.insideGates as InsideGates },
    hours: draft.hoursText.trim() ? { text: draft.hoursText.trim(), asOf: draft.hoursAsOf } : null,
    url: draft.url.trim() || null,
    contact: { kind: draft.contactKind, value: draft.contactValue.trim() },
    consent: { termsVersion: MERCHANT_TERMS_VERSION, accepted: true, acceptedAt: meta.submittedAt },
  };
}

/** What the receiving side adds before the submission can become station data (§5, §6). */
export interface SubmissionReceipt {
  /** `msub-<station>-<n>`, assigned by the receiver, never reused. */
  submissionId: string;
  /** The public acceptance record: an issue or comment URL for this submission. */
  decisionUrl: string;
  decisionDate: string;
  /** The public, versioned terms page the grant points at (§4.2). */
  termsUrl: string;
}

const SUBMISSION_ID = /^msub-[a-z0-9]+-\d{3,}$/;

/**
 * The `Source` one submission becomes (§6). Every value that must not be invented is taken from the
 * receipt, so a missing acceptance record or terms page throws instead of shipping an empty URL.
 */
export function sourceRecordDraft(sub: MerchantSubmission, receipt: SubmissionReceipt): Source {
  if (!SUBMISSION_ID.test(receipt.submissionId)) throw new Error(`sourceRecordDraft: "${receipt.submissionId}" is not msub-<station>-<n>`);
  if (!httpUrl(receipt.decisionUrl)) throw new Error("sourceRecordDraft: the acceptance record must be a public URL");
  if (!ISO_DATE.test(receipt.decisionDate)) throw new Error(`sourceRecordDraft: decisionDate "${receipt.decisionDate}" is not YYYY-MM-DD`);
  if (!httpUrl(receipt.termsUrl)) throw new Error("sourceRecordDraft: the grant's terms page must be a public URL");
  const name = sub.shop.names[0]?.text ?? "";
  const date = sub.submittedAt.slice(0, 10);
  return {
    id: receipt.submissionId,
    title: `Merchant submission ${receipt.submissionId}`,
    publisher: name,
    // The shop's own page when it has one; otherwise the acceptance record, never empty (§6).
    url: sub.url ?? receipt.decisionUrl,
    license: { name: MERCHANT_LICENSE_ID, url: receipt.termsUrl },
    rights: "REUSABLE_WITH_CONDITIONS",
    usage: "data",
    decision: { url: receipt.decisionUrl, date: receipt.decisionDate },
    attribution: `${name} 「店舗提供」 / "merchant-submitted", terms ${sub.consent.termsVersion}`,
    modified: false,
    retrievedAt: sub.submittedAt,
    datasetDate: date,
    validUntil: null,
  };
}

/**
 * The `evidence.method` prefix the UI keys its "merchant-submitted" label on (§6). The station writer
 * sets it when it merges the submission; the form never writes station files itself.
 */
export function merchantMethod(submissionId: string, checkedDate: string): string {
  return `merchant-submitted (${submissionId}, ${checkedDate}), UNVERIFIED`;
}
