/*
 * Copyright (c) 2024 by frostime. All Rights Reserved.
 * @Author       : frostime
 * @Date         : 2024-06-12 19:48:53
 * @FilePath     : /src/index.ts
 * @LastEditTime : 2024-07-12 18:25:44
 * @Description  :
 */
import { Plugin } from "siyuan";
import SimpleHash from "./hash";
import {
  createTypstCompiler,
  TypstCompiler,
} from "@myriaddreamin/typst.ts/dist/esm/compiler.mjs";
import {
  createTypstRenderer,
  TypstRenderer,
} from "@myriaddreamin/typst.ts/dist/esm/renderer.mjs";
import { preloadFontAssets } from "@myriaddreamin/typst.ts/dist/esm/options.init.mjs";
import QuickLRU from "quick-lru";

export default class TypstPlugin extends Plugin {
  async onload() {
    const decode = (encodedString: string) => {
      return encodedString
        .replace(/&quot;/g, '"')
        .replace(/&apos;/g, "'")
        .replace(/&lt;/g, "<")
        .replace(/&gt;/g, ">")
        .replace(/&amp;/g, "&");
    };

    const randstr = (prefix?: string) => {
      return Math.random()
        .toString(36)
        .replace("0.", prefix || "");
    };

    // 显式字体栈 + math.text 规则：公式内中文渲染的两个必要条件。
    // 1) 字体集需随插件加载（见 init_context 的 preloadFontAssets），且需用全量
    //    NotoSerifCJKsc（typst-dev-assets 的子集缺"酉"等非高频字）。
    // 2) 数学模式内的引号文本（如 "Def. 4.3.1 (酉空间与酉变换)"）是单个 run：
    //    以拉丁字符开头时整串会选中拉丁字体、不做逐字回退，中文渲染为豆腐块。
    //    `#show math.text: set text(font: ...)` 把字体栈下推到该元素，中文才会落到 Noto。
    //    纯 CJK 开头的 run 走默认回退本就能正确选中 Noto，因此这两条互补。
    // 块级与行内两个渲染函数共用，须定义在公共作用域。
    const cjkTextRule = `#set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))
#show math.text: set text(font: ("Libertinus Serif", "Noto Serif CJK SC"))`;

    const lru_cache = new QuickLRU<string, string>({ maxSize: 1024 });

    let context = {
      compiler: createTypstCompiler(),
      renderer: createTypstRenderer(),
    };

    const init_context = async ({ compiler, renderer }) => {
      await Promise.all([
        compiler.init({
          // 胶水 JS（打包进本插件）与 wasm 必须来自同一次 typst.ts 构建（0.6.1-rc3），
          // wasm-bindgen 符号按构建变化，跨版本会产生 LinkError。
          // wasm 与 CJK 字体由 scripts/fetch-assets.mjs 自托管到插件目录，不依赖 CDN。
          getModule: () => `/plugins/${this.name}/wasm/typst_ts_web_compiler_bg.wasm`,
          // 原实现不传参数，不加载任何远程字体：公式内引用的中文（如 "Def. 4.3.1 (酉空间)"）
          // 因编译器缺 CJK 字体渲染为豆腐块。必须同时加载 text 与 cjk 两集：
          // 加载字体集会替换编译器默认字体，只装 cjk（无数学字体）会令全部公式
          // 报 "current font does not support math" 并产出空文档。
          beforeBuild: [
            preloadFontAssets({
              assets: ["text", "cjk"],
              assetUrlPrefix: `/plugins/${this.name}/fonts/`,
            }),
          ],
        }),
        renderer.init({
          getModule: () => `/plugins/${this.name}/wasm/typst_ts_renderer_bg.wasm`,
        }),
      ]);
    };
    let _backup_context: {
      compiler: TypstCompiler;
      renderer: TypstRenderer;
    } = {
      compiler: createTypstCompiler(),
      renderer: createTypstRenderer(),
    };
    // 修复链路 B2：初始化转为后台任务，onload 不再被 wasm 加载阻塞。
    // 否则事件监听注册晚于"启动时恢复页签"派发的 loaded-protyle-static，监听器永远错过。
    // 渲染函数内部 await wasmReady 排队，就绪后统一放行。
    const wasmReady: Promise<void> = (async () => {
      await init_context(_backup_context);
      await init_context(context);
    })();
    const get_backup_context = async () => {
      const res = {
        compiler: _backup_context.compiler,
        renderer: _backup_context.renderer,
      };
      _backup_context.compiler = createTypstCompiler();
      _backup_context.renderer = createTypstRenderer();
      await init_context(_backup_context);
      return res;
    };
    const protyle_observer_map = new Map<object, MutationObserver>();
    let current_parsed = 0;
    const render_block_once = async (element: HTMLElement) => {
      await wasmReady;
      // console.log("block", element);
      const raw_content = element.getAttribute("data-content");
      const is_raw_typst =
        raw_content.startsWith("\\traw{") && raw_content.endsWith("}");
      const is_math_typst =
        raw_content.startsWith("\\t{") && raw_content.endsWith("}");
      const is_typst = is_raw_typst || is_math_typst;
      if (!is_typst) {
        if (element.getAttribute("data-render-typst") !== null) {
          // remove previous typst content
          element.removeAttribute("data-render-typst");
          element.firstElementChild.innerHTML = "";
        }
        return;
      }
      const typst_content = is_raw_typst
        ? decode(raw_content.slice(6, -1))
        : decode(raw_content.slice(3, -1));
      const content_hash = SimpleHash.djb2(typst_content)
        .toString()
        .slice(0, 16);
      // 修复链路 C1：思源插入公式块时先放 <div spin="1"></div> 空占位，KaTeX 内容后填。
      // 此时 firstElementChild.firstElementChild 为 null，跳过即可；
      // 思源回填内容后，观察器的 normal_first_block 分支会重新触发本函数。
      if (!element.firstElementChild?.firstElementChild) {
        return;
      }
      const first_time =
        element.firstElementChild.firstElementChild?.shadowRoot === null;
      if (
        !first_time &&
        element.getAttribute("data-render-typst") === content_hash
      )
        return;
      element.setAttribute("data-render-typst", content_hash);
      if (first_time) {
        const container = document.createElement("div");
        element.firstElementChild.replaceChildren(container);
        container.attachShadow({
          mode: "open",
        });
      }
      const shadowRoot = element.firstElementChild.firstElementChild.shadowRoot;
      if (lru_cache.has(content_hash)) {
        shadowRoot.innerHTML = lru_cache.get(content_hash);
        return;
      }

      const displayMathTemplate = is_raw_typst
        ? `
#set page(height: auto, width: auto, margin: 0pt)
#set text(size: 13pt)

${typst_content}
`
        : `
#set page(height: auto, width: auto, margin: 0pt)
#set text(size: 13pt)
${cjkTextRule}

$ ${typst_content} $
`;
      const dest = `/tmp/${randstr()}.typ`;
      current_parsed += 1;
      if (current_parsed >= 100) {
        // console.log("Switch to backup compiler!");
        current_parsed = 0;
        const backup = await get_backup_context();
        context.compiler = backup.compiler;
        context.renderer = backup.renderer;
      }
      const compiler = context.compiler;
      const renderer = context.renderer;
      compiler.addSource(dest, displayMathTemplate);
      const result = await compiler.compile({
        mainFilePath: dest,
        diagnostics: "full",
      });
      if (result.diagnostics) {
        // render error! show it directly
        const error_string = Array.from(result.diagnostics.values())
          .map(
            (error) =>
              `[${error.severity}]<${error.package}, ${error.path}, ${error.range}>: ${error.message}`,
          )
          .join("\n");
        shadowRoot.innerHTML = `<div style="color: red;">${error_string}</div>`;
      }
      const vec = result.result!;
      const svg = await renderer.runWithSession(async (session) => {
        renderer.manipulateData({
          renderSession: session,
          action: "reset",
          data: vec,
        });
        const svg = await renderer.renderSvg({
          renderSession: session,
        });
        return svg;
      });
      compiler.unmapShadow(dest);
      shadowRoot.innerHTML = svg;
      element.firstElementChild.setAttribute("class", "katex-display");
      const svgElem = shadowRoot.firstElementChild;
      const width = Number.parseFloat(svgElem.getAttribute("data-width"));
      const height = Number.parseFloat(svgElem.getAttribute("data-height"));
      const defaultEm = 11;
      svgElem.firstElementChild.innerHTML =
        `path {fill: var(--b3-graph-doc-point); stroke: var(--b3-graph-doc-point);}` +
        svgElem.firstElementChild.innerHTML
          .replace("var(--glyph_fill)", "var(--b3-graph-doc-point)")
          .replace("var(--glyph_stroke)", "var(--b3-graph-doc-point)");
      svgElem.setAttribute("width", `${width / defaultEm}em`);
      // svgElem.setAttribute("style", "; display: block; margin: 0 auto;");
      svgElem.setAttribute("style", "margin: 0 auto;display:block;");
      svgElem.setAttribute("height", `${height / defaultEm}em`);
      lru_cache.set(content_hash, shadowRoot.innerHTML);
    };
    const render_inline_once = async (element: HTMLElement) => {
      await wasmReady;
      // console.log("inline", element);
      const raw_content = element.getAttribute("data-content");
      const is_raw_typst =
        raw_content.startsWith("\\traw{") && raw_content.endsWith("}");
      const is_math_typst =
        raw_content.startsWith("\\t{") && raw_content.endsWith("}");
      const is_typst = is_raw_typst || is_math_typst;
      if (!is_typst) {
        if (element.getAttribute("data-render-typst") !== null) {
          // clear previous typst content
          element.removeAttribute("data-render-typst");
          // remove shadow root
          element.removeChild(element.firstElementChild);
        }
        return;
      }
      const typst_content = is_raw_typst
        ? decode(raw_content.slice(6, -1))
        : decode(raw_content.slice(3, -1));
      const content_hash = SimpleHash.djb2(typst_content)
        .toString()
        .slice(0, 16);
      const first_time = !element.firstElementChild?.shadowRoot; // on paste, hash doesn't change but shadow root won't be copied, so re-render
      if (
        !first_time &&
        element.getAttribute("data-render-typst") === content_hash
      )
        return;
      element.setAttribute("data-render-typst", content_hash);
      // 修复链路 C3：思源在 KaTeX 解析失败时给行内公式打上 ft__error（红色样式）。
      // 此处是所有成功渲染路径（含 LRU 缓存命中）的公共位置，统一移除，避免残留错误外观。
      element.classList.remove("ft__error");
      if (first_time) {
        const container = document.createElement("span");
        container.setAttribute("class", "typst-display");
        element.replaceChildren(container);
        container.attachShadow({ mode: "open" });
      }
      const shadowRoot = element.firstElementChild.shadowRoot;
      if (lru_cache.has(content_hash)) {
        shadowRoot.innerHTML = lru_cache.get(content_hash);
        return;
      }
      const inlineRawTemplate = `
#set page(height: auto, width: auto, margin: 0pt)
#set text(size: 13pt)

${typst_content}
`;
      const inlineMathTemplate = `
#set page(height: auto, width: auto, margin: 0pt)
#set text(size: 13pt)
${cjkTextRule}

#let s = state("t", (:))

#let pin(t) = context {
let width = measure(line(length: here().position().y)).width
s.update(it => it.insert(t, width) + it)
}

#show math.equation: it => {
box(it, inset: (top: 0.5em, bottom: 0.5em))
}

$pin("l1")${typst_content}$

#context [
#metadata(s.final().at("l1")) <label>
]
        `;
      const template = is_raw_typst ? inlineRawTemplate : inlineMathTemplate;
      const dest = `/tmp/${randstr()}.typ`;
      current_parsed += 1;
      if (current_parsed >= 100) {
        console.log("Switch to backup compiler!");
        current_parsed = 0;
        const backup = await get_backup_context();
        context.compiler = backup.compiler;
        context.renderer = backup.renderer;
      }
      const compiler = context.compiler;
      const renderer = context.renderer;
      compiler.addSource(dest, template);
      const result = await compiler.compile({
        mainFilePath: dest,
        diagnostics: "full",
      });
      if (result.diagnostics) {
        // render error! show it directly
        const error_string = Array.from(result.diagnostics.values())
          .map(
            (error) =>
              `[${error.severity}]<${error.package}, ${error.path}, ${error.range}>: ${error.message}`,
          )
          .join("\n");
        shadowRoot.innerHTML = `<div style="color: red;">${error_string}</div>`;
        lru_cache.set(content_hash, shadowRoot.innerHTML);
        return;
      }
      const vec = result.result!;
      const svg = await renderer.runWithSession(async (session) => {
        renderer.manipulateData({
          renderSession: session,
          action: "reset",
          data: vec,
        });
        const svg = await renderer.renderSvg({
          renderSession: session,
        });
        return svg;
      });
      shadowRoot.innerHTML = svg;
      const svgElem = shadowRoot.firstElementChild;
      const width = Number.parseFloat(svgElem.getAttribute("data-width"));
      const height = Number.parseFloat(svgElem.getAttribute("data-height"));
      const defaultEm = 11;
      svgElem.firstElementChild.innerHTML =
        `path {fill: var(--b3-graph-doc-point); stroke: var(--b3-graph-doc-point);}` +
        svgElem.firstElementChild.innerHTML
          .replace("var(--glyph_fill)", "var(--b3-graph-doc-point)")
          .replace("var(--glyph_stroke)", "var(--b3-graph-doc-point)");

      if (is_raw_typst) {
        svgElem.setAttribute("width", `${width / defaultEm}em`);
        svgElem.setAttribute("height", `${height / defaultEm}em`);
      } else {
        const query = await compiler.query({
          selector: "<label>",
          mainFilePath: dest,
        });
        // parse baselinePosition from query ignore last 2 chars
        const baselinePosition = parseFloat(query[0].value.slice(0, -2));
        const shift = height - baselinePosition;
        const shiftEm = shift / defaultEm;
        svgElem.setAttribute("style", `vertical-align: -${shiftEm}em;`);
        svgElem.setAttribute("width", `${width / defaultEm}em`);
        svgElem.setAttribute("height", `${height / defaultEm}em`);
      }
      compiler.unmapShadow(dest);
      lru_cache.set(content_hash, shadowRoot.innerHTML);
    };
    // 修复链路 B1：v3.8.8 的 setHTML 先将内容写入 DOM，之后才派发 loaded-protyle-static，
    // 只靠事后 MutationObserver 永远收不到初始内容的"新增节点"记录，必须主动扫描存量节点。
    const inline_selector =
      "span[data-type='inline-math'][data-content^='\\\\t'][data-content$='}']";
    const block_selector =
      "div.render-node[data-type='NodeMathBlock'][data-content^='\\\\t'][data-content$='}']";

    const scan_element = (root: ParentNode) => {
      if (!root || typeof (root as Element).querySelectorAll !== "function") {
        return;
      }
      const inline = Array.from(
        root.querySelectorAll<HTMLElement>(inline_selector),
      );
      const block = Array.from(
        root.querySelectorAll<HTMLElement>(block_selector),
      );
      const root_elem = root as Element;
      if (root_elem.matches && root_elem.matches(block_selector)) {
        block.push(root_elem as HTMLElement);
      }
      if (inline.length + block.length === 0) {
        return;
      }
      Promise.allSettled(
        inline
          .map(render_inline_once)
          .concat(block.map(render_block_once)),
      ).then((results) => {
        results
          .filter((r) => r.status === "rejected")
          .forEach((r) => {
            console.warn("[typst] scan render rejected:", (r as PromiseRejectedResult).reason);
          });
      });
    };

    const process_mutations = (mutations: MutationRecord[]) => {
      // console.log("Observed mutations:", mutations.length);
      // console.log(mutations);
      const mut_elems = mutations.filter(
        (m) => m.target.nodeType === Node.ELEMENT_NODE,
      );
      // paste operation
      const added_elems = mut_elems
        .filter((m) =>
          (m.target as HTMLElement).classList.contains("protyle-wysiwyg"),
        )
        .map((m) => Array.from(m.addedNodes.values()))
        .flat()
        .filter((n) => n.nodeType === Node.ELEMENT_NODE)
        .map((n) => n as HTMLElement);
      const added_inline_elems = added_elems
        .map((e) =>
          Array.from(
            e.querySelectorAll<HTMLElement>(inline_selector).values(),
          ),
        )
        .flat() as HTMLElement[];

      const added_block_elems = added_elems
        .map((e) =>
          Array.from(e.querySelectorAll<HTMLElement>(block_selector).values()).concat(
            e.matches(block_selector) ? [e] : [],
          ),
        )
        .flat() as HTMLElement[];
      const elements = Array.from(
        new Set(
          mutations
            .filter(
              (mutation) =>
                mutation.type === "childList" &&
                mutation.target.nodeType === Node.ELEMENT_NODE,
            )
            .map((mutation) => mutation.target as HTMLElement),
        ),
      );
      const normal_inline = elements.filter(
        (elem) => elem.getAttribute("data-type") === "inline-math",
      );
      const normal_first_block = elements
        .filter((element) => element.parentElement !== null)
        .map((element) => element.parentElement)
        .filter(
          (element) => element.getAttribute("data-type") === "NodeMathBlock",
        );
      const normal_second_block = elements
        .filter((element) => element.parentElement !== null)
        .filter((element) => element.parentElement.parentElement !== null)
        .map((element) => element.parentElement.parentElement)
        .filter(
          (element) => element.getAttribute("data-type") === "NodeMathBlock",
        );
      const attribute_changed_elems = mutations
        .filter((m) => m.type === "attributes")
        .map((m) => m.target as HTMLElement);
      const final_inline = new Set(
        normal_inline
          .concat(added_inline_elems)
          .concat(
            attribute_changed_elems.filter(
              (elem) => elem.getAttribute("data-type") === "inline-math",
            ),
          ),
      );
      const final_block = new Set(
        normal_first_block
          .concat(normal_second_block)
          .concat(added_block_elems)
          .concat(
            attribute_changed_elems.filter(
              (elem) => elem.getAttribute("data-type") === "NodeMathBlock",
            ),
          ),
      );
      Promise.allSettled(
        Array.from(final_inline)
          .map(render_inline_once)
          .concat(Array.from(final_block).map(render_block_once)),
      )
        .then((results) => {
          Array.from(results)
            .filter((result) => result.status === "rejected")
            .forEach((result) => {
              console.log("Rejected!", result.reason);
            });
        })
        .catch((e) => {
          console.log("Error allSettled", e);
        });
    };

    const attach_observer = (p: any) => {
      if (!p?.contentElement || protyle_observer_map.has(p)) {
        return;
      }
      const observer = new MutationObserver(process_mutations);
      observer.observe(p.contentElement, {
        childList: true,
        subtree: true,
        attributes: true,
        attributeFilter: ["data-content"],
      });
      protyle_observer_map.set(p, observer);
    };

    this.eventBus.on("loaded-protyle-static", (event) => {
      const p = event.detail.protyle;
      attach_observer(p);
      // 存量扫描：事件派发时内容已在 DOM 中
      scan_element(p.wysiwyg?.element ?? p.contentElement);
    });

    // 滚动懒加载（CB_GET_APPEND / CB_GET_BEFORE）走该事件，动态内容同样需要扫描
    this.eventBus.on("loaded-protyle-dynamic", (event: any) => {
      const p = event.detail?.protyle;
      if (p?.wysiwyg?.element) {
        scan_element(p.wysiwyg.element);
      }
    });

    // 兜底：启动时恢复的页签，其 loaded-protyle-static 在插件就绪前已派发（链路 B2），
    // 用户切入页签时补挂观察器并扫描
    this.eventBus.on("switch-protyle", (event: any) => {
      const p = event.detail?.protyle;
      if (!p) {
        return;
      }
      attach_observer(p);
      scan_element(p.wysiwyg?.element ?? p.contentElement);
    });

    this.eventBus.on("destroy-protyle", (event) => {
      const p = event.detail.protyle;
      const observer = protyle_observer_map.get(p);
      if (observer) {
        observer.disconnect();
        protyle_observer_map.delete(p);
        // console.log("observer disconnected");
      }
      // console.log(`Destroy Protyle. id: ${p.id}, block id: ${p.block.id}`);
    });

    // 全局兜底扫描：覆盖所有"事件早于插件就绪"的已打开文档
    wasmReady
      .then(() => {
        scan_element(document.body);
        // 思源懒渲染回填占位节点需要时间，稍后复扫一次
        setTimeout(() => scan_element(document.body), 1500);
      })
      .catch((e) => {
        console.error("[typst] wasm init failed:", e);
      });
  }
}
