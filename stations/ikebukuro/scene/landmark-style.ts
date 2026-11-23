// Shared look for landmark buildings (department stores, Sunshine City), one look for both
// stations. Art-director direction 2026-11-22 02:33 JST (lead-board accept-depato), provisional
// until the Owner sees it. A store is recognised by its real building and its plain name, never
// by brand dress: no logos, wordmarks, brand colours or patterns.

/** Facade albedo swatches (sRGB), picked by the real building's dominant facade family. */
export const LANDMARK_FACADE = {
  F1_stoneBeige: "#B8AD9C",
  F2_warmGrey: "#9D978F",
  F3_coolGrey: "#8F969C",
  F4_darkBronze: "#4E4740",
  /** Glass curtain wall: roughness 0.2, environment reflection only. */
  F5_blueGreyGlass: "#6E7A84",
} as const;
export type LandmarkFacade = keyof typeof LANDMARK_FACADE;
export const LANDMARK_GLASS_ROUGHNESS = 0.2;

/** Upper-floor rhythm for "blind" facades (most 百貨店): geometry or normal map, no photo texture. */
export const LANDMARK_FLOOR_JOINT_M = 4.5;
export const LANDMARK_PIER_SPACING_M: readonly [number, number] = [6, 8];

/** Street band: shut glazed shopfront, bronze mullions, warm glow behind; nothing above it is emissive. */
export const LANDMARK_STREET_BAND = {
  heightM: [4, 5] as const,
  mullionSpacingM: [2.5, 3.5] as const,
  maxDepthM: 1.5,
  glow: "#FFD9A8",
  maxEmissive: 0.5,
} as const;

/** Name sign, same construction on every store. */
export const LANDMARK_SIGN = {
  band: "#3A3029",
  bandRoughness: 0.5,
  letters: "#F2ECE0",
  letterEmissive: [0.6, 0.8] as const,
  /** en line height relative to the ja line. */
  enScale: 0.45,
  maxJaLetterM: 4,
  maxJaLetterSunshine60M: 6,
  maxPerBuilding: 2,
  /** Door sign above the station-side entrance. */
  doorJaLetterM: [0.25, 0.35] as const,
  /** Landmark sign mean luminance ≤ this × the wayfinding sign's in any frame showing both. */
  maxLuminanceVsWayfinding: 0.85,
  minLetterContrast: 3,
} as const;

/** Phone budget per store. */
export const LANDMARK_MAX_DRAW_CALLS = 3;
export const LANDMARK_MAX_TEXTURE_PX = 512;
