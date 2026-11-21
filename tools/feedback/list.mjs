// Read-only against Cloudflare; writes a local triage folder with screenshot links.
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const { CLOUDFLARE_ACCOUNT_ID: account, CLOUDFLARE_API_TOKEN: token, FEEDBACK_NAMESPACE_ID: namespace } = process.env;
if (!account || !token || !namespace) throw new Error("Set CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN and FEEDBACK_NAMESPACE_ID");
const since = new Date(process.argv[2] ?? 0).toISOString();
const out = path.resolve(process.argv[3] ?? ".qa/feedback");
const base = `https://api.cloudflare.com/client/v4/accounts/${account}/storage/kv/namespaces/${namespace}`;
async function api(resource) {
  const response = await fetch(`${base}/${resource}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error(`Cloudflare ${response.status}: ${await response.text()}`);
  return response.json();
}
await mkdir(out, { recursive: true });
const rows = [`# New feedback since ${since} (UTC)`, "", "Reports expire in KV 90 days after submission. Delete local exports by the same deadline.", ""];
let cursor = "";
let count = 0;
do {
  const page = await api(`keys?${new URLSearchParams({ prefix: "report:", cursor })}`);
  if (!page.success) throw new Error(JSON.stringify(page.errors));
  for (const key of page.result) {
    if (key.name.slice(7, 31) < since) continue;
    const report = await api(`values/${encodeURIComponent(key.name)}`);
    if (report.status !== "new") continue;
    const { screenshot, ...details } = report;
    await writeFile(path.join(out, `${report.id}.jpg`), Buffer.from(screenshot.split(",")[1], "base64"));
    await writeFile(path.join(out, `${report.id}.json`), JSON.stringify(details, null, 2));
    rows.push(`- ${report.createdAt} (UTC) ${JSON.stringify(report.message)} — [record](${report.id}.json) · [screenshot](${report.id}.jpg)`);
    count++;
  }
  cursor = page.result_info.cursor ?? "";
} while (cursor);
await writeFile(path.join(out, "index.md"), rows.join("\n") + "\n");
console.log(`${count} new report(s): ${path.join(out, "index.md")}`);
