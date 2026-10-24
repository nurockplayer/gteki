import { describe, expect, it, vi } from "vitest";
import type { StationSceneModule } from "@gteki/scene-api";
import { Explorer } from "./explorer.ts";
import { StationCaches, shouldRelease } from "./stationCaches.ts";

/** A scene module stand-in: only the optional hook matters here (no GL, no buildScene). */
function moduleWith(releaseCaches?: () => void): StationSceneModule {
  return { buildScene: () => { throw new Error("not built in this test"); }, ...(releaseCaches ? { releaseCaches } : {}) };
}

describe("shouldRelease", () => {
  it("is true only for a station change, disposal included", () => {
    expect(shouldRelease("a", "b")).toBe(true);
    expect(shouldRelease("a", null)).toBe(true);
    expect(shouldRelease("a", "a")).toBe(false);
    expect(shouldRelease(null, "a")).toBe(false);
    expect(shouldRelease(null, null)).toBe(false);
  });
});

describe("StationCaches", () => {
  it("calls the remembered station's hook once when another station opens", () => {
    const release = vi.fn();
    const caches = new StationCaches();
    caches.remember("a", moduleWith(release));
    caches.releaseFor("b");
    expect(release).toHaveBeenCalledTimes(1);
    // Forgotten: a second switch (or a load failure that repeats it) never runs it again.
    caches.releaseFor("c");
    caches.releaseFor(null);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases at abandonment and does not release again when that station later loads", () => {
    const release = vi.fn();
    const caches = new StationCaches();
    caches.remember("a", moduleWith(release));
    caches.releaseFor("b"); // selected station's load may reject
    caches.releaseFor("b"); // successful load path is idempotent
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("never releases between reopens of the same station, and keeps the hook for the eventual change", () => {
    const release = vi.fn();
    const caches = new StationCaches();
    caches.remember("a", moduleWith(release));
    caches.releaseFor("a");
    caches.remember("a", moduleWith(release)); // reopening re-resolves the same module
    caches.releaseFor("a");
    expect(release).not.toHaveBeenCalled();
    caches.releaseFor("b");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("is a no-op for a station without a hook, or without a scene module at all", () => {
    const caches = new StationCaches();
    expect(() => caches.releaseFor("b")).not.toThrow();
    caches.remember("a", moduleWith());
    expect(() => caches.releaseFor("b")).not.toThrow();
    // The L0 graph view has no module; a station that does, later, must still be remembered.
    caches.remember("b", null);
    expect(() => caches.releaseFor("c")).not.toThrow();
  });

  it("catches a throwing hook, warns, and does not retry it", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const release = vi.fn(() => { throw new Error("cache drop failed"); });
    const caches = new StationCaches();
    caches.remember("a", moduleWith(release));
    expect(() => caches.releaseFor("b")).not.toThrow();
    expect(release).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalled();
    caches.releaseFor("b");
    expect(release).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it("keeps the previous station's module when the same station reopens without one", () => {
    const release = vi.fn();
    const caches = new StationCaches();
    caches.remember("a", moduleWith(release));
    caches.remember("a", null);
    caches.releaseFor("b");
    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("Explorer cache release call site", () => {
  // The explorer needs WebGL to construct; the release step only touches its StationCaches field, so call
  // the method on a stand-in, as labelProxies.test.ts does for buildOccluders.
  const callSite = (state: { stationCaches: StationCaches }, nextId: string | null): void => {
    (Explorer.prototype as unknown as { releaseStationCaches(this: typeof state, id: string | null): void })
      .releaseStationCaches.call(state, nextId);
  };

  const cancel = (state: {
    stationCaches: StationCaches;
    loadGeneration: number;
    clearStation(): void;
    station: unknown;
    phase: string;
    releaseStationCaches(id: string | null): void;
  }, nextId: string): void => {
    (Explorer.prototype as unknown as { cancelPendingLoad(this: typeof state, id: string): void })
      .cancelPendingLoad.call(state, nextId);
  };

  it("releases for a different station and for disposal, not for the same one", () => {
    const release = vi.fn();
    const state = { stationCaches: new StationCaches() };
    state.stationCaches.remember("a", moduleWith(release));
    callSite(state, "a");
    expect(release).not.toHaveBeenCalled();
    callSite(state, "b");
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases on dispose through the same path", () => {
    const release = vi.fn();
    const state = { stationCaches: new StationCaches() };
    state.stationCaches.remember("a", moduleWith(release));
    callSite(state, null);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it("releases at cancellation only when the selected station differs", () => {
    const release = vi.fn();
    const state = {
      stationCaches: new StationCaches(),
      loadGeneration: 0,
      clearStation: vi.fn(),
      station: {},
      phase: "scene",
      releaseStationCaches(nextId: string | null) { this.stationCaches.releaseFor(nextId); },
    };
    state.stationCaches.remember("a", moduleWith(release));
    cancel(state, "a");
    expect(release).not.toHaveBeenCalled();
    cancel(state, "b");
    expect(release).toHaveBeenCalledTimes(1);
    expect(state.loadGeneration).toBe(2);
  });
});
