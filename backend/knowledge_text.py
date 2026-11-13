"""Chinese lexical retrieval preprocessing and bounded, local text extraction.

Search and indexing share the same tokenizer. Documents are data, never commands.
PDF page labels survive chunking; pasted/text-file sources use paragraph labels.
"""
from __future__ import annotations

from io import BytesIO
import logging
from pathlib import Path
import re
import unicodedata

from fastapi import HTTPException
import jieba
from pypdf import PdfReader

MAX_CHARS = 120_000
MAX_UPLOAD = 5 * 1024 * 1024
STOPWORDS = set("的 了 和 是 在 与 为 及 或 请 帮 我 我们 根据 基于 生成 整理 一个 一份 这款 这些 这个 关于 如何 有 哪些 什么 可以 资料 内容 文案 脚本 回答 问题 使用 进行 需要 已 它 你 并 将 把 来 吗 吧".split())
TOKENIZER = jieba.Tokenizer()
jieba.setLogLevel(logging.WARNING)
for word in ("医美", "到店", "预约", "到店率", "超声炮", "热玛吉", "水光", "直播间", "货盘", "投流", "保温杯", "SKU", "优惠券", "售后", "退换货", "知情同意"):
    TOKENIZER.add_word(word, freq=10000)


def terms(text: str) -> list[str]:
    normalized = unicodedata.normalize("NFKC", text).lower()
    tokens = TOKENIZER.cut_for_search(normalized, HMM=False)
    return list(dict.fromkeys(t for t in tokens if t not in STOPWORDS and re.fullmatch(r"[a-z0-9\u3400-\u9fff]+", t) and (len(t) > 1 or t.isdigit())))


def indexed(text: str) -> str:
    # Keep term frequency in the index; query terms are unique.
    normalized = unicodedata.normalize("NFKC", text).lower()
    return " ".join(t for t in TOKENIZER.cut_for_search(normalized, HMM=False) if t not in STOPWORDS and re.fullmatch(r"[a-z0-9\u3400-\u9fff]+", t))


def split_pages(pages: list[dict]) -> list[dict]:
    result = []
    for page in pages:
        paragraphs = re.split(r"\n\s*\n", page["text"].strip())
        for paragraph, text in enumerate(paragraphs, 1):
            # Bounded chunks keep full text, including short headings and final tails.
            for offset in range(0, len(text), 600):
                value = text[offset:offset + 600].strip()
                if not value:
                    continue
                locator = f"第 {page['page']} 页 · 段落 {paragraph}" if page.get("page") else f"段落 {paragraph}"
                if len(text) > 600:
                    locator += f" · 片段 {offset // 600 + 1}"
                result.append({"text": value, "locator": locator})
    return result


def extract_text(filename: str, content: bytes) -> dict:
    if not content or len(content) > MAX_UPLOAD:
        raise HTTPException(413, "文件为空或超过 5 MB，请拆分后重试。")
    suffix = Path(filename).suffix.lower()
    pages = []
    if suffix == ".pdf":
        if not content.lstrip().startswith(b"%PDF-"):
            raise HTTPException(422, "文件内容不是有效 PDF。")
        try:
            reader = PdfReader(BytesIO(content))
            if reader.is_encrypted:
                raise HTTPException(422, "暂不支持加密 PDF，请先导出无密码的文本版本。")
            if len(reader.pages) > 50:
                raise HTTPException(422, "PDF 最多 50 页，请按主题拆分。")
            total = 0
            for number, page in enumerate(reader.pages, 1):
                text = (page.extract_text() or "").strip()
                total += len(text)
                if total > MAX_CHARS:
                    raise HTTPException(422, "提取文字超过 12 万字，请拆分资料。")
                pages.append({"page": number, "text": text})
        except HTTPException:
            raise
        except Exception:
            raise HTTPException(422, "无法读取 PDF，请重新导出文本型 PDF 或粘贴文字。") from None
    elif suffix in {".txt", ".md"}:
        text = None
        for encoding in ("utf-8-sig", "gb18030"):
            try:
                text = content.decode(encoding)
                break
            except UnicodeDecodeError:
                continue
        if text is None or re.search(r"[\x00-\x08\x0e-\x1f]", text):
            raise HTTPException(422, "请使用 UTF-8 或 GB18030 编码的纯文本文件。")
        pages = [{"page": None, "text": text.strip()}]
    else:
        raise HTTPException(415, "支持 TXT、Markdown 和文本型 PDF；暂不支持扫描件 OCR。")
    text = "\n\n".join(p["text"] for p in pages)
    if not text.strip():
        raise HTTPException(422, "未提取到文字，可能是扫描件；请粘贴可核对的文字版本。")
    if len(text) > MAX_CHARS:
        raise HTTPException(422, "文字超过 12 万字，请拆分资料。")
    empty_pages = [p["page"] for p in pages if not p["text"]]
    return {"filename": Path(filename.replace("\\", "/")).name[:180], "pages": pages, "text": text,
            "warning": f"第 {', '.join(map(str, empty_pages))} 页没有可提取文字，未进行 OCR。" if empty_pages else "请核对解析预览；文件中的表格和排版可能影响文字顺序。"}
