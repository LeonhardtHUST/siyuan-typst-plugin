# Obsidian Markdown → SiYuan 转换管线

用于把 Obsidian 笔记（Typst 语法的 Markdown）正确转换为 SiYuan 文档，规避 Lute 的两个陷阱。

## 背景：为什么需要这套管线

原始笔记里 `$$` **紧贴正文**（如 `...：$$\n公式\n$$ 该划分将区间...`）。Obsidian 能容忍这种写法，
但 **Lute（SiYuan 的 Markdown 解析器）会错位配对**：

```
text：$$
formula1
$$ text2
$$
formula2
$$
```

第一个 `$$` 与第二个 `$$` 配对 → formula1 正确；但第三个 `$$` 又与第四个配对 →
**text2 被当成公式内容**，产生大量「散文公式块」（实测 389/529）。这就是 2026-10-27 之前
"公式块里塞着大段正文"的根因。

## 管线步骤

1. `build-import.py`：对源 md 做四项处理
   - `$$$` → `$$`（源文件笔误）
   - 符号映射：`chevron.l/r` → `angle.l/r`、`varnothing` → `nothing`、`\cal(` → `cal(`
   - 数学环境内未加引号的中文 → 加引号
   - **`$$` 规范化到独立行 + 前后空行**（关键修复）
   - 注入文档级标记 `<!-- typst-math -->`（无需逐公式包 `\t{}`）
2. `check-formulas.mjs`：用插件同款 typst.ts 0.6.1-rc3 + 全量字体，逐个编译全部公式，
   要求 100% 通过后再导入
3. 通过内核 API 导入（注意路径限制，见下）：
   ```
   POST /api/import/importStdMd
   {"notebook": "...", "localPath": "/siyuan/workspace/temp/export/import-in/x.md", "toPath": "", "skipRoot": false}
   ```

## 内核导入的路径限制（踩坑记录）

`importStdMd` 要求 `localPath` 是**容器内**可读路径，且：
- 不能位于 app 目录（`/opt/siyuan`）→ 工作区 `/siyuan/workspace` 可以
- 不能位于敏感前缀（`/tmp` `/mnt` `/opt` `/etc` `/root` `/var` `/usr` `/srv` …）
- 工作区内 `conf/` 与 `temp/`（除 `temp/export/`）也被禁

→ 唯一稳妥落点：**`/siyuan/workspace/temp/export/<dir>/`**

## 验收基线（2026-10-27）

| 文档 | 块级公式 | 行内公式 | 散文公式块 | 编译通过 |
|---|---|---|---|---|
| 傅里叶…（合并稿） | 529 | 2608 | 0 | 3208/3208 |
| 线性常微分方程基础 | 240 | 657 | 0 | 897/897 |
