export type CameraAngle = "side" | "behind" | "front" | "endzone" | "sideline";

export const CAMERA_LABEL: Record<CameraAngle, string> = {
  side: "横から",
  behind: "後方から",
  front: "正面から",
  endzone: "エンドゾーン",
  sideline: "サイドライン",
};

export const CAMERA_ANGLES = Object.keys(CAMERA_LABEL) as CameraAngle[];
