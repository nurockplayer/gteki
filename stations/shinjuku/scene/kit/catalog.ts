/**
 * Shinjuku's station catalog for the Lane E kit (Issue #94): one entry per distinct stair run, escalator run and
 * single-aisle gate row, in the same entry shape as `tools/blender/catalog/kit_v0_1.json`. Lane E builds it with
 * `CATALOG=stations/shinjuku/kit/catalog.json sh tools/blender/build.sh`; we bundle with `bundle_kit.py` ourselves.
 *
 * Every parameter is derived from the geometry the scene already draws (the layout and the fare protection), never
 * from a source we do not have. Shinjuku heights are symbolic (station.json `hM` is null), so rises are the scene's
 * drawn rises, not surveyed: `dimension_basis` is therefore `synthetic`, never `station-verified`.
 *
 * Pure: no THREE, no I/O. `tools/kit-catalog.ts` writes the JSON; `test/kit-catalog.test.ts` checks it against a
 * fresh derivation, so it cannot drift from the data without a failing test.
 */
import type { FareProtection } from "../fare-fence.ts";
import type { Layout } from "../layout.ts";
import { gateRowAnchors, runAnchors } from "./anchors.ts";
import { ESCALATOR_FLAT_STEPS, ESCALATOR_STEP_DEPTH_M, ESCALATOR_STEP_INSET_M, ESCALATOR_TRANSITION_M, GATE_CLEAR_RANGE_M, RUN_FIT } from "./config.ts";
import type { GateRowAnchor, RunAnchor } from "./types.ts";

export const CATALOG_NAME = "gteki-station-shinjuku";
export const CATALOG_VERSION = "0.1.0";
export const CATALOG_ID_PATTERN = /^gteki_[a-z0-9_]+$/;

/** build.ts steps a stair at about this riser: `steps = max(2, round(rise / 0.165))`. Mirrored in the test through the ledger. */
export const STAIR_RISER_TARGET_M = 0.165;
/** Kit default clear width of the single-aisle array (`gteki_gate_array_1w`). A visual default, not a Shinjuku fact. */
export const GATE_CLEAR_DEFAULT_M = 1.02;
export const ESCALATOR_LANDING_MM = 800;
/** Stair and escalator dressings use a 128 x 128 AO map (`ao_res`) to keep the mobile kit texture total near 3.1 MB (8.9 MB at full size, budget 8 MB). The gate array keeps the kit default. */
export const DRESSING_AO_RES = 128;
export const AO_RES_SIZES = [128, 256, 512, 1024] as const;
export type AoRes = (typeof AO_RES_SIZES)[number];

/** Quantisation of grouped runs, chosen so the worst-case position error stays under 15 cm, inside RUN_FIT; each entry records its own. */
const STAIR_RISER_STEP_MM = 2;
const STAIR_TREAD_STEP_MM = 10;
const ESCALATOR_RISE_STEP_MM = 100;
const ESCALATOR_RUN_STEP_MM = 250;

export type CatalogParams = Record<string, unknown>;

export interface CatalogEntry {
  id: string;
  generator: "stair_dressing" | "escalator_dressing" | "gate_array";
  params: CatalogParams;
  /** Kit AO map size (build.py `ao_res`, both tiers). Set on stair and escalator dressings only. */
  ao_res?: AoRes;
  /**
   * Explicit null on stair and escalator dressings: the pieces are visual-only. Without it Lane E's builder tags stair
   * nosings `stairs_ramps` (walkable in scene-api/Godot) and escalator parts `transport` (colliders). Gate rows set none.
   */
  gteki_role?: null;
  /** Explicit false on the gate array: Lane E strips its COL_* nodes, so Godot builds no StaticBody. Dressings omit it (no collision is emitted). */
  collision?: false;
  tags: string[];
  dimension_basis: "synthetic";
  /** Per-entry derivation record: how each param was obtained and what it is not. */
  notes: string;
}

export interface StationCatalog {
  catalog: string;
  version: string;
  notes: string;
  assets: CatalogEntry[];
}

export interface UnfittedRun {
  role: "stairs" | "escalator";
  edgeId: string;
  reason: string;
}

export interface CatalogResult {
  catalog: StationCatalog;
  /** anchor key (graph edge id) to the catalog id that fits it. */
  byAnchor: Map<string, string>;
  unfitted: UnfittedRun[];
}

