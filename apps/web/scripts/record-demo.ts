// README のデモ動画を録画する。手元の解析サービス（録画用のデータの写し）と画面を起動しておき、Google Chrome で場面ごとに録画して
// アニメーション WebP にする。
//
//   1. 録画用の写しを作る：本人以外と顔をぼかした映像に差し替え、YouTube のお手本は骨格と指標だけ（scripts/demo/make-demo-data.sh）
//   2. 写しを読む解析サービスと画面を起動する（例：解析サービス 8788 番、画面 5174 番）
//   3. node apps/web/scripts/record-demo.ts http://localhost:5174 docs/media
//
// 詳しくは docs/media/README.md。
//
// YouTube の映像（埋め込み・サムネイル）は映さない（ADR-0005）。お手本は骨格・指標・出典の文字だけを映す。

import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { chromium, type Browser, type BrowserContext, type Page } from "@playwright/test";

const BASE = process.argv[2] ?? "http://localhost:5174";
const OUT = resolve(process.argv[3] ?? "docs/media");
const SIZE = { width: 1280, height: 900 };
/** 練習（投球ドリル 4 本）と、その中の映像 */
const PRACTICE = "ffd0a2d6c8d8";
const WATCH = "6a42d5e12567"; // IMG_0459
const PICK = { id: "4605db5d3224", x: 812, y: 567, t: 0.2 }; // IMG_0461（追跡をやり直すので最後に録る）
const GUIDES = ["home", "new", "reps", "studio", "report", "progress", "footage", "pick", "viewer", "practice", "referenceSearch", "references"];

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * 縦に動かす。画面の配信は、動かしている途中に一部だけ描き直したコマを送ることがあるので、なめらかには動かさず
 * 一度で移り、描き終わるまで少し待つ（スライドをめくるような見せ方）
 */
async function glide(page: Page, y: number, _ms = 0) {
  await page.evaluate((to) => window.scrollTo({ top: to, behavior: "instant" }), y);
  await wait(250);
}

/** その要素が画面の上から offset の位置に来るまで動かす */
async function glideTo(page: Page, text: string, offset = 90, ms = 1600) {
  // 「css=」で始まれば要素の指定、そうでなければ文字
  const el = text.startsWith("css=") ? page.locator(text.slice(4)).first() : page.getByText(text, { exact: true }).first();
  await el.waitFor();
  const y = await el.evaluate((node, off) => node.getBoundingClientRect().top + window.scrollY - off, offset);
  await glide(page, y, ms);
}

async function prepare(browser: Browser) {
  const ctx = await browser.newContext({ viewport: SIZE });
  const page = await ctx.newPage();
  await page.goto(BASE);
  // ツアーとガイドを閉じた状態、表示するデータは手元の練習
  await page.evaluate((ids) => {
    localStorage.setItem("film-coach:tour-seen", "true");
    for (const id of ids) localStorage.setItem(`film-coach:guide-closed:${id}`, "true");
    localStorage.setItem("film-coach:data-source", JSON.stringify("local"));
  }, GUIDES);
  // レポートの文章を、手元の LLM に書いておいてもらう（ブラウザに覚えさせる）
  await page.goto(`${BASE}/#/sessions/${PRACTICE}/report?rep=4`);
  await page.getByText("改善点トップ", { exact: false }).first().waitFor();
  for (let i = 0; i < 120 && (await page.getByText("文章を書いています", { exact: false }).count()) > 0; i++) await wait(2000);
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

/** start() を呼んだところから録る（ページの読み込みは録らない）。wide でなければサイドバーを切り落として本文だけにする */
type Scene = { name: string; wide?: true; run: (page: Page, start: () => Promise<void>) => Promise<void> };

/** サイドバーの幅（lg 以上の画面） */
const SIDEBAR = 248;

const SCENES: Scene[] = [
  {
    name: "home",
    wide: true,
    run: async (page, start) => {
      await page.goto(`${BASE}/#/sessions/${PRACTICE}/reps`);
      await page.getByText("Rep 01").first().waitFor();
      await page.goto(`${BASE}/#/`);
      await page.getByText("おかえりなさい", { exact: true }).waitFor();
      await start();
      await wait(3500);
      await glide(page, 420, 1800);
      await wait(1800);
    },
  },
  {
    name: "watch",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/footage/${WATCH}`);
      const video = page.locator("video").first();
      await video.waitFor();
      await video.evaluate((v: HTMLVideoElement) => new Promise((r) => (v.readyState >= 3 ? r(null) : v.addEventListener("canplay", () => r(null), { once: true }))));
      await page.getByText("投げ始め", { exact: true }).waitFor();
      await start();
      await wait(800);
      await page.getByRole("button", { name: "再生" }).first().click();
      await wait(10200);
    },
  },
  {
    name: "ghost",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/footage/${WATCH}`);
      await glideTo(page, "お手本と重ねる", 80, 10);
      await start();
      await wait(7000);
      await page.getByText("並べる", { exact: true }).first().click();
      await wait(4500);
    },
  },
  {
    name: "studio",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/sessions/${PRACTICE}/studio?rep=1`);
      await page.locator('[data-tour="studio-video"]').waitFor();
      await start();
      await wait(1200);
      await page.keyboard.press("Space");
      await wait(6000);
      await glideTo(page, "手首の速さ（m/s）と肘角度", 140, 1800);
      await wait(2500);
    },
  },
  {
    name: "practice",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/footage/practices/${PRACTICE}`);
      await page.getByText("投球ごとの指標", { exact: true }).waitFor();
      await start();
      await wait(1500);
      await glideTo(page, "投球ごとの指標", 70, 1600);
      await wait(3000);
      await glideTo(page, "リリースの骨格を重ねる", 70, 2000);
      await wait(3500);
    },
  },
  {
    name: "report",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/sessions/${PRACTICE}/report?rep=4`);
      await page.getByText("改善点トップ", { exact: false }).first().waitFor();
      await start();
      await wait(2000);
      await glideTo(page, 'css=[data-tour="report-findings"]', 70, 2200);
      await wait(4500);
      await glide(page, (await page.evaluate(() => window.scrollY)) + 520, 2000);
      await wait(2500);
    },
  },
  {
    name: "library",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/references`);
      await page.getByText("Joe Burrow slow-mo warmup throw", { exact: false }).first().waitFor();
      await start();
      await wait(1500);
      await page.getByText("Joe Burrow slow-mo warmup throw", { exact: false }).first().click();
      await wait(1500);
      await glideTo(page, "重みの内訳", 160, 1600);
      await wait(2500);
      await glideTo(page, "お手本の分布", 70, 1600);
      await page.getByRole("button", { name: "ステップ幅", exact: true }).last().click();
      await wait(1500);
      await page.getByText("人気度だけで重み付けした場合と比べる").click();
      await wait(3000);
    },
  },
  {
    name: "pick",
    run: async (page, start) => {
      await page.goto(`${BASE}/#/footage/${PICK.id}/pick`);
      const img = page.locator("img[alt$='秒のフレーム']").first();
      await img.waitFor();
      // 本人を指す時刻のフレームが出るまで待つ（最初は別の時刻のフレームを読む）
      await wait(2500);
      await img.evaluate((el: HTMLImageElement) => (el.complete ? null : new Promise((r) => el.addEventListener("load", r, { once: true }))));
      await page.locator("#target-label").fill("");
      await start();
      await wait(1500);
      const box = (await img.boundingBox())!;
      await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.3);
      await page.mouse.move(box.x + (PICK.x / 1920) * box.width, box.y + (PICK.y / 1080) * box.height, { steps: 25 });
      await page.mouse.click(box.x + (PICK.x / 1920) * box.width, box.y + (PICK.y / 1080) * box.height);
      await wait(1000);
      await page.locator("#target-label").pressSequentially("QB", { delay: 120 });
      await wait(600);
      await page.getByRole("button", { name: "この人を追う" }).click();
      await wait(12000);
    },
  },
];

