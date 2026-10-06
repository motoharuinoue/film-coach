// 画面の経路の一覧。App.tsx から読むので、画面を足したのにテストに書き忘れると、経路の一覧を比べるテストが失敗する。

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/presentation/App.tsx");

export const ROUTES = [...readFileSync(APP, "utf8").matchAll(/path: "([^"]+)"/g)].map((m) => m[1]!);