const mm = (m: number, stepMm = 1) => Math.round((m * 1000) / stepMm) * stepMm;
/** Graph edge ids look like `e:<32 hex>`; the first 8 hex characters name the catalog entry (sorted-first run of a group). */
const shortId = (edgeId: string) => edgeId.replace(/^e:/, "").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 8);
const sortedByEdge = <T extends { key: string }>(xs: T[]) => [...xs].sort((a, b) => a.key.localeCompare(b.key));

interface Group<A> {
  params: CatalogParams;
  runs: A[];
  maxRiseErrM: number;
  maxRunErrM: number;
}

function group<A extends { key: string }>(items: { anchor: A; params: CatalogParams; riseErr: number; runErr: number }[]): Group<A>[] {
  const groups = new Map<string, Group<A>>();
  for (const it of items) {
    const k = JSON.stringify(it.params);
    const g = groups.get(k) ?? { params: it.params, runs: [], maxRiseErrM: 0, maxRunErrM: 0 };
    g.runs.push(it.anchor);
    g.maxRiseErrM = Math.max(g.maxRiseErrM, it.riseErr);
    g.maxRunErrM = Math.max(g.maxRunErrM, it.runErr);
    groups.set(k, g);
  }
  return [...groups.values()].map((g) => ({ ...g, runs: sortedByEdge(g.runs) })).sort((a, b) => a.runs[0]!.key.localeCompare(b.runs[0]!.key));
}

const geometry = (a: RunAnchor) => ({ rise: a.hi.z - a.lo.z, length: Math.hypot(a.hi.x - a.lo.x, a.hi.y - a.lo.y) });
const edgeList = (runs: { key: string }[]) => runs.map((r) => r.key).join(", ");
const cm = (m: number) => `${(m * 100).toFixed(1)} cm`;

const HEIGHTS =
  "Shinjuku heights are symbolic (station.json hM is null), so every dimension below is the rise, length and width the scene draws " +
  "between the two end nodes of the graph edge, not a survey.";

// --------------------------------------------------------------------- stairs

export function stairParams(a: RunAnchor): { params: CatalogParams; riseErr: number; runErr: number } | { reason: string } {
  const { rise, length } = geometry(a);
  const steps = Math.max(2, Math.round(rise / STAIR_RISER_TARGET_M));
  if (steps > 80) return { reason: `step_count ${steps} is above the kit maximum of 80` };
  const params = {
    step_count: steps,
    riser_mm: mm(rise / steps, STAIR_RISER_STEP_MM),
    tread_mm: mm(length / steps, STAIR_TREAD_STEP_MM),
    width_mm: mm(a.width),
    parts: ["nosing"],
  };
  return { params, riseErr: Math.abs((steps * params.riser_mm) / 1000 - rise), runErr: Math.abs((steps * params.tread_mm) / 1000 - length) };
}

function stairNotes(g: Group<RunAnchor>): string {
  const p = g.params as { step_count: number; riser_mm: number; tread_mm: number; width_mm: number };
  const geo = geometry(g.runs[0]!);
  return [
    `Nosing strips for ${g.runs.length} drawn stair run(s), graph edges: ${edgeList(g.runs)}.`,
    HEIGHTS,
    `step_count = max(2, round(rise / 0.165)) = ${p.step_count}, the stepping scene/build.ts draws (first run: rise ${geo.rise.toFixed(2)} m, plan length ${geo.length.toFixed(2)} m).`,
    `riser_mm = rise / step_count, rounded to ${STAIR_RISER_STEP_MM} mm; tread_mm = plan length of the edge / step_count, rounded to ${STAIR_TREAD_STEP_MM} mm.`,
    `Rounding moves the top nosing by at most ${cm(g.maxRiseErrM)} in height and ${cm(g.maxRunErrM)} along the run for the grouped runs.`,
    `width_mm = the scene's width-class estimate (MLIT width class 1 to 4, a visual estimate, not a measurement).`,
    `parts: nosing only; the scene already draws the stair handrails and side walls. Origin: floor under the first nosing = the lower end node of the edge.`,
  ].join(" ");
}

// ----------------------------------------------------------------- escalators

/** Comb-to-comb horizontal extent of the dressing beyond its `run_mm`: two flat step sections and one transition. */
export const ESCALATOR_COMB_EXTRA_M = 2 * ESCALATOR_FLAT_STEPS * ESCALATOR_STEP_DEPTH_M + ESCALATOR_TRANSITION_M;

