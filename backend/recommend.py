"""Search-term -> client recommendation agent (backend for the medical assistant).

Read this file top to bottom; it follows the order a request travels:

  1. TERM LIBRARY   recommend_terms.json (795 cleaned terms) = what we already know about search words
  2. RULES          keyword rules that classify a query (service / intent / risk flags)
  3. MATCHER        find the query in the library (exact -> contains -> fuzzy -> rules only)
  4. FACTS          approved client facts live in the existing knowledge base (RAG), never in this file's logic
  5. COMPOSER       builds the answer ONLY from retrieved facts, using a fixed template per intent
  6. GUARDRAILS     blocks prices, guarantees and competitor names before anything is returned
  7. LOG + STATS    every search is saved as one row; the company dashboard only reads those rows

There is no language model in this version on purpose: every sentence can be traced to an approved fact.
A model (step 6 of the roadmap) would only be allowed to *pick* among the retrieved sentences.
"""
import json
import re
from collections import Counter
from functools import lru_cache
from pathlib import Path

from rapidfuzz import fuzz, process

from pydantic import Field

from backend.knowledge import (DocumentInput, Operation, Page, SearchInput, capture_search, get, identifier, put,
                               rank_search, records, save_document, stamp)

CLINIC = "XX 医美机构（演示）"
SPACE_ID = "rec-demo-medical"
SPACE_NAME = "推荐助手 · XX 医美虚构示例"
LIBRARY_FILE = Path(__file__).with_name("recommend_terms.json")

# --------------------------------------------------------------------------------------------
# 1. TERM LIBRARY
# --------------------------------------------------------------------------------------------
HANDLING_OF_ACTION = {"可自动推荐": "auto", "需复核": "review", "转人工": "handoff", "排除": "excluded"}


@lru_cache(maxsize=1)
def library():
    """term -> {term, service, intent, tier, action}. Loaded once; edit the JSON, restart the server."""
    items = json.loads(LIBRARY_FILE.read_text(encoding="utf-8"))
    return {item["term"]: item for item in items}


def normalize(text):
    """Make ' 双眼皮 多少钱？' and '双眼皮多少钱' the same key."""
    return re.sub(r"[\s?？!！。,，、.]+", "", text).lower()


# --------------------------------------------------------------------------------------------
# 2. RULES  (same logic that produced the library, used for words the library has never seen)
# --------------------------------------------------------------------------------------------
SERVICE_RULES = [  # first match wins, so order matters
    ("私密整形", ["私密", "生殖"]),
    ("双眼皮", ["双眼皮", "重睑"]),
    ("眼部其他", ["眼综合", "开眼角", "提眉", "切眉", "大小眼", "眼袋", "美眼", "黑眼圈", "眼圈"]),
    ("丰胸", ["丰胸", "隆胸", "缩胸", "胸"]),
    ("吸脂", ["吸脂", "溶脂", "瘦身", "瘦肚子"]),
    ("隆鼻", ["隆鼻", "鼻"]),
    ("除皱针", ["除皱", "肉毒"]),
    ("填充", ["玻尿酸", "童颜针", "少女针", "濡白", "熊猫针", "水光针", "填充"]),
    ("抗衰仪器", ["热玛吉", "超声炮", "超声刀", "面部提升", "提升术", "拉皮", "轮廓"]),
    ("皮肤/激光", ["祛斑", "嫩肤", "皮秒", "点阵", "祛疤", "祛痘", "祛痣", "微针", "激光", "毛孔"]),
    ("脱毛", ["脱毛", "除毛"]),
    ("耳部整形", ["耳部", "耳软骨"]),
]
INTENT_RULES = [
    ("价格咨询", ["多少钱", "价格", "费用", "价目", "几钱", "要花", "花多少", "钱", "元"]),
    ("方案对比", ["好还是", "哪个好", "哪种好", "还是", "区别", "对比"]),
    ("找机构/口碑", ["医院", "医美", "整形美容", "机构", "哪家", "诊所", "怎么样", "排名", "排行", "最好", "正规", "靠谱", "口碑"]),
    ("效果/风险/恢复", ["效果", "多久", "恢复", "安全", "疤痕", "风险", "维持", "见效", "能去", "去除", "怎么治疗", "怎么去"]),
    ("做法/原理", ["怎么做", "如何", "是怎么", "怎么"]),
]
BRANDS = ["叶子医院", "艺星", "yestar", "曙光", "南医大", "艾维岚", "威塑", "韩美", "军大", "大华", "铜雀台", "五洲妇儿", "海薇"]
CITIES = ["广东", "西安", "哈尔滨", "温州", "成都", "南京", "上海", "北京", "杭州", "广州", "深圳"]
SENSITIVE = ["私密", "生殖"]


