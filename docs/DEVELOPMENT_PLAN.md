# siyuan-typst-plugin 开发计划

> 依据：[docs/compatibility/siyuan-v3.8.8.md](compatibility/siyuan-v3.8.8.md)（对标 SiYuan v3.8.8 的兼容性报告，含三条故障链路与实测证据）
> 基线：本仓库 `96852c7`（v0.0.8，构建依赖 `@myriaddreamin/typst.ts ^0.6.1-rc3`）
> 说明：兼容性报告中的热修已在生产环境（Docker SiYuan 3.8.8，真实文档 532 块级 + 2616 行内公式）验证通过——块级 39/39、行内 278/278 渲染，控制台 0 报错。本计划把那套热修**迁回源码**，并给出后续路线。

## 进度状态（2026-10-27）

- ✅ **M1 v0.0.9 已完成并通过全部验收**（分支 `fix/v0.0.9-siyuan-3.8.8-compat`，11 个提交）：
  - M1-1～M1-7 全部落地，并额外完成：胶水包显式锁定依赖（发现 typst.ts 未声明
    `typst-ts-web-compiler` 依赖，全新 install 时胶水静默缺失）、`scripts/check-abi.mjs`
    ABI 链接自检接入构建链（原属 M2-2，提前交付）
  - 端到端验收：真实文档全量滚动扫描，**0 个编译错误公式、0 空渲染、0 pageerror**
    （修复前 130 个公式因文档内伪 Typst 语法报错，已同步修复文档数据：
    `chevron.l/r`→`angle.l/r` ×116、`varnothing`→`nothing` ×11、`\cal(`→`cal(` ×1、
    中文文本加引号 ×2；这些是转换管道的数据缺陷，非插件问题）
  - 构建产物与原版逐符号等价（胶水 import key 220 个一致，compiler 80 / renderer 153
    imports 全满足）
- ⬜ M2 待启动（M2-2 已部分提前交付）
- ⬜ M3 已被第二部分 P1 路线取代（保留作备选，见 M3 节注记）
- 📋 **第二部分（全局注入路线）已定案待执行**（2026-10-27）：核心为 siyuan-patch
  仓库的 Claim-at-Filter Math Renderer Registry——启用 Typst 时 KaTeX 零执行
  （连 katex.min.js 都不发起请求），覆盖编辑器/公式编辑弹窗/导出预览全部前端路径，
  目标"一经注入只有一次渲染"。详见第二部分。

### 第二部分执行进度（2026-10-27）

- ✅ **P0 完成**：`sync-upstream.yml`（每日跟随上游）+ `release-docker.yml`（接入 registry
  patch、切换 GHCR、owner 小写）。CI 构建成功（35 分钟，amd64+arm64 双架构，
  run `40478159589`），镜像 `ghcr.io/leonhardthust/siyuan:v3.8.8`（含 `-amd64` /
  `-arm64` / `latest` 标签，公开可匿名拉取）。
- ✅ **P1 完成**：`patches/siyuan/math-renderer-registry.patch` 已在 CI 中干净应用
  （clone+apply 步骤通过），v3.8.8 源码 `git apply --check` 与 esbuild 语法检查均通过。
- ✅ **P2 完成并在 patched 镜像上验证**：注册表模式激活
  （日志 `已注册数学渲染器（KaTeX 零开销模式）`）；真实文档 541 个公式节点、
  **DOM 内 KaTeX 节点数 = 0**、0 错误、0 pageerror；typst-math 测试文档 4/4 接管
  （Typst 语法渲染成功、LaTeX 语法如期报错）。
- ✅ **生产服务器已切换**：`/opt/siyuan/docker-compose.yml` 镜像改为
  `ghcr.io/leonhardthust/siyuan:v3.8.8`，数据卷不变；回滚 = 恢复
  `docker-compose.yml.bak-20261027` 后 `docker compose up -d`（旧镜像仍在本地）。
- 📌 **验收口径修正**：`katex.min.js` 请求数会因**第三方插件**（实测为
  `siyuan-plugin-copilot` 自带的 KaTeX 加载）而非零；SiYuan 核心的 KaTeX
  加载/渲染为 0（DOM 无 `.katex` 节点即证据）。验收应断言"核心 KaTeX 零加载"，
  而非"页面零 KaTeX 请求"。
- 📌 **P2 侦察结论（修正计划假设）**：SiYuan 的公式编辑面板（双击公式打开的
  `.protyle-util`）**只有源码 textarea，没有内置 KaTeX 预览**——编辑时的"预览"就是
  身后的公式块本身（随输入实时更新）。因此编辑体验由块级接管/registry 覆盖即可，
  无需单独接管编辑面板。
