// 画面ごとの「この画面でできること」と、使う流れ（4 段階）の文言。

export type StepKey = "import" | "watch" | "fix" | "keep";

/** 使う流れ。ナビとガイドの両方で使う */
export const STEPS: { key: StepKey; no: number; title: string; desc: string }[] = [
  { key: "import", no: 1, title: "取り込む", desc: "動画を入れてレップを選ぶ" },
  { key: "watch", no: 2, title: "見る", desc: "骨格で 1 本を細かく見る" },
  { key: "fix", no: 3, title: "直す", desc: "改善点とドリルを読む" },
  { key: "keep", no: 4, title: "続ける", desc: "日ごとの変化を追う" },
];

export type GuideId = "home" | "new" | "reps" | "studio" | "report" | "progress" | "references" | "footage" | "pick" | "viewer";

export type Guide = {
  step?: StepKey;
  /** この画面の目的（1 文） */
  purpose: string;
  /** 主な操作 */
  actions: string[];
  /** 次に進む先。:sid は表示中のセッション ID に置き換える */
  next?: { label: string; to: string };
};

export const GUIDES: Record<GuideId, Guide> = {
  home: {
    purpose: "最新の結果と、次に直すことを一目で見る画面です。",
    actions: ["「次に直すこと」の画像を押すと、分析スタジオでその根拠の場面を開きます", "「最近のセッション」を押すと、そのセッションのレップ一覧を開きます"],
    next: { label: "② 分析スタジオで見る", to: "/sessions/:sid/studio" },
  },
  new: {
    step: "import",
    purpose: "動画を取り込んで解析する画面です。",
    actions: ["ファイルをドラッグ&ドロップするか、YouTube の URL と区間（60 秒以内）を入れます", "撮影角度を選ぶと、その角度で測れる指標が右に出ます", "「解析を始める」を押すと解析します（デモでは模擬の解析です）"],
    next: { label: "解析結果のレップを選ぶ", to: "/sessions/:sid/reps" },
  },
  reps: {
    step: "import",
    purpose: "解析で切り出した投球（レップ）から、見たい 1 本を選ぶ画面です。",
    actions: ["カードを押すと、その投球を分析スタジオで開きます", "右下の数字はスコア、下の表示はいちばん気になる指標です", "いちばん下のデモでは、試合映像の選手を押すと、その選手を追跡します"],
    next: { label: "② 分析スタジオで見る", to: "/sessions/:sid/studio" },
  },
  studio: {
    step: "watch",
    purpose: "1 本の投球を骨格で細かく見る画面です。「比較」に切り替えると、自己ベストやお手本と並べて比べられます。",
    actions: ["Space で再生、← → で 1 コマずつ進みます。フェーズの帯を押すと、その場面へ移動します", "右の指標カードを押すと、その判定の根拠になった場面へ移動します", "「ゴースト」で、自己ベストかお手本の骨格を重ねて表示します"],
    next: { label: "③ レポートで改善点を読む", to: "/sessions/:sid/report" },
  },
  report: {
    step: "fix",
    purpose: "解析の結果を 1 枚にまとめた画面です。",
    actions: ["改善点トップ 3 に、目標の値と練習ドリルの動画が付いています", "「PDF に出力」で、印刷用の形で保存できます"],
    next: { label: "④ 推移で変化を追う", to: "/progress" },
  },
  progress: {
    step: "keep",
    purpose: "セッションごとの変化を見る画面です。",
    actions: ["上のボタンで、見る指標を切り替えます", "青い帯がお手本ゾーン、縦の太い線がその日のレップの幅（最小〜最大）です"],
    next: { label: "① 次の動画を取り込む", to: "/sessions/new" },
  },
  footage: {
    step: "import",
    purpose: "手元の解析サービスに取り込んだ、自分の映像の一覧です。映像は手元から外に出しません。",
    actions: ["「取り込む」で、ファイルか YouTube の区間を取り込みます", "追跡がまだの映像は「本人を選ぶ」、終わった映像は「見る」で開きます"],
    next: { label: "① 映像を取り込む", to: "/sessions/new" },
  },
  pick: {
    step: "import",
    purpose: "大勢が映る映像から、追いかける本人を選ぶ画面です。",
    actions: ["下のスライダーで、本人がはっきり映っている時刻を探します", "映像の中の本人（胸のあたり）を押して、印を付けます", "名前（例：#5）を付けて「この人を追う」を押すと、解析サービスが追跡と骨格推定をします"],
  },
  viewer: {
    step: "watch",
    purpose: "追跡した本人の骨格を、実際の映像に重ねて見る画面です。",
    actions: [
      "「フォーカス表示」で、本人を追いかけるように拡大します",
      "下の帯は追跡の状況です（緑：追えた、黄：補間、灰：見失った）。押すとその時刻へ移ります",
      "身長を入れて「投球を見つける」と、1 球ずつフェーズと QB 指標が出ます。投球を選ぶとリリースの瞬間へ移ります",
    ],
  },
  references: {
    purpose: "判定の基準になるお手本（YouTube の動画）を管理する画面です。",
    actions: ["お手本を選ぶと、右に重みの内訳（P・C・Q・K・M）が出ます", "ピン留め・除外・星で調整すると、すべての画面の判定が変わります", "下の分布で、お手本の中での自分の位置を確かめられます"],
  },
};
