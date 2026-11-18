"""Narrow, deterministic copy checks against a creative's frozen product facts.

This is not a legal/platform review or a model call. Free-form evidence is shown
for inspection; only explicit, confirmed structured evidence may support an
identical shipping/performance clause. It proves local consistency, not truth.
Spans use UTF-16 offsets so browser String.slice handles emoji correctly.
"""
from __future__ import annotations

from copy import deepcopy
from decimal import Decimal
import re
import unicodedata

FIELDS = ("title", "body", "cta", "script")
CHECKER_VERSION = "facts-v2"
SCOPE_NOTE = (
    "规则核对仅覆盖带单位的数字价格、容量、部分物流/性能时长及保证性表达；"
    "不理解全部文意，不核验资料真伪或时效，不保证法律合规或平台过审。"
    "一致仅表示与本素材资料快照一致；促销条件、引用与比较表述需人工核查。"
    "物流/性能依据仅核对人工确认记录的完整原文和条件，不认证检测报告。"
    "存在未解决提示时，请补充对应依据或修改表述再确认；不支持促销规则自动认证。"
)
PRICE = re.compile(r"[¥￥]\s*(?P<symbol>[+-]?[0-9]+(?:\.[0-9]+)?)(?:\s*元)?|(?<![\d.])(?P<yuan>[+-]?[0-9]+(?:\.[0-9]+)?)\s*元")
CAPACITY = re.compile(r"(?<![\d.])([+-]?[0-9]+(?:\.[0-9]+)?)\s*(ml|毫升|l|升)(?![a-zA-Z])", re.I)
DURATION = re.compile(r"(?:保温|保冷|续航)(?:(?:时长|时间|效果|能力|可|能够|能|持续|保持|长达|达到|至少|最多|约|为|可达|达|连续|大约)|\s){0,8}[0-9]+(?:\.[0-9]+)?\s*(?:小时|天)|[0-9]+(?:\.[0-9]+)?\s*(?:小时|天)(?:的)?(?:保温|保冷|续航)")
SHIPPING = re.compile(r"(?:(?:下单|付款|支付)后|预计|承诺)?\s*[0-9]+(?:\.[0-9]+)?\s*(?:个工作日|工作日|小时|天)(?:之内|内|左右)?(?:发货|送达|到货|出库)|(?:发货|送达|到货|出库)(?:时效|时间)?(?:(?:为|在|需|需要|预计|承诺)|\s|[:：]){0,5}[0-9]+(?:\.[0-9]+)?\s*(?:个工作日|工作日|小时|天)")
GUARANTEE = re.compile(r"全网第一|全网最低|100\s*%\s*(?:保证)?|百分之百\s*(?:保证)?|销量\s*[0-9]+(?:\.[0-9]+)?\s*(?:万|亿)?\s*(?:件|个|单)?|销量第一|零风险|(?:保证)?永久有效|毫无副作用|没有任何副作用|绝对安全|包治(?:百病)?|一次见效|保证效果|永不漏水")
SUBJECTIVE_EFFECT = re.compile(r"效果(?:好到爆|特别好|非常好|超好|神奇)|立竿见影|神效")
FREE_BENEFIT = re.compile(r"免费|免单|包邮|零元")
PROMOTION = re.compile(r"券后|优惠券|优惠|活动价|促销|折后|折扣|[0-9一二三四五六七八九]折|原价|划线价|满减|满\s*\d+|立减|减\s*\d+|定金|尾款|赠品|价值|运费|邮费|补贴|到手|起售|元起|价格区间")
AMBIGUOUS = re.compile(r"对比|相比|比起|其他|竞品|别家|不是|并非|不要|不得|禁止|不能|不保证|不承诺|不提供|不支持|未证实|未核实|未验证|未确认|尚未|没有依据|[“”\"「」]")
UNVERIFIED_EVIDENCE = re.compile(r"对比|相比|其他|竞品|别家|不是|并非|不要|不得|禁止|不能|不保证|不承诺|不提供|不支持|未证实|未核实|未确认|未验证|尚未|没有依据|待核对|待确认|待核实|宣称|据说|可能|自动通过|忽略|跳过|无须审核|无需审核|指令")
RANGE = re.compile(r"(?:[0-9]+(?:\.[0-9]+)?\s*[-~～至到]\s*[0-9]+(?:\.[0-9]+)?\s*(?:元|ml|毫升|l|升)|[¥￥]\s*[0-9]+(?:\.[0-9]+)?\s*[-~～至到]\s*[0-9])", re.I)


def _capacity(match):
    return Decimal(match[1]) * (1000 if match[2].lower() in {"l", "升"} else 1)


