// README の構成図（docs/media/architecture.html）を、Google Chrome で 2 倍の解像度の PNG に書き出す。
//
//   node apps/web/scripts/render-diagram.ts

import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const html = resolve("docs/media/architecture.html");
const png = resolve("docs/media/architecture.png");

const browser = await chromium.launch({ channel: "chrome" });
const page = await browser.newPage({ viewport: { width: 1280, height: 836 }, deviceScaleFactor: 2 });
await page.goto(pathToFileURL(html).href);
await page.locator(".canvas").screenshot({ path: png, omitBackground: true });
await browser.close();
console.log(`書き出しました：${png}`);
