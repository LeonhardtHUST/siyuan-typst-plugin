#!/usr/bin/env python3
"""Obsidian md → SiYuan 导入文件 的完整转换管线
修复项：
  1) $$$/$$ 紧贴文字 → 规范化到独立行（Lute 配对错位的根因）
  2) Typst 符号映射：chevron.l/r → angle.l/r、varnothing → nothing、\\cal( → cal(
  3) 数学环境内的中文加引号
  4) 折叠多余空行 + 注入文档级标记 <!-- typst-math -->
"""
import io, re, sys

V = "D:/Personal/SyncFolder/文档/Obsidian Vault"
JOBS = [
    ("傅里叶空间引入：从函数集合到傅里叶展开（合并稿）.md", "out-merge.md"),
    ("线性常微分方程基础.md", "out-ode.md"),
]
MARK = "<!-- typst-math -->\n\n"

def fix_triple(s: str) -> str:
    # 三连美元（源文件笔误）→ 双美元
    while "$$$" in s:
        s = s.replace("$$$", "$$")
    return s

def symbol_fixes(s: str) -> str:
    s = s.replace("chevron.l", "angle.l").replace("chevron.r", "angle.r")
    s = s.replace("varnothing", "nothing")
    s = s.replace("\\cal(", "cal(")
    s = s.replace('sum(已读出的 g_n)', 'sum("已读出的" g_n)')
    s = s.replace('sum(已叠入的 g_n)', 'sum("已叠入的" g_n)')
    return s

def normalize_display(s: str) -> str:
    def once(x):
        x = re.sub(r"(?<=\S)[ \t]*\$\$", "\n\n$$", x)
        x = re.sub(r"\$\$[ \t]*(?=\S)", "$$\n\n", x)
        x = re.sub(r"\n[ \t]*\$\$[ \t]*\n", "\n\n$$\n\n", x)
        return x
    for _ in range(5):
        y = once(s)
        if y == s:
            break
        s = y
    s = re.sub(r"\n{3,}", "\n\n", s)
    return re.sub(r"^\n+", "", s)

for name, out in JOBS:
    s = io.open(f"{V}/{name}", encoding="utf-8").read()
    s = fix_triple(s)
    s = symbol_fixes(s)
    s = normalize_display(s)
    if not s.startswith("<!-- typst-math -->"):
        s = MARK + s
    io.open(out, "w", encoding="utf-8", newline="\n").write(s)
    lines = len(re.findall(r"^\$\$$", s, re.M))
    print(f"{out}: {len(s)} 字符 | 独立 $$ {lines} (偶数={lines % 2 == 0}) | 残留行内 $$ {len(re.findall(r'[^\n]\$\$|\$\$[^\n]', s))}")
