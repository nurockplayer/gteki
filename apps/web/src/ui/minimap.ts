import { floorDisplayName } from "@gteki/navigation";
import type { PolylinePoint, RouteStep } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { pick, strings, type Lang } from "../i18n.ts";
import { poiLabel } from "./labels.ts";
import { advanceRouteSeg, arrowRotationDeg, currentFloorId, floorPois, floorTransitions, floorWalkGraph, rimBearing, routeOnFloor, toMinimap, type FloorTransition, type MinimapOrientation } from "./minimapGeometry.ts";

const ORIENTATION_KEY = "gteki.minimap.orientation";
const COLLAPSED_KEY = "gteki.minimap.collapsed";
const METRES_PER_PX = 0.5;
const CENTRE = 95; // Fixed viewBox: mobile shows the same 95 m span as desktop.
const RIM_RADIUS = 93; // Matches the rim circle in the viewBox.
const RIM_MARKER_RADIUS = RIM_RADIUS - 9; // Just inside the marker margin, so a chevron sits on the rim.
let nextClipId = 0;

/** Off-floor connector glyphs, drawn around the marker origin (24-unit box, stroked). */
const CONNECTOR_GLYPHS: Record<string, string> = {
  stairs: "M -5,5 L -5,1 L 0,1 L 0,-3 L 5,-3 L 5,-6",
  escalator: "M -5,5 L 5,-5 M 1,-5 L 5,-5 L 5,-1",
  elevator: "M -4,5 L -4,-5 L 4,-5 L 4,5 Z M 0,3 L 0,-1 M -2,1 L 0,-1 L 2,1",
  ramp: "M -5,5 L 5,5 M -5,5 L 5,-1",
  moving_walkway: "M -5,2 L 5,2 M -5,-2 L 5,-2 M 2,-5 L 5,-2 L 2,1",
  walk: "M -4,4 L 4,-4 M 0,-4 L 4,-4 L 4,0",
  gate: "M -4,5 L -4,-1 L 4,-1 L 4,5 M 0,5 L 0,0",
};

function read(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
function persist(key: string, value: string): void {
  try { localStorage.setItem(key, value); } catch { /* Storage may be unavailable. */ }
}
function svg<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string> = {}): SVGElementTagNameMap[K] {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value);
  return node;
}

