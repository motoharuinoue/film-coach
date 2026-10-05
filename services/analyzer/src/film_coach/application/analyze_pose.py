"""ユースケース：骨格の時系列から、フェーズと QB 指標を出す。

手順はフロントエンドのデモ（apps/web/src/infrastructure/demo/analyzer.ts）と同じ。
平滑化 → フェーズ分割 → 指標 → カメラ角度で測れない指標を捨てる。
"""

from __future__ import annotations

from dataclasses import dataclass

from ..domain.camera import CameraAngle
from ..domain.metrics import AnalysisExtras, MetricValues, compute_metrics, only_valid
from ..domain.phases import Events, Phase, detect_events, to_phases
from ..domain.pose import PoseSequence, smooth_sequence


@dataclass(frozen=True, slots=True)
class RepAnalysis:
    camera: CameraAngle
    sequence: PoseSequence
    """平滑化した骨格"""
    events: Events
    phases: list[Phase]
    metrics: MetricValues


def analyze_pose(seq: PoseSequence, camera: CameraAngle, extras: AnalysisExtras | None = None) -> RepAnalysis:
    smoothed = smooth_sequence(seq)
    events = detect_events(smoothed)
    metrics = only_valid(compute_metrics(smoothed, events, extras), camera)
    return RepAnalysis(camera, smoothed, events, to_phases(events), metrics)
