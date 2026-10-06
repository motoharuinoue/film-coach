"""ユースケース：精度の評価。自分で撮った映像に手作業で付けた正解を保存し、解析の結果と比べる。

正解を付けるのは、元の動画を残していて（自分でアップロードした映像）、投球まで解析した映像だけ。
正解を付けるときは解析の骨格を見せない（画面の側の約束）。見せると、正解が解析の結果に引っ張られる。
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from ..domain.evaluation import (
    EVENT_KEYS,
    GROUP_OF,
    JOINT_GROUPS,
    METRIC_JOINTS,
    THRESHOLDS_CM,
    Annotation,
    ErrorStats,
    EventKey,
    FrameLabel,
    JointGroup,
    ThrowLabel,
    check_annotation,
    error_stats,
    event_of,
    frames_to_label,
    label_frame_world,
    metric_at,
    to_world_point,
    world_name,
)
from ..domain.library import VideoInfo, VideoRecord
from ..domain.metrics import MetricKey
from ..domain.pose import KP, KeypointName
from . import library
from .library import NotFoundError, VideoStore
from .throws import ThrowAnalysis, ThrowRep
from .track_target import TargetTrack


class AnnotationStore(Protocol):
    """正解の置き場所"""

    def get(self, video_id: str) -> Annotation | None: ...

    def save(self, annotation: Annotation) -> None: ...


@dataclass(frozen=True, slots=True)
class TargetThrow:
    rep: int
    start: int
    end: int
    plant: int
    """解析で見つけた接地（映像のフレーム番号）"""
    release: int
    """解析で見つけたリリース（映像のフレーム番号）"""
    frames: list[int]
    """正解を付けるフレーム（区間の 25・50・75% と、正解の接地・リリース）"""


@dataclass(frozen=True, slots=True)
class TargetVideo:
    record: VideoRecord
    info: VideoInfo
    """追跡したときの映像の情報（フレーム番号と座標は、これに合わせる）"""
    hand: str
    throws: list[TargetThrow]
    annotation: Annotation | None


@dataclass(frozen=True, slots=True)
class _Loaded:
    record: VideoRecord
    track: TargetTrack
    throws: ThrowAnalysis


def _load(store: VideoStore, record: VideoRecord) -> _Loaded | None:
    if record.source != "upload" or store.media(record.id) is None:
        return None
    track = store.load_track(record.id)
    throws = store.load_throws(record.id)
    if track is None or throws is None or not throws.reps:
        return None
    return _Loaded(record, track, throws)


def _targets(store: VideoStore) -> list[_Loaded]:
    loaded = [x for r in store.list() if (x := _load(store, r))]
    return sorted(loaded, key=lambda x: x.record.name)


def _target_throws(throws: ThrowAnalysis, annotation: Annotation | None) -> list[TargetThrow]:
    out = []
    for rep in throws.reps:
        label = annotation.throw(rep.index) if annotation else None
        e = rep.analysis.events
        frames = frames_to_label(rep.start, rep.end, label)
        out.append(TargetThrow(rep.index, rep.start, rep.end, rep.start + e.plant, rep.start + e.release, frames))
    return out


def evaluation_targets(store: VideoStore, annotations: AnnotationStore) -> list[TargetVideo]:
    """正解を付けられる映像と、1 球ごとに正解を付けるフレーム"""
    out = []
    for x in _targets(store):
        a = annotations.get(x.record.id)
        out.append(TargetVideo(x.record, x.track.video, x.throws.hand, _target_throws(x.throws, a), a))
    return out


def save_annotation(
    store: VideoStore,
    annotations: AnnotationStore,
    video_id: str,
    throws: list[ThrowLabel],
    frames: list[FrameLabel],
) -> Annotation:
    record = store.get(video_id)
    x = _load(store, record) if record else None
    if x is None:
        raise NotFoundError(f"映像 {video_id} には正解を付けられません（投球まで解析した、自分の映像だけに付けます）")
    info = x.track.video
    frames = sorted(frames, key=lambda f: f.frame)
    annotation = Annotation(video_id, tuple(throws), tuple(frames), library._now())
    check_annotation(annotation, info.frame_count, info.width, info.height, {r.index for r in x.throws.reps})
    annotations.save(annotation)
    return annotation


@dataclass(frozen=True, slots=True)
class JointError:
    video_id: str
    frame: int
    joint: KeypointName
    raw_cm: float | None
    """モデルの出力そのもの（元の映像の座標）と正解の距離。追跡がそのフレームの骨格を持たなければ None"""
    final_cm: float
    """補正・平滑化を経て指標に使う骨格（ワールド 2D）と正解の距離"""
    final_dx_cm: float
    """final の、正解から見た向き（前が正）"""
    final_dy_cm: float
    """final の、正解から見た向き（上が正）。部位ごとに平均すると、関節の点の付け方の違い（かたより）が分かる"""


@dataclass(frozen=True, slots=True)
class EventError:
    video_id: str
    rep: int
    event: EventKey
    label: int
    """正解のフレーム番号"""
    found: int
    """解析で見つけたフレーム番号"""
    frames: int
    """found − label（正なら、解析が遅い）"""
    ms: float
    """frames を実際の時間（ミリ秒）にしたもの"""


@dataclass(frozen=True, slots=True)
class MetricError:
    video_id: str
    rep: int
    metric: MetricKey
    labeled: float
    """正解の骨格を、正解の瞬間で測った値"""
    analyzed: float | None
    """解析の値（解析で測れなかったら None）"""
    analyzed_at_label: float | None
    """解析の骨格を、正解の瞬間で測った値。labeled との差が、骨格の誤差による分"""
    uncertainty: float | None
    """解析の値の、瞬間が半コマずれたときの変わり幅"""


@dataclass(frozen=True, slots=True)
class EvaluationReport:
    videos: int
    throws: int
    """接地とリリースの正解を付けた投球の数"""
    frames: int
    """すべての関節に正解を付けたフレームの数"""
    thresholds_cm: tuple[float, ...]
    joints_raw: ErrorStats | None
    joints_final: ErrorStats | None
    groups_raw: dict[JointGroup, ErrorStats | None]
    groups_final: dict[JointGroup, ErrorStats | None]
    events: dict[EventKey, ErrorStats | None]
    """瞬間の差（ミリ秒、絶対値）"""
    metrics_total: dict[MetricKey, ErrorStats | None]
    """解析の値と、手で測った値の差（絶対値）"""
    metrics_pose: dict[MetricKey, ErrorStats | None]
    """解析の骨格を正解の瞬間で測った値と、手で測った値の差（骨格の誤差による分）"""
    joint_errors: list[JointError]
    event_errors: list[EventError]
    metric_errors: list[MetricError]


def _rep_of(throws: ThrowAnalysis, frame: int) -> ThrowRep | None:
    return next((r for r in throws.reps if r.start <= frame <= r.end), None)


def _joint_errors(x: _Loaded, label: FrameLabel) -> list[JointError]:
    rep = _rep_of(x.throws, label.frame)
    if rep is None:
        return []
    camera = x.track.camera[label.frame] if x.track.camera else None
    raw = x.track.frames[label.frame].keypoints if label.frame < len(x.track.frames) else None
    final = rep.analysis.sequence.frames[label.frame - rep.start]
    out = []
    for joint, p in label.points.items():
        if p is None:
            continue
        raw_cm = None
        if raw is not None:
            rx, ry, _ = raw[KP[joint]]
            raw_cm = ((rx - p[0]) ** 2 + (ry - p[1]) ** 2) ** 0.5 * rep.transform.m_per_px * 100
        wx, wy = to_world_point(p, camera, rep.transform)
        k = final.kp[KP[world_name(joint, x.throws.hand)]]
        dx, dy = (k.x - wx) * 100, (k.y - wy) * 100
        out.append(JointError(x.record.id, label.frame, joint, raw_cm, (dx**2 + dy**2) ** 0.5, dx, dy))
    return out


def _event_errors(x: _Loaded, label: ThrowLabel) -> list[EventError]:
    rep = next((r for r in x.throws.reps if r.index == label.rep), None)
    if rep is None:
        return []
    fps = x.throws.video.fps * x.throws.slowmo
    found_of = {"plant": rep.start + rep.analysis.events.plant, "release": rep.start + rep.analysis.events.release}
    out = []
    for key in EVENT_KEYS:
        at = label.plant if key == "plant" else label.release
        if at is None:
            continue
        diff = found_of[key] - at
        out.append(EventError(x.record.id, rep.index, key, at, found_of[key], diff, diff / fps * 1000))
    return out


def _metric_errors(x: _Loaded, annotation: Annotation, label: ThrowLabel) -> list[MetricError]:
    rep = next((r for r in x.throws.reps if r.index == label.rep), None)
    if rep is None:
        return []
    out = []
    for metric in METRIC_JOINTS:
        at = label.plant if event_of(metric) == "plant" else label.release
        frame = annotation.frame(at) if at is not None else None
        if at is None or frame is None or not rep.start <= at <= rep.end:
            continue
        camera = x.track.camera[at] if x.track.camera else None
        labeled = metric_at(label_frame_world(frame, camera, rep.transform, x.throws.hand), metric, x.throws.height_m)
        if labeled is None:
            continue
        analyzed_at_label = metric_at(rep.analysis.sequence.frames[at - rep.start], metric, x.throws.height_m)
        out.append(
            MetricError(
                x.record.id,
                rep.index,
                metric,
                labeled,
                rep.analysis.metrics.get(metric),
                analyzed_at_label,
                rep.analysis.uncertainty.get(metric),
            )
        )
    return out


def evaluate(store: VideoStore, annotations: AnnotationStore) -> EvaluationReport:
    """付けた正解と解析の結果を比べる。正解がまだなければ、誤差の要約は None になる"""
    joints: list[JointError] = []
    events: list[EventError] = []
    metrics: list[MetricError] = []
    videos = throws = frames = 0
    for x in _targets(store):
        a = annotations.get(x.record.id)
        if a is None:
            continue
        videos += 1
        for f in a.frames:
            frames += f.done
            joints += _joint_errors(x, f)
        for t in a.throws:
            throws += t.plant is not None and t.release is not None
            events += _event_errors(x, t)
            metrics += _metric_errors(x, a, t)

    def joint_stats(group: JointGroup | None, raw: bool) -> ErrorStats | None:
        es = [j for j in joints if group is None or GROUP_OF[j.joint] == group]
        values = [v for j in es if (v := j.raw_cm if raw else j.final_cm) is not None]
        return error_stats(values, THRESHOLDS_CM)

    keys = list(METRIC_JOINTS)
    return EvaluationReport(
        videos=videos,
        throws=throws,
        frames=frames,
        thresholds_cm=THRESHOLDS_CM,
        joints_raw=joint_stats(None, raw=True),
        joints_final=joint_stats(None, raw=False),
        groups_raw={g: joint_stats(g, raw=True) for g in JOINT_GROUPS},
        groups_final={g: joint_stats(g, raw=False) for g in JOINT_GROUPS},
        events={k: error_stats([e.ms for e in events if e.event == k]) for k in EVENT_KEYS},
        metrics_total={
            m: error_stats([e.analyzed - e.labeled for e in metrics if e.metric == m and e.analyzed is not None])
            for m in keys
        },
        metrics_pose={
            m: error_stats(
                [e.analyzed_at_label - e.labeled for e in metrics if e.metric == m and e.analyzed_at_label is not None]
            )
            for m in keys
        },
        joint_errors=joints,
        event_errors=events,
        metric_errors=metrics,
    )
