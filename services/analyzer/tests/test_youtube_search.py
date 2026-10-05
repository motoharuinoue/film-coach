"""YouTube でお手本の候補を探す：長さの読み方、無料枠の数え方、API の呼び出し（偽の応答）、HTTP の口。

本物の YouTube Data API は呼ばない。動画・チャンネルはすべて架空。
"""

import io
import json
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError
from urllib.parse import parse_qs, urlparse

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.jobs import JobRunner
from film_coach.application.youtube_search import (
    QuotaExceeded,
    YouTubeApiError,
    YouTubeNotConfigured,
    search_candidates,
)
from film_coach.domain.youtube_data import (
    DAILY_QUOTA,
    SEARCH_COST,
    YouTubeCandidate,
    parse_iso_duration,
    quota_day,
    quota_resets_at,
)
from film_coach.infrastructure.library_fs import FilePracticeStore, FileVideoStore
from film_coach.infrastructure.youtube_api import FileQuotaLedger, YouTubeDataApi, load_api_key

NOW = datetime(2026, 10, 6, 3, 0, tzinfo=UTC)  # 米国太平洋時間では 10/5 の 20:00

# ---- 規則 ----


@pytest.mark.parametrize(
    ("text", "sec"),
    [("PT1M30S", 90), ("PT45S", 45), ("PT1H2M3S", 3723), ("P1DT1S", 86401), ("PT", 0), ("", 0), ("1:30", 0)],
)
def test_YouTubeの長さを秒にする(text: str, sec: int) -> None:
    assert parse_iso_duration(text) == sec


def test_無料枠の日付は米国太平洋時間で区切る() -> None:
    assert quota_day(datetime(2026, 10, 6, 6, 59, tzinfo=UTC)) == "2026-10-05"  # 太平洋夏時間の 23:59
    assert quota_day(datetime(2026, 10, 6, 7, 0, tzinfo=UTC)) == "2026-10-06"
    assert quota_resets_at(NOW).astimezone(UTC) == datetime(2026, 10, 6, 7, 0, tzinfo=UTC)


# ---- ユースケース ----


def candidate(i: int) -> YouTubeCandidate:
    return YouTubeCandidate(
        f"Vid{i:08d}",
        f"QB の投げ方 {i}",
        "架空の QB 研究所",
        "UCfake",
        "2025-01-01T00:00:00Z",
        95,
        1000 * i,
        50 * i,
        3,
        12_000,
        "youtube",
        "hd",
        "",
    )


class FakeSearch:
    def __init__(self, configured: bool = True, error: Exception | None = None) -> None:
        self._configured = configured
        self.error = error
        self.calls: list[tuple[str, int, bool]] = []

    def configured(self) -> bool:
        return self._configured

    def search(self, query: str, max_results: int, creative_commons: bool) -> list[YouTubeCandidate]:
        self.calls.append((query, max_results, creative_commons))
        if self.error:
            raise self.error
        return [candidate(i) for i in range(1, 4)]

    def video(self, video_id: str) -> YouTubeCandidate | None:
        self.calls.append((video_id, 1, False))
        if self.error:
            raise self.error
        return None if video_id == "Gone0000000" else replace(candidate(7), video_id=video_id)


class MemoryLedger:
    def __init__(self, used: int = 0) -> None:
        self.data: dict[str, int] = {"2026-10-05": used}

    def used(self, day: str) -> int:
        return self.data.get(day, 0)

    def add(self, day: str, units: int) -> None:
        self.data[day] = self.used(day) + units


def test_検索するたびに無料枠を数え_残りを返す() -> None:
    api, ledger = FakeSearch(), MemoryLedger(used=500)
    found, quota = search_candidates(
        api, ledger, "  QB throwing mechanics ", creative_commons=True, max_results=40, clock=lambda: NOW
    )
    assert len(found) == 3
    assert api.calls == [("QB throwing mechanics", 25, True)]  # 前後の空白を除き、上限 25 件にそろえる
    assert quota.used == 500 + SEARCH_COST and quota.remaining == DAILY_QUOTA - 500 - SEARCH_COST


