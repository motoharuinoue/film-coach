"""お手本の登録：条件、YouTube の統計の取り直し、無料枠、調整、削除、API。本物の YouTube Data API は呼ばない。"""

import io
import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from test_http import FakeModels
from test_throws_io_api import synth_track
from test_track_target import FakeDetector, FakePose, FakeVideo
from test_youtube_library import FakeFetcher, FakeGrabber
from test_youtube_search import NOW, FakeSearch, MemoryLedger

from film_coach.adapters.http import HttpDeps, create_app
from film_coach.application.jobs import JobRunner
from film_coach.application.library import NotFoundError, analyze_footage_throws, import_upload, import_youtube
from film_coach.application.reference import (
    delete_reference,
    list_references,
    refresh_reference,
    register_reference,
    update_reference,
)
from film_coach.application.youtube_search import QuotaExceeded, YouTubeNotConfigured
from film_coach.domain.pose import PoseSequence
from film_coach.domain.reference import Manual, ReferenceError
from film_coach.domain.youtube_data import DAILY_QUOTA, VIDEO_COST
from film_coach.infrastructure.json_throws import throws_from_json, throws_to_json
from film_coach.infrastructure.library_fs import FilePracticeStore, FileReferenceStore, FileVideoStore
from film_coach.infrastructure.youtube_api import FileQuotaLedger


@pytest.fixture
def setup(tmp_path: Path, base_sequence: PoseSequence) -> tuple[FileReferenceStore, FileVideoStore, str]:
    """YouTube から取り込み、投球を解析した映像を 1 本用意する"""
    videos = FileVideoStore(tmp_path / "library")
    yt = import_youtube(videos, FakeGrabber(), FakeFetcher(), "https://youtu.be/Qb7Throw_01", 10, 40)
    videos.save_track(yt.id, synth_track(base_sequence))
    analyze_footage_throws(videos, yt.id, 1.85)
    return FileReferenceStore(tmp_path / "references"), videos, yt.id


def test_取り込んだYouTubeの映像を_統計を取り直してお手本にする(
    setup: tuple[FileReferenceStore, FileVideoStore, str],
) -> None:
    refs, videos, vid = setup
    api, ledger = FakeSearch(), MemoryLedger()
    r = register_reference(refs, videos, api, ledger, vid, "model", True, None, clock=lambda: NOW)
    assert api.calls == [("Qb7Throw_01", 1, False)]
    assert ledger.used("2026-10-05") == VIDEO_COST
    assert (r.video_id, r.youtube_id, r.kind, r.trusted_channel) == (vid, "Qb7Throw_01", "model", True)
    assert r.player_height_cm == pytest.approx(185)  # 投球の解析に使った身長
    assert r.stats.views == 7000 and r.stats.subscribers == 12_000 and r.manual == Manual()
    assert [x.id for x in list_references(refs)] == [r.id]
    assert refs.get(r.id) == r  # スキーマに合う JSON で保存し、読み戻せる


def test_お手本にできない映像(setup: tuple[FileReferenceStore, FileVideoStore, str], tmp_path: Path) -> None:
    refs, videos, vid = setup
    api, ledger = FakeSearch(), MemoryLedger()
    up = import_upload(videos, FakeGrabber(), "a.mov", io.BytesIO(b"v"))
    with pytest.raises(ReferenceError, match="YouTube から取り込んだ"):
        register_reference(refs, videos, api, ledger, up.id, clock=lambda: NOW)
    bare = import_youtube(videos, FakeGrabber(), FakeFetcher(), "https://youtu.be/Qb7Throw_02", 0, 20)
    with pytest.raises(ReferenceError, match="投球がまだありません"):
        register_reference(refs, videos, api, ledger, bare.id, clock=lambda: NOW)
    register_reference(refs, videos, api, ledger, vid, clock=lambda: NOW)
    with pytest.raises(ReferenceError, match="もうお手本として登録"):
        register_reference(refs, videos, api, ledger, vid, clock=lambda: NOW)
    with pytest.raises(NotFoundError):
        register_reference(refs, videos, api, ledger, "0123456789ab", clock=lambda: NOW)


