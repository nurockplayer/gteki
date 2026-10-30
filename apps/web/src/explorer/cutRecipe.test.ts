import { describe, expect, it } from "vitest";
import { canonicalJson, decodeRecipe, encodeRecipe, fnv1a, RECIPE_VERSION, sha256Hex, type CutRecipe } from "./cutRecipe.ts";

describe("cut recipe", () => {
  it("matches the SHA-256 test vectors", () => {
    expect(sha256Hex("")).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(sha256Hex("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    // Two blocks: 56 bytes forces the length into a second padded block.
    expect(sha256Hex("a".repeat(56))).toBe("b35439a4ac6f0948b6d6f9e3c6af0f5f590ce20f1bde7090ef7970686ec6738a");
  });

  it("hashes FNV-1a as the reference offset and prime", () => {
    expect(fnv1a(new Uint8Array([]))).toBe(0x811c9dc5);
    expect(fnv1a(new Uint8Array([0x61]))).toBe(0xe40c292c);
  });

  it("sorts keys in canonical JSON at every level", () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: 2 }], c: 3 } })).toBe('{"a":{"c":3,"d":[{"y":2,"z":1}]},"b":1}');
  });

  it("round-trips through the binary file", () => {
    const recipe: CutRecipe = {
      version: RECIPE_VERSION, tier: "high", wellsSha256: sha256Hex("wells"), keyCount: 2, meshKeysHash: 123,
      meshes: [
        { count: 3, hash: 7, matrix: 9, hasCut: false, groups: [], codes: [], weights: [], events: [] },
        { count: 6, hash: 8, matrix: 10, hasCut: true, groups: [2, 1], codes: [0, 3, 5], weights: [0, 0, 1, 0, 0, 1, 0.25, 0.5, 0.5, 0.25, 1, 0], events: [1, 1.25, 2.5] },
      ],
    };
    const decoded = decodeRecipe(encodeRecipe(recipe));
    expect(decoded).toEqual(recipe);
  });

  it("rejects a file with a bad magic", () => {
    const bytes = encodeRecipe({ version: RECIPE_VERSION, tier: "low", wellsSha256: "", keyCount: 0, meshKeysHash: 0, meshes: [] });
    bytes[0] = 0x58;
    expect(() => decodeRecipe(bytes)).toThrow(/magic/);
  });
});