def test_キーがない_無料枠が足りない_検索語が不正なら_検索しない() -> None:
    with pytest.raises(YouTubeNotConfigured, match="security add-generic-password"):
        search_candidates(FakeSearch(configured=False), MemoryLedger(), "QB", clock=lambda: NOW)
    api = FakeSearch()
    with pytest.raises(QuotaExceeded, match="使い切りました"):
        search_candidates(api, MemoryLedger(used=DAILY_QUOTA - SEARCH_COST + 1), "QB", clock=lambda: NOW)
    with pytest.raises(ValueError, match="検索語"):
        search_candidates(api, MemoryLedger(), "   ", clock=lambda: NOW)
    assert api.calls == []


def test_YouTube側で無料枠が尽きたら_今日の分を使い切った扱いにする() -> None:
    ledger = MemoryLedger()
    with pytest.raises(QuotaExceeded):
        search_candidates(FakeSearch(error=QuotaExceeded("x")), ledger, "QB", clock=lambda: NOW)
    assert ledger.used("2026-10-05") >= DAILY_QUOTA


# ---- YouTube Data API の呼び出し（偽の応答） ----

KEY = "test-key-should-not-leak"


def fake_fetch(responses: dict[str, Any], seen: list[dict[str, list[str]]]):  # type: ignore[no-untyped-def]
    def fetch(url: str, _timeout: float) -> bytes:
        u = urlparse(url)
        params = parse_qs(u.query)
        seen.append({"resource": [u.path.rsplit("/", 1)[-1]], **params})
        return json.dumps(responses[u.path.rsplit("/", 1)[-1]]).encode()

    return fetch


RESPONSES = {
    "search": {
        "items": [
            {"id": {"videoId": "Vid00000001"}},
            {"id": {"videoId": "Vid00000002"}},
            {"id": {"videoId": "Vid00000003"}},
        ]
    },
    "videos": {
        "items": [
            {
                "id": "Vid00000002",
                "snippet": {
                    "title": "ステップの練習",
                    "channelTitle": "架空のコーチ",
                    "channelId": "UCb",
                    "publishedAt": "2024-05-01T00:00:00Z",
                    "thumbnails": {"medium": {"url": "https://i.ytimg.com/vi/Vid00000002/mqdefault.jpg"}},
                },
                "statistics": {"viewCount": "5000", "likeCount": "300"},
                "contentDetails": {"duration": "PT2M5S", "definition": "sd"},
                "status": {"embeddable": True, "license": "creativeCommon"},
            },
            {
                "id": "Vid00000001",
                "snippet": {
                    "title": "QB の投げ方",
                    "channelTitle": "架空の QB 研究所",
                    "channelId": "UCa",
                    "publishedAt": "2025-01-01T00:00:00Z",
                    "thumbnails": {},
                },
                "statistics": {"viewCount": "120000", "likeCount": "4100", "commentCount": "88"},
                "contentDetails": {"duration": "PT45S", "definition": "hd"},
                "status": {"embeddable": True, "license": "youtube"},
            },
            {
                "id": "Vid00000003",
                "snippet": {"title": "埋め込めない動画", "channelTitle": "x", "channelId": "UCa"},
                "statistics": {},
                "contentDetails": {},
                "status": {"embeddable": False},
            },
        ]
    },
    "channels": {
        "items": [
            {"id": "UCa", "statistics": {"subscriberCount": "52000"}},
            {"id": "UCb", "statistics": {"hiddenSubscriberCount": True}},
        ]
    },
}


def test_検索の順を保ち_埋め込めない動画を除き_統計を添える() -> None:
    seen: list[dict[str, list[str]]] = []
    api = YouTubeDataApi(key_loader=lambda: KEY, fetch=fake_fetch(RESPONSES, seen))
    found = api.search("QB", 10, creative_commons=True)
    assert [c.video_id for c in found] == ["Vid00000001", "Vid00000002"]
    a, b = found
    assert (a.views, a.likes, a.comments, a.subscribers, a.duration_sec, a.definition) == (
        120000,
        4100,
        88,
        52000,
        45,
        "hd",
    )
    assert (b.subscribers, b.comments, b.license, b.thumbnail.endswith("mqdefault.jpg")) == (
        None,
        None,
        "creativeCommon",
        True,
    )
    assert [s["resource"][0] for s in seen] == ["search", "videos", "channels"]
    assert seen[0]["videoLicense"] == ["creativeCommon"] and seen[0]["videoEmbeddable"] == ["true"]
    assert all(s["key"] == [KEY] for s in seen)


