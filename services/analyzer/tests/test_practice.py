"""練習（映像のまとめ）の規則・保存・API。モデルも動画もいらない。"""

import io
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.jobs import JobRunner
from film_coach.application.library import NotFoundError, import_upload
from film_coach.application.practice import create_practice, delete_practice, get_practice, list_practices
from film_coach.domain.practice import MAX_VIDEOS, PracticeError, check_practice
from film_coach.infrastructure.library_fs import FilePracticeStore, FileVideoStore

# ---- 規則 ----


def test_名前の前後の空白を除いて受け付ける() -> None:
    assert check_practice("  投球ドリル ", "2026-10-05", "", ["a"]) == "投球ドリル"


@pytest.mark.parametrize(
    ("name", "day", "memo", "ids", "message"),
    [
        ("  ", "2026-10-05", "", ["a"], "名前"),
        ("あ" * 41, "2026-10-05", "", ["a"], "名前"),
        ("ドリル", "10/5", "", ["a"], "日付"),
        ("ドリル", "2026-02-30", "", ["a"], "日付"),
        ("ドリル", "2026-10-05", "あ" * 401, ["a"], "メモ"),
        ("ドリル", "2026-10-05", "", [], "1 本以上"),
        ("ドリル", "2026-10-05", "", [f"{i:012x}" for i in range(MAX_VIDEOS + 1)], "までです"),
        ("ドリル", "2026-10-05", "", ["a", "b", "a"], "2 回"),
    ],
)
def test_受け付けない入力(name: str, day: str, memo: str, ids: list[str], message: str) -> None:
    with pytest.raises(PracticeError, match=message):
        check_practice(name, day, memo, ids)


# ---- 保存 ----


@pytest.fixture
def stores(tmp_path: Path) -> tuple[FilePracticeStore, FileVideoStore]:
    return FilePracticeStore(tmp_path / "practices"), FileVideoStore(tmp_path / "library")


def upload(videos: FileVideoStore, name: str = "a.mov") -> str:
    return import_upload(videos, FakeGrabber(), name, io.BytesIO(b"v")).id


def test_映像を練習にまとめ_新しい順に一覧し_消してもまとめだけが消える(
    stores: tuple[FilePracticeStore, FileVideoStore],
) -> None:
    practices, videos = stores
    a, b = upload(videos), upload(videos)
    old = create_practice(practices, videos, "月曜", "2026-10-05", "drill", "side", "", [a])
    new = create_practice(practices, videos, "火曜", "2026-10-06", "drill", "side", "風が強い", [b, a])
    assert [p.name for p in list_practices(practices)] == ["火曜", "月曜"]
    got = get_practice(practices, new.id)
    assert got.video_ids == (b, a) and got.memo == "風が強い"
    delete_practice(practices, old.id)
    assert [p.id for p in list_practices(practices)] == [new.id]
    assert videos.get(a) is not None  # 映像は残る
    with pytest.raises(NotFoundError):
        delete_practice(practices, old.id)


def test_ない映像はまとめない_不正なIDはパスに使わない(stores: tuple[FilePracticeStore, FileVideoStore]) -> None:
    practices, videos = stores
    with pytest.raises(NotFoundError, match="ありません"):
        create_practice(practices, videos, "月曜", "2026-10-05", "drill", "side", "", ["0123456789ab"])
    assert practices.get("../../etc") is None and not practices.delete("../x")


# ---- API ----


@pytest.fixture
def client(tmp_path: Path) -> TestClient:
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
        allowed_origins=["http://localhost:5173"],
    )
    return TestClient(create_app(deps))


def test_APIで練習を作り_読み_消す(client: TestClient) -> None:
    vid = client.post("/api/videos", files={"file": ("a.mov", b"v", "video/quicktime")}).json()["id"]
    body = {"name": "投球ドリル", "date": "2026-10-05", "videoIds": [vid]}
    res = client.post("/api/practices", json=body)
    assert res.status_code == 201, res.text
    p = res.json()
    assert p["kind"] == "drill" and p["camera"] == "side" and p["links"]["self"] == f"/api/practices/{p['id']}"
    assert [x["id"] for x in client.get("/api/practices").json()] == [p["id"]]
    assert client.get(f"/api/practices/{p['id']}").json()["videoIds"] == [vid]
    assert client.delete(f"/api/practices/{p['id']}").status_code == 204
    assert client.get(f"/api/practices/{p['id']}").status_code == 404
    assert client.delete(f"/api/practices/{p['id']}").status_code == 404


def test_APIは不正な練習を断る(client: TestClient) -> None:
    vid = client.post("/api/videos", files={"file": ("a.mov", b"v", "video/quicktime")}).json()["id"]
    bad_date = client.post("/api/practices", json={"name": "x", "date": "昨日", "videoIds": [vid]})
    assert bad_date.status_code == 400 and "日付" in bad_date.json()["detail"]
    assert (
        client.post(
            "/api/practices", json={"name": "x", "date": "2026-10-05", "videoIds": ["0123456789ab"]}
        ).status_code
        == 404
    )
    assert (
        client.post(
            "/api/practices", json={"name": "x", "date": "2026-10-05", "kind": "match", "videoIds": [vid]}
        ).status_code
        == 422
    )


def test_画面から練習を消せるようにDELETEをCORSで許す(client: TestClient) -> None:
    res = client.options(
        "/api/practices/0123456789ab",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "DELETE"},
    )
    assert res.status_code == 200 and "DELETE" in res.headers["access-control-allow-methods"]
