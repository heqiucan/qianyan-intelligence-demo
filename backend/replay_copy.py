"""Finite, named writing recipes; explicit local replay, never artificial AI variety."""


def replay_copies(product, recipe, tone="自然"):
    name, spec, color, price = (product[k] for k in ("name", "capacity", "color", "price"))
    fact = f"{name}，{spec}，{color}。记录售价 ¥{price:g}。"
    short = tone == "简洁"
    variants = {
        "spec": [("规格先行", f"先看规格，再认识{name}", "先核对这件商品的规格与颜色，再判断是否适合自己。", "展示商品与规格信息", "查看规格详情"),
                 ("价格说明", f"{name}，把价格与规格讲清楚", "将价格和规格放在一起，方便核对后再选择。", "展示价格与对应规格", "核对商品信息")],
        "questions": [("问答开场", f"想了解{name}？先看这几个信息", "规格是什么？颜色是什么？当前记录价格是多少？一起核对。", "用问答介绍已知规格", "查看完整商品资料"),
                      ("选择提示", f"选择{name}前，先核对这些信息", "先查看商品资料，尚未提供的性能和优惠请另行核实。", "依次核对规格与价格", "了解商品规格")],
        "walkthrough": [("顺序讲解", f"一起认识{name}", "先介绍名称，再展示规格，最后说明当前记录价格。", "按名称、规格、价格顺序讲解", "打开商品详情"),
                        ("收尾回顾", f"{name}，再核对一次关键信息", "把商品信息再过一遍，具体选择以核对后的资料为准。", "回顾商品名称与规格", "核对后再选择")],
    }
    return [{"direction": direction, "title": title, "body": fact if short else intro + fact, "cta": cta,
             "script": f"【开场】{intro}\n【商品展示】{action}：{fact}\n【收尾】{cta}，未提供的性能与优惠不作承诺。",
             "replay_recipe": recipe} for direction, title, intro, action, cta in variants[recipe]]
