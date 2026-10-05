// 依存の向きのルール（クリーンアーキテクチャ、docs/adr/0007-clean-architecture.md）を検査する。
//   domain         → domain だけ
//   application    → domain, application
//   infrastructure → domain, application, infrastructure
//   presentation   → domain, application, presentation（infrastructure は composition.ts 経由で受け取る）
// さらに domain と application は外部パッケージ（React など）に依存しない。

import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SRC = dirname(fileURLToPath(import.meta.url));
type Layer = "domain" | "application" | "infrastructure" | "presentation" | "root";

const ALLOWED: Record<Exclude<Layer, "root">, Layer[]> = {
  domain: ["domain"],
  application: ["domain", "application"],
  infrastructure: ["domain", "application", "infrastructure"],
  presentation: ["domain", "application", "presentation"],
};
const NO_PACKAGES: Layer[] = ["domain", "application"];

function layerOf(file: string): Layer {
  const top = relative(SRC, file).split(sep)[0];
  return top === "domain" || top === "application" || top === "infrastructure" || top === "presentation" ? top : "root";
}

function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return sources(p);
    return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [p] : [];
  });
}

function imports(file: string): string[] {
  const text = readFileSync(file, "utf8");
  return [...text.matchAll(/^\s*(?:import|export)\s[^;]*?from\s+["']([^"']+)["']/gm)].map((m) => m[1]!);
}

const files = sources(SRC);

describe("アーキテクチャ（依存の向き）", () => {
  it("検査対象のファイルがある", () => {
    expect(files.length).toBeGreaterThan(10);
  });

  for (const file of files) {
    const layer = layerOf(file);
    if (layer === "root") continue;
    it(`${relative(SRC, file)}（${layer}）`, () => {
      const violations = imports(file).filter((spec) => {
        if (!spec.startsWith(".")) return NO_PACKAGES.includes(layer);
        const target = layerOf(resolve(dirname(file), spec));
        return !ALLOWED[layer].includes(target);
      });
      expect(violations).toEqual([]);
    });
  }
});
