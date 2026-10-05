import { IconBrandYoutube, IconCheck, IconCircleDashed, IconFileUpload, IconLoader2, IconMovie, IconX } from "@tabler/icons-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { AnalysisInput, AnalysisProgress, AnalysisResult, VideoMeta } from "../../application/ports";
import { CAMERA_ANGLES, CAMERA_LABEL, type CameraAngle } from "../../domain/camera";
import type { SessionKind } from "../../domain/entities";
import type { Footage } from "../../domain/footage";
import { isValidFor, METRICS } from "../../domain/metrics";
import { checkSegment, formatTime, MAX_SEGMENT_SEC, parseYouTubeId } from "../../domain/youtube";
import { FieldScene, Skeleton } from "../components/scene";
import { Badge, Button, Card, DemoNote, PageHeader, SectionTitle, Segmented, StatusIcon, cx } from "../components/ui";
import { PageGuide } from "../guide/PageGuide";
import { useServices } from "../services";
import { useAnalyzer } from "../state/analyzer";
import { formatDate } from "../state/session";

type Source = "file" | "youtube";

export function NewSession() {
  const { analysis, videoMeta, coach } = useServices();
  const analyzer = useAnalyzer();
  const live = analyzer.status === "online" && analyzer.lib;
  const navigate = useNavigate();
  const [rawFile, setRawFile] = useState<File>();
  const [importing, setImporting] = useState<{ label: string; ratio?: number }>();
  const [importError, setImportError] = useState<string>();
  const [source, setSource] = useState<Source>("file");
  const [kind, setKind] = useState<SessionKind>("drill");
  const [camera, setCamera] = useState<CameraAngle>("side");
  const [file, setFile] = useState<VideoMeta>();
  const [fileError, setFileError] = useState<string>();
  const [dragging, setDragging] = useState(false);
  const [url, setUrl] = useState("");
  const [videoId, setVideoId] = useState<string>();
  const [urlError, setUrlError] = useState<string>();
  const [start, setStart] = useState("0:00");
  const [end, setEnd] = useState("0:08");
  const [progress, setProgress] = useState<AnalysisProgress>();
  const [result, setResult] = useState<AnalysisResult>();
  const inputRef = useRef<HTMLInputElement>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const stages = analysis.stages();
  const segment = checkSegment(start, end);
  const ready = source === "file" ? !!file : !!videoId && segment.ok;
  const valid = METRICS.filter((m) => isValidFor(m, camera));

  const readFile = (f: File) => {
    setFileError(undefined);
    if (!f.type.startsWith("video/")) {
      setFileError("動画ファイル（mp4 / mov）を選んでください");
      return;
    }
    setRawFile(f);
    void videoMeta.read(f).then(setFile);
  };

  const loadUrl = () => {
    const id = parseYouTubeId(url);
    setVideoId(id);
    setUrlError(id ? undefined : "YouTube の動画 URL を入力してください（例：https://www.youtube.com/watch?v=…）");
  };

  /** 解析サービスにつながっていれば、実際に取り込んで本人を選ぶ画面へ進む */
  const importLive = async () => {
    const lib = analyzer.lib!;
    setImportError(undefined);
    try {
      let footage: Footage;
      if (source === "file") {
        setImporting({ label: "アップロードしています", ratio: 0 });
        footage = await lib.upload(rawFile!, (ratio) => setImporting({ label: "アップロードしています", ratio }));
      } else {
        setImporting({ label: "YouTube から区間を取得しています" });
        footage = await lib.importYouTube(url, segment.ok ? segment.start : 0, segment.ok ? segment.end : 0);
      }
      navigate(`/footage/${footage.id}/pick`);
    } catch (e) {
      setImportError((e as Error).message);
      setImporting(undefined);
    }
  };

  const startAnalysis = () => {
    if (live) {
      void importLive();
      return;
    }
    const input: AnalysisInput = {
      source: source === "file" ? { kind: "file", name: file!.name } : { kind: "youtube", videoId: videoId!, startSec: segment.ok ? segment.start : 0, endSec: segment.ok ? segment.end : 0 },
      sessionKind: kind,
      camera,
    };
    abort.current = new AbortController();
    setProgress({ completed: 0 });
    analysis
      .run(input, setProgress, abort.current.signal)
      .then(setResult)
      .catch((e: unknown) => {
        if ((e as Error).name !== "AbortError") throw e;
      });
  };

  const checks: { ok: boolean | undefined; label: string }[] =
    source === "file"
      ? [
          { ok: file?.height ? file.height >= 720 : undefined, label: file?.height ? `解像度 ${file.width}×${file.height}（720p 以上）` : "解像度 720p 以上" },
          { ok: file?.durationSec ? file.durationSec <= 180 : undefined, label: file?.durationSec ? `長さ ${formatTime(file.durationSec)}（3 分以内）` : "長さ 3 分以内" },
          { ok: undefined, label: "fps（60fps 以上を推奨）は解析時に確認" },
        ]
      : [
          { ok: videoId ? true : undefined, label: "URL から動画 ID を取得" },
          { ok: videoId ? segment.ok : undefined, label: segment.ok ? `区間 ${formatTime(segment.start)}〜${formatTime(segment.end)}（${segment.end - segment.start} 秒）` : `区間は ${MAX_SEGMENT_SEC} 秒以内` },
          { ok: undefined, label: "解像度と fps は取得時に確認" },
        ];

  return (
    <div>
      <PageHeader title="① 取り込む" sub="動画を取り込み、レップごとに骨格・フェーズ・指標を出します" />
      <PageGuide id="new" className="mb-5" />

      <AnimatePresence mode="wait">
        {progress === undefined ? (
          <motion.div key="setup" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -8 }} className="grid gap-5 lg:grid-cols-[1.4fr_1fr]">
            <div className="space-y-5">
              <Card className="p-5">
                <div className="mb-4 flex items-center justify-between">
                  <SectionTitle className="mb-0">1. 動画</SectionTitle>
                  <Segmented
                    label="取り込み元"
                    value={source}
                    onChange={setSource}
                    options={[
                      { value: "file", label: "ファイル" },
                      { value: "youtube", label: "YouTube URL" },
                    ]}
                  />
                </div>

                {source === "file" ? (
                  <div>
                    <button
                      type="button"
                      onClick={() => inputRef.current?.click()}
                      onDragOver={(e) => {
                        e.preventDefault();
                        setDragging(true);
                      }}
                      onDragLeave={() => setDragging(false)}
                      onDrop={(e) => {
                        e.preventDefault();
                        setDragging(false);
                        const f = e.dataTransfer.files[0];
                        if (f) readFile(f);
                      }}
                      className={cx(
                        "flex w-full flex-col items-center justify-center rounded-xl border-2 border-dashed px-6 py-12 text-center transition-colors",
                        dragging ? "border-turf bg-turf/5" : "border-line-strong hover:border-turf/50 hover:bg-white/[0.02]",
                      )}
                    >
                      <IconFileUpload size={36} stroke={1.5} className="text-turf" aria-hidden />
                      <div className="mt-3 text-sm">動画をドラッグ&ドロップ、またはクリックして選択</div>
                      <div className="mt-1 text-xs text-muted">mp4 / mov（iPhone の HEVC も可）· 30〜240fps</div>
                    </button>
                    <input ref={inputRef} type="file" accept="video/*" className="hidden" onChange={(e) => e.target.files?.[0] && readFile(e.target.files[0])} />
                    {fileError && <p className="mt-2 text-xs text-flag">{fileError}</p>}
                    {file && (
                      <div className="mt-3 flex items-center gap-3 rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-sm">
                        <IconMovie size={18} className="text-turf" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <span className="font-mono text-xs text-muted">{(file.sizeBytes / 1024 / 1024).toFixed(1)} MB</span>
                        <button type="button" onClick={() => setFile(undefined)} className="text-muted hover:text-text" aria-label="選択を取り消す">
                          <IconX size={16} />
                        </button>
                      </div>
                    )}
                    {file && !file.height && <p className="mt-2 text-xs text-muted">このブラウザでは動画の情報を読めませんでした。解析サービス（M1）では読めます。</p>}
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="yt-url" className="mb-1.5 block text-xs text-muted">
                        動画の URL
                      </label>
                      <div className="flex gap-2">
                        <input
                          id="yt-url"
                          value={url}
                          onChange={(e) => {
                            setUrl(e.target.value);
                            setUrlError(undefined);
                          }}
                          onKeyDown={(e) => e.key === "Enter" && loadUrl()}
                          placeholder="https://www.youtube.com/watch?v=…"
                          className="flex-1 rounded-lg border border-line bg-ink px-3 py-2 text-sm placeholder:text-faint focus:border-ice/50 focus:outline-none"
                        />
                        <Button onClick={loadUrl}>読み込む</Button>
                      </div>
                      {urlError && <p className="mt-1.5 text-xs text-flag">{urlError}</p>}
                    </div>
                    {videoId && (
                      <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="space-y-3">
                        <div className="aspect-video overflow-hidden rounded-xl border border-line bg-black">
                          <iframe
                            title="YouTube の埋め込みプレイヤー"
                            src={`https://www.youtube-nocookie.com/embed/${videoId}?rel=0${segment.ok ? `&start=${segment.start}&end=${segment.end}` : ""}`}
                            className="h-full w-full"
                            allow="encrypted-media; picture-in-picture"
                            allowFullScreen
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          {[
                            { id: "seg-start", label: "開始", v: start, set: setStart },
                            { id: "seg-end", label: "終了", v: end, set: setEnd },
                          ].map((f) => (
                            <div key={f.id}>
                              <label htmlFor={f.id} className="mb-1 block text-xs text-muted">
                                {f.label}
                              </label>
                              <input id={f.id} value={f.v} onChange={(e) => f.set(e.target.value)} className="w-full rounded-lg border border-line bg-ink px-3 py-2 font-mono text-sm focus:border-ice/50 focus:outline-none" />
                            </div>
                          ))}
                        </div>
                        {!segment.ok && <p className="text-xs text-flag">{segment.error}</p>}
                        <p className="text-xs leading-relaxed text-muted">指定した区間だけを取得し、骨格と指標を出したら元の動画は削除します。残すのは派生データと出典だけです（ADR-0005）。</p>
                      </motion.div>
                    )}
                  </div>
                )}
              </Card>

              <Card className="space-y-4 p-5">
                <SectionTitle className="mb-0">2. 撮影条件</SectionTitle>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-20 text-xs text-muted">種別</span>
                  <Segmented
                    label="種別"
                    value={kind}
                    onChange={setKind}
                    options={[
                      { value: "drill", label: "ドリル" },
                      { value: "game", label: "試合" },
                    ]}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <span className="w-20 text-xs text-muted">カメラ角度</span>
                  <Segmented label="カメラ角度" value={camera} onChange={setCamera} options={CAMERA_ANGLES.map((c) => ({ value: c, label: CAMERA_LABEL[c] }))} />
                </div>
              </Card>
            </div>

            <div className="space-y-5">
              <Card className="p-5">
                <SectionTitle>品質チェック</SectionTitle>
                <ul className="space-y-2 text-sm">
                  {checks.map((c) => (
                    <li key={c.label} className="flex items-center gap-2">
                      {c.ok === undefined ? <IconCircleDashed size={16} className="text-faint" aria-hidden /> : c.ok ? <IconCheck size={16} className="text-turf" aria-label="OK" /> : <IconX size={16} className="text-flag" aria-label="NG" />}
                      <span className={c.ok === false ? "text-flag" : "text-text/85"}>{c.label}</span>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-5">
                <SectionTitle
                  right={
                    <Badge tone={valid.length >= 7 ? "turf" : "caution"}>
                      {valid.length} / {METRICS.length}
                    </Badge>
                  }
                >
                  {CAMERA_LABEL[camera]}の映像で測れる指標
                </SectionTitle>
                <ul className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
                  {METRICS.map((m) => {
                    const ok = isValidFor(m, camera);
                    return (
                      <li key={m.key} className={cx("flex items-center gap-1.5", !ok && "text-faint line-through decoration-faint/50")}>
                        <StatusIcon status={ok ? "good" : "na"} size={13} />
                        {m.short}
                      </li>
                    );
                  })}
                </ul>
                {camera !== "side" && <p className="mt-3 text-xs text-muted">QB の投球フォームは、投げる腕の側の真横から撮ると最も多くの指標を測れます。</p>}
              </Card>

              <Button variant="primary" className="w-full py-2.5" disabled={!ready || !!importing || (live && source === "file" && !rawFile)} onClick={startAnalysis}>
                {importing ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : source === "youtube" && <IconBrandYoutube size={16} aria-hidden />}
                {importing ? `${importing.label}${importing.ratio !== undefined ? `（${Math.round(importing.ratio * 100)}%）` : "…"}` : live ? "取り込んで本人を選ぶ" : "解析を始める"}
              </Button>
              {importError && <p className="text-xs text-flag">{importError}</p>}
              {live ? (
                <div className="flex items-start gap-2 rounded-lg border border-turf/25 bg-turf/[0.06] px-3 py-2 text-xs leading-relaxed text-turf/90">
                  <IconCheck size={14} className="mt-0.5 shrink-0" aria-hidden />
                  <div>手元の解析サービスにつながっています。動画は解析サービス（この PC の中）にだけ送り、外には出しません。取り込んだら、映像の中の本人を選びます。</div>
                </div>
              ) : (
                <DemoNote>デモでは解析をシミュレーションし、結果は {formatDate(coach.focus().session.date)} のサンプルを表示します。選んだファイルの情報はブラウザの中だけで読み、どこにも送りません。手元で解析サービスを動かすと、実際に解析できます（「自分の映像」を参照）。</DemoNote>
              )}
            </div>
          </motion.div>
        ) : (
          <motion.div key="running" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="grid gap-5 lg:grid-cols-[1fr_1.2fr]">
            <Card className="p-5">
              <SectionTitle
                right={
                  <span className="font-mono text-xs text-muted">
                    {progress.completed} / {stages.length}
                  </span>
                }
              >
                解析パイプライン
              </SectionTitle>
              <ol className="space-y-1">
                {stages.map((s, i) => {
                  const state = i < progress.completed ? "done" : i === progress.completed ? "active" : "todo";
                  return (
                    <li key={s} className={cx("flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-colors", state === "active" && "bg-turf/[0.07]")}>
                      <span className={cx("flex h-6 w-6 items-center justify-center rounded-full border text-[11px]", state === "done" ? "border-turf/40 bg-turf/15 text-turf" : state === "active" ? "border-turf text-turf" : "border-line text-faint")}>
                        {state === "done" ? <IconCheck size={13} /> : state === "active" ? <IconLoader2 size={13} className="animate-spin" /> : i + 1}
                      </span>
                      <span className={state === "todo" ? "text-faint" : "text-text"}>{s}</span>
                    </li>
                  );
                })}
              </ol>
              <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-white/5">
                <motion.div className="h-full rounded-full bg-turf glow-turf" animate={{ width: `${(progress.completed / stages.length) * 100}%` }} transition={{ duration: 0.4 }} />
              </div>
            </Card>
            <Card className="overflow-hidden">
              <FieldScene className="block w-full">{progress.preview && <Skeleton frame={progress.preview} />}</FieldScene>
              <div className="flex items-center justify-between gap-3 border-t border-line p-4">
                <p className="text-sm text-muted">{result ? `解析が終わりました。${result.repCount} レップを検出しました。` : progress.preview ? "骨格を推定しています…" : "人物を探しています…"}</p>
                {result && (
                  <Link to={`/sessions/${result.sessionId}/reps`}>
                    <Button variant="primary">レップを選ぶ</Button>
                  </Link>
                )}
              </div>
            </Card>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