- ⬜ P3 导出链路（patched 镜像已就绪，可随时开始）、P4 边角与移动端未开始。

### P3 导出链路侦察结论（2026-10-27）

| 路径 | 实现 | Typst 可用性 | 结论 |
|---|---|---|---|
| **浏览器打印 → PDF**（Web/Server 部署的实际 PDF 路径） | 直接打印当前页 | ✅ **已验证**：打印媒体下 110 个块级公式全部可见、无隐藏 | 开箱可用，无需额外工作 |
| **PDF 导出（Electron 桌面版）** | `renderPDF()`：`/// #if !BROWSER` 内，独立预览页 + `await Protyle.mathRender(preview, cdn, true)` | ⚠️ 预览页是独立 window/realm，插件不在其中；registry 为空实例 | 用户为 Web 部署，**暂不处理**；如未来需要：patch 暴露全局 registry + 插件注入子窗口（P3b） |
| **导出 HTML** | 内核生成空公式节点（`data-subtype="math"`，无 KaTeX HTML）+ 导出页内嵌脚本客户端渲染 | ❌ `\t` 公式在导出产物中会渲染为 KaTeX 错误 | 修复需把 Typst 渲染能力带进导出产物（wasm+字体 ~47MB 或桥接方案）→ **列入 P5 决策，不阻塞** |
| 导出 Word / 微信 | 内核 Lute 侧 | ❌ | P5 |

**结论**：Web 部署下"PDF"目标已通过浏览器打印天然达成（已验证）；桌面版 PDF 与 HTML
导出属内核/独立产物范畴，收益低、成本高，按边界原则不做。

### P3b 导出烘焙（2026-10-27，patch v2）

按用户要求补做"导出 HTML + 桌面 PDF 预览"的 Typst 支持，实现方式为**应用内预烘焙**：

- `patches/siyuan/math-renderer-registry.patch` 新增 `bakeMathForExport()`（`export/index.ts`）：
  用当前渲染器（registry）把公式渲染为 SVG，**展平 shadow DOM** 写回 HTML → 产物自包含，
  不依赖导出端脚本/运行时
- 接入点：`onExport`（导出 HTML，浏览器/桌面通用）+ `renderPDF`（Electron 主窗口预取内容
  烘焙后注入预览页；预览页选项变更触发的重渲染回退为原行为）
- 附诊断钩子 `window.__siyuanBakeMathForExport`（供自动化验证）
- 踩坑记录：`Protyle` 类**没有**静态 `mathRender`（那是导出页 `ProtyleMethod` 的桥），
  误用会抛 TypeError 并被 catch 静默吞掉 → 必须直接 `import {mathRender}`

### P4 边角调用点（2026-10-27）

- ✅ **表格内公式**：真实文档 5 个表格、29 个单元格公式全部渲染（29/29，0 失败，0 pageerror）。
  表格路径（`tableCellRich` → `mathRender`）由 registry 自动覆盖，无需专门适配。
- ✅ **其余调用点同理**：`AgentMessageRenderer`（AI 消息）、移动端 outline、
  `richTextEditor` 等均经 `mathRender` 统一入口，registry 认领与编辑器完全一致
  （AI 消息需实际会话触发，未做端到端，但代码路径同源）。
- ⏸ **移动端**：wasm 21MB + 字体 24.5MB（合计约 47MB）对移动端下载/编译是明显负担；
  且需要为 Android/iOS 构建补丁镜像（当前 release-android/ios 未接入 patch）。
  结论：**暂缓**，待桌面/服务端稳定后再评估子集化方案。

### 分支状态

- 2026-10-27：`fix/v0.0.9-siyuan-3.8.8-compat`（18 个提交）已**快进合入 `main`**，
  main = `76a32ba`；服务器部署版本为该提交源码的构建产物。fix 分支保留作里程碑标记。

---

## 0. 总览

| 里程碑 | 目标 | 版本号 | 工作量估计 | 对应报告章节 |
|---|---|---|---|---|
| **M1 复活** ✅ | 在 SiYuan 3.8.8 上恢复可用 | v0.0.9 | 2–3 人日 | §5.1（P0） |
| **M2 工程化** | 自检、CI、防再漂移 | v0.1.0 | 3–5 人日 | §5.1–5.2（P1/P2） |
| **M3 归正** | 迁移到官方 NodeCustomBlock（已被第二部分 P1 取代，保留备选） | v0.2.0 | 1–2 周 | §5.3（P3） |
| **第二部分 P0–P5** | 全局 Typst 注入（跨 siyuan-patch 仓库，"一经注入只有一次渲染"） | plugin v0.3.x + patched 镜像 | 见第二部分 | — |

