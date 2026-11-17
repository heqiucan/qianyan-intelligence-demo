"""Only plot recorded dates. A batch's timestamp is not a simulated traffic curve."""
from collections import defaultdict
from decimal import Decimal
from datetime import datetime, timezone


def with_trend(analytics):
    a = dict(analytics)
    if a["dataset"] != "session":
        a["trend"] = {"points": [], "note": "历史 D0 和固定模拟批次没有逐时交易/消耗明细，不能绘制时间趋势。可查看计划对比。"}
        return a
    points = defaultdict(lambda: {"revenue": Decimal(0), "orders": 0})
    for order in a["orders"]:
        day = datetime.fromisoformat(order["created_at"].replace("Z", "+00:00")).astimezone(timezone.utc).date().isoformat()
        points[day]["revenue"] += Decimal(str(order["amount"]))
        points[day]["orders"] += 1
    a["trend"] = {"points": [{"date": day, "revenue": float(p["revenue"]), "orders": p["orders"], "spend": None} for day, p in sorted(points.items())],
                  "note": "按 UTC 日期汇总本系统模拟支付；只显示有记录的日期。现场没有广告消耗，消耗线不绘制。"}
    return a
