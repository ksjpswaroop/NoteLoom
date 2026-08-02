#!/usr/bin/env python3
"""Exact whole-string Chinese→English replacement. Never substring-mangles."""
from __future__ import annotations

import re
import sys
from pathlib import Path

HAN = re.compile(r"[\u4e00-\u9fff]")

# Longest-first applied only as exact string-literal / JSX / attribute values.
EXACT: dict[str, str] = {
    "检测中": "checking",
    "可用": "available",
    "创建中": "creating",
    "不可用": "unavailable",
    "新对话": "New chat",
    "仅左": "Left only",
    "S3 下载失败": "S3 download failed",
    "WebDAV 下载失败": "WebDAV download failed",
    "S3 上传失败": "S3 upload failed",
    "WebDAV 上传失败": "WebDAV upload failed",
    "${platform} 上传失败": "${platform} upload failed",
    "WebDAV 未配置": "WebDAV not configured",
    "S3 未配置": "S3 not configured",
    "${charCount} 字 · ${lineCount} 行": "${charCount} chars · ${lineCount} lines",
    "空内容": "Empty content",
    "状态": "Status",
    "标题": "Title",
    "内容": "Content",
    "加载图片失败": "Failed to load image",
    "图片已保存": "Image saved",
    "裁切模式": "Crop mode",
    "无法加载图片": "Unable to load image",
    "加载中...": "Loading...",
    "保存成功": "Saved",
    "保存失败": "Save failed",
    "旋转": "Rotate",
    "水平翻转": "Flip horizontal",
    "垂直翻转": "Flip vertical",
    "向左旋转": "Rotate left",
    "向右旋转": "Rotate right",
    "放大": "Zoom in",
    "缩小": "Zoom out",
    "重置": "Reset",
    "保存": "Save",
    "取消": "Cancel",
    "确认": "Confirm",
    "裁剪": "Crop",
    "插入": "Insert",
    "Gitee 私人令牌": "Gitee private token",
    "网络连接不可用": "Network unavailable",
    "网络连接不可用，请检查网络设置": "Network unavailable. Check your network settings.",
    "创建超时": "Creation timed out",
    "检测超时": "Detection timed out",
    "Gitee 仓库检测超时，可能是网络问题": "Gitee repository check timed out; possible network issue",
    "Gitee 仓库创建超时，可能是网络问题": "Gitee repository creation timed out; possible network issue",
    "输入 LaTeX 公式，例如: \\frac{a}{b}": "Enter LaTeX, e.g. \\frac{a}{b}",
    "预览": "Preview",
    "常用公式示例:": "Common examples:",
    "分数:": "Fraction:",
    "上标:": "Superscript:",
    "下标:": "Subscript:",
    "平方根:": "Square root:",
    "求和:": "Sum:",
    "积分:": "Integral:",
    "极限:": "Limit:",
    "希腊字母:": "Greek letters:",
    "数学公式": "Math formula",
    "LaTeX 公式": "LaTeX formula",
    "插入公式": "Insert formula",
    "公式": "Formula",
    "在左侧插入列": "Insert column left",
    "在右侧插入列": "Insert column right",
    "在上方插入行": "Insert row above",
    "在下方插入行": "Insert row below",
    "左对齐": "Align left",
    "居中对齐": "Align center",
    "右对齐": "Align right",
    "删除行": "Delete row",
    "删除列": "Delete column",
    "删除表格": "Delete table",
    "插入表格": "Insert table",
    "文本格式": "Text formatting",
    "AI 处理": "AI tools",
    "AI 写作": "AI writing",
    "自定义 AI": "Custom AI",
    "更多写作工具": "More writing tools",
    "编辑图片地址": "Edit image URL",
    "编辑图片说明": "Edit image caption",
    "更多表格操作": "More table actions",
    "更多操作": "More actions",
    "插入或切换为二级标题": "Insert or switch to heading 2",
    "待办列表": "Task list",
    "从本地选择图片插入当前光标位置": "Insert a local image at the cursor",
    "粗体": "Bold",
    "斜体": "Italic",
    "高亮": "Highlight",
    "段落": "Paragraph",
    "一级标题": "Heading 1",
    "二级标题": "Heading 2",
    "三级标题": "Heading 3",
    "无序列表": "Bullet list",
    "有序列表": "Numbered list",
    "任务列表": "Task list",
    "引用": "Quote",
    "代码块": "Code block",
    "分割线": "Horizontal rule",
    "图片": "Image",
    "插入图片": "Insert image",
    "润色选中文本": "Polish selection",
    "精简选中文本": "Shorten selection",
    "扩写选中文本": "Expand selection",
    "续写": "Continue writing",
    "继续写": "Continue writing",
    "根据光标前后内容续写": "Continue writing from surrounding context",
    "在当前位置补充一个完整段落": "Add a full paragraph at the cursor",
    "总结全文": "Summarize document",
    "基于当前笔记生成摘要": "Generate a summary from this note",
    "输入自定义 AI 指令，例如：整理成会议纪要": "Enter a custom AI instruction, e.g. turn into meeting notes",
    "大纲": "Outline",
    "输入图片地址": "Enter image URL",
    "输入图片说明": "Enter image caption",
    "删除当前行": "Delete current row",
    "删除当前列": "Delete current column",
    "删除整个表格": "Delete entire table",
    "执行自定义指令": "Run custom instruction",
    "保存地址": "Save URL",
    "保存说明": "Save caption",
    "正文": "Body",
    "Mermaid 图表": "Mermaid chart",
    "生成章节": "Generate section",
    "表格对齐": "Table alignment",
    "插入内容": "Insert content",
    "搜索替换": "Find and replace",
    "块级公式": "Block formula",
    "行内公式": "Inline formula",
    "表格": "Table",
    "已复制为 ${format.toUpperCase()} 格式": "Copied as ${format.toUpperCase()}",
    "无法复制到剪贴板": "Unable to copy to clipboard",
    "纯文本": "Plain text",
    "复制": "Copy",
    "已复制": "Copied",
    "复制失败": "Copy failed",
    "复制成功": "Copied",
    "上一个 (Shift+Enter)": "Previous (Shift+Enter)",
    "下一个 (Enter)": "Next (Enter)",
    "替换为...": "Replace with...",
    "替换当前 (Enter)": "Replace current (Enter)",
    "替换全部 (Shift+Enter)": "Replace all (Shift+Enter)",
    "搜索和替换": "Find and replace",
    "关闭 (Esc)": "Close (Esc)",
    "搜索...": "Search...",
    "区分大小写": "Match case",
    "查找": "Find",
    "替换": "Replace",
    "全部替换": "Replace all",
    "全部": "All",
    "请检查网络连接后重试": "Check your network connection and try again",
    "获取远程更新失败": "Failed to fetch remote updates",
    "手动拉取远程文件": "Manually pull remote file",
    "处理冲突": "Resolve conflict",
    "拉取更新": "Pull updates",
    "有冲突": "Conflict",
    "有更新": "Update available",
    "拉取失败": "Pull failed",
    "拉取中...": "Pulling...",
    "无法加载提交历史": "Unable to load commit history",
    "[HistorySheet] GitLab 获取内容失败:": "[HistorySheet] GitLab failed to fetch content:",
    "[HistorySheet] Gitea 获取内容失败:": "[HistorySheet] Gitea failed to fetch content:",
    "已恢复": "Restored",
    "已从历史版本恢复文件": "File restored from history",
    "无法从历史版本恢复文件": "Unable to restore file from history",
    "在仓库中打开": "Open in repository",
    "恢复此版本": "Restore this version",
    "提交历史": "Commit history",
    "恢复中...": "Restoring...",
    "加载失败": "Failed to load",
    "恢复失败": "Restore failed",
    "历史记录": "History",
    "恢复": "Restore",
    "暂无提交记录": "No commits yet",
    "中文": "Chinese",
    "日本語": "Japanese",
}