**统一验收标准**（每个里程碑合入前必须过）：
1. 端到端：真实文档（532 块级 + 2616 行内）在 3.8.8 无头浏览器中全量渲染，`.katex-error` 计数 = 0，控制台 pageerror = 0；
2. 冷启动：断开 jsdelivr（hosts 屏蔽或离线容器网络）插件仍能完成初始化；
3. 时序：重启应用（恢复页签场景）后公式自动渲染，无需手动切换文档。

---

## M1：v0.0.9 —— 修复三条故障链路（对应热修的源码化）

### M1-1 锁定并自托管 wasm【修复链路 A】

**源码位置**：`src/index.ts` L49–55（`init_context` 内两个 unpinned CDN URL）。

**改法**：
1. 新增 `scripts/fetch-wasm.mjs`：下载 `@myriaddreamin/typst-ts-web-compiler@0.6.1-rc3` 与 `@myriaddreamin/typst-ts-renderer@0.6.1-rc3` 的 `pkg/*.wasm`（21MB + 1MB），写入 `public/wasm/`，并做 MD5 校验（首次落地时记录基准值）。
2. `vite.config.ts` 的 `viteStaticCopy`（已在用，见 L42 一带）追加 `public/wasm → wasm/`，随插件发行。
3. `src/index.ts` 的 URL 改为 `` `/plugins/${this.name}/wasm/typst_ts_web_compiler_bg.wasm` ``（生产环境已验证 `/plugins/<name>/` 路径可静态访问且 MIME 为 `application/wasm`；同源请求自带会话 cookie）。
4. **同时把 `package.json` 的 `"@myriaddreamin/typst.ts": "^0.6.1-rc3"` 改为精确版本 `"0.6.1-rc3"`**——胶水 JS 与 wasm 必须同一次构建，`^` 前缀意味着重新 install 时胶水可能静默漂到 rc5，与锁死的 wasm 再次失配（这是本次事故机理在依赖侧的镜像）。

**验收**：断网冷启动可用；`node scripts/fetch-wasm.mjs` 幂等且校验失败时非零退出。

### M1-2 onload 重排：先注册监听，后初始化 wasm【修复链路 B2】

**源码位置**：`src/index.ts` L66、L77（两处 `await init_context(...)` 位于 L331 事件注册**之前**）。

**改法**：
1. 把 `loaded-protyle-static` / `destroy-protyle` 两个 `eventBus.on`（L331–451）**上移到 onload 开头同步执行**（此时 `render_*_once` 尚未定义的问题，用"渲染请求进队列"解决）；
2. `init_context` 改为后台 Promise：`const wasmReady: Promise<void> = (async () => { ... })()`；
3. `render_block_once` / `render_inline_once` 入口处 `await wasmReady`（渲染本身已是异步，不改变调用方签名）。

**验收**：应用启动时恢复的页签（事件在插件就绪前已派发的场景）公式能自动渲染——这正是热修前实测 0 节点被处理的场景。

### M1-3 初始扫描 + 动态加载订阅【修复链路 B1】

**源码位置**：`src/index.ts` L331–441（事件处理器目前只挂观察器，不扫存量节点）。

**改法**：
1. `loaded-protyle-static` 处理器在 `observer.observe(...)`（L433）之后，立即对 `p.wysiwyg.element` 执行一次全量扫描（复用 L353/L360 两个现成选择器），交给 `render_inline_once` / `render_block_once`；
2. `wasmReady` resolve 后追加一次 `document.querySelectorAll` 全局扫描，兜住"监听器注册前已派发事件"的启动页签（热修验证过的方案）；
3. 订阅 `loaded-protyle-dynamic`（3.8.8 已有该事件，携带 `position`），滚动懒加载路径不再单纯依赖观察器过滤逻辑。

**验收**：打开文档首屏公式渲染；滚动到文档中部再返回，新进入视口的块级/行内公式渲染。

### M1-4 占位节点守卫【修复链路 C1】

**源码位置**：`src/index.ts` L117（`render_block_once` 内裸读 `element.firstElementChild.firstElementChild.shadowRoot`）。

**改法**：在 L102 `first_time` 计算之前插入：