def http_error(code: int, reason: str) -> HTTPError:
    body = json.dumps({"error": {"errors": [{"reason": reason}]}}).encode()
    return HTTPError("https://www.googleapis.com/youtube/v3/search?key=" + KEY, code, "x", {}, io.BytesIO(body))  # type: ignore[arg-type]


@pytest.mark.parametrize(
    ("code", "reason", "error"),
    [(403, "quotaExceeded", QuotaExceeded), (400, "keyInvalid", YouTubeApiError), (500, "", YouTubeApiError)],
)
def test_APIのエラーを分かる言葉に直し_キーは漏らさない(code: int, reason: str, error: type[Exception]) -> None:
    def fetch(_url: str, _timeout: float) -> bytes:
        raise http_error(code, reason)

    with pytest.raises(error) as info:
        YouTubeDataApi(key_loader=lambda: KEY, fetch=fetch).search("QB", 5, False)
    assert KEY not in str(info.value) and info.value.__cause__ is None


def test_キーは環境変数から読める(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("YOUTUBE_API_KEY", " abc ")
    assert load_api_key() == "abc"


def test_無料枠の記録は日付が変わると0から数える(tmp_path: Path) -> None:
    ledger = FileQuotaLedger(tmp_path / "quota.json")
    ledger.add("2026-10-05", 102)
    ledger.add("2026-10-05", 102)
    assert ledger.used("2026-10-05") == 204 and ledger.used("2026-10-06") == 0
    ledger.add("2026-10-06", 102)
    assert ledger.used("2026-10-06") == 102


# ---- HTTP ----


def client_with(tmp_path: Path, youtube: FakeSearch | None) -> TestClient:
    deps = HttpDeps(
        store=FileVideoStore(tmp_path / "library"),
        practices=FilePracticeStore(tmp_path / "practices"),
        grabber=FakeGrabber(),
        fetcher=FakeFetcher(),
        jobs=JobRunner(),
        models=FakeModels(),
        open_video=lambda _p: FakeVideo(),
        detector=FakeDetector,
        pose=FakePose,
        sink_for=None,
        allowed_origins=[],
        youtube=youtube,
        quota=FileQuotaLedger(tmp_path / "quota.json"),
        clock=lambda: NOW,
    )
    return TestClient(create_app(deps))


def test_APIで候補を探し_キーの有無と無料枠を知らせる(tmp_path: Path) -> None:
    c = client_with(tmp_path, FakeSearch())
    status = c.get("/api/youtube/status").json()
    assert status["configured"] is True and status["quota"]["used"] == 0 and "key" not in json.dumps(status).lower()
    res = c.get("/api/youtube/search", params={"q": "QB drill", "cc": "true", "max": 5})
    assert res.status_code == 200, res.text
    body = res.json()
    assert len(body["candidates"]) == 3 and body["creativeCommonsOnly"] is True
    assert body["candidates"][0]["url"] == "https://www.youtube.com/watch?v=Vid00000001"
    assert body["quota"]["used"] == SEARCH_COST


def test_APIはキーがなければ503_無料枠を超えたら429(tmp_path: Path) -> None:
    assert (
        client_with(tmp_path, FakeSearch(configured=False)).get("/api/youtube/search", params={"q": "QB"}).status_code
        == 503
    )
    assert client_with(tmp_path, FakeSearch(configured=False)).get("/api/youtube/status").json()["configured"] is False
    c = client_with(tmp_path, FakeSearch(error=QuotaExceeded("尽きました")))
    assert c.get("/api/youtube/search", params={"q": "QB"}).status_code == 429
    assert c.get("/api/youtube/search", params={"q": ""}).status_code == 422


def test_検索の応答はスキーマに合う(tmp_path: Path) -> None:
    from film_coach.infrastructure.schema import validate

    body = client_with(tmp_path, FakeSearch()).get("/api/youtube/search", params={"q": "QB"}).json()
    validate("youtube-search.v1.schema.json", body)
