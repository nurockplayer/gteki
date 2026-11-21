import { feedbackUrl } from "../../apps/web/src/ui/feedbackUrl.ts";

interface FeedbackKV {
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

export async function onRequestPost({ request, env }: { request: Request; env: { FEEDBACK: FeedbackKV; TURNSTILE_SECRET: string } }): Promise<Response> {
  if (Number(request.headers.get("Content-Length")) > 300_000) return new Response("Report too large", { status: 413 });
  const reader = request.body?.getReader();
  if (!reader) return new Response("Missing report", { status: 400 });
  const bytes = new Uint8Array(300_000);
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (length + value.byteLength > bytes.length) {
      await reader.cancel();
      return new Response("Report too large", { status: 413 });
    }
    bytes.set(value, length);
    length += value.byteLength;
  }
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes.subarray(0, length))); }
  catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!payload || typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 1000
    || typeof payload.turnstileToken !== "string" || !payload.turnstileToken || payload.turnstileToken.length > 2048
    || typeof payload.url !== "string"
    || typeof payload.screenshot !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.screenshot)) {
    return new Response("Invalid report", { status: 400 });
  }
  let image: string;
  try { image = atob(payload.screenshot.slice("data:image/jpeg;base64,".length)); }
  catch { return new Response("Invalid screenshot", { status: 400 }); }
  if (image.length > 200_000) return new Response("Screenshot too large", { status: 413 });
  if (!image.startsWith("\xff\xd8\xff")) return new Response("Expected JPEG", { status: 400 });

  let url: string;
  try { url = feedbackUrl(payload.url); }
  catch { return new Response("Invalid URL", { status: 400 }); }
  if (!env.TURNSTILE_SECRET) return new Response("Verification unavailable", { status: 503 });
  let verification;
  try {
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ secret: env.TURNSTILE_SECRET, response: payload.turnstileToken, remoteip: request.headers.get("CF-Connecting-IP") ?? undefined }),
    });
    if (!response.ok) return new Response("Verification unavailable", { status: 503 });
    verification = await response.json() as { success: boolean; hostname: string; action?: string };
  } catch { return new Response("Verification unavailable", { status: 503 }); }
  const hostname = new URL(request.url).hostname;
  // Published test keys return example.com and omit action; allow that only on loopback.
  const localTest = ["localhost", "127.0.0.1"].includes(hostname) && env.TURNSTILE_SECRET === "1x0000000000000000000000000000000AA";
  const contextMatches = localTest
    ? verification.hostname === "example.com" && verification.action === undefined
    : verification.hostname === hostname && verification.action === "feedback";
  if (!verification.success || !contextMatches) return new Response("Verification failed", { status: 403 });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  const { turnstileToken, ...report } = payload;
  try {
    await env.FEEDBACK.put(`report:${createdAt}:${id}`, JSON.stringify({ ...report, url, mode: { ...payload.mode, next: new URL(url).searchParams.get("next") === "1" }, id, createdAt, status: "new" }), { expirationTtl: 90 * 86400 });
  } catch { return new Response("Report could not be stored; please retry", { status: 503 }); }
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
