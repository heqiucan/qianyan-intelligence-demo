"""Fictional jacket fixtures for first-time database initialization only."""


def demo_product(created_at):
    return {
        "id": "product-demo",
        "name": "青禾紫色羽绒服",
        "price": 399.0,
        "capacity": "M 码",
        "color": "紫色",
        "brand": "青禾生活",
        "description": "虚构服装样例，仅用于商品资料、创意和模拟投放演示。样例规格为 M 码、紫色，不代表在售商品。",
        "restrictions": "不得编造充绒量、含绒量、蓬松度、面料成分、保暖温度、检测结果、销量、评价或优惠；不得承诺保暖效果或适合所有人。",
        "image_url": "/assets/purple-down-jacket.png",
        "video_url": "",
        "evidence": "内部虚构样例设定；名称、尺码、颜色及售价均为演示数据，未提供实物、检测或交易凭证。",
        "claim_evidence": [],
        "version": 1,
        "created_at": created_at,
        "source": "虚构演示商品资料",
    }


def demo_creatives(product):
    facts = f'{product["name"]}，{product["capacity"]}，{product["color"]}。演示售价 ¥{product["price"]:g}。'
    return [
        {
            "direction": "日常穿搭",
            "title": "青禾紫色羽绒服 · 日常穿搭样例",
            "body": "虚构商品样例：从日常穿搭场景认识这件羽绒服。" + facts + "穿着效果与尺码适配需另行核对。",
            "cta": "查看样例商品",
            "script": "0-3 秒：标注虚构商品样例，展示紫色羽绒服。\n"
                      "3-8 秒：展示日常穿搭场景与样例尺码，不承诺保暖效果。\n"
                      "8-15 秒：" + facts + "引导查看资料。",
            "tone": "自然",
            "angle": "场景",
        },
        {
            "direction": "尺码与颜色",
            "title": "青禾紫色羽绒服 · 先核对尺码与颜色",
            "body": "虚构商品样例：选择前先核对尺码、颜色与记录价格。" + facts + "面料与填充参数尚未提供。",
            "cta": "查看样例规格",
            "script": "0-3 秒：标注虚构商品样例，展示商品名称。\n"
                      "3-8 秒：" + facts + "\n"
                      "8-15 秒：提示核对尺码；面料、填充参数和检测资料尚未提供。",
            "tone": "自然",
            "angle": "规格",
        },
    ]