def _clause(text, start, end):
    """Restrict contextual hints to the same clause; no cross-sentence guessing."""
    left = re.search(r"[^，,。；;！!？?\n]*$", text[:start]).group()
    right = re.match(r"[^，,。；;！!？?\n]*", text[end:]).group()
    return left + text[start:end] + right


def _utf16(text):
    return len(text.encode("utf-16-le", errors="surrogatepass")) // 2


def _exact_clause(value):
    """Ignore typography only, never numeric values, qualifiers or word order."""
    return re.sub(r"\s+", "", unicodedata.normalize('NFKC', value)).strip('。.;；!！?？').casefold()


def _support(product, category, context):
    # Each entry is an explicit human assertion frozen with the product. Plain
    # product.evidence remains informational and cannot grant approval.
    for item in product.get('claim_evidence', []) or []:
        if not isinstance(item, dict) or item.get('confirmed') is not True or item.get('category') != category:
            continue
        claim, source, conditions = item.get('claim', ''), item.get('source', ''), item.get('conditions', '')
        if not all(isinstance(s, str) for s in (claim, source, conditions)) or not claim.strip() or not source.strip():
            continue
        if not item.get('id') or any(UNVERIFIED_EVIDENCE.search(value) for value in (claim, source, conditions)):
            continue
        if GUARANTEE.search(claim) or SUBJECTIVE_EFFECT.search(claim):
            continue
        if _exact_clause(context) != _exact_clause(claim):
            continue
        if conditions and _exact_clause(conditions) not in _exact_clause(context):
            continue
        return item
    return None


