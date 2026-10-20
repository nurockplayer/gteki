import { createRouter, describeRoute, floorDisplayName, routePolyline } from "@gteki/navigation";
import type { Instruction, PolylinePoint, RouteFailure, RouteProfile, RouteResult, Router } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import { createSearchIndex } from "@gteki/search";
import type { SearchHit, SearchIndex } from "@gteki/search";
import { Explorer } from "../explorer/explorer.ts";
import { initialLang, pick, strings, type Lang } from "../i18n.ts";
import { listStations, StationLoadError, type LoadedStation, type StationEntry } from "../registry.ts";
import { stationClock } from "../stationClock.ts";

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
  };
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
      onPoiClick: (id) => {
        const poi = this.s.loaded?.bundle.pois.find((p) => p.id === id);
        if (poi) this.setDestination(poi);
      },
    });
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
    this.ui.more.setAttribute("aria-label", "options");
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
    this.root.append(viewport, top, panel, this.ui.sheet, this.ui.hud, this.ui.toast, this.ui.coverage, this.ui.hint);
    this.layoutText();
  }

  private layoutText(): void {
    const t = this.t;
    document.documentElement.lang = this.s.lang;
    this.ui.langBtn.textContent = t.language;
    this.ui.langBtn.dataset.short = this.s.lang === "ja" ? "EN" : "日本語";
    this.ui.coverageBtn.textContent = t.coverage;
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
    input.addEventListener("input", () => this.renderResults(which));
    input.addEventListener("focus", () => this.renderResults(which));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") (results.querySelector("button") as HTMLButtonElement | null)?.click();
      if (e.key === "Escape") { results.innerHTML = ""; input.blur(); }
    });
    input.addEventListener("blur", () => setTimeout(() => { results.innerHTML = ""; }, 160));
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
    this.ui.fromResults.innerHTML = "";
    this.ui.toResults.innerHTML = "";
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
  }

  private refreshAll(): void {
    this.updatePanelCollapse();
    const b = this.s.loaded?.bundle;
    this.renderBanner(b);
    this.renderSpawnChips(b);
    this.renderProfile();
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
    box.innerHTML = "";
    if (!this.s.search || !this.s.loaded) return;
    const q = input.value.trim();
    const hits: SearchHit[] = q ? this.s.search.search(q, { limit: 8 }) : this.s.loaded.bundle.pois.slice(0, 8).map((poi) => ({ poi, score: 0, matched: "", routable: poi.connectorNodeIds.length > 0 }));
    if (hits.length === 0) { box.append(el("div", "result empty", this.t.noResults)); return; }
    const floors = new Map(this.s.loaded.bundle.floors.map((f) => [f.id, f]));
    for (const h of hits) {
      const b = el("button", `result cat-${h.poi.category}${h.routable ? "" : " disabled"}`);
      const name = el("span", "result-name", this.poiName(h.poi));
      const meta = el("span", "result-meta");
      const floor = h.poi.floorId ? floorDisplayName(floors.get(h.poi.floorId), this.s.lang) : null;
      meta.textContent = [floor, h.matched && h.matched !== this.poiName(h.poi) ? `“${h.matched}”` : null, h.routable ? null : this.t.searchOnly].filter(Boolean).join(" · ");
      b.append(el("span", "dot"), name, meta);
      b.addEventListener("mousedown", (e) => e.preventDefault());
      b.addEventListener("click", () => {
        box.innerHTML = "";
        input.blur();
        if (which === "from") this.setOrigin({ kind: "poi", poi: h.poi });
        else this.setDestination(h.poi);
      });
      box.append(b);
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
    const tokyo = stationClock(new Date(), "Asia/Tokyo");
    return {
      fare: this.s.profile.unpaidOnly ? "unpaid_only" : "ticketed",
      stepFree: this.s.profile.stepFree,
      hours: this.s.profile.strictHours ? "require_known" : "warn_unknown",
      at: { weekday: tokyo.weekday, minutes: tokyo.minutes },
      today: tokyo.date,
    };
  }

  private computeRoute(): void {
    const { router, loaded, origin, destination } = this.s;
    this.s.route = null;
    this.s.polyline = [];
    this.s.instructions = [];
    this.explorer.clearRoute();
    if (!router || !loaded || !origin || !destination) { this.renderSheet(); return; }
    const starts = origin.kind === "poi" ? origin.poi.connectorNodeIds : [origin.nodeId];
    const goals = destination.connectorNodeIds;
    const profile = this.profile();
    // One multi-source query: the router ranks entrances by its own cost and keeps "already there".
    const best: RouteResult | RouteFailure = starts.length === 0
      ? { ok: false, reason: "unknown_start", message: "origin has no verified entrance" }
      : goals.length === 0 ? { ok: false, reason: "unknown_goal", message: "destination has no verified entrance" }
      : router.route(starts, goals, profile);
    this.s.route = best;
    if (best.ok) {
      this.s.polyline = routePolyline(loaded.bundle, best);
      this.s.instructions = describeRoute(loaded.bundle, best, this.s.lang);
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
    if (r.timeRestricted.length) badge(`${t.timeWindow}: ${r.timeRestricted.map((w) => `${w.open}–${w.close}`).join(", ")}`, "unknown");
    if (r.crossesFareBoundary === true) badge(t.paidCrossing, "info");
    if (r.stale === true) badge(t.stale, "warn");
    else if (r.stale === null && r.undatedSourceIds.length > 0) badge(t.freshnessUnknown, "unknown", r.undatedSourceIds.join(", "));
    if (this.s.polyline.some((p) => !p.zKnown)) badge(t.symbolicHeight, "muted");
    if (r.operatorIds.length > 1) badge(`${t.operators}: ${r.operatorIds.join(" → ")}`, "info");
    card.append(badges);

    const actions = el("div", "actions");
    const guide = el("button", "primary", t.guide);
    guide.addEventListener("click", () => this.explorer.startGuide(this.s.polyline));
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
        const pts = this.s.polyline.filter((p) => ins.stepIndexes.includes(p.stepIndex));
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
      const li = el("li");
      const a = el("a", undefined, s.title);
      a.href = s.url;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      li.append(a, el("span", "muted", ` — ${s.attribution}${s.license ? ` (${s.license.name})` : ""}${s.datasetDate ? ` · ${s.datasetDate}` : ""}`));
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
    if (mode === "overview") return;
    const t = this.t;
    const ins = this.s.instructions[this.s.activeInstruction];
    if (mode === "guide" && ins) hud.append(el("div", "hud-instruction", ins.text));
    const row = el("div", "hud-row");
    if (mode === "guide") {
      let paused = false;
      const pause = el("button", undefined, t.pause);
      pause.addEventListener("click", () => { paused = !paused; this.explorer.setGuidePaused(paused); pause.textContent = paused ? t.resume : t.pause; });
      const speed = el("button", "ghost", `${t.speed} ×1`);
      let mult = 1;
      speed.addEventListener("click", () => { mult = mult === 1 ? 2 : mult === 2 ? 4 : 1; this.explorer.setGuideSpeed(mult); speed.textContent = `${t.speed} ×${mult}`; });
      const stop = el("button", "ghost", t.exitGuide);
      stop.addEventListener("click", () => this.explorer.stopGuide());
      row.append(pause, speed, stop);
    }
    const fp = el("button", "ghost", t.firstPerson);
    fp.addEventListener("click", () => fp.classList.toggle("on", this.explorer.toggleFirstPerson()));
    const ov = el("button", "ghost", t.overview);
    ov.addEventListener("click", () => this.explorer.frameAll());
    const net = el("button", "ghost", t.graphOverlay);
    let netOn = false;
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
  }

  private onGuideProgress(p: { stepIndex: number; done: boolean }): void {
    const idx = this.s.instructions.findIndex((ins) => ins.stepIndexes.includes(p.stepIndex));
    const next = p.done ? this.s.instructions.length - 1 : idx;
    if (next >= 0 && next !== this.s.activeInstruction) {
      this.s.activeInstruction = next;
      this.renderHud();
      this.ui.sheet.querySelectorAll(".ins").forEach((n, i) => n.classList.toggle("active", i === next));
      if (p.done) this.toast(this.t.arrived, 2500);
    }
  }

  // ---- Coverage --------------------------------------------------------------------

  private openCoverage(): void {
    const b = this.s.loaded?.bundle;
    const d = this.ui.coverage;
    d.innerHTML = "";
    const close = el("button", "ghost close", "×");
    close.addEventListener("click", () => d.close());
    d.append(close, el("h2", undefined, this.t.coverage));
    if (b) {
      d.append(el("p", undefined, pick(b.coverage.summary, this.s.lang)));
      if (b.coverage.areas.length) {
        const ul = el("ul");
        for (const a of b.coverage.areas) ul.append(el("li", `cov-${a.status}`, `${a.status} · ${pick(a.label, this.s.lang)}${a.note ? ` — ${a.note}` : ""}`));
        d.append(ul);
      }
      d.append(el("h3", undefined, this.t.gaps));
      const gaps = el("ul");
      for (const g of b.coverage.gaps) gaps.append(el("li", undefined, `${g.zone}: ${g.missingFact} → ${g.fieldWorkNeeded}`));
      if (!b.coverage.gaps.length) gaps.append(el("li", "muted", "—"));
      d.append(gaps, el("h3", undefined, this.t.sources));
      const src = el("ul");
      for (const s of b.sources) src.append(el("li", undefined, `${s.title} — ${s.attribution} [${s.rights}${s.usage === "facts-only" ? ", facts-only" : ""}]`));
      d.append(src);
    }
    d.showModal();
  }

  private toastTimer = 0;

  private toast(text: string, ms = 0): void {
    clearTimeout(this.toastTimer);
    this.ui.toast.textContent = text;
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
      startGuide: () => this.explorer.startGuide(this.s.polyline),
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
