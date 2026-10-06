// 改善点に添えるドリル動画。YouTube の動画 ID があれば、ドリルの説明が始まる位置から YouTube で開く（動画は取り込まない）。

import { IconBrandYoutube, IconExternalLink } from "@tabler/icons-react";
import type { DrillPick } from "../../application/ports";
import { drillUrl } from "../../domain/drill";
import { cx } from "./ui";

export function DrillLink({ drill, className }: { drill: DrillPick; className?: string }) {
  const body = (
    <>
      <IconBrandYoutube size={18} className="shrink-0 text-flag" aria-hidden />
      <span className="min-w-0">
        <span className="block truncate text-text">{drill.label}</span>
        <span className="block truncate text-muted">
          {drill.channel} · {drill.at} から
        </span>
      </span>
      {drill.youtubeId && <IconExternalLink size={14} className="no-print ml-auto shrink-0 text-muted" aria-hidden />}
    </>
  );
  const cls = cx("flex items-center gap-3 rounded-xl border border-line bg-white/[0.03] p-3 text-xs", className);
  return drill.youtubeId && drill.startSec !== undefined ? (
    <a href={drillUrl({ youtubeId: drill.youtubeId, startSec: drill.startSec })} target="_blank" rel="noreferrer" className={cx(cls, "transition-colors hover:border-ice/40")} title="YouTube で、ドリルの説明が始まる位置から開きます">
      {body}
    </a>
  ) : (
    <div className={cls}>{body}</div>
  );
}
