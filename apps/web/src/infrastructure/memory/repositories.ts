// 手元の解析サービスから読んだデータ（CoachData）を、デモと同じポートの形で渡すリポジトリ。
// 読み込みは application/localData.ts、ここは読んだ結果をメモリ上で返すだけ。

import type { CoachData } from "../../application/coach";
import type { ReferenceRepository, SessionRepository } from "../../application/ports";
import { pickDrill } from "../../domain/drill";
import type { MetricKey } from "../../domain/metrics";
import { formatTime } from "../../domain/youtube";

export class MemorySessionRepository implements SessionRepository {
  constructor(private readonly data: CoachData) {}
  player() {
    return this.data.player;
  }
  list() {
    return this.data.sessions;
  }
  get(id: string) {
    return this.data.sessions.find((s) => s.id === id);
  }
  focus() {
    return this.data.focus;
  }
}

export class MemoryReferenceRepository implements ReferenceRepository {
  constructor(private readonly data: CoachData) {}
  list() {
    return this.data.references;
  }
  get(id: string) {
    return this.data.references.find((r) => r.id === id);
  }
  /** 登録したドリル動画から、その指標の外れた側を直すものを選ぶ */
  drillFor(key: MetricKey, side: "low" | "high") {
    const d = pickDrill(this.data.drills, key, side);
    return d && { label: d.label, channel: d.channel, at: formatTime(d.startSec), youtubeId: d.youtubeId, startSec: d.startSec };
  }
}
