"""精度の評価：手作業で付けた正解（関節の位置と、接地・リリースの瞬間）を、解析の結果と比べる。

- 関節の位置：正解の点と推定した関節の距離（cm）。モデルの出力そのもの（raw）と、補正・平滑化を経て指標に使う
  骨格（final）の 2 つを比べる
- 瞬間：正解のフレームと、解析で見つけたフレームの差
- 指標：正解の骨格を正解の瞬間で測った値（手で測った値）と、解析の値の差。差のうち骨格の誤差による分を見るため、
  解析の骨格を正解の瞬間で測った値も出す
"""

from __future__ import annotations

import math
import statistics
from dataclasses import dataclass
from typing import Literal, get_args

from .metrics import AT_EVENT, AT_FRAME, MetricKey
from .motion import Affine
from .pose import KP, NUM_KEYPOINTS, Keypoint, KeypointName, PoseFrame
from .world import MIRROR, Hand, WorldTransform

LABEL_JOINTS: tuple[KeypointName, ...] = (
    "nose",
    "lShoulder",
    "rShoulder",
    "lElbow",
    "rElbow",
    "lWrist",
    "rWrist",
    "lHip",
    "rHip",
    "lKnee",
    "rKnee",
    "lAnkle",
    "rAnkle",
)
"""正解を付ける関節。目と耳は指標に使わず、横からはほとんど見分けられないので付けない"""

JointGroup = Literal["head", "shoulder", "elbow", "wrist", "hip", "knee", "ankle"]
JOINT_GROUPS: tuple[JointGroup, ...] = get_args(JointGroup)

GROUP_OF: dict[KeypointName, JointGroup] = {
    "nose": "head",
    "lShoulder": "shoulder",
    "rShoulder": "shoulder",
    "lElbow": "elbow",
    "rElbow": "elbow",
    "lWrist": "wrist",
    "rWrist": "wrist",
    "lHip": "hip",
    "rHip": "hip",
    "lKnee": "knee",
    "rKnee": "knee",
    "lAnkle": "ankle",
    "rAnkle": "ankle",
}

EventKey = Literal["plant", "release"]
EVENT_KEYS: tuple[EventKey, ...] = get_args(EventKey)

THRESHOLDS_CM = (5.0, 10.0)
"""関節の位置が正しいとみなす距離（PCK の閾値）"""

SAMPLE_RATIOS = (0.25, 0.5, 0.75)
"""1 球で正解を付けるフレームの、投球の区間の中の位置（接地・リリースの正解のフレームに加える）"""

METRIC_JOINTS: dict[MetricKey, tuple[KeypointName, ...]] = {
    "strideRatio": ("lAnkle", "rAnkle"),
    "frontKnee": ("lHip", "lKnee", "lAnkle"),
    "elbowHeight": ("rShoulder", "rElbow"),
    "elbowAngle": ("rShoulder", "rElbow", "rWrist"),
    "releaseHeight": ("rWrist",),
    "trunkTilt": ("lShoulder", "rShoulder", "lHip", "rHip"),
}
"""接地・リリースの瞬間で測る指標が使う関節（右投げの規則での名前）"""

Point = tuple[float, float]


@dataclass(frozen=True, slots=True)
class FrameLabel:
    frame: int
    points: dict[KeypointName, Point | None]
    """関節ごとの正解の位置（元の映像のピクセル）。None は「見えない」。ない関節はまだ付けていない"""

    @property
    def done(self) -> bool:
        return all(j in self.points for j in LABEL_JOINTS)


@dataclass(frozen=True, slots=True)
class ThrowLabel:
    rep: int
    """投球の番号（解析結果の index）"""
    plant: int | None
    """前足が着いた正解のフレーム番号"""
    release: int | None
    """ボールが手から離れた正解のフレーム番号"""


@dataclass(frozen=True, slots=True)
class Annotation:
    video_id: str
    throws: tuple[ThrowLabel, ...]
    frames: tuple[FrameLabel, ...]
    updated_at: str

    def throw(self, rep: int) -> ThrowLabel | None:
        return next((t for t in self.throws if t.rep == rep), None)

    def frame(self, index: int) -> FrameLabel | None:
        return next((f for f in self.frames if f.frame == index), None)


class AnnotationError(ValueError):
    """正解として受け付けられない入力"""