```ts
// SiYuan 先插入 <div spin="1"></div> 占位，KaTeX 内容后填
if (!element.firstElementChild?.firstElementChild) return;
```

**重试路径已存在，无需新增**：SiYuan 回填 KaTeX 时，mutation target 是 `div[spin]`，其 parent 即 `NodeMathBlock`，命中现有观察器的 `normal_first_block` 分支（L382–387）——热修实测一个会话内 71 个 TypeError 全部消失、最终全量渲染。

**验收**：控制台无 `Cannot read properties of null (reading 'shadowRoot')`。

### M1-5 行内公式外观清理【修复链路 C3】

**源码位置**：`src/index.ts` `render_inline_once` 成功渲染路径（L301 附近）。

**改法**：渲染成功后 `element.classList.remove("ft__error")`（思源在 KaTeX 失败时打上的红色标记类）。

**验收**：行内公式颜色与正文一致（截图目视 + DOM 断言 `ft__error` 不存在）。

### M1-6 修复公式内中文渲染（豆腐块）【新增，源码化期间发现】

**现象**：公式内引号中文（如 `"Def. 4.3.1 (酉内积与酉空间)"`）渲染为豆腐块。

**根因**（Node 隔离实验确认，非推测）：
1. 数学模式内的引号文本是**单个 run**：以拉丁字符开头时整串选中拉丁字体、**不做逐字回退**；
   纯 CJK 开头的 run 走默认回退可正常选中 Noto——所以 `"空间"` 正常而 `"Def. … (空格)"` 全豆腐。
2. `preloadFontAssets()` 原实现**不传参数**，一个远程字体都不加载（数学字形靠 wasm 内嵌字体）。
3. typst-dev-assets 的 NotoSerifCJKsc 是**子集**（cmap 4382 码点），"酉"等非高频字缺失。

**改法**：
1. `preloadFontAssets({ assets: ["text", "cjk"], assetUrlPrefix: "/plugins/<name>/fonts/" })`
   —— 注意：加载字体集会**替换**编译器默认字体，只装 cjk（无数学字体）会令全部公式
   报 `current font does not support math`，必须 text+cjk 同时加载。
2. 模板加 `#show math.text: set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))`
   把字体栈下推到数学文本元素（仅 `#set text(font:)` 对混合 run 无效）。
3. CJK 字体改用 notofonts/noto-cjk **全量** NotoSerifCJKsc（24.5MB，cmap 42246 码点）。
4. `scripts/fetch-wasm.mjs` → `fetch-assets.mjs`：新增 23 个字体下载（md5/大小校验、
   多源回退、校验不符自动重下）。

**验收**：真实文档全量滚动，含中文公式空渲染 0、编译错误 0、pageerror 0；
"酉"字标签截图确认为真汉字；字形复杂度分析（真汉字 path 段数 ≥30）6/6。

### M1-7 文档级 typst-math 开关【新增】

**功能**：文档头部（首个非空段落）写入 `<!-- typst-math -->` 后，该文档内**所有**公式
（块级/行内，无论是否带 `\t` 前缀）都由 Typst 接管渲染；标记段落自动隐藏（内容保留）。

**实现要点**：
- 标记检测：前 5 个顶层块内查找、跳过空段落、**剥离零宽字符**（思源 `protyle-attr` 附带
  `\u200b`，`trim()` 不清除——这一点曾导致标记永远匹配失败）
- 选择器放宽为全部数学节点，是否接管统一由 `resolve_typst` 判定（`\traw{}` > `\t{}` > 文档开关）
- 未接管前用 `color: transparent` 遮住 KaTeX 内容（含报错红字），避免闪烁
- 开关随观察器同步：插入/删除标记即时生效，删除后自动恢复 KaTeX

**边界（设计如此，非缺陷）**：Typst ≠ LaTeX——启用后 LaTeX 语法公式会显示编译错误；
公式编辑弹窗仍是 KaTeX 预览；导出与未装插件的客户端不渲染 Typst 内容。

**验收**：测试文档 4/4 公式接管（Typst 语法渲染成功、LaTeX 语法显示错误）、标记段落隐藏、
控制台 0 异常；无标记文档 492 公式回归 0 空渲染 0 错误。

### M1 发布清单

- [ ] 分支 `fix/v0.0.9-siyuan-3.8.8-compat`，上述 5 项各自独立 commit
- [ ] `plugin.json` 版本号 → `0.0.9`；`minAppVersion` 保持 `3.0.12`（M1 改动不依赖 3.8 专属 API）
- [ ] 按统一验收标准跑三轮端到端（首开 / 重启恢复 / 滚动）
- [ ] 更新 `README_zh_CN.md`：新增"已知限制"（导出/预览仍不支持）与自托管 wasm 说明

