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
  const unrelated = "00000000-0000-4000-8000-000000000003";
  const index = "index.md";
  const ownershipDir = ".gteki-feedback-exports";
  const foreign = [`${unrelated}.json`, `${unrelated}.jpg`, "notes.json"];
  const expiredExports = [`${expired}.json`, `${expired}.jpg`, index];
  const kept = [`${fresh}.json`, `${fresh}.jpg`, ownershipDir, ...foreign];
  const old = new Date(Date.now() - 91 * 86_400_000);
  const since = "2026-11-24T00:00:00.000Z";
  function run(stub) {
    execFileSync(process.execPath, [
      "--import", `data:text/javascript,${encodeURIComponent(stub)}`,
      fileURLToPath(new URL("./feedback/list.mjs", import.meta.url)), since, out,
    ], {
      env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: "test", CLOUDFLARE_API_TOKEN: "test", FEEDBACK_NAMESPACE_ID: "test" },
    });
  }
  try {
    run(`
      const reports = ${JSON.stringify([expired, fresh].map((id) => [
        `report:${since}:${id}`,
        { id, status: "new", createdAt: since, message: "fixture", screenshot: "data:image/jpeg;base64,YQ==" },
      ]))};
      const values = new Map(reports);
      globalThis.fetch = async (url) => {
        if (url.includes("/keys?")) {
          return Response.json({ success: true, result: reports.map(([name]) => ({ name })), result_info: {} });
        }
        return Response.json(values.get(decodeURIComponent(url.split("/").at(-1))));
      };
    `);
    for (const name of foreign) writeFileSync(path.join(out, name), "fixture");
    for (const name of [...expiredExports, ...foreign]) utimesSync(path.join(out, name), old, old);

    run(`
      import assert from "node:assert/strict";
      import { readdirSync } from "node:fs";
      globalThis.fetch = async () => {
        assert.deepEqual(readdirSync(process.argv[3]).sort(), ${JSON.stringify([...kept].sort())});
        return Response.json({ success: true, result: [], result_info: {} });
      };
    `);
    expect(readdirSync(out).sort()).toEqual([...kept, index].sort());
  } finally {
    rmSync(out, { recursive: true, force: true });
  }
});
