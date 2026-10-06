import { describe, expect, it } from "vitest";
import { CoachService } from "../../application/coach";
import { TemplateFindingWriter } from "../writer/templateFindingWriter";
import { DemoReferenceRepository, DemoSessionRepository } from "./repositories";

// デモの筋書き（ステップが狭く、肘が下がり、回転がつながっていない）が崩れていないことを確かめる
describe("デモデータ（CoachService 経由）", () => {
  const coach = new CoachService({ sessions: new DemoSessionRepository(), references: new DemoReferenceRepository(), writer: new TemplateFindingWriter() });
  const bench = coach.benchmarks();
  const { session, rep } = coach.focus();

  it("取り上げるレップの改善点トップ 3 は 回転・アームパス・フットワーク の 1 つずつ", () => {
    const keys = coach.findings(rep, session.camera, bench).map((f) => f.key);
    expect(new Set(keys)).toEqual(new Set(["sequenceGap", "elbowHeight", "strideRatio"]));
  });

  it("改善点にドリル動画と根拠のフレームが付く", () => {
    const f = coach.findings(rep, session.camera, bench).find((x) => x.key === "strideRatio")!;
    expect(f.drill).toMatchObject({ label: "ライン目印のステップ・アンド・スロー", at: expect.any(String) });
    expect(f.drill?.youtubeId).toBeUndefined(); // 架空の動画なので開けない
    expect(f.frame).toBe(rep.events.plant);
    expect(f.body).toContain("自己ベスト");
  });

  it("横からの映像では捻り差を判定しない", () => {
    expect(coach.evaluate(rep, "side", bench).find((r) => r.key === "hipShoulderSep")!.status).toBe("na");
  });

  it("人気だけ高い癖の強いお手本（r6）の重みは他より小さい", () => {
    const { overall } = bench.weights;
    const others = Object.entries(overall).filter(([id]) => id !== "r6").map(([, w]) => w);
    expect(overall.r6!).toBeLessThan(Math.min(...others));
  });

  it("試合映像のセッションは判定できる指標が少ないのでスコアを出さない", () => {
    const game = coach.sessions().find((s) => s.kind === "game")!;
    expect(coach.sessionScore(game, bench)).toBeUndefined();
  });

  it("自己ベストは最新セッションより前のセッションから選ぶ", () => {
    expect(bench.best).toBeDefined();
    expect(bench.best!.sessionId).not.toBe(session.id);
  });

  it("お手本を除外するとお手本ゾーンが変わる", () => {
    const manual = { ...coach.defaultManual(), r7: { pinned: false, excluded: true, stars: 3 as const } };
    expect(coach.benchmarks(manual).zones.strideRatio).not.toEqual(bench.zones.strideRatio);
  });
});
