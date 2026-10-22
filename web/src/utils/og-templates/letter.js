import satori from "satori";
import { SITE } from "@/config";
import loadGoogleFonts from "../loadGoogleFont";

// 与 tokens.css 浅色令牌一致（satori 不支持 CSS 变量，这里写死）
const C = {
  paper: "#f3ebdf",
  surface: "#fffaf3",
  ink: "#26221d",
  soft: "#5f574d",
  rule: "#e2d6c4",
  wisteria: "#67498f",
  seal: "#a13f04",
  tape: "rgba(196,176,222,0.6)",
};

const el = (type, style, children) => ({ type, props: { style, children } });

/**
 * 信笺风 OG 图：暖纸底 + 胶带白卡 + 朱丝内框 + 印章
 * @param {{ eyebrow: string; title: string; subtitle?: string; footer: string }} o
 */
export default async function letterOg({
  eyebrow,
  title,
  subtitle = "",
  footer,
}) {
  const host = new URL(SITE.website).hostname;
  const text = [
    eyebrow,
    title,
    subtitle,
    footer,
    host,
    SITE.seal,
    SITE.author,
  ].join("");

  return satori(
    el(
      "div",
      {
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: C.paper,
        fontFamily: "Noto Serif SC",
      },
      [
        el(
          "div",
          {
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            width: 1040,
            height: 500,
            padding: "64px 72px 52px",
            background: C.surface,
            border: `1px solid ${C.rule}`,
            borderRadius: 28,
            boxShadow: "0 24px 48px -24px rgba(35,34,31,0.35)",
          },
          [
            // 朱丝内框
            el("div", {
              position: "absolute",
              top: 10,
              left: 10,
              right: 10,
              bottom: 10,
              border: "1.5px solid rgba(161,63,4,0.22)",
              borderRadius: 20,
            }),
            // 胶带
            el("div", {
              position: "absolute",
              top: -16,
              left: 470,
              width: 120,
              height: 32,
              background: C.tape,
              borderRadius: 3,
              transform: "rotate(-3deg)",
            }),
            el("div", { display: "flex", flexDirection: "column" }, [
              el(
                "div",
                {
                  display: "flex",
                  fontSize: 26,
                  color: C.wisteria,
                  letterSpacing: 4,
                },
                eyebrow
              ),
              el(
                "div",
                {
                  display: "flex",
                  marginTop: 22,
                  fontSize: title.length > 18 ? 56 : 68,
                  fontWeight: 700,
                  lineHeight: 1.3,
                  color: C.ink,
                },
                title
              ),
              subtitle
                ? el(
                    "div",
                    {
                      display: "flex",
                      marginTop: 20,
                      fontSize: 28,
                      color: C.soft,
                      lineHeight: 1.6,
                    },
                    subtitle
                  )
                : el("div", { display: "flex" }),
            ]),
            el(
              "div",
              {
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                fontSize: 24,
                color: C.soft,
              },
              [
                el("div", { display: "flex" }, footer),
                el("div", { display: "flex", alignItems: "center" }, [
                  el("div", { display: "flex", marginRight: 16 }, host),
                  el(
                    "div",
                    {
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      width: 52,
                      height: 52,
                      borderRadius: 8,
                      background: C.seal,
                      color: C.paper,
                      fontSize: 30,
                      fontWeight: 700,
                      transform: "rotate(-4deg)",
                    },
                    SITE.seal
                  ),
                ]),
              ]
            ),
          ]
        ),
      ]
    ),
    {
      width: 1200,
      height: 630,
      embedFont: true,
      fonts: await loadGoogleFonts(text),
    }
  );
}
