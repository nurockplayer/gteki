export const DEFAULT_IDLE_IGNORE = ["belabox-receiver"];

export function parseIgnoreList(raw) {
  if (raw === undefined) return DEFAULT_IDLE_IGNORE;
  return raw.split(",").map((item) => item.trim()).filter(Boolean);
}

// The VM is idle when no gteki box runs and every other running container is
// on the ignore list (long-lived restart=unless-stopped containers).
export function blockingContainers(runningNames, ignoreList = DEFAULT_IDLE_IGNORE) {
  return runningNames.filter((name) => name.startsWith("gteki-") || !ignoreList.includes(name));
}

export function isVmIdle(runningNames, ignoreList = DEFAULT_IDLE_IGNORE) {
  return blockingContainers(runningNames, ignoreList).length === 0;
}

// The step only applies to the OrbStack backend; plain Docker/Linux skips it.
export function isOrbStackContext(contextName) {
  return contextName.trim().toLowerCase() === "orbstack";
}

export function findOnPath(command, pathEnv, isExecutable, separator = ":") {
  return (pathEnv ?? "").split(separator).filter(Boolean)
    .map((dir) => `${dir.replace(/\/$/, "")}/${command}`).find(isExecutable);
}