COMMENT_EXACT = {
    "关联的 chat ID": "Related chat ID",
    "初始化 chats": "Initialize chats",
    "插入一条 chat": "Insert a chat",
    "更新一条 chat": "Update a chat",
    "保存一条 chat，用于动态 AI 回复结束后保存数据库": "Save a chat after streaming AI reply finishes",
    "删除一条 chat": "Delete a chat",
    "清空 chats（兼容旧代码）": "Clear chats (legacy)",
    "更新 inserted": "Update inserted",
    "更新会话标题": "Update conversation title",
    "开始新对话（保存当前会话后创建新会话）": "Start a new conversation after saving the current one",
    "如果是当前会话的第一条用户消息，用消息内容作为标题": "Use first user message as conversation title",
    "直接使用用户输入的前30个字符作为标题": "Use the first 30 characters of user input as the title",
    "不允许关闭最后一个面板": "Do not allow closing the last panel",
    '不允许关闭，否则会变成"仅左"状态': 'Do not allow closing; would become "left only"',
    "自定义类型，代替 OctokitResponse": "Custom type replacing OctokitResponse",
    "获取实际使用的仓库名称": "Get the repository name in use",
    "检查 Gitee 仓库状态（仅检查，不创建）": "Check Gitee repository status (check only)",
    "先清空之前的仓库信息": "Clear previous repository info",
    "手动创建仓库": "Manually create repository",
    "15秒超时": "15s timeout",
    "20秒超时": "20s timeout",
    "30 秒": "30s",
    "用户停止输入 10 秒后开始计时": "Start timer 10s after user stops typing",
    "使用 ref 中的最新值": "Use latest value from ref",
    "用户停止输入超过阈值时才检查": "Only check after idle threshold",
    "如果有缓存的远程内容，直接使用": "Use cached remote content when available",
    "如果没有缓存，重新拉取": "Pull again when cache is empty",
    "如果没有配置同步，不显示": "Hide when sync is not configured",
    "拉取中状态": "Pulling state",
    "冲突状态 - 提示用户处理": "Conflict state - prompt user",
    "有更新可以拉取": "Updates available to pull",
    "完整 SHA，用于恢复功能": "Full SHA for restore",
    "保存完整 SHA，用于恢复功能": "Persist full SHA for restore",
    "自动拉取": "Auto-pull",
    "Pull from remote (manual) - 使用缓存的远程内容": "Pull from remote (manual) - use cached remote content",
}


