const progress = { start: .05, stations: .15, data: .35, graph: .45, scene: .6, composer: .85, ready: .95, settled: 1 } as const;
export type BootStage = keyof typeof progress;
export function bootProgress(stage: BootStage): number { return progress[stage]; }

export class FrameReadiness {
  private consecutive = 0;
  push(dtMs: number, elapsedMs: number): boolean {
    this.consecutive = dtMs < 100 ? this.consecutive + 1 : 0;
    return this.consecutive >= 6 || elapsedMs >= 3000;
  }
}
