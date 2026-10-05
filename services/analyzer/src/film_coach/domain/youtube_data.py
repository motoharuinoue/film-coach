"""YouTube Data API v3 から得る、お手本の候補の情報と、無料枠（クォータ）の数え方。

無料枠は 1 日 10,000 ユニット。検索（search.list）は 1 回 100 ユニット、動画とチャンネルの情報
（videos.list・channels.list）は 1 回 1 ユニット。日付の区切りは米国太平洋時間の 0 時（YouTube と同じ）。
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import Literal
from zoneinfo import ZoneInfo

DAILY_QUOTA = 10_000
SEARCH_COST = 100 + 1 + 1
"""1 回の検索で使うユニット（検索 + 動画の情報 + チャンネルの情報）"""
VIDEO_COST = 1 + 1
"""1 本の動画の統計を取り直すのに使うユニット（動画の情報 + チャンネルの情報）"""
MAX_RESULTS = 25
"""1 回の検索で受け取る候補の上限"""
MAX_QUERY = 100
"""検索語の長さの上限"""

PACIFIC = ZoneInfo("America/Los_Angeles")

License = Literal["youtube", "creativeCommon"]


@dataclass(frozen=True, slots=True)
class YouTubeCandidate:
    """お手本の候補。高評価数・登録者数は、非公開なら None"""

    video_id: str
    title: str
    channel: str
    channel_id: str
    published_at: str
    duration_sec: int
    views: int
    likes: int | None
    comments: int | None
    subscribers: int | None
    license: License
    definition: Literal["hd", "sd"]
    thumbnail: str


@dataclass(frozen=True, slots=True)
class QuotaStatus:
    day: str
    """米国太平洋時間の日付（YYYY-MM-DD）"""
    used: int
    limit: int
    resets_at: str
    """次に戻る時刻（UTC の ISO 8601）"""

    @property
    def remaining(self) -> int:
        return max(0, self.limit - self.used)


def quota_day(now: datetime) -> str:
    """無料枠の日付（米国太平洋時間）"""
    return now.astimezone(PACIFIC).date().isoformat()


def quota_resets_at(now: datetime) -> datetime:
    """次に無料枠が戻る時刻（米国太平洋時間の翌日 0 時）"""
    local = now.astimezone(PACIFIC)
    tomorrow = (local + timedelta(days=1)).date()
    return datetime(tomorrow.year, tomorrow.month, tomorrow.day, tzinfo=PACIFIC)


_DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$")


def parse_iso_duration(text: str) -> int:
    """YouTube の長さ（ISO 8601、例：PT1M30S）を秒にする。読めなければ 0"""
    m = _DURATION.match(text or "")
    if not m:
        return 0
    d, h, mi, s = (int(v) if v else 0 for v in m.groups())
    return ((d * 24 + h) * 60 + mi) * 60 + s