export function escalatorParams(a: RunAnchor): { params: CatalogParams; riseErr: number; runErr: number } | { reason: string } {
  const { rise, length } = geometry(a);
  const params = {
    rise_mm: mm(rise, ESCALATOR_RISE_STEP_MM),
    width_mm: mm(a.width - ESCALATOR_STEP_INSET_M),
    run_mm: mm(length - ESCALATOR_COMB_EXTRA_M, ESCALATOR_RUN_STEP_MM),
    landing_mm: ESCALATOR_LANDING_MM,
    flat_steps: ESCALATOR_FLAT_STEPS,
    parts: ["comb", "newel"],
  };
  const problem = escalatorProblem(params);
  if (problem) return { reason: `${problem} (drawn rise ${rise.toFixed(2)} m over ${length.toFixed(2)} m)` };
  return { params, riseErr: Math.abs(params.rise_mm / 1000 - rise), runErr: Math.abs(params.run_mm / 1000 + ESCALATOR_COMB_EXTRA_M - length) };
}

function escalatorNotes(g: Group<RunAnchor>): string {
  const p = g.params as { rise_mm: number; width_mm: number; run_mm: number };
  const geo = geometry(g.runs[0]!);
  return [
    `Comb plates and newels for ${g.runs.length} drawn escalator run(s), graph edges: ${edgeList(g.runs)}.`,
    HEIGHTS,
    `rise_mm = drawn rise rounded to ${ESCALATOR_RISE_STEP_MM} mm (first run: ${geo.rise.toFixed(2)} m).`,
    `run_mm = plan length of the edge (${geo.length.toFixed(2)} m for the first run) minus ${ESCALATOR_COMB_EXTRA_M.toFixed(1)} m, rounded to ${ESCALATOR_RUN_STEP_MM} mm,`,
    `so that the comb-to-comb run of the piece (run_mm + 2 x ${ESCALATOR_FLAT_STEPS} flat steps x ${ESCALATOR_STEP_DEPTH_M} m + ${ESCALATOR_TRANSITION_M} m transition) lands the two comb lines on the two end nodes;`,
    `the implied incline is ${((Math.atan2(p.rise_mm, p.run_mm) * 180) / Math.PI).toFixed(1)} degrees.`,
    `Rounding moves the top comb by at most ${cm(g.maxRiseErrM)} in height and ${cm(g.maxRunErrM)} along the run for the grouped runs.`,
    `width_mm = scene escalator width estimate (1.25 m for every escalator, a visual constant) minus the ${ESCALATOR_STEP_INSET_M} m the scene takes off for the steps.`,
    `landing_mm and flat_steps are the kit defaults, written out so the build is reproducible; they are not Shinjuku facts.`,
    `parts: comb and newel only; truss, steps, balustrade panels and handrails stay as drawn by the scene. Origin: bottom comb line = the lower end node of the edge.`,
  ].join(" ");
}

// ----------------------------------------------------------------------- gates

export function gateParams(): CatalogParams {
  return { aisles: 1, wide_aisles: [0], wide_w: GATE_CLEAR_DEFAULT_M };
}

function gateNotes(runs: GateRowAnchor[]): string {
  return [
    `Single-aisle gate array for ${runs.length} verified gate row(s), graph edges: ${edgeList(runs)}.`,
    `wide_w ${GATE_CLEAR_DEFAULT_M} m is the kit default clear width and a visual default: no source in this dataset states a gate clear width, and no count of gates is claimed.`,
    `It matches the +/-0.62 m machine spacing the scene already draws (half of ${GATE_CLEAR_DEFAULT_M} m plus half of a 0.22 m cabinet), itself a visual simplification.`,
    `Equal to the kit's own gteki_gate_array_1w; kept as a station entry so a source-stated width can later be set per row (kit range ${GATE_CLEAR_RANGE_M[0]} to ${GATE_CLEAR_RANGE_M[1]} m) without touching the placement.`,
    `Gate flaps rest open (kit default).`,
  ].join(" ");
}

// ------------------------------------------------------------------- validation

/** Mirrors the generator checks of `escalator_dressing` and `vertical.escalator` in Lane E PR #143. */
export function escalatorProblem(p: CatalogParams): string | null {
  const num = (k: string) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null);
  const rise = num("rise_mm"), width = num("width_mm"), run = num("run_mm"), landing = num("landing_mm"), flat = num("flat_steps");
  if (rise === null || rise <= 0 || width === null || width <= 0 || run === null || run <= 0 || landing === null || landing <= 0) return "escalator params must be finite positive numbers";
  if (flat !== 2 && flat !== 3) return "flat_steps must be 2 or 3";
  const angle = (Math.atan2(rise, run) * 180) / Math.PI;
  if (angle < 15 || angle > 35) return `incline ${angle.toFixed(1)} degrees is outside the kit range 15 to 35`;
  if (run / 1000 - ESCALATOR_TRANSITION_M <= 0) return "run_mm is too small for the transition run";
  return null;
}

