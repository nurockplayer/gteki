import type { StationSceneModule } from "@gteki/scene-api";

/**
 * Whether leaving a station for another one (or the explorer being disposed, `nextId = null`) must run the
 * previous station module's `releaseCaches` hook. Reopening the same station, or opening one when none was
 * on screen, never does: the module's caches are meant to survive between opens of their own station.
 */
export function shouldRelease(prevId: string | null, nextId: string | null): boolean {
  return prevId !== null && prevId !== nextId;
}

/**
 * Remembers the scene module of the station on screen so its `releaseCaches` hook can run once, when the
 * explorer leaves that station. The hook drops whatever the module keeps across opens (parsed geometry,
 * baked textures); running it between reopens of the same station would throw that work away for nothing.
 */
export class StationCaches {
  private owner: { id: string; module: StationSceneModule } | null = null;

  /**
   * Note the module of the station being opened. A station without a scene module (the L0 graph view) keeps
   * the previous owner: a reopen of the same station must not lose track of it.
   */
  remember(id: string, module: StationSceneModule | null): void {
    if (module) this.owner = { id, module };
  }

  /** Run the remembered hook when `nextId` is a different station (null: the explorer is disposing). */
  releaseFor(nextId: string | null): void {
    const owner = this.owner;
    if (!owner || !shouldRelease(owner.id, nextId)) return;
    // Forget the owner first: a hook that throws is still only attempted once.
    this.owner = null;
    try {
      owner.module.releaseCaches?.();
    } catch (err) {
      // A cache drop is best effort: it must never break the station switch that triggered it.
      console.warn("[gteki] station scene cache release failed", owner.id, err);
    }
  }
}