def translate_string_body(body: str) -> str:
    return EXACT.get(body, body)


def translate_file(path: Path, keep_han: bool = False) -> None:
    src = path.read_text(encoding="utf-8")
    out: list[str] = []
    i = 0
    n = len(src)

    while i < n:
        ch = src[i]

        # Line comment
        if src.startswith("//", i):
            j = src.find("\n", i)
            if j < 0:
                j = n
            comment = src[i:j]
            body = comment[2:]
            translated = False
            stripped = body.strip()
            if stripped in COMMENT_EXACT:
                prefix = body[: len(body) - len(body.lstrip())]
                comment = "//" + prefix + COMMENT_EXACT[stripped]
                translated = True
            elif HAN.search(body) and not keep_han:
                for zh, en in sorted(COMMENT_EXACT.items(), key=lambda kv: -len(kv[0])):
                    if zh in body:
                        body = body.replace(zh, en)
                body = HAN.sub("", body)
                body = re.sub(r"[ \t]{2,}", " ", body).rstrip()
                comment = "//" + body if body.strip() else "//"
                translated = True
            out.append(comment if translated else comment)
            i = j
            continue

        # Block comment
        if src.startswith("/*", i):
            j = src.find("*/", i + 2)
            if j < 0:
                out.append(src[i:])
                break
            block = src[i : j + 2]
            inner = block[2:-2]
            if HAN.search(inner) and not keep_han:
                for zh, en in sorted({**COMMENT_EXACT, **EXACT}.items(), key=lambda kv: -len(kv[0])):
                    if zh in inner:
                        inner = inner.replace(zh, en)
                inner = HAN.sub("", inner)
                block = "/*" + inner + "*/" if inner.strip() else ""
            out.append(block)
            i = j + 2
            continue

        # String / template literal
        if ch in "'\"`":
            quote = ch
            j = i + 1
            body_chars: list[str] = []
            while j < n:
                c = src[j]
                if c == "\\" and j + 1 < n:
                    body_chars.append(c)
                    body_chars.append(src[j + 1])
                    j += 2
                    continue
                if c == quote:
                    break
                # template ${} — keep scanning; still treat whole body as candidate for exact map
                body_chars.append(c)
                j += 1
            else:
                out.append(src[i:])
                break
            body = "".join(body_chars)
            new_body = body if keep_han else translate_string_body(body)
            out.append(quote + new_body + quote)
            i = j + 1
            continue

        out.append(ch)
        i += 1

    text = "".join(out)

    # JSX attribute exact values
    def repl_attr(m: re.Match[str]) -> str:
        attr, q, body = m.group(1), m.group(2), m.group(3)
        if body in EXACT:
            return f"{attr}={q}{EXACT[body]}{q}"
        return m.group(0)

    text = re.sub(
        r"(title|label|placeholder|aria-label|tooltipText|description)=(['\"])([^'\"]*)\2",
        repl_attr,
        text,
    )

    # JSX text nodes (single-line)
    def repl_jsx(m: re.Match[str]) -> str:
        inner = m.group(1)
        stripped = inner.strip()
        if stripped in EXACT:
            return ">" + inner.replace(stripped, EXACT[stripped], 1) + "<"
        return m.group(0)

    text = re.sub(r">([^<>{}\n]*[\u4e00-\u9fff][^<>{}\n]*)<", repl_jsx, text)

    path.write_text(text, encoding="utf-8")


def main() -> None:
    files = [
        "src/lib/sync/remote-library.ts",
        "src/stores/chat.ts",
        "src/stores/sidebar.ts",
        "src/app/core/main/mark/mark-detail-panel.tsx",
        "src/app/core/main/editor/image/image-editor.tsx",
        "src/app/core/setting/sync/gitee-sync.tsx",
        "src/app/core/main/editor/markdown/math-editor-dialog.tsx",
        "src/app/core/main/editor/markdown/table-toolbar.tsx",
        "src/app/core/main/editor/markdown/mobile-editor-more-sheet.tsx",
        "src/app/core/main/editor/markdown/footer-bar/copy-button.tsx",
        "src/app/core/main/editor/markdown/floating-table-menu.tsx",
        "src/app/core/main/editor/markdown/search-replace-panel.tsx",
        "src/app/core/main/editor/markdown/sync/pull-button.tsx",
        "src/app/core/main/editor/markdown/sync/history-sheet.tsx",
        "src/app/core/main/chat/message-control/translate-control.tsx",
        "src/lib/sync/github.types.ts",
    ]
    for f in files:
        translate_file(Path(f), keep_han=False)
        left = [(i, l) for i, l in enumerate(Path(f).read_text().splitlines(), 1) if HAN.search(l)]
        print(f"{len(left):3d} {f}")
        for i, l in left[:6]:
            print(f"    {i}:{l.strip()[:120]}")


if __name__ == "__main__":
    main()