/**
 * 場面を録る。Chrome の画面配信（CDP の screencast）で、画面が変わるたびにコマを JPEG で受け取り、
 * 受け取った時刻どおりに並べて ffmpeg で GIF にする（Playwright の録画より文字がくっきりする）
 */
async function record(browser: Browser, state: Awaited<ReturnType<BrowserContext["storageState"]>>, scene: Scene, dir: string) {
  const ctx = await browser.newContext({ viewport: SIZE, storageState: state });
  const page = await ctx.newPage();
  // 最初の読み込みは録らない
  await page.goto(`${BASE}/#/`);
  await page.getByText("FILM COACH").first().waitFor();
  const cdp = await ctx.newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  cdp.on("Page.screencastFrame", (e: { data: string; sessionId: number; metadata: { timestamp: number } }) => {
    const file = join(dir, `${String(frames.length).padStart(5, "0")}.jpg`);
    writeFileSync(file, Buffer.from(e.data, "base64"));
    frames.push({ file, t: e.metadata.timestamp });
    void cdp.send("Page.screencastFrameAck", { sessionId: e.sessionId });
  });
  const start = () => cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: SIZE.width, maxHeight: SIZE.height }).then(() => undefined);
  await scene.run(page, start);
  await cdp.send("Page.stopScreencast");
  const end = Date.now() / 1000;
  await ctx.close();
  // 各コマを、次のコマまでの時間だけ見せる
  const lines = ["ffconcat version 1.0"];
  frames.forEach((f, i) => {
    const next = frames[i + 1]?.t ?? end;
    lines.push(`file '${f.file}'`, `duration ${Math.max(0.01, next - f.t).toFixed(3)}`);
  });
  lines.push(`file '${frames[frames.length - 1]!.file}'`);
  const list = join(dir, "frames.txt");
  writeFileSync(list, lines.join("\n"));
  return list;
}

/**
 * アニメーション WebP にする（幅 960 px、毎秒 10 コマ）。wide でなければサイドバーを切り落とす。
 * GIF は、画面を一度で移ったときに前のコマの一部が残ることがあり（差分だけを書く仕組みのため）、大きさも 4 倍ほどになるので使わない
 */
function toWebp(list: string, out: string, wide: boolean) {
  const crop = wide ? "" : `crop=${SIZE.width - SIDEBAR}:${SIZE.height}:${SIDEBAR}:0,`;
  const vf = `${crop}fps=10,scale=960:-1:flags=lanczos`;
  execFileSync("ffmpeg", ["-v", "error", "-y", "-f", "concat", "-safe", "0", "-i", list, "-vf", vf, "-c:v", "libwebp_anim", "-quality", "82", "-compression_level", "6", "-loop", "0", out]);
}

const only = process.env.SCENES?.split(",");
mkdirSync(OUT, { recursive: true });
const tmp = join(OUT, ".frames");
const browser = await chromium.launch({ channel: "chrome" });
const state = await prepare(browser);
for (const scene of SCENES.filter((s) => !only || only.includes(s.name))) {
  toWebp(await record(browser, state, scene, tmp), join(OUT, `${scene.name}.webp`), scene.wide === true);
  console.log(`録画しました：${scene.name}`);
}
await browser.close();
// KEEP_FRAMES=1 なら、最後の場面の元のコマを残す（乱れを調べるとき）
if (!process.env.KEEP_FRAMES) rmSync(tmp, { recursive: true, force: true });
