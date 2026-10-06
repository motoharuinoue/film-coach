// デモの合成データで、画面に出るはずの値を求める。composition.ts と同じ組み合わせで、画面と同じドメインの計算を通す。
// 数値を写し取って書かないので、合成データや重み付けを変えても、テストを直さずに済む。

import { CoachService } from "../../src/application/coach";
import { DemoReferenceRepository, DemoSessionRepository } from "../../src/infrastructure/demo/repositories";
import { TemplateFindingWriter } from "../../src/infrastructure/writer/templateFindingWriter";

export const coach = new CoachService({ sessions: new DemoSessionRepository(), references: new DemoReferenceRepository(), writer: new TemplateFindingWriter() });

/** 既定の手動調整での基準 */
export const bench = coach.benchmarks();

/** ホームで取り上げるセッションとレップ */
export const focus = coach.focus();

export const player = coach.player();
