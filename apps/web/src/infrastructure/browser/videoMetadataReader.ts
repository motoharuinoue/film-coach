// VideoMetadataReader のブラウザ実装。<video> にメタデータだけを読ませる（ファイルはどこにも送らない）。
// fps はブラウザから確実に取れないので、解析サービス（M1）で確認する。

import type { VideoMeta, VideoMetadataReader } from "../../application/ports";

export class BrowserVideoMetadataReader implements VideoMetadataReader {
  read(file: Blob & { name: string }): Promise<VideoMeta> {
    const base = { name: file.name, sizeBytes: file.size };
    return new Promise((resolve) => {
      const url = URL.createObjectURL(file);
      const v = document.createElement("video");
      v.preload = "metadata";
      const done = (meta: VideoMeta) => {
        URL.revokeObjectURL(url);
        resolve(meta);
      };
      v.onloadedmetadata = () => done({ ...base, durationSec: v.duration, width: v.videoWidth, height: v.videoHeight });
      // このブラウザで読めない形式（HEVC など）でも、解析サービスでは読める
      v.onerror = () => done(base);
      v.src = url;
    });
  }
}