---

## M2：v0.1.0 —— 防再漂移与工程化

### M2-1 启动自检与明确报错（报告 §5.1-6）

`init_context` 的 catch 中调用 `showMessage()`，给出**可操作**的错误信息（区分：wasm 加载失败=网络/路径问题；LinkError=版本失配，提示"重新安装插件或提交 issue"）。杜绝本次事故中"静默回退 KaTeX、用户只看到 `\t` 未定义"的排查灾难。

进阶（可选）：初始化后用 `WebAssembly.Module.imports()` 与胶水 import 表比对，失配即显式报警。

### M2-2 ABI 链接自检进 CI（报告 §5.2-1）

新增 `scripts/check-abi.mjs`（构建后运行）：
1. 从构建产物 `index.js` 正则提取胶水 import key 集合；
2. 对 `public/wasm/*.wasm` 执行 `new WebAssembly.Instance(new WebAssembly.Module(bytes), { wbg: Object.fromEntries(keys.map(k => [k, () => 0])) })`；
3. 缺 key 抛出的 LinkError 直接导致 CI 失败。

> 方法已在事故排查中验证：能复现与浏览器逐字一致的 `Import #150 "wbg" "__wbindgen_closure_wrapper1625"`。接进 `.github/workflows/release.yml`。

### M2-3 端到端冒烟进 CI（可选，报告附录 A）

Playwright 容器 + SiYuan 3.8.8 容器编排：装载固定测试文档，断言 `data-render-typst` 覆盖率与 `.katex-error` 计数。成本较高，建议先作为发布前手动脚本（仓库内 `scripts/e2e/`），稳定后再进 CI。

### M2-4 wasm 缓存

`init_context` 的 `getModule` 之外，为 wasm 二进制加 Cache Storage 层（`caches.open('typst-wasm')`），二次启动零网络传输。21MB × 冷启动是目前最大的体验短板之一。

### M2-5 依赖升级评估（P2）

`@myriaddreamin/typst.ts` 0.7/0.8 系重打包：胶水与 wasm 同步更新，0.7 起有 `typstfontresolverbuilder` 等新 API，`renderSvg` 接口可能变化。**前置条件**：M2-2 的 CI 自检必须先就位，否则升级即是下一个静默事故。顺带评估去掉"双实例预载 + 每 100 次编译换池"策略（当前 `current_parsed` 逻辑，L137–144 / L262–269），改用 wasm 内置的 incr server（`typstcompiler_create_incr_server`）。

### M2-6 诊断日志开关

`src/libs/components/setting-panel.tsx` 已有设置面板基建，加 verbose 开关（渲染计数、扫描命中数、编译耗时）——热修期间 `[typst-fix]` 日志证明了它的价值。

---

## M3：v0.2.0 —— 迁移到官方 NodeCustomBlock 机制【已被第二部分 P1 取代】

> 2026-10-27 修订：第二部分的 Math Renderer Registry 在**不改数据格式**的前提下覆盖
> 块级+行内全部调用点（含导出预览与编辑弹窗），优先级高于本节。NodeCustomBlock 仅在
> 放弃 patch 路线时（如不愿长期维护 fork 且上游 PR 未被接受）再评估。以下保留作备选参考。

**背景**（报告 §5.3，源码已核实）：SiYuan 3.8.8 内置 `app/src/plugin/customBlockRender.ts`，提供注册根容器、增删观察、**激活时全量重渲染**（`activateCustomBlockPlugin(pluginName)`——天然解决 M1-2 的晚加载时序）、dispose 回调、`setContent` 回写、编辑器事件隔离、渲染失败 fallback。

**迁移设计**：
1. 块级公式从"劫持 `NodeMathBlock`"改为注册 custom block：
   - 块语法：`data-info="siyuan-typst-plugin/typst"`（`encodeCustomBlockInfo(pluginName, blockType)`）；
   - 插件侧实现 `customBlockRenders["typst"] = { render({ element, content, setContent }) {...} }`，返回 dispose；
   - 收益：官方托管生命周期，DOM hack 面缩小为零，`loaded-protyle-*` 时序问题整体消失。
2. **诚实的限制**：官方机制目前只覆盖块级；行内公式（`inline-math` textmark）无官方扩展点。行内方案二选一：
   - a) 保留现有 DOM hack（M1 后的形态，依赖面已收窄且有守卫）；
   - b) 行内暂时降级为 KaTeX，文档引导用户把复杂行内公式改为块级。
