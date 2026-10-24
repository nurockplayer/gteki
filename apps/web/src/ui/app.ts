import { createRouter, describeRoute, explainNoPathBetween, floorDisplayName, instructionPoints, routeBetween, routePolyline, ROUTE_PACE } from "@gteki/navigation";
import type { Instruction, NoPathCause, PolylinePoint, RouteFailure, RouteProfile, RouteResult, Router } from "@gteki/navigation";
import type { Poi, Source, StationBundle, Tenant } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import type { SearchHit, SearchIndex } from "@gteki/search";
import { Explorer } from "../explorer/explorer.ts";
import { avatarGlbUrl } from "../explorer/avatarSelection.ts";
import { guideStops } from "../explorer/guideStops.ts";
import { firstStopFor, guideKeyActionGuarded, instructionStartsM, jumpTarget, StepClock } from "../explorer/guideSteps.ts";
import { DEFAULT_GUIDE_TIER, guidePaceSpans, guideTierSpeed, isGuideTier, nextGuideTier, paceReadout, polylineLengthM, type GuideTierId, type PaceSpan } from "../explorer/guidePace.ts";
import { coverageText, initialLang, pick, strings, type Lang } from "../i18n.ts";
import { listStations, StationLoadError, type LoadedStation, type StationEntry } from "../registry.ts";
import { noPathView } from "../noPath.ts";
import { isUnlocatedShop, noRouteText, poiNoteText } from "./noRouteText.ts";
import { stationClock } from "../stationClock.ts";
import { assetDerivationPresentation, dataFileCredits, dataFileRowText, factsOnlyCredit, overrideCredits, sourceCredit } from "../credits.ts";
import { creditEntries, creditLineFor, entryRightsLabels, groupLicenses } from "../creditLine.ts";
import { applyAria, COMBO_CLOSED, comboboxKeys, inputAria, isImeKeydown, listboxRole, normalizeCombo, optionAria, type ComboState } from "./combobox.ts";
import { nodeLabel, poiLabel } from "./labels.ts";
import { tenantAsOfNote, tenantCheckedDate, tenantDestinationTitle, tenantLabel, tenantResultTags } from "./tenantDisplay.ts";
import { LiveRegion, freshnessReason, routeLiveMessage, searchLiveMessage, unknownLabel } from "./live.ts";
import { MascotSlot, type MascotEvent } from "./mascot.ts";
import { watchReducedMotion } from "./motion.ts";
import { railDemoLink } from "./railTravel.ts";
import { spawnHeading } from "./spawnHeading.ts";
import { StationIdentityView } from "./identityCard.ts";
import { RailRideDemo } from "./railRideDemo.ts";
import { shouldHandleGuideKey } from "./railKeyGuard.ts";

/** IANA time zone of the supported stations; routes are timed in it and waits name it. */
const STATION_TIME_ZONE = "Asia/Tokyo";

/** Where a route starts: a POI (via its verified entrances) or a graph node (spawn / avatar). */
type Origin = { kind: "poi"; poi: Poi } | { kind: "node"; nodeId: string; label: string };

interface State {
  lang: Lang;
  entries: StationEntry[];
  entry: StationEntry | null;
  loaded: LoadedStation | null;
  router: Router | null;
  search: SearchIndex | null;
  origin: Origin | null;
  destination: Poi | null;
  /** Set when the destination was picked through a store's brand directory (#419); routing still goes to the store. */
  destinationTenant: Tenant | null;
  profile: { stepFree: boolean; unpaidOnly: boolean; strictHours: boolean };
  route: RouteResult | RouteFailure | null;
  /** Which enabled option made the last `no_path` refuse (null = not a no_path). */
  noPath: NoPathCause | null;
  polyline: PolylinePoint[];
  instructions: Instruction[];
  activeInstruction: number;
}

const GUIDE_TIER_KEY = "gteki.guideTier";

function readGuideTier(): GuideTierId {
  try {
    const v = localStorage.getItem(GUIDE_TIER_KEY);
    return isGuideTier(v) ? v : DEFAULT_GUIDE_TIER;
  } catch { return DEFAULT_GUIDE_TIER; }
}

function writeGuideTier(id: GuideTierId): void {
  try { localStorage.setItem(GUIDE_TIER_KEY, id); } catch { /* storage unavailable: the choice lasts for the session */ }
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};


export class App {
  private readonly s: State = {
    lang: initialLang(), entries: [], entry: null, loaded: null, router: null, search: null,
    origin: null, destination: null, destinationTenant: null, profile: { stepFree: false, unpaidOnly: false, strictHours: false },
    route: null, noPath: null, polyline: [], instructions: [], activeInstruction: 0,
  };
  private explorer!: Explorer;
  private readonly identityView = new StationIdentityView();
  private railRide: RailRideDemo | null = null;
  private readonly ui = {
    stationSelect: el("select", "station-select"),
    banner: el("div", "banner"),
    fromInput: el("input", "field-input"),
    toInput: el("input", "field-input"),
    fromNote: el("p", "field-note"),
    toNote: el("p", "field-note"),
    fromResults: el("div", "results"),
    toResults: el("div", "results"),
    spawnChips: el("div", "chips"),
    profile: el("div", "chips profile"),
    sheet: el("section", "sheet"),
    hud: el("div", "hud"),
    coverage: el("dialog", "coverage"),
    toast: el("div", "toast"),
    langBtn: el("button", "ghost lang"),
    coverageBtn: el("button", "ghost"),
    railBtn: el("button", "ghost rail-launch"),
    hint: el("div", "hint"),
    credit: el("footer", "credit-line"),
    panel: el("section", "panel"),
    more: el("button", "ghost more", "⋯"),
    live: new LiveRegion(() => this.t),
    mascot: new MascotSlot(() => this.t, (text) => this.ui.live.announce(text)),
  };
  /** Listbox state of the two search comboboxes. */
  private readonly combo: Record<"from" | "to", ComboState> = { from: COMBO_CLOSED, to: COMBO_CLOSED };
  private panelExpanded = false;
  /** When the last IME composition ended anywhere on the page; the guide keys ignore its confirming keys. */
  private compositionEndMs = -Infinity;

  constructor(private readonly root: HTMLElement) {}

  private get t() {
    return strings(this.s.lang);
  }

  async start(): Promise<void> {
    this.layout();
    const params = new URLSearchParams(location.search);
    this.explorer = new Explorer(this.root.querySelector(".viewport") as HTMLElement, {
      onMode: (mode) => this.onMode(mode),
      onGuideProgress: (p) => this.onGuideProgress(p),
      onGuideStop: (index) => this.onGuideStop(index),
      onPoiClick: (id) => {
        const poi = this.s.loaded?.bundle.pois.find((p) => p.id === id);
        if (poi) this.setDestination(poi);
      },
    }, { avatarGlbUrl: avatarGlbUrl(params, location.href) });
    // The overview is framed into the part of the view the search panel leaves free (below it on a phone,
    // to its right on a desktop); the panel's own size changes refit it (see Explorer.setPanel).
    this.explorer.setPanel(this.ui.panel);
    this.explorer.setGuideTier(readGuideTier());
    this.bindGuideKeys();
    watchReducedMotion((reduce) => {
      this.explorer.setReducedMotion(reduce);
      this.ui.mascot.setMotion(reduce, this.explorer.qualityLevel === "low");
    });
    this.exposeTestHooks();
    this.s.entries = await listStations();
    this.renderStationSelect();
    const wanted = params.get("station");
    const entry = this.s.entries.find((e) => e.key === wanted) ?? this.s.entries.find((e) => !e.synthetic) ?? this.s.entries[0]!;
    await this.openStation(entry, params.get("from"), params.get("to"));
  }

  // ---- Layout ----------------------------------------------------------------------

