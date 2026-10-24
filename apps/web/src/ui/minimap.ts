import { floorDisplayName } from "@gteki/navigation";
import type { StationBundle } from "@gteki/schema";
import type { ExplorerPose } from "../explorer/explorer.ts";
import { pick, strings, type Lang } from "../i18n.ts";
import { arrowRotationDeg, currentFloorId, floorWalkGraph, toMinimap, type MinimapOrientation } from "./minimapGeometry.ts";

const ORIENTATION_KEY = "gteki.minimap.orientation";
const COLLAPSED_KEY = "gteki.minimap.collapsed";
const METRES_PER_PX = 0.5;
const CENTRE = 95; // Fixed viewBox: mobile shows the same 95 m span as desktop.
let nextClipId = 0;

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
  private readonly arrow = svg("path", { class: "minimap-arrow", d: "M 0,-10 L 7,8 L 0,4 L -7,8 Z" });
  private readonly north = svg("g");
  private bundle: StationBundle | null = null;
  private lang: Lang = "ja";
  private orientation: MinimapOrientation = read(ORIENTATION_KEY) === "north-up" ? "north-up" : "player-up";
  private collapsed = read(COLLAPSED_KEY) === "true";
  private floorId: string | null | undefined;
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
    clipped.append(this.graph);
    const n = svg("text", { x: "95", y: "19", "text-anchor": "middle", class: "minimap-north" });
    n.textContent = "N";
    this.north.append(n);
    map.append(defs, svg("circle", { cx: "95", cy: "95", r: "93", class: "minimap-rim" }), clipped, this.north, this.arrow);
    this.arrow.style.display = "none";
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
    this.body.append(map, this.label, this.notice, controls);
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
    this.graph.replaceChildren();
    this.graph.removeAttribute("transform");
    this.arrow.style.display = "none";
    this.arrow.removeAttribute("transform");
    this.north.removeAttribute("transform");
    this.el.hidden = true;
    this.updateText();
    this.syncTimer();
    this.refresh();
  }

  setLang(lang: Lang): void {
    this.lang = lang;
    this.updateText();
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
    if (floorId !== this.floorId) {
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
    const rotation = this.orientation === "player-up" ? -pose.headingDeg : 0;
    this.graph.setAttribute("transform", `translate(${CENTRE} ${CENTRE}) rotate(${rotation}) translate(${-pose.east / METRES_PER_PX} ${pose.north / METRES_PER_PX})`);
    this.arrow.setAttribute("transform", `translate(${CENTRE} ${CENTRE}) rotate(${arrowRotationDeg(pose, this.orientation)})`);
    const northTransform = `rotate(${rotation} ${CENTRE} ${CENTRE})`;
    if (this.north.getAttribute("transform") !== northTransform) this.north.setAttribute("transform", northTransform);
  }
}
