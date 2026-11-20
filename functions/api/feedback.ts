interface FeedbackKV {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl: number }): Promise<void>;
}

export async function onRequestPost({ request, env }: { request: Request; env: { FEEDBACK: FeedbackKV } }): Promise<Response> {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > 300_000) return new Response("Report too large", { status: 413 });
  let payload;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); }
  catch { return new Response("Invalid JSON", { status: 400 }); }
  if (!payload || typeof payload.message !== "string" || !payload.message.trim() || payload.message.length > 1000
    || typeof payload.screenshot !== "string" || !/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/.test(payload.screenshot)) {
    return new Response("Invalid report", { status: 400 });
  }
  let image: string;
  try { image = atob(payload.screenshot.slice("data:image/jpeg;base64,".length)); }
  catch { return new Response("Invalid screenshot", { status: 400 }); }
  if (image.length > 200_000) return new Response("Screenshot too large", { status: 413 });
  if (!image.startsWith("\xff\xd8\xff")) return new Response("Expected JPEG", { status: 400 });

  // KV provides a basic, best-effort limit (its reads are eventually consistent).
  const ip = request.headers.get("CF-Connecting-IP") ?? "local";
  const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip));
  const rateKey = `rate:${Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (await env.FEEDBACK.get(rateKey)) return new Response("Please wait a minute", { status: 429, headers: { "Retry-After": "60" } });
  await env.FEEDBACK.put(rateKey, "1", { expirationTtl: 60 });
  const id = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await env.FEEDBACK.put(`report:${createdAt}:${id}`, JSON.stringify({ ...payload, id, createdAt, status: "new" }));
  return Response.json({ id }, { status: 201, headers: { "Cache-Control": "no-store" } });
}
