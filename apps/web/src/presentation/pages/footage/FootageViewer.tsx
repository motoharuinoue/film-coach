import { IconBrandYoutube, IconDownload, IconFocusCentered, IconTarget } from "@tabler/icons-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router";
import { coverage, type Footage, type TargetTrack } from "../../../domain/footage";
import type { CameraAngle } from "../../../domain/camera";
import { PHASE_LABEL } from "../../../domain/phases";
import { DEFAULT_PLAYER_HEIGHT_CM } from "../../../domain/reference";
import { releaseFrame, throwAt, type ThrowAnalysis, type ThrowRep } from "../../../domain/throws";
import { VideoFootagePlayer, YouTubeFootagePlayer, type Layers, type SeekRequest, type ThrowMark } from "../../components/footage";
import { Badge, Button, Card, PageHeader, SectionTitle, Toggle } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useServices } from "../../services";
import { useAnalyzer } from "../../state/analyzer";
import { useReferenceZones } from "../../state/library";
import { AnalyzerGate } from "./AnalyzerGate";
import { RegisterReference } from "./RegisterReference";
import { ThrowPanel } from "./ThrowPanel";

function Viewer() {
  const { id = "" } = useParams();
  const { lib } = useAnalyzer();
  const [footage, setFootage] = useState<Footage>();
  const [track, setTrack] = useState<TargetTrack>();
  const [error, setError] = useState<string>();
  const [layers, setLayers] = useState<Layers>({ box: true, skeleton: true, focus: false });
  const { profile } = useServices();
  // お手本の映像そのものは判定しない（自分の映像だけ、お手本の分布と比べる）
  const refZones = useReferenceZones();
  const [throws, setThrows] = useState<ThrowAnalysis>();
  const [throwsBusy, setThrowsBusy] = useState(false);
  const [throwsError, setThrowsError] = useState<string>();
  const [selected, setSelected] = useState(1);
  const [t, setT] = useState(0);
  const [seekTo, setSeekTo] = useState<SeekRequest>();
  // 練習の画面などから「?t=秒」で開くと、その時刻で止める
  const [params] = useSearchParams();
  const startAt = Number(params.get("t"));

  useEffect(() => {
    if (!lib) return;
    lib
      .get(id)
      .then(async (f) => {
        setFootage(f);
        if (f.trackStatus === "done") setTrack(await lib.track(f));
        if (f.links.throws) {
          const a = await lib.throws(f);
          setThrows(a);
          const rep = a.reps.find((r) => Math.abs(releaseFrame(r) / f.info.fps - startAt) < 0.05);
          if (rep) setSelected(rep.index);
        }
        if (startAt > 0) setSeekTo({ t: startAt, key: Date.now() });
      })
      .catch((e: Error) => setError(e.message));
  }, [lib, id, startAt]);

  const fps = footage?.info.fps ?? 30;
  const marks = useMemo<ThrowMark[]>(() => (throws?.reps ?? []).map((r) => ({ index: r.index, start: r.start, end: r.end, release: releaseFrame(r) })), [throws]);

  if (error) return <p className="text-sm text-flag">{error}</p>;
  if (!footage || !lib) return <p className="text-sm text-muted">読み込んでいます…</p>;
  if (footage.trackStatus !== "done") {
    return (
      <Card className="flex flex-wrap items-center justify-between gap-4 p-6">
        <p className="text-sm text-muted">{footage.trackStatus === "running" ? "追跡しています。終わるとここで見られます。" : "まだ本人を選んでいません。"}</p>
        <Link to={`/footage/${footage.id}/pick`}>
          <Button variant="primary">
            <IconTarget size={16} aria-hidden /> 本人を選ぶ
          </Button>
        </Link>
      </Card>
    );
  }
  if (!track) return <p className="text-sm text-muted">追跡結果を読み込んでいます…</p>;

  const cov = coverage(track);
  const label = footage.label || undefined;
  const yt = footage.youtube;
  const frame = Math.round(t * fps);
  const now = throws && throwAt(throws, frame);
  const seekFrame = (f: number) => setSeekTo({ t: f / fps, key: Date.now() });
  const pick = (r: ThrowRep) => {
    setSelected(r.index);
    seekFrame(releaseFrame(r));
  };
  const analyze = async (cm: number, camera: CameraAngle, slowmo: number) => {
    setThrowsBusy(true);
    setThrowsError(undefined);
    try {
      // YouTube のお手本の映像では、お手本の選手の身長なので、自分の身長としては保存しない
      if (footage.source === "upload") profile.saveHeightCm(cm);
      const a = await lib.analyzeThrows(footage.id, { heightCm: cm, camera, slowmo });
      setThrows(a);
      setSelected(a.reps[0]?.index ?? 1);
      if (a.reps[0]) seekFrame(releaseFrame(a.reps[0]));
    } catch (e) {
      setThrowsError((e as Error).message);
    } finally {
      setThrowsBusy(false);
    }
  };
  const badge = now && (
    <span className="rounded-md bg-black/70 px-2 py-1 font-display text-sm text-text backdrop-blur">
      #{now.rep.index} <span className="text-turf">{PHASE_LABEL[now.phase]}</span>
    </span>
  );
  const extras = { onTime: setT, seekTo, throws: marks, badge };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <Card className="space-y-3 p-3">
          {footage.links.media ? (
            <VideoFootagePlayer src={lib.url(footage.links.media)} track={track} label={label} layers={layers} {...extras} />
          ) : yt ? (
            <YouTubeFootagePlayer videoId={yt.videoId} start={yt.start} end={yt.end} track={track} label={label} layers={layers} {...extras} />
          ) : (
            <p className="p-6 text-sm text-muted">再生できる映像がありません。</p>
          )}
        </Card>
        <div className="flex flex-wrap items-center gap-2">
          <Toggle on={layers.box} onChange={(v) => setLayers((l) => ({ ...l, box: v }))} tone="pylon">
            枠
          </Toggle>
          <Toggle on={layers.skeleton} onChange={(v) => setLayers((l) => ({ ...l, skeleton: v }))}>
            骨格
          </Toggle>
          <Toggle on={layers.focus} onChange={(v) => setLayers((l) => ({ ...l, focus: v }))} tone="ice">
            <IconFocusCentered size={13} aria-hidden /> フォーカス表示
          </Toggle>
          <span className="ml-auto flex gap-3 text-[11px] text-faint">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-turf/60" /> 追えた
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-caution/60" /> 補間
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-sm bg-white/10" /> 見失った
            </span>
            {marks.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-3 rounded-sm ring-1 ring-white/40 ring-inset" /> 投球（白線がリリース）
              </span>
            )}
            {track.cuts.length > 0 && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2.5 w-px bg-ice" /> 場面の切り替わり
              </span>
            )}
          </span>
        </div>
        <ThrowPanel
          analysis={throws}
          heightCm={footage.source === "youtube" ? Math.round((throws?.heightM ?? DEFAULT_PLAYER_HEIGHT_CM / 100) * 100) : profile.heightCm()}
          forReference={footage.source === "youtube"}
          zones={footage.source === "youtube" ? undefined : refZones.zones}
          refCount={footage.source === "youtube" ? 0 : refZones.refCount}
          busy={throwsBusy}
          error={throwsError}
          frame={frame}
          fps={fps}
          selected={selected}
          onAnalyze={analyze}
          onPick={pick}
          onSeekFrame={seekFrame}
        />
      </div>

      <aside className="space-y-4">
        {yt && throws && <RegisterReference footage={footage} throws={throws} />}
        <Card className="p-5">
          <SectionTitle right={label && <Badge tone="pylon">{label}</Badge>}>追跡の結果</SectionTitle>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-3 text-sm">
            <div>
              <dt className="text-[11px] text-muted">本人が映っていた割合</dt>
              <dd className="font-display text-2xl text-turf">{Math.round(cov.ratio * 100)}%</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">補間したフレーム</dt>
              <dd className="font-display text-2xl">{cov.filled}</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">つないだ追跡</dt>
              <dd className="font-mono">{track.segments.length} 本</dd>
            </div>
            <div>
              <dt className="text-[11px] text-muted">映像全体で追跡した人数</dt>
              <dd className="font-mono">{track.peopleTracked}</dd>
            </div>
            {track.cuts.length > 0 && (
              <div className="col-span-2">
                <dt className="text-[11px] text-muted">場面の切り替わり</dt>
                <dd className="text-xs">
                  <span className="font-mono">{track.cuts.length}</span> か所。切り替わりの向こうへは追跡をつながないので、別の場面に映る本人は追いません。
                </dd>
              </div>
            )}
            <div className="col-span-2">
              <dt className="text-[11px] text-muted">映像</dt>
              <dd className="text-xs">
                {footage.info.width}×{footage.info.height} · {footage.info.fps.toFixed(0)} fps · {footage.info.duration.toFixed(1)} 秒
              </dd>
            </div>
          </dl>
          {footage.mediaRetained && (
            <Link to={`/footage/${footage.id}/pick`} className="mt-4 block">
              <Button className="w-full">
                <IconTarget size={15} aria-hidden /> 本人を選び直す
              </Button>
            </Link>
          )}
        </Card>

        {yt && (
          <Card className="p-5">
            <SectionTitle>出典</SectionTitle>
            <a href={yt.url} target="_blank" rel="noreferrer" className="flex items-start gap-2 text-sm hover:text-turf">
              <IconBrandYoutube size={18} className="mt-0.5 shrink-0 text-flag" aria-hidden />
              <span>
                {yt.title || yt.videoId}
                <span className="block text-xs text-muted">
                  {yt.channel} · {yt.start}〜{yt.end} 秒 · {yt.license === "creativeCommon" ? "Creative Commons" : "標準ライセンス"}
                </span>
              </span>
            </a>
            <p className="mt-3 text-[11px] leading-relaxed text-faint">元の動画は解析のあとに消し、公式の埋め込みプレイヤーに骨格を重ねています（ADR-0005）。</p>
          </Card>
        )}

        {(footage.links.preview || footage.links.focus) && (
          <Card className="space-y-2 p-5">
            <SectionTitle>確認用の動画</SectionTitle>
            {[
              { href: footage.links.preview, text: "全体のプレビュー（preview.mp4）" },
              { href: footage.links.focus, text: "本人を追うフォーカス動画（focus.mp4）" },
            ]
              .filter((x) => x.href)
              .map((x) => (
                <a key={x.text} href={lib.url(x.href!)} target="_blank" rel="noreferrer" className="flex items-center gap-2 text-sm text-muted hover:text-text">
                  <IconDownload size={15} aria-hidden /> {x.text}
                </a>
              ))}
          </Card>
        )}

      </aside>
    </div>
  );
}

export function FootageViewer() {
  return (
    <div className="space-y-6">
      <PageHeader title="② 見る：自分の映像" sub="追跡した本人の骨格を、実際の映像に重ねて再生します" />
      <PageGuide id="viewer" />
      <AnalyzerGate>
        <Viewer />
      </AnalyzerGate>
    </div>
  );
}
