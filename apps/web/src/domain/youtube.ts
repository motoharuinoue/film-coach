// YouTube URL の解析と、取り込む区間の検証。

const ID = /^[A-Za-z0-9_-]{11}$/;

/** watch / youtu.be / shorts / embed / live の URL から動画 ID を取り出す。取り出せなければ undefined */
export function parseYouTubeId(input: string): string | undefined {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return undefined;
  }
  const host = url.hostname.replace(/^(www\.|m\.|music\.)/, "");
  let id: string | null | undefined;
  if (host === "youtu.be") id = url.pathname.slice(1).split("/")[0];
  else if (host === "youtube.com" || host === "youtube-nocookie.com") {
    if (url.pathname === "/watch") id = url.searchParams.get("v");
    else {
      const m = url.pathname.match(/^\/(shorts|embed|live)\/([^/?#]+)/);
      id = m?.[2];
    }
  }
  return id && ID.test(id) ? id : undefined;
}

/** "1:05" や "65" を秒に。形式が違えば undefined */
export function parseTime(text: string): number | undefined {
  const t = text.trim();
  if (/^\d+$/.test(t)) return Number(t);
  const m = t.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})$/);
  if (!m) return undefined;
  const [, h, mm, ss] = m;
  if (Number(ss) >= 60 || (h !== undefined && Number(mm) >= 60)) return undefined;
  return Number(h ?? 0) * 3600 + Number(mm) * 60 + Number(ss);
}

export function formatTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** 区間の上限。規約への配慮（ADR-0005）と解析時間のため、必要な部分だけを取り込む */
export const MAX_SEGMENT_SEC = 60;

export type SegmentCheck = { ok: true; start: number; end: number } | { ok: false; error: string };

export function checkSegment(startText: string, endText: string): SegmentCheck {
  const start = parseTime(startText);
  const end = parseTime(endText);
  if (start === undefined || end === undefined) return { ok: false, error: "時刻は 1:05 のように入力してください" };
  if (end <= start) return { ok: false, error: "終了は開始より後にしてください" };
  if (end - start > MAX_SEGMENT_SEC) return { ok: false, error: `区間は ${MAX_SEGMENT_SEC} 秒以内にしてください` };
  return { ok: true, start, end };
}

// ---- お手本の候補（YouTube Data API。形は packages/schema の youtube-search.v1） ----

export type YouTubeCandidate = {
  videoId: string;
  title: string;
  channel: string;
  channelId: string;
  publishedAt: string;
  durationSec: number;
  views: number;
  /** 非公開なら null */
  likes: number | null;
  comments: number | null;
  subscribers: number | null;
  license: "youtube" | "creativeCommon";
  definition: "hd" | "sd";
  thumbnail: string;
  url: string;
};

/** その日（米国太平洋時間）の無料枠（1 日 10,000 ユニット） */
export type QuotaStatus = { day: string; used: number; limit: number; remaining: number; resetsAt: string };

export type YouTubeSearchResult = { query: string; creativeCommonsOnly: boolean; candidates: YouTubeCandidate[]; quota: QuotaStatus };

/** 1 回の検索で使うユニット（検索 100 + 動画の情報 1 + チャンネルの情報 1） */
export const SEARCH_COST = 102;

/** 取り込む区間の初期値：最初の 30 秒（動画が短ければその長さ） */
export function defaultSegment(durationSec: number) {
  return { start: 0, end: Math.max(1, Math.min(30, MAX_SEGMENT_SEC, durationSec || 30)) };
}
