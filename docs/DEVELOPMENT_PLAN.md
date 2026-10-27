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
- ⬜ M3 待启动

---

## 0. 总览

| 里程碑 | 目标 | 版本号 | 工作量估计 | 对应报告章节 |
|---|---|---|---|---|
| **M1 复活** ✅ | 在 SiYuan 3.8.8 上恢复可用 | v0.0.9 | 2–3 人日 | §5.1（P0） |
| **M2 工程化** | 自检、CI、防再漂移 | v0.1.0 | 3–5 人日 | §5.1–5.2（P1/P2） |
| **M3 归正** | 迁移到官方 NodeCustomBlock | v0.2.0 | 1–2 周 | §5.3（P3） |

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

## M3：v0.2.0 —— 迁移到官方 NodeCustomBlock 机制

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

## 分支与上游策略

- 分支：`main` 跟随 fork（LeonhardtHUST），每个里程碑一条 `fix/` 或 `feat/` 分支；
- 上游（Clouder0/siyuan-typst-plugin）约两年无更新：M1 完成后先发 fork 版本 v0.0.9（可直接推送思源集市需另行确认发布渠道），同时向上游提 PR——M1 的五项改动均为最小侵入性修复，被合入概率较高；M3 属架构迁移，以 fork 演进为主；
- 版本节奏：v0.0.9（M1）→ v0.1.0（M2）→ v0.2.0（M3）。

## 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| 行内公式无官方机制（M3） | 迁移后行内能力受限 | 保留 DOM hack 通道；或行内降级 KaTeX |
| `typst.ts` 升级 API 变化（M2-5） | 渲染链路重写 | CI ABI 自检先行；小步升级 |
| 上游不响应 PR | 修复无法回到源头 | fork 自主发版，README 注明 fork 缘由 |
| wasm 进发行包致体积 +22MB | 集市分发体验 | Cache Storage 缓解运行时；发布体积问题在 README 说明 |
| 思源 3.9+ DOM 再变化 | M1/M2 方案回归 | M2-3 端到端冒烟覆盖多个思源版本 |

## 立即可执行（本周）

1. `git checkout -b fix/v0.0.9-siyuan-3.8.8-compat`
2. 依 M1-1 → M1-5 顺序提交（每项独立 commit，便于回溯与向上游拆 PR）
3. 用兼容性报告附录 A 的方法在本地 Docker SiYuan 3.8.8 跑统一验收
4. 对生产环境（已部署热修的服务器）做一次"热修 → 源码版"替换回归
