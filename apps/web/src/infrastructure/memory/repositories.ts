// 手元の解析サービスから読んだデータ（CoachData）を、デモと同じポートの形で渡すリポジトリ。
// 読み込みは application/localData.ts、ここは読んだ結果をメモリ上で返すだけ。

import type { CoachData } from "../../application/coach";
import type { ReferenceRepository, SessionRepository } from "../../application/ports";

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
  /** 改善点に紐付けるドリル動画は、お手本の分類（ドリル解説）と指標の対応を付けてから推薦する（M3） */
  drillFor() {
    return undefined;
  }
}