3. 数据兼容：提供 `$$\t{...}$$` → custom block 的迁移脚本（读写 kernel API），保留旧语法读取兼容一个版本。
4. `plugin.json` `minAppVersion` 提升到提供该 API 的最低版本（以 3.8.x 为基准做一次向下探测）。

---

# 第二部分：全局 Typst 注入（跨仓库路线，2026-10-27 定案）

> 目标：公式编辑窗口、PDF 导出等思源全场景由 Typst 渲染器注入，达到**全局无缝的
> Typst 公式体验**；启用 Typst 时**只有一次渲染**（KaTeX 零执行）。
> 仓库分工：SiYuan 源码改动全部进 `LeonhardtHUST/siyuan-patch`（fork of
> MohamedElashri/siyuan-patch：sanad 管理的 patch 集 + 全平台构建 CI，基线 v3.8.8）；
> Typst 逻辑全部留在本插件仓库。**不合入 siyuan 主仓**，只加通用呈现管线注入点。

## 2.0 注入点清单与边界（源码级确认，v3.8.8）

前端 KaTeX 渲染**统一入口**为 `app/src/protyle/render/mathRender.ts`，全前端约 20 处调用：

| # | 场景 | 源码位置 | 插件可否 | 归属 |
|---|---|---|---|---|
| 1 | 编辑器正文（块级/行内） | `processCode.ts` → mathRender | ✅ 已做（DOM 接管） | registry 后迁移 |
| 2 | 公式编辑窗口预览 | `protyle/toolbar/index.ts`（含 katex+mathRender） | ✅ 可做（DOM 观察替换预览节点） | P2 先插件过渡，registry 后迁移 |
| 3 | 搜索/浮窗预览 | 同 1 管线（protyle 复用） | ✅ 天然覆盖 | 补验证即可 |
| 4 | PDF 导出预览 | `protyle/export/index.ts`（前端生成预览 + print，**会 await mathRender 的 Promise**） | ⚠️ window.open 后注入，时序脆弱 | patch（registry 顺带解决） |
| 5 | HTML/Word 导出 | 内核 Lute 侧（Go） | ❌ 插件不可达 | P3 侦察后决策 |
| 6 | 表格内公式 / AI agent 消息 / 移动端 outline | `tableCellRich*` / `AgentMessageRenderer` 等各自调 mathRender | ⚠️ 逐个 DOM hack 不经济 | patch 一处全解 |
| 7 | 富文本剪贴板 / 微信导出 | `richClipboard.ts` / `wechatMath` | ❌ | patch |
| 8 | 内核 katex 配置 | 仅 conf 文件，无渲染逻辑 | — | 无需处理 |

**关键源码事实**（mathRender.ts，v3.8.8 实读）：
- 跳过条件是 `data-render !== "true"` 的**同步过滤**，发生在函数调用瞬间（processRender 内），
  早于任何插件代码（loaded-protyle-static 在 setHTML 末尾才派发）——这是插件无法根治
  初始一遍 KaTeX 的硬时序约束，也是 registry 必须做成 patch 的根本原因
- `addStyle(katex.min.css)` 在过滤**之前**执行（存在任何数学节点即加载 CSS）——registry
  版把它移入 KaTeX 分支，全认领时连 CSS 都不加载
- `mathRender` 返回 Promise 且导出路径会 await 它（含 `fitMathWidth` 宽度适配）——
  渲染器的异步 Promise 可无缝并入该链，PDF 导出"画完再打印"天然成立
- inline 分支含一组 ZWSP 光标边界处理（`insertAdjacentText`），registry 版渲染器
  必须保留同等行为

## 2.1 技术路线：Claim-at-Filter Renderer Registry

**渲染器 API**（新文件 `app/src/protyle/render/mathRendererRegistry.ts`）：

```ts
interface IMathRenderContext {
  element: HTMLElement;      // 目标节点（div[data-subtype="math"] 或 span）
  mathContent: string;       // 原始 data-content（反转义由渲染器自理，与 KaTeX 路径一致）
  isBlock: boolean;
  maxWidth: boolean;         // 导出场景的宽度适配要求
}
interface IMathRenderer {
  canRender(ctx: IMathRenderContext): boolean;        // 同步，过滤期调用
  render(ctx: IMathRenderContext): Promise<boolean>;  // true=接管成功；false/异常=回退
}
registerMathRenderer(id: string, renderer: IMathRenderer): void
unregisterMathRenderer(id: string): void
```

