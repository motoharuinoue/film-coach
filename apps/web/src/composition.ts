// コンポジションルート：ポートの実装（infrastructure）をアプリケーション層に差し込む。
// 依存の向きを内側に保つため、infrastructure を import してよいのはここだけ。

import { CoachService, type Services } from "./application/coach";
import { LocalStorageManualStore } from "./infrastructure/browser/localStorageManualStore";
import { DemoReferenceRepository, DemoSessionRepository } from "./infrastructure/demo/repositories";
import { TemplateFindingWriter } from "./infrastructure/writer/templateFindingWriter";

export function createServices(): Services {
  const coach = new CoachService({
    sessions: new DemoSessionRepository(),
    references: new DemoReferenceRepository(),
    writer: new TemplateFindingWriter(),
  });
  return { coach, manualStore: new LocalStorageManualStore() };
}