def classify(text):
    service = next((name for name, words in SERVICE_RULES if any(w in text for w in words)), None)
    intent = next((name for name, words in INTENT_RULES if any(w in text for w in words)), "项目名称(泛搜索)")
    return service, intent


def risk_flags(text):
    """Small set of codes; handling is decided from these, never from the model."""
    flags = set()
    if any(b.lower() in text.lower() for b in BRANDS):
        flags.add("brand")
    if re.search(r"\d+元", text):
        flags.add("price")
    if any(k in text for k in SENSITIVE):
        flags.add("sensitive")
    if "女性私密处干燥" in text:
        flags.add("symptom")
    if "男性生殖私密按摩" in text:
        flags.add("exclude")
    city = next((c for c in CITIES if c in text), None)
    if city:
        flags.add("city:" + city)
    return flags


# --------------------------------------------------------------------------------------------
# 3. MATCHER
# --------------------------------------------------------------------------------------------
def match_term(query):
    """Returns (info, source). info has service/intent; source says HOW we matched (shown in the log)."""
    key = normalize(query)
    lib = library()
    keys = {normalize(t): t for t in lib}
    if key in keys:
        return lib[keys[key]], "library-exact"
    # For inexact matches we trust the library for the SERVICE only; the intent is re-read from the full query,
    # otherwise "艺星双眼皮怎么样" would inherit the intent of the shorter known term "双眼皮怎么".
    inside = [k for k in keys if len(k) >= 3 and k in key]  # the query CONTAINS a known term
    if inside:
        known = lib[keys[max(inside, key=len)]]
        return {**known, "intent": classify(key)[1]}, "library-contains"
    found = process.extractOne(key, list(keys), scorer=fuzz.ratio, score_cutoff=85)  # typos / small variations
    if found:
        return {**lib[keys[found[0]]], "intent": classify(key)[1]}, "library-fuzzy"
    service, intent = classify(key)
    return {"term": None, "service": service, "intent": intent}, "rules"


def decide(flags, service, has_facts):
    """handling: 'handoff' = human consultant, 'review' = answer allowed but queued for a human, 'auto'."""
    if flags & {"sensitive", "symptom"}:
        return "handoff"
    if "exclude" in flags or not service or not has_facts:
        return "review"
    if any(f in flags for f in ("brand", "price")) or any(f.startswith("city:") for f in flags):
        return "review"
    return "auto"


# --------------------------------------------------------------------------------------------
# 4. FACTS  (fictional client facts; replace by the real client's approved documents)
# --------------------------------------------------------------------------------------------
DEMO_TITLE = "XX 医美机构 · 服务说明（虚构演示）"
DEMO_FACTS = """【虚构演示资料，不代表真实医疗机构】

服务：双眼皮
说明：提供埋线与切开两种双眼皮方案，具体方式需经医生面诊评估后确定。
优势：先面诊评估，再制定个性化方案。
优势：术前说明不同方案的差异与注意事项。

服务：隆鼻
说明：提供隆鼻方案咨询服务，具体方案需医生面诊评估。
优势：由医生面诊评估后说明方案。
优势：术后安排回访。

服务：皮肤/激光
说明：提供激光类皮肤项目咨询，需先判断皮肤问题类型，再确定是否适合。
优势：先判断皮肤问题类型，再推荐方案。

服务：填充
说明：提供注射填充类项目咨询，注射前需经医生评估部位与产品选择。
优势：注射前由医生评估部位与产品选择。

服务：除皱针
说明：提供除皱注射项目咨询，是否适合及注射方案需面诊后确定。
优势：面诊后确定是否适合及方案。

服务：抗衰仪器
说明：提供抗衰类仪器项目咨询，是否适合需由医生面诊评估。
优势：先评估皮肤状态，再说明可选项目。

服务：吸脂
说明：提供局部吸脂咨询服务，是否适合需经面诊与身体检查评估。
优势：先评估身体状况，再说明可选方案。

服务：丰胸
说明：提供丰胸方案咨询，包括假体与自体脂肪两类，方案选择以医生面诊评估为准。
优势：两类方案均可咨询，由医生面诊后说明区别。

服务：眼部其他
说明：提供眼部项目咨询，包括开眼角、眼袋等，具体项目需面诊评估后确定。
优势：面诊时逐项说明适合的眼部项目。
"""  # no paragraphs for 脱毛 / 耳部整形 / 私密整形 on purpose: those become visible "gaps"


