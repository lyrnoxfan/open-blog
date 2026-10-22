import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";
import { SITE } from "@/config";

dayjs.extend(utc);
dayjs.extend(timezone);

/** 按文章时区（缺省为站点时区）解析日期 */
export const toZoned = (date: string | Date, tz?: string) =>
  dayjs(date).tz(tz || SITE.timezone);

/** 2026年10月6日 */
export const formatDateZh = (date: string | Date, tz?: string) =>
  toZoned(date, tz).format("YYYY年M月D日");

/** 生成稳定且合法的 view-transition-name（列表标题 ↔ 文章标题） */
export const transitionName = (id: string) => {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = (h * 33) ^ id.charCodeAt(i);
  return `post-${(h >>> 0).toString(36)}`;
};
