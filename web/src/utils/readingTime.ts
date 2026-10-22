/**
 * 阅读时长估算：中文按 350 字/分钟、英文按 220 词/分钟混合估算。
 * 取较大值当作「认真读」所需时间，至少 1 分钟。
 *
 * 不引入依赖；只做粗略但稳定的算术。
 */

const CJK_RATE = 350; // 字/分钟
const ALPHA_RATE = 220; // 词/分钟

export function readingTime(body: string): number {
  if (!body) return 1;
  // 计 CJK 字符（含全角标点）
  const cjk = (body.match(/[\u3000-\u9fff\uff00-\uffef]/g) ?? []).length;
  // 计西文「词」（粗略：连续字母数字串）
  const words = (body.match(/[A-Za-z0-9]+(?:['-][A-Za-z0-9]+)*/g) ?? []).length;
  const minutes = cjk / CJK_RATE + words / ALPHA_RATE;
  return Math.max(1, Math.round(minutes));
}