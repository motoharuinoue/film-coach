// ManualAdjustmentStore の localStorage 実装。保存に失敗しても画面は動き続けるようにする。

import type { ManualAdjustmentStore } from "../../application/ports";
import type { ManualAdjust } from "../../domain/weighting";

const KEY = "film-coach:manual";

export class LocalStorageManualStore implements ManualAdjustmentStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> = globalThis.localStorage) {}

  load(): Record<string, ManualAdjust> | undefined {
    try {
      const raw = this.storage.getItem(KEY);
      return raw ? (JSON.parse(raw) as Record<string, ManualAdjust>) : undefined;
    } catch {
      return undefined;
    }
  }

  save(manual: Record<string, ManualAdjust>) {
    try {
      this.storage.setItem(KEY, JSON.stringify(manual));
    } catch {
      // 容量超過やプライベートモードでは保存しない
    }
  }
}
