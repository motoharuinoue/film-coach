// デモ用のリポジトリ（メモリ上の固定データ）。M1 で解析サービスの HTTP 実装に差し替える。

import type { ReferenceRepository, SessionRepository } from "../../application/ports";
import type { MetricKey } from "../../domain/metrics";
import { DEMO_FOCUS, demoDrills, demoPlayer, demoReferences, demoSessions } from "./fixtures";

export class DemoSessionRepository implements SessionRepository {
  player() {
    return demoPlayer;
  }
  list() {
    return demoSessions;
  }
  get(id: string) {
    return demoSessions.find((s) => s.id === id);
  }
  focus() {
    const session = this.get(DEMO_FOCUS.session)!;
    return { session, rep: session.reps[DEMO_FOCUS.index]! };
  }
}

export class DemoReferenceRepository implements ReferenceRepository {
  list() {
    return demoReferences;
  }
  get(id: string) {
    return demoReferences.find((r) => r.id === id);
  }
  drillFor(key: MetricKey) {
    return demoDrills[key];
  }
}
