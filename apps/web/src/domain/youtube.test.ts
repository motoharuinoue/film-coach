import { describe, expect, it } from "vitest";
import { checkSegment, defaultSegment, formatTime, parseTime, parseYouTubeId } from "./youtube";

describe("parseYouTubeId", () => {
  it.each([
    ["https://www.youtube.com/watch?v=Qb7Throw_01", "Qb7Throw_01"],
    ["https://youtube.com/watch?v=Qb7Throw_01&t=42s", "Qb7Throw_01"],
    ["https://m.youtube.com/watch?v=Qb7Throw_01", "Qb7Throw_01"],
    ["https://youtu.be/Qb7Throw_01?si=abc", "Qb7Throw_01"],
    ["https://www.youtube.com/shorts/Qb7Throw_01", "Qb7Throw_01"],
    ["https://www.youtube-nocookie.com/embed/Qb7Throw_01", "Qb7Throw_01"],
  ])("%s から ID を取り出す", (url, id) => {
    expect(parseYouTubeId(url)).toBe(id);
  });

  it.each(["", "Qb7Throw_01", "https://example.com/watch?v=Qb7Throw_01", "https://www.youtube.com/watch?v=short", "https://www.youtube.com/channel/UC123"])("%s は受け付けない", (url) => {
    expect(parseYouTubeId(url)).toBeUndefined();
  });
});

describe("parseTime / formatTime", () => {
  it("分:秒、時:分:秒、秒だけの形式を読む", () => {
    expect(parseTime("1:05")).toBe(65);
    expect(parseTime("1:02:03")).toBe(3723);
    expect(parseTime("42")).toBe(42);
  });

  it("おかしな形式は undefined", () => {
    expect(parseTime("1:75")).toBeUndefined();
    expect(parseTime("abc")).toBeUndefined();
  });

  it("秒を 分:秒 に戻す", () => {
    expect(formatTime(65)).toBe("1:05");
  });
});

describe("checkSegment", () => {
  it("正しい区間を受け付ける", () => {
    expect(checkSegment("2:14", "2:17")).toEqual({ ok: true, start: 134, end: 137 });
  });

  it("終了が開始以前ならエラー", () => {
    expect(checkSegment("2:14", "2:14").ok).toBe(false);
  });

  it("60 秒を超える区間はエラー", () => {
    const r = checkSegment("0:00", "1:01");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain("60 秒");
  });
});

describe("defaultSegment", () => {
  it("取り込む区間の初期値は最初の 30 秒。短い動画ならその長さ", () => {
    expect(defaultSegment(95)).toEqual({ start: 0, end: 30 });
    expect(defaultSegment(12)).toEqual({ start: 0, end: 12 });
    expect(defaultSegment(0)).toEqual({ start: 0, end: 30 }); // 長さが分からなければ 30 秒
  });
});
