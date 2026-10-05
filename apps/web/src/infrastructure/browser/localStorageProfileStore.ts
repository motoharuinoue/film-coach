// PlayerProfileStore の localStorage 実装。身長はこの端末の中にだけ置く。保存に失敗しても画面は動き続けるようにする。

import type { PlayerProfileStore } from "../../application/ports";
import { isValidHeightCm } from "../../domain/throws";

const KEY = "film-coach:height-cm";

export class LocalStorageProfileStore implements PlayerProfileStore {
  constructor(private readonly storage: Pick<Storage, "getItem" | "setItem"> = globalThis.localStorage) {}

  heightCm(): number | undefined {
    try {
      const v = Number(this.storage.getItem(KEY));
      return isValidHeightCm(v) ? v : undefined;
    } catch {
      return undefined;
    }
  }

  saveHeightCm(cm: number) {
    if (!isValidHeightCm(cm)) return;
    try {
      this.storage.setItem(KEY, String(cm));
    } catch {
      // 容量超過やプライベートモードでは保存しない
    }
  }
}
