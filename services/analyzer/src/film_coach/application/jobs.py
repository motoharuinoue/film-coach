"""時間のかかる解析を 1 本ずつ裏で動かし、進み具合を記録する。

ONNX Runtime は CPU を使い切るので、同時に動かすのは 1 本だけにする。
進み具合は、HTTP の SSE などで順に読み出せるよう、出来事の列として持つ。
"""

from __future__ import annotations

import itertools
import threading
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from typing import Any, Literal

JobState = Literal["queued", "running", "done", "failed"]


@dataclass(slots=True)
class JobEvent:
    kind: Literal["state", "progress", "done", "failed"]
    data: dict[str, Any]


@dataclass(slots=True)
class Job:
    id: str
    kind: str
    target_id: str
    state: JobState = "queued"
    events: list[JobEvent] = field(default_factory=list)
    result: dict[str, Any] | None = None
    error: str | None = None


Report = Callable[[str, int, int], None]
Work = Callable[[Report], dict[str, Any]]
"""進み具合を知らせる関数を受け取り、結果の要約を返す"""


class JobRunner:
    def __init__(self, workers: int = 1) -> None:
        self._pool = ThreadPoolExecutor(max_workers=workers, thread_name_prefix="film-coach-job")
        self._jobs: dict[str, Job] = {}
        self._cond = threading.Condition()
        self._ids = itertools.count(1)

    def _emit(self, job: Job, event: JobEvent) -> None:
        with self._cond:
            job.events.append(event)
            self._cond.notify_all()

    def submit(self, kind: str, target_id: str, work: Work) -> Job:
        job = Job(f"job-{next(self._ids)}", kind, target_id)
        with self._cond:
            self._jobs[job.id] = job
        self._emit(job, JobEvent("state", {"state": "queued"}))

        def run() -> None:
            job.state = "running"
            self._emit(job, JobEvent("state", {"state": "running"}))
            last: dict[str, int] = {}

            def report(stage: str, done: int, total: int) -> None:
                # 1% 刻みで知らせる（フレームごとに送ると多すぎる）
                pct = done * 100 // max(1, total)
                if pct != last.get(stage) or done == total:
                    last[stage] = pct
                    self._emit(job, JobEvent("progress", {"stage": stage, "done": done, "total": total}))

            try:
                job.result = work(report)
                job.state = "done"
                self._emit(job, JobEvent("done", job.result))
            except Exception as e:  # 失敗も出来事として残し、画面に伝える
                job.state = "failed"
                job.error = str(e)
                self._emit(job, JobEvent("failed", {"message": str(e)}))

        self._pool.submit(run)
        return job

    def get(self, job_id: str) -> Job | None:
        return self._jobs.get(job_id)

    def latest_for(self, target_id: str) -> Job | None:
        jobs = [j for j in self._jobs.values() if j.target_id == target_id]
        return jobs[-1] if jobs else None

    def follow(self, job_id: str, timeout: float = 15.0) -> Iterator[JobEvent | None]:
        """出来事を最初から順に返す。終わったら止まる。timeout の間に何もなければ None を返す（接続の維持用）"""
        job = self._jobs[job_id]
        i = 0
        while True:
            with self._cond:
                if i >= len(job.events):
                    self._cond.wait(timeout)
                new = job.events[i:]
            if not new:
                yield None
                continue
            for e in new:
                yield e
                if e.kind in ("done", "failed"):
                    return
            i += len(new)

    def shutdown(self) -> None:
        self._pool.shutdown(wait=False, cancel_futures=True)
