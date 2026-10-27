#!/usr/bin/env node
/**
 * ABI 链接自检：验证构建产物 dist/index.js 中内联的 wasm-bindgen 胶水
 * 与 public/wasm/ 下随插件分发的 wasm 二进制来自同一次构建。
 *
 * 背景：wasm-bindgen 的符号（__wbindgen_closure_wrapper<N>、__wbg_<fn>_<hash>）
 * 每次构建都会变化；胶水与 wasm 跨版本组合会在运行时抛
 * LinkError: Import #N "wbg" "..." 且静默回退 KaTeX。
 * 详见 docs/compatibility/siyuan-v3.8.8.md 链路 A。
 *
 * 用法：node scripts/check-abi.mjs （需先完成 npm run build）
 * 原理：从产物提取胶水提供的 import key 集合，用其构造桩 import 对象，
 * 在 Node 中实例化真实 wasm——缺 key 即抛出与浏览器一致的 LinkError。
 */
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");
const bundlePath = join(root, "dist", "index.js");
const wasmDir = join(root, "public", "wasm");

const GLUE_KEY_RE = /(__wbg_[A-Za-z0-9_]+|__wbindgen_[A-Za-z0-9_]+)/g;

let bundle;
try {
  bundle = await readFile(bundlePath, "utf8");
} catch (e) {
  console.error(`读取构建产物失败（请先 npm run build）: ${bundlePath}`);
  process.exit(1);
}

const glueKeys = new Set([...bundle.matchAll(GLUE_KEY_RE)].map((m) => m[1]));
console.log(`胶水提供的 import key: ${glueKeys.size} 个`);

if (glueKeys.size === 0) {
  console.error("产物中没有任何 wasm-bindgen 符号：胶水未被打包！" +
    "（检查 @myriaddreamin/typst-ts-web-compiler / typst-ts-renderer 是否已安装且未被 external 化）");
  process.exit(1);
}

const stub = () => 0;
const imports = { wbg: Object.fromEntries([...glueKeys].map((k) => [k, stub])) };

let failed = false;
for (const file of ["typst_ts_web_compiler_bg.wasm", "typst_ts_renderer_bg.wasm"]) {
  const bytes = await readFile(join(wasmDir, file));
  let mod;
  try {
    mod = new WebAssembly.Module(bytes);
  } catch (e) {
    console.error(`${file}: wasm 无法编译 ${e.message}`);
    failed = true;
    continue;
  }
  const required = WebAssembly.Module.imports(mod).map((i) => i.name);
  const missing = [...new Set(required.filter((n) => !glueKeys.has(n)))];
  if (missing.length > 0) {
    console.error(`${file}: 缺失 ${missing.length} 个 import key（前 5 个: ${missing.slice(0, 5).join(" ")}）`);
    console.error("  => 胶水与 wasm 版本失配，发布必然产生 LinkError 并静默回退 KaTeX");
    failed = true;
    continue;
  }
  try {
    new WebAssembly.Instance(mod, imports);
    console.log(`${file}: 链接成功（需要 ${required.length} 个 import，全部由胶水提供）`);
  } catch (e) {
    console.error(`${file}: 链接失败 ${e.message}`);
    failed = true;
  }
}

if (failed) {
  console.error("\nABI 自检未通过。");
  process.exit(1);
}
console.log("\nABI 自检通过：dist/index.js 胶水与 public/wasm 二进制同构建。");