def check_annotation(a: Annotation, frame_count: int, width: int, height: int, reps: set[int]) -> None:
    """映像の範囲に収まっているか、関節の名前と投球の番号が正しいかを確かめる"""
    frames = [f.frame for f in a.frames]
    if len(set(frames)) != len(frames):
        raise AnnotationError("同じフレームの正解が 2 つあります")
    for f in a.frames:
        if not 0 <= f.frame < frame_count:
            raise AnnotationError(f"フレーム {f.frame} は映像の範囲外です")
        for j, p in f.points.items():
            if j not in LABEL_JOINTS:
                raise AnnotationError(f"{j} は正解を付ける関節ではありません")
            if p is not None and not (0 <= p[0] <= width and 0 <= p[1] <= height):
                raise AnnotationError(f"フレーム {f.frame} の {j} が画像の外です")
    if len({t.rep for t in a.throws}) != len(a.throws):
        raise AnnotationError("同じ投球の正解が 2 つあります")
    for t in a.throws:
        if t.rep not in reps:
            raise AnnotationError(f"投球 {t.rep} はありません")
        for e in (t.plant, t.release):
            if e is not None and not 0 <= e < frame_count:
                raise AnnotationError(f"フレーム {e} は映像の範囲外です")


def frames_to_label(start: int, end: int, label: ThrowLabel | None) -> list[int]:
    """1 球で正解を付けるフレーム：投球の区間の 25・50・75% の位置と、正解の接地・リリース"""
    frames = {start + math.floor((end - start) * r + 0.5) for r in SAMPLE_RATIOS}
    if label is not None:
        frames |= {f for f in (label.plant, label.release) if f is not None}
    return sorted(frames)


def mirror_name(name: KeypointName) -> KeypointName:
    """左右を入れ替えた関節の名前（左投げを右投げの規則で扱うため）"""
    names = list(KP)
    return names[MIRROR[KP[name]]]


def world_name(name: KeypointName, hand: Hand) -> KeypointName:
    """元の映像での関節の名前を、ワールドの骨格（右投げの規則）での名前にする"""
    return mirror_name(name) if hand == "left" else name


def to_world_point(p: Point, camera: Affine | None, tf: WorldTransform) -> Point:
    """元の映像の点を、カメラの動きを打ち消してからワールド 2D に直す（解析と同じ手順）"""
    x, y = camera.apply(*p) if camera is not None else p
    return tf.to_world(x, y)


def label_frame_world(
    label: FrameLabel, camera: Affine | None, tf: WorldTransform, hand: Hand, t: float = 0.0
) -> PoseFrame:
    """正解の骨格を、ワールドの PoseFrame にする。正解のない関節・見えない関節は NaN にする"""
    pts: list[Keypoint] = [Keypoint(math.nan, math.nan, 0.0)] * NUM_KEYPOINTS
    for name, p in label.points.items():
        if p is None:
            continue
        wx, wy = to_world_point(p, camera, tf)
        pts[KP[world_name(name, hand)]] = Keypoint(wx, wy, 1.0)
    return PoseFrame(t, tuple(pts))


def metric_at(frame: PoseFrame, metric: MetricKey, height_m: float) -> float | None:
    """1 フレームで測る指標。使う関節がそろっていなければ None"""
    if any(math.isnan(frame.kp[KP[j]].x) for j in METRIC_JOINTS[metric]):
        return None
    return AT_FRAME[metric](frame, height_m)


def event_of(metric: MetricKey) -> EventKey:
    return "plant" if AT_EVENT[metric] == "plant" else "release"


@dataclass(frozen=True, slots=True)
class ErrorStats:
    n: int
    mean: float
    median: float
    p90: float
    within: tuple[float, ...]
    """THRESHOLDS_CM のそれぞれ以内に入った割合（関節の位置のときだけ）"""


def error_stats(errors: list[float], thresholds: tuple[float, ...] = ()) -> ErrorStats | None:
    """誤差（絶対値）の要約。誤差がなければ None"""
    if not errors:
        return None
    xs = sorted(abs(e) for e in errors)
    p90 = xs[min(len(xs) - 1, math.ceil(0.9 * len(xs)) - 1)]
    within = tuple(sum(x <= t for x in xs) / len(xs) for t in thresholds)
    return ErrorStats(len(xs), statistics.fmean(xs), statistics.median(xs), p90, within)
