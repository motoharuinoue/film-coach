"""YouTube の規則、取り込みのユースケース、ファイルの保存、ジョブ。モデルも動画もいらない。"""

import io
import time
from pathlib import Path

import pytest
from test_track_target import FakeDetector, FakePose, FakeVideo

from film_coach.application.jobs import JobRunner
from film_coach.application.library import (
    ImportRejected,
    NotFoundError,
    frame_jpeg,
    import_upload,
    import_youtube,
    run_tracking,
)
from film_coach.application.track_target import TargetHint
from film_coach.domain.library import VideoInfo, YouTubeSource
from film_coach.domain.youtube import SegmentError, check_segment, parse_time, parse_youtube_id
from film_coach.infrastructure.library_fs import FileVideoStore, record_from_json, record_to_json

# ---- YouTube の規則（apps/web/src/domain/youtube.test.ts と同じケース） ----


@pytest.mark.parametrize(
    "url",
    [
        "https://www.youtube.com/watch?v=Qb7Throw_01",
        "https://youtube.com/watch?v=Qb7Throw_01&t=42s",
        "https://m.youtube.com/watch?v=Qb7Throw_01",
        "https://youtu.be/Qb7Throw_01?si=abc",
        "https://www.youtube.com/shorts/Qb7Throw_01",
        "https://www.youtube-nocookie.com/embed/Qb7Throw_01",
    ],
)
def test_URLから動画IDを取り出す(url: str) -> None:
    assert parse_youtube_id(url) == "Qb7Throw_01"


@pytest.mark.parametrize(
    "url",
    [
        "",
        "Qb7Throw_01",
        "https://example.com/watch?v=Qb7Throw_01",
        "https://www.youtube.com/watch?v=short",
        "https://www.youtube.com/channel/UC123",
        "javascript:alert(1)",
    ],
)
def test_YouTubeの動画URLでなければ受け付けない(url: str) -> None:
    assert parse_youtube_id(url) is None


def test_時刻と区間() -> None:
    assert parse_time("1:05") == 65
    assert parse_time("1:02:03") == 3723
    assert parse_time("1:75") is None
    assert check_segment(134, 137).seconds == 3
    with pytest.raises(SegmentError, match="60 秒"):
        check_segment(0, 61)
    with pytest.raises(SegmentError):
        check_segment(10, 10)


# ---- 取り込みと追跡のユースケース ----


INFO = VideoInfo("x", 30, 1920, 1080, 60)


class FakeGrabber:
    def __init__(self, broken: bool = False) -> None:
        self.broken = broken

    def probe(self, path: Path) -> VideoInfo:
        if self.broken:
            raise ValueError("壊れた動画")
        return INFO

    def jpeg_at(self, path: Path, t: float, max_width: int = 1280) -> bytes:
        return b"\xff\xd8jpeg" + str(t).encode()


class FakeFetcher:
    def __init__(self) -> None:
        self.fetched: list[tuple[str, int, int]] = []

    def metadata(self, video_id: str) -> YouTubeSource:
        return YouTubeSource(video_id, 0, 0, "QB の 3 ステップドロップ", "Spiral Lab", "creativeCommon")

    def fetch_segment(self, video_id: str, start: int, end: int, dest: Path) -> Path:
        self.fetched.append((video_id, start, end))
        dest.write_bytes(b"video")
        return dest


@pytest.fixture
def store(tmp_path: Path) -> FileVideoStore:
    return FileVideoStore(tmp_path / "library")


def test_アップロードした動画を記録し_スキーマに合うJSONで保存する(store: FileVideoStore) -> None:
    r = import_upload(store, FakeGrabber(), "IMG_0001.MOV", io.BytesIO(b"video"))
    assert r.source == "upload" and r.name == "IMG_0001.MOV" and r.media_retained
    assert store.media(r.id) is not None and store.media(r.id).suffix == ".mov"  # type: ignore[union-attr]
    assert store.get(r.id) == r
    assert record_from_json(record_to_json(r)) == r
    assert [x.id for x in store.list()] == [r.id]


def test_動画でないファイルや読めない動画は取り込まない(store: FileVideoStore) -> None:
    with pytest.raises(ImportRejected, match="取り込めません"):
        import_upload(store, FakeGrabber(), "notes.txt", io.BytesIO(b"x"))
    with pytest.raises(ImportRejected, match="読めませんでした"):
        import_upload(store, FakeGrabber(broken=True), "clip.mp4", io.BytesIO(b"x"))
    assert all(store.media(p.name) is None for p in store.root.iterdir())


