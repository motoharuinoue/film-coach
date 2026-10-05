// アプリケーション層が外側に求める窓口（ポート）。実装は infrastructure 層に置き、
// composition.ts で差し込む。M1 ではデモ実装を解析サービス（HTTP）の実装に差し替える。

import type { AnalyzedRep, Player, Reference, Session } from "../domain/entities";
import type { MetricEvaluation } from "../domain/judgement";
import type { MetricKey } from "../domain/metrics";
import type { ManualAdjust } from "../domain/weighting";

export interface SessionRepository {
  player(): Player;
  list(): Session[];
  get(id: string): Session | undefined;
  /** ホームで取り上げるレップ（最新セッションの、いちばん気になる 1 本） */
  focus(): { session: Session; rep: AnalyzedRep };
}

export interface ReferenceRepository {
  list(): Reference[];
  get(id: string): Reference | undefined;
  /** その指標を改善するドリルを解説しているお手本 */
  drillFor(key: MetricKey): { refId: string; label: string } | undefined;
}

/** お手本の手動調整（ピン留め・除外・星）の保存先 */
export interface ManualAdjustmentStore {
  load(): Record<string, ManualAdjust> | undefined;
  save(manual: Record<string, ManualAdjust>): void;
}

/**
 * 判定結果を文章にする（ADR-0003）。数値は判定結果からだけ取り、文章の側で数値を作らない。
 * いまはテンプレート、M3 で Ollama のローカル LLM の実装を足す。
 */
export interface FindingWriter {
  write(evaluation: MetricEvaluation): { title: string; body: string };
}
