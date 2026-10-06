// e2e テストの配信先。設定（playwright.config.ts）とテストの両方から読む。
// ふだん使う番号（vite の 5173・4173、解析サービスの 8787）とぶつからない番号で配信する。

/** 公開デモと同じく、リポジトリ名のサブパスで配信する（GitHub Pages） */
export const DEMO_BASE = "/film-coach/";
export const DEMO_PORT = 4180;
export const DEMO_URL = `http://127.0.0.1:${DEMO_PORT}${DEMO_BASE}`;

/** 手元の解析サービスにつなぐ設定で作った画面 */
export const LOCAL_PORT = 4181;
export const LOCAL_URL = `http://127.0.0.1:${LOCAL_PORT}/`;

/** 画面がつなぐ解析サービスの URL（apps/web/.env.development と同じ）。テストでは page.route で偽の応答を返す */
export const ANALYZER_URL = "http://127.0.0.1:8787";