  private layout(): void {
    this.root.innerHTML = "";
    this.root.className = "app";
    const viewport = el("div", "viewport");
    const top = el("header", "topbar");
    const brand = el("div", "brand");
    brand.append(el("span", "logo", "GTEki"), el("span", "tagline", this.t.tagline));
    this.ui.stationSelect.setAttribute("aria-label", this.t.station);
    this.ui.stationSelect.addEventListener("change", () => {
      const entry = this.s.entries.find((e) => e.key === this.ui.stationSelect.value);
      if (entry) void this.openStation(entry);
    });
    this.ui.langBtn.addEventListener("click", () => {
      this.s.lang = this.s.lang === "ja" ? "en" : "ja";
      this.layoutText();
      this.refreshAll();
    });
    this.ui.coverageBtn.addEventListener("click", () => this.openCoverage());
    this.ui.railBtn.hidden = true;
    this.ui.railBtn.addEventListener("click", () => this.startRailRide());
    const actions = el("div", "top-actions");
    actions.append(this.ui.coverageBtn, this.ui.langBtn);
    top.append(brand, this.ui.stationSelect, actions);

    const panel = this.ui.panel;
    this.ui.more.addEventListener("click", () => { this.panelExpanded = !this.panelExpanded; this.updatePanelCollapse(); });
    const fromRow = this.field("from", this.ui.fromInput, this.ui.fromResults, this.ui.fromNote);
    const toRow = this.field("to", this.ui.toInput, this.ui.toResults, this.ui.toNote);
    const swap = el("button", "swap", "⇅");
    swap.title = this.t.swap;
    swap.setAttribute("aria-label", this.t.swap);
    swap.addEventListener("click", () => this.swap());
    const fields = el("div", "fields");
    fields.append(fromRow, toRow, swap);
    panel.append(this.identityView.overview, this.ui.banner, fields, this.ui.spawnChips, this.ui.profile, this.ui.more);

    this.ui.hint.setAttribute("role", "note");
    this.root.append(viewport, top, panel, this.ui.sheet, this.ui.hud, this.ui.toast, this.identityView.card, this.ui.live.el, this.ui.coverage, this.ui.hint, this.ui.credit);
    this.layoutText();
  }

  private layoutText(): void {
    const t = this.t;
    document.documentElement.lang = this.s.lang;
    this.ui.langBtn.textContent = t.language;
    this.ui.langBtn.dataset.short = this.s.lang === "ja" ? "EN" : "日本語";
    this.ui.coverageBtn.textContent = t.coverage;
    this.ui.railBtn.textContent = this.s.lang === "ja" ? "電車に乗る（デモ・未調査）" : "Ride train (demo, not surveyed)";
    this.ui.railBtn.title = this.s.lang === "ja" ? "埼京線 乗車デモ（仮設ホーム）" : "JR Saikyo ride demo (temporary platform)";
    this.ui.more.setAttribute("aria-label", t.options);
    this.ui.fromInput.placeholder = t.fromPlaceholder;
    this.ui.toInput.placeholder = t.toPlaceholder;
    this.root.querySelectorAll<HTMLElement>("[data-label]").forEach((n) => { n.textContent = t[n.dataset.label as "from" | "to"]; });
    this.ui.hint.textContent = matchMedia("(pointer: coarse)").matches ? t.touchHint : t.controlsHint;
  }

  private field(which: "from" | "to", input: HTMLInputElement, results: HTMLDivElement, note: HTMLParagraphElement): HTMLDivElement {
    const row = el("div", `field field-${which}`);
    const label = el("label", "field-label");
    label.dataset.label = which;
    input.type = "search";
    input.autocomplete = "off";
    input.spellcheck = false;
    input.id = `gteki-${which}`;
    label.htmlFor = input.id;
    results.id = `gteki-${which}-listbox`;
    applyAria(input, inputAria(COMBO_CLOSED, results.id));
    input.addEventListener("input", () => this.renderResults(which));
    input.addEventListener("focus", () => this.renderResults(which));
    let compositionEndMs = -Infinity;
    input.addEventListener("compositionend", () => { compositionEndMs = performance.now(); });
    input.addEventListener("keydown", (e) => {
      // The Enter that confirms an IME conversion is not a pick (Safari reports it as not composing).
      if (isImeKeydown(e, compositionEndMs, performance.now())) return;
      // Arrows reopen a closed list.
      if (!this.combo[which].open && (e.key === "ArrowDown" || e.key === "ArrowUp")) this.renderResults(which);
      const out = comboboxKeys(this.combo[which], e.key);
      if (!out.handled) return;
      e.preventDefault();
      if (out.pick !== null) results.querySelectorAll<HTMLElement>('[role="option"]')[out.pick]?.click();
      else this.setCombo(which, out);
    });
    input.addEventListener("blur", () => setTimeout(() => this.closeResults(which), 160));
    // A picked search-only POI keeps its note beside the field (the input holds only the searchable name).
    note.id = `gteki-${which}-note`;
    note.hidden = true;
    input.setAttribute("aria-describedby", note.id);
    row.append(label, input, results, note);
    return row;
  }

  // ---- Station ---------------------------------------------------------------------

  private renderStationSelect(): void {
    this.ui.stationSelect.innerHTML = "";
    for (const e of this.s.entries) {
      const o = el("option", undefined, e.synthetic ? `⚠ ${e.label}` : e.label);
      o.value = e.key;
      this.ui.stationSelect.append(o);
    }
  }

  private openGeneration = 0;
  /** True only once the selected station's data and scene are both current; endpoint controls wait for it. */
  private stationReady = false;

  private async openStation(entry: StationEntry, fromId?: string | null, toId?: string | null, fromRide = false): Promise<void> {
    if (!fromRide) { this.railRide?.dispose(); this.railRide = null; }
    this.ui.railBtn.hidden = true;
    // A later selection supersedes this one: never let a slow station overwrite the one now selected.
    const generation = ++this.openGeneration;
    const current = () => generation === this.openGeneration;
    this.explorer.cancelPendingLoad(entry.key);
    this.s.entry = entry;
    this.ui.stationSelect.value = entry.key;
    // Drop the previous station's services now, not after the await: nothing may search or route
    // against the old bundle while the new one loads.
    this.stationReady = false;
    this.s.loaded = null;
    this.s.router = null;
    this.s.search = null;
    this.s.origin = null;
    this.s.destination = null;
    this.s.destinationTenant = null;
    this.s.route = null;
    this.s.polyline = [];
    this.s.instructions = [];
    this.renderCredit();
    this.ui.fromInput.value = "";
    this.ui.toInput.value = "";
    this.renderEndpointNote(this.ui.fromNote, null);
    this.renderEndpointNote(this.ui.toNote, null);
    this.closeResults("from");
    this.closeResults("to");
    this.ui.mascot.clear();
    this.ui.sheet.innerHTML = "";
    this.renderSpawnChips(undefined);
    this.toast("");
    const names = this.identityView.showCard(entry.identity, entry.label, this.s.lang);
    this.ui.live.announce(`${names.ja} ${names.kana} ${names.en} · ${this.t.loading}`);
    try {
      const loaded = await entry.load();
      if (!current()) return;
      this.identityView.showCard(loaded.bundle.station.identity, entry.label, this.s.lang);
      this.s.loaded = loaded;
      this.s.router = createRouter(loaded.bundle);
      this.s.search = createSearchIndex(loaded.bundle);
      const ready = await this.explorer.loadStation(loaded, this.s.router);
      if (!current()) return;
      this.identityView.hideCard();
      if (!ready) return;
      this.toast(this.explorer.sceneError ? `${this.t.sceneFallback}: ${this.explorer.sceneError}` : "", this.explorer.sceneError ? 6000 : 0);
      // Beneath the search fields (the toast fades): the 3D scene failed and the line map is shown instead.
      if (this.explorer.sceneError) this.mascotSay({ kind: "scene_fallback" }, this.ui.panel);
    } catch (err) {
      if (!current()) return;
      this.s.loaded = null;
      this.s.router = null;
      this.s.search = null;
      this.identityView.hideCard();
      this.showLoadError(err);
      return;
    }
    this.stationReady = true;
    this.ui.railBtn.hidden = railDemoLink(entry.key) === null;
    const pois = this.s.loaded.bundle.pois;
    const from = pois.find((p) => p.id === fromId);
    const to = pois.find((p) => p.id === toId);
    if (from) this.s.origin = { kind: "poi", poi: from };
    if (to) this.s.destination = to;
    this.refreshAll();
    this.updateUrl();
  }

  /** Short playable JR Saikyo demo: a ride scene, not a surveyed station-to-platform path. */
  private startRailRide(): void {
    if (!this.stationReady || this.railRide) return;
    const link = railDemoLink(this.s.entry?.key ?? "");
    const destination = this.s.entries.find((e) => e.key === link?.to);
    if (!link || !destination) return;
    try {
      this.railRide = new RailRideDemo(
        this.root, link, this.s.lang,
        async () => {
          await this.openStation(destination, undefined, undefined, true);
          if (!this.stationReady || this.s.entry?.key !== destination.key || !this.s.loaded) return false;
          // Arrive at a known playable station spawn, NOT at an invented JR platform coordinate.
          const node = this.s.loaded.bundle.spawnNodeIds?.[0];
          if (node) this.explorer.walkFromNode(this.s.loaded.bundle, node, spawnHeading(this.s.loaded.bundle, { kind: "node", nodeId: node }, []));
          return true;
        },
        () => { this.railRide = null; },
      );
    } catch (error) {
      this.railRide?.dispose();
      this.railRide = null;
      this.toast(String(error), 5000);
    }
  }

