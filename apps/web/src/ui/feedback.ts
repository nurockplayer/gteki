import type { StationBundle } from "@gteki/schema";
import type { Explorer } from "../explorer/explorer.ts";
import { feedbackStrings, type FeedbackLang } from "../i18n.ts";
import { currentFloorId } from "./minimapGeometry.ts";
import { feedbackUrl } from "./feedbackUrl.ts";

declare const __BUILD_SHA__: string;
declare const __TURNSTILE_SITEKEY__: string;

interface Turnstile {
  render(container: HTMLElement, options: { sitekey: string; action: string; language: string; size: string; callback: (token: string) => void; "expired-callback": () => void; "error-callback": () => void }): string;
  reset(id: string): void;
  remove(id: string): void;
}

let turnstileReady: Promise<Turnstile> | undefined;
function loadTurnstile(): Promise<Turnstile> {
  return turnstileReady ??= new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    script.onload = () => {
      const api = (window as unknown as { turnstile: Turnstile }).turnstile;
      resolve(api);
    };
    script.onerror = () => reject(new Error("Turnstile could not load"));
    document.head.append(script);
  });
}

export function buildFeedbackPayload(message: string, language: FeedbackLang, explorer: Explorer, bundle: StationBundle | null, station: string | null) {
  const { pose, simT, screenshot } = explorer.captureFeedback();
  return {
    message, url: feedbackUrl(location.href), language, station,
    device: { userAgent: navigator.userAgent, viewport: { width: innerWidth, height: innerHeight, pixelRatio: devicePixelRatio }, touch: { maxTouchPoints: navigator.maxTouchPoints, coarsePointer: matchMedia("(pointer: coarse)").matches } },
    mode: { play: explorer.currentMode === "guide" ? "guide" : "free", camera: explorer.currentMode, next: new URLSearchParams(location.search).get("next") === "1" },
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
  const widget = document.createElement("div");
  let api: Turnstile;
  let widgetId: string | undefined;
  let token = "";
  let submitting = false;
  const close = document.createElement("button");
  close.type = "button";
  close.textContent = t.close;
  close.onclick = () => dialog.close();
  const send = document.createElement("button");
  send.type = "submit";
  send.className = "primary";
  send.textContent = t.send;
  send.disabled = true;
  const updateSend = () => { send.disabled = submitting || !token || !message.value.trim(); };
  message.oninput = updateSend;
  form.onsubmit = async (event) => {
    event.preventDefault();
    if (!token || submitting) return;
    submitting = true;
    updateSend();
    status.textContent = t.sending;
    try {
      const response = await fetch("/api/feedback", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...capture(message.value.trim()), turnstileToken: token }) });
      if (!response.ok) throw new Error(`Feedback returned ${response.status}`);
      status.textContent = t.sent;
      message.disabled = true;
      send.hidden = true;
      api.remove(widgetId!);
      widgetId = undefined;
    } catch {
      status.textContent = t.error;
      token = "";
      api.reset(widgetId!);
    } finally {
      submitting = false;
      updateSend();
    }
  };
  form.append(title, detail, label, widget, status, close, send);
  dialog.append(form);
  dialog.addEventListener("close", () => {
    if (widgetId !== undefined) api.remove(widgetId);
    dialog.remove();
  });
  document.body.append(dialog);
  dialog.showModal();
  if (!__TURNSTILE_SITEKEY__) { status.textContent = t.error; return; }
  void loadTurnstile().then((loaded) => {
    if (!dialog.isConnected) return;
    api = loaded;
    widgetId = api.render(widget, {
      sitekey: __TURNSTILE_SITEKEY__, action: "feedback", language: language === "zh" ? "zh-tw" : language, size: "flexible",
      callback: (value) => { token = value; updateSend(); },
      "expired-callback": () => { token = ""; updateSend(); },
      "error-callback": () => { token = ""; updateSend(); status.textContent = t.error; },
    });
  }).catch(() => { status.textContent = t.error; });
}
