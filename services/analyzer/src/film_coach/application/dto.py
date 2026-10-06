"""記録・練習・お手本・YouTube の候補・精度の評価と JSON の対応。

video-record.v1 / practice.v1 / reference.v1 / youtube-search.v1 / annotation.v1 / evaluation.v1 の形。

保存（infrastructure）と API の応答（adapters）の両方が使うので、この層に置く。
スキーマによる検証は、外部ライブラリを使う infrastructure の側で行う。
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from ..domain.drill import Drill, DrillTarget
from ..domain.evaluation import LABEL_JOINTS, Annotation, ErrorStats, FrameLabel, ThrowLabel
from ..domain.library import VideoInfo, VideoRecord, YouTubeSource
from ..domain.practice import Practice
from ..domain.reference import Manual, Reference, YouTubeStats
from ..domain.youtube import watch_url
from ..domain.youtube_data import QuotaStatus, YouTubeCandidate

if TYPE_CHECKING:
    from .evaluation import EvaluationReport, TargetVideo


def record_to_json(r: VideoRecord) -> dict[str, Any]:
    yt = r.youtube
    return {
        "schemaVersion": 1,
        "id": r.id,
        "name": r.name,
        "source": r.source,
        "info": {
            "name": r.info.name,
            "fps": r.info.fps,
            "width": r.info.width,
            "height": r.info.height,
            "frameCount": r.info.frame_count,
            "duration": round(r.info.duration, 3),
        },
        "createdAt": r.created_at,
        "youtube": None
        if yt is None
        else {
            "videoId": yt.video_id,
            "start": yt.start,
            "end": yt.end,
            "title": yt.title,
            "channel": yt.channel,
            "license": yt.license,
            "url": watch_url(yt.video_id, yt.start),
        },
        "mediaRetained": r.media_retained,
        "trackStatus": r.track_status,
        "label": r.label,
        "errors": list(r.errors),
    }


def record_from_json(d: dict[str, Any]) -> VideoRecord:
    i, yt = d["info"], d["youtube"]
    return VideoRecord(
        id=d["id"],
        name=d["name"],
        source=d["source"],
        info=VideoInfo(i["name"], float(i["fps"]), int(i["width"]), int(i["height"]), int(i["frameCount"])),
        created_at=d["createdAt"],
        youtube=None
        if yt is None
        else YouTubeSource(yt["videoId"], int(yt["start"]), int(yt["end"]), yt["title"], yt["channel"], yt["license"]),
        media_retained=bool(d["mediaRetained"]),
        track_status=d["trackStatus"],
        label=d["label"],
        errors=list(d["errors"]),
    )


def practice_to_json(p: Practice) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "id": p.id,
        "name": p.name,
        "date": p.date,
        "kind": p.kind,
        "camera": p.camera,
        "memo": p.memo,
        "videoIds": list(p.video_ids),
        "createdAt": p.created_at,
    }


def practice_from_json(d: dict[str, Any]) -> Practice:
    return Practice(
        id=d["id"],
        name=d["name"],
        date=d["date"],
        kind=d["kind"],
        camera=d["camera"],
        memo=d["memo"],
        video_ids=tuple(d["videoIds"]),
        created_at=d["createdAt"],
    )


def drill_to_json(d: Drill) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "id": d.id,
        "youtubeId": d.youtube_id,
        "title": d.title,
        "channel": d.channel,
        "startSec": d.start_sec,
        "label": d.label,
        "targets": [{"metric": t.metric, "side": t.side} for t in d.targets],
        "createdAt": d.created_at,
    }


def drill_from_json(d: dict[str, Any]) -> Drill:
    return Drill(
        id=d["id"],
        youtube_id=d["youtubeId"],
        title=d["title"],
        channel=d["channel"],
        start_sec=int(d["startSec"]),
        label=d["label"],
        targets=tuple(DrillTarget(t["metric"], t["side"]) for t in d["targets"]),
        created_at=d["createdAt"],
    )


def quota_to_json(q: QuotaStatus) -> dict[str, Any]:
    return {"day": q.day, "used": q.used, "limit": q.limit, "remaining": q.remaining, "resetsAt": q.resets_at}


def candidate_to_json(c: YouTubeCandidate) -> dict[str, Any]:
    return {
        "videoId": c.video_id,
        "title": c.title,
        "channel": c.channel,
        "channelId": c.channel_id,
        "publishedAt": c.published_at,
        "durationSec": c.duration_sec,
        "views": c.views,
        "likes": c.likes,
        "comments": c.comments,
        "subscribers": c.subscribers,
        "license": c.license,
        "definition": c.definition,
        "thumbnail": c.thumbnail,
        "url": watch_url(c.video_id),
    }


def reference_to_json(r: Reference) -> dict[str, Any]:
    st = r.stats
    return {
        "schemaVersion": 1,
        "id": r.id,
        "videoId": r.video_id,
        "youtubeId": r.youtube_id,
        "title": r.title,
        "channel": r.channel,
        "channelId": r.channel_id,
        "license": r.license,
        "kind": r.kind,
        "trustedChannel": r.trusted_channel,
        "playerHeightCm": r.player_height_cm,
        "stats": {
            "views": st.views,
            "likes": st.likes,
            "comments": st.comments,
            "subscribers": st.subscribers,
            "durationSec": st.duration_sec,
            "publishedAt": st.published_at,
            "fetchedAt": st.fetched_at,
        },
        "manual": {"pinned": r.manual.pinned, "excluded": r.manual.excluded, "stars": r.manual.stars},
        "createdAt": r.created_at,
    }


def reference_from_json(d: dict[str, Any]) -> Reference:
    st, m = d["stats"], d["manual"]
    return Reference(
        id=d["id"],
        video_id=d["videoId"],
        youtube_id=d["youtubeId"],
        title=d["title"],
        channel=d["channel"],
        channel_id=d["channelId"],
        license=d["license"],
        kind=d["kind"],
        trusted_channel=bool(d["trustedChannel"]),
        player_height_cm=float(d["playerHeightCm"]),
        stats=YouTubeStats(
            int(st["views"]),
            st["likes"],
            st["comments"],
            st["subscribers"],
            int(st["durationSec"]),
            st["publishedAt"],
            st["fetchedAt"],
        ),
        manual=Manual(bool(m["pinned"]), bool(m["excluded"]), int(m["stars"])),
        created_at=d["createdAt"],
    )


def annotation_to_json(a: Annotation) -> dict[str, Any]:
    return {
        "schemaVersion": 1,
        "videoId": a.video_id,
        "throws": [{"rep": t.rep, "plant": t.plant, "release": t.release} for t in a.throws],
        "frames": [
            {"frame": f.frame, "points": {j: None if p is None else [p[0], p[1]] for j, p in f.points.items()}}
            for f in a.frames
        ],
        "updatedAt": a.updated_at,
    }


def throw_labels_from_json(items: list[dict[str, Any]]) -> list[ThrowLabel]:
    return [ThrowLabel(int(t["rep"]), t.get("plant"), t.get("release")) for t in items]


def frame_labels_from_json(items: list[dict[str, Any]]) -> list[FrameLabel]:
    return [
        FrameLabel(
            int(f["frame"]),
            {j: None if p is None else (float(p[0]), float(p[1])) for j, p in f["points"].items()},
        )
        for f in items
    ]


def annotation_from_json(d: dict[str, Any]) -> Annotation:
    return Annotation(
        d["videoId"],
        tuple(throw_labels_from_json(d["throws"])),
        tuple(frame_labels_from_json(d["frames"])),
        d["updatedAt"],
    )


def _stats(s: ErrorStats | None) -> dict[str, Any] | None:
    if s is None:
        return None
    return {
        "n": s.n,
        "mean": round(s.mean, 4),
        "median": round(s.median, 4),
        "p90": round(s.p90, 4),
        "within": [round(w, 4) for w in s.within],
    }


def _opt(v: float | None, digits: int = 4) -> float | None:
    return None if v is None else round(v, digits)


def evaluation_to_json(targets: list[TargetVideo], report: EvaluationReport) -> dict[str, Any]:
    """精度の評価の画面に渡すもの：正解を付ける映像と、付けた正解から求めた誤差"""
    return {
        "schemaVersion": 1,
        "joints": list(LABEL_JOINTS),
        "thresholdsCm": list(report.thresholds_cm),
        "targets": [
            {
                "video": {
                    "id": t.record.id,
                    "name": t.record.name,
                    "fps": t.info.fps,
                    "width": t.info.width,
                    "height": t.info.height,
                    "frameCount": t.info.frame_count,
                },
                "hand": t.hand,
                "throws": [
                    {
                        "rep": x.rep,
                        "start": x.start,
                        "end": x.end,
                        "plant": x.plant,
                        "release": x.release,
                        "frames": x.frames,
                    }
                    for x in t.throws
                ],
                "annotation": annotation_to_json(t.annotation) if t.annotation else None,
            }
            for t in targets
        ],
        "report": {
            "videos": report.videos,
            "throws": report.throws,
            "frames": report.frames,
            "joints": {"raw": _stats(report.joints_raw), "final": _stats(report.joints_final)},
            "groups": {
                g: {"raw": _stats(report.groups_raw[g]), "final": _stats(report.groups_final[g])}
                for g in report.groups_raw
            },
            "events": {k: _stats(v) for k, v in report.events.items()},
            "metrics": {
                m: {"total": _stats(report.metrics_total[m]), "pose": _stats(report.metrics_pose[m])}
                for m in report.metrics_total
            },
            "details": {
                "joints": [
                    {
                        "videoId": e.video_id,
                        "frame": e.frame,
                        "joint": e.joint,
                        "rawCm": _opt(e.raw_cm, 2),
                        "finalCm": round(e.final_cm, 2),
                        "finalDxCm": round(e.final_dx_cm, 2),
                        "finalDyCm": round(e.final_dy_cm, 2),
                    }
                    for e in report.joint_errors
                ],
                "events": [
                    {
                        "videoId": e.video_id,
                        "rep": e.rep,
                        "event": e.event,
                        "label": e.label,
                        "found": e.found,
                        "frames": e.frames,
                        "ms": round(e.ms, 1),
                    }
                    for e in report.event_errors
                ],
                "metrics": [
                    {
                        "videoId": e.video_id,
                        "rep": e.rep,
                        "metric": e.metric,
                        "labeled": round(e.labeled, 4),
                        "analyzed": _opt(e.analyzed),
                        "analyzedAtLabel": _opt(e.analyzed_at_label),
                        "uncertainty": _opt(e.uncertainty),
                    }
                    for e in report.metric_errors
                ],
            },
        },
    }
