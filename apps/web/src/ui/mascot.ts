import type { Strings } from "../i18n.ts";

/** The two original, fictional guide mascots (#132): a proud, calm cat and an eager dog. */
export type MascotId = "cat" | "dog";
export type MascotExpression = "neutral" | "happy" | "encourage" | "sorry" | "unsure";

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
 * Face for a no_path reason: a proven dead end is `sorry`; the search running out, an unknown endpoint or an
 * unrecognised reason is `unsure` (the router does not know either); start == goal is `neutral`.
 */
function noPathExpression(reason: string): MascotExpression {
  if (reason === "start_equals_goal") return "neutral";
  return reason === "no_path" ? "sorry" : "unsure";
}

/**
 * UI event -> mascot line, or null (hide). The mascot only reacts to the kind of event: every line is a fixed
 * string, so it can never state a direction, distance, floor or name; the router's own text does that.
 * UNKNOWN stays UNKNOWN: search_limit, unknown_* and unrecognised reasons say plainly "I don't know", with the
 * `unsure` face; `sorry` is kept for a proven dead end and for failures.
 */
export function mascotLine(t: Strings, ev: MascotEvent): MascotLine | null {
  const m = t.mascot;
  switch (ev.kind) {
    case "arrival":
      return { character: "dog", expression: "happy", lineKey: "arrival", line: m.arrival, announce: false, transient: true };
    case "arrival_connector":
      // The guide ran out on a stair/escalator/ramp, not at the destination: never "arrived".
      // Where it leaves you next is unknown, so the face is unsure rather than sorry.
      return { character: "cat", expression: "unsure", lineKey: "arrival_connector", line: m.arrivalConnector, announce: true, transient: true };
    case "no_path": {
      const known = Object.hasOwn(m.noPath, ev.reason) && ev.reason !== "other";
      const key = known ? ev.reason : "other";
      return { character: "cat", expression: noPathExpression(ev.reason), lineKey: `no_path.${key}`, line: m.noPath[key]!, announce: true, transient: false };
    }
    case "route_unknowns":
      return { character: "cat", expression: "unsure", lineKey: "route_unknowns", line: m.routeUnknowns, announce: true, transient: false };
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

// ---- Art ------------------------------------------------------------------------------
// Lane E's v1 UI set (#132; assets/library/mascots/ui, CC-BY-4.0): one 64x64 SVG per (character, expression).
// Vite inlines the raw markup at build time, so the figure is still a single inline SVG with no network request.
// Pending Owner approval of the art and the side-by-side similarity check; the slot keeps its placeholder marker
// until then.

const CHARACTERS = ["cat", "dog"] as const satisfies readonly MascotId[];
const EXPRESSIONS = ["neutral", "happy", "encourage", "sorry", "unsure"] as const satisfies readonly MascotExpression[];

const ART_DIR = "../../../../assets/library/mascots/ui";
/** Raw SVG markup, keyed by the path Vite gives the glob (e.g. "../../../../assets/library/mascots/ui/cat_neutral.svg"). */
const FILES = import.meta.glob("../../../../assets/library/mascots/ui/*.svg", { query: "?raw", import: "default", eager: true }) as Record<string, string>;

/**
 * One face's markup from Lane E's set. The `xmlns` goes (the markup is inlined in HTML, and the cost guard forbids
 * remote references), and `focusable="false"` is set as the placeholder faces had it: the figure is aria-hidden
 * and must not take focus.
 */
function artFor(character: MascotId, expression: MascotExpression): string {
  const name = `${character}_${expression}.svg`;
  const file = FILES[`${ART_DIR}/${name}`];
  if (file === undefined) throw new Error(`mascot art missing: ${name} (assets/library/mascots/ui)`);
  return file.replace(/\s+xmlns="[^"]*"/, "").replace(/^<svg\b/, '<svg focusable="false"');
}

function buildArt(): Record<MascotId, Record<MascotExpression, string>> {
  const out = {} as Record<MascotId, Record<MascotExpression, string>>;
  for (const character of CHARACTERS) {
    out[character] = Object.fromEntries(EXPRESSIONS.map((expression) => [expression, artFor(character, expression)])) as Record<MascotExpression, string>;
  }
  return out;
}

/** (character, expression) -> inline SVG (Lane E v1 art, #132). Throws at module load if a face is missing. */
export const MASCOT_ART: Record<MascotId, Record<MascotExpression, string>> = buildArt();

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
