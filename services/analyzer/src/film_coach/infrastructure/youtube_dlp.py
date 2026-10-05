"""YouTubeFetcher の yt-dlp 実装。指定した区間だけを取得する（ADR-0005）。

yt-dlp は別のプロセスとして呼ぶ（`python -m yt_dlp`）。URL は動画 ID から組み立てるので、
利用者の入力をそのままコマンドに渡すことはない。
"""

from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from ..domain.library import YouTubeSource
from ..domain.youtube import watch_url

FORMAT = "bv*[height<=1080][ext=mp4]+ba[ext=m4a]/b[height<=1080][ext=mp4]/b[height<=1080]"


class FetchError(RuntimeError):
    pass


def _run(args: list[str], timeout: int) -> str:
    cmd = [sys.executable, "-m", "yt_dlp", "--no-playlist", "--no-warnings", *args]
    try:
        out = subprocess.run(cmd, check=True, capture_output=True, text=True, timeout=timeout)
    except subprocess.CalledProcessError as e:
        tail = (e.stderr or "").strip().splitlines()[-1:] or ["（詳細なし）"]
        raise FetchError(f"YouTube から取得できませんでした：{tail[0]}") from e
    except subprocess.TimeoutExpired as e:
        raise FetchError("YouTube からの取得が時間内に終わりませんでした") from e
    return out.stdout


class YtDlpFetcher:
    def metadata(self, video_id: str) -> YouTubeSource:
        info = json.loads(_run(["--dump-single-json", "--skip-download", watch_url(video_id)], timeout=60))
        return YouTubeSource(
            video_id=video_id,
            start=0,
            end=0,
            title=str(info.get("title") or ""),
            channel=str(info.get("channel") or info.get("uploader") or ""),
            license=str(info.get("license") or "youtube"),
        )

    def fetch_segment(self, video_id: str, start: int, end: int, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        args = ["-f", FORMAT, "--merge-output-format", "mp4", "--download-sections", f"*{start}-{end}"]
        _run([*args, "--force-keyframes-at-cuts", "-o", str(dest), watch_url(video_id)], timeout=300)
        if not dest.exists():
            raise FetchError("取得した動画が見つかりません")
        return dest