  private showLoadError(err: unknown): void {
    this.ui.sheet.innerHTML = "";
    const box = el("div", "card error");
    box.append(el("h2", undefined, this.t.validationFailed));
    if (err instanceof StationLoadError) {
      const list = el("ul", "issues");
      for (const i of err.issues.filter((x) => x.level === "error").slice(0, 30)) list.append(el("li", undefined, `${i.code} · ${i.ref ?? ""} · ${i.message}`));
      box.append(list);
    } else box.append(el("pre", undefined, String(err)));
    this.ui.sheet.append(box);
    this.ui.sheet.classList.add("open");
    this.toast("");
    // A sibling of the error card; the card announces nothing, so the mascot line is the announcement.
    this.mascotSay({ kind: "load_error" }, this.ui.sheet);
  }

  /** Once both ends are chosen, fold options away (phone layout uses this to free the 3D view). */
  private updatePanelCollapse(): void {
    const ready = Boolean(this.s.origin && this.s.destination);
    this.ui.panel.classList.toggle("collapsed", ready && !this.panelExpanded);
    this.ui.more.classList.toggle("hidden", !ready);
    this.ui.more.textContent = this.panelExpanded ? "︿" : "⋯";
    this.ui.more.setAttribute("aria-expanded", String(this.panelExpanded));
  }

  private refreshAll(): void {
    this.updatePanelCollapse();
    this.renderIdentity();
    this.renderCredit();
    const b = this.s.loaded?.bundle;
    this.renderBanner(b);
    this.renderSpawnChips(b);
    this.renderProfile();
    // The lists show the previous language / selection: drop them.
    this.closeResults("from");
    this.closeResults("to");
    this.ui.fromInput.value = this.originLabel();
    this.ui.toInput.value = this.destinationLabel();
    this.renderEndpointNote(this.ui.fromNote, this.s.origin?.kind === "poi" ? this.s.origin.poi : null);
    this.renderEndpointNote(this.ui.toNote, this.s.destination);
    if (b) this.explorer.showPois(b, (p) => poiLabel(b, p, this.s.lang, this.t), [this.s.destination?.id, this.s.origin?.kind === "poi" ? this.s.origin.poi.id : undefined].filter(Boolean) as string[]);
    this.computeRoute();
    this.syncPanelMascot();
  }

  private renderBanner(b: StationBundle | undefined): void {
    this.ui.banner.innerHTML = "";
    if (!b) return;
    const synthetic = b.station.synthetic;
    this.ui.banner.className = `banner ${synthetic ? "warn" : "info"}`;
    this.ui.banner.textContent = synthetic ? this.t.synthetic : this.t.realCandidate;
    const fresh = b.coverage.freshness;
    if (fresh) this.ui.banner.append(el("span", "muted", ` · ${this.t.freshness} ${fresh}`));
    this.ui.banner.append(el("span", "muted", ` · ${this.t.noIndoorPositioning}`));
    // Only a station whose scene draws its own signs from the graph is told that they mark no surveyed position.
    if (this.sceneSignsFromGraph()) this.ui.banner.append(el("span", "muted", ` · ${this.t.generatedSigns}`));
  }

  /** The loaded scene declares that its wayfinding signs are GTEki's own, generated from the graph (#203 B14). */
  private sceneSignsFromGraph(): boolean {
    const scene = this.s.loaded?.scene as { generatedSignageFromGraph?: unknown } | null | undefined;
    return !this.explorer.sceneError && scene?.generatedSignageFromGraph === true;
  }

  private renderSpawnChips(b: StationBundle | undefined): void {
    this.ui.spawnChips.innerHTML = "";
    if (!b || !this.stationReady) return;
    const ids = b.spawnNodeIds ?? [];
    for (const id of ids.slice(0, 6)) {
      const label = this.nodeLabel(b, id);
      const chip = el("button", "chip", `${this.t.startHere}: ${label}`);
      chip.addEventListener("click", () => this.setOrigin({ kind: "node", nodeId: id, label }));
      this.ui.spawnChips.append(chip);
    }
    if (this.explorer.currentMode !== "overview") {
      const chip = el("button", "chip accent", this.t.avatarHere);
      chip.addEventListener("click", () => this.originFromAvatar());
      this.ui.spawnChips.append(chip);
    }
  }

  private renderProfile(): void {
    this.ui.profile.innerHTML = "";
    const add = (key: keyof State["profile"], label: string) => {
      const chip = el("button", `chip toggle${this.s.profile[key] ? " on" : ""}`, label);
      chip.setAttribute("aria-pressed", String(this.s.profile[key]));
      chip.addEventListener("click", () => { this.s.profile[key] = !this.s.profile[key]; this.renderProfile(); this.computeRoute(); });
      this.ui.profile.append(chip);
    };
    add("stepFree", this.t.stepFree);
    add("unpaidOnly", this.t.unpaidOnly);
    add("strictHours", this.t.strictHours);
  }

  // ---- Search ----------------------------------------------------------------------

  private poiName(p: Poi): string {
    return pick(p.names, this.s.lang) || p.id;
  }

  private nodeLabel(b: StationBundle, nodeId: string): string {
    return nodeLabel(b, nodeId, this.s.lang, this.t);
  }

  /** A picked endpoint that is search-only shows its note (e.g. "as of 2020; current status unknown") under the field. */
  private renderEndpointNote(box: HTMLParagraphElement, poi: Poi | null): void {
    const note = poi && poi.connectorNodeIds.length === 0 ? poiNoteText(poi, this.s.lang) : null;
    // An approximate point says so beside the note: its floor is unverified and the ± radius is not for directions (#463).
    const floor = poi?.approximatePosition ? this.floorLabel(poi) : null;
    const approximate = poi ? this.approximateText(poi) : null;
    const text = [floor, note, approximate].filter(Boolean).join(" · ");
    box.textContent = text;
    box.hidden = text === "";
  }

  /** The floor label for display; an approximate POI's floor is a label match, not a surveyed floor (#463). */
  private floorLabel(poi: Poi): string | null {
    if (!poi.floorId) return null;
    const label = floorDisplayName(this.s.loaded?.bundle.floors.find((f) => f.id === poi.floorId), this.s.lang);
    return poi.approximatePosition ? this.t.floorUnverified(label) : label;
  }

  /** The search-display line for an approximate position, its ± radius rounded up to a whole metre (#463). */
  private approximateText(poi: Poi): string | null {
    return poi.approximatePosition ? this.t.approximatePosition(Math.ceil(poi.approximatePosition.uncertaintyM)) : null;
  }

  private originLabel(): string {
    const o = this.s.origin;
    if (!o) return "";
    return o.kind === "poi" ? this.poiName(o.poi) : o.label;
  }

  /** The destination field and route-card title: the store, or "store — brand（floor）" after a tenant pick. */
  private destinationLabel(): string {
    const d = this.s.destination;
    if (!d) return "";
    const tenant = this.s.destinationTenant;
    return tenant ? tenantDestinationTitle(this.poiName(d), tenantLabel(tenant, this.s.lang), this.s.lang, this.t) : this.poiName(d);
  }

  /** A tenant of the loaded bundle by id (the result list may outlive a station switch). */
  private findTenant(id: string): Tenant | null {
    return this.s.loaded?.bundle.tenants?.find((t) => t.id === id) ?? null;
  }

