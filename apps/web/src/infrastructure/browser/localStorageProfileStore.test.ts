import { describe, expect, it } from "vitest";
import { LocalStorageProfileStore } from "./localStorageProfileStore";

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};

describe("LocalStorageProfileStore", () => {
  it("身長を保存して読み戻す。範囲の外は保存しない", () => {
    const store = new LocalStorageProfileStore(memory());
    expect(store.heightCm()).toBeUndefined();
    store.saveHeightCm(178);
    expect(store.heightCm()).toBe(178);
    store.saveHeightCm(30);
    expect(store.heightCm()).toBe(178);
  });

  it("保存先が使えなくても例外を出さない", () => {
    const broken = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    const store = new LocalStorageProfileStore(broken);
    expect(() => store.saveHeightCm(180)).not.toThrow();
    expect(store.heightCm()).toBeUndefined();
  });
});
