# SiYuan Typst Plugin

[English](./README.md)


为思源笔记添加 Typst 支持，支持在笔记中使用 Typst 语法。

**该项目高度实验性，依赖于思源笔记的 DOM 结构而非稳定 API，可能存在兼容性问题。在思源笔记官方的 Custom Inline Element 功能实现前，可能并没有更好的实现方案。请自行斟酌使用风险。**

## 0.1.0 更新（本 fork）

- **文档级 Typst 开关**：给文档加自定义属性 **`custom-typstmath`**（值 `1`）——
  打开「文档属性」→「自定义属性」添加即可，该文档内**所有**公式（块级/行内，无需 `\t` 前缀）
  都由 Typst 渲染；属性不可见、不影响正文、导出不带残留。删除属性即恢复 KaTeX。
  （兼容旧方式：正文头部写 `<!-- typst-math -->`，但会留下一个可见的 HTML 块，不推荐）
- **KaTeX 零开销模式**：配合 [siyuan-patch](https://github.com/LeonhardtHUST/siyuan-patch) 的
  `math-renderer-registry` 补丁，Typst 在 KaTeX 之前认领公式——KaTeX 的 CSS/JS **完全不会加载**，
  一次渲染、无二次冗余（官方思源上自动降级为原有 DOM 接管，行为不变）。
- **公式内中文**：自托管全量 NotoSerifCJKsc（cmap 42246 码点），
  `"Def. 4.3.1 (酉内积与酉空间)"` 这类中文标签不再出现豆腐块。
- **导出**：导出 HTML 会把公式烘焙为内联 SVG（产物自包含）；PDF 用浏览器打印即包含 Typst 矢量公式。
- **已知限制**：`typst-math` 文档中 LaTeX 语法公式会显示编译错误（设计如此）；
  导出 HTML 体积随公式数量增长（内联 SVG）；桌面版 PDF 导出的预览选项变更回退为原始行为。

## 使用

使用正常的数学公式块，将 Typst 内容包裹在 `\t{typst content}` 中，例如：

```
Some inline $\t{"typst content" a + b / c}$, and some display block:

$$ \t{
mat(a,b,c;d,e,f;) + mat(1,2,3;4,5,6) \
integral _1 ^n 1 / x "d" x  = ln n
} $$
```

效果如下：

![Showcase](https://cdn.jsdelivr.net/gh/clouder0/siyuan-typst-plugin/asset/typst_showcase.png)

你的内容不局限于数学环境。你可以使用 `\traw{raw typst content}` 来编写任何 Typst 代码。

例如：

```
\traw{
#let my_math = $ cases(
(a + (sqrt(c/(1 + b) + x))/(c + d + 1 + f) = 2)/(d) \
(a + (sqrt(c/(1 + b) + x))/(c + d + 1 + f) = 2)/(d)) $

#show math.frac: f => math.display(f)

#my_math
}
```

函数、变量或任何你喜欢的东西！

该功能主要为块级数学公式设计，虽然也能用于行内数学公式，但可能会出现对齐问题。

## Current Limitations

- 导出/预览等各种渲染显示场景未适配。
- 导入 Typst 包的功能尚未经过测试，可能无法正常工作。

## Caveats

Typst 为行内公式使用 Inline Style，复杂的公式会显得太小。

你可以使用 `display()` 来渲染复杂公式。

例如：

```
Some sum $\t{sum _(i=0) ^n 1  / i}$ and display sum $\t{display(sum _(i=0) ^n 1  / i)}$, and matrix $\t{display(mat(1,2,3;4,5,6))}$
```

Versus KaTeX:

```
Some sum $\sum _{i=0} ^n \frac{1}{i}$ and display sum $\displaystyle \sum _{i=0}^n \frac{1}{i}$, and matrix $\begin{pmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{pmatrix}$and display matrix $\displaystyle \begin{pmatrix} 1 & 2 & 3 \\ 4 & 5 & 6 \end{pmatrix}$
```

![Display Style Showcase](https://cdn.jsdelivr.net/gh/clouder0/siyuan-typst-plugin/asset/display-style.png)
