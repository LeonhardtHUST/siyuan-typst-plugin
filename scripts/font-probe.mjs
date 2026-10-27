// 第五阶段：试验修复方案——让数学模式内以拉丁开头的混合文本也能渲染 CJK
import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const origFetch = globalThis.fetch;
globalThis.fetch = async (url, opts) => {
  const u = String(url);
  if (u.startsWith("file:")) {
    const buf = await readFile(new URL(u));
    const ct = u.endsWith(".wasm") ? "application/wasm" : "application/octet-stream";
    return new Response(buf, { headers: { "content-type": ct } });
  }
  return origFetch(url, opts);
};

const { createTypstCompiler } = await import("@myriaddreamin/typst.ts/dist/esm/compiler.mjs");
const { createTypstRenderer } = await import("@myriaddreamin/typst.ts/dist/esm/renderer.mjs");
const { preloadFontAssets } = await import("@myriaddreamin/typst.ts/dist/esm/options.init.mjs");

const wasmC = pathToFileURL(resolve(ROOT, "public/wasm/typst_ts_web_compiler_bg.wasm")).href;
const wasmR = pathToFileURL(resolve(ROOT, "public/wasm/typst_ts_renderer_bg.wasm")).href;
const fontsPrefix = pathToFileURL(resolve(ROOT, "public/fonts") + "/").href;

const compiler = createTypstCompiler();
const renderer = createTypstRenderer();
await Promise.all([
  compiler.init({
    getModule: () => wasmC,
    beforeBuild: [preloadFontAssets({ assets: ["text", "cjk"], assetUrlPrefix: fontsPrefix })],
  }),
  renderer.init({ getModule: () => wasmR }),
]);

const CONTENT = `"Def. 4.3.1 (酉空间与酉变换)"`;
const STACK = `("Libertinus Serif", "Noto Serif CJK SC")`;

const analyze = (svg) => {
  const paths = [...svg.matchAll(/<path[^>]*d="([^"]*)"/g)].map((m) => m[1]);
  const segs = paths.map((d) => (d.match(/[MLCQZ]/g) || []).length);
  // 真汉字字形（对照：纯 CJK 时的段数 34~80）
  const realCjk = segs.filter((s) => s >= 30).length;
  return { svgLen: svg.length, paths: paths.length, segs, realCjk };
};

const run = async (label, extra) => {
  const src = `#set page(height: auto, width: auto, margin: 0pt)
#set text(size: 13pt)
${extra}

$ ${CONTENT} $
`;
  compiler.addSource("/probe.typ", src);
  const r = await compiler.compile({ mainFilePath: "/probe.typ", diagnostics: "full" });
  if (r.diagnostics) {
    console.log(`\n== ${label} ==\n  诊断: ${[...r.diagnostics.values()].map((d) => `[${d.severity}] ${d.message}`).join(" | ").slice(0, 300)}`);
    return;
  }
  const svg = await renderer.runWithSession(async (session) => {
    renderer.manipulateData({ renderSession: session, action: "reset", data: r.result });
    return await renderer.renderSvg({ renderSession: session });
  });
  const a = analyze(svg);
  console.log(`\n== ${label} ==`);
  console.log(`  path ${a.paths} 个, 段数 [${a.segs.join(",")}]`);
  console.log(`  高复杂度(真CJK)字形: ${a.realCjk} 个 ${a.realCjk > 0 ? "✓ 中文渲染成功" : "✗ 仍为豆腐"}`);
};

// 基线（现状：豆腐）
await run("基线: 仅 set text(font)", `#set text(font: ${STACK})`);
// 方案1: show math.text 配 set text
await run("方案1: show math.text: set text(font: ...)", `#set text(font: ${STACK})\n#show math.text: set text(font: ${STACK})`);
// 方案2: show math.text 重写为 text 元素
await run("方案2: show math.text: it => text(font: ...)[#it]", `#set text(font: ${STACK})\n#show math.text: it => text(font: ${STACK})[#it]`);
// 方案3: 纯文本模式对照（确认 text 模式逐字回退正常）
{
  const src = `#set page(height: auto, width: auto, margin: 0pt)\n#set text(size: 13pt)\n#set text(font: ${STACK})\n\n${CONTENT}\n`;
  compiler.addSource("/probe.typ", src);
  const r = await compiler.compile({ mainFilePath: "/probe.typ", diagnostics: "full" });
  if (!r.diagnostics) {
    const svg = await renderer.runWithSession(async (session) => {
      renderer.manipulateData({ renderSession: session, action: "reset", data: r.result });
      return await renderer.renderSvg({ renderSession: session });
    });
    const a = analyze(svg);
    console.log(`\n== 方案3: 纯文本模式对照 ==`);
    console.log(`  path ${a.paths} 个, 段数 [${a.segs.join(",")}]`);
    console.log(`  高复杂度(真CJK)字形: ${a.realCjk} 个 ${a.realCjk > 0 ? "✓" : "✗"}`);
  }
}

console.log("\n完成");
process.exit(0);