def inspect_claims(creative, fields=None):
    product = creative["product_snapshot"]
    fields = {key: (fields if fields is not None else creative).get(key, "") for key in FIELDS}
    findings, edits = [], {key: [] for key in FIELDS}
    known = list(CAPACITY.finditer(product.get("capacity", "")))
    expected_capacity = _capacity(known[0]) if len(known) == 1 and not RANGE.search(product.get("capacity", "")) else None
    source_text = product.get("evidence") or product.get("source") or "尚未填写资料来源"

    def add(field, match, kind, expected, explanation, source_field, label, value, replacement=None, supporting=None):
        text = fields[field]
        findings.append({
            "id": f"{field}-{len(findings) + 1}", "field": field,
            "start": _utf16(text[:match.start()]), "end": _utf16(text[:match.end()]),
            "text": match.group(), "kind": kind, "expected": expected,
            "explanation": explanation,
            "source": {"field": source_field, "label": label, "value": str(value),
                       "version": product.get("version", 1), "evidence": supporting['source'] if supporting else source_text,
                       **({'claim_evidence_id': supporting['id'], 'conditions': supporting.get('conditions', ''), 'verification': 'human_record'} if supporting else {})},
            "replacement": replacement,
        })
        if replacement is not None and replacement != match.group():
            edits[field].append((match.start(), match.end(), replacement))

    for field, text in fields.items():
        for match in PRICE.finditer(text):
            value = Decimal(match["symbol"] or match["yuan"])
            expected = Decimal(str(product["price"]))
            display = f"{expected:g} 元"
            context = _clause(text, match.start(), match.end())
            complex_context = PROMOTION.search(context) or AMBIGUOUS.search(context) or RANGE.search(context)
            if complex_context:
                add(field, match, "manual_review", display,
                    "涉及促销、比较、引用或限制条件，不能直接判定价格错误。当前资料没有结构化活动价、有效期或条件；请核查并改成已支持的售价表述。",
                    "price", "素材快照售价", display)
            elif value != expected:
                replacement = f"¥{expected:g}" if match["symbol"] else f"{expected:g} 元"
                add(field, match, "conflict", display,
                    "数字售价与本素材的商品快照不一致；若确为促销，请先人工核实活动条件。本轮建议采用快照售价。",
                    "price", "素材快照售价", display, replacement)
            else:
                add(field, match, "consistent", display, "数字售价与本素材商品快照一致，不代表价格已外部核实。",
                    "price", "素材快照售价", display)

        for match in CAPACITY.finditer(text):
            context = _clause(text, match.start(), match.end())
            if AMBIGUOUS.search(context) or RANGE.search(context) or re.search(r"合计|组合|套装|两杯|两瓶|总容量", context):
                add(field, match, "manual_review", product["capacity"],
                    "包含比较、引用、否定或组合容量，本规则不能确认它描述的是单件商品；请人工核查并明确表述。",
                    "capacity", "素材快照容量", product["capacity"])
            elif expected_capacity is None:
                add(field, match, "missing_evidence", "需要明确的单件容量",
                    "资料中的容量未能解析为单个数值与单位，暂时无法自动比对。",
                    "capacity", "素材快照容量", product["capacity"])
            elif _capacity(match) != expected_capacity:
                add(field, match, "conflict", product["capacity"], "换算升与毫升后，容量仍与商品快照不一致。",
                    "capacity", "素材快照容量", product["capacity"], product["capacity"])
            else:
                add(field, match, "consistent", product["capacity"], "容量与商品快照一致，已按 1 L = 1000 ml 换算。",
                    "capacity", "素材快照容量", product["capacity"])

        for pattern, category, label in ((DURATION, 'performance', "性能时长依据"), (SHIPPING, 'shipping', "物流时效依据")):
            for match in pattern.finditer(text):
                context = _clause(text, match.start(), match.end())
                # A product name can start with “保温”, but an immediately
                # following delivery verb makes the numeric phrase logistics.
                # Let SHIPPING own that phrase instead of inventing a second
                # performance finding (for example “保温24小时内发货”).
                if category == 'performance' and any(
                    shipping.start() < match.end() and match.start() < shipping.end()
                    for shipping in SHIPPING.finditer(text)
                ):
                    continue
                manual = bool(AMBIGUOUS.search(context))
                supporting = _support(product, category, context) if not manual else None
                if supporting:
                    add(field, match, 'consistent', supporting['claim'],
                        '完整子句及适用条件与本素材快照中的人工确认依据一致；仅核对填写记录，不代表来源已被外部核验。',
                        'claim_evidence', label, supporting['claim'], supporting=supporting)
                    continue
                add(field, match, "manual_review" if manual else "missing_evidence", "需要人工核实的有效依据",
                    ("该表述含引用或否定等上下文，规则不能判定实际主张；请人工核查并改为明确表述。" if manual else
                     '当前素材快照缺少与完整表述及条件一致的人工确认依据；这不等于说法为假。可在“商品与品牌 → 商品资料 → 逐条主张依据”填写原文、来源和条件并确认，再用新资料创建活动；也可删除该表述。'),
                    "claim_evidence", label, '未找到匹配的人工确认记录',
                    None if manual else "")

        for match in GUARANTEE.finditer(text):
            manual = bool(AMBIGUOUS.search(_clause(text, match.start(), match.end())))
            add(field, match, 'manual_review' if manual else 'missing_evidence', '需要核对保证性或效果主张',
                '该表述涉及保证、效果或经营指标；普通商品资料和逐条时效依据不能自动认证。请核查上下文并删除无依据主张。',
                'restrictions', '宣传依据', product.get('restrictions') or '未提供可验证的宣传依据', None if manual else '')

        for match in SUBJECTIVE_EFFECT.finditer(text):
            add(field, match, 'manual_review', '需要明确具体主张及依据',
                '这类效果描述无法由价格或规格核实，请改为资料能够支持的具体表述；不会因没有数字而自动放行。',
                'restrictions', '效果表述核查', product.get('restrictions') or '未提供效果依据')

        for match in FREE_BENEFIT.finditer(text):
            add(field, match, 'manual_review', '需要明确的促销或费用规则',
                '当前资料没有结构化赠送、免单或运费规则。请核查对象、范围、有效期和条件，并改为已有资料支持的具体表述；物流时效依据不能证明免费。',
                'price', '优惠或费用规则', '未配置结构化促销及运费依据')

    findings.sort(key=lambda item: (FIELDS.index(item["field"]), item["start"]))
    summary = {kind: sum(item["kind"] == kind for item in findings)
               for kind in ("consistent", "conflict", "missing_evidence", "manual_review")}
    suggested = dict(fields)
    for field, replacements in edits.items():
        for start, end, replacement in sorted(replacements, reverse=True):
            suggested[field] = suggested[field][:start] + replacement + suggested[field][end:]
        # Only punctuation cleanup after an explicit deletion; no invented copy.
        if any(replacement == "" for _, _, replacement in replacements):
            suggested[field] = re.sub(r"[，,]\s*([，,。；;！!])", r"\1", suggested[field])
            suggested[field] = re.sub(r"^[，,。；;\s]+", "", suggested[field])

    incomplete = [key for key in ("title", "body", "cta") if not fields[key].strip()]
    return {"mode": "rules", "checker_version": CHECKER_VERSION,
            "creative_id": creative["id"], "product_snapshot": deepcopy(product),
            "fields": fields, "findings": findings, "suggested_fields": suggested,
            "summary": summary, "can_approve": not incomplete and all(item["kind"] == "consistent" for item in findings),
            "incomplete_fields": incomplete,
            "scope_note": SCOPE_NOTE, "offset_encoding": "utf-16"}
