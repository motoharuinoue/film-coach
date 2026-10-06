"""QB 指標の定義と計算。apps/web/src/domain/metrics.ts と同じ規則で実装する。

指標の日本語名はユビキタス言語としてドメインに置く。
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal, get_args

from .camera import CAMERA_LABEL, CameraAngle
from .phases import Events, stride_found, stride_seen
from .pose import PoseSequence, head_center, joint_angle, js_round, kp, mid

MetricKey = Literal[
    "releaseTime",
    "strideRatio",
    "frontKnee",
    "hipShoulderSep",
    "sequenceGap",
    "elbowHeight",
    "elbowAngle",
    "releaseHeight",
    "trunkTilt",
    "headStability",
]
METRIC_KEYS: tuple[MetricKey, ...] = get_args(MetricKey)

ALL_ANGLES: tuple[CameraAngle, ...] = ("side", "behind", "front", "endzone", "sideline")


@dataclass(frozen=True, slots=True)
class MetricDef:
    key: MetricKey
    label: str
    unit: str
    digits: int
    valid_angles: tuple[CameraAngle, ...]


METRICS: tuple[MetricDef, ...] = (
    MetricDef("releaseTime", "始動からリリース", "s", 2, ALL_ANGLES),
    MetricDef("strideRatio", "ステップ幅（身長比）", "", 2, ("side",)),
    MetricDef("frontKnee", "接地時の前膝角度", "°", 0, ("side",)),
    MetricDef("hipShoulderSep", "腰と肩の捻り差", "°", 0, ("behind", "front")),
    MetricDef("sequenceGap", "骨盤→体幹のピーク間隔", "ms", 0, ("side", "behind")),
    MetricDef("elbowHeight", "リリース時の肘の高さ", "cm", 0, ("side", "behind")),
    MetricDef("elbowAngle", "リリース時の肘角度", "°", 0, ("side",)),
    MetricDef("releaseHeight", "リリース点の高さ（身長比）", "", 2, ("side",)),
    MetricDef("trunkTilt", "リリース時の体幹の前傾", "°", 0, ("side",)),
    MetricDef("headStability", "頭の上下動", "cm", 1, ALL_ANGLES),
)
METRIC_BY_KEY: dict[MetricKey, MetricDef] = {m.key: m for m in METRICS}

MetricValues = dict[MetricKey, float]

MIN_SET_S = 0.3
"""頭の上下動を測るのに要る、ステップの前に映っている長さ（秒）。短いと、標準偏差が意味を持たない"""


@dataclass(frozen=True, slots=True)
class AnalysisExtras:
    hip_shoulder_sep: float | None = None
    """後方・正面の映像でのみ測れる値（度）"""
    sequence_gap_s: float | None = None
    """骨盤→体幹のピーク間隔（秒）"""


def compute_metrics(seq: PoseSequence, e: Events, extras: AnalysisExtras | None = None) -> MetricValues:
    ex = extras or AnalysisExtras()
    plant = seq.frames[e.plant]
    rel = seq.frames[e.release]
    h = seq.height_m

    shoulder_mid = mid(kp(rel, "lShoulder"), kp(rel, "rShoulder"))
    hip_mid = mid(kp(rel, "lHip"), kp(rel, "rHip"))
    tilt = math.atan2(shoulder_mid.x - hip_mid.x, shoulder_mid.y - hip_mid.y) * 180 / math.pi

    values: MetricValues = {
        "elbowHeight": (kp(rel, "rElbow").y - kp(rel, "rShoulder").y) * 100,
        "elbowAngle": joint_angle(kp(rel, "rShoulder"), kp(rel, "rElbow"), kp(rel, "rWrist")),
        "releaseHeight": kp(rel, "rWrist").y / h,
        "trunkTilt": tilt,
    }
    # 映っていない区間・見つからなかったイベントからは測らない
    if stride_seen(e):
        values["releaseTime"] = (e.release - e.stride_start) / seq.fps
    if stride_found(e):
        values["strideRatio"] = abs(kp(plant, "lAnkle").x - kp(plant, "rAnkle").x) / h
        values["frontKnee"] = joint_angle(kp(plant, "lHip"), kp(plant, "lKnee"), kp(plant, "lAnkle"))
    if stride_found(e) and e.stride_start >= max(1, js_round(MIN_SET_S * seq.fps)):
        heads = [head_center(f).y for f in seq.frames[: e.stride_start]]
        mean = sum(heads) / len(heads)
        values["headStability"] = math.sqrt(sum((v - mean) ** 2 for v in heads) / len(heads)) * 100
    if ex.hip_shoulder_sep is not None:
        values["hipShoulderSep"] = ex.hip_shoulder_sep
    if ex.sequence_gap_s is not None:
        values["sequenceGap"] = ex.sequence_gap_s * 1000
    return values


def is_valid_for(d: MetricDef, angle: CameraAngle) -> bool:
    return angle in d.valid_angles


def only_valid(values: MetricValues, angle: CameraAngle) -> MetricValues:
    """カメラ角度で測れない指標を捨てる"""
    return {m.key: values[m.key] for m in METRICS if is_valid_for(m, angle) and m.key in values}


def invalid_reason(d: MetricDef, angle: CameraAngle) -> str:
    ok = "・".join(CAMERA_LABEL[a] for a in d.valid_angles)
    return f"{CAMERA_LABEL[angle]}の映像では測れません（{ok}の映像が必要）"
