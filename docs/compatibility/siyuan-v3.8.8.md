# siyuan-typst-plugin 兼容性报告

**对标版本**：SiYuan v3.8.8（Docker `b3log/siyuan:latest`，kernel 3.8.8）
**插件版本**：siyuan-typst-plugin v0.0.8（Clouder0，声明 `minAppVersion: 3.0.12`，构建依赖 `@myriaddreamin/typst.ts ^0.6.1-rc3`）
**报告日期**：2026-10-27
**验证方式**：v3.8.8 前端源码比对（GitHub tag）＋ Node wasm 链接测试 ＋ Playwright 无头浏览器端到端实测（真实文档：532 个块级公式、2616 个行内公式）

---

## 1. 结论摘要

| 判定项 | 结论 |
|---|---|
| 开箱即用性 | **完全不可用**。三条独立故障链路叠加，任何一条都导致全量公式回退到 KaTeX 报错 |
| 修复难度 | 中等。三层问题均可定位且可热修（本机已实施并验证通过，见 §4） |
| DOM 兼容性 | 选择器、属性名、protyle 属性在 3.8.8 下**仍然匹配**（这部分没坏） |
| 坏掉的部分 | wasm 加载（ABI 断裂）、事件时序（错过 `loaded-protyle-static`）、占位节点容错 |
| 未修复的架构限制 | 导出/预览不渲染、每次加载 21MB wasm、CDN 依赖、移动端未验证 |
| 上游维护状态 | v0.0.8 之后约两年无更新；作者自述"依赖 DOM 结构而非稳定 API" |

**一句话结论**：插件不是被 3.8.8 的 DOM 改动弄坏的，而是被**自身的不稳定依赖（unpinned CDN wasm）**、**启动时序竞态**和**懒渲染容错缺失**三件事共同杀死；其中前两件与 SiYuan 版本演进有交互，第三件是插件自身 bug。

---

## 2. 测试环境

- 宿主机：Debian 13（VM-0-15-debian），kernel 6.12.90+deb13.1
- SiYuan：Docker 容器 `siyuan`（`b3log/siyuan:latest`，kernel 3.8.8），workspace 挂载于宿主机 `/opt/siyuan/workspace`
- 插件路径：`data/plugins/siyuan-typst-plugin/`，`petals.json` 中 `enabled: true, incompatible: false`
- 测试文档：《傅里叶空间引入：从函数集合到傅里叶展开（合并稿·Typst 转换）》（doc id `20261027110820-o5b44t9`），532 个块级公式（`$$\t{...}$$`）＋ 2616 个行内公式（`$\t{...}$`）
- 无头浏览器：`mcr.microsoft.com/playwright:v1.48.0-noble`，`--network host` 直连内核 6806，经 `/api/system/loginAuth` 取会话后加载真实前端

---

## 3. 故障链路详解

### 3.0 仍然兼容的部分（先说清楚什么没坏）

以下均在 3.8.8 实测/源码确认仍然成立，是修复得以成立的基础：

| 项 | 状态 |
|---|---|
| 公式块 DOM：`div.render-node[data-type="NodeMathBlock"][data-content]` | ✅ 内核 `getBlockDOM` 输出与插件选择器完全匹配 |
| 行内公式 DOM：`span[data-type="inline-math"][data-content]` | ✅ 浏览器实测匹配 |
| `protyle.contentElement`、`protyle.wysiwyg.element` | ✅ v3.8.8 源码中均存在且语义未变 |
| 事件名 `loaded-protyle-static` / `destroy-protyle` | ✅ 存在且会派发（`app/src/protyle/util/onGet.ts`） |
| 插件加载机制（petals.json、index.js 入口） | ✅ 正常加载并执行 onload |

### 3.1 链路 A：wasm 运行时 ABI 断裂（致命，与上游 npm 漂移相关）

**机理**：插件把 typst-ts 0.6.1-rc3 的 wasm-bindgen **胶水 JS 内联**进了 `index.js`，但 wasm 二进制**运行时**从 jsdelivr 拉取，且 URL **未锁版本**：

```
https://cdn.jsdelivr.net/npm/@myriaddreamin/typst-ts-web-compiler/pkg/...wasm   ← npm latest
```

wasm-bindgen 的符号命名是**按构建随机生成**的：`__wbindgen_closure_wrapper<N>` 的编号、`__wbg_<fn>_<hash>` 的哈希、intrinsic 导出名（`__wbindgen_export_0.._6` vs `__wbindgen_export`）在每次发版都会变。npm latest 已漂移到 0.7.0 → 胶水与 wasm 永远链接不上。