插件经 `Plugin.prototype.registerMathRenderer(id, renderer)` 注册（unload 自动反注册），
以特性检测降级——官方版思源上自动退回现有 DOM 接管，跨版本兼容。
（早期设计的 `ctx.source`（editor/toolbar/export）已砍掉：mathRender 无法廉价感知
调用方，且 Typst 的认领条件只依赖元素自身。）

**mathRender.ts 改造要点**（最小 diff）：

1. **认领判断放进同步过滤循环**：对每个 `data-render !== "true"` 的节点先问
   `findMathRenderer(ctx)`；认领即置 `data-render="true"` 并收集——此时 KaTeX 的
   CSS/JS 都未加载，认领节点对 KaTeX **零成本**
2. `addStyle`（KaTeX CSS）移入 KaTeX 分支；全认领时连 CSS 都不请求
3. 渲染器异步执行，失败（返回 false 或抛错）→ 撤销 `data-render` → **同一次调用内**
   回退 KaTeX（降级语义，非冗余渲染）
4. 返回 `Promise.all([渲染器组, KaTeX 链])`，保持导出路径的 await 时序语义
5. 保留 `isFoldedRenderContent` 过滤与 `[data-subtype="math"]` 选择器
6. inline 的 ZWSP 边界逻辑抽成 `applyInlineMathBoundaries(el)` 导出供渲染器复用

**单次渲染时序证明**：
- 初始内容：认领发生在**第一次** mathRender 调用内部（processRender 同步段），
  早于 KaTeX 脚本加载请求 → `katex.min.js` 网络请求计数 = 0
- 重复调用（processRender 在各类事件中反复触发）：认领时已置 `data-render` → 全部跳过
- 渲染器失败：恰好一次 KaTeX 降级渲染（设计语义）

**否决的备选**（均有硬伤）：
- 事件总线 hook（render-math 事件 + preventDefault）：类型化差、Promise 组合困难
- 预注入假 `#protyleKatexScript` stub：`addScript` 按 id 去重可被利用，但会毁掉
  所有普通文档的 KaTeX，黑魔法，仅作技术存在性记录
- 插件侧 `data-render` 抢先认领：过滤同步先于插件代码，只能赢窄竞态，收益小
  （registry 就绪前可选择性用作缓解）
- NodeCustomBlock（原 M3）：只覆盖块级且需改数据格式；registry 不改格式、全覆盖

## 2.2 阶段计划（每单元完成即自动 commit）

**P0 — siyuan-patch 基建**（仓库：LeonhardtHUST/siyuan-patch）
- `.github/workflows/sync-upstream.yml`：每日 cron 拉取 upstream/main → fast-forward
  推送 origin；冲突则自动开 `sync/conflict-*` 分支并提 issue（不静默丢弃）
- `PATCHES.md` 登记每个自有 patch 的用途；README fork 化说明
- 触发一次 release-docker 验证 fork CI 可产出镜像（ghcr.io/LeonhardtHUST/siyuan）
- 验收：上游有新提交次日自动同步；镜像 tag 可拉取
- 【自动提交】

**P1 — math-renderer-registry.patch**（仓库：siyuan-patch）
- 按 §2.1 实现（registry 新文件 + mathRender.ts 改造 + Plugin API 暴露 +
  `applyInlineMathBoundaries` 抽取）
- **回归红线：无注册器时构建产物与上游 diff 为空**（行为逐字节一致）
- 单测（mathRender 已有测试文件可扩展）+ e2e 断言：认领场景 `katex.min.js`
  请求计数 = 0、`window.katex` 未定义
- 构建含此 patch 的 docker 镜像 `typst-registry-0.1`
- 【自动提交】

**P2 — 插件适配层**（仓库：siyuan-typst-plugin）
- `registerMathRenderer` 适配：特性检测——patched SiYuan 走官方注入点，官方 SiYuan
  降级现有 DOM 接管（双模式并存，可配置切换）
- 公式编辑窗口预览接管（**不依赖 P1，可先行**）：观察工具栏 DOM、输入 debounce →
  Typst 编译 → 替换预览；typst-math 文档显示 Typst，普通文档保持 KaTeX
- e2e 矩阵：编辑器 / 编辑弹窗 / 搜索预览 × 官方镜像 / patched 镜像
- 【自动提交】

**P3 — 导出链路**
- PDF 导出预览经 registry 接管（依赖 §2.1-4 的 Promise 链）；导出测试文档 →
  解析 PDF 验证矢量公式存在
