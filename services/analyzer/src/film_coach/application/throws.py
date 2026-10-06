"""ユースケース：本人を追った骨格（画像の座標）から投球を見つけ、1 本ずつフェーズと QB 指標を出す。

カメラの動きを打ち消し（追跡のときに見積もった camera）、画像の座標をワールド 2D に直し（domain/world.py）、
投げる手首の速さのピークで投球を切り出し（domain/throws.py）、1 本ずつ analyze_pose にかける。
骨格が途切れた所と、場面の切り替わりはまたがない。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..domain.approach import ApproachInfo, ApproachMode, decide_approach
from ..domain.camera import CameraAngle
from ..domain.library import VideoInfo
from ..domain.pose import KP, smooth_sequence
from ..domain.throws import MIN_PEAK, find_throws, peak_overhead_speed
from ..domain.world import (
    Hand,
    ImagePoint,
    NotEnoughPoseError,
    WorldTransform,
    body_px_of,
    estimate_transform,
    remove_spikes,
    repair_low_confidence,
    to_world,
)
from .analyze_pose import RepAnalysis, analyze_pose
from .track_target import TargetFrame, TargetTrack

MIN_RUN_S = 0.8
"""投球を探す、骨格が続いた区間の最短の長さ（実際の時間の秒）"""
MAX_SLOWMO = 16
"""スロー再生の倍率の上限"""
SLOW_HINT = 0.8
"""投球が見つからなくても、肩より上の手首がこれ以上の速さ（身長/秒）で動いていれば、スロー再生を疑う"""
SMALL_BODY = 0.4
"""本人が小さく映っているとみなす、画像の高さに対する身長の比率。これより小さいと関節の位置が粗い"""


@dataclass(frozen=True, slots=True)
class ThrowRep:
    index: int
    start: int
    """映像のフレーム番号"""
    end: int
    """区間の最後のフレーム（含む）"""
    transform: WorldTransform
    """この投球の座標の変換（x の原点は区間の最初の骨盤）。画像の側は、カメラの動きを打ち消した座標
    （場面の最初のフレームの座標）。画面で映像に重ねるときは、追跡結果の camera で各フレームに戻す"""
    analysis: RepAnalysis
    approach: ApproachInfo
    """投げ始め（ドロップから／その場から）。ドロップの有無で意味が変わる指標は、同じ投げ始めのお手本とだけ比べる"""


@dataclass(frozen=True, slots=True)
class ThrowAnalysis:
    video: VideoInfo
    height_m: float
    camera: CameraAngle
    hand: Hand
    reps: list[ThrowRep]
    warnings: list[str]
    """解析の結果を読むときの注意（本人が小さく映っている、投球が見つからない など）"""
    slowmo: float = 1.0
    """スロー再生の倍率（1 は等速）。速さと時間は、実際の時間に直して計算する"""
    approach_mode: ApproachMode = "auto"
    """投げ始めの決め方（auto は骨格から見分ける）"""


def stabilized(track: TargetTrack) -> list[TargetFrame]:
    """カメラの動きを打ち消した骨格（場面の最初のフレームの座標）。カメラの動きを見積もっていなければそのまま"""
    if track.camera is None:
        return list(track.frames)
    out: list[TargetFrame] = []
    for f in track.frames:
        if f.keypoints is None:
            out.append(f)
            continue
        m = track.camera[f.index]
        out.append(replace(f, keypoints=[(*m.apply(x, y), c) for x, y, c in f.keypoints]))
    return out


def _runs(frames: list[TargetFrame], cuts: set[int]) -> list[list[TargetFrame]]:
    """骨格のあるフレームが続く区間。場面の切り替わりで区切る"""
    runs: list[list[TargetFrame]] = []
    current: list[TargetFrame] = []
    for f in frames:
        if f.keypoints is None or f.index in cuts:
            if current:
                runs.append(current)
            current = [f] if f.keypoints is not None else []
            continue
        current.append(f)
    if current:
        runs.append(current)
    return runs


def _poses(frames: list[TargetFrame], fps: float) -> list[list[ImagePoint]]:
    """骨格の列。信頼度の低い関節（腕を速く振ったときの取り違えなど）と、数フレームだけ飛んで戻る位置は、前後から補う"""
    poses = repair_low_confidence([f.keypoints for f in frames if f.keypoints is not None], fps)
    body = body_px_of(poses)
    return remove_spikes(poses, body) if body else poses


def analyze_throws(
    track: TargetTrack,
    height_m: float,
    camera: CameraAngle = "side",
    slowmo: float = 1.0,
    approach: ApproachMode = "auto",
) -> ThrowAnalysis:
    """投球を見つけて、1 本ずつ解析する。投球が見つからなければ reps は空。

    slowmo はスロー再生の倍率。YouTube のお手本はスロー再生の映像が多いので、時間を実際の時間に直す
    （映像の 1 秒は、実際には 1/slowmo 秒）。フレーム番号は映像のままにする。
    approach は投げ始めの決め方。auto なら投球ごとに骨格から見分け、指定すればすべての投球をそれにする。
    """
    if not 1 <= slowmo <= MAX_SLOWMO:
        raise ValueError(f"スロー再生の倍率は 1〜{MAX_SLOWMO} にしてください")
    fps = track.video.fps * slowmo
    runs = _runs(stabilized(track), set(track.cuts))
    every = [f for run in runs for f in run]
    if not every:
        raise NotEnoughPoseError("本人の骨格がありません。追跡をやり直してください")
    tf, hand = estimate_transform(_poses(every, fps), fps, height_m)

    reps: list[ThrowRep] = []
    slow_peak = 0.0
    for run in runs:
        if len(run) < MIN_RUN_S * fps:
            continue
        poses = _poses(run, fps)
        whole = smooth_sequence(to_world(poses, [f.t / slowmo for f in run], fps, height_m, tf, hand))
        slow_peak = max(slow_peak, peak_overhead_speed(whole))
        for w in find_throws(whole):
            part = run[w.start : w.end + 1]
            part_poses = poses[w.start : w.end + 1]
            # x の原点を、区間の最初の骨盤にそろえる（合成データやお手本と同じ置き方）
            first = part_poses[0]
            origin = (first[KP["lHip"]][0] + first[KP["rHip"]][0]) / 2
            rep_tf = replace(tf, origin_x=origin)
            t0 = part[0].t
            seq = to_world(part_poses, [(f.t - t0) / slowmo for f in part], fps, height_m, rep_tf, hand)
            ra = analyze_pose(seq, camera)
            how = decide_approach(ra.sequence, ra.events, camera, approach)
            reps.append(ThrowRep(len(reps) + 1, part[0].index, part[-1].index, rep_tf, ra, how))
    warnings: list[str] = []
    body_px = height_m / tf.m_per_px
    if body_px < SMALL_BODY * track.video.height:
        warnings.append(
            f"本人が小さく映っています（映像上の身長が約 {body_px:.0f} px、"
            f"画面の高さの {body_px / track.video.height:.0%}）。"
            f"全身が画面の高さの {SMALL_BODY:.0%} 以上になるように近づいて撮ると、関節の位置が正確になります"
        )
    if not reps:
        warnings.append("投球が見つかりません。横から全身が映っていて、投げ終わりまで入った映像かを確かめてください")
        if SLOW_HINT <= slow_peak < MIN_PEAK:
            warnings.append(
                "肩より上で腕を振っていますが、投球にしては遅い動きです"
                f"（手首の速さが 1 秒あたり身長の {slow_peak:.1f} 倍）。"
                "スロー再生の映像なら、スロー再生の倍率を選んで計算し直してください"
            )
    return ThrowAnalysis(track.video, height_m, camera, hand, reps, warnings, slowmo, approach)