def test_キーがない_無料枠がない_動画が消えていたら_登録しない(
    setup: tuple[FileReferenceStore, FileVideoStore, str],
) -> None:
    refs, videos, vid = setup
    with pytest.raises(YouTubeNotConfigured):
        register_reference(refs, videos, FakeSearch(configured=False), MemoryLedger(), vid, clock=lambda: NOW)
    with pytest.raises(QuotaExceeded):
        register_reference(refs, videos, FakeSearch(), MemoryLedger(used=DAILY_QUOTA - 1), vid, clock=lambda: NOW)
    gone = import_youtube(videos, FakeGrabber(), FakeFetcher(), "https://youtu.be/Gone0000000", 0, 20)
    videos.save_track(gone.id, videos.load_track(vid))  # type: ignore[arg-type]
    analyze_footage_throws(videos, gone.id, 1.85)
    with pytest.raises(NotFoundError, match="見つかりません"):
        register_reference(refs, videos, FakeSearch(), MemoryLedger(), gone.id, clock=lambda: NOW)
    assert list_references(refs) == []


def test_調整と統計の取り直しと削除(setup: tuple[FileReferenceStore, FileVideoStore, str]) -> None:
    refs, videos, vid = setup
    ledger = MemoryLedger()
    r = register_reference(refs, videos, FakeSearch(), ledger, vid, clock=lambda: NOW)
    r2 = update_reference(refs, r.id, kind="drill", manual=Manual(pinned=True, stars=5))
    assert (r2.kind, r2.manual.pinned, r2.manual.stars, r2.trusted_channel) == ("drill", True, 5, False)
    with pytest.raises(ReferenceError, match="星"):
        update_reference(refs, r.id, manual=Manual(stars=9))
    refresh_reference(refs, FakeSearch(), ledger, r.id, clock=lambda: NOW)
    assert ledger.used("2026-10-05") == 2 * VIDEO_COST
    delete_reference(refs, r.id)
    assert list_references(refs) == [] and videos.get(vid) is not None  # 元の映像は残す
    with pytest.raises(NotFoundError):
        delete_reference(refs, r.id)


def test_投球の解析結果はJSONから読み戻せる(setup: tuple[FileReferenceStore, FileVideoStore, str]) -> None:
    _, videos, vid = setup
    original = videos.load_throws(vid)
    assert original is not None
    back = throws_from_json(json.loads(json.dumps(throws_to_json(original))))
    assert len(back.reps) == len(original.reps) == 1
    a, b = original.reps[0].analysis, back.reps[0].analysis
    assert b.events == a.events and [p.key for p in b.phases] == [p.key for p in a.phases]
    assert b.metrics == pytest.approx({k: round(v, 4) for k, v in a.metrics.items()})


# ---- API ----


def client(tmp_path: Path, setup: tuple[FileReferenceStore, FileVideoStore, str]) -> TestClient:
    refs, videos, _ = setup
    deps = HttpDeps(
        store=videos,
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
        youtube=FakeSearch(),
        quota=FileQuotaLedger(tmp_path / "quota.json"),
        clock=lambda: NOW,
        references=refs,
    )
    return TestClient(create_app(deps))


def test_APIでお手本を登録し_調整し_統計を取り直し_消す(
    tmp_path: Path, setup: tuple[FileReferenceStore, FileVideoStore, str]
) -> None:
    c = client(tmp_path, setup)
    vid = setup[2]
    res = c.post("/api/references", json={"footageId": vid, "kind": "model", "playerHeightCm": 193})
    assert res.status_code == 201, res.text
    r = res.json()
    assert r["playerHeightCm"] == 193 and r["links"] == {
        "self": f"/api/references/{r['id']}",
        "footage": f"/api/videos/{vid}",
        "throws": f"/api/videos/{vid}/throws",
    }
    assert c.post("/api/references", json={"footageId": vid}).status_code == 400  # 二重の登録
    patched = c.patch(
        f"/api/references/{r['id']}",
        json={"trustedChannel": True, "manual": {"pinned": False, "excluded": True, "stars": 2}},
    ).json()
    assert patched["trustedChannel"] is True and patched["manual"] == {"pinned": False, "excluded": True, "stars": 2}
    assert c.patch(f"/api/references/{r['id']}", json={"manual": {"stars": 6}}).status_code == 422
    assert c.post(f"/api/references/{r['id']}/refresh").status_code == 200
    assert [x["id"] for x in c.get("/api/references").json()] == [r["id"]]
    assert c.get("/api/youtube/status").json()["quota"]["used"] == 2 * VIDEO_COST
    assert c.delete(f"/api/references/{r['id']}").status_code == 204
    assert c.get("/api/references").json() == []


def test_APIは画面からの更新のためにPATCHを許す(
    tmp_path: Path, setup: tuple[FileReferenceStore, FileVideoStore, str]
) -> None:
    res = client(tmp_path, setup).options(
        "/api/references/0123456789ab",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH"},
    )
    assert res.status_code == 200 and "PATCH" in res.headers["access-control-allow-methods"]