**版本比对数据**（用插件胶水实际提供的 220 个 import key 做集合比对）：

| typst-ts 版本 | compiler import 缺失 | renderer import 缺失 | 判定 |
|---|---|---|---|
| 0.5.0 / 0.5.2 / 0.5.4 | 51 | 138 | 不可用 |
| 0.6.0 | 1（`closure_wrapper16165`） | 3（`1625`/`1626`/`2253`） | 不可用（导出侧能对上，import 侧对不上） |
| **0.6.1-rc3** | **0** | **0** | **唯一可用**（即构建时锁定的版本） |
| 0.6.1-rc5 | 67 | 142 | 不可用 |
| 0.7.0（当前 latest） | 9（含全部 `__wbindgen_export_*` 改名、`typstcompiler_set_compiler_options`/`add_web_fonts` 删除） | — | 不可用 |

**故障链**：
`onload` → `await init()` → `WebAssembly.instantiate` → `LinkError: Import #150 "wbg" "__wbindgen_closure_wrapper1625": function import requires a callable` → **onload 中断在事件注册之前** → 全部公式回退 SiYuan 原生 KaTeX → 用户看到 `KaTeX parse error: Undefined control sequence: \t`。

**注意**：KaTeX 报错只是回退表象。用户侧看到的"所有 `\t` 公式报错"无法区分这条链路和后续两条——必须看浏览器 console 才能分辨。

**该链路的时变性**：这是"以前能用、现在坏了"的主要来源。插件发布时（2024 前后）npm latest 恰好是 0.6.x，无需配置即可用；typst-ts 发 0.6.1-rc5/0.7.0 后静默死亡，无人改动任何东西。

### 3.2 链路 B：事件时序竞态（致命，与 3.8.8 行为相关）

**源码证据**（`app/src/protyle/util/onGet.ts`，v3.8.8 tag）：`setHTML` 的执行顺序是——

1. `protyle.wysiwyg.element.innerHTML = options.content`（**内容先入 DOM**）
2. `processRender` / `highlightRender` / `avRender` / `blockRender` …
3. **最后**才 `forEachPluginSubscriber("loaded-protyle-static", …) emit`

插件在 `loaded-protyle-static` 事件里才创建 MutationObserver，于是有**两个**死路：

- **B1（内容先于事件）**：文档打开时内容已插入完毕，观察器启动后收不到任何"新增节点"记录，初始公式永远不被处理。
- **B2（事件先于插件就绪，更隐蔽）**：插件 `onload` 里先 `await` 21MB wasm 初始化（秒级），再注册事件监听。而**应用启动时恢复的页签**会在启动流程中就完成 setHTML 并 emit——此时插件尚未就绪，事件直接错过。此路径下连观察器都不会挂上，后续滚动懒加载进来的块也没有人处理。

**实测证据**：无头浏览器打开真实文档，插件处理节点数 = 0，控制台无任何插件日志；且 3.8.8 存在 `loaded-protyle-dynamic` 事件（滚动动态加载时派发），**插件未订阅**。

### 3.3 链路 C：占位节点容错缺失 + 块级/行内双路径（致命，插件自身 bug）

- **C1 占位节点**：3.8.8 插入公式块时先放占位结构 `<div class="render-node" ...><div spin="1"></div>…`，KaTeX 内容是客户端**后续**填充的。插件 `l` 函数无守卫直接读 `E.firstElementChild.firstElementChild.shadowRoot` → 对空占位抛 `TypeError: Cannot read properties of null (reading 'shadowRoot')`。实测一个会话 71 个 pageerror。
- **C2 双路径**：块级（`l` 函数）与行内（`y` 函数，`span[data-type='inline-math']`）是两套独立代码。任何只覆盖块级的修复方案会漏掉全部行内公式——本测试文档行内公式占 **83%**（2616/3148）。
- **C3 外观残留**（轻微）：行内公式渲染成功后 `ft__error` class 残留在 span 上（思源标红用的类）。本例实测无视觉影响，但依赖主题实现，属于隐患。

### 3.4 数据面观察（非插件 bug，但同一工作流里会咬人）

- 转换管道曾丢失 `\t` 前缀：532 个块级公式中 4 个只剩 `{...}`。这类公式任何插件版本都无法渲染（格式约定不满足），需要数据修复而非插件修复。
- 行内公式在 `.sy` 中的正确存储键是 `NodeTextMark` + `TextMarkType: "inline-math"` + **`TextMarkInlineMathContent`**（不是 `TextMarkTextContent`）。排查工具读错键会得出"没有行内公式"的错误结论。

### 3.5 架构性限制（与 3.8.8 无关，但影响可用性评估）

