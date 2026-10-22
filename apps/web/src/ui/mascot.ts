import type { Strings } from "../i18n.ts";

/** The two original, fictional guide mascots (#132): a proud, calm cat and an eager dog. */
export type MascotId = "cat" | "dog";
export type MascotExpression = "neutral" | "happy" | "encourage" | "sorry";

/** A UI event the mascot may react to. `no_path` carries the router's RouteFailure.reason. */
export type MascotEvent =
  | { kind: "arrival" }
  | { kind: "arrival_connector" }
  | { kind: "no_path"; reason: string }
  | { kind: "route_unknowns" }
  | { kind: "search_empty" }
  | { kind: "turn" }
  | { kind: "load_error" }
  | { kind: "scene_fallback" }
  | { kind: "start_hint" }
  | { kind: "idle" };

export interface MascotLine {
  character: MascotId;
  expression: MascotExpression;
  /** Stable key into the i18n table (for tests and QA hooks), e.g. "no_path.search_limit". */
  lineKey: string;
  /** Fixed i18n text. Never interpolated with route facts. */
  line: string;
  /** Joined into the shared LiveRegion burst; false when the text is announced elsewhere (turn, arrival: the toast already says it). */
  announce: boolean;
  /** Hides itself after a few seconds; state events stay until cleared. */
  transient: boolean;
}

/** How long a transient line (turn, arrival) stays up. */
export const TRANSIENT_MS = 4500;

/**
 * UI event -> mascot line, or null (hide). The mascot only reacts to the kind of event: every line is a fixed
 * string, so it can never state a direction, distance, floor or name; the router's own text does that.
 * UNKNOWN stays UNKNOWN: search_limit, unknown_* and unrecognised reasons say plainly "I don't know".
 */
export function mascotLine(t: Strings, ev: MascotEvent): MascotLine | null {
  const m = t.mascot;
  switch (ev.kind) {
    case "arrival":
      return { character: "dog", expression: "happy", lineKey: "arrival", line: m.arrival, announce: false, transient: true };
    case "arrival_connector":
      // The guide ran out on a stair/escalator/ramp, not at the destination: never "arrived".
      return { character: "cat", expression: "sorry", lineKey: "arrival_connector", line: m.arrivalConnector, announce: true, transient: true };
    case "no_path": {
      const known = Object.hasOwn(m.noPath, ev.reason) && ev.reason !== "other";
      const key = known ? ev.reason : "other";
      return { character: "cat", expression: ev.reason === "start_equals_goal" ? "neutral" : "sorry", lineKey: `no_path.${key}`, line: m.noPath[key]!, announce: true, transient: false };
    }
    case "route_unknowns":
      return { character: "cat", expression: "sorry", lineKey: "route_unknowns", line: m.routeUnknowns, announce: true, transient: false };
    case "search_empty":
      return { character: "dog", expression: "encourage", lineKey: "search_empty", line: m.searchEmpty, announce: true, transient: false };
    case "turn":
      return { character: "dog", expression: "encourage", lineKey: "turn", line: m.turn, announce: false, transient: true };
    case "load_error":
      // The error card announces nothing itself, so this line is the announcement.
      return { character: "cat", expression: "sorry", lineKey: "load_error", line: m.loadError, announce: true, transient: false };
    case "scene_fallback":
      // The sceneFallback toast already announces the fallback.
      return { character: "cat", expression: "sorry", lineKey: "scene_fallback", line: m.sceneFallback, announce: false, transient: false };
    case "start_hint":
      return { character: "dog", expression: "encourage", lineKey: "start_hint", line: m.startHint, announce: false, transient: false };
    case "idle":
      return null;
  }
}

// ---- Placeholder art ------------------------------------------------------------------
// PLACEHOLDER ONLY (#132): tiny geometric faces authored for this repo, no external files or third-party art.
// Final art comes from Lane E's model sheet (4 expressions per character) after Owner approval; it drops in by
// replacing MASCOT_ART, a plain (character, expression) -> svg string lookup. Faces look right, toward the text.

const INK = "#2b2118";
const STROKE = `fill="none" stroke="${INK}" stroke-width="1.8" stroke-linecap="round"`;
const dot = (x: number, y: number, r: number): string => `<circle cx="${x}" cy="${y}" r="${r}" fill="${INK}"/>`;
const svg = (body: string): string => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" focusable="false">${body}</svg>`;

/** Eyes and brows for one expression, around the eye line `y` at x1 and x2. */
function eyes(e: MascotExpression, x1: number, x2: number, y: number): string {
  switch (e) {
    case "happy": return `<path ${STROKE} d="M${x1 - 2.5} ${y + 1}q2.5-4 5 0M${x2 - 2.5} ${y + 1}q2.5-4 5 0"/>`;
    case "encourage": return dot(x1, y, 2.7) + dot(x2, y, 2.7);
    case "sorry": return dot(x1, y, 2) + dot(x2, y, 2) + `<path ${STROKE} d="M${x1 - 3} ${y - 5}l6 2M${x2 + 3} ${y - 5}l-6 2"/>`;
    case "neutral": return dot(x1, y, 2) + dot(x2, y, 2);
  }
}

/** A small mouth at (x, y). */
function mouth(e: MascotExpression, x: number, y: number): string {
  const d = { neutral: `M${x} ${y}h6`, happy: `M${x - 0.5} ${y - 1}q3.5 5 7 0`, encourage: `M${x} ${y - 1}q3 3.5 6 0`, sorry: `M${x} ${y + 1}q3-3 6 0` }[e];
  return `<path ${STROKE} d="${d}"/>`;
}

