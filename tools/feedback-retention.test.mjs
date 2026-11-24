import { execFileSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("removes only stale triage exports before requesting reports", () => {
  const out = mkdtempSync(path.join(tmpdir(), "gteki-feedback-"));
  const expired = "00000000-0000-4000-8000-000000000001";
  const fresh = "00000000-0000-4000-8000-000000000002";
  const index = "index.md";
  const expiredExports = [`${expired}.json`, `${expired}.jpg`, index];
  const kept = [`${fresh}.json`, `${fresh}.jpg`, "notes.json"];
  const old = new Date(Date.now() - 91 * 86_400_000);
  try {
    for (const name of [...expiredExports, ...kept]) {
      writeFileSync(path.join(out, name), name === index ? "# New feedback since 2026-07-01T00:00:00.000Z (UTC)\n" : "fixture");
    }
    for (const name of [...expiredExports, "notes.json"]) utimesSync(path.join(out, name), old, old);

    const stub = `
      import assert from "node:assert/strict";
      import { readdirSync } from "node:fs";
      globalThis.fetch = async () => {
        assert.deepEqual(readdirSync(process.argv[3]).sort(), ${JSON.stringify([...kept].sort())});
        return Response.json({ success: true, result: [], result_info: {} });
      };
    `;
    execFileSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(stub)}`,
      fileURLToPath(new URL("./feedback/list.mjs", import.meta.url)), "2026-11-24T00:00:00Z", out,
    ], {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "test", CLOUDFLARE_API_TOKEN: "test", FEEDBACK_NAMESPACE_ID: "test" },
    });
    expect(readdirSync(out).sort()).toEqual([...kept, index].sort());
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