/** Schema-shape and range check of a catalog, against the kit catalog format and the generator ranges. Returns problems. */
export function validateStationCatalog(json: unknown): string[] {
  const problems: string[] = [];
  const c = json as Partial<StationCatalog> | null;
  if (!c || typeof c !== "object") return ["catalog is not an object"];
  for (const k of ["catalog", "version", "notes"] as const) if (typeof c[k] !== "string" || !c[k]) problems.push(`missing ${k}`);
  if (!Array.isArray(c.assets) || !c.assets.length) return [...problems, "assets must be a non-empty array"];
  const seen = new Set<string>();
  for (const e of c.assets as CatalogEntry[]) {
    const where = `entry ${e?.id}`;
    if (typeof e?.id !== "string" || !CATALOG_ID_PATTERN.test(e.id)) { problems.push(`${where}: id must match ${CATALOG_ID_PATTERN}`); continue; }
    if (seen.has(e.id)) problems.push(`${where}: duplicate id`);
    seen.add(e.id);
    if (typeof e.generator !== "string") problems.push(`${where}: generator missing`);
    if (!Array.isArray(e.tags) || !e.tags.every((t) => typeof t === "string")) problems.push(`${where}: tags must be strings`);
    if (e.dimension_basis === ("station-verified" as string)) problems.push(`${where}: dimension_basis must not claim station-verified`);
    if (typeof e.notes !== "string" || e.notes.length < 80) problems.push(`${where}: notes must record the derivation`);
    const p = e.params ?? {};
    const num = (k: string) => (typeof p[k] === "number" && Number.isFinite(p[k]) ? (p[k] as number) : null);
    const parts = Array.isArray(p.parts) ? (p.parts as unknown[]) : null;
    const dressing = e.generator === "stair_dressing" || e.generator === "escalator_dressing";
    if (dressing ? e.ao_res !== DRESSING_AO_RES : e.ao_res !== undefined) {
      problems.push(dressing ? `${where}: ao_res must be ${DRESSING_AO_RES}` : `${where}: ao_res is set on stair and escalator dressings only`);
    }
    const role = (e as { gteki_role?: unknown }).gteki_role;
    if (dressing ? role !== null : role !== undefined) {
      problems.push(dressing ? `${where}: gteki_role must be null (visual-only kit piece)` : `${where}: gteki_role is set on stair and escalator dressings only`);
    }
    const collision = (e as { collision?: unknown }).collision;
    if (e.generator === "gate_array" ? collision !== false : collision !== undefined) {
      problems.push(e.generator === "gate_array" ? `${where}: collision must be false (Lane E strips the COL_* nodes)` : `${where}: collision is set on the gate array only`);
    }
    if (e.ao_res !== undefined && !(AO_RES_SIZES as readonly unknown[]).includes(e.ao_res)) problems.push(`${where}: ao_res must be one of ${AO_RES_SIZES.join(", ")}`);
    if (e.generator === "stair_dressing") {
      const n = num("step_count");
      if (n === null || !Number.isInteger(n) || n < 2 || n > 80) problems.push(`${where}: step_count must be an integer 2 to 80`);
      for (const k of ["riser_mm", "tread_mm", "width_mm"]) if ((num(k) ?? 0) <= 0) problems.push(`${where}: ${k} must be positive`);
      if (!parts || parts.length !== 1 || parts[0] !== "nosing") problems.push(`${where}: parts must be ["nosing"]`);
      if (!e.tags.includes("stair")) problems.push(`${where}: tags must include stair`);
    } else if (e.generator === "escalator_dressing") {
      const bad = escalatorProblem(p);
      if (bad) problems.push(`${where}: ${bad}`);
      if (!parts || parts.length !== 2 || !parts.includes("comb") || !parts.includes("newel")) problems.push(`${where}: parts must be ["comb","newel"]`);
      if (!e.tags.includes("escalator")) problems.push(`${where}: tags must include escalator`);
    } else if (e.generator === "gate_array") {
      const w = num("wide_w");
      if (p.aisles !== 1) problems.push(`${where}: gate rows are single-aisle`);
      if (w === null || w < GATE_CLEAR_RANGE_M[0] || w > GATE_CLEAR_RANGE_M[1]) problems.push(`${where}: wide_w must be ${GATE_CLEAR_RANGE_M[0]} to ${GATE_CLEAR_RANGE_M[1]}`);
      if (!Array.isArray(p.wide_aisles) || p.wide_aisles.length !== 1 || p.wide_aisles[0] !== 0) problems.push(`${where}: wide_aisles must be [0]`);
      if (!e.tags.includes("gate")) problems.push(`${where}: tags must include gate`);
    } else {
      problems.push(`${where}: unexpected generator ${e.generator}`);
    }
  }
  return problems;
}

