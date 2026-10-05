"""YouTubeSearch の実装（YouTube Data API v3）と、無料枠の記録（QuotaLedger）のファイル実装。

API キーは環境変数 YOUTUBE_API_KEY か、macOS のキーチェーン（サービス名 film-coach-youtube）から読む。
キーはリポジトリにもログにも出さない。エラーの文言に URL を含めないのは、URL にキーが入るため。
標準ライブラリ（urllib）だけで呼ぶ。
"""

from __future__ import annotations

import getpass
import json
import os
import shutil
import subprocess
import sys
from collections.abc import Callable
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import urlopen

from ..application.youtube_search import QuotaExceeded, YouTubeApiError
from ..domain.youtube_data import YouTubeCandidate, parse_iso_duration
from .paths import data_dir

API = "https://www.googleapis.com/youtube/v3"
KEYCHAIN_SERVICE = "film-coach-youtube"


def load_api_key() -> str | None:
    """環境変数か macOS のキーチェーンから API キーを読む。なければ None"""
    key = os.environ.get("YOUTUBE_API_KEY", "").strip()
    if key:
        return key
    if sys.platform != "darwin" or not shutil.which("security"):
        return None
    try:
        out = subprocess.run(
            ["security", "find-generic-password", "-a", getpass.getuser(), "-s", KEYCHAIN_SERVICE, "-w"],
            check=True,
            capture_output=True,
            text=True,
            timeout=10,
        )
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired):
        return None
    return out.stdout.strip() or None


Fetch = Callable[[str, float], bytes]
"""URL を受け取り、応答の本文を返す（テストでは差し替える）"""


def _fetch(url: str, timeout: float) -> bytes:
    # https の決まった URL（API）だけを開く
    with urlopen(url, timeout=timeout) as res:
        body: bytes = res.read()
        return body


def _int(v: Any) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


class YouTubeDataApi:
    def __init__(
        self, key_loader: Callable[[], str | None] = load_api_key, fetch: Fetch = _fetch, timeout: float = 15
    ) -> None:
        self._load = key_loader
        self._key: str | None = None
        self._fetch = fetch
        self._timeout = timeout

    def _api_key(self) -> str | None:
        # 起動のあとにキーを登録しても使えるよう、見つかるまでは毎回読む
        if self._key is None:
            self._key = self._load()
        return self._key

    def configured(self) -> bool:
        return self._api_key() is not None

    def _get(self, resource: str, params: dict[str, str]) -> dict[str, Any]:
        key = self._api_key()
        if key is None:
            raise YouTubeApiError("YouTube Data API のキーがありません")
        url = f"{API}/{resource}?{urlencode({**params, 'key': key})}"
        try:
            data: dict[str, Any] = json.loads(self._fetch(url, self._timeout))
            return data
        except HTTPError as e:
            reason = ""
            try:
                err = json.loads(e.read() or b"{}").get("error", {})
                reason = str((err.get("errors") or [{}])[0].get("reason", ""))
            except (ValueError, AttributeError):
                pass
            if reason in ("quotaExceeded", "dailyLimitExceeded", "rateLimitExceeded"):
                raise QuotaExceeded("YouTube Data API の今日の無料枠を使い切りました") from None
            if e.code in (400, 403):
                raise YouTubeApiError(
                    "YouTube Data API に断られました。キーが正しいか、"
                    "YouTube Data API v3 が有効になっているかを確かめてください"
                    f"（{e.code} {reason or 'エラー'}）"
                ) from None
            raise YouTubeApiError(f"YouTube Data API がエラーを返しました（{e.code}）") from None
        except URLError:
            raise YouTubeApiError("YouTube Data API につながりません。ネットワークを確かめてください") from None

    def search(self, query: str, max_results: int, creative_commons: bool) -> list[YouTubeCandidate]:
        params = {
            "part": "snippet",
            "type": "video",
            "q": query,
            "maxResults": str(max_results),
            # 公式の埋め込みプレイヤーで見せる（ADR-0005）ので、埋め込めない動画は除く
            "videoEmbeddable": "true",
            "safeSearch": "moderate",
        }
        if creative_commons:
            params["videoLicense"] = "creativeCommon"
        ids = [
            str(i["id"]["videoId"])
            for i in self._get("search", params).get("items", [])
            if i.get("id", {}).get("videoId")
        ]
        return self._details(ids)

    def video(self, video_id: str) -> YouTubeCandidate | None:
        found = self._details([video_id])
        return found[0] if found else None

    def _details(self, ids: list[str]) -> list[YouTubeCandidate]:
        """動画の情報・統計と、チャンネルの登録者数（2 ユニット）。ids の順を保ち、埋め込めない動画は除く"""
        if not ids:
            return []
        videos = self._get("videos", {"part": "snippet,statistics,contentDetails,status", "id": ",".join(ids)})
        by_id = {str(v["id"]): v for v in videos.get("items", [])}
        channel_ids = sorted({str(v["snippet"]["channelId"]) for v in by_id.values()})
        channels = self._get("channels", {"part": "statistics", "id": ",".join(channel_ids)}) if channel_ids else {}
        subs = {
            str(c["id"]): None
            if c.get("statistics", {}).get("hiddenSubscriberCount")
            else _int(c.get("statistics", {}).get("subscriberCount"))
            for c in channels.get("items", [])
        }
        out: list[YouTubeCandidate] = []
        for vid in ids:  # 渡された順（検索なら関連の高い順）を保つ
            v = by_id.get(vid)
            if v is None or not v.get("status", {}).get("embeddable", True):
                continue
            sn, st, cd = v["snippet"], v.get("statistics", {}), v.get("contentDetails", {})
            thumbs = sn.get("thumbnails", {})
            thumb = (thumbs.get("medium") or thumbs.get("default") or {}).get("url", "")
            out.append(
                YouTubeCandidate(
                    video_id=vid,
                    title=str(sn.get("title", "")),
                    channel=str(sn.get("channelTitle", "")),
                    channel_id=str(sn.get("channelId", "")),
                    published_at=str(sn.get("publishedAt", "")),
                    duration_sec=parse_iso_duration(str(cd.get("duration", ""))),
                    views=_int(st.get("viewCount")) or 0,
                    likes=_int(st.get("likeCount")),
                    comments=_int(st.get("commentCount")),
                    subscribers=subs.get(str(sn.get("channelId", ""))),
                    license="creativeCommon" if v.get("status", {}).get("license") == "creativeCommon" else "youtube",
                    definition="hd" if cd.get("definition") == "hd" else "sd",
                    thumbnail=str(thumb),
                )
            )
        return out


class FileQuotaLedger:
    """data/youtube-quota.json に、その日（米国太平洋時間）に使ったユニット数を置く"""

    def __init__(self, path: Path | None = None) -> None:
        self.path = path or data_dir() / "youtube-quota.json"

    def _read(self) -> dict[str, Any]:
        try:
            data: dict[str, Any] = json.loads(self.path.read_text(encoding="utf-8"))
            return data
        except (FileNotFoundError, ValueError):
            return {}

    def used(self, day: str) -> int:
        d = self._read()
        return int(d.get("used", 0)) if d.get("day") == day else 0

    def add(self, day: str, units: int) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp = self.path.with_suffix(".json.tmp")
        tmp.write_text(json.dumps({"day": day, "used": self.used(day) + units}), encoding="utf-8")
        tmp.replace(self.path)
