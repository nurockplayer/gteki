import type { StationBundle } from "@gteki/schema";
import type { Explorer } from "../explorer/explorer.ts";
import { feedbackStrings, type FeedbackLang } from "../i18n.ts";
import { currentFloorId } from "./minimapGeometry.ts";

declare const __BUILD_SHA__: string;

export function buildFeedbackPayload(message: string, language: FeedbackLang, explorer: Explorer, bundle: StationBundle | null, station: string | null) {
  const { pose, simT, screenshot } = explorer.captureFeedback();
  return {
    message, url: location.href, language, station,
    device: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }, touch: { maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia("(pointer: coarse)").matches } },
    mode: { play: explorer.currentMode === "guide" ? "guide" : "free", camera: explorer.currentMode, next: new URLSearchParams(location.search).get("next") },
    pose, floorId: pose && bundle ? currentFloorId(bundle, pose.up, pose.east, pose.north) : null,
    simT, buildSha: __BUILD_SHA__, screenshot,
  };
}

export function openFeedback(language: FeedbackLang, capture: (message: string) => ReturnType<typeof buildFeedbackPayload>): void {
  const t = feedbackStrings(language);
  const dialog = document.createElement("dialog");
  dialog.className = "feedback-dialog";
  dialog.lang = language;
  dialog.setAttribute("aria-labelledby", "feedback-title");
  const form = document.createElement("form");
  const title = document.createElement("h2");
  title.id = "feedback-title";
  title.textContent = t.title;
  const detail = document.createElement("p");
  detail.textContent = t.detail;
  const label = document.createElement("label");
  label.textContent = t.message;
  const message = document.createElement("textarea");
  message.maxLength = 1000;
  message.required = true;
  message.rows = 4;
  label.append(message);
  const status = document.createElement("p");
  status.setAttribute("role", "status");
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = t.close;
  close.onclick = () => dialog.close();
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "primary";
  send.textContent = t.send;
  send.disabled = true;
  message.oninput = () => { send.disabled = !message.value.trim(); };
  form.onsubmit = async (event) => {
    event.preventDefault();
    send.disabled = true;
    status.textContent = t.sending;
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(capture(message.value.trim())) });
      if (!response.ok) {
        status.textContent = response.status === 429 ? t.rate : t.error;
        send.disabled = false;
        return;
      }
      status.textContent = t.sent;
      message.disabled = true;
      send.hidden = true;
    } catch {
      status.textContent = t.error;
      send.disabled = false;
    }
  };
  form.append(title, detail, label, status, close, send);
  dialog.append(form);
  dialog.addEventListener("close", () => dialog.remove());
  document.body.append(dialog);
  dialog.showModal();
}
