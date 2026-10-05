// お手本として登録：YouTube から取り込み、お手本の選手の投球を解析した映像を、判定の基準に加える。
// 登録するときに、YouTube の再生数・高評価数・登録者数を取り直す（無料枠を 2 ユニット）。

import { IconBooks, IconCheck, IconLoader2 } from "@tabler/icons-react";
import { useEffect, useState } from "react";
import { Link } from "react-router";
import { KIND_LABEL, type ReferenceKind } from "../../../domain/entities";
import type { Footage } from "../../../domain/footage";
import type { LocalReference } from "../../../domain/reference";
import type { ThrowAnalysis } from "../../../domain/throws";
import { Button, Card, SectionTitle, Segmented, Toggle } from "../../components/ui";
import { useAnalyzer } from "../../state/analyzer";

export function RegisterReference({ footage, throws }: { footage: Footage; throws: ThrowAnalysis }) {
  const { lib } = useAnalyzer();
  const [registered, setRegistered] = useState<LocalReference | null>();
  const [kind, setKind] = useState<ReferenceKind>("model");
  const [trusted, setTrusted] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  useEffect(() => {
    lib
      ?.references()
      .then((rs) => setRegistered(rs.find((r) => r.videoId === footage.id) ?? null))
      .catch(() => setRegistered(null));
  }, [lib, footage.id]);

  if (!lib || registered === undefined) return null;
  const heightCm = Math.round(throws.heightM * 100);
  const register = async () => {
    setBusy(true);
    setError(undefined);
    try {
      setRegistered(await lib.registerReference({ footageId: footage.id, kind, trustedChannel: trusted, playerHeightCm: heightCm }));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3 p-5">
      <SectionTitle>お手本として登録</SectionTitle>
      {registered ? (
        <>
          <p className="flex items-center gap-1.5 text-sm text-turf">
            <IconCheck size={16} aria-hidden /> {KIND_LABEL[registered.kind]}として登録しています
          </p>
          <Link to="/references" className="inline-block">
            <Button>
              <IconBooks size={15} aria-hidden /> お手本ライブラリで見る
            </Button>
          </Link>
        </>
      ) : throws.reps.length === 0 ? (
        <p className="text-xs leading-relaxed text-muted">投球が見つかっていないので、お手本にできません。投げている場面を取り込み直してください。</p>
      ) : (
        <>
          <p className="text-xs leading-relaxed text-muted">
            この映像の投球 {throws.reps.length} 球を、判定の基準（お手本の分布）に加えます。お手本の選手の身長 {heightCm} cm で解析した値を使います。
          </p>
          <Segmented
            label="お手本の種類"
            size="sm"
            value={kind}
            onChange={setKind}
            options={(["model", "drill", "ng"] as const).map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <div>
            <Toggle on={trusted} onChange={setTrusted} tone="ice">
              信頼するチャンネル（発信者 C に加点）
            </Toggle>
          </div>
          <Button variant="primary" className="w-full" disabled={busy} onClick={register}>
            {busy ? <IconLoader2 size={16} className="animate-spin" aria-hidden /> : <IconBooks size={16} aria-hidden />}
            お手本として登録
          </Button>
          {error && <p className="text-xs text-flag">{error}</p>}
          <p className="text-[11px] leading-relaxed text-faint">登録するときに、YouTube の再生数・高評価数・登録者数を取り直します（無料枠を 2 ユニット使います）。</p>
        </>
      )}
    </Card>
  );
}