1. **导出/预览不渲染**：README 自述未适配，`plugin.json` 设 `disabledInPublish: true`。导出 PDF/图片时公式全部退回 KaTeX 报错——**本报告的修复不改变这一点**。
2. **冷启动重**：每次加载拉 21MB compiler wasm + 1MB renderer wasm，且插件**预载两套实例**（工作实例 + 备用换池实例，每 100 次编译切换一次）。
3. **网络依赖**：CDN（jsdelivr）在国内部分网络不可达；字体（typst-assets v0.13.1，已锁版本）也走 CDN。
4. **移动端**：未测试，无结论。

---

## 4. 已实施修复（hotpatch）与验证结果

对 `index.js`（自原始 `index.js.bak-20261027` 重建）共三类改动：

| # | 改动 | 对应链路 |
|---|---|---|
| 1 | 两个 wasm URL 改为自托管 `/plugins/siyuan-typst-plugin/typst_ts_*.wasm`（0.6.1-rc3，MD5 校验与 npm 发布件一致；内核以 `application/wasm` 正确serv） | A |
| 2 | `l` 函数头部加占位守卫：`if(!(E.firstElementChild&&E.firstElementChild.firstElementChild))return;`（注意：`it=` 位于一条 `const` 声明链中间，守卫必须插在链前，否则语法错误） | C1 |
| 3 | onload 末尾插入：全局扫描（块级 `qb` + 行内 `qi` 双选择器）＋ document 级 MutationObserver（childList/attributes，`m.target.closest()` 捕捉懒渲染回填）＋ 10s 轮询兜底，全部调用带 catch | B1/B2/C2 |

**端到端验证结果**（无头浏览器，真实文档，含滚动触发懒加载）：

| 指标 | 修复前 | 修复后 |
|---|---|---|
| 块级公式渲染 | 0 / N | **39/39**（当前 DOM 内全量） |
| 行内公式渲染 | 0 / N | **278/278** |
| `data-render-typst` 标记 | 0 | 全量 |
| KaTeX 错误残留 | 全部 | **0** |
| 控制台 pageerror | 71 个 TypeError | **0** |
| 截图目视 | 红色报错文本 | 行内/块级均正常排版，无红色 |

**已知残留**：`ft__error` class 未清理（C3）；导出/预览仍不渲染（架构限制）。
**回滚**：`cp index.js.bak-20261027 index.js`（会退回链路 A 的 LinkError 状态，仅用于取证）。

---

## 5. 开发 / 更新方向

### 5.1 短期：兼容性 hotfix（可直接整理为上游 PR）

按收益/成本排序：

1. **锁死 wasm 版本并自托管**：`@0.6.1-rc3` 写进 URL，或直接把 wasm 打进插件发行包（体积 +22MB，换取完全离线与抗漂移）。这是唯一与"构建产物绑定"的正确做法——胶水和 wasm **必须同一次构建**，任何"大版本相近"都不够（0.6.0 都不行）。
2. **onload 重排**：先注册事件监听（同步代码），再异步初始化 wasm；初始化完成前把渲染请求排队。消除 B2。
3. **初始全量扫描 + document 级观察器**（即本报告 §4-3），或至少补订阅 `loaded-protyle-dynamic`。消除 B1。
4. **占位节点守卫 + 延迟重试**（§4-2）。消除 C1。
5. 行内渲染成功后移除 `ft__error` class。消除 C3。
6. 加一个启动自检：`WebAssembly.Module.imports()` 与胶水 import 表比对，不匹配时给用户**明确的错误提示**而不是静默回退 KaTeX——本次事故排查成本的大头就在"静默失败"。

### 5.2 中期：工程化重构

1. **升级 typst.ts 到 0.7/0.8 系**：需胶水与 wasm 同步重打包；建议 CI 加一个"链接自检"步骤（Node 里 `WebAssembly.instantiate` + 桩 import 表，失败即阻断发布）——本次的验证方法可以直接搬去做测试。
2. **wasm 缓存**：用 Cache Storage / OPFS 持久化 21MB blob，二次加载零网络。
3. **单实例 + 增量编译**：预载两套实例的策略可改为单实例 + 利用 wasm 里现成的 incr server（`typstcompiler_create_incr_server` / `incr_compile`），换池逻辑当前是"每 100 次编译整体换"。
4. **诊断日志开关**：插件设置里加 verbose 开关（本次 hotpatch 的 `[typst-fix]` 日志即此用途）。

### 5.3 长期：迁移到官方 NodeCustomBlock 机制（正确的集成点）

