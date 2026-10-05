from typing import Literal, get_args

CameraAngle = Literal["side", "behind", "front", "endzone", "sideline"]

CAMERA_ANGLES: tuple[CameraAngle, ...] = get_args(CameraAngle)

CAMERA_LABEL: dict[CameraAngle, str] = {
    "side": "横から",
    "behind": "後方から",
    "front": "正面から",
    "endzone": "エンドゾーン",
    "sideline": "サイドライン",
}
