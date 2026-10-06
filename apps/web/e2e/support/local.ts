// 手元の解析サービスにつなぐ設定の画面のテスト（local-*.spec.ts）で使う準備。
// テストごとに偽の解析サービスを用意し、テストの終わりに、偽の解析サービスが知らない API を画面が呼んでいないことを確かめる。

import { FakeAnalyzer } from "./analyzer";
import { expect, test as base } from "./fixtures";

export const test = base.extend<{ analyzer: FakeAnalyzer }>({
  analyzer: [
    async ({ context, problems }, use) => {
      // 外へのリクエストを止める準備（problems）のあとに登録し、解析サービスへの呼び出しだけはこちらで受ける（あとに登録したほうが先に効く）
      void problems;
      const fake = new FakeAnalyzer();
      await fake.install(context);
      await use(fake);
      expect(fake.unhandled, "偽の解析サービスにない API を呼んでいます").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
export { open } from "./fixtures";
