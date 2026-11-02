import type { Poi, Source, Tenant } from "@gteki/schema";
import { pick, type Lang, type Strings } from "../i18n.ts";
import { poiNoteText } from "./noRouteText.ts";
import { printedFloor, tenantLabel } from "./tenantDisplay.ts";

/**
 * The merchant information card (#213): what the listing itself states about one shop — its name, its
 * category, the floor or area as recorded, how precise the location is, the source and when it was checked.
 * Nothing is inferred: a missing source, floor or date is shown as missing, never filled in, and the card
 * offers no directions (a merchant listing has no verified entrance; the guide button belongs to the route card).
 */
export type MerchantPrecision = "door" | "tie" | "point" | "area" | "search";

/** A store whose route ends at a printed station-level tie (a gate), not at its own verified entrance (#213). */
export const isStationTie = (poi: Poi) => /\bSTATION_TIE\b/.test(poi.evidence.method);

/**
 * A store whose route ends at a door read from an operator's map (P_MAP_DOOR): only the private build's data carries
 * the token (OD-35), and the door is still unverified on site, so it is labelled, never called a verified position.
 */
export const isMapReadDoor = (poi: Poi) => /\bP_MAP_DOOR\b/.test(poi.evidence.method);

/** How a routable store's arrival is labelled: a map-read door, a station-level tie, or nothing (a verified point). */
export function arrivalPrecision(poi: Poi): "door" | "tie" | null {
  if (poi.connectorNodeIds.length > 0 && isMapReadDoor(poi)) return "door";
  return isStationTie(poi) ? "tie" : null;
}

/**
 * The precision the listing's own evidence text states. The tokens are the data's, not a ranking of ours.
 * A display position is a verified location only when the POI is routable (#213) and its evidence is not
 * SEARCH_ONLY: a listing's own point without a connector has no verified entrance, and a connector does not
 * turn a search-only listing's point into one, so both fall back to the evidence wording.
 * A map-read door, then STATION_TIE, come first: a route to either is a route, never a verified entrance.
 */
export function merchantPrecision(poi: Poi): MerchantPrecision | null {
  const method = poi.evidence.method;
  const arrival = arrivalPrecision(poi);
  if (arrival) return arrival;
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
  floors: {
    label: string;
    brands: { name: string; category: string | null }[];
    sourceIds: string[];
    checkedDate: string | null;
  }[];
}

export function merchantCardModel(poi: Poi, sources: readonly Source[], lang: Lang, floor: string | null, tenants: readonly Tenant[]): MerchantCardModel {
  const source = poi.evidence.sourceIds
    .map((id) => sources.find((s) => s.id === id))
    .find((s): s is Source => s !== undefined) ?? null;
  const floors = new Map<string, MerchantCardModel["floors"][number]>();
  for (const tenant of tenants) {
    const { name, floorLabel } = tenantLabel(tenant, lang);
    let group = floors.get(floorLabel);
    if (!group) {
      group = { label: floorLabel, brands: [], sourceIds: [], checkedDate: tenant.evidence.checkedDate || null };
      floors.set(floorLabel, group);
    }
    group.brands.push({ name, category: tenant.category?.length ? pick(tenant.category, lang) : null });
    for (const id of tenant.evidence.sourceIds) if (!group.sourceIds.includes(id)) group.sourceIds.push(id);
  }
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
    floors: [...floors.values()],
  };
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/** The card's DOM. No button of any kind: directions are offered only by the route card, and only when routable. */
export function merchantCardEl(model: MerchantCardModel, t: Strings, sources: readonly Source[], lang: Lang): HTMLElement {
  const card = el("div", "card merchant");
  card.dataset.poiId = model.id;
  card.append(el("h2", "merchant-name", model.name));
  if (model.description) card.append(el("p", "muted merchant-description", model.description));
  const meta = [
    t.categoryNames[model.category] ?? model.category,
    model.floor,
    model.precision ? t.merchant.precision[model.precision] : null,
    !model.routable ? t.merchant.precision.unverified : null,
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
  if (model.floors.length) {
    const counted = (label: string, n: number) => lang === "ja" ? `${label}（${n}）` : `${label} (${n})`;
    const directory = el("details", "merchant-floors");
    directory.append(el("summary", undefined, counted(t.merchant.floorsTitle, model.floors.reduce((n, f) => n + f.brands.length, 0))));
    const filter = el("input", "merchant-floors-filter");
    filter.type = "search";
    filter.placeholder = t.merchant.floorsFilter;
    filter.setAttribute("aria-label", t.merchant.floorsFilter);
    directory.append(filter);
    const entries = model.floors.map((floor) => {
      const detail = el("details", "merchant-floor");
      detail.dataset.floor = floor.label;
      detail.append(el("summary", undefined, counted(printedFloor(floor.label, lang, t), floor.brands.length)));
      const titles = floor.sourceIds.map((id) => sources.find((s) => s.id === id)?.title ?? t.merchant.sourceUnknown);
      const evidence = el("p", "muted merchant-floor-source", [
        `${t.merchant.source}: ${titles.join(" · ") || t.merchant.sourceUnknown}`,
        floor.checkedDate ? t.tenantAsOf(floor.checkedDate) : null,
      ].filter(Boolean).join(" · "));
      detail.append(evidence);
      let list: HTMLUListElement | null = null;
      const render = (brands: typeof floor.brands) => {
        if (!list) {
          list = el("ul");
          detail.insertBefore(list, evidence);
        }
        list.replaceChildren(...brands.map((brand) => {
          const row = el("li", undefined, brand.name);
          if (brand.category) row.append(el("span", "muted", ` · ${brand.category}`));
          return row;
        }));
      };
      detail.addEventListener("toggle", () => { if (detail.open && !list) render(floor.brands); });
      directory.append(detail);
      return { floor, detail, render, hasList: () => list !== null };
    });
    filter.addEventListener("input", () => {
      const query = filter.value.normalize("NFKC").toLowerCase();
      for (const { floor, detail, render, hasList } of entries) {
        const brands = floor.brands.filter((b) => b.name.normalize("NFKC").toLowerCase().includes(query));
        detail.hidden = query !== "" && brands.length === 0;
        detail.open = query !== "" && brands.length > 0;
        if (detail.open || hasList()) render(brands);
      }
    });
    card.append(directory);
  }
  return card;
}
