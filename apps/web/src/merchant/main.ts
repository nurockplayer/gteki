import "./form.css";
import { stations as discovered } from "virtual:gteki-stations";
import type { Poi, StationManifestFile } from "@gteki/schema";
import { initialLang, pick, type Lang } from "../i18n.ts";
import { consentText, merchantLabels, problemText } from "./labels.ts";
import {
  buildSubmission, emptyDraft, MERCHANT_CATEGORIES, MERCHANT_TERMS_VERSION, validateDraft,
  type AnchorChoice, type FloorChoice, type MerchantDraft, type StationChoices,
} from "./submission.ts";

/**
 * The merchant form page (#438 Phase 2): fill in the facts, see the JSON the project will receive, save it.
 * No fetch, no post, no storage: the shop hands the file over, and the receiving side assigns the source id
 * and runs the automatic checks. The explorer bundle (three.js, routing) is never imported here.
 */
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

function labelled(labelText: string, control: HTMLElement, id: string): HTMLElement {
  const wrap = el("div", "field");
  const label = el("label", undefined, labelText);
  label.htmlFor = id;
  control.id = id;
  wrap.append(label, control);
  return wrap;
}

function textInput(type = "text"): HTMLInputElement {
  const input = el("input");
  input.type = type;
  input.autocomplete = "off";
  return input;
}

function textArea(rows = 2): HTMLTextAreaElement {
  const area = el("textarea");
  area.rows = rows;
  return area;
}

/** A station the form can list a shop for: what the page reads from one discovered station folder. */
interface StationEntry {
  folder: string;
  stationId: string;
  label: string;
  choices: StationChoices;
}

/** Floors and anchors from the station's own files; ids are kept, display names are only shown. */
export function choicesOf(manifest: StationManifestFile, pois: Poi[]): StationChoices {
  const floors: FloorChoice[] = (manifest.floors ?? []).map((f) => ({ id: f.id, labels: f.displayNames?.length ? f.displayNames : f.sourceLabels.map((s) => ({ lang: "ja" as const, text: s.label })) }));
  const anchors: AnchorChoice[] = pois
    .filter((p) => p.category === "exit" || p.category === "ticket_gate")
    .map((p) => ({ id: p.id, labels: p.names }));
  return { floors, anchors };
}

async function loadStations(): Promise<StationEntry[]> {
  const entries: StationEntry[] = [];
  for (const s of discovered) {
    // A station whose files cannot be read is left out of the form rather than listed with no floors.
    try {
      const manifest = (await s.manifest()) as StationManifestFile;
      const pois = (await s.pois()) as { pois?: Poi[] };
      if (!manifest?.station?.id || !Array.isArray(manifest.floors)) continue;
      entries.push({ folder: s.dir, stationId: manifest.station.id, label: pick(manifest.station.names, "ja"), choices: choicesOf(manifest, pois.pois ?? []) });
    } catch {
      continue;
    }
  }
  return entries;
}