**关键事实**：SiYuan 3.8.8 已内置完整的插件自定义块渲染基础设施（`app/src/plugin/customBlockRender.ts`）——这正是插件作者 README 里"等官方 Custom Inline Element"所等待的东西，且已经落地为块级 API：

- 块级语法：`data-type="NodeCustomBlock"` + `data-info="<pluginName>/<blockType>"`
- 插件侧注册：`plugin.customBlockRrenders[blockType].render({element, content, setContent})`，可返回 dispose 回调
- 框架代管：根容器注册（`registerCustomBlockRoot`）、增删观察（自带 MutationObserver）、**激活时全量重渲染**（`activateCustomBlockPlugin(pluginName)`——天然解决 B2 的晚加载时序）、移除清理、事件隔离（编辑器事件不穿透）、渲染失败 fallback、`setContent` 回写数据
- 与懒加载/动态加载流程已打通（`onGet.ts` 中 `setCustomBlockRootReady` / `customBlockRender` 挂在渲染管线里）

**迁移建议**：块级公式从"劫持 NodeMathBlock"改为注册 custom block（如 `siyuan-typst-plugin/typst`），从 DOM hack 变成受支持 API；导出链路对 custom block 的支持也应一并评估。**诚实的限制**：官方机制目前只覆盖**块级**，行内公式（inline-math textmark）仍无官方扩展点——行内渲染要么继续 DOM hack（缩小攻击面：只依赖 `span[data-type='inline-math']` 结构），要么暂时退化为"块级为主、行内转 KaTeX"的混合策略。

### 5.4 最小可行路线图

```
P0（救活）：锁版本+自托管 wasm → onload 重排 → 初始扫描/document 观察器 → 占位守卫
P1（止血）：启动自检+明确报错 → 订阅 loaded-protyle-dynamic → ft__error 清理
P2（升级）：typst.ts 0.7/0.8 重打包 + CI 链接自检 + wasm 缓存
P3（归正）：块级迁移 NodeCustomBlock；行内评估官方 inline 机制或降级策略
```

---

## 附录

### A. 验证方法（可复现）

- **wasm ABI 比对**：从插件 `index.js` 正则提取胶水提供的 import key 集合（220 个）；对候选版本 wasm 执行 `new WebAssembly.Instance(new WebAssembly.Module(bytes), {wbg: Object.fromEntries(keys.map(k=>[k,()=>0]))})`——缺 key 即抛出与浏览器一字不差的 LinkError（含 `Import #N` 与符号名）。
- **端到端**：`docker run --network host mcr.microsoft.com/playwright:v1.48.0-noble`，先 `context.request.post(/api/system/loginAuth)` 取 cookie，再加载应用页；脚本遍历 DOM 统计块级/行内公式的 `data-render-typst`、shadowRoot、`.katex-error`，并截图目视复核。
- **源码比对**：`siyuan-note/siyuan` tag `v3.8.8` 的 `app/src/protyle/util/onGet.ts`（事件时序）与 `app/src/plugin/customBlockRender.ts`（官方扩展机制）。

### B. 关键文件位置（本机）

| 内容 | 路径 |
|---|---|
| 已打补丁的插件 | `/opt/siyuan/workspace/data/plugins/siyuan-typst-plugin/index.js`（113,786 B） |
| 原始备份 | 同目录 `index.js.bak-20261027` |
| 自托管 wasm | 同目录 `typst_ts_web_compiler_bg.wasm`（0.6.1-rc3，20.7MB）、`typst_ts_renderer_bg.wasm`（0.9MB） |
| 补丁脚本 | `/tmp/pw/patch4.py`（幂等：从备份重建＋三处改动） |
| 诊断脚本 | `/tmp/pw/diag2.js`（DOM 统计＋截图＋console 抓取） |

### C. 报告中每条结论的证据类型

| 结论 | 证据 |
|---|---|
| 链路 A（ABI 断裂） | Node 链接复现（与用户浏览器报错逐字一致）＋ 7 个版本 import 缺失数比对 |
| 链路 B（时序） | v3.8.8 源码执行顺序 ＋ 无头浏览器实测（0 节点、0 日志） |
| 链路 C1（占位 TypeError） | 浏览器 console 71 个 pageerror ＋ DOM 快照 |
| 链路 C2（行内双路径） | `.sy` 数据（2616 个 `TextMarkInlineMathContent`）＋ 修复前后行内渲染数对比 |
| 官方 custom block 机制存在 | v3.8.8 tag 源码 `app/src/plugin/customBlockRender.ts` 全文 |
| 未验证项（如实声明） | 移动端、导出行为细节、其他 SiYuan 版本区间 |
