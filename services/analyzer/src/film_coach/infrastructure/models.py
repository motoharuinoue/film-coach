"""骨格推定・人物検出のモデル（ONNX）の取得。

OpenMMLab の公式配布（Apache-2.0）から、利用者が承認したものだけを data/models/ に置く。
ダウンロードは明示的なコマンド（film-coach models download）でだけ行い、解析中に勝手に取りに行かない。
"""

from __future__ import annotations

import shutil
import tempfile
import urllib.request
import zipfile
from collections.abc import Callable
from dataclasses import dataclass
from pathlib import Path

from .paths import data_dir

BASE = "https://download.openmmlab.com/mmpose/v1/projects/rtmposev1/onnx_sdk/"


@dataclass(frozen=True, slots=True)
class ModelSpec:
    key: str
    role: str
    zip_name: str
    bytes: int
    """配布ファイルの大きさ。取得後に一致を確かめる"""
    input_size: tuple[int, int]
    """(幅, 高さ)"""

    @property
    def url(self) -> str:
        return BASE + self.zip_name


# 標準モード（人物検出 YOLOX-m + 骨格推定 RTMPose-m）。合計 約 145 MB
MODELS: dict[str, ModelSpec] = {
    "detector": ModelSpec(
        "detector", "人物検出 YOLOX-m（HumanArt）", "yolox_m_8xb8-300e_humanart-c2c7a14a.zip", 94_223_081, (640, 640)
    ),
    "pose": ModelSpec(
        "pose",
        "骨格推定 RTMPose-m（Body7、COCO-17）",
        "rtmpose-m_simcc-body7_pt-body7_420e-256x192-e48f03d0_20230504.zip",
        50_799_818,
        (192, 256),
    ),
}


def models_dir() -> Path:
    return data_dir() / "models"


def onnx_path(spec: ModelSpec) -> Path:
    return models_dir() / spec.zip_name.removesuffix(".zip") / "end2end.onnx"


class ModelNotFoundError(FileNotFoundError):
    pass


def require(spec: ModelSpec) -> Path:
    path = onnx_path(spec)
    if not path.exists():
        raise ModelNotFoundError(
            f"{spec.role} のモデルがありません：{path}\n先に `uv run film-coach models download` を実行してください"
        )
    return path


def download(spec: ModelSpec, log: Callable[[str], None] = print) -> Path:
    """zip を取得して大きさを確かめ、ONNX を取り出す。すでにあれば何もしない"""
    dest = onnx_path(spec)
    if dest.exists():
        return dest
    log(f"取得します：{spec.role}（{spec.bytes / 1e6:.0f} MB）{spec.url}")
    with tempfile.TemporaryDirectory() as tmp:
        zip_path = Path(tmp) / spec.zip_name
        # 開くのは MODELS に書いた固定の https URL だけ
        with urllib.request.urlopen(spec.url, timeout=60) as res, zip_path.open("wb") as f:
            shutil.copyfileobj(res, f, length=1 << 20)
        size = zip_path.stat().st_size
        if size != spec.bytes:
            raise OSError(f"{spec.zip_name} の大きさが想定と違います（{size} バイト、想定 {spec.bytes}）")
        with zipfile.ZipFile(zip_path) as z:
            member = next((n for n in z.namelist() if n.endswith(".onnx")), None)
            if member is None:
                raise OSError(f"{spec.zip_name} に ONNX が入っていません")
            dest.parent.mkdir(parents=True, exist_ok=True)
            with z.open(member) as src, dest.open("wb") as out:
                shutil.copyfileobj(src, out)
    log(f"置きました：{dest}")
    return dest


class LocalModelStore:
    """ModelStore の実装：data/models/ に置く"""

    def status(self) -> list[tuple[str, float, bool, str]]:
        return [(s.role, s.bytes / 1e6, onnx_path(s).exists(), str(onnx_path(s))) for s in MODELS.values()]

    def download(self, log: Callable[[str], None]) -> None:
        for spec in MODELS.values():
            download(spec, log)
