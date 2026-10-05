"""HTTP の入口（FastAPI）。依存は bootstrap.py から受け取る。

手元の画面（http://localhost:5173）からだけ使う前提で、127.0.0.1 で待ち受ける。
動画は利用者の手元から外に出さない。
"""

from __future__ import annotations

import json
from collections.abc import Callable, Iterator
from dataclasses import dataclass
from pathlib import Path
from typing import Annotated, Any

from fastapi import FastAPI, File, HTTPException, Query, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse, Response, StreamingResponse
from pydantic import BaseModel, Field

from ..application import dto
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
from ..domain.camera import CameraAngle
from ..domain.library import VideoInfo, VideoRecord
from ..domain.practice import MAX_MEMO, MAX_NAME, MAX_VIDEOS, Practice, PracticeError, PracticeKind
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
    motion: Callable[[], CameraMotionEstimator] | None = None
    """カメラの動きを見積もる（追跡ごとに新しく作る）"""


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


class ThrowsRequest(BaseModel):
    heightCm: float = Field(ge=120, le=230, description="選手の身長（cm）")
    camera: CameraAngle = "side"


class TrackRequest(BaseModel):
    t: float = Field(ge=0, description="対象選手を指す時刻（秒）")
    x: float = Field(ge=0, description="元の動画のピクセル座標")
    y: float = Field(ge=0)
    label: str = Field(default="", max_length=20)


def create_app(deps: HttpDeps) -> FastAPI:
    app = FastAPI(title="Film Coach 解析サービス", version="0.1.0")
    app.add_middleware(
        CORSMiddleware,
        allow_origins=deps.allowed_origins,
        allow_methods=["GET", "POST", "DELETE"],
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
    def frame(video_id: str, t: float = Query(0.0, ge=0)) -> Response:
        record_or_404(video_id)
        try:
            return Response(frame_jpeg(deps.store, deps.grabber, video_id, t), media_type="image/jpeg")
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
        return FileResponse(path, media_type="video/mp4")

    @app.get("/api/videos/{video_id}/track")
    def track(video_id: str) -> FileResponse:
        record_or_404(video_id)
        path = deps.store.track_path(video_id)
        if path is None:
            raise HTTPException(404, "追跡はまだ終わっていません")
        return FileResponse(path, media_type="application/json")

    @app.post("/api/videos/{video_id}/throws")
    def analyze_throws(video_id: str, body: ThrowsRequest) -> FileResponse:
        """追跡した骨格から投球を見つけて、1 本ずつ指標を出す。骨格だけを使うので、すぐに終わる"""
        record_or_404(video_id)
        try:
            analyze_footage_throws(deps.store, video_id, body.heightCm / 100, body.camera)
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
        return FileResponse(path, media_type="application/json")

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
