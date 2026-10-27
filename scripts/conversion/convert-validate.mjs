// 逐个校验待转换公式：用插件同款 typst.ts 0.6.1-rc3 + 同款模板/字体编译
import { readFile, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const CONVERT = "C:/Users/Leon/WorkBuddy/2026-10-27-11-18-50/convert";
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("file:")) {
    const buf = await readFile(new URL(u));
    return new Response(buf, { headers: { "content-type": u.endsWith(".wasm") ? "application/wasm" : "application/octet-stream" } });
  }
  return origFetch(url, opts);
};

const { createTypstCompiler } = await import("@myriaddreamin/typst.ts/dist/esm/compiler.mjs");
const { preloadFontAssets } = await import("@myriaddreamin/typst.ts/dist/esm/options.init.mjs");

const compiler = createTypstCompiler();
await compiler.init({
  getModule: () => pathToFileURL(resolve(ROOT, "public/wasm/typst_ts_web_compiler_bg.wasm")).href,
  beforeBuild: [preloadFontAssets({ assets: ["text", "cjk"], assetUrlPrefix: pathToFileURL(resolve(ROOT, "public/fonts") + "/").href })],
});

const htmlDecode = (s) => (s || "")
  .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
  .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const CJK_RULE = `#set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))
#show math.text: set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))`;

// 已知的转换后符号映射（与主文档修复时一致）
const FIXES = [
  [/chevron\.l/g, "angle.l"],
  [/chevron\.r/g, "angle.r"],
  [/varnothing/g, "nothing"],
  [/\\cal\(/g, "cal("],
  [/\\qquad\(/g, "qquad("],
];

const compileOne = async (content, isBlock) => {
  const src = `#set page(height: auto, width: auto, margin: 0pt)\n#set text(size: 13pt)\n${CJK_RULE}\n\n$ ${htmlDecode(content)} $\n`;
  compiler.addSource("/probe.typ", src);
  try {
    const r = await compiler.compile({ mainFilePath: "/probe.typ", diagnostics: "full" });
    if (r.diagnostics) {
      const msgs = [...r.diagnostics.values()].map((d) => d.message).join(" | ");
      return { ok: false, msg: msgs.slice(0, 80) };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e).slice(0, 80) };
  }
};

const collect = (file) => {
  const data = JSON.parse(readFileSync(resolve(CONVERT, file), "utf8"));
  const items = [];
  const walk = (n) => {
    if (Array.isArray(n)) return n.forEach(walk);
    if (n && typeof n === "object") {
      if (n.Type === "NodeMathBlockContent" && !(n.Data || "").startsWith("\\t")) items.push({ kind: "block", id: n.ID, content: n.Data });
      if (n.Type === "NodeTextMark" && n.TextMarkType === "inline-math" && !(n.TextMarkInlineMathContent || "").startsWith("\\t"))
        items.push({ kind: "inline", id: n.ID, content: n.TextMarkInlineMathContent });
      Object.values(n).forEach(walk);
    }
  };
  walk(data);
  return items;
};

const results = {};
for (const file of ["doc-merge.sy", "doc-ode.sy"]) {
  const items = collect(file);
  let ok = 0, fixed = 0, bad = 0;
  const badSamples = [];
  for (const it of items) {
    let c = it.content || "";
    if (!c.trim()) { ok++; continue; }
    let res = await compileOne(c, it.kind === "block");
    if (!res.ok) {
      let c2 = c;
      for (const [re, to] of FIXES) c2 = c2.replace(re, to);
      if (c2 !== c) {
        const res2 = await compileOne(c2, it.kind === "block");
        if (res2.ok) { fixed++; it.content = c2; continue; }
      }
      bad++;
      if (badSamples.length < 5) badSamples.push({ kind: it.kind, content: c.slice(0, 50), msg: res.msg });
      continue;
    }
    ok++;
  }
  results[file] = { total: items.length, ok, fixed, bad, badSamples };
}
console.log(JSON.stringify(results, null, 1).slice(0, 3000));
process.exit(0);