/** A lightweight, current-floor schematic HUD, independent of camera and navigation state. */
export class Minimap {
  readonly el = document.createElement("section");
  private readonly body = document.createElement("div");
  private readonly label = document.createElement("div");
  private readonly notice = document.createElement("div");
  private readonly toggle = document.createElement("button");
  private readonly collapseButton = document.createElement("button");
  private readonly reopen = document.createElement("button");
  private readonly graph = svg("g", { class: "minimap-graph" });
  private readonly routeGroup = svg("g", { class: "minimap-route" });
  private readonly poiGroup = svg("g", { class: "minimap-pois" });
  private readonly markerGroup = svg("g", { class: "minimap-markers" });
  private readonly routeEnd = svg("g", { class: "minimap-route-end" });
  private readonly destinationRim = svg("path", { class: "minimap-rim-marker minimap-destination-rim", d: "M 0,-6 L 5,4 L -5,4 Z" });
  private readonly connectorMarker = svg("g", { class: "minimap-connector-marker" });
  private readonly connectorGlyph = svg("path", { class: "minimap-connector-glyph" });
  private readonly connectorRim = svg("path", { class: "minimap-rim-marker minimap-connector-rim", d: "M 0,-6 L 5,4 L -5,4 Z" });
  private readonly connectorTitle = svg("title");
  private readonly routeLabel = document.createElement("div");
  private readonly floorSelect = document.createElement("select");
  private readonly arrow = svg("path", { class: "minimap-arrow", d: "M 0,-10 L 7,8 L 0,4 L -7,8 Z" });
  private readonly north = svg("g");
  private readonly map = svg("svg", { class: "minimap-map", viewBox: "0 0 190 190", role: "button", tabindex: "0" });
  private readonly overlay = document.createElement("section");
  private readonly overlayPanel = document.createElement("div");
  private readonly overlayTitle = document.createElement("div");
  private readonly overlayClose = document.createElement("button");
  private readonly overlayMap = svg("svg", { class: "minimap-overlay-map", viewBox: "0 0 190 190", role: "img" });
  private readonly overlayGraph = svg("g", { class: "minimap-graph" });
  private readonly overlayRoute = svg("g", { class: "minimap-route" });
  private readonly overlayPoi = svg("g", { class: "minimap-pois" });
  private readonly overlayLabel = document.createElement("div");
  private readonly overlayNotice = document.createElement("div");
  private readonly overlayArrow = svg("path", { class: "minimap-arrow", d: "M 0,-10 L 7,8 L 0,4 L -7,8 Z" });
  private readonly overlayNorth = svg("g");
  /** Edge chevron for a destination beyond the drawn span; same marker language as the HUD rim. */
  private readonly overlayDestinationRim = svg("path", { class: "minimap-rim-marker minimap-destination-rim", d: "M 0,-6 L 5,4 L -5,4 Z" });
  private overlayOpen = false;
  private overlayDirty = true;
  private bundle: StationBundle | null = null;
  private lang: Lang = "ja";
  private orientation: MinimapOrientation = read(ORIENTATION_KEY) === "north-up" ? "north-up" : "player-up";
  private collapsed = read(COLLAPSED_KEY) === "true";
  /** The floor actually drawn; in follow mode it tracks the player, otherwise it is the picked floor. */
  private floorId: string | null | undefined;
  /** A picked floor pins the map; null follows the player's floor. */
  private pickedFloorId: string | null = null;
  /** Station id + language of the options currently in the picker. */
  private floorOptionsKey = "";
  /** The last known floor for route progress; an unknown reading never clears it. */
  private lastKnownFloor: string | undefined;
  private route: PolylinePoint[] | null = null;
  private steps: RouteStep[] | null = null;
  private destination: Poi | null = null;
  /** The destination's evidenced display position on the drawn floor; null means no dot was earned. */
  private destinationPoint: { x: number; y: number } | null = null;
  private routeDirty = false;
  /** Every floor-changing step, computed once per route; per-tick selection only reads this. */
  private transitions: FloorTransition[] = [];
  /** Route progress as a polyline segment index; forward-only, reset to 0 with a new route. */
  private seg = 0;
  private connectorHint: FloorTransition | null = null;
  private connectorDirty = true;
  private labelKey = "";
  private lastPose = "";
  /** Position without heading: a turn alone cannot change route progress, so it skips the search. */
  private lastPosition = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly visibilityChanged = () => {
    this.syncTimer();
    if (!document.hidden && !this.collapsed) this.refresh();
  };
  /**
   * Modal keys are document-level: a click on the backdrop can drop focus to the body, and Escape
   * must still close. Tab is contained to the dialog's one control, so focus cannot reach the app.
   */
  private readonly overlayKeydown = (event: KeyboardEvent) => {
    if (!this.overlayOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      this.closeOverlay();
    } else if (event.key === "Tab") {
      event.preventDefault();
      this.overlayClose.focus();
    }
  };

