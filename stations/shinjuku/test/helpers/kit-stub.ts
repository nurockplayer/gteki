/**
 * A small stub kit for the swap tests: a manifest in the real `gteki-asset/0.1` shape plus stub geometry.
 * It exists so the tests do not depend on the real GLBs; the real manifests are used separately for the
 * tier-parity checks. Nothing here describes a real piece of equipment.
 */
import * as THREE from "three";
import type { KitAssetProvider } from "../../scene/kit/types.ts";

export const stubAsset = (id: string, family: string, placement: string, extra: Record<string, unknown> = {}) => ({
  id,
  family,
  file: `glb/${id}.glb`,
  bytes: 1000,
  triangles: 100,
  materials: ["stub_palette"],
  textures: { stub_palette: { res: 64, maps: ["albedo"] } },
  bounds_m: { min: [-0.9, 0, -0.3], max: [0.9, 2.7, 0.9] },
  placement,
  params: {},
  sockets: [],
  ...extra,
});

/** Triangle counts Lane E gave as estimates for the PR #143 pieces (comb+newel escalator, nosing-only stair); the gate and lift are stubs. */
export const STUB_TRIANGLES = { escalator: 1352, stairs: 180, gate: 1800, lift: 1090, toilet: 100 } as const;

interface CatalogLike {
  assets: { id: string; generator: string; params: Record<string, unknown>; tags: string[] }[];
}

/**
 * Manifest entries a Lane E build of Shinjuku's station catalog would produce, with stub triangle counts. Params are
 * the catalog params plus the derived values the generators add (comb_run_m, aisle centres and widths, cabinet span).
 */
export function catalogStubAssets(catalog: CatalogLike) {
  return catalog.assets.map((e) => {
    const p = e.params;
    if (e.generator === "gate_array") {
      return stubAsset(e.id, "gate", "linear", {
        triangles: STUB_TRIANGLES.gate,
        tags: e.tags,
        params: { ...p, aisle_centers_x_m: [0], aisle_widths_m: [p.wide_w], cabinet_span_z_m: [-0.3, -1.6] },
        bounds_m: { min: [-0.7, 0, -1.9], max: [0.7, 1, 0] },
        sockets: [{ name: "start", position_gltf: [0, 0, 0], yaw_deg: 180 }, { name: "end", position_gltf: [0, 0, -1.9], yaw_deg: 0 }],
      });
    }
    const escalator = e.generator === "escalator_dressing";
    return stubAsset(e.id, "dressing", "linear", {
      triangles: escalator ? STUB_TRIANGLES.escalator : STUB_TRIANGLES.stairs,
      tags: e.tags,
      materials: escalator ? ["stub_steel", "stub_yellow"] : ["stub_yellow"],
      textures: {},
      params: escalator ? { ...p, comb_run_m: (p.run_mm as number) / 1000 + 1.6 } : p, // dressing.py: run_mm + 2 flat sections
    });
  });
}

/** The Shinjuku stub library: station-catalog pieces, a lift portal with the real mobile triangle count, and a toilet piece. */
export function shinjukuStubManifestJson(catalog: CatalogLike) {
  return stubManifestJson({
    remove: ["stub_gate_1aisle", "stub_lift_portal"],
    extra: [
      ...catalogStubAssets(catalog),
      stubAsset("stub_lift_portal_mobile", "vertical", "wall", {
        triangles: STUB_TRIANGLES.lift,
        materials: ["stub_palette", "gteki_line_accent"],
        textures: { stub_palette: { res: 64, maps: ["albedo"] } },
        sockets: [{ name: "start", position_gltf: [0, 0, 0], yaw_deg: 180 }, { name: "end", position_gltf: [0, 0, -0.26], yaw_deg: 0 }],
        bounds_m: { min: [-0.92, -0.16, -0.26], max: [0.92, 2.7, 0.9] },
      }),
    ],
  });
}

