"""YouTube URL の解析と、取り込む区間の検証。apps/web/src/domain/youtube.ts と同じ規則。"""

from __future__ import annotations

import re
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse

_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
_TIME = re.compile(r"^(?:(\d+):)?(\d{1,2}):(\d{2})$")

MAX_SEGMENT_SEC = 60
"""区間の上限。規約への配慮（ADR-0005）と解析時間のため、必要な部分だけを取り込む"""


def is_youtube_id(text: str) -> bool:
    """YouTube の動画 ID（11 文字）の形か"""
    return bool(_ID.match(text))


def parse_youtube_id(text: str) -> str | None:
    """watch / youtu.be / shorts / embed / live の URL から動画 ID を取り出す"""
    try:
        url = urlparse(text.strip())
    except ValueError:
        return None
    if url.scheme not in ("http", "https"):
        return None
    host = re.sub(r"^(www\.|m\.|music\.)", "", url.hostname or "")
    vid: str | None = None
    if host == "youtu.be":
        vid = url.path.lstrip("/").split("/")[0]
    elif host in ("youtube.com", "youtube-nocookie.com"):
        if url.path == "/watch":
            values = parse_qs(url.query).get("v", [])
            vid = values[0] if values else None
        elif m := re.match(r"^/(shorts|embed|live)/([^/?#]+)", url.path):
            vid = m.group(2)
    return vid if vid and _ID.match(vid) else None


def parse_time(text: str) -> int | None:
    """「1:05」や「65」を秒にする"""
    t = text.strip()
    if t.isdigit():
        return int(t)
    m = _TIME.match(t)
    if not m:
        return None
    h, mm, ss = m.group(1), int(m.group(2)), int(m.group(3))
    if ss >= 60 or (h is not None and mm >= 60):
        return None
    return int(h or 0) * 3600 + mm * 60 + ss


@dataclass(frozen=True, slots=True)
class Segment:
    start: int
    end: int

    @property
    def seconds(self) -> int:
        return self.end - self.start


class SegmentError(ValueError):
    pass


def check_segment(start: int, end: int) -> Segment:
    if start < 0 or end <= start:
        raise SegmentError("終了は開始より後にしてください")
    if end - start > MAX_SEGMENT_SEC:
        raise SegmentError(f"区間は {MAX_SEGMENT_SEC} 秒以内にしてください")
    return Segment(start, end)


def watch_url(video_id: str, start: int | None = None) -> str:
    return f"https://www.youtube.com/watch?v={video_id}" + (f"&t={start}s" if start else "")