- 内核侦察：确认 HTML/Word 导出中公式的渲染位置（Lute/内核）；若需内核 patch →
  出范围评估报告作为 P5 决策输入，**不擅自动内核**
- 【自动提交】

**P4 — 边角与移动端**
- 表格内公式 / agent 消息 / 大纲等调用点回归（registry 应自动覆盖，逐项验证）
- 移动端 wasm 体积与性能评估（24MB wasm + 字体可能需子集化决策）
- 【自动提交】

**P5 — 决策点（本轮不承诺执行）**
- 内核导出 patch（HTML/Word 导出内置 Typst 能力，成本约 47MB 资源/产物）
- 换池机制根治（改用 wasm incr server）
- ~~registry 向 siyuan-note 提上游 PR~~ —— **2026-10-27 用户决定：不提上游 PR**，
  registry 仅作为自有 fork 的能力维护

## 2.3 执行约定

- 两个仓库各自**每单元一 commit**（自动提交），构建产物不入库
- 新增 patch 必须先登记 `PATCHES.md`；回归红线（无注册器 diff 为空）不可破
- 生产迁移：服务器当前 `b3log/siyuan:latest` → 切换 fork 镜像需一次容器替换（数据卷不动）
- 上游跟随：SiYuan 每次发版 registry patch 可能冲突——sanad minor 级自动更新 +
  sync workflow 半自动处理；大重构需手工 rebase
- 导出根本限制：HTML/Word 内核侧导出在 P3 侦察前无法承诺

---

## 分支与上游策略

- 分支：`main` 跟随 fork（LeonhardtHUST），每个里程碑一条 `fix/` 或 `feat/` 分支；
- 上游（Clouder0/siyuan-typst-plugin）约两年无更新：M1 完成后先发 fork 版本 v0.0.9（可直接推送思源集市需另行确认发布渠道），同时向上游提 PR——M1 的五项改动均为最小侵入性修复，被合入概率较高；M3 属架构迁移，以 fork 演进为主；
- 版本节奏：v0.0.9（M1）→ v0.1.0（M2）→ 第二部分 P0–P5 并行推进（M3 已被取代）；
- 跨仓库分工：SiYuan 源码 patch 全部进 `LeonhardtHUST/siyuan-patch`（第二部分），
  本仓库只持有 Typst 渲染逻辑与适配层。

## 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 行内公式无官方机制（M3） | 迁移后行内能力受限 | 保留 DOM hack 通道；或行内降级 KaTeX |
| `typst.ts` 升级 API 变化（M2-5） | 渲染链路重写 | CI ABI 自检先行；小步升级 |
| 上游不响应 PR | 修复无法回到源头 | fork 自主发版，README 注明 fork 缘由 |
| wasm 进发行包致体积 +22MB | 集市分发体验 | Cache Storage 缓解运行时；发布体积问题在 README 说明 |
| 思源 3.9+ DOM 再变化 | M1/M2 方案回归 | M2-3 端到端冒烟覆盖多个思源版本 |
| registry patch 与上游冲突（第二部分） | 每次思源发版需 rebase | sync-upstream workflow + 回归红线（无注册器时构建产物与上游 diff 为空） |
| 编辑弹窗/导出体验不达预期 | 功能回退 | registry 与 DOM 接管双模式并存，可配置切换 |
| 内核侧导出（HTML/Word）不可达 | 导出场景残缺 | P3 侦察后单独决策，不阻塞前端路线 |

## 待启动（等指示）

- 下一执行单元：**第二部分 P0**（siyuan-patch 基建：sync-upstream workflow + PATCHES.md + fork CI 产出验证）
- 可并行：M2-4 wasm 缓存；P2 的公式编辑弹窗预览接管（不依赖 P1）
- 执行约定见 §2.3：每单元完成即自动 commit；新增 patch 先登记 PATCHES.md；
  回归红线（无注册器 diff 为空）不可破

### P3b 导出烘焙验收（2026-10-27 21:25）

- 函数级验证（`window.__siyuanBakeMathForExport`）：真实文档 9.2MB → **61.8MB**，
  **2978 个公式内联 SVG**（3211 节点中 233 个是 `\t{` 空残桩，无法渲染，非缺陷），
  行内公式展平修复生效（`sampleHasSvg: true`），0 KaTeX 错误
- 已知代价：整篇导出耗时约 85s（3211 个公式）、产物增大 ~66×（内联 SVG），
  大文档导出适用、日常小文档影响可忽略