  constructor(private readonly getPose: () => ExplorerPose | null) {
    this.el.className = "minimap";
    this.el.hidden = true;
    this.body.className = "minimap-body";
    this.label.className = "minimap-label";
    this.notice.className = "minimap-notice";
    const clipId = `minimap-clip-${++nextClipId}`;
    const defs = svg("defs"), clip = svg("clipPath", { id: clipId });
    clip.append(svg("circle", { cx: "95", cy: "95", r: "92" }));
    defs.append(clip);
    const clipped = svg("g", { "clip-path": `url(#${clipId})` });
    this.routeEnd.append(svg("circle", { r: "3", class: "minimap-route-end-dot" }));
    this.connectorMarker.append(this.connectorGlyph, this.connectorTitle);
    this.markerGroup.append(this.routeEnd, this.destinationRim, this.connectorMarker, this.connectorRim);
    for (const marker of [this.routeEnd, this.destinationRim, this.connectorMarker, this.connectorRim]) marker.style.display = "none";
    // Route and POIs share the walk graph's rotated/translated world; markers stay in screen space.
    clipped.append(this.graph, this.routeGroup, this.poiGroup, this.markerGroup);
    const n = svg("text", { x: "95", y: "19", "text-anchor": "middle", class: "minimap-north" });
    n.textContent = "N";
    this.north.append(n);
    this.map.append(defs, svg("circle", { cx: "95", cy: "95", r: "93", class: "minimap-rim" }), clipped, this.north, this.arrow);
    this.arrow.style.display = "none";
    this.map.addEventListener("click", () => this.openOverlay());
    this.map.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.openOverlay();
    });
    this.routeLabel.className = "minimap-route-label";
    this.routeLabel.hidden = true;
    const controls = document.createElement("div");
    controls.className = "minimap-controls";
    this.toggle.className = "minimap-orientation";
    this.collapseButton.className = "minimap-collapse";
    this.reopen.className = "minimap-reopen";
    this.floorSelect.className = "minimap-floor";
    // An empty value is the follow state; any floor id pins that floor's graph and route run.
    this.floorSelect.addEventListener("change", () => {
      this.pickedFloorId = this.floorSelect.value === "" ? null : this.floorSelect.value;
      this.refresh();
    });
    for (const button of [this.toggle, this.collapseButton, this.reopen]) button.type = "button";
    this.toggle.addEventListener("click", () => {
      this.orientation = this.orientation === "player-up" ? "north-up" : "player-up";
      persist(ORIENTATION_KEY, this.orientation);
      this.updateText();
      this.lastPose = "";
      this.refresh();
    });
    this.collapseButton.addEventListener("click", () => this.collapse());
    this.reopen.addEventListener("click", () => this.show());
    controls.append(this.toggle, this.collapseButton);
    this.body.append(this.map, this.floorSelect, this.label, this.routeLabel, this.notice, controls);
    this.el.append(this.body, this.reopen);
    this.buildOverlay();
    this.applyCollapsed();
    this.updateText();
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  /** The expanded map: the same 2D walk-graph drawing as the HUD, shown full-screen on demand. */
  private buildOverlay(): void {
    this.overlay.className = "minimap-overlay";
    this.overlay.hidden = true;
    this.overlay.setAttribute("role", "dialog");
    this.overlay.setAttribute("aria-modal", "true");
    this.overlay.addEventListener("click", (event) => {
      if (event.target === this.overlay) this.closeOverlay();
    });
    this.overlayPanel.className = "minimap-overlay-panel";
    const header = document.createElement("div");
    header.className = "minimap-overlay-header";
    this.overlayTitle.className = "minimap-overlay-title";
    this.overlayClose.type = "button";
    this.overlayClose.className = "minimap-overlay-close";
    this.overlayClose.textContent = "×";
    this.overlayClose.addEventListener("click", () => this.closeOverlay());
    header.append(this.overlayTitle, this.overlayClose);
    this.overlayLabel.className = "minimap-overlay-label";
    this.overlayLabel.hidden = true;
    this.overlayNotice.className = "minimap-overlay-notice";
    const north = svg("text", { x: "95", y: "19", "text-anchor": "middle", class: "minimap-north" });
    north.textContent = "N";
    this.overlayNorth.append(north);
    this.overlayArrow.style.display = "none";
    this.overlayDestinationRim.style.display = "none";
    this.overlayMap.append(
      svg("rect", { x: "0", y: "0", width: "190", height: "190", class: "minimap-overlay-bg" }),
      this.overlayGraph, this.overlayRoute, this.overlayPoi, this.overlayDestinationRim, this.overlayNorth, this.overlayArrow,
    );
    this.overlayPanel.append(header, this.overlayMap, this.overlayLabel, this.overlayNotice);
    this.overlay.append(this.overlayPanel);
    document.body.append(this.overlay);
    document.addEventListener("keydown", this.overlayKeydown);
  }

  private openOverlay(): void {
    if (this.overlayOpen || this.el.hidden || this.collapsed || !this.bundle) return;
    const pose = this.getPose();
    if (!pose || pose.mode === "overview") return;
    this.overlayOpen = true;
    this.overlay.hidden = false;
    this.overlayDirty = true;
    // The HUD may be idle on an unchanged pose; force one full refresh so the overlay starts current.
    this.lastPose = "";
    this.refresh();
    this.overlayClose.focus();
  }

  private closeOverlay(restoreFocus = true): void {
    if (!this.overlayOpen) return;
    const hadFocus = this.overlay.contains(document.activeElement);
    this.overlayOpen = false;
    this.overlay.hidden = true;
    // An automatic dismissal (station switch, collapse, overview) must not drop focus to the body.
    if (restoreFocus || hadFocus) this.focusMapControl();
  }

  /** Hand focus back to whichever minimap control is on screen; overview leaves nothing to focus. */
  private focusMapControl(): void {
    if (this.el.hidden) return;
    (this.collapsed ? this.reopen : this.map).focus();
  }

  setStation(bundle: StationBundle | null, lang: Lang): void {
    this.bundle = bundle;
    this.lang = lang;
    this.floorId = undefined;
    // The floor list belongs to the station; a new station starts in follow mode with fresh options.
    this.pickedFloorId = null;
    this.floorOptionsKey = "";
    this.lastKnownFloor = undefined;
    this.lastPose = "";
    // A route belongs to the station it was computed in; never carry one across.
    this.route = null;
    this.steps = null;
    this.destination = null;
    this.destinationPoint = null;
    this.routeDirty = false;
    this.transitions = [];
    this.seg = 0;
    this.connectorHint = null;
    this.connectorDirty = true;
    this.labelKey = "";
    this.lastPosition = "";
    this.graph.replaceChildren();
    this.graph.removeAttribute("transform");
    this.routeGroup.replaceChildren();
    this.routeGroup.removeAttribute("transform");
    this.poiGroup.replaceChildren();
    this.poiGroup.removeAttribute("transform");
    this.hideMarkers();
    this.routeLabel.replaceChildren();
    this.routeLabel.hidden = true;
    this.arrow.style.display = "none";
    this.arrow.removeAttribute("transform");
    this.north.removeAttribute("transform");
    // The closed overlay keeps its old DOM untouched; the next open rebuilds it from this state.
    this.el.hidden = true;
    this.updateText();
    this.syncTimer();
    this.refresh();
    // Dismiss after the new visibility is settled, so a focused overlay hands off to a shown control.
    this.closeOverlay(false);
  }

  /**
   * The computed route (`routePolyline` + `best.steps`) and its destination. Called after every
   * `computeRoute()`; null clears. Points and steps only make sense together — a point's stepIndex
   * is checked against the steps — so they arrive as one object or not at all. Only evidenced
   * geometry is ever drawn: the route's own polyline on this floor, and the current floor's
   * routable POIs.
   */
  setRoute(route: { points: PolylinePoint[]; steps: RouteStep[] } | null, destination: Poi | null): void {
    const points = route && route.points.length >= 2 ? route.points : null;
    this.route = points;
    this.steps = points && route ? route.steps : null;
    this.destination = destination;
    this.transitions = points && route ? floorTransitions(points, route.steps) : [];
    this.destinationPoint = null;
    this.seg = 0;
    // An unknown floor leaves refresh() without a hint to recompute, so the old route's must go now.
    this.connectorHint = null;
    this.connectorDirty = true;
    this.labelKey = "";
    this.routeDirty = true;
    this.overlayDirty = true;
    this.lastPose = "";
    this.lastPosition = "";
    this.refresh();
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.updateText();
    this.routeDirty = true;
    this.overlayDirty = true;
    this.lastPose = "";
    this.refresh();
  }

  show(): void { this.setCollapsed(false); }
  collapse(): void { this.setCollapsed(true); }

  /**
   * Re-evaluate whether the map belongs on screen, outside the polling timer. A collapsed map keeps no timer,
   * so a mode change (overview -> walk/guide) is the only thing that can bring its reopen button back.
   */
  syncVisibility(): void {
    this.refresh();
  }

  dispose(): void {
    this.disposed = true;
    this.closeOverlay(false);
    this.syncTimer();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    document.removeEventListener("keydown", this.overlayKeydown);
    this.el.remove();
    this.overlay.remove();
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    persist(COLLAPSED_KEY, String(collapsed));
    this.applyCollapsed();
    // After the state change, so a dismissal hands focus to the control still on screen (reopen).
    if (collapsed) this.closeOverlay(false);
    this.lastPose = "";
    this.syncTimer();
    this.refresh();
  }

  private applyCollapsed(): void {
    this.el.dataset.collapsed = String(this.collapsed);
    this.body.hidden = this.collapsed;
    this.reopen.hidden = !this.collapsed;
  }

  private syncTimer(): void {
    const running = !this.disposed && !!this.bundle && !this.collapsed && !document.hidden;
    if (!running && this.timer !== null) { clearInterval(this.timer); this.timer = null; }
    if (running && this.timer === null) this.timer = setInterval(() => this.refresh(), 1000 / 12);
  }

  private updateText(): void {
    const t = strings(this.lang);
    this.el.setAttribute("aria-label", t.minimap);
    this.floorSelect.setAttribute("aria-label", t.minimapFloor);
    this.notice.textContent = t.minimapSchematic;
    this.map.setAttribute("aria-label", t.minimapExpand);
    // A stable toggle name: pressed means north is fixed up.
    this.toggle.textContent = t.minimapNorthUp;
    this.toggle.setAttribute("aria-label", t.minimapNorthUp);
    this.toggle.setAttribute("aria-pressed", String(this.orientation === "north-up"));
    this.toggle.title = this.orientation === "player-up" ? t.minimapPlayerUp : t.minimapNorthUp;
    this.collapseButton.textContent = "−";
    this.collapseButton.setAttribute("aria-label", t.minimapCollapse);
    this.reopen.textContent = t.minimapShow;
    const station = this.bundle?.station;
    const floor = this.bundle?.floors.find((f) => f.id === this.floorId);
    this.label.replaceChildren();
    if (station) {
      const name = document.createElement("span"), level = document.createElement("strong");
      name.textContent = `${station.id} · ${pick(station.names, this.lang)}`;
      name.title = name.textContent;
      level.textContent = floor ? floorDisplayName(floor, this.lang) : t.minimapFloorUnknown;
      this.label.append(name, level);
    }
    this.syncFloorOptions();
  }

  /** The picker's choices: follow, then the station's own floors in bundle order. Rebuilt only per station/language. */
  private syncFloorOptions(): void {
    const key = `${this.bundle?.station.id ?? ""}|${this.lang}`;
    if (key === this.floorOptionsKey) return;
    this.floorOptionsKey = key;
    const t = strings(this.lang);
    const follow = document.createElement("option");
    follow.value = "";
    follow.textContent = t.minimapFloorFollow;
    const floors = this.bundle?.floors.map((floor) => {
      const option = document.createElement("option");
      option.value = floor.id;
      option.textContent = floorDisplayName(floor, this.lang);
      return option;
    }) ?? [];
    this.floorSelect.replaceChildren(follow, ...floors);
    this.floorSelect.value = this.pickedFloorId ?? "";
    this.floorSelect.hidden = !this.bundle;
  }

  private refresh(): void {
    if (this.disposed || document.hidden) return;
    const pose = this.bundle ? this.getPose() : null;
    const visible = !!pose && pose.mode !== "overview";
    if (this.el.hidden === visible) this.el.hidden = !visible;
    if (!visible || !pose || !this.bundle || this.collapsed) { this.closeOverlay(false); return; }
    const pick = this.pickedFloorId;
    const key = `${pose.east},${pose.north},${pose.up},${pose.headingDeg},${pose.mode},${this.orientation},${pick}`;
    if (key === this.lastPose) return;
    this.lastPose = key;
    const playerFloorId = currentFloorId(this.bundle, pose.up, pose.east, pose.north);
    // Follow mode draws the player's floor; a picked floor replaces it until follow is chosen again.
    const drawnFloorId = this.pickedFloorId ?? playerFloorId;
    const floorChanged = drawnFloorId !== this.floorId;
    if (floorChanged) {
      this.floorId = drawnFloorId;
      this.overlayDirty = true;
      this.drawFloorGraph();
      this.arrow.style.display = drawnFloorId === null ? "none" : "";
      this.updateText();
    }
    // Progress crosses floors only on a known-to-known change. First acquisition (undefined → F)
    // and a reading that dips to null mid-stairs are not floor changes; while the floor is unknown
    // neither seg nor the hint moves, so nothing can jump ahead and be impossible to undo.
    const progressFloorChanged = playerFloorId !== null && this.lastKnownFloor !== undefined && playerFloorId !== this.lastKnownFloor;
    if (playerFloorId !== null) this.lastKnownFloor = playerFloorId;
    if (playerFloorId) {
      // Progress only advances, and only on a new position, floor or route — a turn alone changes
      // nothing. The hint is the first floor change whose start is at or after the current segment.
      const position = `${pose.east},${pose.north},${pose.up}`;
      const moved = position !== this.lastPosition;
      this.lastPosition = position;
      // A picked floor changes what is drawn, not where the player is on the route: only a progress
      // change may advance the segment, while a floor change still refreshes that floor's hint.
      const progressDirty = progressFloorChanged || this.connectorDirty || moved;
      if (progressDirty && this.route) {
        this.seg = advanceRouteSeg(this.route, this.steps ?? [], playerFloorId, pose.east, pose.north, this.seg, progressFloorChanged);
      }
      if (floorChanged || progressDirty) {
        this.updateConnectorHint();
        this.renderLabel();
        this.connectorDirty = false;
      }
    } else if (floorChanged && this.floorId !== null) {
      // The player's floor is unknown, but a picked floor still has its own next floor change.
      this.updateConnectorHint();
      this.renderLabel();
    }
    // Route runs and POIs change only with the route or the floor — never per tick.
    if (floorChanged || this.routeDirty) {
      this.routeDirty = false;
      this.drawFloorLayers();
    }
    const rotation = this.orientation === "player-up" ? -pose.headingDeg : 0;
    const transform = `translate(${CENTRE} ${CENTRE}) rotate(${rotation}) translate(${-pose.east / METRES_PER_PX} ${pose.north / METRES_PER_PX})`;
    this.graph.setAttribute("transform", transform);
    if (this.routeGroup.getAttribute("transform") !== transform) this.routeGroup.setAttribute("transform", transform);
    if (this.poiGroup.getAttribute("transform") !== transform) this.poiGroup.setAttribute("transform", transform);
    setTransform(this.arrow, `translate(${CENTRE} ${CENTRE}) rotate(${arrowRotationDeg(pose, this.orientation)})`);
    const northTransform = `rotate(${rotation} ${CENTRE} ${CENTRE})`;
    if (this.north.getAttribute("transform") !== northTransform) this.north.setAttribute("transform", northTransform);
    this.updateMarkers(pose);
    // Nothing of the overlay is touched while it is closed: no timer of its own, no hidden writes.
    if (this.overlayOpen) this.renderOverlay(pose);
  }

  /** The drawn floor's walk graph, in north-up station coordinates; movement only changes the group transform. */
  private drawFloorGraph(): void {
    const floorId = this.floorId;
    const segments = floorId && this.bundle ? floorWalkGraph(this.bundle, floorId) : [];
    const origin: ExplorerPose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
    this.graph.replaceChildren(...segments.map((segment) => svg("polyline", {
      "data-mode": segment.mode,
      points: segment.points.map((point) => {
        const p = toMinimap(point.east, point.north, origin, "north-up", METRES_PER_PX);
        return `${p.x},${p.y}`;
      }).join(" "),
    })));
  }

  /** The next floor change ahead of the route progress, on the floor the map is drawing. */
  private updateConnectorHint(): void {
    this.connectorHint = this.transitions.find((t) => t.fromFloorId === this.floorId && t.startIndex >= this.seg) ?? null;
  }

  /** Draw what the current floor evidences, in station coordinates: the route runs and the routable POIs. */
  private drawFloorLayers(): void {
    const t = strings(this.lang);
    this.routeGroup.replaceChildren();
    this.poiGroup.replaceChildren();
    this.destinationPoint = null;
    const floorId = this.floorId;
    const route = this.route;
    if (!floorId || !this.bundle) {
      this.renderLabel();
      return;
    }
    const origin: ExplorerPose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
    for (const run of route ? routeOnFloor(route, floorId, this.steps ?? []) : []) {
      this.routeGroup.append(svg("polyline", {
        class: "minimap-route-line",
        points: run.map((point) => {
          const p = toMinimap(point.x, point.y, origin, "north-up", METRES_PER_PX);
          return `${p.x},${p.y}`;
        }).join(" "),
      }));
    }
    // A POI earns a dot, and the destination's highlight, only through the same evidence rule.
    for (const poi of floorPois(this.bundle, floorId)) {
      const p = toMinimap(poi.displayPosition!.x, poi.displayPosition!.y, origin, "north-up", METRES_PER_PX);
      const dot = svg("circle", { cx: String(p.x), cy: String(p.y), r: "2.5", class: "minimap-poi", "data-category": poi.category });
      if (poi.id === this.destination?.id) {
        dot.classList.add("is-destination");
        this.destinationPoint = { x: poi.displayPosition!.x, y: poi.displayPosition!.y };
      }
      const title = svg("title");
      title.textContent = poiLabel(this.bundle, poi, this.lang, t);
      dot.append(title);
      this.poiGroup.append(dot);
    }
    this.renderLabel();
  }

  /** The label-strip lines (destination floor, next floor change), shared by the HUD and the large map. */
  private labelLines(): string[] {
    const t = strings(this.lang);
    const route = this.route;
    const last = route && route.length > 0 ? route[route.length - 1]! : null;
    const lines: string[] = [];
    if (this.destination && route && this.floorId) {
      const destinationFloorId = this.destinationFloorId(last);
      if (destinationFloorId && destinationFloorId !== this.floorId) lines.push(t.minimapDestination(this.floorName(destinationFloorId)));
    }
    if (this.connectorHint) {
      lines.push(t.minimapNextFloor(this.floorName(this.connectorHint.toFloorId), t.minimapMode[this.connectorHint.mode]));
    }
    return lines;
  }

  /** The two label-strip lines (destination floor, next floor change); rewritten only when they change. */
  private renderLabel(): void {
    const lines = this.labelLines();
    const key = `${this.lang}|${this.floorId}|${lines.join("\n")}`;
    if (key === this.labelKey) return;
    this.labelKey = key;
    this.overlayDirty = true;
    this.routeLabel.replaceChildren(...lines.map((line) => {
      const div = document.createElement("div");
      div.textContent = line;
      return div;
    }));
    this.routeLabel.hidden = lines.length === 0;
    if (this.connectorHint) {
      this.connectorTitle.textContent = lines[lines.length - 1]!;
      this.connectorGlyph.setAttribute("d", CONNECTOR_GLYPHS[this.connectorHint.mode] ?? CONNECTOR_GLYPHS.walk!);
    }
  }

  /**
   * The expanded map, drawn from the same walk graph, route runs and evidenced POIs as the HUD (same
   * station coordinates and 95 m span, just rendered at full width). Geometry is rebuilt only when the
   * floor, route, language or hint changes; each tick moves the world groups. Called only while open.
   */
  private renderOverlay(pose: ExplorerPose): void {
    const t = strings(this.lang);
    const floorId = this.floorId;
    const origin: ExplorerPose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
    if (this.overlayDirty) {
      this.overlayDirty = false;
      const segments = floorId && this.bundle ? floorWalkGraph(this.bundle, floorId) : [];
      this.overlayGraph.replaceChildren(...segments.map((segment) => svg("polyline", {
        "data-mode": segment.mode,
        points: segment.points.map((point) => {
          const p = toMinimap(point.east, point.north, origin, "north-up", METRES_PER_PX);
          return `${p.x},${p.y}`;
        }).join(" "),
      })));
      this.overlayRoute.replaceChildren();
      this.overlayPoi.replaceChildren();
      if (floorId && this.bundle) {
        for (const run of this.route ? routeOnFloor(this.route, floorId, this.steps ?? []) : []) {
          this.overlayRoute.append(svg("polyline", {
            class: "minimap-route-line",
            points: run.map((point) => {
              const p = toMinimap(point.x, point.y, origin, "north-up", METRES_PER_PX);
              return `${p.x},${p.y}`;
            }).join(" "),
          }));
        }
        for (const poi of floorPois(this.bundle, floorId)) {
          const p = toMinimap(poi.displayPosition!.x, poi.displayPosition!.y, origin, "north-up", METRES_PER_PX);
          const dot = svg("circle", { cx: String(p.x), cy: String(p.y), r: "2.5", class: "minimap-poi", "data-category": poi.category });
          if (poi.id === this.destination?.id) dot.classList.add("is-destination");
          const title = svg("title");
          title.textContent = poiLabel(this.bundle, poi, this.lang, t);
          dot.append(title);
          this.overlayPoi.append(dot);
        }
        const last = this.route && this.route.length > 0 ? this.route[this.route.length - 1]! : null;
        if (last && last.floorId === floorId) {
          const p = toMinimap(last.x, last.y, origin, "north-up", METRES_PER_PX);
          this.overlayRoute.append(svg("circle", { cx: String(p.x), cy: String(p.y), r: "3", class: "minimap-route-end-dot" }));
        }
      }
      // Overlay text is written only here, so a closed overlay receives no writes at all.
      this.overlay.setAttribute("aria-label", t.minimapLargeMap);
      this.overlayMap.setAttribute("aria-label", t.minimapLargeMap);
      this.overlayClose.setAttribute("aria-label", t.minimapClose);
      this.overlayClose.title = t.minimapClose;
      this.overlayNotice.textContent = t.minimapSchematic;
      const lines = this.labelLines();
      this.overlayLabel.replaceChildren(...lines.map((line) => {
        const div = document.createElement("div");
        div.textContent = line;
        return div;
      }));
      this.overlayLabel.hidden = lines.length === 0;
      this.overlayArrow.style.display = floorId === null || !this.bundle ? "none" : "";
      const station = this.bundle?.station;
      const floor = this.bundle?.floors.find((f) => f.id === this.floorId);
      this.overlayTitle.textContent = station
        ? `${station.id} · ${pick(station.names, this.lang)} — ${floor ? floorDisplayName(floor, this.lang) : t.minimapFloorUnknown}`
        : t.minimapLargeMap;
    }
    const rotation = this.orientation === "player-up" ? -pose.headingDeg : 0;
    const transform = `translate(${CENTRE} ${CENTRE}) rotate(${rotation}) translate(${-pose.east / METRES_PER_PX} ${pose.north / METRES_PER_PX})`;
    setTransform(this.overlayGraph, transform);
    setTransform(this.overlayRoute, transform);
    setTransform(this.overlayPoi, transform);
    setTransform(this.overlayArrow, `translate(${CENTRE} ${CENTRE}) rotate(${arrowRotationDeg(pose, this.orientation)})`);
    setTransform(this.overlayNorth, `rotate(${rotation} ${CENTRE} ${CENTRE})`);
    // The destination keeps a marker even when its point lies beyond the drawn 95 m span.
    const route = this.route;
    const last = route && route.length > 0 ? route[route.length - 1]! : null;
    const routeEnd = floorId && last && last.floorId === floorId
      ? toMinimap(last.x, last.y, pose, this.orientation, METRES_PER_PX)
      : null;
    const destination = this.destinationPoint
      ? toMinimap(this.destinationPoint.x, this.destinationPoint.y, pose, this.orientation, METRES_PER_PX)
      : null;
    this.placeRim(this.overlayDestinationRim, destination ?? routeEnd, "square");
  }

  /** Per-tick marker positions: inside the circle at the point, or a rim chevron at its bearing. */
  private updateMarkers(pose: ExplorerPose): void {
    const floorId = this.floorId;
    const route = this.route;
    const last = route && route.length > 0 ? route[route.length - 1]! : null;
    const routeEnd = floorId && last && last.floorId === floorId ? last : null;
    const endScreen = routeEnd ? toMinimap(routeEnd.x, routeEnd.y, pose, this.orientation, METRES_PER_PX) : null;
    // Rim arrow: an evidenced POI position wins; otherwise the route's own end. Both are on this floor.
    const poiPoint = this.destinationPoint;
    const rimTarget = poiPoint
      ? toMinimap(poiPoint.x, poiPoint.y, pose, this.orientation, METRES_PER_PX)
      : endScreen;
    this.placeRim(this.destinationRim, rimTarget);
    // The neutral route-end dot is not a POI and carries no destination meaning; it yields to the
    // highlighted destination dot when they coincide.
    const coincident = !!poiPoint && !!routeEnd && Math.hypot(poiPoint.x - routeEnd.x, poiPoint.y - routeEnd.y) < 0.5;
    this.placeMarker(this.routeEnd, endScreen, coincident);
    const hint = this.connectorHint;
    const connectorScreen = hint ? toMinimap(hint.x, hint.y, pose, this.orientation, METRES_PER_PX) : null;
    this.placeMarker(this.connectorMarker, connectorScreen, false);
    // The connector marker only exists inside the circle; outside, the same rim chevron takes over.
    this.placeRim(this.connectorRim, connectorScreen);
  }

  private placeMarker(marker: SVGElement, at: { x: number; y: number } | null, forceHide: boolean): void {
    if (!at || forceHide || !rimBearing(at, RIM_RADIUS).inside) {
      setDisplay(marker, "none");
      return;
    }
    setDisplay(marker, "");
    setTransform(marker, `translate(${Math.round(CENTRE + at.x)} ${Math.round(CENTRE + at.y)})`);
  }

  /**
   * The edge chevron for a target beyond the drawn span. The HUD is a circle (clip and rim); the large
   * map fills a square, so a target near a corner is on screen there and earns no chevron.
   */
  private placeRim(rim: SVGElement, at: { x: number; y: number } | null, bounds: "circle" | "square" = "circle"): void {
    if (!at) {
      setDisplay(rim, "none");
      return;
    }
    const bearing = rimBearing(at, RIM_RADIUS);
    const inside = bounds === "square"
      ? Math.abs(at.x) <= RIM_MARKER_RADIUS && Math.abs(at.y) <= RIM_MARKER_RADIUS
      : bearing.inside;
    if (inside) {
      setDisplay(rim, "none");
      return;
    }
    setDisplay(rim, "");
    const radians = bearing.angleDeg * Math.PI / 180;
    // Square: one scale for both axes keeps the chevron on the edge along its true bearing.
    const scale = RIM_MARKER_RADIUS / Math.max(Math.abs(at.x), Math.abs(at.y));
    const x = CENTRE + (bounds === "square" ? at.x * scale : Math.sin(radians) * RIM_MARKER_RADIUS);
    const y = CENTRE + (bounds === "square" ? at.y * scale : -Math.cos(radians) * RIM_MARKER_RADIUS);
    setTransform(rim, `translate(${Math.round(x)} ${Math.round(y)}) rotate(${Math.round(bearing.angleDeg)})`);
  }

  private hideMarkers(): void {
    for (const marker of [this.routeEnd, this.destinationRim, this.connectorMarker, this.connectorRim]) setDisplay(marker, "none");
  }

  private floorName(floorId: string): string {
    return floorDisplayName(this.bundle?.floors.find((floor) => floor.id === floorId), this.lang);
  }

  /** The floor the destination is recorded on; with none recorded, the route's own last point is the evidence. */
  private destinationFloorId(last: PolylinePoint | null): string | null {
    return this.destination?.floorId ?? last?.floorId ?? null;
  }
}

function setDisplay(element: Element, value: string): void {
  if ((element as SVGElement).style.display !== value) (element as SVGElement).style.display = value;
}

function setTransform(element: Element, value: string): void {
  if (element.getAttribute("transform") !== value) element.setAttribute("transform", value);
}
