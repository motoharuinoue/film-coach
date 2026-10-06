import { describe, expect, it } from "vitest";
import { LABEL_JOINTS, cropFor, isFrameDone, jointLabel, nextJoint, progressOf, withEvent, withPoint, withoutPoint, type AnnotationInput, type EvaluationTarget } from "./evaluation";

const empty: AnnotationInput = { throws: [], frames: [] };

describe("jointLabel", () => {
  it("左右ではなく、投げる腕の側か・前足の側かで示し、左右を添える", () => {
    expect(jointLabel("rWrist", "right")).toBe("投げる腕の手首（右）");
    expect(jointLabel("lElbow", "right")).toBe("反対の腕の肘（左）");
    expect(jointLabel("lKnee", "right")).toBe("前足の膝（左）");
    expect(jointLabel("rAnkle", "right")).toBe("後ろ足の足首（右）");
    // 左投げは、左腕が投げる腕で、右足が前足
    expect(jointLabel("lWrist", "left")).toBe("投げる腕の手首（左）");
    expect(jointLabel("rKnee", "left")).toBe("前足の膝（右）");
    expect(jointLabel("nose", "left")).toBe("頭（鼻）");
  });
});

describe("正解の編集", () => {
  it("関節を付けた順に次の関節へ進み、見えない関節も付けたことになる", () => {
    let a = withPoint(empty, 30, "nose", [100, 200]);
    expect(nextJoint(a.frames[0])).toBe("lShoulder");
    for (const j of LABEL_JOINTS.slice(1)) a = withPoint(a, 30, j, j === "lAnkle" ? null : [1, 1]);
    expect(isFrameDone(a.frames[0])).toBe(true);
    expect(nextJoint(a.frames[0])).toBeUndefined();
    a = withoutPoint(a, 30, "rWrist");
    expect(nextJoint(a.frames[0])).toBe("rWrist");
  });

  it("フレームは番号の順に並べ、同じフレームは置き換える", () => {
    const a = withPoint(withPoint(withPoint(empty, 40, "nose", [1, 1]), 20, "nose", [2, 2]), 40, "nose", [3, 3]);
    expect(a.frames.map((f) => [f.frame, f.points.nose])).toEqual([
      [20, [2, 2]],
      [40, [3, 3]],
    ]);
  });

  it("投球の瞬間は、投球ごとに付け直せる", () => {
    const a = withEvent(withEvent(withEvent(empty, 1, "plant", 44), 1, "release", 50), 1, "plant", 45);
    expect(a.throws).toEqual([{ rep: 1, plant: 45, release: 50 }]);
  });
});

describe("progressOf", () => {
  it("瞬間を付けた投球と、すべての関節を付けたフレームを数える", () => {
    const target: EvaluationTarget = {
      video: { id: "a", name: "IMG_0459.MOV", fps: 30, width: 1920, height: 1080, frameCount: 140 },
      hand: "right",
      throws: [{ rep: 1, start: 40, end: 110, plant: 86, release: 91, frames: [58, 75, 86, 91, 93] }],
      annotation: null,
    };
    let a = withEvent(empty, 1, "plant", 86);
    for (const j of LABEL_JOINTS) a = withPoint(a, 58, j, [1, 1]);
    expect(progressOf(target, a)).toEqual({ events: 0, eventsTotal: 1, frames: 1, framesTotal: 5 });
    expect(progressOf(target, withEvent(a, 1, "release", 91)).events).toBe(1);
  });
});

describe("cropFor", () => {
  const box = (cx: number, h: number) => ({ x1: cx - h / 4, y1: 500 - h / 2, x2: cx + h / 4, y2: 500 + h / 2, score: 1 });
  const boxes = new Map([
    [10, box(800, 500)],
    [11, box(820, 600)],
    [13, box(900, 560)],
  ]);

  it("区間で最も大きい枠の 1.4 倍の正方形を、そのフレームの枠の中心に置く", () => {
    expect(cropFor(boxes, 11, 10, 13, 1920, 1080)).toEqual({ x: 820 - 420, y: 500 - 420, w: 840, h: 840 });
    // 拡大率は区間で同じ
    expect(cropFor(boxes, 10, 10, 13, 1920, 1080).w).toBe(840);
  });

  it("枠のないフレームは、いちばん近いフレームの枠を使い、映像の外にははみ出さない", () => {
    expect(cropFor(boxes, 12, 10, 13, 1920, 1080).x).toBe(820 - 420);
    expect(cropFor(new Map([[5, box(100, 600)]]), 5, 0, 9, 1920, 1080)).toMatchObject({ x: 0, y: 80 });
    expect(cropFor(new Map(), 5, 0, 9, 1920, 1080)).toEqual({ x: 0, y: 0, w: 1920, h: 1080 });
  });
});
