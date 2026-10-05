# ADR-0007: クリーンアーキテクチャで層を分け、依存の向きをテストで守る

- 状態：採用
- 日付：2026-10-05

## 背景

このシステムには、差し替えが前提の部分が多い。

| 差し替える部分 | いま | 今後 |
|---|---|---|
| 骨格データの出どころ | 合成データ（M0） | Python の解析サービス（M1） |
| 改善点の文章 | テンプレート | Ollama のローカル LLM（M3） |
| 手動調整の保存先 | localStorage | 解析サービスの SQLite |
| 表示 | Web 画面 | PDF・静的 HTML（M3） |

判定のルール（フェーズ分割・指標・重み付け）は、これらの差し替えに影響されずに保ちたい。また、TypeScript と Python の両方に同じルールを実装するので、ルールが UI や I/O から切り離されていることが重要になる。

## 決定

### 層と依存の向き

```
presentation ─┐
              ├─→ application ─→ domain
infrastructure┘
        ↑
  composition.ts（コンポジションルート）が infrastructure をアプリケーション層に差し込む
```

| 層 | 置くもの | 依存してよい層 |
|---|---|---|
| `domain` | 骨格・フェーズ・指標・判定・重み付け・コーチングの方針・エンティティ。純粋な関数と型だけ | domain |
| `application` | ユースケース（評価・改善点・お手本の重み付け・自己ベスト）、ポート（外部への窓口のインターフェース）、`CoachService` | domain |
| `infrastructure` | ポートの実装（デモ用リポジトリ、合成データ、テンプレートの文章化、localStorage） | domain, application |
| `presentation` | React の画面・部品・フック。`CoachService` を受け取って使う | domain, application |
| ルート（`composition.ts`, `main.tsx`） | 依存を組み立てる | すべて |

- `domain` と `application` は外部パッケージ（React など）に依存しない。
- ドメインの日本語名（指標名・フェーズ名・カメラ角度名）は、ユビキタス言語としてドメインに置く。
- 解析サービス（Python、M1）も同じ考え方で `domain` / `application` / `adapters` / `infrastructure` に分ける。

### テストで守る

`apps/web/src/architecture.test.ts` が全ソースの import を読み、上の表に反する依存があれば失敗する。

## 結果

- M1 では `DemoSessionRepository` を HTTP 実装に差し替えるだけで、画面とユースケースはそのまま使える。
- ユースケースはスタブのポートでテストできる（`application/coaching.test.ts`）。
- 層をまたぐ分だけファイル数は増える。試作の速さより、差し替えのしやすさとレビューのしやすさを優先した。
