// 校验转换产物中的全部公式
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { readFileSync } from "node:fs";

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

const CJK_RULE = `#set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))
#show math.text: set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))`;

const decode = (s) => (s || "").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");

const compileOne = async (content) => {
  const src = `#set page(height: auto, width: auto, margin: 0pt)\n#set text(size: 13pt)\n${CJK_RULE}\n\n$ ${decode(content)} $\n`;
  compiler.addSource("/probe.typ", src);
  try {
    const r = await compiler.compile({ mainFilePath: "/probe.typ", diagnostics: "full" });
    if (r.diagnostics) return { ok: false, msg: [...r.diagnostics.values()].map((d) => d.message).join(" | ").slice(0, 70) };
    return { ok: true };
  } catch (e) {
    return { ok: false, msg: String(e).slice(0, 70) };
  }
};

const extract = (md) => {
  const out = [];
  // 代码围栏外才解析（这两个文件无围栏，简单处理）
  const lines = md.split("\n");
  let inBlock = false;
  let buf = [];
  for (const line of lines) {
    const t = line.trim();
    if (t === "$$") {
      if (inBlock) { out.push(buf.join("\n")); buf = []; inBlock = false; }
      else { inBlock = true; }
      continue;
    }
    if (inBlock) { buf.push(line); continue; }
    // 行内 $...$
    const re = /\$([^$]+)\$/g;
    let m;
    while ((m = re.exec(line))) out.push(m[1]);
  }
  return out;
};

for (const f of ["out-merge.md", "out-ode.md"]) {
  const md = readFileSync(resolve(CONVERT, f), "utf8");
  const items = extract(md);
  let ok = 0;
  const bad = [];
  for (const c of items) {
    if (!c.trim()) { ok++; continue; }
    const r = await compileOne(c);
    if (r.ok) ok++;
    else bad.push({ c: c.slice(0, 46), msg: r.msg });
  }
  console.log(`== ${f} ==  公式 ${items.length} | 通过 ${ok} | 失败 ${bad.filter(Boolean).length}${bad.length > 6 ? "+" : ""}`);
  const cls = {};
  bad.forEach((b) => { const k = (b.msg || "").split(",")[0].slice(0, 40); cls[k] = (cls[k] || 0) + 1; });
  console.log("   失败类型:", JSON.stringify(cls));
  bad.slice(0, 10).forEach((b) => console.log("   ✗", JSON.stringify(b.c), "→", b.msg));
}
process.exit(0);
