"""記録・練習・お手本・YouTube の候補と JSON の対応。

video-record.v1 / practice.v1 / reference.v1 / youtube-search.v1 の形。

保存（infrastructure）と API の応答（adapters）の両方が使うので、この層に置く。
スキーマによる検証は、外部ライブラリを使う infrastructure の側で行う。
"""

from __future__ import annotations

from typing import Any

from ..domain.drill import Drill, DrillTarget
from ..domain.library import VideoInfo, VideoRecord, YouTubeSource
from ..domain.practice import Practice
from ..domain.reference import Manual, Reference, YouTubeStats
from ..domain.youtube import watch_url
from ..domain.youtube_data import QuotaStatus, YouTubeCandidate


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
