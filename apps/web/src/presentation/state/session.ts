import { useParams, useSearchParams } from "react-router";
import { useCoach } from "./benchmarks";

/**
 * URL の :id と ?rep=（1 始まり）から、表示するセッションとレップを決める。
 * ?frame=（0 始まり）があれば、そのフレームから見せる（改善点の根拠の場面を開くとき）
 */
export function useSessionRep() {
  const { coach } = useCoach();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const focus = coach.focus();
  const session = (id && coach.session(id)) || focus.session;
  const fallback = session.id === focus.session.id ? focus.rep.index + 1 : 1;
  const idx = Math.max(0, Math.min(session.reps.length - 1, Number(params.get("rep") ?? fallback) - 1));
  const rep = session.reps[idx]!;
  const f = params.get("frame");
  const frame = f !== null && /^\d+$/.test(f) && Number(f) < rep.seq.frames.length ? Number(f) : undefined;
  const setRep = (i: number) =>
    setParams(
      (p) => {
        p.set("rep", String(i + 1));
        // 根拠の場面は、開いたレップのもの。ほかのレップに移ったら、そのレップの始めから見せる
        p.delete("frame");
        return p;
      },
      { replace: true },
    );
  return { session, rep, frame, setRep };
}

export const repLabel = (i: number) => `Rep ${String(i + 1).padStart(2, "0")}`;

export function formatDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
