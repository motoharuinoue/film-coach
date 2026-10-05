import { useCallback, useEffect, useRef, useState } from "react";

/** フレーム単位の再生。rate は 1 が等速（0.25 ならスロー） */
export function usePlayback(frameCount: number, fps: number, { autoplay = false, initialRate = 0.5 } = {}) {
  const [frame, setFrame] = useState(0);
  const [playing, setPlaying] = useState(autoplay);
  const [rate, setRate] = useState(initialRate);
  const last = useRef<number | undefined>(undefined);
  const acc = useRef(0);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    const tick = (now: number) => {
      if (last.current !== undefined) {
        acc.current += ((now - last.current) / 1000) * fps * rate;
        const step = Math.floor(acc.current);
        if (step > 0) {
          acc.current -= step;
          setFrame((f) => (f + step) % frameCount);
        }
      }
      last.current = now;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      last.current = undefined;
    };
  }, [playing, rate, fps, frameCount]);

  const seek = useCallback((f: number) => setFrame(Math.max(0, Math.min(frameCount - 1, Math.round(f)))), [frameCount]);
  const step = useCallback((d: number) => {
    setPlaying(false);
    setFrame((f) => Math.max(0, Math.min(frameCount - 1, f + d)));
  }, [frameCount]);
  const toggle = useCallback(() => setPlaying((p) => !p), []);

  return { frame, playing, rate, setRate, seek, step, toggle, setPlaying };
}
