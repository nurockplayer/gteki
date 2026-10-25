import type { Lang } from "../i18n.ts";
import { emptyDraft, type MerchantDraft } from "./submission.ts";

/**
 * What the merchant page holds between renders (#438 review): the language, the draft and the
 * submission's own clock. A render reads this state and never owns it, so switching the language —
 * which re-creates every control — cannot re-generate the request id or move the times.
 */
export interface FormClock {
  /** Generated once per form session: a resend keeps it, a reload does not. Never a source id. */
  clientRequestId: string;
  /** The form's clock when the page opened; the receiver records its own receipt time. */
  submittedAt: string;
  /** ISO time the consent box was ticked, "" while it is unticked. */
  consentAcceptedAt: string;
}

export interface FormState {
  lang: Lang;
  draft: MerchantDraft;
  clock: FormClock;
}

function newRequestId(): string {
  const c = globalThis.crypto;
  return c && "randomUUID" in c ? c.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const now = (): Date => new Date();

/** A fresh form session: one clock, one draft. `newId` and `clock` are injectable so tests stay deterministic. */
export function newFormState(lang: Lang, stationId = "", newId: () => string = newRequestId, clock: () => Date = now): FormState {
  return { lang, draft: emptyDraft(stationId), clock: { clientRequestId: newId(), submittedAt: clock().toISOString(), consentAcceptedAt: "" } };
}

/** A language switch re-renders the page; it never touches the draft or the clock. */
export function withLang(state: FormState, lang: Lang): FormState {
  return lang === state.lang ? state : { ...state, lang };
}

export function withDraft(state: FormState, patch: Partial<MerchantDraft>): FormState {
  return { ...state, draft: { ...state.draft, ...patch } };
}

/**
 * The consent tick (§4): `acceptedAt` is the moment the box was ticked and stays there through any
 * re-render or language switch. Unticking clears it, so a tick after an untick records its own time.
 */
export function withConsent(state: FormState, accepted: boolean, clock: () => Date = now): FormState {
  if (accepted === state.draft.consent) return state;
  return {
    ...state,
    draft: { ...state.draft, consent: accepted },
    clock: { ...state.clock, consentAcceptedAt: accepted ? clock().toISOString() : "" },
  };
}

/**
 * A station change empties the station-scoped fields (floors and anchors belong to that station) but
 * keeps what the shop itself wrote, its contact and the clock.
 */
export function withStation(state: FormState, stationId: string): FormState {
  const { nameLang, nameText, aliasesText, category, contactKind, contactValue, consent } = state.draft;
  return { ...state, draft: { ...emptyDraft(stationId), nameLang, nameText, aliasesText, category, contactKind, contactValue, consent } };
}
