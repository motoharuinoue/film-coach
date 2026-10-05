import { useCallback, useState } from "react";

/** 画面の表示状態（ガイドを閉じた、ツアーを見た など）をブラウザに覚えておく */
export function usePersistentState<T>(key: string, initial: T): [T, (v: T) => void] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw === null ? initial : (JSON.parse(raw) as T);
    } catch {
      return initial;
    }
  });
  const set = useCallback(
    (v: T) => {
      setValue(v);
      try {
        localStorage.setItem(key, JSON.stringify(v));
      } catch {
        // 保存できなくても表示は続ける
      }
    },
    [key],
  );
  return [value, set];
}