  private renderResults(which: "from" | "to"): void {
    const input = which === "from" ? this.ui.fromInput : this.ui.toInput;
    const box = which === "from" ? this.ui.fromResults : this.ui.toResults;
    this.closeResults(which);
    if (!this.s.search || !this.s.loaded) return;
    const q = input.value.trim();
    const hits: SearchHit[] = q ? this.s.search.search(q, { limit: 8, lang: this.s.lang }) : this.s.loaded.bundle.pois.slice(0, 8).map((poi) => ({ poi, score: 0, matched: "", routable: poi.connectorNodeIds.length > 0 }));
    this.ui.live.announce(searchLiveMessage(this.t, hits.length));
    if (hits.length === 0) {
      const none = el("div", "result empty", this.t.noResults);
      none.setAttribute("role", "option");
      none.setAttribute("aria-disabled", "true");
      box.append(none);
      this.mascotSay({ kind: "search_empty" }, box);
      this.setCombo(which, { open: true, count: 0, active: -1 });
      return;
    }
    hits.forEach((h, i) => {
      const b = el("button", `result cat-${h.poi.category}${h.routable ? "" : " disabled"}`);
      const dot = el("span", "dot");
      dot.setAttribute("aria-hidden", "true");
      const name = el("span", "result-name", this.poiName(h.poi));
      const meta = el("span", "result-meta");
      const floor = this.floorLabel(h.poi);
      const searchOnly = isUnlocatedShop(h.poi) ? this.t.shopSearchOnly : this.t.searchOnly;
      // A brand from the store's own directory (#419) replaces the store floor: the printed floor is the useful one.
      const tags = h.tenant
        ? tenantResultTags(h, this.s.lang, this.t)
        : [floor, h.matched && h.matched !== this.poiName(h.poi) ? `“${h.matched}”` : null].filter(Boolean) as string[];
      if (!h.routable) tags.push(searchOnly);
      meta.textContent = tags.join(" · ");
      // The directory is unverified: say since when it was checked, as a second line.
      const checkedDate = h.tenant ? tenantCheckedDate(this.s.loaded?.bundle.tenants, h.tenant.id) : null;
      const asOf = h.tenant && checkedDate ? this.t.tenantAsOf(checkedDate) : null;
      b.append(dot, name, meta);
      if (asOf) b.append(el("span", "result-asof", asOf));
      // A search-only POI's note (e.g. a 2020 status word in the copied name) is shown beside it, not only in routes.
      const note = h.routable ? null : poiNoteText(h.poi, this.s.lang);
      if (note) b.append(el("span", "result-note", note));
      // An approximate point is search display only: show the ± radius and that it is not used for directions (#463).
      const approximate = this.approximateText(h.poi);
      if (approximate) b.append(el("span", "result-approx", approximate));
      // The accessible name carries the visible tags, the as-of line, the note and the approximate warning.
      applyAria(b, optionAria(COMBO_CLOSED, box.id, i, [name.textContent, ...tags, ...(asOf ? [asOf] : []), ...(note ? [note] : []), ...(approximate ? [approximate] : [])].join(", ")));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        this.closeResults(which);
        input.blur();
        // A brand is not a destination of its own: the store carries the route (#419).
        if (which === "from") this.setOrigin({ kind: "poi", poi: h.poi });
        else this.setDestination(h.poi, h.tenant ? this.findTenant(h.tenant.id) : null);
      });
      box.append(b);
    });
    this.setCombo(which, { open: true, count: hits.length, active: -1 });
  }

  /** Close one results list (focus is left alone). */
  private closeResults(which: "from" | "to"): void {
    this.setCombo(which, COMBO_CLOSED);
  }

  /**
   * The one place the popup and its ARIA state are kept in step: store the state, drop the options of a
   * closed list (`.results:empty` hides the box), set the listbox role and the input's
   * aria-expanded / aria-activedescendant, and mark the active option. Visible popup <=> aria-expanded.
   */
  private setCombo(which: "from" | "to", st: ComboState): void {
    const state = normalizeCombo(st);
    this.combo[which] = state;
    const input = which === "from" ? this.ui.fromInput : this.ui.toInput;
    const box = which === "from" ? this.ui.fromResults : this.ui.toResults;
    if (!state.open) {
      // Every close (Escape included) frees the mascot first, so a search_empty line never outlives its list.
      this.releaseMascot(box);
      box.replaceChildren();
    }
    const role = listboxRole(state);
    if (role) box.setAttribute("role", role);
    else box.removeAttribute("role");
    applyAria(input, inputAria(state, box.id));
    box.querySelectorAll('[role="option"]').forEach((o, i) => o.setAttribute("aria-selected", String(i === state.active)));
    this.syncPanelMascot();
  }

  /**
   * The mascot's two panel states. start_hint (dog, under the fields) shows while the station is ready with no
   * destination, no route and no results list open; it never displaces another line. scene_fallback is only
   * re-said here so it follows the language.
   */
  private syncPanelMascot(): void {
    const m = this.ui.mascot;
    const key = m.info().lineKey;
    if (key === "scene_fallback") { this.mascotSay({ kind: "scene_fallback" }, this.ui.panel); return; }
    const want = this.stationReady && !this.s.destination && !this.s.route && !this.combo.from.open && !this.combo.to.open;
    if (want && (key === null || key === "start_hint")) {
      this.mascotSay({ kind: "start_hint" }, this.ui.panel, this.ui.spawnChips);
    } else if (!want && key === "start_hint") {
      m.clear();
      m.setResident(false);
    }
  }

  /** Endpoints must come from the station that is loaded now (a stale result list may still be clickable). */
  private ownsPoi(p: Poi): boolean {
    return this.stationReady && (this.s.loaded?.bundle.pois.includes(p) ?? false);
  }

  private setOrigin(o: Origin): void {
    if (!this.stationReady) return;
    if (o.kind === "poi" && !this.ownsPoi(o.poi)) return;
    if (o.kind === "node" && !this.s.loaded?.bundle.nodes.some((n) => n.id === o.nodeId)) return;
    this.s.origin = o;
    this.refreshAll();
    this.updateUrl();
  }

  /** `tenant` is set only when the destination was picked through a store's brand directory (#419). */
  private setDestination(p: Poi, tenant: Tenant | null = null): void {
    if (!this.ownsPoi(p)) return;
    this.s.destination = p;
    this.s.destinationTenant = tenant;
    this.refreshAll();
    this.updateUrl();
  }

  private swap(): void {
    const o = this.s.origin;
    const d = this.s.destination;
    this.s.destination = o?.kind === "poi" ? o.poi : null;
    // The previous destination's brand does not describe the new one.
    this.s.destinationTenant = null;
    this.s.origin = d ? { kind: "poi", poi: d } : null;
    this.refreshAll();
    this.updateUrl();
  }

  /** The origin as a POI a reversed route can end at: a POI origin, or a graph-node origin that is a POI's connector. */
  private originPoi(): Poi | null {
    const o = this.s.origin;
    if (!o) return null;
    return o.kind === "poi" ? o.poi : (this.s.loaded?.bundle.pois.find((p) => p.connectorNodeIds.includes(o.nodeId)) ?? null);
  }

  /** After arrival: back to the overview with origin and destination swapped and the route recomputed. */
  private reverseRoute(): void {
    const from = this.originPoi();
    const to = this.s.destination;
    if (!from || !to) return;
    this.leaveGuide();
    this.s.origin = { kind: "poi", poi: to };
    this.s.destination = from;
    this.s.destinationTenant = null;
    this.refreshAll();
    this.updateUrl();
  }

  /** After arrival: back to the overview with the destination search focused (its text selected, so typing replaces it). */
  private searchAgain(): void {
    this.leaveGuide();
    this.ui.toInput.focus();
    this.ui.toInput.select();
  }

  private leaveGuide(): void {
    this.explorer.stopGuide();
    this.explorer.frameAll();
  }

  /** Nearest graph node to the avatar (on the avatar's level band). Virtual, never GPS. */
  private originFromAvatar(): void {
    // The avatar belongs to the scene: until the new station's scene is up it still stands in the old one.
    const b = this.stationReady ? this.s.loaded?.bundle : undefined;
    if (!b) return;
    const a = this.explorer.avatarEnu;
    let best: { id: string; d: number } | null = null;
    for (const n of b.nodes) {
      const z = n.position.z ?? n.renderZ ?? b.floors.find((f) => f.id === n.floorId)?.renderElevationM ?? 0;
      if (Math.abs(z - a.z) > 2.5) continue;
      const d = Math.hypot(n.position.x - a.x, n.position.y - a.y);
      if (d < 25 && (!best || d < best.d)) best = { id: n.id, d };
    }
    if (best) this.setOrigin({ kind: "node", nodeId: best.id, label: `${this.t.avatarHere} → ${this.nodeLabel(b, best.id)}` });
  }

  private updateUrl(): void {
    const p = new URLSearchParams(location.search);
    if (this.s.entry) p.set("station", this.s.entry.key);
    if (this.s.origin?.kind === "poi") p.set("from", this.s.origin.poi.id); else p.delete("from");
    if (this.s.destination) p.set("to", this.s.destination.id); else p.delete("to");
    history.replaceState(null, "", `${location.pathname}?${p.toString()}`);
  }

  // ---- Routing ---------------------------------------------------------------------

  private profile(): RouteProfile {
    // Station-local time: both supported stations are in Asia/Tokyo.
    const tokyo = stationClock(new Date(), STATION_TIME_ZONE);
    return {
      fare: this.s.profile.unpaidOnly ? "unpaid_only" : "ticketed",
      stepFree: this.s.profile.stepFree,
      hours: this.s.profile.strictHours ? "require_known" : "warn_unknown",
      at: { weekday: tokyo.weekday, minutes: tokyo.minutes },
      today: tokyo.date,
      timeZone: STATION_TIME_ZONE,
    };
  }

  private computeRoute(): void {
    const { router, loaded, origin, destination } = this.s;
    this.s.route = null;
    this.s.noPath = null;
    this.s.polyline = [];
    this.s.instructions = [];
    this.explorer.clearRoute();
    if (!router || !loaded || !origin || !destination) { this.renderSheet(); return; }
    // One multi-source query: the router ranks entrances by its own cost and keeps "already there";
    // routeBetween also applies the fare policy to the POIs themselves.
    const profile = this.profile();
    const best: RouteResult | RouteFailure = routeBetween(router, origin, destination, profile);
    this.s.route = best;
    this.ui.live.announce(routeLiveMessage(this.t, best, !best.ok && best.reason === "unknown_goal" && isUnlocatedShop(destination) ? this.t.shopNoRoute : undefined));
    // Only after a no_path: re-ask with the user's own options relaxed to say which one refused.
    if (!best.ok && best.reason === "no_path") this.s.noPath = explainNoPathBetween(router, loaded.bundle, origin, destination, profile);
    if (best.ok) {
      this.s.polyline = routePolyline(loaded.bundle, best);
      this.s.instructions = describeRoute(loaded.bundle, best, this.s.lang, destination, origin.kind === "poi" ? origin.poi : undefined);
      this.s.activeInstruction = 0;
      this.explorer.showRoute(this.s.polyline);
      if (this.explorer.currentMode === "overview") this.explorer.focusPoints(this.s.polyline);
    }
    this.renderSheet();
  }

  private renderSheet(): void {
    const sheet = this.ui.sheet;
    this.releaseMascot(sheet);
    sheet.innerHTML = "";
    const r = this.s.route;
    const b = this.s.loaded?.bundle;
    if (!r || !b) { sheet.classList.remove("open"); return; }
    sheet.classList.add("open");
    const t = this.t;
    if (!r.ok) {
      const card = el("div", "card no-route");
      const view = r.reason === "no_path" && this.s.noPath ? noPathView(t, this.s.noPath) : null;
      card.append(el("h2", undefined, t.noRoute), el("p", undefined, view?.text ?? noRouteText(t, r, this.s.destination)));
      // The picked brand came from an unverified directory (#419): the failed card says when it was checked.
      const asOf = tenantAsOfNote(this.s.destinationTenant, t);
      if (asOf) card.append(el("p", "muted tenant-asof", asOf));
      const origin = this.s.origin?.kind === "poi" ? this.s.origin.poi : null;
      const endpointNote = r.reason === "unknown_goal" ? poiNoteText(this.s.destination, this.s.lang)
        : r.reason === "unknown_start" ? poiNoteText(origin, this.s.lang) : null;
      if (endpointNote) card.append(el("p", "muted", endpointNote));
      if (view && view.relax.length > 0) {
        const relax = el("div", "actions");
        const relaxOff = (keys: typeof view.relax) => { for (const k of keys) this.s.profile[k] = false; this.renderProfile(); this.computeRoute(); };
        if (view.all) {
          const b = el("button", "chip accent", t.noPath.relaxAll);
          b.addEventListener("click", () => relaxOff(view.relax));
          relax.append(b);
        } else {
          for (const k of view.relax) {
            const b = el("button", "chip accent", t.noPath.relax(t[k]));
            b.addEventListener("click", () => relaxOff([k]));
            relax.append(b);
          }
        }
        card.append(relax);
      }
      sheet.append(card);
      // A sibling of the frozen card, so the card's own text and structure stay untouched.
      this.mascotSay({ kind: "no_path", reason: r.reason }, sheet);
      return;
    }
    const card = el("div", "card route");
    const destTenant = this.s.destinationTenant;
    // A tenant destination names the brand on the store's card; the route still ends at the store's entrances.
    if (destTenant) card.append(el("h2", "route-title", this.destinationLabel()));
    const head = el("div", "route-head");
    head.append(
      el("strong", "big", t.minutes(Math.max(1, Math.round(r.estimatedSeconds / 60)))),
      el("span", undefined, t.meters(Math.round(r.totalLengthM))),
      el("span", undefined, t.floors(r.floorChanges)),
    );
    card.append(head);
    // The time estimate's assumed pace, taken from the router's own constants (never a copy), and the guide is its own pace.
    card.append(el("p", "muted pace-note", t.paceNote(ROUTE_PACE.walkMps, ROUTE_PACE.stairsMps)));
    // No station records an on-site check, so a real station's route is always said to be desk-checked only (synthetic data says so itself).
    if (!r.synthetic) card.append(el("p", "desk-check", t.deskChecked));
    // Store floors above ground are not modelled: the guide stops at the store, never at the brand's floor.
    // The brand came from an unverified directory (#419), so the card repeats when it was checked.
    if (destTenant) {
      const asOf = tenantAsOfNote(destTenant, t);
      card.append(el("p", "muted tenant-floors", asOf ? `${t.tenantFloorsNotGuided} · ${asOf}` : t.tenantFloorsNotGuided));
    }

    const badges = el("div", "badges");
    const badge = (text: string, cls: string, title?: string) => { const x = el("span", `badge ${cls}`, text); if (title) x.title = title; badges.append(x); };
    if (r.synthetic) badge(t.syntheticShort, "warn", t.synthetic);
    for (const u of r.unknowns) badge(`${unknownLabel(t, u.kind)} ×${u.edgeIds.length}`, "unknown");
    // Waiting for an opening window is part of the time, and is said so.
    if (r.waitSeconds > 0) badge(t.waiting(Math.max(1, Math.round(r.waitSeconds / 60))), "info");
    if (r.timeRestricted.length) badge(`${t.timeWindow}: ${r.timeRestricted.map((w) => `${w.open}–${w.close}`).join(", ")}`, "unknown");
    if (r.crossesFareBoundary === true) badge(t.paidCrossing, "info");
    if (r.stale === true) badge(t.stale, "warn");
    // UNKNOWN freshness is shown whatever its cause: undated sources, or a year/month date straddling the cutoff.
    else if (r.stale === null) badge(t.freshnessUnknown, "unknown");
    if (r.steps.some((s) => s.mode === "stairs")) badge(t.routeStairs, "info");
    if (this.s.polyline.some((p) => !p.zKnown)) badge(t.symbolicHeight, "muted");
    if (r.operatorIds.length > 1) badge(`${t.operators}: ${r.operatorIds.join(" → ")}`, "info");
    card.append(badges);
    // Why the freshness is stale or unknown, as text: a tooltip alone is invisible on touch (#203 B5).
    const reason = freshnessReason(t, r);
    if (reason) card.append(el("p", `freshness-reason${r.stale === true ? " warn" : ""}`, reason));
    if (r.unknowns.length > 0) this.mascotSay({ kind: "route_unknowns" }, card);

    const actions = el("div", "actions");
    const guide = el("button", "primary", t.guide);
    guide.addEventListener("click", () => this.startGuide());
    const walk = el("button", undefined, t.walk);
    walk.addEventListener("click", () => {
      const first = this.s.polyline[0];
      if (first) this.explorer.walkFrom(first, spawnHeading(this.s.loaded?.bundle ?? null, this.s.origin, this.s.polyline));
    });
    const overview = el("button", "ghost", t.overview);
    overview.addEventListener("click", () => this.explorer.focusPoints(this.s.polyline));
    actions.append(guide, walk, overview);
    card.append(actions);

    const list = el("ol", "instructions");
    this.s.instructions.forEach((ins, i) => {
      const li = el("li", `ins ins-${ins.kind}${i === this.s.activeInstruction ? " active" : ""}`);
      li.append(el("span", "ins-icon"), el("span", "ins-text", ins.text));
      li.addEventListener("click", () => {
        // Frame the whole described segment, from the junction where it starts.
        const pts = instructionPoints(this.s.polyline, ins);
        if (pts.length) this.explorer.focusPoints(pts);
      });
      list.append(li);
    });
    card.append(list);

    const prov = el("details", "provenance");
    prov.append(el("summary", undefined, `${t.sources} · ${t.oldestSource} ${r.oldestSourceDate ?? "?"}${r.evidenceCheckedDate ? `${t.dateJoiner}${t.deskCheckedOn} ${r.evidenceCheckedDate}` : ""}`));
    const srcList = el("ul");
    for (const id of r.sourceIds) {
      const s = b.sources.find((x) => x.id === id);
      if (!s) continue;
      const li = this.creditItem(s);
      if (s.datasetDate) li.append(el("span", "muted", ` · ${s.datasetDate}`));
      srcList.append(li);
    }
    prov.append(srcList);
    card.append(prov);
    sheet.append(card);
  }

  // ---- Modes / HUD -----------------------------------------------------------------

  private onMode(mode: "overview" | "walk" | "guide"): void {
    this.root.dataset.mode = mode;
    this.renderIdentity(mode);
    this.renderSpawnChips(this.s.loaded?.bundle);
    this.renderHud();
  }

  /** Inside the panel observed by setPanel: its ResizeObserver already accounts for this header (#114). */
  private renderIdentity(mode = this.explorer.currentMode): void {
    this.identityView.renderOverview(this.stationReady ? this.s.loaded?.bundle : undefined, this.s.entry?.label ?? "", this.s.lang, mode);
    if (!this.identityView.card.hidden && this.s.entry) {
      this.identityView.showCard(this.s.loaded?.bundle.station.identity ?? this.s.entry.identity, this.s.entry.label, this.s.lang);
    }
  }

  private renderHud(): void {
    const hud = this.ui.hud;
    // The ride button is its own HUD row (#375), above the mode row; `hidden` alone decides whether it shows,
    // since openStation sets it after the HUD may already have rendered. Clearing the HUD detaches it, so a
    // keyboard user who had focused it gets the focus back.
    const rideFocused = document.activeElement === this.ui.railBtn;
    const placeRide = (): void => {
      hud.append(this.ui.railBtn);
      if (rideFocused && !this.ui.railBtn.hidden) this.ui.railBtn.focus({ preventScroll: true });
    };
    this.releaseMascot(hud);
    hud.innerHTML = "";
    const mode = this.explorer.currentMode;
    this.announceInstruction();
    if (mode === "overview") {
      placeRide();
      this.trackInstruction();
      return;
    }
    const t = this.t;
    const ins = this.s.instructions[this.s.activeInstruction];
    if (mode === "guide" && ins) {
      this.ui.mascot.clear();
      hud.append(this.guideBox(ins.text));
    }
    placeRide();
    const row = el("div", "hud-row");
    if (mode === "guide") {
      // Built from the explorer's state; instruction changes then go through updateGuideHud, so the controls stay put under the pointer.
      const pause = el("button", "guide-pause", this.explorer.guidePaused ? t.resume : t.pause);
      pause.addEventListener("click", () => {
        const paused = !this.explorer.guidePaused;
        this.explorer.setGuidePaused(paused);
        pause.textContent = paused ? t.resume : t.pause;
      });
      const speed = el("button", "ghost guide-speed");
      const showSpeed = (): void => {
        const tier = this.explorer.guideTier;
        const name = t.guideTier[tier];
        const readout = paceReadout(this.guidePace.totalM, tier, this.guidePace.spans);
        speed.textContent = t.guideSpeedLabel(name, readout);
        speed.setAttribute("aria-label", t.guideSpeedAria(name, readout));
        speed.title = t.guideSpeedAria(name, readout);
      };
      showSpeed();
      speed.addEventListener("click", () => {
        const next = nextGuideTier(this.explorer.guideTier);
        this.explorer.setGuideTier(next);
        writeGuideTier(next);
        showSpeed();
      });
      const stop = el("button", "ghost", t.exitGuide);
      stop.addEventListener("click", () => this.explorer.stopGuide());
      const prev = el("button", "ghost guide-step guide-prev", "‹");
      const next = el("button", "ghost guide-step guide-next", "›");
      for (const [b, label, title, dir] of [[prev, t.guidePrev, t.guidePrevTitle, -1], [next, t.guideNext, t.guideNextTitle, 1]] as const) {
        b.setAttribute("aria-label", label);
        b.setAttribute("aria-keyshortcuts", dir < 0 ? "[ PageUp" : "] PageDown");
        b.title = title;
        b.addEventListener("click", () => this.jumpGuide(dir));
      }
      // One no-wrap group, so the phone row never splits the playback controls (the other buttons may wrap below it).
      const group = el("div", "hud-guide");
      group.append(prev, pause, next, speed, stop);
      row.append(group);
    }
    const fp = el("button", "ghost", t.firstPerson);
    fp.classList.toggle("on", this.explorer.firstPersonOn);
    fp.addEventListener("click", () => fp.classList.toggle("on", this.explorer.toggleFirstPerson()));
    const ov = el("button", "ghost", t.overview);
    ov.addEventListener("click", () => this.explorer.frameAll());
    const net = el("button", "ghost", t.graphOverlay);
    let netOn = this.explorer.graphOverlayOn;
    net.classList.toggle("on", netOn);
    net.addEventListener("click", () => { netOn = !netOn; this.explorer.setGraphOverlay(netOn); net.classList.toggle("on", netOn); });
    const snd = el("button", "ghost", this.explorer.audioMuted ? t.soundOff : t.soundOn);
    snd.setAttribute("aria-pressed", String(!this.explorer.audioMuted));
    snd.addEventListener("click", () => {
      const muted = !this.explorer.audioMuted;
      this.explorer.setMuted(muted);
      snd.textContent = muted ? t.soundOff : t.soundOn;
      snd.setAttribute("aria-pressed", String(!muted));
    });
    row.append(fp, net, ov, snd);
    hud.append(row);
    this.syncGuideStep();
    this.trackInstruction();
  }

  /** Next is disabled on the last instruction (arrival); the arrival follow-up row shows only once the guide has arrived. */
  private syncGuideStep(): void {
    const hud = this.ui.hud;
    const guiding = this.explorer.currentMode === "guide";
    const next = hud.querySelector<HTMLButtonElement>("button.guide-next");
    if (next) next.disabled = this.s.activeInstruction >= this.s.instructions.length - 1;
    hud.querySelector(".hud-arrival")?.remove();
    const row = hud.querySelector(".hud-row");
    if (!guiding || !this.arrived || !row) return;
    const t = this.t;
    const after = el("div", "hud-row hud-arrival");
    const again = el("button", "ghost search-again", t.searchAgain);
    again.addEventListener("click", () => this.searchAgain());
    // Not offered where the destination was not reached (the arrival toast says so): there is nothing to reverse back from.
    if (!this.endsOnConnector()) {
      const reverse = el("button", "reverse-route", t.reverseRoute);
      reverse.disabled = !this.originPoi() || !this.s.destination;
      reverse.addEventListener("click", () => this.reverseRoute());
      after.append(reverse);
    }
    after.append(again);
    row.before(after);
  }

  private instructionEl: Element | null = null;
  private instructionSize: ResizeObserver | null = null;

  /** Keep `--hud-clear` (the guide instruction's bottom edge + 8 px) current for the toast, which sits below the instruction while one shows; unset otherwise. */
  private trackInstruction(): void {
    const cur = this.ui.hud.querySelector(".hud-line");
    if (cur !== this.instructionEl) {
      this.instructionSize?.disconnect();
      this.instructionEl = cur;
      if (cur && typeof ResizeObserver !== "undefined") (this.instructionSize ??= new ResizeObserver(() => this.trackInstruction())).observe(cur);
    }
    const r = cur?.getBoundingClientRect();
    if (r) this.root.style.setProperty("--hud-clear", `${Math.round(r.bottom) + 8}px`);
    else this.root.style.removeProperty("--hud-clear");
  }

  /** Refresh the guide HUD's instruction and pause label in place (the buttons must not be replaced mid-click); full rebuild if it isn't a guide HUD. */
  private updateGuideHud(): void {
    const hud = this.ui.hud;
    const pause = hud.querySelector<HTMLButtonElement>("button.guide-pause");
    if (this.explorer.currentMode !== "guide" || !pause) { this.renderHud(); return; }
    const ins = this.s.instructions[this.s.activeInstruction];
    const cur = hud.querySelector(".hud-instruction");
    if (!ins) hud.querySelector(".hud-line")?.remove();
    else if (cur) cur.textContent = ins.text;
    else hud.prepend(this.guideBox(ins.text));
    pause.textContent = this.explorer.guidePaused ? this.t.resume : this.t.pause;
    this.syncGuideStep();
    this.announceInstruction();
    this.trackInstruction();
  }

  private spokenInstruction: Instruction | null = null;

  /** Announce the guide's active instruction once per change (not per progress tick); forgotten outside the guide. */
  private announceInstruction(): void {
    const ins = this.explorer.currentMode === "guide" ? this.s.instructions[this.s.activeInstruction] ?? null : null;
    if (ins === this.spokenInstruction) return;
    const changed = ins !== null && this.spokenInstruction !== null;
    this.spokenInstruction = ins;
    if (!ins) return;
    this.ui.live.announce(ins.text);
    // A nudge only: the instruction text itself is the router's job (and was just announced).
    if (changed && this.ui.hud.contains(this.ui.mascot.root)) this.ui.mascot.say({ kind: "turn" });
  }

  /** The guide box: the mascot beside the instruction text, never over it. */
  private guideBox(text: string): HTMLElement {
    const box = el("div", "hud-line");
    this.ui.mascot.setResident(true);
    box.append(this.ui.mascot.root, el("div", "hud-instruction", text));
    return box;
  }

  /** Move the one mascot into `host` and let it speak (it is shared; the last place to ask wins). */
  private mascotSay(ev: MascotEvent, host: Element, before: Node | null = null): void {
    this.ui.mascot.setResident(false);
    host.insertBefore(this.ui.mascot.root, before);
    this.ui.mascot.say(ev);
  }

  /** Hide the mascot if it currently lives in `host` (which is about to be emptied or closed). */
  private releaseMascot(host: Element): void {
    if (!host.contains(this.ui.mascot.root)) return;
    this.ui.mascot.clear();
    this.ui.mascot.setResident(false);
  }

  /** The running guide's length and pace spans: the speed button's effective pace is read from them on each tier change, not per frame. */
  private guidePace: { totalM: number; spans: readonly PaceSpan[] } = { totalM: 0, spans: [] };

  /** Guide along the route, stopping where each wait for an opening happens. */
  private startGuide(): void {
    const stops = guideStops(this.s.polyline, this.s.instructions);
    this.guideWaits = stops.map((x) => x.instruction);
    const spans = this.s.route?.ok ? guidePaceSpans(this.s.polyline, this.s.route.steps, this.s.instructions) : [];
    // The guide opens on the first move; "Start" carries no direction and would only flash.
    if (this.s.instructions[0]?.kind === "start" && this.s.instructions.length > 1) {
      this.s.activeInstruction = 1;
      this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === 1));
    }
    this.guideStarts = instructionStartsM(this.s.polyline, this.s.instructions);
    this.guideFirst = this.s.instructions[0]?.kind === "start" && this.s.instructions.length > 1 ? 1 : 0;
    this.guideS = 0;
    this.insClock.reset();
    this.jumpPin = null;
    this.arrived = false;
    this.guidePace = { totalM: polylineLengthM(this.s.polyline), spans };
    this.explorer.startGuide(this.s.polyline, 0, stops.map((x) => x.point), spans);
  }

  /** Per guide run: where each instruction starts (m), the first one the guide shows, and how far the guide has got. */
  private guideStarts: number[] = [];
  private guideFirst = 0;
  private guideS = 0;
  /** Guide time (not counting pauses or arrival) spent in the active instruction, for Previous's restart rule. */
  private readonly insClock = new StepClock();
  /** After a jump: the distance the guide landed at; the active instruction stays as chosen until the guide moves off it. */
  private jumpPin: number | null = null;
  private arrived = false;

  /**
   * Previous / Next: jump the guide to an instruction's start. Only the guide distance moves (explorer.seekGuide); the
   * avatar, camera and wait stops follow through the guide's normal per-frame path. Pause state is kept.
   */
  private jumpGuide(dir: 1 | -1): void {
    if (this.explorer.currentMode !== "guide") return;
    const j = jumpTarget(this.guideS, this.guideStarts, dir, this.insClock.elapsedS, this.s.activeInstruction, this.guideFirst);
    if (!j) return;
    this.s.activeInstruction = j.index;
    this.explorer.seekGuide(j.s, firstStopFor(this.guideWaits, j.index));
    this.guideS = j.s;
    this.insClock.reset();
    this.jumpPin = j.s;
    const last = this.s.instructions.length - 1;
    this.arrived = j.index === last && this.s.instructions[last]?.kind === "arrive";
    this.updateGuideHud();
    this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === j.index));
    if (this.arrived) {
      this.toast(this.arrivalText(), 2500);
      this.ui.mascot.say({ kind: this.endsOnConnector() ? "arrival_connector" : "arrival" });
    }
  }

  /** A route ending on a stair/escalator/ramp connector has not reached the destination: the last instruction says so. */
  private endsOnConnector(): boolean {
    return !!this.s.instructions[this.s.instructions.length - 1]?.connector;
  }

  private arrivalText(): string {
    return this.endsOnConnector() ? this.s.instructions[this.s.instructions.length - 1]!.text : this.t.arrived;
  }

  /** `[` / `]` or PageUp / PageDown step the guide; never while typing in a field or with a dialog open. */
  private bindGuideKeys(): void {
    // IME composition can start anywhere on the page, and Safari can land the confirming keydown on a
    // non-input target. Track the end of composition document-wide so no guide shortcut fires from it.
    document.addEventListener("compositionend", () => { this.compositionEndMs = performance.now(); }, true);
    window.addEventListener("keydown", (e) => {
      const action = guideKeyActionGuarded(e, this.compositionEndMs, performance.now());
      if (this.explorer.currentMode !== "guide" || !shouldHandleGuideKey(
        action,
        e.target as HTMLElement | null,
        this.ui.coverage.open,
        this.railRide !== null,
      )) return;
      e.preventDefault();
      this.jumpGuide(action === "next" ? 1 : -1);
    });
  }

  /** The guide reached a wait: it is paused there, and the wait stays the active instruction until resumed. */
  private onGuideStop(index: number): void {
    const wait = this.guideWaits[index];
    if (wait === undefined) return;
    this.s.activeInstruction = wait;
    this.insClock.reset();
    this.updateGuideHud();
    this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === wait));
    this.toast(this.s.instructions[wait]!.text, 4000);
  }

  private onGuideProgress(p: { s: number; stepIndex: number; done: boolean }): void {
    // Guide time stops while paused and at arrival (the guide stays in guide mode there; Previous must not read that as time spent).
    this.insClock.tick(performance.now(), !this.explorer.guidePaused && !this.arrived && !p.done);
    this.guideS = p.s;
    // Just after a jump the guide stands on the instruction's first point, which still reports the previous step: keep the chosen one.
    if (this.jumpPin !== null) {
      if (!p.done && Math.abs(p.s - this.jumpPin) < 0.05) return;
      this.jumpPin = null;
    }
    // Stopped at a wait (onGuideStop): it stays the active instruction until the guide is resumed.
    if (this.s.instructions[this.s.activeInstruction]?.kind === "wait" && this.explorer.guidePaused) return;
    const idx = this.s.instructions.findIndex((ins) => ins.stepIndexes.includes(p.stepIndex));
    const next = p.done ? this.s.instructions.length - 1 : idx;
    if (next >= 0 && next !== this.s.activeInstruction) {
      this.s.activeInstruction = next;
      this.insClock.reset();
      this.arrived = p.done;
      this.updateGuideHud();
      this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === next));
      if (p.done) {
        this.toast(this.arrivalText(), 2500);
        this.ui.mascot.say({ kind: this.endsOnConnector() ? "arrival_connector" : "arrival" });
      }
    }
  }

  /**
   * A credit line for one source, or for several sources sharing an attribution: titles (linked), the attribution once,
   * the distinct licences (linked) and the modification notice; facts-only and owner-override sources add their wording
   * and safe decision link (the Coverage dialog and the route card's 出典 both use this).
   */
  private creditItem(...sources: Source[]): HTMLLIElement {
    const link = (text: string, href: string | null): HTMLElement => {
      if (!href) return el("span", undefined, text);
      const a = el("a", undefined, text);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    };
    const li = el("li");
    sources.forEach((s, i) => {
      const c = sourceCredit(s, this.s.lang);
      if (i) li.append(el("span", "muted", "、"));
      li.append(link(c.title, c.href));
    });
    const attribution = sources[0]?.attribution.replace(/\s+/g, " ").trim() ?? "";
    if (attribution) li.append(el("span", "muted", ` — ${attribution}`));
    const licenses = groupLicenses(sources, this.s.lang);
    if (licenses.length) {
      li.append(el("span", "muted", " ("));
      licenses.forEach((l, i) => { if (i) li.append(el("span", "muted", ", ")); li.append(link(l.name, l.href)); });
      li.append(el("span", "muted", ")"));
    }
    if (sources.some((s) => s.modified)) li.append(el("span", "muted", ` · ${this.t.modified}`));
    for (const s of sources) {
      const facts = factsOnlyCredit(s, this.t);
      if (!facts) continue;
      li.append(el("span", "muted", ` · ${facts.text}`));
      if (facts.decision) li.append(el("span", "muted", " ("), link(facts.decision.label, facts.decision.href), el("span", "muted", ")"));
    }
    const override = overrideCredits(sources, this.t);
    if (override) {
      li.append(el("span", "muted", ` · ${override.text}`));
      if (override.decisions.length) {
        li.append(el("span", "muted", " ("));
        override.decisions.forEach((decision, i) => {
          if (i) li.append(el("span", "muted", ", "));
          li.append(link(decision.label, decision.href));
        });
        li.append(el("span", "muted", ")"));
      }
    }
    return li;
  }

  /** The persistent credit line (bottom strip, above the safe-area inset): drawn sources' attributions, each once; "Credits" opens the full list. */
  private renderCredit(): void {
    const b = this.s.loaded?.bundle;
    const text = b ? creditLineFor(b) : "";
    const box = this.ui.credit;
    box.innerHTML = "";
    box.hidden = !text;
    this.root.classList.toggle("has-credit", Boolean(text));
    // The strip is a second occluder for the overview's free area: keep the slice above it (#114).
    this.explorer.setCreditLine(text ? box : null);
    if (!text) return;
    box.setAttribute("aria-label", this.t.creditsLabel);
    const line = el("span", "credit-text", text);
    line.title = text;
    const btn = el("button", "ghost credit-btn", this.t.credits);
    // The text does not take pointer events (joystick area), so the button carries the full text as its tooltip too.
    btn.title = text;
    btn.setAttribute("aria-haspopup", "dialog");
    btn.addEventListener("click", () => this.openCoverage());
    box.append(line, btn);
  }

  // ---- Coverage --------------------------------------------------------------------

  private openCoverage(): void {
    const b = this.s.loaded?.bundle;
    const d = this.ui.coverage;
    d.innerHTML = "";
    const close = el("button", "ghost close", "×");
    close.setAttribute("aria-label", this.t.close);
    close.addEventListener("click", () => d.close());
    d.append(close, el("h2", undefined, this.t.coverage));
    if (b) {
      d.append(el("p", undefined, pick(b.coverage.summary, this.s.lang)));
      if (b.coverage.areas.length) {
        const ul = el("ul");
        for (const a of b.coverage.areas) ul.append(el("li", `cov-${a.status}`, `${this.t.coverageStatus[a.status] ?? a.status} · ${pick(a.label, this.s.lang)}${a.note ? ` — ${coverageText(a.note, this.s.lang)}` : ""}`));
        d.append(ul);
      }
      d.append(el("h3", undefined, this.t.gaps));
      const gaps = el("ul");
      for (const g of b.coverage.gaps)
        gaps.append(
          el(
            "li",
            undefined,
            `${coverageText(g.zone, this.s.lang)}: ${coverageText(g.missingFact, this.s.lang)} → ${coverageText(g.fieldWorkNeeded, this.s.lang)}`,
          ),
        );
      if (!b.coverage.gaps.length) gaps.append(el("li", "muted", "—"));
      d.append(gaps, el("h3", undefined, this.t.sources));
      const src = el("ul");
      // Every source exactly once, including those cited only by assets or coverage. Sources sharing an attribution form one item;
      // facts-only and blank-attribution sources stay single. Rights are plain language (#130), never the internal enum.
      for (const g of creditEntries(b.sources)) {
        const li = this.creditItem(...g.sources);
        // creditItem already renders the full owner-override line and decision link; keep other rights labels here.
        const rights = entryRightsLabels(g.sources, this.t).filter((label) => label !== this.t.rightsOwnerOverride);
        if (rights.length) li.append(el("span", "muted", ` · ${rights.join(" / ")}`));
        src.append(li);
      }
      d.append(src);
      // Asset modification notices (e.g. "Blender build from PLATEAU …") disclose how sources were processed.
      const derived = (b.assets ?? []).filter((a) => a.derivation);
      if (derived.length) {
        const ul = el("ul");
        for (const a of derived) {
          const li = el("li");
          const presentation = assetDerivationPresentation(a.derivation!, a.derivationSummary, this.s.lang, this.t.derivationDetails);
          li.append(document.createTextNode(`${a.id}: ${presentation.text}`));
          if (presentation.details !== null) {
            const details = el("details");
            details.append(el("summary", undefined, presentation.detailsLabel!), document.createTextNode(presentation.details));
            li.append(" ", details);
          }
          li.append(document.createTextNode(` — ${a.sourceIds.map((id) => b.sources.find((s) => s.id === id)?.title ?? id).join(", ")}`));
          ul.append(li);
        }
        d.append(el("h3", undefined, this.t.assetDerivations), ul);
      }
      // Declared data files that GTEki derived from sources (#121); authored config files are never credited.
      const dataRows = dataFileCredits(b.dataFiles, b.sources);
      if (dataRows.length) {
        const ul = el("ul");
        for (const f of dataRows) {
          const li = el("li");
          li.append(document.createTextNode(dataFileRowText(f)));
          ul.append(li);
        }
        d.append(el("h3", undefined, this.t.dataFileDerivations), ul);
      }
    }
    d.showModal();
  }

  /** Instruction indexes of the current guide run's stops, in the order given to the explorer. */
  private guideWaits: number[] = [];
  private toastTimer = 0;

  private toast(text: string, ms = 0): void {
    clearTimeout(this.toastTimer);
    this.ui.toast.textContent = text;
    this.ui.live.announce(text);
    this.ui.toast.classList.toggle("show", Boolean(text));
    if (ms) this.toastTimer = window.setTimeout(() => this.ui.toast.classList.remove("show"), ms);
  }

  /** Stable hooks for the QA lane's browser automation (read-mostly). */
  private exposeTestHooks(): void {
    (window as unknown as { __gteki: unknown }).__gteki = {
      version: "gteki.web/0.1",
      stations: () => this.s.entries.map((e) => ({ key: e.key, label: e.label, synthetic: e.synthetic })),
      openStation: (key: string) => { const e = this.s.entries.find((x) => x.key === key); return e ? this.openStation(e) : Promise.reject(new Error(`no station ${key}`)); },
      setOrigin: (poiId: string) => { const p = this.s.loaded?.bundle.pois.find((x) => x.id === poiId); if (p) this.setOrigin({ kind: "poi", poi: p }); return Boolean(p); },
      setDestination: (poiId: string) => { const p = this.s.loaded?.bundle.pois.find((x) => x.id === poiId); if (p) this.setDestination(p); return Boolean(p); },
      setProfile: (patch: Partial<State["profile"]>) => { Object.assign(this.s.profile, patch); this.renderProfile(); this.computeRoute(); },
      route: () => this.s.route,
      instructions: () => this.s.instructions.map((i) => i.text),
      mode: () => this.explorer.currentMode,
      startGuide: () => this.startGuide(),
      guideControls: () => ({ paused: this.explorer.guidePaused, tier: this.explorer.guideTier, speed: guideTierSpeed(this.explorer.guideTier), instruction: this.s.activeInstruction, distanceM: this.guideS, arrived: this.arrived }),
      hud: () => [...this.ui.hud.querySelectorAll("button")].map((b) => b.textContent),
      labels: () => this.explorer.labelInfo(),
      overviewFrame: () => this.explorer.overviewFrame(),
      stationIdentity: () => this.identityView.info(),
      quality: () => this.explorer.qualityLevel,
      mascot: () => this.ui.mascot.info(),
      avatar: () => this.explorer.avatarEnu,
      camera: () => this.explorer.cameraInfo(),
      setCamera: (patch: { yaw?: number; pitch?: number; distance?: number } | null) => this.explorer.setCamera(patch),
      holdAvatarFade: (value: number | null) => this.explorer.holdAvatarFade(value),
      sceneInfo: () => this.explorer.sceneInfo(),
      projectEnu: (points: { x: number; y: number; z: number }[]) => this.explorer.projectEnu(points),
      signFaces: () => this.explorer.signFaces(),
      phase: () => this.explorer.phase,
      audio: () => this.explorer.audioInfo(),
      walkFromNode: (nodeId: string) => (this.s.loaded ? this.explorer.walkFromNode(
        this.s.loaded.bundle,
        nodeId,
        spawnHeading(this.s.loaded.bundle, { kind: "node", nodeId }, []),
      ) : false),
      simulate: (seconds: number, keys: string[] = []) => this.explorer.simulate(seconds, keys),
    };
  }
}
