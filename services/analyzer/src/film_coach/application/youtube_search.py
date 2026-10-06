"""ユースケース：YouTube でお手本の候補を探す。無料枠（1 日 10,000 ユニット）を超えないように数える。

API キーは解析サービスの手元（macOS のキーチェーンか環境変数）にだけ置き、画面には渡さない。
"""

from __future__ import annotations

from collections.abc import Callable
from datetime import UTC, datetime
from typing import Protocol

from ..domain.youtube_data import (
    DAILY_QUOTA,
    MAX_QUERY,
    MAX_RESULTS,
    SEARCH_COST,
    QuotaStatus,
    YouTubeCandidate,
    quota_day,
    quota_resets_at,
)


class YouTubeNotConfigured(RuntimeError):
    """API キーがない"""


class QuotaExceeded(RuntimeError):
    """今日の無料枠を使い切った"""


class YouTubeApiError(RuntimeError):
    """YouTube Data API がエラーを返した（キーが正しくない、など）"""


class YouTubeSearch(Protocol):
    def configured(self) -> bool:
        """API キーがあるか"""
        ...

    def search(self, query: str, max_results: int, creative_commons: bool) -> list[YouTubeCandidate]:
        """埋め込みで再生できる動画を、関連の高い順に。高評価数・登録者数も添える"""
        ...

    def video(self, video_id: str) -> YouTubeCandidate | None:
        """1 本の動画の情報と統計。なければ（削除・非公開・埋め込み不可）None"""
        ...


class QuotaLedger(Protocol):
    """その日に使ったユニット数の記録"""

    def used(self, day: str) -> int: ...

    def add(self, day: str, units: int) -> None: ...


Clock = Callable[[], datetime]


def _utcnow() -> datetime:
    return datetime.now(UTC)


def quota_status(ledger: QuotaLedger, now: datetime) -> QuotaStatus:
    day = quota_day(now)
    return QuotaStatus(day, ledger.used(day), DAILY_QUOTA, quota_resets_at(now).astimezone(UTC).isoformat())


def search_candidates(
    api: YouTubeSearch,
    ledger: QuotaLedger,
    query: str,
    creative_commons: bool = False,
    max_results: int = 12,
    clock: Clock = _utcnow,
) -> tuple[list[YouTubeCandidate], QuotaStatus]:
    q = query.strip()
    if not q or len(q) > MAX_QUERY:
        raise ValueError(f"検索語は 1〜{MAX_QUERY} 文字で入れてください")
    if not api.configured():
        raise YouTubeNotConfigured(
            "YouTube Data API のキーがありません。ターミナルで "
            '`security add-generic-password -a "$USER" -s film-coach-youtube -w` を実行して登録してください'
        )
    now = clock()
    status = quota_status(ledger, now)
    if status.remaining < SEARCH_COST:
        raise QuotaExceeded(
            f"今日の無料枠（{status.limit} ユニット）を使い切りました。米国太平洋時間の 0 時に枠が戻ります"
        )
    # 失敗しても使った扱いにする（無料枠を超えないよう、多めに数える）
    ledger.add(status.day, SEARCH_COST)
    try:
        found = api.search(q, max(1, min(MAX_RESULTS, max_results)), creative_commons)
    except QuotaExceeded:
        ledger.add(status.day, status.limit)
        raise
    return found, quota_status(ledger, now)
