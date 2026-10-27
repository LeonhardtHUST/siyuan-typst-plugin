#!/usr/bin/env node
/**
 * 下载与本插件严格配套的运行时二进制资产到 public/：
 *   - public/wasm/  ：typst-ts 0.6.1-rc3 的 wasm（与 index.js 内联胶水同一次构建）
 *   - public/fonts/ ：Typst CJK 字体集（typst-dev-assets@v0.13.1）
 *
 * 背景：
 * 1. wasm-bindgen 的 import/export 符号（__wbindgen_closure_wrapper<N>、__wbg_<fn>_<hash>）
 *    每次构建都会变化，胶水 JS 与 wasm 二进制必须来自同一次构建，跨版本必产生 LinkError。
 *    详见 docs/compatibility/siyuan-v3.8.8.md 链路 A。
 * 2. 插件原实现 preloadFontAssets() 未传参数，不加载任何远程字体；公式内引用的中文
 *    （如 "Def. 4.3.1 (酉空间)"）因编译器缺 CJK 字体渲染为豆腐块。CJK 字体集很小
 *    （NotoSerifCJKsc 为子集版 ~1.3MB），随插件自托管。
 *
 * 用法：node scripts/fetch-assets.mjs
 * 校验失败时以非零码退出（已接入 npm run build 构建链）。
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const TYPST_TS_VERSION = "0.6.1-rc3";
const FONT_ASSETS_VERSION = "v0.13.1";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const root = join(scriptDir, "..");

const ASSETS = [
  {
    dir: "wasm",
    items: [
      {
        url: `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler@${TYPST_TS_VERSION}/pkg/typst_ts_web_compiler_bg.wasm`,
        file: "typst_ts_web_compiler_bg.wasm",
        md5: "93129b48ea8f8a71a97536c74dbfc0d3",
        size: 21732903,
      },
      {
        url: `https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-renderer@${TYPST_TS_VERSION}/pkg/typst_ts_renderer_bg.wasm`,
        file: "typst_ts_renderer_bg.wasm",
        md5: "9dec3b7a5285da8840ac534b06dfd014",
        size: 981128,
      },
    ],
  },
  {
    dir: "fonts",
    items: [
      // text 集（typst-assets@v0.13.1）：含 NewCMMath 数学字体，缺它则
      // 编译报 "current font does not support math"
      ...[
        "DejaVuSansMono-Bold.ttf",
        "DejaVuSansMono-BoldOblique.ttf",
        "DejaVuSansMono-Oblique.ttf",
        "DejaVuSansMono.ttf",
        "LibertinusSerif-Bold.otf",
        "LibertinusSerif-BoldItalic.otf",
        "LibertinusSerif-Italic.otf",
        "LibertinusSerif-Regular.otf",
        "LibertinusSerif-Semibold.otf",
        "LibertinusSerif-SemiboldItalic.otf",
        "NewCM10-Bold.otf",
        "NewCM10-BoldItalic.otf",
        "NewCM10-Italic.otf",
        "NewCM10-Regular.otf",
        "NewCMMath-Bold.otf",
        "NewCMMath-Book.otf",
        "NewCMMath-Regular.otf",
      ].map((file) => ({
        url: `https://cdn.jsdelivr.net/gh/typst/typst-assets@${FONT_ASSETS_VERSION}/files/fonts/${file}`,
        file,
      })),
      // cjk 集（typst-dev-assets@v0.13.1）：公式内中文渲染
      ...[
        "InriaSerif-Bold.ttf",
        "InriaSerif-BoldItalic.ttf",
        "InriaSerif-Italic.ttf",
        "InriaSerif-Regular.ttf",
        "Roboto-Regular.ttf",
      ].map((file) => ({
        url: `https://cdn.jsdelivr.net/gh/typst/typst-dev-assets@${FONT_ASSETS_VERSION}/files/fonts/${file}`,
        file,
      })),
      // 全量 NotoSerifCJKsc（24.5MB）：typst-dev-assets 的子集版（cmap 42246→4382）
      // 缺"酉""阈"等非高频字，公式标签会渲染为豆腐块，故改用 notofonts/noto-cjk 全量字体。
      {
        url: "https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf",
        fallbackUrls: [
          "https://gh-proxy.com/https://raw.githubusercontent.com/notofonts/noto-cjk/main/Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf",
        ],
        file: "NotoSerifCJKsc-Regular.otf",
        md5: "1b00b42cf7cf738611ad53442ea1ea7f",
        size: 24543080,
      },
    ],
  },
];

const md5 = (buf) => createHash("md5").update(buf).digest("hex");

const verify = (item, buf) => {
  if (!buf || buf.length === 0) return "空文件";
  if (item.size && buf.length !== item.size) return `大小不符（期望 ${item.size}，实际 ${buf.length}）`;
  if (item.md5 && md5(buf) !== item.md5) return `md5 不符（期望 ${item.md5}，实际 ${md5(buf)}）`;
  return null;
};

let failed = false;
for (const group of ASSETS) {
  const outDir = join(root, "public", group.dir);
  await mkdir(outDir, { recursive: true });
  for (const item of group.items) {
    const dest = join(outDir, item.file);
    let buf = null;
    try {
      buf = await readFile(dest);
      const problem = verify(item, buf);
      if (problem) {
        console.log(`已存在但校验不符（${problem}），重新下载 ${item.file}`);
        buf = null;
      } else {
        console.log(`已存在 ${group.dir}/${item.file} (${(buf.length / 1048576).toFixed(2)} MB)`);
      }
    } catch {
      // 不存在，走下载
    }
    if (!buf) {
      const urls = [item.url, ...(item.fallbackUrls || [])];
      for (const u of urls) {
        try {
          console.log(`下载 ${u} ...`);
          const res = await fetch(u);
          if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
          }
          buf = Buffer.from(await res.arrayBuffer());
          break;
        } catch (e) {
          console.warn(`  失败：${e.message}`);
        }
      }
      if (!buf) {
        console.error(`下载失败 ${item.file}（已尝试 ${urls.length} 个源）`);
        failed = true;
        continue;
      }
      await writeFile(dest, buf);
      console.log(`已写入 ${group.dir}/${item.file} (${(buf.length / 1048576).toFixed(2)} MB)`);
    }
    const problem = verify(item, buf);
    if (problem) {
      console.error(`校验失败 ${item.file}: ${problem}`);
      failed = true;
    } else if (item.md5) {
      console.log(`校验通过 ${item.file}`);
    }
  }
}

if (failed) {
  console.error("\n资产获取或校验失败；请删除对应 public/ 子目录后重试，或手动放置文件。");
  process.exit(1);
}
console.log("\n全部就绪：public/wasm（0.6.1-rc3，同构建）+ public/fonts（CJK 字体集）。");