export function stubManifestJson(overrides: { extra?: unknown[]; remove?: string[] } = {}) {
  const assets = [
    // A single-aisle gate pair, the piece Shinjuku's one-aisle gate rows need.
    stubAsset("stub_gate_1aisle", "gate", "linear", {
      params: { aisles: 1, aisle_centers_x_m: [0], aisle_widths_m: [1.02], cabinet_span_z_m: [-1.6, -0.3] },
      bounds_m: { min: [-0.7, 0, -1.9], max: [0.7, 1, 0] },
      sockets: [{ name: "start", position_gltf: [0, 0, 0], yaw_deg: 180 }, { name: "end", position_gltf: [0, 0, -1.9], yaw_deg: 0 }],
    }),
    // A multi-aisle array: must never be chosen for a one-aisle gate row.
    stubAsset("stub_gate_4aisle", "gate", "linear", {
      params: { aisles: 4, aisle_centers_x_m: [-1.38, -0.56, 0.26, 1.23], cabinet_span_z_m: [-1.6, -0.3] },
      bounds_m: { min: [-1.95, 0, -1.9], max: [1.95, 1, 0] },
    }),
    stubAsset("stub_lift_portal", "vertical", "wall", {
      materials: ["stub_palette", "gteki_line_accent"],
      textures: { stub_palette: { res: 64, maps: ["albedo"] } },
      sockets: [{ name: "start", position_gltf: [0, 0, 0], yaw_deg: 180 }, { name: "end", position_gltf: [0, 0, -0.26], yaw_deg: 0 }],
      bounds_m: { min: [-0.92, -0.16, -0.26], max: [0.92, 2.7, 0.9] },
    }),
    stubAsset("stub_toilet_entrance", "props", "wall", { tags: ["toilet"], bounds_m: { min: [-0.35, 0, -0.1], max: [0.35, 2.4, 0.3] } }),
    // Pieces Shinjuku has no source anchor for. They must stay unplaced whatever the manifest offers.
    stubAsset("stub_bench_4seat", "props", "free"),
    stubAsset("stub_vending_machine", "props", "wall"),
    stubAsset("stub_ticket_kiosk", "props", "wall"),
    stubAsset("stub_shop_front", "props", "wall", { tags: ["shop"] }),
    ...(overrides.extra ?? []),
  ].filter((a) => !(overrides.remove ?? []).includes((a as { id: string }).id));
  return { contract: "gteki-asset/0.1", kit_version: "0.0.0-stub", profile: "mobile", license: "STUB LICENCE STRING", assets };
}

const material = (name: string, color: string) => {
  const m = new THREE.MeshStandardMaterial({ color });
  m.name = name;
  return m;
};

/** Stub geometry for every stub asset: a visual box, a collision box and a socket empty, as in a real kit GLB. */
export function stubProvider(): KitAssetProvider & { materials: Map<string, THREE.MeshStandardMaterial>; instantiated: string[] } {
  const materials = new Map<string, THREE.MeshStandardMaterial>([
    ["stub_palette", material("stub_palette", "#808080")],
    ["gteki_line_accent", material("gteki_line_accent", "#ffffff")],
  ]);
  const instantiated: string[] = [];
  return {
    materials,
    instantiated,
    instantiate(a) {
      instantiated.push(a.id);
      const root = new THREE.Group();
      root.name = a.id;
      const vis = (name: string, mat: string, w: number, h: number, d: number) => {
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), materials.get(mat)!);
        mesh.name = name;
        mesh.position.set(0, h / 2, -d / 2);
        return mesh;
      };
      const body = vis("VIS_body", "stub_palette", 1.2, 1, 1);
      // A bundle importer renames repeated node names and keeps the contract name in extras.
      body.userData.gteki_name = "VIS_body";
      body.name = "VIS_body_1";
      root.add(body);
      if (a.materials.includes("gteki_line_accent")) root.add(vis("VIS_stripe", "gteki_line_accent", 1.2, 0.1, 0.02));
      const col = vis("COL_body-colonly", "stub_palette", 5, 5, 5); // must never be drawn
      root.add(col);
      const socket = new THREE.Object3D();
      socket.name = "SOCKET_end";
      root.add(socket);
      const hint = new THREE.Object3D();
      hint.name = "LIGHTHINT_a";
      root.add(hint);
      return root;
    },
  };
}
