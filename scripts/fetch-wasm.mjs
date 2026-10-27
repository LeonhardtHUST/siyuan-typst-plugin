#!/usr/bin/env node
/**
 * 下载与本插件内联胶水代码严格同构建的 typst-ts wasm（0.6.1-rc3）到 public/wasm/。
 *
 * 背景：wasm-bindgen 的 import/export 符号（__wbindgen_closure_wrapper<N>、__wbg_<fn>_<hash>）
 * 每次构建都会变化，因此胶水 JS（来自 @myriaddreamin/typst.ts@0.6.1-rc3，已打包进 index.js）
 * 与 wasm 二进制必须来自同一次构建。跨版本（包括 0.6.0 与 0.6.1-rc5）都会产生 LinkError。
 * 详见 docs/compatibility/siyuan-v3.8.8.md 链路 A。
 *
 * 用法：node scripts/fetch-wasm.mjs
 * 校验失败时以非零码退出（可接入 CI / 发布流程）。
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TYPST_TS_VERSION = "0.6.1-rc3";

const WASM_FILES = [
  {
    package: "@myriaddreamin/typst-ts-web-compiler",
    file: "typst_ts_web_compiler_bg.wasm",
    md5: "93129b48ea8f8a71a97536c74dbfc0d3",
    size: 21732903,
  },
  {
    package: "@myriaddreamin/typst-ts-renderer",
    file: "typst_ts_renderer_bg.wasm",
    md5: "9dec3b7a5285da8840ac534b06dfd014",
    size: 981128,
  },
];

const scriptDir = dirname(fileURLToPath(import.meta.url));
const outDir = join(scriptDir, "..", "public", "wasm");

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

const isExact = (buf, expect) => {
  if (md5(buf) !== expect.md5) return `md5 不符: 期望 ${expect.md5}`;
  if (buf.length !== expect.size) return `大小不符: 期望 ${expect.size}`;
  return null;
};

await mkdir(outDir, { recursive: true });

let failed = false;
for (const expect of WASM_FILES) {
  const dest = join(outDir, expect.file);
  let buf = null;
  try {
    buf = await readFile(dest);
    console.log(`已存在 ${expect.file} (${(buf.length / 1048576).toFixed(1)} MB)`);
  } catch {
    const url = `https://cdn.jsdelivr.net/npm/${expect.package}@${TYPST_TS_VERSION}/pkg/${expect.file}`;
    console.log(`下载 ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) {
      console.error(`下载失败: HTTP ${res.status}`);
      failed = true;
      continue;
    }
    buf = Buffer.from(await res.arrayBuffer());
    await writeFile(dest, buf);
    console.log(`已写入 ${dest} (${(buf.length / 1048576).toFixed(1)} MB)`);
  }
  const problem = isExact(buf, expect);
  if (problem) {
    console.error(`校验失败 ${expect.file}: ${problem}`);
    failed = true;
  } else {
    console.log(`校验通过 ${expect.file}`);
  }
}

if (failed) {
  console.error("\nwasm 获取或校验失败；请删除 public/wasm/ 后重试，或手动放置对应文件。");
  process.exit(1);
}
console.log("\n全部就绪：public/wasm/ 与内联胶水（typst.ts@" + TYPST_TS_VERSION + "）同构建。");
