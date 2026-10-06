"""HTTP の入口（FastAPI）。依存は bootstrap.py から受け取る。

手元の画面（http://localhost:5173）からだけ使う前提で、127.0.0.1 で待ち受ける。
動画は利用者の手元から外に出さない。
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Annotated, Any, cast

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from ..application import dto
from ..application.drill import DrillStore, create_drill, delete_drill, list_drills
from ..application.evaluation import AnnotationStore, evaluate, evaluation_targets, save_annotation
from ..application.jobs import JobRunner
from ..application.library import (
    FrameGrabber,
    ImportRejected,
    NotFoundError,
    VideoStore,
    YouTubeFetcher,
    analyze_footage_throws,
    frame_jpeg,
    get_record,
    import_upload,
    import_youtube,
    run_tracking,
)
from ..application.ports import ModelStore
from ..application.practice import PracticeStore, create_practice, delete_practice, get_practice, list_practices
from ..application.reference import (
    ReferenceStore,
    delete_reference,
    list_references,
    refresh_reference,
    register_reference,
    update_reference,
)
from ..application.track_target import (
    CameraMotionEstimator,
    FrameSink,
    PersonDetector,
    PoseEstimator,
    ShotBoundaryDetector,
    TargetHint,
    TargetNotFoundError,
    VideoReader,
)
from ..application.youtube_search import (
    Clock,
    QuotaExceeded,
    QuotaLedger,
    YouTubeApiError,
    YouTubeNotConfigured,
    YouTubeSearch,
    quota_status,
    search_candidates,
)
from ..domain.approach import ApproachMode
from ..domain.camera import CameraAngle
from ..domain.drill import MAX_LABEL, MAX_TARGETS, Drill, DrillError, DrillSide, DrillTarget
from ..domain.evaluation import AnnotationError, FrameLabel, ThrowLabel
from ..domain.library import VideoInfo, VideoRecord
from ..domain.metrics import MetricKey
from ..domain.pose import KeypointName
from ..domain.practice import MAX_MEMO, MAX_NAME, MAX_VIDEOS, Practice, PracticeError, PracticeKind
from ..domain.reference import Manual, Reference, ReferenceError, ReferenceKind
from ..domain.world import NotEnoughPoseError
from ..domain.youtube import SegmentError

MAX_UPLOAD_BYTES = 2 * 1024**3
"""アップロードの上限（2 GB）"""


@dataclass(frozen=True, slots=True)
class HttpDeps:
    store: VideoStore
    practices: PracticeStore
    grabber: FrameGrabber
    fetcher: YouTubeFetcher
    jobs: JobRunner
    models: ModelStore
    open_video: Callable[[Path], VideoReader]
    detector: Callable[[], PersonDetector]
    pose: Callable[[], PoseEstimator]
    sink_for: Callable[[Path, VideoInfo, str], FrameSink] | None
    allowed_origins: list[str]
    shots: Callable[[], ShotBoundaryDetector] | None = None
    """場面の切り替わりを見つける（追跡ごとに新しく作る）"""
    youtube: YouTubeSearch | None = None
    """お手本の候補を探す（YouTube Data API）"""
    quota: QuotaLedger | None = None
    """YouTube Data API の無料枠の記録"""
    clock: Clock | None = None
    references: ReferenceStore | None = None
    """お手本の登録"""
    motion: Callable[[], CameraMotionEstimator] | None = None
    """カメラの動きを見積もる（追跡ごとに新しく作る）"""
    drills: DrillStore | None = None
    """改善点に添えるドリル動画の登録"""
    annotations: AnnotationStore | None = None
    """精度の評価のために付けた正解"""


class YouTubeImport(BaseModel):
    url: str
    start: int = Field(ge=0, description="開始（秒）")
    end: int = Field(gt=0, description="終了（秒）")


class PracticeRequest(BaseModel):
    name: str = Field(max_length=MAX_NAME)
    date: str = Field(description="練習した日（YYYY-MM-DD）")
    kind: PracticeKind = "drill"
    camera: CameraAngle = "side"
    memo: str = Field(default="", max_length=MAX_MEMO)
    videoIds: list[str] = Field(max_length=MAX_VIDEOS)


class ManualBody(BaseModel):
    pinned: bool = False
    excluded: bool = False
    stars: int = Field(default=3, ge=1, le=5)


class ReferenceRequest(BaseModel):
    footageId: str
    kind: ReferenceKind = "model"
    trustedChannel: bool = False
    playerHeightCm: float | None = Field(default=None, ge=120, le=230)


class DrillTargetBody(BaseModel):
    metric: MetricKey
    side: DrillSide = "any"


class DrillRequest(BaseModel):
    youtubeId: str
    title: str = Field(default="", max_length=200)
    channel: str = Field(default="", max_length=200)
    startSec: int = Field(default=0, ge=0)
    label: str = Field(max_length=MAX_LABEL)
    targets: list[DrillTargetBody] = Field(max_length=MAX_TARGETS)


class ThrowLabelBody(BaseModel):
    rep: int = Field(ge=1)
    plant: int | None = Field(default=None, ge=0)
    release: int | None = Field(default=None, ge=0)


class FrameLabelBody(BaseModel):
    frame: int = Field(ge=0)
    points: dict[str, tuple[float, float] | None] = Field(
        description="関節ごとの位置（元の映像のピクセル）。null は見えない"
    )


class AnnotationRequest(BaseModel):
    throws: list[ThrowLabelBody] = Field(max_length=50)
    frames: list[FrameLabelBody] = Field(max_length=500)


class ReferencePatch(BaseModel):
    kind: ReferenceKind | None = None
    trustedChannel: bool | None = None
    manual: ManualBody | None = None


class ThrowsRequest(BaseModel):
    heightCm: float = Field(ge=120, le=230, description="選手の身長（cm）")
    camera: CameraAngle = "side"
    slowmo: float = Field(default=1, ge=1, le=16, description="スロー再生の倍率（1 は等速）")
    approach: ApproachMode = Field(default="auto", description="投げ始め（auto は骨格から見分ける）")


class TrackRequest(BaseModel):
    t: float = Field(ge=0, description="対象選手を指す時刻（秒）")
    x: float = Field(ge=0, description="元の動画のピクセル座標")
    y: float = Field(ge=0)
    label: str = Field(default="", max_length=20)


REVALIDATE = {"Cache-Control": "no-cache"}
"""追跡のやり直しや計算し直しで中身が変わる結果は、使うたびにブラウザに確かめさせる（変わっていなければ ETag で 304）"""


def create_app(deps: HttpDeps) -> FastAPI:
    app = FastAPI(title="Film Coach 解析サービス", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=deps.allowed_origins,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
        allow_headers=["Content-Type"],
    )

    def view(r: VideoRecord) -> dict[str, Any]:
        """記録に、使える URL を添える"""
        base = f"/api/videos/{r.id}"
        job = deps.jobs.latest_for(r.id)
        links: dict[str, str | None] = {
            "self": base,
            "frame": f"{base}/frame" if r.media_retained else None,
            "media": f"{base}/media" if r.media_retained else None,
            "track": f"{base}/track" if r.track_status == "done" else None,
            "preview": f"{base}/outputs/preview.mp4" if deps.store.output_file(r.id, "preview.mp4") else None,
            "focus": f"{base}/outputs/focus.mp4" if deps.store.output_file(r.id, "focus.mp4") else None,
            "throws": f"{base}/throws" if deps.store.throws_path(r.id) else None,
            "events": f"/api/jobs/{job.id}/events" if job else None,
        }
        return {**dto.record_to_json(r), "links": links}

    def record_or_404(video_id: str) -> VideoRecord:
        try:
            return get_record(deps.store, video_id)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e

    def practice_view(p: Practice) -> dict[str, Any]:
        return {**dto.practice_to_json(p), "links": {"self": f"/api/practices/{p.id}"}}

    @app.exception_handler(ImportRejected)
    @app.exception_handler(SegmentError)
    @app.exception_handler(PracticeError)
    @app.exception_handler(ReferenceError)
    @app.exception_handler(DrillError)
    @app.exception_handler(AnnotationError)
    async def bad_request(_req: Request, exc: Exception) -> JSONResponse:
        return JSONResponse({"detail": str(exc)}, status_code=400)

    @app.get("/api/health")
    def health() -> dict[str, Any]:
        models = [{"role": role, "mb": round(mb), "present": present} for role, mb, present, _ in deps.models.status()]
        return {"ok": True, "modelsReady": all(m["present"] for m in models), "models": models}

    @app.get("/api/videos")
    def list_videos() -> list[dict[str, Any]]:
        return [view(r) for r in deps.store.list()]

    @app.post("/api/videos", status_code=201)
    def upload(request: Request, file: Annotated[UploadFile, File()]) -> dict[str, Any]:
        size = int(request.headers.get("content-length") or 0)
        if size > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "動画が大きすぎます（2 GB まで）")
        return view(import_upload(deps.store, deps.grabber, file.filename or "upload.mp4", file.file))

    @app.post("/api/videos/youtube", status_code=201)
    def from_youtube(body: YouTubeImport) -> dict[str, Any]:
        try:
            record = import_youtube(deps.store, deps.grabber, deps.fetcher, body.url, body.start, body.end)
        except (ImportRejected, SegmentError):
            raise
        except Exception as e:
            raise HTTPException(502, str(e)) from e
        return view(record)

    @app.get("/api/videos/{video_id}")
    def get_video(video_id: str) -> dict[str, Any]:
        return view(record_or_404(video_id))

    @app.get("/api/videos/{video_id}/frame")
    def frame(
        video_id: str,
        t: float = Query(0.0, ge=0),
        i: int | None = Query(None, ge=0, description="フレーム番号（指定したら t より優先）"),
        maxWidth: int = Query(1280, ge=320, le=3840),
    ) -> Response:
        record_or_404(video_id)
        try:
            return Response(frame_jpeg(deps.store, deps.grabber, video_id, t, i, maxWidth), media_type="image/jpeg")
        except NotFoundError as e:
            raise HTTPException(410, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @app.get("/api/videos/{video_id}/media")
    def media(video_id: str) -> FileResponse:
        record_or_404(video_id)
        path = deps.store.media(video_id)
        if path is None:
            raise HTTPException(410, "元の動画は残していません（YouTube の区間は解析のあとに消しています）")
        return FileResponse(path, media_type="video/mp4" if path.suffix != ".mov" else "video/quicktime")

    @app.get("/api/videos/{video_id}/outputs/{name}")
    def output(video_id: str, name: str) -> FileResponse:
        record_or_404(video_id)
        path = deps.store.output_file(video_id, name)
        if path is None:
            raise HTTPException(404, f"{name} はまだありません")
        return FileResponse(path, media_type="video/mp4", headers=REVALIDATE)

    @app.get("/api/videos/{video_id}/track")
    def track(video_id: str) -> FileResponse:
        record_or_404(video_id)
        path = deps.store.track_path(video_id)
        if path is None:
            raise HTTPException(404, "追跡はまだ終わっていません")
        return FileResponse(path, media_type="application/json", headers=REVALIDATE)

    @app.post("/api/videos/{video_id}/throws")
    def analyze_throws(video_id: str, body: ThrowsRequest) -> FileResponse:
        """追跡した骨格から投球を見つけて、1 本ずつ指標を出す。骨格だけを使うので、すぐに終わる"""
        record_or_404(video_id)
        try:
            analyze_footage_throws(deps.store, video_id, body.heightCm / 100, body.camera, body.slowmo, body.approach)
        except NotFoundError as e:
            raise HTTPException(409, str(e)) from e
        except NotEnoughPoseError as e:
            raise HTTPException(422, str(e)) from e
        return throws(video_id)

    @app.get("/api/videos/{video_id}/throws")
    def throws(video_id: str) -> FileResponse:
        record_or_404(video_id)
        path = deps.store.throws_path(video_id)
        if path is None:
            raise HTTPException(404, "投球はまだ解析していません")
        return FileResponse(path, media_type="application/json", headers=REVALIDATE)

    @app.post("/api/videos/{video_id}/track", status_code=202)
    def start_track(video_id: str, body: TrackRequest) -> dict[str, Any]:
        record = record_or_404(video_id)
        if record.track_status == "running":
            raise HTTPException(409, "この動画の追跡はすでに動いています")
        if not record.media_retained or deps.store.media(video_id) is None:
            raise HTTPException(410, "元の動画が残っていないので、追跡をやり直せません。もう一度取り込んでください")

        def work(report: Callable[[str, int, int], None]) -> dict[str, Any]:
            try:
                tt = run_tracking(
                    deps.store,
                    deps.open_video,
                    deps.detector(),
                    deps.pose(),
                    deps.sink_for,
                    video_id,
                    TargetHint(body.x, body.y, body.t),
                    body.label,
                    report,
                    deps.shots() if deps.shots else None,
                    deps.motion() if deps.motion else None,
                )
            except TargetNotFoundError as e:
                raise ValueError(str(e)) from e
            filled = sum(f.interpolated for f in tt.frames)
            return {
                "videoId": video_id,
                "coverage": round(tt.coverage, 4),
                "segments": len(tt.segments),
                "interpolated": filled,
            }

        job = deps.jobs.submit("track", video_id, work)
        return {"jobId": job.id, "events": f"/api/jobs/{job.id}/events"}

    def now() -> datetime:
        return deps.clock() if deps.clock else datetime.now(UTC)

    @app.get("/api/youtube/status")
    def youtube_status() -> dict[str, Any]:
        """API キーがあるか（キーそのものは返さない）と、今日の無料枠"""
        configured = bool(deps.youtube and deps.youtube.configured())
        quota = dto.quota_to_json(quota_status(deps.quota, now())) if deps.quota else None
        return {"configured": configured, "quota": quota}

    @app.get("/api/youtube/search")
    def youtube_search(
        q: str = Query(min_length=1, max_length=100),
        cc: bool = Query(False, description="Creative Commons の動画だけ"),
        max: int = Query(12, ge=1, le=25),
    ) -> dict[str, Any]:
        if deps.youtube is None or deps.quota is None:
            raise HTTPException(503, "YouTube の検索は使えません")
        try:
            found, quota = search_candidates(deps.youtube, deps.quota, q, cc, max, now)
        except YouTubeNotConfigured as e:
            raise HTTPException(503, str(e)) from e
        except QuotaExceeded as e:
            raise HTTPException(429, str(e)) from e
        except YouTubeApiError as e:
            raise HTTPException(502, str(e)) from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        return {
            "query": q,
            "creativeCommonsOnly": cc,
            "candidates": [dto.candidate_to_json(c) for c in found],
            "quota": dto.quota_to_json(quota),
        }

    def reference_view(r: Reference) -> dict[str, Any]:
        throws = deps.store.throws_path(r.video_id)
        links = {
            "self": f"/api/references/{r.id}",
            "footage": f"/api/videos/{r.video_id}",
            "throws": f"/api/videos/{r.video_id}/throws" if throws else None,
        }
        return {**dto.reference_to_json(r), "links": links}

    def reference_store() -> ReferenceStore:
        if deps.references is None:
            raise HTTPException(503, "お手本の保存先がありません")
        return deps.references

    def youtube_deps() -> tuple[YouTubeSearch, QuotaLedger]:
        if deps.youtube is None or deps.quota is None:
            raise HTTPException(503, "YouTube Data API は使えません")
        return deps.youtube, deps.quota

    @app.get("/api/references")
    def references() -> list[dict[str, Any]]:
        return [reference_view(r) for r in list_references(reference_store())]

    @app.post("/api/references", status_code=201)
    def new_reference(body: ReferenceRequest) -> dict[str, Any]:
        api, ledger = youtube_deps()
        try:
            r = register_reference(
                reference_store(),
                deps.store,
                api,
                ledger,
                body.footageId,
                body.kind,
                body.trustedChannel,
                body.playerHeightCm,
                now,
            )
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except YouTubeNotConfigured as e:
            raise HTTPException(503, str(e)) from e
        except QuotaExceeded as e:
            raise HTTPException(429, str(e)) from e
        except YouTubeApiError as e:
            raise HTTPException(502, str(e)) from e
        return reference_view(r)

    @app.patch("/api/references/{reference_id}")
    def patch_reference(reference_id: str, body: ReferencePatch) -> dict[str, Any]:
        manual = Manual(body.manual.pinned, body.manual.excluded, body.manual.stars) if body.manual else None
        try:
            r = update_reference(reference_store(), reference_id, body.kind, body.trustedChannel, manual)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return reference_view(r)

    @app.post("/api/references/{reference_id}/refresh")
    def refresh(reference_id: str) -> dict[str, Any]:
        """YouTube の統計を取り直す（2 ユニット）"""
        api, ledger = youtube_deps()
        try:
            r = refresh_reference(reference_store(), api, ledger, reference_id, now)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        except QuotaExceeded as e:
            raise HTTPException(429, str(e)) from e
        except (YouTubeNotConfigured, YouTubeApiError) as e:
            raise HTTPException(502, str(e)) from e
        return reference_view(r)

    @app.delete("/api/references/{reference_id}", status_code=204)
    def remove_reference(reference_id: str) -> Response:
        """お手本の登録だけを消す。元の映像と解析結果は残す"""
        try:
            delete_reference(reference_store(), reference_id)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return Response(status_code=204)

    def drill_store() -> DrillStore:
        if deps.drills is None:
            raise HTTPException(503, "ドリル動画の置き場所がありません")
        return deps.drills

    def drill_view(d: Drill) -> dict[str, Any]:
        return {**dto.drill_to_json(d), "links": {"self": f"/api/drills/{d.id}"}}

    @app.get("/api/drills")
    def drills() -> list[dict[str, Any]]:
        """改善点に添えるドリル動画（新しい順）"""
        return [drill_view(d) for d in list_drills(drill_store())]

    @app.post("/api/drills", status_code=201)
    def new_drill(body: DrillRequest) -> dict[str, Any]:
        """ドリル動画を登録する。動画は取り込まず、YouTube の動画 ID と開始位置だけを残す"""
        targets = [DrillTarget(t.metric, t.side) for t in body.targets]
        d = create_drill(drill_store(), body.youtubeId, body.title, body.channel, body.startSec, body.label, targets)
        return drill_view(d)

    @app.delete("/api/drills/{drill_id}", status_code=204)
    def remove_drill(drill_id: str) -> Response:
        try:
            delete_drill(drill_store(), drill_id)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return Response(status_code=204)

    def annotation_store() -> AnnotationStore:
        if deps.annotations is None:
            raise HTTPException(503, "正解の置き場所がありません")
        return deps.annotations

    @app.get("/api/evaluation")
    def evaluation() -> dict[str, Any]:
        """精度の評価：正解を付ける映像と、付けた正解から求めた誤差"""
        store = annotation_store()
        return dto.evaluation_to_json(evaluation_targets(deps.store, store), evaluate(deps.store, store))

    @app.put("/api/videos/{video_id}/annotation")
    def put_annotation(video_id: str, body: AnnotationRequest) -> dict[str, Any]:
        """映像に付けた正解を、まるごと置き換える"""
        record_or_404(video_id)
        throws = [ThrowLabel(t.rep, t.plant, t.release) for t in body.throws]
        # 関節の名前は、保存の前に domain の check_annotation で確かめる
        frames = [FrameLabel(f.frame, {cast(KeypointName, j): p for j, p in f.points.items()}) for f in body.frames]
        try:
            a = save_annotation(deps.store, annotation_store(), video_id, throws, frames)
        except NotFoundError as e:
            raise HTTPException(409, str(e)) from e
        return dto.annotation_to_json(a)

    @app.get("/api/practices")
    def practices() -> list[dict[str, Any]]:
        return [practice_view(p) for p in list_practices(deps.practices)]

    @app.post("/api/practices", status_code=201)
    def new_practice(body: PracticeRequest) -> dict[str, Any]:
        try:
            p = create_practice(
                deps.practices, deps.store, body.name, body.date, body.kind, body.camera, body.memo, body.videoIds
            )
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return practice_view(p)

    @app.get("/api/practices/{practice_id}")
    def practice(practice_id: str) -> dict[str, Any]:
        try:
            return practice_view(get_practice(deps.practices, practice_id))
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e

    @app.delete("/api/practices/{practice_id}", status_code=204)
    def remove_practice(practice_id: str) -> Response:
        """まとめを消すだけで、映像と解析結果は残す"""
        try:
            delete_practice(deps.practices, practice_id)
        except NotFoundError as e:
            raise HTTPException(404, str(e)) from e
        return Response(status_code=204)

    @app.get("/api/jobs/{job_id}")
    def job_state(job_id: str) -> dict[str, Any]:
        job = deps.jobs.get(job_id)
        if job is None:
            raise HTTPException(404, "ジョブがありません")
        last = next((e.data for e in reversed(job.events) if e.kind == "progress"), None)
        return {"id": job.id, "state": job.state, "progress": last, "result": job.result, "error": job.error}

    @app.get("/api/jobs/{job_id}/events")
    def job_events(job_id: str) -> StreamingResponse:
        if deps.jobs.get(job_id) is None:
            raise HTTPException(404, "ジョブがありません")

        def stream() -> Iterator[str]:
            for e in deps.jobs.follow(job_id):
                if e is None:
                    yield ": keep-alive\n\n"
                    continue
                yield f"event: {e.kind}\ndata: {json.dumps(e.data, ensure_ascii=False)}\n\n"

        return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})

    return app
