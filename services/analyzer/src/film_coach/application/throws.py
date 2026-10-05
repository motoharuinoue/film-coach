"""ユースケース：本人を追った骨格（画像の座標）から投球を見つけ、1 本ずつフェーズと QB 指標を出す。

画像の座標をワールド 2D に直し（domain/world.py）、投げる手首の速さのピークで投球を切り出し（domain/throws.py）、
1 本ずつ analyze_pose にかける。骨格が途切れた所と、場面の切り替わりはまたがない。
"""

from __future__ import annotations

from dataclasses import dataclass, replace

from ..domain.camera import CameraAngle
from ..domain.library import VideoInfo
from ..domain.pose import KP, smooth_sequence
from ..domain.throws import find_throws
from ..domain.world import Hand, ImagePose, NotEnoughPoseError, WorldTransform, estimate_transform, to_world
from .analyze_pose import RepAnalysis, analyze_pose
from .track_target import TargetFrame, TargetTrack

MIN_RUN_S = 0.8
"""投球を探す、骨格が続いた区間の最短の長さ（秒）"""
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
    """この投球の座標の変換（x の原点は区間の最初の骨盤）。画面で映像に重ねるときに使う"""
    analysis: RepAnalysis


@dataclass(frozen=True, slots=True)
class ThrowAnalysis:
    video: VideoInfo
    height_m: float
    camera: CameraAngle
    hand: Hand
    reps: list[ThrowRep]
    warnings: list[str]
    """解析の結果を読むときの注意（本人が小さく映っている、投球が見つからない など）"""


def _runs(track: TargetTrack) -> list[list[TargetFrame]]:
    """骨格のあるフレームが続く区間。場面の切り替わりで区切る"""
    cuts = set(track.cuts)
    runs: list[list[TargetFrame]] = []
    current: list[TargetFrame] = []
    for f in track.frames:
        if f.keypoints is None or f.index in cuts:
            if current:
                runs.append(current)
            current = [f] if f.keypoints is not None else []
            continue
        current.append(f)
    if current:
        runs.append(current)
    return runs


def _poses(frames: list[TargetFrame]) -> list[ImagePose]:
    return [f.keypoints for f in frames if f.keypoints is not None]


def analyze_throws(track: TargetTrack, height_m: float, camera: CameraAngle = "side") -> ThrowAnalysis:
    """投球を見つけて、1 本ずつ解析する。投球が見つからなければ reps は空"""
    fps = track.video.fps
    every = [f for run in _runs(track) for f in run]
    if not every:
        raise NotEnoughPoseError("本人の骨格がありません。追跡をやり直してください")
    tf, hand = estimate_transform(_poses(every), fps, height_m)

    reps: list[ThrowRep] = []
    for run in _runs(track):
        if len(run) < MIN_RUN_S * fps:
            continue
        poses = _poses(run)
        whole = smooth_sequence(to_world(poses, [f.t for f in run], fps, height_m, tf, hand))
        for w in find_throws(whole):
            part = run[w.start : w.end + 1]
            part_poses = poses[w.start : w.end + 1]
            # x の原点を、区間の最初の骨盤にそろえる（合成データやお手本と同じ置き方）
            first = part_poses[0]
            origin = (first[KP["lHip"]][0] + first[KP["rHip"]][0]) / 2
            rep_tf = replace(tf, origin_x=origin)
            t0 = part[0].t
            seq = to_world(part_poses, [f.t - t0 for f in part], fps, height_m, rep_tf, hand)
            reps.append(ThrowRep(len(reps) + 1, part[0].index, part[-1].index, rep_tf, analyze_pose(seq, camera)))
    warnings: list[str] = []
    body_px = height_m / tf.m_per_px
    if body_px < SMALL_BODY * track.video.height:
        warnings.append(
            f"本人が小さく映っています（身長が約 {body_px:.0f} px、画面の高さの {body_px / track.video.height:.0%}）。"
            f"全身が画面の高さの {SMALL_BODY:.0%} 以上になるように近づいて撮ると、関節の位置が正確になります"
        )
    if not reps:
        warnings.append("投球が見つかりません。横から全身が映った、投げ終わりまでの映像か確かめてください")
    return ThrowAnalysis(track.video, height_m, camera, hand, reps, warnings)
