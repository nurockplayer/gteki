import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers(); });

async function setup(load: () => Promise<unknown>) {
  vi.resetModules();
  const fonts = { add: vi.fn(), delete: vi.fn() };
  const constructor = vi.fn();
  vi.stubGlobal("document", { fonts });
  vi.stubGlobal("FontFace", class {
    constructor(...args: unknown[]) { constructor(...args); }
    load() { return load(); }
  });
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const api = await import("./signFont.ts");
  return { ...api, fonts, constructor, warn };
}

describe("shared sign font loader", () => {
  it("does nothing without a DOM", async () => {
    vi.resetModules();
    vi.stubGlobal("document", undefined);
    vi.stubGlobal("FontFace", vi.fn());
    const { loadSignFont } = await import("./signFont.ts");
    await loadSignFont();
    expect(FontFace).not.toHaveBeenCalled();
  });

  it("waits for load, registers the variable alias, and shares one promise across tiers", async () => {
    let resolve!: () => void;
    const loaded = new Promise<void>((done) => { resolve = done; });
    const api = await setup(() => loaded);
    const first = api.loadSignFont();
    expect(api.loadSignFont()).toBe(first);
    expect(api.fonts.add).not.toHaveBeenCalled();
    resolve();
    await first;
    expect(api.constructor).toHaveBeenCalledWith("GTEki Sign JP", expect.stringContaining(".woff2"), expect.objectContaining({ weight: "500 800" }));
    expect(api.fonts.add).toHaveBeenCalledOnce();
    expect(api.warn).not.toHaveBeenCalled();
  });

  it("resolves failed loads and warns once across subsequent station switches", async () => {
    const api = await setup(() => Promise.reject(new Error("network")));
    await api.loadSignFont();
    await api.loadSignFont();
    expect(api.fonts.add).not.toHaveBeenCalled();
    expect(api.warn).toHaveBeenCalledOnce();
  });

  it("bounds a stalled load and never registers a late completion", async () => {
    vi.useFakeTimers();
    let resolve!: () => void;
    const api = await setup(() => new Promise<void>((done) => { resolve = done; }));
    const pending = api.loadSignFont();
    await vi.advanceTimersByTimeAsync(api.SIGN_FONT_TIMEOUT_MS);
    await pending;
    resolve();
    await Promise.resolve();
    expect(api.fonts.add).not.toHaveBeenCalled();
    expect(api.warn).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("continues on hosts without the FontFace API", async () => {
    const api = await setup(() => Promise.resolve());
    vi.stubGlobal("FontFace", undefined);
    await api.loadSignFont();
    expect(api.warn).toHaveBeenCalledOnce();
  });
});
