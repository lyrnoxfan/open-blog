/**
 * 统计文本字数：
 * - 中日韩表意字符：每个计 1 字
 * - 其余按英文单词切分：每个单词计 1 字
 */
export function countWords(text: string): number {
  if (!text) return 0;

  const cjkPattern = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/g;
  const cjkCount = (text.match(cjkPattern) ?? []).length;

  const withoutCjk = text.replace(cjkPattern, " ");
  const wordCount = (
    withoutCjk.match(/[A-Za-z0-9]+(?:['’][A-Za-z0-9]+)*/g) ?? []
  ).length;

  return cjkCount + wordCount;
}
