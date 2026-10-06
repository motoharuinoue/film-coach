import { useParams, useSearchParams } from "react-router";
import { useCoach } from "./benchmarks";

/** URL の :id と ?rep=（1 始まり）から、表示するセッションとレップを決める */
export function useSessionRep() {
  const { coach } = useCoach();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const focus = coach.focus();
  const session = (id && coach.session(id)) || focus.session;
  const fallback = session.id === focus.session.id ? focus.rep.index + 1 : 1;
  const idx = Math.max(0, Math.min(session.reps.length - 1, Number(params.get("rep") ?? fallback) - 1));
  const rep = session.reps[idx]!;
  const setRep = (i: number) =>
    setParams(
      (p) => {
        p.set("rep", String(i + 1));
        return p;
      },
      { replace: true },
    );
  return { session, rep, setRep };
}

export const repLabel = (i: number) => `Rep ${String(i + 1).padStart(2, "0")}`;

export function formatDate(iso: string) {
  const [, m, d] = iso.split("-");
  return `${Number(m)}/${Number(d)}`;
}