const cat = (e: MascotExpression): string =>
  svg(`<path d="M11 21 14 5 24 14ZM38 21 36 5 27 14Z" fill="#d9c3a0"/><circle cx="25" cy="28" r="15" fill="#ecdcc0"/>${eyes(e, 21, 32, 26)}<circle cx="29" cy="31" r="1.4" fill="#c0707a"/>${mouth(e, 26, 35)}`);

const dog = (e: MascotExpression): string =>
  svg(`<ellipse cx="11.5" cy="27" rx="5" ry="10" fill="#a8742f" transform="rotate(8 11.5 27)"/><ellipse cx="38.5" cy="27" rx="5" ry="10" fill="#a8742f" transform="rotate(-8 38.5 27)"/><circle cx="25" cy="27" r="14" fill="#d8a96b"/><ellipse cx="30" cy="33" rx="7" ry="5" fill="#f1dcb8"/>${eyes(e, 22, 32, 24)}<ellipse cx="32" cy="30.5" rx="2.4" ry="1.7" fill="${INK}"/>${mouth(e, 28, 36.5)}`);

const EXPRESSIONS: readonly MascotExpression[] = ["neutral", "happy", "encourage", "sorry"];
const table = (make: (e: MascotExpression) => string): Record<MascotExpression, string> =>
  Object.fromEntries(EXPRESSIONS.map((e) => [e, make(e)])) as Record<MascotExpression, string>;

/** (character, expression) -> inline SVG. Placeholder; replace the whole table with Lane E's final art. */
export const MASCOT_ART: Record<MascotId, Record<MascotExpression, string>> = { cat: table(cat), dog: table(dog) };

// ---- DOM slot -------------------------------------------------------------------------

export interface MascotInfo {
  visible: boolean;
  character: MascotId | null;
  expression: MascotExpression;
  lineKey: string | null;
  motion: "on" | "off";
  placeholder: true;
}

/**
 * One mascot figure plus speech bubble. The figure and bubble are aria-hidden: the spoken text goes through the
 * shared LiveRegion (`announce`), so a screen reader hears it once. Animation is transform/opacity only and is
 * off for reduced motion or the phone tier (`data-motion="off"`).
 */
export class MascotSlot {
  readonly root: HTMLElement;
  private readonly figure: HTMLElement;
  private readonly bubble: HTMLElement;
  private cur: MascotLine | null = null;
  private motion: "on" | "off" = "off";
  private resident = false;
  private timer: ReturnType<typeof setTimeout> | 0 = 0;
  private art = "";

  constructor(
    private readonly strings: () => Strings,
    private readonly announce: (text: string) => void = () => {},
    doc: Pick<Document, "createElement"> = document,
  ) {
    this.root = doc.createElement("div");
    this.root.className = "mascot";
    this.root.dataset.placeholder = "true";
    this.figure = doc.createElement("span");
    this.figure.className = "mascot-figure";
    this.figure.dataset.placeholder = "true";
    this.figure.setAttribute("aria-hidden", "true");
    this.bubble = doc.createElement("span");
    this.bubble.className = "mascot-bubble";
    this.bubble.setAttribute("aria-hidden", "true");
    this.root.append(this.figure, this.bubble);
    this.render();
  }

  /** React to an event: show its line (and announce it when it asks), or hide on `idle`. */
  say(ev: MascotEvent): MascotLine | null {
    const m = mascotLine(this.strings(), ev);
    if (!m) { this.clear(); return null; }
    this.cur = m;
    this.render();
    if (m.announce) this.announce(m.line);
    this.arm(m.transient);
    return m;
  }

  /** Hide the bubble (the figure stays only while resident). */
  clear(): void {
    this.cur = null;
    this.arm(false);
    this.render();
  }

  /** Reduced motion or the phone tier turns every mascot animation off. Off until told otherwise. */
  setMotion(reduce: boolean, lowTier: boolean): void {
    this.motion = reduce || lowTier ? "off" : "on";
    this.root.dataset.motion = this.motion;
  }

  /** Keep the figure visible with a neutral face while there is no line (the guide HUD, so the text beside it does not shift). */
  setResident(on: boolean): void {
    this.resident = on;
    this.render();
  }

  /** State for QA hooks and tests. */
  info(): MascotInfo {
    return { visible: this.cur !== null, character: this.cur?.character ?? null, expression: this.cur?.expression ?? "neutral", lineKey: this.cur?.lineKey ?? null, motion: this.motion, placeholder: true };
  }

  private arm(transient: boolean): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = transient ? setTimeout(() => { this.timer = 0; this.clear(); }, TRANSIENT_MS) : 0;
  }

  private render(): void {
    const c = this.cur;
    const character = c?.character ?? "dog";
    const expression = c?.expression ?? "neutral";
    this.root.hidden = !c && !this.resident;
    this.root.dataset.character = character;
    this.root.dataset.expression = expression;
    this.root.dataset.speaking = String(Boolean(c));
    this.root.dataset.motion = this.motion;
    this.bubble.hidden = !c;
    this.bubble.textContent = c?.line ?? "";
    const art = MASCOT_ART[character][expression];
    if (art !== this.art) { this.art = art; this.figure.innerHTML = art; }
  }
}