def ensure_space(db):
    """Create the demo space + approved document the first time the agent is asked. Idempotent."""
    if db.execute("SELECT 1 FROM records WHERE collection='kb_spaces' AND id=?", (SPACE_ID,)).fetchone():
        return
    put(db, "kb_spaces", {"id": SPACE_ID, "scene": "medical", "name": SPACE_NAME, "is_demo": True, "created_at": stamp()})
    doc = save_document(db, DocumentInput(space_id=SPACE_ID, title=DEMO_TITLE, kind="facts", pages=[Page(text=DEMO_FACTS)]), is_demo=True)
    doc.update(status="approved", reviewed_by="系统预置虚构示例（非真实业务审核）", reviewed_at=stamp())
    put(db, "kb_documents", doc)


def find_service_fact(db, service, query):
    """RAG step: search the approved knowledge base, then keep the chunk that is about THIS service."""
    body = SearchInput(space_id=SPACE_ID, query=f"{service} {query}"[:500], mode="keyword")
    result = rank_search(capture_search(db, body), body)
    marker = f"服务：{service}\n"
    for hit in result["hits"]:
        if hit["text"].startswith(marker):
            return hit
    return None


def read_fact(hit):
    lines = hit["text"].split("\n")
    desc = next((l[3:] for l in lines if l.startswith("说明：")), "")
    benefits = [l[3:] for l in lines if l.startswith("优势：")]
    return desc, benefits


# --------------------------------------------------------------------------------------------
# 6. GUARDRAILS  (checked on every sentence we are about to return)
# --------------------------------------------------------------------------------------------
GUARANTEE = ["保证", "百分之百", "100%", "永久", "无痛", "零风险", "无风险", "包治", "一次见效", "绝对安全"]


def unsafe(text):
    reasons = []
    if re.search(r"\d+(\.\d+)?\s*(元|块|万)|[¥￥]\s*\d", text):
        reasons.append("含具体价格")
    if any(w in text for w in GUARANTEE):
        reasons.append("含效果/安全保证用语")
    if any(b.lower() in text.lower() for b in BRANDS):
        reasons.append("含其他机构名称")
    return reasons


# --------------------------------------------------------------------------------------------
# 5. COMPOSER
# --------------------------------------------------------------------------------------------
def compose(intent, desc, neutral):
    if intent == "价格咨询":
        body = "费用因个人情况和方案而异，需要先面诊评估后才能确定。" + desc
    elif intent == "方案对比":
        body = "不同方案各有适合的人群，不能一概而论，需要结合个人情况评估。" + desc
    elif intent == "效果/风险/恢复":
        body = "效果、恢复期和风险因人而异，需由执业医师面诊评估后说明。" + desc
    elif intent == "找机构/口碑":
        body = f"{CLINIC}提供该项目的咨询服务。{desc}"
    else:
        body = desc
    return ("为保持中立，这里不对其他机构作评价。" if neutral else "") + body


INTENT_GAPS = {"价格咨询": "资料中暂无已审核的价格信息，系统不会给出具体价格",
               "效果/风险/恢复": "缺少已审核的恢复期与风险说明，建议补充"}


class RecommendInput(Operation):
    query: str = Field(min_length=1, max_length=200)


