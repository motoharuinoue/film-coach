import { describe, expect, it } from "vitest";
import { CoachService, type CoachData } from "../../application/coach";
import type { AnalyzedRep, Reference, Session } from "../../domain/entities";
import { demoReferences, demoSessions } from "../demo/fixtures";
import { TemplateFindingWriter } from "../writer/templateFindingWriter";
import { MemoryReferenceRepository, MemorySessionRepository } from "./repositories";

// 手元のデータも、デモと同じ CoachService で評価できることを確かめる（データはデモの合成データを借りる）
describe("手元のデータを載せた CoachService", () => {
  const as = (s: Session, approach: AnalyzedRep["approach"]): Session => ({ ...s, reps: s.reps.map((r) => ({ ...r, approach })) });
  const sessions = [as(demoSessions[0]!, "drop"), as(demoSessions[5]!, "standing")];
  // ドロップからのお手本だけ。その場からの投球の頭の上下動は判定しない
  const references: Reference[] = demoReferences.filter((r) => r.stats.camera === "side");
  const data: CoachData = { player: { position: "QB", throws: "右投げ" }, sessions, focus: { session: sessions[1]!, rep: sessions[1]!.reps[0]! }, references, drills: [] };
  const coach = new CoachService({ sessions: new MemorySessionRepository(data), references: new MemoryReferenceRepository(data), writer: new TemplateFindingWriter() });
  const bench = coach.benchmarks();

  it("読んだセッション・選手・取り上げるレップを、そのまま返す", () => {
    expect(coach.sessions().map((s) => s.id)).toEqual(["s1", "s6"]);
    expect(coach.session("s6")).toBe(sessions[1]);
    expect(coach.player().name).toBeUndefined();
    expect(coach.focus().rep).toBe(sessions[1]!.reps[0]);
  });

  it("投げ始めで意味が変わる指標は、投げ始めが同じお手本だけで判定する", () => {
    const drop = coach.evaluate(sessions[0]!.reps[0]!, "side", bench).find((e) => e.key === "headStability")!;
    const standing = coach.evaluate(sessions[1]!.reps[0]!, "side", bench).find((e) => e.key === "headStability")!;
    expect(drop.status).not.toBe("na");
    expect(standing.status).toBe("na");
    expect(coach.zonesOf(sessions[1]!.reps[0]!, bench).strideRatio).toEqual(bench.zones.strideRatio);
  });

  it("自己ベストは最新より前のセッションから選ぶ", () => {
    expect(bench.best?.sessionId).toBe("s1");
  });

  it("改善点には、登録したドリル動画のうち、その指標の外れた側を直すものを添える", () => {
    const drill = (id: string, side: "low" | "high" | "any", createdAt: string) => ({ id, youtubeId: `Qb7Drill_0${id}`, title: id, channel: "QB Lab", startSec: 75, label: `ドリル ${id}`, targets: [{ metric: "strideRatio" as const, side }], createdAt });
    const withDrills = new CoachService({
      sessions: new MemorySessionRepository(data),
      references: new MemoryReferenceRepository({ ...data, drills: [drill("1", "high", "2026-10-02"), drill("2", "any", "2026-10-03"), drill("3", "low", "2026-10-01")] }),
      writer: new TemplateFindingWriter(),
    });
    // デモの取り上げるレップは、ステップがお手本の範囲より狭い（小さい側に外れている）
    const f = withDrills.findings(demoSessions[5]!.reps[3]!, "side", withDrills.benchmarks()).find((x) => x.key === "strideRatio")!;
    expect(f.drill).toEqual({ label: "ドリル 3", channel: "QB Lab", at: "1:15", youtubeId: "Qb7Drill_03", startSec: 75 });
  });
});
