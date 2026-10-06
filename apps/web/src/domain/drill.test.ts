import { describe, expect, it } from "vitest";
import { drillUrl, pickDrill, type Drill, type DrillSide } from "./drill";

const drill = (id: string, targets: [string, DrillSide][], createdAt: string): Drill => ({
  id,
  youtubeId: "Qb7Drill_01",
  title: id,
  channel: "QB Lab",
  startSec: 95,
  label: id,
  targets: targets.map(([metric, side]) => ({ metric: metric as Drill["targets"][number]["metric"], side })),
  createdAt,
});

describe("改善点に添えるドリル動画を選ぶ", () => {
  const drills = [
    drill("wide", [["strideRatio", "high"]], "2026-10-03"),
    drill("any-old", [["strideRatio", "any"]], "2026-10-01"),
    drill("any-new", [["strideRatio", "any"], ["frontKnee", "low"]], "2026-10-02"),
    drill("narrow", [["strideRatio", "low"]], "2026-09-30"),
  ];

  it("外れた側を直すものを先に選ぶ（ステップが狭いなら、狭いときのドリル）", () => {
    expect(pickDrill(drills, "strideRatio", "low")!.id).toBe("narrow");
    expect(pickDrill(drills, "strideRatio", "high")!.id).toBe("wide");
  });

  it("外れた側のものがなければ、どちらでもよいもののうち新しいもの。反対側だけのものは選ばない", () => {
    expect(pickDrill(drills.filter((d) => d.id !== "narrow"), "strideRatio", "low")!.id).toBe("any-new");
    expect(pickDrill([drills[0]!], "strideRatio", "low")).toBeUndefined();
    expect(pickDrill(drills, "elbowHeight", "low")).toBeUndefined();
  });

  it("YouTube では、ドリルの説明が始まる位置から開く", () => {
    expect(drillUrl(drills[0]!)).toBe("https://www.youtube.com/watch?v=Qb7Drill_01&t=95s");
  });
});