def test_YouTubeは区間だけを取得し_出典を記録する(store: FileVideoStore) -> None:
    fetcher = FakeFetcher()
    r = import_youtube(store, FakeGrabber(), fetcher, "https://youtu.be/Qb7Throw_01", 134, 137)
    assert fetcher.fetched == [("Qb7Throw_01", 134, 137)]
    assert r.source == "youtube" and r.youtube is not None
    assert (r.youtube.start, r.youtube.end, r.youtube.channel) == (134, 137, "Spiral Lab")
    assert record_to_json(r)["youtube"]["url"] == "https://www.youtube.com/watch?v=Qb7Throw_01&t=134s"


def test_YouTubeの入力が不正なら取得しない(store: FileVideoStore) -> None:
    fetcher = FakeFetcher()
    with pytest.raises(ImportRejected):
        import_youtube(store, FakeGrabber(), fetcher, "https://example.com/v", 0, 5)
    with pytest.raises(SegmentError):
        import_youtube(store, FakeGrabber(), fetcher, "https://youtu.be/Qb7Throw_01", 0, 90)
    assert fetcher.fetched == []


def track(store: FileVideoStore, video_id: str) -> None:
    run_tracking(
        store,
        lambda _p: FakeVideo(),
        FakeDetector(),
        FakePose(),
        None,
        video_id,
        TargetHint(185, 400, 10 / 30),
        "#5",
        lambda *_: None,
    )


def test_追跡のあと_アップロードは元の動画を残し_YouTubeは消す(store: FileVideoStore) -> None:
    up = import_upload(store, FakeGrabber(), "a.mp4", io.BytesIO(b"v"))
    yt = import_youtube(store, FakeGrabber(), FakeFetcher(), "https://youtu.be/Qb7Throw_01", 0, 5)
    track(store, up.id)
    track(store, yt.id)
    up2, yt2 = store.get(up.id), store.get(yt.id)
    assert up2 and up2.track_status == "done" and up2.media_retained and store.media(up.id)
    assert yt2 and yt2.track_status == "done" and not yt2.media_retained and store.media(yt.id) is None
    assert store.track_path(yt.id) is not None  # 派生データは残す
    with pytest.raises(NotFoundError, match="消しています"):
        frame_jpeg(store, FakeGrabber(), yt.id, 1.0)


def test_追跡に失敗したら記録に理由を残す(store: FileVideoStore) -> None:
    r = import_upload(store, FakeGrabber(), "a.mp4", io.BytesIO(b"v"))
    with pytest.raises(LookupError):
        run_tracking(
            store,
            lambda _p: FakeVideo(),
            FakeDetector(),
            FakePose(),
            None,
            r.id,
            TargetHint(960, 900, 1),
            "",
            lambda *_: None,
        )
    failed = store.get(r.id)
    assert failed and failed.track_status == "failed" and "見つかりません" in failed.errors[0]


def test_不正なIDはパスに使わない(store: FileVideoStore) -> None:
    assert store.get("../../etc/passwd") is None
    with pytest.raises(ValueError, match="不正な ID"):
        store.media("../x")


# ---- ジョブ ----


def wait(runner: JobRunner, job_id: str) -> None:
    for _ in range(200):
        job = runner.get(job_id)
        if job and job.state in ("done", "failed"):
            return
        time.sleep(0.01)
    raise AssertionError("ジョブが終わらない")


def test_ジョブは進み具合を順に記録し_最後に結果を残す() -> None:
    runner = JobRunner()

    def work(report):  # type: ignore[no-untyped-def]
        for i in range(1, 101):
            report("detect", i, 100)
        return {"ok": True}

    job = runner.submit("track", "v1", work)
    wait(runner, job.id)
    kinds = [e.kind for e in runner.follow(job.id) if e]
    assert kinds[:2] == ["state", "state"] and kinds[-1] == "done"
    assert sum(k == "progress" for k in kinds) == 100  # 1% ごと
    assert runner.latest_for("v1") is job


def test_ジョブの失敗は出来事として伝える() -> None:
    runner = JobRunner()

    def work(_report):  # type: ignore[no-untyped-def]
        raise ValueError("だめでした")

    job = runner.submit("track", "v1", work)
    wait(runner, job.id)
    events = [e for e in runner.follow(job.id) if e]
    assert events[-1].kind == "failed" and events[-1].data["message"] == "だめでした"
    assert job.state == "failed"
