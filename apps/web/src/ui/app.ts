import { createRouter, describeRoute, floorDisplayName, instructionPoints, routeBetween, routePolyline } from "@gteki/navigation";
import type { Instruction, PolylinePoint, RouteFailure, RouteProfile, RouteResult, Router } from "@gteki/navigation";
import type { Poi, Source, StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import type { SearchHit, SearchIndex } from "@gteki/search";
import { Explorer } from "../explorer/explorer.ts";
import { guideStops } from "../explorer/guideStops.ts";
import { DEFAULT_GUIDE_TIER, guidePaceSpans, guideTierSpeed, isGuideTier, nextGuideTier, type GuideTierId } from "../explorer/guidePace.ts";
import { initialLang, pick, strings, type Lang } from "../i18n.ts";
import { listStations, StationLoadError, type LoadedStation, type StationEntry } from "../registry.ts";
import { stationClock } from "../stationClock.ts";
import { factsOnlyCredit, sourceCredit } from "../credits.ts";
import { applyAria, COMBO_CLOSED, comboboxKeys, inputAria, isImeKeydown, listboxRole, normalizeCombo, optionAria, type ComboState } from "./combobox.ts";
import { LiveRegion, routeLiveMessage, searchLiveMessage } from "./live.ts";
import { watchReducedMotion } from "./motion.ts";

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
  profile: { stepFree: boolean; unpaidOnly: boolean; strictHours: boolean };
  route: RouteResult | RouteFailure | null;
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
    origin: null, destination: null, profile: { stepFree: false, unpaidOnly: false, strictHours: false },
    route: null, polyline: [], instructions: [], activeInstruction: 0,
  };
  private explorer!: Explorer;
  private readonly ui = {
    stationSelect: el("select", "station-select"),
    banner: el("div", "banner"),
    fromInput: el("input", "field-input"),
    toInput: el("input", "field-input"),
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
    hint: el("div", "hint"),
    panel: el("section", "panel"),
    more: el("button", "ghost more", "⋯"),
    live: new LiveRegion(() => this.t),
  };
  /** Listbox state of the two search comboboxes. */
  private readonly combo: Record<"from" | "to", ComboState> = { from: COMBO_CLOSED, to: COMBO_CLOSED };
  private panelExpanded = false;

  constructor(private readonly root: HTMLElement) {}

  private get t() {
    return strings(this.s.lang);
  }

  async start(): Promise<void> {
    this.layout();
    this.explorer = new Explorer(this.root.querySelector(".viewport") as HTMLElement, {
      onMode: (mode) => this.onMode(mode),
      onGuideProgress: (p) => this.onGuideProgress(p),
      onGuideStop: (index) => this.onGuideStop(index),
      onPoiClick: (id) => {
        const poi = this.s.loaded?.bundle.pois.find((p) => p.id === id);
        if (poi) this.setDestination(poi);
      },
    });
    this.explorer.setGuideTier(readGuideTier());
    watchReducedMotion((reduce) => this.explorer.setReducedMotion(reduce));
    this.exposeTestHooks();
    this.s.entries = await listStations();
    this.renderStationSelect();
    const params = new URLSearchParams(location.search);
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
    const actions = el("div", "top-actions");
    actions.append(this.ui.coverageBtn, this.ui.langBtn);
    top.append(brand, this.ui.stationSelect, actions);

    const panel = this.ui.panel;
    this.ui.more.addEventListener("click", () => { this.panelExpanded = !this.panelExpanded; this.updatePanelCollapse(); });
    const fromRow = this.field("from", this.ui.fromInput, this.ui.fromResults);
    const toRow = this.field("to", this.ui.toInput, this.ui.toResults);
    const swap = el("button", "swap", "⇅");
    swap.title = this.t.swap;
    swap.setAttribute("aria-label", this.t.swap);
    swap.addEventListener("click", () => this.swap());
    const fields = el("div", "fields");
    fields.append(fromRow, toRow, swap);
    panel.append(this.ui.banner, fields, this.ui.spawnChips, this.ui.profile, this.ui.more);

    this.ui.hint.setAttribute("role", "note");
    this.root.append(viewport, top, panel, this.ui.sheet, this.ui.hud, this.ui.toast, this.ui.live.el, this.ui.coverage, this.ui.hint);
    this.layoutText();
  }

  private layoutText(): void {
    const t = this.t;
    document.documentElement.lang = this.s.lang;
    this.ui.langBtn.textContent = t.language;
    this.ui.langBtn.dataset.short = this.s.lang === "ja" ? "EN" : "日本語";
    this.ui.coverageBtn.textContent = t.coverage;
    this.ui.more.setAttribute("aria-label", t.options);
    this.ui.fromInput.placeholder = t.fromPlaceholder;
    this.ui.toInput.placeholder = t.toPlaceholder;
    this.root.querySelectorAll<HTMLElement>("[data-label]").forEach((n) => { n.textContent = t[n.dataset.label as "from" | "to"]; });
    this.ui.hint.textContent = matchMedia("(pointer: coarse)").matches ? t.touchHint : t.controlsHint;
  }

  private field(which: "from" | "to", input: HTMLInputElement, results: HTMLDivElement): HTMLDivElement {
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
    row.append(label, input, results);
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

  private async openStation(entry: StationEntry, fromId?: string | null, toId?: string | null): Promise<void> {
    // A later selection supersedes this one: never let a slow station overwrite the one now selected.
    const generation = ++this.openGeneration;
    const current = () => generation === this.openGeneration;
    this.explorer.cancelPendingLoad();
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
    this.s.route = null;
    this.s.polyline = [];
    this.s.instructions = [];
    this.ui.fromInput.value = "";
    this.ui.toInput.value = "";
    this.closeResults("from");
    this.closeResults("to");
    this.ui.sheet.innerHTML = "";
    this.renderSpawnChips(undefined);
    this.toast(this.t.loading);
    try {
      const loaded = await entry.load();
      if (!current()) return;
      this.s.loaded = loaded;
      this.s.router = createRouter(loaded.bundle);
      this.s.search = createSearchIndex(loaded.bundle);
      if (!(await this.explorer.loadStation(loaded, this.s.router)) || !current()) return;
      this.toast(this.explorer.sceneError ? `${this.t.sceneFallback}: ${this.explorer.sceneError}` : "", this.explorer.sceneError ? 6000 : 0);
    } catch (err) {
      if (!current()) return;
      this.s.loaded = null;
      this.s.router = null;
      this.s.search = null;
      this.showLoadError(err);
      return;
    }
    this.stationReady = true;
    const pois = this.s.loaded.bundle.pois;
    const from = pois.find((p) => p.id === fromId);
    const to = pois.find((p) => p.id === toId);
    if (from) this.s.origin = { kind: "poi", poi: from };
    if (to) this.s.destination = to;
    this.refreshAll();
    this.updateUrl();
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
    const b = this.s.loaded?.bundle;
    this.renderBanner(b);
    this.renderSpawnChips(b);
    this.renderProfile();
    // The lists show the previous language / selection: drop them.
    this.closeResults("from");
    this.closeResults("to");
    this.ui.fromInput.value = this.originLabel();
    this.ui.toInput.value = this.s.destination ? this.poiName(this.s.destination) : "";
    if (b) this.explorer.showPois(b, (p) => this.poiName(p), [this.s.destination?.id, this.s.origin?.kind === "poi" ? this.s.origin.poi.id : undefined].filter(Boolean) as string[]);
    this.computeRoute();
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
    const poi = b.pois.find((p) => p.connectorNodeIds.includes(nodeId));
    return poi ? this.poiName(poi) : nodeId;
  }

  private originLabel(): string {
    const o = this.s.origin;
    if (!o) return "";
    return o.kind === "poi" ? this.poiName(o.poi) : o.label;
  }

  private renderResults(which: "from" | "to"): void {
    const input = which === "from" ? this.ui.fromInput : this.ui.toInput;
    const box = which === "from" ? this.ui.fromResults : this.ui.toResults;
    this.closeResults(which);
    if (!this.s.search || !this.s.loaded) return;
    const q = input.value.trim();
    const hits: SearchHit[] = q ? this.s.search.search(q, { limit: 8 }) : this.s.loaded.bundle.pois.slice(0, 8).map((poi) => ({ poi, score: 0, matched: "", routable: poi.connectorNodeIds.length > 0 }));
    this.ui.live.announce(searchLiveMessage(this.t, hits.length));
    if (hits.length === 0) {
      const none = el("div", "result empty", this.t.noResults);
      none.setAttribute("role", "option");
      none.setAttribute("aria-disabled", "true");
      box.append(none);
      this.setCombo(which, { open: true, count: 0, active: -1 });
      return;
    }
    const floors = new Map(this.s.loaded.bundle.floors.map((f) => [f.id, f]));
    hits.forEach((h, i) => {
      const b = el("button", `result cat-${h.poi.category}${h.routable ? "" : " disabled"}`);
      const dot = el("span", "dot");
      dot.setAttribute("aria-hidden", "true");
      const name = el("span", "result-name", this.poiName(h.poi));
      const meta = el("span", "result-meta");
      const floor = h.poi.floorId ? floorDisplayName(floors.get(h.poi.floorId), this.s.lang) : null;
      const tags = [floor, h.matched && h.matched !== this.poiName(h.poi) ? `“${h.matched}”` : null, h.routable ? null : this.t.searchOnly].filter(Boolean) as string[];
      meta.textContent = tags.join(" · ");
      b.append(dot, name, meta);
      // The accessible name carries the visible tags, so "search only" is heard too.
      applyAria(b, optionAria(COMBO_CLOSED, box.id, i, [name.textContent, ...tags].join(", ")));
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        this.closeResults(which);
        input.blur();
        if (which === "from") this.setOrigin({ kind: "poi", poi: h.poi });
        else this.setDestination(h.poi);
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
    if (!state.open) box.replaceChildren();
    const role = listboxRole(state);
    if (role) box.setAttribute("role", role);
    else box.removeAttribute("role");
    applyAria(input, inputAria(state, box.id));
    box.querySelectorAll('[role="option"]').forEach((o, i) => o.setAttribute("aria-selected", String(i === state.active)));
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

  private setDestination(p: Poi): void {
    if (!this.ownsPoi(p)) return;
    this.s.destination = p;
    this.refreshAll();
    this.updateUrl();
  }

  private swap(): void {
    const o = this.s.origin;
    const d = this.s.destination;
    this.s.destination = o?.kind === "poi" ? o.poi : null;
    this.s.origin = d ? { kind: "poi", poi: d } : null;
    this.refreshAll();
    this.updateUrl();
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
    this.s.polyline = [];
    this.s.instructions = [];
    this.explorer.clearRoute();
    if (!router || !loaded || !origin || !destination) { this.renderSheet(); return; }
    // One multi-source query: the router ranks entrances by its own cost and keeps "already there";
    // routeBetween also applies the fare policy to the POIs themselves.
    const best: RouteResult | RouteFailure = routeBetween(router, origin, destination, this.profile());
    this.s.route = best;
    this.ui.live.announce(routeLiveMessage(this.t, best));
    if (best.ok) {
      this.s.polyline = routePolyline(loaded.bundle, best);
      this.s.instructions = describeRoute(loaded.bundle, best, this.s.lang, destination);
      this.s.activeInstruction = 0;
      this.explorer.showRoute(this.s.polyline);
      if (this.explorer.currentMode === "overview") this.explorer.focusPoints(this.s.polyline);
    }
    this.renderSheet();
  }

  private renderSheet(): void {
    const sheet = this.ui.sheet;
    sheet.innerHTML = "";
    const r = this.s.route;
    const b = this.s.loaded?.bundle;
    if (!r || !b) { sheet.classList.remove("open"); return; }
    sheet.classList.add("open");
    const t = this.t;
    if (!r.ok) {
      const card = el("div", "card no-route");
      card.append(el("h2", undefined, t.noRoute), el("p", undefined, t.noRouteWhy[r.reason] ?? r.message));
      sheet.append(card);
      return;
    }
    const card = el("div", "card route");
    const head = el("div", "route-head");
    head.append(
      el("strong", "big", t.minutes(Math.max(1, Math.round(r.estimatedSeconds / 60)))),
      el("span", undefined, t.meters(Math.round(r.totalLengthM))),
      el("span", undefined, t.floors(r.floorChanges)),
    );
    card.append(head);

    const badges = el("div", "badges");
    const badge = (text: string, cls: string, title?: string) => { const x = el("span", `badge ${cls}`, text); if (title) x.title = title; badges.append(x); };
    if (r.synthetic) badge(t.syntheticShort, "warn", t.synthetic);
    const unknownText: Record<string, string> = { hours: t.unknownHours, wheelchair: t.unknownWheelchair, steps: t.unknownSteps, paid: t.unknownPaid, fare_boundary: t.unknownFare, access_evidence: t.unknownAccess };
    for (const u of r.unknowns) badge(`${unknownText[u.kind] ?? u.kind} ×${u.edgeIds.length}`, "unknown");
    // Waiting for an opening window is part of the time, and is said so.
    if (r.waitSeconds > 0) badge(t.waiting(Math.max(1, Math.round(r.waitSeconds / 60))), "info");
    if (r.timeRestricted.length) badge(`${t.timeWindow}: ${r.timeRestricted.map((w) => `${w.open}–${w.close}`).join(", ")}`, "unknown");
    if (r.crossesFareBoundary === true) badge(t.paidCrossing, "info");
    if (r.stale === true) badge(t.stale, "warn", r.expiredSourceIds.length > 0 ? `${t.expired}: ${r.expiredSourceIds.join(", ")}` : (r.oldestSourceDate ?? undefined));
    // UNKNOWN freshness is shown whatever its cause: undated sources, or a year/month date straddling the cutoff.
    else if (r.stale === null) badge(t.freshnessUnknown, "unknown", r.undatedSourceIds.length > 0 ? r.undatedSourceIds.join(", ") : (r.oldestSourceDate ?? undefined));
    if (this.s.polyline.some((p) => !p.zKnown)) badge(t.symbolicHeight, "muted");
    if (r.operatorIds.length > 1) badge(`${t.operators}: ${r.operatorIds.join(" → ")}`, "info");
    card.append(badges);

    const actions = el("div", "actions");
    const guide = el("button", "primary", t.guide);
    guide.addEventListener("click", () => this.startGuide());
    const walk = el("button", undefined, t.walk);
    walk.addEventListener("click", () => {
      const first = this.s.polyline[0];
      if (first) this.explorer.walkFrom(first);
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
    prov.append(el("summary", undefined, `${t.sources} · ${t.freshness} ${r.oldestSourceDate ?? "?"}${r.evidenceCheckedDate ? ` / ${r.evidenceCheckedDate}` : ""}`));
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
    this.renderSpawnChips(this.s.loaded?.bundle);
    this.renderHud();
  }

  private renderHud(): void {
    const hud = this.ui.hud;
    hud.innerHTML = "";
    const mode = this.explorer.currentMode;
    this.announceInstruction();
    if (mode === "overview") { this.trackInstruction(); return; }
    const t = this.t;
    const ins = this.s.instructions[this.s.activeInstruction];
    if (mode === "guide" && ins) hud.append(el("div", "hud-instruction", ins.text));
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
        speed.textContent = t.guideSpeedLabel(name, guideTierSpeed(tier));
        speed.setAttribute("aria-label", t.guideSpeedAria(name));
        speed.title = t.guideSpeedAria(name);
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
      row.append(pause, speed, stop);
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
    this.trackInstruction();
  }

  private instructionEl: Element | null = null;
  private instructionSize: ResizeObserver | null = null;

  /** Keep `--hud-clear` (the guide instruction's bottom edge + 8 px) current for the toast, which sits below the instruction while one shows; unset otherwise. */
  private trackInstruction(): void {
    const cur = this.ui.hud.querySelector(".hud-instruction");
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
    if (!ins) cur?.remove();
    else if (cur) cur.textContent = ins.text;
    else hud.prepend(el("div", "hud-instruction", ins.text));
    pause.textContent = this.explorer.guidePaused ? this.t.resume : this.t.pause;
    this.announceInstruction();
    this.trackInstruction();
  }

  private spokenInstruction: Instruction | null = null;

  /** Announce the guide's active instruction once per change (not per progress tick); forgotten outside the guide. */
  private announceInstruction(): void {
    const ins = this.explorer.currentMode === "guide" ? this.s.instructions[this.s.activeInstruction] ?? null : null;
    if (ins === this.spokenInstruction) return;
    this.spokenInstruction = ins;
    if (ins) this.ui.live.announce(ins.text);
  }

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
    this.explorer.startGuide(this.s.polyline, 0, stops.map((x) => x.point), spans);
  }

  /** The guide reached a wait: it is paused there, and the wait stays the active instruction until resumed. */
  private onGuideStop(index: number): void {
    const wait = this.guideWaits[index];
    if (wait === undefined) return;
    this.s.activeInstruction = wait;
    this.updateGuideHud();
    this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === wait));
    this.toast(this.s.instructions[wait]!.text, 4000);
  }

  private onGuideProgress(p: { stepIndex: number; done: boolean }): void {
    // Stopped at a wait (onGuideStop): it stays the active instruction until the guide is resumed.
    if (this.s.instructions[this.s.activeInstruction]?.kind === "wait" && this.explorer.guidePaused) return;
    const idx = this.s.instructions.findIndex((ins) => ins.stepIndexes.includes(p.stepIndex));
    const next = p.done ? this.s.instructions.length - 1 : idx;
    if (next >= 0 && next !== this.s.activeInstruction) {
      this.s.activeInstruction = next;
      this.updateGuideHud();
      this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === next));
      if (p.done) {
        // A route ending on a stair/escalator/ramp connector has not reached the destination: say so.
        const last = this.s.instructions[this.s.instructions.length - 1];
        this.toast(last?.connector ? last.text : this.t.arrived, 2500);
      }
    }
  }

  /** A source's credit line: title (linked), attribution, licence (linked) and the modification notice. */
  private creditItem(s: Source): HTMLLIElement {
    const c = sourceCredit(s);
    const link = (text: string, href: string | null): HTMLElement => {
      if (!href) return el("span", undefined, text);
      const a = el("a", undefined, text);
      a.href = href;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      return a;
    };
    const li = el("li");
    li.append(link(c.title, c.href), el("span", "muted", ` — ${c.attribution}`));
    if (c.license) li.append(el("span", "muted", " ("), link(c.license.name, c.license.href), el("span", "muted", ")"));
    if (c.modified) li.append(el("span", "muted", ` · ${this.t.modified}`));
    // Facts-only sources have no licence to show: say so (Coverage dialog and the route card's 出典 both use this).
    const facts = factsOnlyCredit(s, this.t);
    if (facts) {
      li.append(el("span", "muted", ` · ${facts.text}`));
      if (facts.decision) li.append(el("span", "muted", " ("), link(facts.decision.label, facts.decision.href), el("span", "muted", ")"));
    }
    return li;
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
        for (const a of b.coverage.areas) ul.append(el("li", `cov-${a.status}`, `${this.t.coverageStatus[a.status] ?? a.status} · ${pick(a.label, this.s.lang)}${a.note ? ` — ${a.note}` : ""}`));
        d.append(ul);
      }
      d.append(el("h3", undefined, this.t.gaps));
      const gaps = el("ul");
      for (const g of b.coverage.gaps) gaps.append(el("li", undefined, `${g.zone}: ${g.missingFact} → ${g.fieldWorkNeeded}`));
      if (!b.coverage.gaps.length) gaps.append(el("li", "muted", "—"));
      d.append(gaps, el("h3", undefined, this.t.sources));
      const src = el("ul");
      // Every source, including those cited only by assets or coverage: link, licence and modification notice.
      for (const s of b.sources) {
        const li = this.creditItem(s);
        li.append(el("span", "muted", ` [${s.rights}${s.usage === "facts-only" ? `, ${this.t.factsOnlyTag}` : ""}]`));
        src.append(li);
      }
      d.append(src);
      // Asset modification notices (e.g. "Blender build from PLATEAU …") disclose how sources were processed.
      const derived = (b.assets ?? []).filter((a) => a.derivation);
      if (derived.length) {
        const ul = el("ul");
        for (const a of derived) ul.append(el("li", undefined, `${a.id}: ${a.derivation} — ${a.sourceIds.map((id) => b.sources.find((s) => s.id === id)?.title ?? id).join(", ")}`));
        d.append(el("h3", undefined, this.t.assetDerivations), ul);
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
      guideControls: () => ({ paused: this.explorer.guidePaused, tier: this.explorer.guideTier, speed: guideTierSpeed(this.explorer.guideTier) }),
      hud: () => [...this.ui.hud.querySelectorAll("button")].map((b) => b.textContent),
      labels: () => this.explorer.labelInfo(),
      quality: () => this.explorer.qualityLevel,
      avatar: () => this.explorer.avatarEnu,
      sceneInfo: () => this.explorer.sceneInfo(),
      phase: () => this.explorer.phase,
      audio: () => this.explorer.audioInfo(),
      walkFromNode: (nodeId: string) => (this.s.loaded ? this.explorer.walkFromNode(this.s.loaded.bundle, nodeId) : false),
      simulate: (seconds: number, keys: string[] = []) => this.explorer.simulate(seconds, keys),
    };
  }
}
