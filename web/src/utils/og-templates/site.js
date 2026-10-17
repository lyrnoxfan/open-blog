import { SITE } from "@/config";
import letterOg from "./letter";

export default async () =>
  letterOg({
    eyebrow: "LETTERS · 信笺",
    title: SITE.title,
    subtitle: SITE.desc,
    footer: `— ${SITE.author}`,
  });
