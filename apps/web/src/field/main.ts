import "./style.css";
import { stations } from "./data.ts";
import { buildReceipts, mergeRecorderState, newObservation, nowJst, type Observation, type RecorderState } from "./submission.ts";

const storageKey = "gteki-field-v1";
let state: RecorderState = { station: "ikebukuro", positions: {}, records: {} };
let storageMessage = "この端末に自動保存 / Saved on this device";
function readStoredState(): RecorderState | null {
  const saved = localStorage.getItem(storageKey);
  if (!saved) return null;
  const stored = JSON.parse(saved) as RecorderState;
  // Pre-ID observations get the same identity in every tab before their next save.
  for (const [station, records] of Object.entries(stored.records)) {
    records.forEach((record, index) => { record.id ??= `legacy-${station}-${index}-${record.observedAt}`; });
  }
  return stored;
}
try { state = readStoredState() ?? state; }
catch { storageMessage = "保存を読み込めません / Storage unavailable; export before leaving."; }
const root = document.getElementById("field")!;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text?: string): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); if (text !== undefined) element.textContent = text; return element;
};
const saveStatus = el("p", storageMessage);
saveStatus.setAttribute("role", "status");
const offlineStatus = el("p", "オンラインで一度開いて準備 / Preparing offline copy…");
const exportStatus = el("p");
exportStatus.setAttribute("role", "alert");
const changedIds = new Set<string>();
function save(changedId?: string) {
  if (changedId) changedIds.add(changedId);
  try {
    const stored = readStoredState();
    if (stored) state = mergeRecorderState(stored, state, changedIds);
    localStorage.setItem(storageKey, JSON.stringify(state));
    changedIds.clear();
    saveStatus.textContent = "この端末に自動保存 / Saved on this device";
  }
  catch { saveStatus.textContent = "保存できません / Storage unavailable; export before leaving."; }
}
function button(text: string, action: () => void) {
  const b = el("button", text); b.type = "button"; b.onclick = action; return b;
}
function render() {
  const station = stations.find((s) => s.id === state.station) ?? stations[0]!;
  state.station = station.id;
  const position = Math.min(state.positions[station.id] ?? 0, station.stops.length - 1);
  const stop = station.stops[position]!;
  const records = state.records[station.id] ??= [];
  root.replaceChildren(el("h1", "現地メモ / Field recorder"));
  const stationSelect = el("select"); stationSelect.setAttribute("aria-label", "Station");
  for (const s of stations) stationSelect.add(new Option(s.title, s.id));
  stationSelect.value = station.id;
  stationSelect.onchange = () => { state.station = stationSelect.value; save(); render(); };
  root.append(stationSelect, saveStatus, offlineStatus);
  const nav = el("nav");
  const move = (delta: number) => { state.positions[station.id] = position + delta; save(); render(); window.scrollTo(0, 0); };
  const prev = button("← 前 / Prev", () => move(-1)); prev.disabled = position === 0;
  const next = button("次 / Next →", () => move(1)); next.disabled = position === station.stops.length - 1;
  nav.append(prev, el("span", `${position + 1} / ${station.stops.length}`), next);
  const visited = new Set(records.map((r) => r.stopId)).size;
  root.append(nav, el("p", `${visited} / ${station.stops.length} stops with notes · ${records.length} records`), el("h2", `${stop.id} · ${stop.title}`));
  if (stop.private) {
    const badge = el("strong", "非公開 / Private"); badge.className = "private-badge"; root.append(badge);
  }
  root.append(el("p", `Items: ${stop.items.join(", ")}`));
  const instructions = el("details"); instructions.append(el("summary", "手順を読む / Stop instructions"), el("pre", stop.instructions)); root.append(instructions);
  root.append(el("p", "公の場所の事実だけ。写真・位置情報・氏名なし。 / Public facts only; no photos, geolocation or names."));
  root.append(el("p", "CLOSED = 確認済み / confirmed. Receipt status stays OPEN unless a numbered item, known node, store POI and fare side are set. FC / unassigned observations export as fieldNotes alongside numbered items."));
  for (const record of records.filter((r) => r.stopId === stop.id)) {
    const card = el("section"); card.className = "record"; card.append(el("h3", `記録 / Record ${records.indexOf(record) + 1}`));
    const field = (label: string, key: Exclude<keyof Observation, "private">, choices?: [string, string][], multiline = false) => {
      const control = choices ? el("select") : multiline ? el("textarea") : el("input");
      if (control instanceof HTMLSelectElement) for (const [value, text] of choices!) control.add(new Option(text, value));
      control.value = record[key];
      const wrap = el("label", label); wrap.append(control); card.append(wrap);
      control.oninput = () => {
        const current = state.records[station.id]!.find((entry) => entry.id === record.id);
        if (current) { (current[key] as string) = control.value; save(current.id); }
      };
      return control;
    };
    const knownIds = stop.ids.filter((id) => station.nodeIds.includes(id) || station.edgeIds.includes(id));
    const target = field("対象 ID / Target (or free text)", "target") as HTMLInputElement;
    const list = el("datalist"); list.id = `targets-${records.indexOf(record)}`;
    for (const id of knownIds) list.append(new Option(id, id));
    target.setAttribute("list", list.id); card.append(list);
    const targetState = el("p");
    const showTarget = () => { targetState.textContent = station.nodeIds.includes(target.value) ? "Known node" : station.edgeIds.includes(target.value) ? "Known edge" : "UNKNOWN — free text / 未照合"; };
    target.addEventListener("input", showTarget); showTarget(); card.append(targetState);
    field("項目 / Item (optional)", "itemId", [["", "Unassigned / 未指定"], ...stop.items.map((id): [string, string] => [id, id])]);
    field("左右 / Side", "side", [["n/a", "n/a"], ["left", "Left / 左"], ["right", "Right / 右"]]);
    const offset = field("距離 m / Offset m", "offsetM") as HTMLInputElement; offset.type = "number"; offset.step = "any";
    field("階 / Floor label", "floorLabel");
    field("確認 / Confirmation", "confirmation", [["OPEN", "OPEN — unsure / 未確認"], ["CLOSED", "CLOSED — confirmed / 確認済み"]]);
    const stepFree = field("段差 / Step-free (level, steps:<n>, lift, escalator)", "stepFree") as HTMLInputElement;
    const steps = el("datalist"); steps.id = `steps-${records.indexOf(record)}`;
    for (const value of ["level", "steps:1", "lift", "escalator"]) steps.append(new Option(value, value));
    stepFree.setAttribute("list", steps.id); card.append(steps);
    field("店舗 / Store POI (optional)", "poiId", [["", "No store / 未指定"], ...station.pois.map((p): [string, string] => [p.id, `${p.label} (${p.id})`])]);
    field("改札内外 / Fare side", "paid", [["", "Unknown / 不明"], ["false", "Free / 改札外"], ["true", "Paid / 改札内"]]);
    field("読んだ文言 / Observed text", "observedText", undefined, true);
    field("補足 / Note", "note", undefined, true);
    field("観察時刻 / Observed at (JST +09:00)", "observedAt");
    card.append(button("記録を削除 / Remove record", () => {
      state.records[station.id] = state.records[station.id]!.filter((entry) => entry.id !== record.id);
      (state.deletedIds ??= []).push(record.id);
      save(); render();
    }));
    root.append(card);
  }
  root.append(button("＋ 記録 / Add record", () => {
    const record = newObservation(stop.id, stop.private);
    state.records[station.id]!.push(record); save(record.id); render();
  }));
  root.append(button("JSON を保存 / Export station JSON", () => {
    try {
      const receipts = buildReceipts(station, state.records[station.id] ?? []);
      for (const receipt of receipts) {
        const url = URL.createObjectURL(new Blob([JSON.stringify(receipt, null, 2) + "\n"], { type: "application/json" }));
        const link = el("a"); link.href = url; link.download = `${nowJst().slice(0, 10)}-${station.id}${receipt.private ? "-private" : ""}.json`;
        root.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      exportStatus.textContent = "JSON saved. Notes remain on this device.";
    } catch (error) { exportStatus.textContent = (error as Error).message; }
  }), exportStatus);
}
window.addEventListener("storage", (event) => {
  if (event.key !== storageKey) return;
  try {
    const stored = readStoredState();
    if (stored) { state = stored; changedIds.clear(); render(); }
  } catch { saveStatus.textContent = "保存を読み込めません / Storage unavailable; export before leaving."; }
});
render();
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("./field-sw.js").then(() => navigator.serviceWorker.ready).then(() => {
    offlineStatus.textContent = "オフライン準備完了 / Ready for offline reload";
  }).catch(() => { offlineStatus.textContent = "オフライン未準備 / Offline copy unavailable; reopen online."; });
}
