// コンポジションルート：ポートの実装（infrastructure）をアプリケーション層に差し込む。
// 依存の向きを内側に保つため、infrastructure を import してよいのはここだけ。

import { CoachService, type Services } from "./application/coach";
import { LocalStorageManualStore } from "./infrastructure/browser/localStorageManualStore";
import { LocalStorageProfileStore } from "./infrastructure/browser/localStorageProfileStore";
import { BrowserVideoMetadataReader } from "./infrastructure/browser/videoMetadataReader";
import { DemoReferenceRepository, DemoSessionRepository } from "./infrastructure/demo/repositories";
import { SimulatedAnalysisGateway } from "./infrastructure/demo/simulatedAnalysisGateway";
import { HttpFootageLibrary } from "./infrastructure/http/httpFootageLibrary";
import { MemoryReferenceRepository, MemorySessionRepository } from "./infrastructure/memory/repositories";
import { TemplateFindingWriter } from "./infrastructure/writer/templateFindingWriter";

export function createServices(analyzerUrl = import.meta.env.VITE_ANALYZER_URL): Services {
  const sessions = new DemoSessionRepository();
  const writer = new TemplateFindingWriter();
  const coach = new CoachService({ sessions, references: new DemoReferenceRepository(), writer });
  return {
    coach,
    manualStore: new LocalStorageManualStore(),
    analysis: new SimulatedAnalysisGateway(sessions),
    videoMeta: new BrowserVideoMetadataReader(),
    footage: analyzerUrl ? new HttpFootageLibrary(analyzerUrl) : undefined,
    profile: new LocalStorageProfileStore(),
    localCoach: (data) => new CoachService({ sessions: new MemorySessionRepository(data), references: new MemoryReferenceRepository(data), writer }),
  };
}
