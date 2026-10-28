import type { Poi, Source } from "@gteki/schema";
import { pick, type Lang, type Strings } from "../i18n.ts";
import { poiNoteText } from "./noRouteText.ts";

/**
 * The merchant information card (#213): what the listing itself states about one shop — its name, its
 * category, the floor or area as recorded, how precise the location is, the source and when it was checked.
 * Nothing is inferred: a missing source, floor or date is shown as missing, never filled in, and the card
 * offers no directions (a merchant listing has no verified entrance; the guide button belongs to the route card).
 */
export type MerchantPrecision = "point" | "area" | "search";

/**
 * The precision the listing's own evidence text states. The tokens are the data's, not a ranking of ours.
 * A display position is a verified location only when the POI is routable (#213) and its evidence is not
 * SEARCH_ONLY: a listing's own point without a connector has no verified entrance, and a connector does not
 * turn a search-only listing's point into one, so both fall back to the evidence wording.
 */
export function merchantPrecision(poi: Poi): MerchantPrecision | null {
  const method = poi.evidence.method;
  const searchOnly = /\bSEARCH_ONLY\b/.test(method);
  if (poi.displayPosition !== null && poi.connectorNodeIds.length > 0 && !searchOnly) return "point";
  if (/\bAREA_ONLY\b/.test(method)) return "area";
  if (searchOnly) return "search";
  return null;
}

export interface MerchantCardModel {
  id: string;
  name: string;
  description?: string;
  category: string;
  /** The station floor label the POI records, or null: a merchant listing carries no floor id today. */
  floor: string | null;
  precision: MerchantPrecision | null;
  /** The date the listing was checked, as the POI records it, or null. */
  checkedDate: string | null;
  /** The source the POI cites, when the bundle holds it; `url` may be null (a facts-only source need not have one). */
  source: { title: string; url: string | null } | null;
  /** The note as printed (area wording and the search-only statement), or null. */
  note: string | null;
  /** True only with a verified connector: the data owner's real evidence, never the listing alone. */
  routable: boolean;
}

export function merchantCardModel(poi: Poi, sources: readonly Source[], lang: Lang, floor: string | null): MerchantCardModel {
  const source = poi.evidence.sourceIds
    .map((id) => sources.find((s) => s.id === id))
    .find((s): s is Source => s !== undefined) ?? null;
  return {
    id: poi.id,
    name: pick(poi.names, lang) || poi.id,
    description: poi.descriptions?.find((d) => d.lang === lang)?.text,
    category: poi.category,
    floor,
    precision: merchantPrecision(poi),
    checkedDate: poi.evidence.checkedDate || null,
    source: source ? { title: source.title, url: source.url ?? null } : null,
    note: poiNoteText(poi, lang),
    routable: poi.connectorNodeIds.length > 0,
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The card's DOM. No button of any kind: directions are offered only by the route card, and only when routable. */
export function merchantCardEl(model: MerchantCardModel, t: Strings): HTMLElement {
  const card = el("div", "card merchant");
  card.dataset.poiId = model.id;
  card.append(el("h2", "merchant-name", model.name));
  if (model.description) card.append(el("p", "muted merchant-description", model.description));
  const meta = [
    t.categoryNames[model.category] ?? model.category,
    model.floor,
    model.precision ? t.merchant.precision[model.precision] : null,
  ].filter(Boolean).join(" · ");
  card.append(el("p", "merchant-meta", meta));
  // The shop's own note carries the area wording as printed; it never becomes a floor or a position.
  if (model.note) card.append(el("p", "muted merchant-note", model.note));
  if (!model.routable) card.append(el("p", "merchant-no-route", t.shopSearchOnly));
  const source = el("p", "merchant-source");
  source.append(el("span", "muted", `${t.merchant.source}: `));
  if (!model.source) source.append(el("span", "merchant-source-unknown", t.merchant.sourceUnknown));
  else if (model.source.url) {
    const link = el("a", "merchant-source-link", model.source.title);
    link.href = model.source.url;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    source.append(link);
  } else source.append(el("span", "merchant-source-title", model.source.title));
  card.append(source);
  if (model.checkedDate) card.append(el("p", "muted merchant-checked", `${t.merchant.checked}: ${model.checkedDate}`));
  return card;
}