def build_reply(db, body):
    ensure_space(db)
    info, source = match_term(body.query)
    key = normalize(body.query)
    flags = risk_flags(body.query)
    service, intent = info["service"], info["intent"]
    matched = {"term": key, "service": service, "intent": intent}
    gaps, citations, recommendation, answer = [], [], None, ""

    hit = find_service_fact(db, service, key) if service and not (flags & {"sensitive", "symptom", "exclude"}) else None
    desc, benefits = read_fact(hit) if hit else ("", [])
    handling = decide(flags, service, bool(hit and desc))

    if handling == "handoff":
        answer = "这类咨询涉及隐私和较高风险，系统不自动推荐，将转由人工顾问一对一沟通。"
        gaps.append("敏感话题：转人工顾问")
    elif "exclude" in flags:
        answer = "该词条不属于医美咨询范围，系统不作推荐。"
        gaps.append("疑似非医疗服务：已排除")
    elif not service:
        answer = "暂未匹配到相关服务。你可以换个说法，或联系人工顾问。"
        gaps.append("未匹配到服务类别：需补充词表或资料")
    elif not hit or not desc:
        answer = f"暂未找到「{service}」的已审核机构资料，系统不作推荐，已转人工跟进。"
        gaps.append(f"缺少「{service}」的已审核机构资料")
    else:
        answer = compose(intent, desc, "brand" in flags)
        if intent in INTENT_GAPS:
            gaps.append(INTENT_GAPS[intent])
        for f in sorted(flags):
            if f.startswith("city:"):
                gaps.append(f"含地域「{f[5:]}」：需确认机构是否在该城市有服务")
        if "price" in flags:
            gaps.append("用户搜索中含具体价格：系统不复述，需人工复核")
        problems = unsafe(answer)
        if problems:  # approved text broke a rule -> never return it
            answer = "暂无可直接引用的合规表述，已转人工跟进。"
            handling = "review"
            gaps.append("答复被合规检查拦截：" + "、".join(problems))
        else:
            citations = [{"document": hit["title"], "location": hit["locator"], "text": hit["text"]}]
            safe = [b for b in benefits if not unsafe(b)]
            if len(safe) < len(benefits):
                gaps.append("部分优势表述被合规检查拦截")
            recommendation = {"clinic": CLINIC, "ad_label": "广告", "cta": "预约面诊",
                              "benefits": [{"text": b, "citation": 1} for b in safe]}

    search_id = identifier("srch")
    put(db, "rec_searches", {"id": search_id, "created_at": stamp(), "term": key, "matched_term": info["term"],
                             "service": service, "intent": intent, "handling": handling, "match_source": source,
                             "recommended": recommendation is not None, "citations": len(citations),
                             "gaps": gaps, "clicked": False})
    return {"search_id": search_id, "matched": matched, "handling": handling, "answer": answer,
            "citations": citations, "recommendation": recommendation, "gaps": gaps}


# --------------------------------------------------------------------------------------------
# 7. LOG + STATS
# --------------------------------------------------------------------------------------------
def build_stats(db):
    rows = records(db, "rec_searches")
    n = len(rows)
    recommended = sum(r["recommended"] for r in rows)
    clicks = sum(r["clicked"] for r in rows)
    by_handling = Counter(r["handling"] for r in rows)
    lib = list(library().values())
    top = Counter((r["term"], r["service"]) for r in rows).most_common(10)
    gaps = Counter(g for r in rows for g in r["gaps"]).most_common(10)
    return {
        "kpi": {"searches": n, "recommended": recommended, "handoff": by_handling["handoff"], "review": by_handling["review"],
                "clicks": clicks, "click_rate": round(clicks / recommended, 3) if recommended else 0},
        "funnel": [{"label": "搜索", "value": n},
                   {"label": "匹配到服务", "value": sum(1 for r in rows if r["service"])},
                   {"label": "展示推荐", "value": recommended},
                   {"label": "点击预约", "value": clicks}],
        "top_terms": [{"term": t, "service": s, "count": c} for (t, s), c in top],
        "gaps": [{"text": g, "count": c} for g, c in gaps],
        "library": {"total": len(lib),
                    "handling": dict(Counter(HANDLING_OF_ACTION[i["action"]] for i in lib)),
                    "services": [{"name": s, "count": c} for s, c in Counter(i["service"] for i in lib).most_common()]},
    }


def register_recommend(app, store):
    from backend.main import once

    @app.post("/api/recommend")
    def recommend(body: RecommendInput):
        with store.transaction() as db:
            return once(db, "recommend", body, lambda: build_reply(db, body))

    @app.post("/api/recommend/{search_id}/click")
    def click(search_id: str):
        with store.transaction() as db:
            row = get(db, "rec_searches", search_id)
            row["clicked"] = True
            put(db, "rec_searches", row)
            return {"ok": True}

    @app.get("/api/recommend/stats")
    def stats():
        with store.read() as db:
            return build_stats(db)
