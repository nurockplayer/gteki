import type { StationBundle, StationIdentity } from "@gteki/schema";
import { pick, strings, type Lang } from "../i18n.ts";

type Names = { ja: string; kana: string; en: string };

/** Read only place-name text before graph validation; orientation facts wait for the validated bundle. */
export function identityNamesOf(manifest: unknown): StationIdentity | undefined {
  const names = (manifest as { station?: { identity?: { names?: unknown } } } | null)?.station?.identity?.names;
  if (!Array.isArray(names) || !names.every((n) => n && typeof n.lang === "string" && typeof n.text === "string" && n.text.trim())) return undefined;
  if (!["ja", "en"].every((lang) => names.some((n) => n.lang === lang))) return undefined;
  return { names };
}

function namesOf(identity: StationIdentity | undefined, fallback: string): Names {
  const text = (lang: string) => identity?.names.find((n) => n.lang === lang)?.text ?? "";
  return { ja: text("ja") || fallback, kana: text("ja-Hrkt"), en: text("en") };
}

function nameLines(host: HTMLElement, names: Names): void {
  for (const [key, lang] of [["ja", "ja"], ["kana", "ja-Hrkt"], ["en", "en"]] as const) {
    if (!names[key]) continue;
    const line = document.createElement("span");
    line.className = `identity-${key}`;
    line.lang = lang;
    line.textContent = names[key];
    host.append(line);
  }
}

/** Original abstract passage vault and floor grid. No signage, marks or operator colours. */
function passageArt(): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 320 100");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.classList.add("identity-art");
  const path = document.createElementNS(svg.namespaceURI, "path");
  path.setAttribute("d", "M12 96V68C12 0 308 0 308 68V96 M48 96V64C48 18 272 18 272 64V96 M88 96V62C88 36 232 36 232 62V96 M0 96L136 64H184L320 96 M56 96L144 64 M264 96L176 64 M112 96L154 64 M208 96L166 64 M0 87H320 M48 76H272 M104 68H216");
  path.setAttribute("fill", "none");
  path.setAttribute("stroke", "currentColor");
  path.setAttribute("stroke-width", "1.5");
  svg.append(path);
  return svg;
}

/** All-or-nothing orientation: no partial east/west relationship, no unknown source IDs. */
function evidencedSides(bundle: StationBundle): NonNullable<StationIdentity["sides"]> {
  const sides = bundle.station.identity?.sides ?? [];
  const ids = new Set(bundle.sources.map((s) => s.id));
  return sides.length >= 2 && sides.every((s) => s.evidence.sourceIds.length > 0 && s.evidence.sourceIds.every((id) => ids.has(id))) ? sides : [];
}

/** Non-modal presentation; the App owns its one loading announcement via LiveRegion. */
export class StationIdentityView {
  readonly card = document.createElement("section");
  readonly overview = document.createElement("div");
  private names: Names | null = null;

  constructor() {
    this.card.className = "station-identity-card";
    this.overview.className = "station-overview-identity";
    this.card.hidden = true;
    this.overview.hidden = true;
  }

  showCard(identity: StationIdentity | undefined, fallback: string, lang: Lang): Names {
    this.names = namesOf(identity, fallback);
    this.card.replaceChildren(passageArt());
    nameLines(this.card, this.names);
    const status = document.createElement("small");
    status.className = "identity-loading";
    status.textContent = strings(lang).loading;
    this.card.append(status);
    this.card.hidden = false;
    this.overview.hidden = true;
    return this.names;
  }

  hideCard(): void { this.card.hidden = true; }

  renderOverview(bundle: StationBundle | undefined, fallback: string, lang: Lang, mode: string): void {
    this.overview.replaceChildren();
    this.overview.hidden = !bundle || mode !== "overview" || !this.card.hidden;
    if (this.overview.hidden || !bundle) return;
    nameLines(this.overview, namesOf(bundle.station.identity, fallback));
    const sides = evidencedSides(bundle);
    if (!sides.length) return;
    const line = document.createElement("div");
    line.className = "identity-sides";
    sides.forEach((side, i) => {
      if (i) line.append(document.createTextNode(strings(lang).identitySideSeparator));
      const fact = document.createElement("span");
      fact.textContent = strings(lang).identitySide(pick(side.exit, lang), pick(side.landmark, lang));
      line.append(fact);
      if (side.verification !== "confirmed") {
        const unconfirmed = document.createElement("small");
        unconfirmed.className = "identity-unconfirmed";
        unconfirmed.textContent = ` (${strings(lang).identityUnconfirmed})`;
        line.append(unconfirmed);
      }
    });
    this.overview.append(line);
  }

  info() {
    return {
      card: this.names ? { visible: !this.card.hidden, ...this.names } : null,
      overview: this.overview.childNodes.length ? { visible: !this.overview.hidden, text: this.overview.textContent ?? "" } : null,
    };
  }
}