// ----------------------------------------------------------------------- build

export function buildStationCatalog(layout: Layout, protection: FareProtection): CatalogResult {
  const byAnchor = new Map<string, string>();
  const unfitted: UnfittedRun[] = [];
  const assets: CatalogEntry[] = [];

  const runs = runAnchors(layout);
  for (const role of ["stairs", "escalator"] as const) {
    const items: { anchor: RunAnchor; params: CatalogParams; riseErr: number; runErr: number }[] = [];
    for (const anchor of runs.filter((r) => r.role === role)) {
      const r = role === "stairs" ? stairParams(anchor) : escalatorParams(anchor);
      if ("reason" in r) unfitted.push({ role, edgeId: anchor.key, reason: r.reason });
      else items.push({ anchor, ...r });
    }
    for (const g of group(items)) {
      const first = g.runs[0]!;
      const id = `gteki_sj_${role === "stairs" ? "stair" : "escalator"}_${shortId(first.key)}`;
      assets.push({
        id,
        generator: role === "stairs" ? "stair_dressing" : "escalator_dressing",
        params: g.params,
        ao_res: DRESSING_AO_RES,
        // Visual-only: no gteki_role, so Lane E tags nothing walkable or colliding. Collision, walkable floors and camera blockers stay the station's own layout geometry.
        gteki_role: null,
        tags: ["dressing", role === "stairs" ? "stair" : "escalator"],
        dimension_basis: "synthetic",
        notes: role === "stairs" ? stairNotes(g) : escalatorNotes(g),
      });
      for (const r of g.runs) byAnchor.set(r.key, id);
    }
  }

  const gates = sortedByEdge(gateRowAnchors(layout, protection));
  if (gates.length) {
    const id = `gteki_sj_gate_1w_w${Math.round(GATE_CLEAR_DEFAULT_M * 1000)}`;
    // collision false: Lane E's builder strips the gate's COL_* nodes, so Godot makes no StaticBody. The station keeps its own colliders.
    assets.push({ id, generator: "gate_array", params: gateParams(), collision: false, tags: ["gate"], dimension_basis: "synthetic", notes: gateNotes(gates) });
    for (const g of gates) byAnchor.set(g.key, id);
  }

  const catalog: StationCatalog = {
    catalog: CATALOG_NAME,
    version: CATALOG_VERSION,
    notes:
      "Shinjuku (Toei Oedo E27) station catalog for the GTEki kit: stair nosing, escalator comb plates and newels, and single-aisle gate rows, " +
      "one entry per distinct parameter set. Generated by stations/shinjuku/tools/kit-catalog.ts from the scene layout; do not hand-edit, regenerate. " +
      "All dimensions are the scene's drawn values (heights are symbolic, not surveyed): dimension_basis is synthetic. " +
      "Stair nosing and escalator comb and newel dressings use 128 x 128 AO (ao_res 128) to keep the mobile kit texture total near 3.1 MB (8.9 MB at full size, budget 8 MB). " +
      "Dressings are visual-only (gteki_role null, so no stairs_ramps or transport tag): collision, walkable floors and camera blockers stay the station's own layout geometry, certified by the fare replay. " +
      `${runs.length - unfitted.length} of ${runs.length} stair and escalator runs are covered; ${unfitted.length} stay as placeholders (outside the kit ranges).`,
    assets,
  };
  return { catalog, byAnchor, unfitted };
}

/** Largest position error of a grouped run against the kit tolerances in config.ts, for tests. */
export const CATALOG_FIT_LIMITS = { riseM: RUN_FIT.riseM, lengthM: RUN_FIT.lengthM, widthM: RUN_FIT.widthM };