function newRequestId(): string {
  const c = globalThis.crypto;
  return c && "randomUUID" in c ? c.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/** The JSON document as the shop saves it: stable key order, two-space indent, trailing newline. */
export function submissionFile(sub: unknown): string {
  return `${JSON.stringify(sub, null, 2)}\n`;
}

function mount(): void {
  const found = document.getElementById("merchant");
  if (!found) return;
  // A const alias: the render closures below are re-created on every change and must keep the narrowed type.
  const root: HTMLElement = found;
  let lang: Lang = initialLang();
  let entries: StationEntry[] = [];
  let station: StationEntry | null = null;
  let draft: MerchantDraft = emptyDraft("");

  const draftOf = (): MerchantDraft => ({ ...draft, stationId: station?.stationId ?? "" });
  const choices = (): StationChoices => station?.choices ?? { floors: [], anchors: [] };

  function render(): void {
    const t = merchantLabels(lang);
    root.replaceChildren();

    const header = el("header", "merchant-header");
    header.append(el("h1", undefined, t.title), el("p", "lede", t.intro), el("p", "note", t.notSent));
    const langButton = el("button", "lang", lang === "ja" ? "English" : "日本語");
    langButton.type = "button";
    langButton.addEventListener("click", () => {
      lang = lang === "ja" ? "en" : "ja";
      document.documentElement.lang = lang;
      render();
    });
    header.append(langButton);
    root.append(header);

    const form = el("form", "merchant-form");
    form.noValidate = true;
    form.addEventListener("submit", (e) => e.preventDefault());

    const stationSelect = el("select");
    stationSelect.append(Object.assign(el("option", undefined, t.stationPlaceholder), { value: "" }));
    for (const entry of entries) stationSelect.append(Object.assign(el("option", undefined, entry.label), { value: entry.folder }));
    stationSelect.value = station?.folder ?? "";
    stationSelect.addEventListener("change", () => {
      station = entries.find((e) => e.folder === stationSelect.value) ?? null;
      draft = { ...emptyDraft(station?.stationId ?? ""), nameLang: draft.nameLang, nameText: draft.nameText, aliasesText: draft.aliasesText, category: draft.category, contactKind: draft.contactKind, contactValue: draft.contactValue, consent: draft.consent };
      render();
    });
    form.append(labelled(t.station, stationSelect, "station"));

    const name = textInput();
    name.value = draft.nameText;
    name.addEventListener("input", () => { draft = { ...draft, nameText: name.value }; update(); });
    form.append(labelled(t.nameLabel, name, "name"));

    const nameLang = textInput();
    nameLang.value = draft.nameLang;
    nameLang.addEventListener("input", () => { draft = { ...draft, nameLang: nameLang.value.trim() }; update(); });
    form.append(labelled(t.nameLangLabel, nameLang, "name-lang"));

    const aliases = textArea(3);
    aliases.value = draft.aliasesText;
    aliases.addEventListener("input", () => { draft = { ...draft, aliasesText: aliases.value }; update(); });
    form.append(labelled(t.aliasesLabel, aliases, "aliases"));

    const category = el("select");
    for (const c of MERCHANT_CATEGORIES) category.append(Object.assign(el("option", undefined, t.category[c]), { value: c }));
    category.value = draft.category;
    category.addEventListener("change", () => { draft = { ...draft, category: category.value as MerchantDraft["category"] }; update(); });
    form.append(labelled(t.categoryLabel, category, "category"));

    const facility = textInput();
    facility.value = draft.facility;
    facility.addEventListener("input", () => { draft = { ...draft, facility: facility.value }; update(); });
    form.append(labelled(t.facilityLabel, facility, "facility"));

    const floor = el("select");
    floor.append(Object.assign(el("option", undefined, t.floorPlaceholder), { value: "" }));
    for (const f of choices().floors) floor.append(Object.assign(el("option", undefined, pick(f.labels, lang)), { value: f.id }));
    floor.value = draft.floorId;
    floor.addEventListener("change", () => { draft = { ...draft, floorId: floor.value }; update(); });
    form.append(labelled(t.floorLabel, floor, "floor"));

    const anchor = el("select");
    anchor.append(Object.assign(el("option", undefined, t.anchorNone), { value: "" }));
    for (const a of choices().anchors) anchor.append(Object.assign(el("option", undefined, pick(a.labels, lang)), { value: a.id }));
    anchor.value = draft.nearPoiId;
    anchor.addEventListener("change", () => { draft = { ...draft, nearPoiId: anchor.value }; update(); });
    form.append(labelled(t.anchorLabel, anchor, "anchor"));

    const entrance = textInput();
    entrance.value = draft.entranceWording;
    entrance.addEventListener("input", () => { draft = { ...draft, entranceWording: entrance.value }; update(); });
    form.append(labelled(t.entranceLabel, entrance, "entrance"));

    const gates = el("select");
    gates.append(Object.assign(el("option", undefined, t.floorPlaceholder), { value: "" }));
    for (const g of ["inside", "outside", "not_sure"] as const) gates.append(Object.assign(el("option", undefined, t.gates[g]), { value: g }));
    gates.value = draft.insideGates;
    gates.addEventListener("change", () => { draft = { ...draft, insideGates: gates.value as MerchantDraft["insideGates"] }; update(); });
    form.append(labelled(t.gatesLabel, gates, "gates"));

    const hours = textInput();
    hours.value = draft.hoursText;
    hours.addEventListener("input", () => { draft = { ...draft, hoursText: hours.value }; update(); });
    form.append(labelled(t.hoursLabel, hours, "hours"));

    const hoursAsOf = textInput("date");
    hoursAsOf.value = draft.hoursAsOf;
    hoursAsOf.addEventListener("input", () => { draft = { ...draft, hoursAsOf: hoursAsOf.value }; update(); });
    form.append(labelled(t.hoursAsOfLabel, hoursAsOf, "hours-as-of"));

    const url = textInput("url");
    url.value = draft.url;
    url.addEventListener("input", () => { draft = { ...draft, url: url.value }; update(); });
    form.append(labelled(t.urlLabel, url, "url"));

    const contactKind = el("select");
    for (const k of ["email", "phone"] as const) contactKind.append(Object.assign(el("option", undefined, t.contactKinds[k]), { value: k }));
    contactKind.value = draft.contactKind;
    contactKind.addEventListener("change", () => { draft = { ...draft, contactKind: contactKind.value as MerchantDraft["contactKind"] }; update(); });
    const contactValue = textInput();
    contactValue.value = draft.contactValue;
    contactValue.addEventListener("input", () => { draft = { ...draft, contactValue: contactValue.value }; update(); });
    const contactRow = el("div", "field");
    const contactLabel = el("label", undefined, t.contactLabel);
    contactLabel.htmlFor = "contact-value";
    contactKind.id = "contact-kind";
    contactValue.id = "contact-value";
    const contactBox = el("div", "row");
    contactBox.append(contactKind, contactValue);
    contactRow.append(contactLabel, contactBox);
    form.append(contactRow);

    const consent = el("input");
    consent.type = "checkbox";
    consent.id = "consent";
    consent.checked = draft.consent;
    consent.addEventListener("change", () => { draft = { ...draft, consent: consent.checked }; update(); });
    const consentRow = el("div", "field consent");
    const consentLabel = el("label", undefined, consentText(lang, MERCHANT_TERMS_VERSION));
    consentLabel.htmlFor = "consent";
    consentRow.append(consent, consentLabel);
    form.append(consentRow);

    const problems = el("section", "problems");
    const preview = el("section", "preview");
    const previewTitle = el("h2", undefined, t.preview);
    const previewText = el("pre", "json");
    const actions = el("div", "actions");
    const copy = el("button", undefined, t.copy);
    copy.type = "button";
    const download = el("button", undefined, t.download);
    download.type = "button";
    actions.append(copy, download);
    preview.append(previewTitle, previewText, actions);

    root.append(form, problems, preview);

    let current: string | null = null;

    function update(): void {
      const t2 = merchantLabels(lang);
      problems.replaceChildren(el("h2", undefined, t2.errors));
      current = null;
      previewText.textContent = station ? t2.previewProblem : t2.chooseStation;
      if (!station) {
        problems.append(el("p", "ok", t2.chooseStation));
      } else {
        const found = validateDraft(draftOf(), choices());
        if (found.length === 0) problems.append(el("p", "ok", t2.none));
        else {
          const list = el("ul");
          for (const p of found) list.append(el("li", undefined, problemText(lang, p.code)));
          problems.append(list);
        }
        if (found.length === 0) {
          current = submissionFile(buildSubmission(draftOf(), choices(), { stationFolder: station.folder, clientRequestId: requestId, submittedAt: submittedAt }));
          previewText.textContent = current;
        }
      }
      copy.disabled = current === null;
      download.disabled = current === null;
    }

    const requestId = newRequestId();
    const submittedAt = new Date().toISOString();
    copy.addEventListener("click", () => {
      if (current === null) return;
      void navigator.clipboard?.writeText(current);
      copy.textContent = merchantLabels(lang).copied;
    });
    download.addEventListener("click", () => {
      if (current === null || !station) return;
      const blob = new Blob([current], { type: "application/json" });
      const link = el("a");
      link.href = URL.createObjectURL(blob);
      link.download = `merchant-submission-${station.folder}-${requestId.slice(0, 8)}.json`;
      link.click();
      URL.revokeObjectURL(link.href);
    });

    update();
  }

  void loadStations().then((loaded) => {
    entries = loaded;
    render();
  });
  root.append(el("p", "loading", "…"));
}

mount();
