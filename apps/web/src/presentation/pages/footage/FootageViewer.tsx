import { IconBrandYoutube, IconDownload, IconFocusCentered, IconTarget } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import { coverage, type Footage, type TargetTrack } from "../../../domain/footage";
import { VideoFootagePlayer, YouTubeFootagePlayer, type Layers } from "../../components/footage";
import { Badge, Button, Card, DemoNote, PageHeader, SectionTitle, Toggle } from "../../components/ui";
import { PageGuide } from "../../guide/PageGuide";
import { useAnalyzer } from "../../state/analyzer";
import { AnalyzerGate } from "./AnalyzerGate";

function Viewer() {
  const { id = "" } = useParams();
  const { lib } = useAnalyzer();
  const [footage, setFootage] = useState<Footage>();
  const [track, setTrack] = useState<TargetTrack>();
  const [error, setError] = useState<string>();
  const [layers, setLayers] = useState<Layers>({ box: true, skeleton: true, focus: false });

  useEffect(() => {
    if (!lib) return;
    lib
      .get(id)
      .then(async (f) => {
        setFootage(f);
        if (f.trackStatus === "done") setTrack(await lib.track(f));
      })
      .catch((e: Error) => setError(e.message));
  }, [lib, id]);

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

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-3">
        <Card className="space-y-3 p-3">
          {footage.links.media ? (
            <VideoFootagePlayer src={lib.url(footage.links.media)} track={track} label={label} layers={layers} />
          ) : yt ? (
            <YouTubeFootagePlayer videoId={yt.videoId} start={yt.start} end={yt.end} track={track} label={label} layers={layers} />
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
          </span>
        </div>
      </div>

      <aside className="space-y-4">
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

        <DemoNote>投球の指標（ステップ幅・肘の高さなど）は、横から全身を撮った投球の映像で出せるようにします（M1 の残り）。</DemoNote>
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
