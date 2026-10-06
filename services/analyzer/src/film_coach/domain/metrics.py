"""QB 指標の定義と計算。apps/web/src/domain/metrics.ts と同じ規則で実装する。

指標の日本語名はユビキタス言語としてドメインに置く。
"""

from __future__ import annotations

import math
from collections.abc import Callable
from dataclasses import dataclass
from typing import Literal, get_args

from .camera import CAMERA_LABEL, CameraAngle
from .phases import Events, stride_found, stride_seen
from .pose import PoseFrame, PoseSequence, head_center, joint_angle, js_round, kp, mid

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


def _trunk_tilt(f: PoseFrame, _h: float) -> float:
    shoulder_mid = mid(kp(f, "lShoulder"), kp(f, "rShoulder"))
    hip_mid = mid(kp(f, "lHip"), kp(f, "rHip"))
    return math.atan2(shoulder_mid.x - hip_mid.x, shoulder_mid.y - hip_mid.y) * 180 / math.pi


AT_FRAME: dict[MetricKey, Callable[[PoseFrame, float], float]] = {
    "strideRatio": lambda f, h: abs(kp(f, "lAnkle").x - kp(f, "rAnkle").x) / h,
    "frontKnee": lambda f, _h: joint_angle(kp(f, "lHip"), kp(f, "lKnee"), kp(f, "lAnkle")),
    "elbowHeight": lambda f, _h: (kp(f, "rElbow").y - kp(f, "rShoulder").y) * 100,
    "elbowAngle": lambda f, _h: joint_angle(kp(f, "rShoulder"), kp(f, "rElbow"), kp(f, "rWrist")),
    "releaseHeight": lambda f, h: kp(f, "rWrist").y / h,
    "trunkTilt": _trunk_tilt,
}
"""接地・リリースの瞬間（1 フレーム）で測る指標の計算式。測る瞬間は AT_EVENT"""

AT_EVENT: dict[MetricKey, str] = {
    "strideRatio": "plant",
    "frontKnee": "plant",
    "elbowHeight": "release",
    "elbowAngle": "release",
    "releaseHeight": "release",
    "trunkTilt": "release",
}


def _frame_of(key: MetricKey, e: Events) -> int:
    return e.plant if AT_EVENT[key] == "plant" else e.release


def compute_metrics(seq: PoseSequence, e: Events, extras: AnalysisExtras | None = None) -> MetricValues:
    ex = extras or AnalysisExtras()

    def at(key: MetricKey) -> float:
        return AT_FRAME[key](seq.frames[_frame_of(key, e)], seq.height_m)

    values: MetricValues = {
        "elbowHeight": at("elbowHeight"),
        "elbowAngle": at("elbowAngle"),
        "releaseHeight": at("releaseHeight"),
        "trunkTilt": at("trunkTilt"),
    }
    # 映っていない区間・見つからなかったイベントからは測らない
    if stride_seen(e):
        values["releaseTime"] = (e.release - e.stride_start) / seq.fps
    if stride_found(e):
        values["strideRatio"] = at("strideRatio")
        values["frontKnee"] = at("frontKnee")
    if stride_found(e) and e.stride_start >= max(1, js_round(MIN_SET_S * seq.fps)):
        heads = [head_center(f).y for f in seq.frames[: e.stride_start]]
        mean = sum(heads) / len(heads)
        values["headStability"] = math.sqrt(sum((v - mean) ** 2 for v in heads) / len(heads)) * 100
    if ex.hip_shoulder_sep is not None:
        values["hipShoulderSep"] = ex.hip_shoulder_sep
    if ex.sequence_gap_s is not None:
        values["sequenceGap"] = ex.sequence_gap_s * 1000
    return values


def metric_uncertainty(seq: PoseSequence, e: Events, values: MetricValues) -> MetricValues:
    """接地・リリースの瞬間で測った指標の、瞬間の時刻が半コマずれたときの変わり幅（前後のコマの値の差の半分）。

    腕が速く動くリリースの瞬間は、fps が低いとコマの間で値が大きく変わり、どのコマを取ったかで値が決まってしまう。
    values（compute_metrics の結果）にある指標だけを返す。判定に使うかの上限は画面（metrics.ts の tolerance）が持つ
    """
    last = len(seq.frames) - 1
    out: MetricValues = {}
    for m in METRICS:
        fn = AT_FRAME.get(m.key)
        if fn is None or m.key not in values:
            continue
        i = _frame_of(m.key, e)
        a = fn(seq.frames[max(0, i - 1)], seq.height_m)
        b = fn(seq.frames[min(last, i + 1)], seq.height_m)
        out[m.key] = abs(b - a) / 2
    return out


def is_valid_for(d: MetricDef, angle: CameraAngle) -> bool:
    return angle in d.valid_angles


def only_valid(values: MetricValues, angle: CameraAngle) -> MetricValues:
    """カメラ角度で測れない指標を捨てる"""
    return {m.key: values[m.key] for m in METRICS if is_valid_for(m, angle) and m.key in values}


def invalid_reason(d: MetricDef, angle: CameraAngle) -> str:
    ok = "・".join(CAMERA_LABEL[a] for a in d.valid_angles)
    return f"{CAMERA_LABEL[angle]}の映像では測れません（{ok}の映像が必要）"
