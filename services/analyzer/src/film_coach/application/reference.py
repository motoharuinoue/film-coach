"""ユースケース：取り込んで投球を解析した YouTube の映像を、お手本として登録する。統計の取り直し、調整、削除。

登録するときに、YouTube Data API で再生数・高評価数・登録者数を取り直す（2 ユニット）。
削除するのはお手本の登録だけで、元になった映像と解析結果は残す。
"""

from __future__ import annotations

from dataclasses import replace
from typing import Protocol

from ..domain.reference import (
    Manual,
    Reference,
    ReferenceError,
    ReferenceKind,
    YouTubeStats,
    check_height,
    check_manual,
)
from ..domain.youtube_data import VIDEO_COST, YouTubeCandidate
from . import library
from .library import NotFoundError, VideoStore
from .youtube_search import (
    Clock,
    QuotaExceeded,
    QuotaLedger,
    YouTubeNotConfigured,
    YouTubeSearch,
    _utcnow,
    quota_status,
)


class ReferenceStore(Protocol):
    def new_id(self) -> str: ...

    def save(self, reference: Reference) -> None: ...

    def get(self, reference_id: str) -> Reference | None: ...

    def list(self) -> list[Reference]: ...

    def delete(self, reference_id: str) -> bool: ...


def _stats(api: YouTubeSearch, ledger: QuotaLedger, youtube_id: str, clock: Clock) -> YouTubeCandidate:
    if not api.configured():
        raise YouTubeNotConfigured("YouTube Data API のキーがありません。お手本の統計を取れません")
    now = clock()
    status = quota_status(ledger, now)
    if status.remaining < VIDEO_COST:
        raise QuotaExceeded("今日の無料枠を使い切りました。米国太平洋時間の 0 時に戻ります")
    ledger.add(status.day, VIDEO_COST)
    found = api.video(youtube_id)
    if found is None:
        raise NotFoundError(
            f"YouTube の動画 {youtube_id} が見つかりません（削除・非公開・埋め込み不可の可能性があります）"
        )
    return found


def _to_stats(c: YouTubeCandidate, fetched_at: str) -> YouTubeStats:
    return YouTubeStats(c.views, c.likes, c.comments, c.subscribers, c.duration_sec, c.published_at, fetched_at)


def register_reference(
    refs: ReferenceStore,
    videos: VideoStore,
    api: YouTubeSearch,
    ledger: QuotaLedger,
    footage_id: str,
    kind: ReferenceKind = "model",
    trusted_channel: bool = False,
    player_height_cm: float | None = None,
    clock: Clock = _utcnow,
) -> Reference:
    record = library.get_record(videos, footage_id)
    if record.youtube is None:
        raise ReferenceError("お手本にできるのは、YouTube から取り込んだ映像だけです")
    if any(r.video_id == footage_id for r in refs.list()):
        raise ReferenceError("この映像は、もうお手本として登録しています")
    throws = videos.load_throws(footage_id)
    if throws is None or not throws.reps:
        raise ReferenceError("投球がまだありません。お手本の選手を追跡して、投球を解析してください")
    height = check_height(player_height_cm if player_height_cm is not None else throws.height_m * 100)
    c = _stats(api, ledger, record.youtube.video_id, clock)
    ref = Reference(
        id=refs.new_id(),
        video_id=footage_id,
        youtube_id=record.youtube.video_id,
        title=c.title or record.youtube.title,
        channel=c.channel or record.youtube.channel,
        channel_id=c.channel_id,
        license=c.license,
        kind=kind,
        trusted_channel=trusted_channel,
        player_height_cm=height,
        stats=_to_stats(c, library._now()),
        created_at=library._now(),
    )
    refs.save(ref)
    return ref


def get_reference(refs: ReferenceStore, reference_id: str) -> Reference:
    r = refs.get(reference_id)
    if r is None:
        raise NotFoundError(f"お手本 {reference_id} はありません")
    return r


def list_references(refs: ReferenceStore) -> list[Reference]:
    return sorted(refs.list(), key=lambda r: r.created_at, reverse=True)


def update_reference(
    refs: ReferenceStore,
    reference_id: str,
    kind: ReferenceKind | None = None,
    trusted_channel: bool | None = None,
    manual: Manual | None = None,
) -> Reference:
    r = get_reference(refs, reference_id)
    r = replace(
        r,
        kind=kind if kind is not None else r.kind,
        trusted_channel=trusted_channel if trusted_channel is not None else r.trusted_channel,
        manual=check_manual(manual) if manual is not None else r.manual,
    )
    refs.save(r)
    return r


def refresh_reference(
    refs: ReferenceStore, api: YouTubeSearch, ledger: QuotaLedger, reference_id: str, clock: Clock = _utcnow
) -> Reference:
    """YouTube の統計を取り直す（2 ユニット）"""
    r = get_reference(refs, reference_id)
    c = _stats(api, ledger, r.youtube_id, clock)
    r = replace(r, stats=_to_stats(c, library._now()))
    refs.save(r)
    return r


def delete_reference(refs: ReferenceStore, reference_id: str) -> None:
    if not refs.delete(reference_id):
        raise NotFoundError(f"お手本 {reference_id} はありません")
