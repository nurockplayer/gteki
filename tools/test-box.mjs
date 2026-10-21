import { execFile, spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { accessSync, constants, mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { blockingContainers, findOnPath, isOrbStackContext, parseIgnoreList } from "./box-idle.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const name = `gteki-box-${randomUUID().replaceAll("-", "").slice(0, 12)}`;
const docker = promisify(execFile).bind(null, "docker");
const mount = (...fields) => fields.map((field) => /[,\"]/.test(field)
  ? `"${field.replaceAll('"', '""')}"` : field).join(",");
const cpus = process.env.GTEKI_BOX_CPUS ?? "2";
const image = process.env.GTEKI_BOX_IMAGE ?? "node:24-bookworm-slim";

function memoryMb() {
  // Accept Docker-style sizes (2g, 2gb, 2GiB, 1.5g, 512mb, "2 g", t); default unit is bytes.
  const raw = process.env.GTEKI_BOX_MEMORY ?? "2g";
  const match = /^(\d+(?:\.\d+)?)\s?([kmgt])?i?b?$/i.exec(raw.trim());
  const mb = match && Math.floor(Number(match[1]) * 1024 ** "bkmgt".indexOf((match[2] ?? "b").toLowerCase()) / 1024 ** 2);
  if (!Number.isSafeInteger(mb) || mb < 1) {
    throw new Error(`Invalid GTEKI_BOX_MEMORY: ${raw}; use a Docker size such as 512m, 1.5g or 2gb (at least 1 MB).`);
  }
  return mb;
}

const command = `
corepack enable
pnpm config set store-dir /pnpm/store
tar -C /src --exclude=node_modules --exclude=.git --exclude=.claude \
  --exclude=.qa --exclude=.wrangler --exclude=dist --exclude=coverage \
  --exclude=./raw --exclude=data-cache -cf - . | tar -C /w -xf -
cd /w
pnpm install --frozen-lockfile
exec pnpm exec vitest run --mode heavy --maxWorkers=1 --passWithNoTests "$@"
`;

const executable = (path) => { try { accessSync(path, constants.X_OK); return true; } catch { return false; } };

// Created and running containers both count: test-box creates before it starts.
async function blockers() {
  const { stdout } = await docker(["ps", "-a", "--filter", "status=created", "--filter", "status=running",
    "--format", "{{.Names}}"]);
  const names = stdout.split("\n").map((line) => line.trim()).filter(Boolean);
  return blockingContainers(names, parseIgnoreList(process.env.GTEKI_BOX_IDLE_IGNORE));
}

// Best effort and never throws: the test result's exit code always wins.
// OrbStack's VM keeps freed guest memory, so only stopping it gives RAM back.
async function stopIdleVm() {
  if (process.env.GTEKI_BOX_STOP_VM === "0") return;
  try {
    // Only on the OrbStack backend; plain Docker/Linux skips silently.
    const orbctl = findOnPath("orbctl", process.env.PATH, executable);
    if (!orbctl || !isOrbStackContext((await docker(["context", "show"])).stdout)) return;
    let blocking = await blockers();
    if (!blocking.length) {
      console.log("test:heavy:box: VM idle, stopping OrbStack to release memory");
      blocking = await blockers(); // revalidate: another box may have started meanwhile
      if (!blocking.length) {
        await promisify(execFile)(orbctl, ["stop"]);
        return;
      }
      console.log(`test:heavy:box: a container appeared (${blocking.join(", ")}); VM staying up`);
      return;
    }
    console.log(`test:heavy:box: other containers running (${blocking.join(", ")}); leaving VM up`);
  } catch {}
}

async function main() {
  const info = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (info.error || info.status !== 0) {
    throw new Error(`Docker is unavailable; start OrbStack/Docker and ensure 'docker info' succeeds.\n${info.error?.message ?? info.stderr.trim()}`);
  }

  const mb = memoryMb();
  const memory = `${mb}m`;
  const heap = process.env.GTEKI_TEST_HEAP_MB ?? String(Math.max(1, Math.floor(mb * 0.75)));
  const reports = join(root, ".qa");
  mkdirSync(reports, { recursive: true });
  const args = [
    "create", "--name", name, "--init",
    "--memory", memory, "--memory-swap", memory, "--cpus", cpus,
    "--mount", mount("type=volume", "source=gteki-box-pnpm", "target=/pnpm"),
    "--mount", mount("type=bind", `source=${root}`, "target=/src", "readonly"),
    "--mount", mount("type=bind", `source=${reports}`, "target=/w/.qa"),
    "--env", "PNPM_HOME=/pnpm",
    "--env", "COREPACK_ENABLE_DOWNLOAD_PROMPT=0",
    "--env", `GTEKI_TEST_HEAP_MB=${heap}`,
    image, "bash", "-euo", "pipefail", "-c", command, "test-box",
    ...process.argv.slice(2),
  ];

  console.log(`test:heavy:box: memory=${memory}, cpus=${cpus}, worker heap=${heap} MB`);
  let id;
  let started = false;
  let cancelled;
  let interrupted; // set only if a signal arrived before the container exited by itself
  let code = 1;
  const kills = [];
  const stop = (signal) => {
    const repeat = cancelled;
    cancelled ||= signal;
    if (!started) return;
    // Vitest handles SIGINT/SIGTERM by letting the running test finish, so stop
    // (SIGTERM, then SIGKILL after 3s) is used. A second signal kills at once.
    if (repeat) { kills.push(docker(["kill", id]).catch(() => {})); return; }
    kills.push((async () => {
      // `docker stop` is a silent no-op until the container is running, so
      // re-issue it until the attach client exits.
      while (started) {
        await docker(["stop", "--time", "3", id]).catch(() => {});
        if (started) await setTimeout(1000);
      }
    })());
  };
  const signals = { SIGINT: 130, SIGHUP: 129, SIGTERM: 143 };
  const handlers = Object.keys(signals).map((signal) => [signal, () => stop(signal)]);
  for (const [signal, handler] of handlers) process.on(signal, handler);
  try {
    try {
      id = (await docker(args)).stdout.trim();
    } catch (error) {
      if (cancelled) return signals[cancelled];
      console.error(error.stderr?.trim() || error.message);
      return typeof error.code === "number" ? error.code || 1 : 1;
    }
    interrupted = cancelled;
    if (!cancelled) {
      started = true;
      try {
        await new Promise((resolve, reject) => {
          const child = spawn("docker", ["start", "--attach", id], { stdio: "inherit" });
          child.once("error", reject);
          child.once("exit", resolve);
        });
      } finally {
        started = false;
      }
      await Promise.all(kills);
      interrupted = cancelled;
      const inspection = await docker(["inspect", "--format", "{{json .State}}", id]);
      const state = JSON.parse(inspection.stdout);
      if (state.OOMKilled) {
        console.error(`killed by the container memory limit (${memory}); raise GTEKI_BOX_MEMORY (OrbStack VM memory caps the total).`);
      }
      code = state.Status === "exited" ? state.ExitCode : state.ExitCode || 1;
    }
  } catch (error) {
    console.error(`test:heavy:box: ${error.stderr?.trim() || error.message}`);
  } finally {
    await Promise.all(kills);
    // An interrupted create may still finish on the daemon, so retry by name once.
    if (!id && cancelled) await docker(["rm", "-f", name]).catch(() => setTimeout(1000));
    try { await docker(["rm", "-f", id ?? name]); } // a name is safe: it is a random UUID
    catch (error) {
      // Without an id, "no such container" just means create never happened.
      if (id) console.error(`test:heavy:box: container cleanup failed: ${error.stderr?.trim() || error.message}`);
    }
    for (const [signal, handler] of handlers) process.off(signal, handler);
    // Handlers are gone, so a further signal terminates the process at once.
    await stopIdleVm();
  }
  return interrupted ? signals[interrupted] : code;
}

try {
  process.exitCode = await main();
} catch (error) {
  console.error(`test:heavy:box: ${error.message}`);
  process.exitCode = 1;
}
