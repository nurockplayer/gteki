import { floorDisplayName } from "@gteki/navigation";
import type { PolylinePoint, RouteStep } from "@gteki/navigation";
import type { Poi, StationBundle } from "@gteki/schema";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { pick, strings, type Lang } from "../i18n.ts";
import { poiLabel } from "./labels.ts";
import { arrowRotationDeg, currentFloorId, floorPois, floorWalkGraph, nextFloorChange, rimBearing, routeOnFloor, toMinimap, type MinimapOrientation } from "./minimapGeometry.ts";

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
  private readonly destinationMarker = svg("g", { class: "minimap-destination-marker" });
  private readonly destinationTitle = svg("title");
  private readonly destinationRim = svg("path", { class: "minimap-rim-marker minimap-destination-rim", d: "M 0,-6 L 5,4 L -5,4 Z" });
  private readonly connectorMarker = svg("g", { class: "minimap-connector-marker" });
  private readonly connectorGlyph = svg("path", { class: "minimap-connector-glyph" });
  private readonly connectorRim = svg("path", { class: "minimap-rim-marker minimap-connector-rim", d: "M 0,-6 L 5,4 L -5,4 Z" });
  private readonly connectorTitle = svg("title");
  private readonly routeLabel = document.createElement("div");
  private readonly arrow = svg("path", { class: "minimap-arrow", d: "M 0,-10 L 7,8 L 0,4 L -7,8 Z" });
  private readonly north = svg("g");
  private bundle: StationBundle | null = null;
  private lang: Lang = "ja";
  private orientation: MinimapOrientation = read(ORIENTATION_KEY) === "north-up" ? "north-up" : "player-up";
  private collapsed = read(COLLAPSED_KEY) === "true";
  private floorId: string | null | undefined;
  private route: PolylinePoint[] | null = null;
  private steps: RouteStep[] | null = null;
  private destination: Poi | null = null;
  private routeDirty = false;
  private lastPose = "";
  private timer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;
  private readonly visibilityChanged = () => {
    this.syncTimer();
    if (!document.hidden && !this.collapsed) this.refresh();
  };

  constructor(private readonly getPose: () => ExplorerPose | null) {
    this.el.className = "minimap";
    this.el.hidden = true;
    this.body.className = "minimap-body";
    this.label.className = "minimap-label";
    this.notice.className = "minimap-notice";
    const map = svg("svg", { class: "minimap-map", viewBox: "0 0 190 190", "aria-hidden": "true" });
    const clipId = `minimap-clip-${++nextClipId}`;
    const defs = svg("defs"), clip = svg("clipPath", { id: clipId });
    clip.append(svg("circle", { cx: "95", cy: "95", r: "92" }));
    defs.append(clip);
    const clipped = svg("g", { "clip-path": `url(#${clipId})` });
    this.destinationMarker.append(svg("circle", { r: "4.5", class: "minimap-destination-dot" }), this.destinationTitle);
    this.connectorMarker.append(this.connectorGlyph, this.connectorTitle);
    this.markerGroup.append(this.destinationMarker, this.destinationRim, this.connectorMarker, this.connectorRim);
    for (const marker of [this.destinationMarker, this.destinationRim, this.connectorMarker, this.connectorRim]) marker.style.display = "none";
    // Route and POIs share the walk graph's rotated/translated world; markers stay in screen space.
    clipped.append(this.graph, this.routeGroup, this.poiGroup, this.markerGroup);
    const n = svg("text", { x: "95", y: "19", "text-anchor": "middle", class: "minimap-north" });
    n.textContent = "N";
    this.north.append(n);
    map.append(defs, svg("circle", { cx: "95", cy: "95", r: "93", class: "minimap-rim" }), clipped, this.north, this.arrow);
    this.arrow.style.display = "none";
    this.routeLabel.className = "minimap-route-label";
    this.routeLabel.hidden = true;
    const controls = document.createElement("div");
    controls.className = "minimap-controls";
    this.toggle.className = "minimap-orientation";
    this.collapseButton.className = "minimap-collapse";
    this.reopen.className = "minimap-reopen";
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
    this.body.append(map, this.label, this.routeLabel, this.notice, controls);
    this.el.append(this.body, this.reopen);
    this.applyCollapsed();
    this.updateText();
    document.addEventListener("visibilitychange", this.visibilityChanged);
  }

  setStation(bundle: StationBundle | null, lang: Lang): void {
    this.bundle = bundle;
    this.lang = lang;
    this.floorId = undefined;
    this.lastPose = "";
    // A route belongs to the station it was computed in; never carry one across.
    this.route = null;
    this.steps = null;
    this.destination = null;
    this.routeDirty = false;
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
    this.el.hidden = true;
    this.updateText();
    this.syncTimer();
    this.refresh();
  }

  /**
   * The computed route (`routePolyline` + `best.steps`) and its destination. Called after every
   * `computeRoute()`; null/empty clears. Only evidenced geometry is ever drawn: the route's own
   * polyline on this floor, and the current floor's routable POIs.
   */
  setRoute(points: PolylinePoint[] | null, steps: RouteStep[] | null, destination: Poi | null): void {
    this.route = points && points.length >= 2 ? points : null;
    this.steps = steps;
    this.destination = destination;
    this.routeDirty = true;
    this.lastPose = "";
    this.refresh();
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.updateText();
    this.routeDirty = true;
    this.lastPose = "";
    this.refresh();
  }

  show(): void { this.setCollapsed(false); }
  collapse(): void { this.setCollapsed(true); }

  dispose(): void {
    this.disposed = true;
    this.syncTimer();
    document.removeEventListener("visibilitychange", this.visibilityChanged);
    this.el.remove();
  }

  private setCollapsed(collapsed: boolean): void {
    this.collapsed = collapsed;
    persist(COLLAPSED_KEY, String(collapsed));
    this.applyCollapsed();
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
    this.notice.textContent = t.minimapSchematic;
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
  }

  private refresh(): void {
    if (this.disposed || document.hidden) return;
    const pose = this.bundle ? this.getPose() : null;
    const visible = !!pose && pose.mode !== "overview";
    if (this.el.hidden === visible) this.el.hidden = !visible;
    if (!visible || !pose || !this.bundle || this.collapsed) return;
    const key = `${pose.east},${pose.north},${pose.up},${pose.headingDeg},${pose.mode},${this.orientation}`;
    if (key === this.lastPose) return;
    this.lastPose = key;
    const floorId = currentFloorId(this.bundle, pose.up, pose.east, pose.north);
    const floorChanged = floorId !== this.floorId;
    if (floorChanged) {
      this.floorId = floorId;
      const segments = floorId === null ? [] : floorWalkGraph(this.bundle, floorId);
      // Paths stay in north-up station coordinates; movement only changes the group transform.
      const origin: ExplorerPose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
      this.graph.replaceChildren(...segments.map((segment) => svg("polyline", {
        "data-mode": segment.mode,
        points: segment.points.map((point) => {
          const p = toMinimap(point.east, point.north, origin, "north-up", METRES_PER_PX);
          return `${p.x},${p.y}`;
        }).join(" "),
      })));
      this.arrow.style.display = floorId === null ? "none" : "";
      this.updateText();
    }
    // Route runs, POIs and the label strip change only with the route or the floor — never per tick.
    if (floorChanged || this.routeDirty) {
      this.routeDirty = false;
      this.drawFloorLayers();
    }
    const rotation = this.orientation === "player-up" ? -pose.headingDeg : 0;
    const transform = `translate(${CENTRE} ${CENTRE}) rotate(${rotation}) translate(${-pose.east / METRES_PER_PX} ${pose.north / METRES_PER_PX})`;
    this.graph.setAttribute("transform", transform);
    if (this.routeGroup.getAttribute("transform") !== transform) this.routeGroup.setAttribute("transform", transform);
    if (this.poiGroup.getAttribute("transform") !== transform) this.poiGroup.setAttribute("transform", transform);
    this.arrow.setAttribute("transform", `translate(${CENTRE} ${CENTRE}) rotate(${arrowRotationDeg(pose, this.orientation)})`);
    const northTransform = `rotate(${rotation} ${CENTRE} ${CENTRE})`;
    if (this.north.getAttribute("transform") !== northTransform) this.north.setAttribute("transform", northTransform);
    this.updateMarkers(pose);
  }

  /** Draw what the current floor evidences, in station coordinates: the route runs and the routable POIs. */
  private drawFloorLayers(): void {
    const t = strings(this.lang);
    this.routeGroup.replaceChildren();
    this.poiGroup.replaceChildren();
    this.routeLabel.replaceChildren();
    const floorId = this.floorId;
    const route = this.route;
    if (!floorId || !this.bundle) {
      this.routeLabel.hidden = true;
      this.hideMarkers();
      return;
    }
    const origin: ExplorerPose = { east: 0, north: 0, up: 0, headingDeg: 0, mode: "walk" };
    for (const run of route ? routeOnFloor(route, floorId) : []) {
      this.routeGroup.append(svg("polyline", {
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
      this.poiGroup.append(dot);
    }

    const lines: string[] = [];
    const destination = this.destination;
    const last = route && route.length > 0 ? route[route.length - 1]! : null;
    const destinationFloorId = this.destinationFloorId(last);
    if (destination && route && destinationFloorId && destinationFloorId !== floorId) {
      lines.push(t.minimapDestination(this.floorName(destinationFloorId)));
    }
    const change = route && this.steps && floorId ? nextFloorChange(route, this.steps, floorId) : null;
    if (change) {
      const text = t.minimapNextFloor(this.floorName(change.toFloorId), t.minimapMode[change.mode]);
      lines.push(text);
      this.connectorTitle.textContent = text;
      this.connectorGlyph.setAttribute("d", CONNECTOR_GLYPHS[change.mode] ?? CONNECTOR_GLYPHS.walk!);
    }
    if (destination && route && last && last.floorId === floorId && destinationFloorId === floorId) {
      this.destinationTitle.textContent = poiLabel(this.bundle, destination, this.lang, t);
    }
    for (const line of lines) {
      const div = document.createElement("div");
      div.textContent = line;
      this.routeLabel.append(div);
    }
    this.routeLabel.hidden = lines.length === 0;
    if (!route) this.hideMarkers();
  }

  /** Per-tick marker positions: inside the circle at the point, or a rim chevron at its bearing. */
  private updateMarkers(pose: ExplorerPose): void {
    const floorId = this.floorId;
    const route = this.route;
    const last = route && route.length > 0 ? route[route.length - 1]! : null;
    let destination: { x: number; y: number; inside: boolean; angleDeg: number } | null = null;
    const destinationFloorId = this.destinationFloorId(last);
    if (this.destination && floorId && last && last.floorId === floorId && destinationFloorId === floorId) {
      const p = toMinimap(last.x, last.y, pose, this.orientation, METRES_PER_PX);
      destination = { ...p, ...rimBearing(p, RIM_RADIUS) };
    }
    this.placeMarker(this.destinationMarker, this.destinationRim, destination);
    const change = route && this.steps && floorId ? nextFloorChange(route, this.steps, floorId) : null;
    let connector: { x: number; y: number; inside: boolean; angleDeg: number } | null = null;
    if (change) {
      const p = toMinimap(change.x, change.y, pose, this.orientation, METRES_PER_PX);
      connector = { ...p, ...rimBearing(p, RIM_RADIUS) };
    }
    this.placeMarker(this.connectorMarker, this.connectorRim, connector);
  }

  private placeMarker(marker: SVGElement, rim: SVGElement, at: { x: number; y: number; inside: boolean; angleDeg: number } | null): void {
    if (!at) {
      setDisplay(marker, "none");
      setDisplay(rim, "none");
      return;
    }
    if (at.inside) {
      setDisplay(rim, "none");
      setDisplay(marker, "");
      setTransform(marker, `translate(${Math.round(CENTRE + at.x)} ${Math.round(CENTRE + at.y)})`);
      return;
    }
    setDisplay(marker, "none");
    setDisplay(rim, "");
    const radians = at.angleDeg * Math.PI / 180;
    const x = CENTRE + Math.sin(radians) * RIM_MARKER_RADIUS;
    const y = CENTRE - Math.cos(radians) * RIM_MARKER_RADIUS;
    setTransform(rim, `translate(${Math.round(x)} ${Math.round(y)}) rotate(${Math.round(at.angleDeg)})`);
  }

  private hideMarkers(): void {
    for (const marker of [this.destinationMarker, this.destinationRim, this.connectorMarker, this.connectorRim]) setDisplay(marker, "none");
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
