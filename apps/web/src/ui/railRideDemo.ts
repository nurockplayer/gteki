/**
 * Visually playable cross-station ride cutscene. Explicitly DEMO: no verified JR
 * boarding platform exists in either currently rendered station scene.
 * No physics or pedestrian-graph links are invented.
 */
import * as THREE from "three";
import type { RailDemoLink } from "./railTravel.ts";
import { railStationName } from "./railTravel.ts";

type Stage = "boarding" | "moving" | "loading" | "arrived" | "error";

export class RailRideDemo {
  private readonly root = document.createElement("section");
  private readonly renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "low-power" });
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(69, 1, 0.08, 120);
  private readonly stageTitle = document.createElement("p");
  private readonly stageMessage = document.createElement("p");
  private readonly action = document.createElement("button");
  private readonly cancelButton = document.createElement("button");
  private readonly progress = document.createElement("div");
  private readonly railLights: THREE.Object3D[] = [];
  private frameId = 0;
  private lastTime = 0;
  private rideTime = 0;
  private closed = false;
  private stage: Stage = "boarding";
  private readonly previousInert = new Map<HTMLElement, boolean>();
  private readonly focusBefore: HTMLElement | null = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  private readonly motionQuery = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : null;
  private reduceMotion = this.motionQuery?.matches ?? false;

  constructor(
    private readonly host: HTMLElement,
    private readonly link: RailDemoLink,
    private readonly lang: "ja" | "en",
    private readonly onArrival: () => Promise<boolean>,
    private readonly onClose: () => void,
  ) {
    const ja = lang === "ja";
    const from = railStationName(link.from, lang);
    const to = railStationName(link.to, lang);
    this.root.className = "rail-ride";
    this.root.setAttribute("role", "dialog");
    this.root.setAttribute("aria-modal", "true");
    this.root.setAttribute("aria-label", ja ? "埼京線 乗車デモ" : "Saikyo Line ride demo");
    this.root.tabIndex = -1;
    this.scene.background = new THREE.Color("#0d141e");
    this.scene.fog = new THREE.Fog("#0d141e", 8, 42);
    this.scene.add(new THREE.HemisphereLight("#e4f2ff", "#192a35", 2.0));
    const lamp = new THREE.PointLight("#fff8e8", 45, 12);
    lamp.position.set(0, 2.35, 0);
    this.scene.add(lamp);
    this.buildCabin();

    this.camera.position.set(0, 1.66, 5.2);
    this.camera.lookAt(0, 1.58, -3);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
    this.renderer.setSize(800, 500);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = "rail-ride-canvas";

    const banner = document.createElement("div");
    banner.className = "rail-ride-banner";
    const title = document.createElement("h2");
    title.textContent = ja ? "JR 埼京線｜乗車体験" : "JR Saikyo Line | Ride experience";
    const route = document.createElement("p");
    route.className = "rail-ride-route";
    route.textContent = from + "  ⟷  " + to;
    const hint = document.createElement("p");
    hint.className = "rail-ride-demo-note";
    hint.textContent = ja
      ? "試作デモ：JRホーム・乗車位置は現地測量前の仮表現です。実際の移動経路ではありません。"
      : "Prototype: JR platform and boarding point are unsurveyed approximations, not a real navigation route.";
    banner.append(title, route, hint);

    const sheet = document.createElement("div");
    sheet.className = "rail-ride-sheet";
    this.stageTitle.className = "rail-ride-stage";
    this.stageMessage.className = "rail-ride-message";
    this.progress.className = "rail-ride-progress";
    const track = document.createElement("div");
    track.className = "rail-ride-progress-track";
    track.append(this.progress);
    this.action.className = "primary rail-ride-action";
    this.action.type = "button";
    this.action.addEventListener("click", () => {
      if (this.stage === "boarding") this.beginRide();
      else if (this.stage === "arrived" || this.stage === "error") this.dismiss();
    });
    this.cancelButton.className = "ghost rail-ride-cancel";
    this.cancelButton.type = "button";
    this.cancelButton.textContent = ja ? "終了 ✕" : "Exit ✕";
    this.cancelButton.addEventListener("click", () => { if (this.stage !== "loading") this.dismiss(); });
    sheet.append(this.stageTitle, this.stageMessage, track, this.action);
    this.root.append(this.renderer.domElement, banner, this.cancelButton, sheet);
    this.host.append(this.root);
    // A real modal: background controls and WebGL input must not remain interactive.
    for (const child of Array.from(this.host.children)) {
      if (child === this.root || !(child instanceof HTMLElement)) continue;
      this.previousInert.set(child, child.inert);
      child.inert = true;
    }
    this.setStage("boarding");
    window.addEventListener("resize", this.resize);
    window.addEventListener("keydown", this.onKeyDown, true);
    this.motionQuery?.addEventListener("change", this.onMotionChange);
    this.resize();
    this.action.focus();
    this.frameId = requestAnimationFrame(this.animate);
  }

  private buildCabin(): void {
    const cabin = new THREE.Group();
    this.scene.add(cabin);
    const plastic = new THREE.MeshStandardMaterial({ color: "#d2d9dd", metalness: 0.23, roughness: 0.38 });
    const floor = new THREE.MeshStandardMaterial({ color: "#515964", metalness: 0.03, roughness: 0.8 });
    const steel = new THREE.MeshStandardMaterial({ color: "#bbc8d0", metalness: 0.8, roughness: 0.22 });
    const dark = new THREE.MeshStandardMaterial({ color: "#13202b", metalness: 0.12, roughness: 0.58 });
    const upholstered = new THREE.MeshStandardMaterial({ color: "#236b78", roughness: 0.86 });
    const green = new THREE.MeshStandardMaterial({ color: "#36b78b", metalness: 0.2, roughness: 0.34 });
    const light = new THREE.MeshBasicMaterial({ color: "#f7fcff" });
    const outside = new THREE.Group();
    this.scene.add(outside);
    const tunnel = new THREE.MeshStandardMaterial({ color: "#192a38", roughness: 0.95 });
    const flash = new THREE.MeshBasicMaterial({ color: "#99cfff" });
    const add = (group: THREE.Group, mat: THREE.Material, w: number, h: number, d: number, x: number, y: number, z: number) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
      mesh.position.set(x, y, z);
      group.add(mesh);
      return mesh;
    };
    // A compact car with real depth and long sightlines, not a 2D loading-screen image.
    add(cabin, floor, 2.9, 0.13, 15, 0, -0.06, -1);
    add(cabin, plastic, 2.9, 0.12, 15, 0, 2.8, -1);
    add(cabin, dark, 2.8, 2.8, 0.12, 0, 1.4, -8.4);
    add(cabin, green, 2.9, 0.055, 15, 0, 2.59, -1);
    for (const side of [-1, 1]) {
      // Windows between columns, visible tunnel/lights through the openings.
      add(cabin, plastic, 0.13, 1.0, 15, side * 1.45, 0.5, -1);
      add(cabin, plastic, 0.13, 0.58, 15, side * 1.45, 2.51, -1);
      add(cabin, steel, 0.055, 0.08, 15, side * 1.39, 1.05, -1);
      add(cabin, steel, 0.055, 0.08, 15, side * 1.39, 2.18, -1);
      add(cabin, green, 0.04, 0.09, 15, side * 1.38, 1.17, -1);
      for (let z = -7.4; z < 7.3; z += 2.3) {
        add(cabin, plastic, 0.18, 1.6, 0.16, side * 1.44, 1.65, z);
        add(cabin, upholstered, 0.56, 0.52, 1.7, side * 1.13, 0.35, z + 0.95);
        add(cabin, upholstered, 0.22, 0.55, 1.7, side * 1.34, 0.77, z + 0.95);
      }
      for (const z of [-6, -3, 0, 3, 6]) {
        add(cabin, steel, 0.055, 2.55, 0.055, side * 0.92, 1.35, z);
      }
      // Shell outside the windows, kept far enough to show motion.
      add(outside, tunnel, 0.16, 4.5, 65, side * 3.3, 1.1, -8);
      for (let i = 0; i < 16; i++) {
        const beam = add(outside, flash, 0.16, 0.22, 0.6, side * 3.2, 2.05, -27 + i * 2.4);
        this.railLights.push(beam);
      }
    }
    for (const z of [-6.5, -3.2, 0.1, 3.4, 6.7]) {
      add(cabin, light, 0.3, 0.015, 2.6, -0.85, 2.68, z);
      add(cabin, light, 0.3, 0.015, 2.6, 0.85, 2.68, z);
      add(cabin, dark, 0.5, 0.1, 0.75, 0, 2.61, z);
    }
    add(cabin, steel, 0.07, 0.07, 13.5, 0, 2.32, -1);
    // End door is shut during the ride.
    add(cabin, steel, 1.2, 2.1, 0.08, 0, 1.15, -8.28);
  }

  private setStage(stage: Stage): void {
    this.stage = stage;
    this.root.dataset.stage = stage;
    const ja = this.lang === "ja";
    const to = railStationName(this.link.to, this.lang);
    const copy: Record<Stage, [string, string, string]> = {
      boarding: ja
        ? ["まもなく発車します", this.link.platformJa + "｜乗車して出発", "乗車する"]
        : ["Ready to board", "Demo boarding point · JR Saikyo Line", "Board train"],
      moving: ja
        ? ["次は " + to, "走行中 · 窓の外をご覧ください", "走行中…"]
        : ["Next stop: " + to, "Train in motion · Enjoy the journey", "Traveling…"],
      loading: ja
        ? ["まもなく " + to, "到着駅の3Dシーンを読み込み中", "到着待ち…"]
        : ["Approaching " + to, "Loading destination 3D station", "Arriving…"],
      arrived: ja
        ? [to + " に到着しました", "ドアが開きます。駅を探索できます。", "下車して探索"]
        : ["Arrived at " + to, "Doors opening. Continue exploring the station.", "Exit train"],
      error: ja
        ? ["到着駅を開けませんでした", "通信やデータの状態をご確認ください。", "デモを終了"]
        : ["Could not open destination", "Check the station data or connection.", "Close demo"],
    };
    const [title, message, button] = copy[stage];
    this.stageTitle.textContent = title;
    this.stageMessage.textContent = message;
    this.action.textContent = button;
    this.action.disabled = stage === "moving" || stage === "loading";
    // Keep one modal focus target in the tab order even while destination loads.
    this.cancelButton.disabled = false;
    this.cancelButton.setAttribute("aria-disabled", String(stage === "loading"));
    if (stage === "loading") this.cancelButton.focus();
  }

  private beginRide(): void {
    if (this.stage !== "boarding") return;
    this.rideTime = 0;
    this.setStage("moving");
  }

  private async arrive(): Promise<void> {
    if (this.closed || this.stage !== "moving") return;
    this.setStage("loading");
    try {
      const ok = await this.onArrival();
      if (!this.closed) this.setStage(ok ? "arrived" : "error");
    } catch {
      if (!this.closed) this.setStage("error");
    }
  }

  private readonly animate = (now: number): void => {
    if (this.closed) return;
    const delta = Math.min(this.lastTime ? (now - this.lastTime) / 1000 : 0, 0.05);
    this.lastTime = now;
    if (this.stage === "moving") {
      this.rideTime += delta;
      if (!this.reduceMotion) {
        for (const beam of this.railLights) {
          beam.position.z += delta * (11 + 7 * Math.min(this.rideTime / 2, 1));
          if (beam.position.z > 8) beam.position.z -= 38.4;
        }
        this.camera.position.y = 1.66 + Math.sin(now * 0.017) * 0.006;
      } else {
        this.camera.position.y = 1.66;
      }
      this.progress.style.width = Math.min(100, this.rideTime / 9 * 100) + "%";
      if (this.rideTime >= 9) void this.arrive();
    } else if (this.stage === "arrived") {
      this.progress.style.width = "100%";
    }
    this.renderer.render(this.scene, this.camera);
    this.frameId = requestAnimationFrame(this.animate);
  };

  private readonly resize = (): void => {
    if (this.closed) return;
    const w = Math.max(200, this.root.clientWidth);
    const h = Math.max(200, this.root.clientHeight);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
  };

  private readonly onMotionChange = (e: MediaQueryListEvent): void => {
    this.reduceMotion = e.matches;
  };

  private readonly onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === "Tab") {
      // Contain focus within the two controls, including during disabled-button loading.
      const targets = [this.action, this.cancelButton].filter((button) => !button.disabled);
      const first = targets[0];
      const last = targets[targets.length - 1];
      if (!first || !last) { e.preventDefault(); this.root.focus(); return; }
      const current = document.activeElement;
      if (!targets.includes(current as HTMLButtonElement)) {
        e.preventDefault();
        (e.shiftKey ? last : first).focus();
      } else if (e.shiftKey && current === first) {
        e.preventDefault(); last.focus();
      } else if (!e.shiftKey && current === last) {
        e.preventDefault(); first.focus();
      }
      return;
    }
    if (e.key === "Escape" && this.stage !== "loading") {
      e.preventDefault();
      this.dismiss();
    }
  };

  private dismiss(): void {
    this.dispose();
    this.onClose();
  }

  dispose(): void {
    if (this.closed) return;
    this.closed = true;
    cancelAnimationFrame(this.frameId);
    window.removeEventListener("resize", this.resize);
    window.removeEventListener("keydown", this.onKeyDown, true);
    this.motionQuery?.removeEventListener("change", this.onMotionChange);
    for (const [node, wasInert] of this.previousInert) node.inert = wasInert;
    this.previousInert.clear();
    const geometries = new Set<THREE.BufferGeometry>();
    const materials = new Set<THREE.Material>();
    this.scene.traverse((object) => {
      if (!(object instanceof THREE.Mesh)) return;
      geometries.add(object.geometry);
      const m = object.material;
      for (const mat of Array.isArray(m) ? m : [m]) materials.add(mat);
    });
    for (const g of geometries) g.dispose();
    for (const m of materials) m.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
    this.root.remove();
    if (this.focusBefore?.isConnected && !this.focusBefore.inert) this.focusBefore.focus();
  }
}
