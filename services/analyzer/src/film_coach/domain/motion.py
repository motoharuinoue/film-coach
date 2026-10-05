"""カメラの動き（手持ちで選手を追いかける、ズームする）を打ち消すための、画像の座標の変換。

フレームごとに「このフレームの座標 → 1 つ前のフレームの座標」の変換を見積もり（ポートの実装が背景から求める）、
それを積み重ねて「このフレームの座標 → 場面の最初のフレームの座標」にする。場面の切り替わりでは積み重ねを始め直す。
"""

from __future__ import annotations

from collections.abc import Sequence
from dataclasses import dataclass


@dataclass(frozen=True, slots=True)
class Affine:
    """x' = a·x + b·y + tx、y' = c·x + d·y + ty"""

    a: float = 1.0
    b: float = 0.0
    tx: float = 0.0
    c: float = 0.0
    d: float = 1.0
    ty: float = 0.0

    def apply(self, x: float, y: float) -> tuple[float, float]:
        return self.a * x + self.b * y + self.tx, self.c * x + self.d * y + self.ty

    def after(self, inner: Affine) -> Affine:
        """inner を当ててから self を当てる変換（self ∘ inner）"""
        return Affine(
            self.a * inner.a + self.b * inner.c,
            self.a * inner.b + self.b * inner.d,
            self.a * inner.tx + self.b * inner.ty + self.tx,
            self.c * inner.a + self.d * inner.c,
            self.c * inner.b + self.d * inner.d,
            self.c * inner.tx + self.d * inner.ty + self.ty,
        )

    def to_list(self) -> list[float]:
        return [self.a, self.b, self.tx, self.c, self.d, self.ty]


IDENTITY = Affine()


def accumulate(steps: Sequence[Affine | None], cuts: frozenset[int] = frozenset()) -> list[Affine]:
    """1 つ前のフレームへの変換の列を、場面の最初のフレームへの変換の列にする。

    steps[i] はフレーム i → i−1 の変換（steps[0] と、見積もれなかったフレームの None は動きなしとみなす）。
    cuts のフレームでは、そこを新しい場面の最初として始め直す。
    """
    out: list[Affine] = []
    current = IDENTITY
    for i, step in enumerate(steps):
        if i == 0 or i in cuts:
            current = IDENTITY
        elif step is not None:
            current = current.after(step)
        out.append(current)
    return out
