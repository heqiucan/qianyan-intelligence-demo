# 项目开发约定

## Motion Site Builder MCP

- 开发或调整前端页面时，优先使用项目配置的 `motion-site-tools` MCP，先查询设计参数和相关参考，再实现并检查代码。
- M1–M6 运营后台默认使用 `product-ui`；C1 消费者商品页默认使用 `ecommerce`。只有独立品牌宣传页才考虑 `cinematic`，不将后台套成全屏视频落地页。
- 向支持 `profile` 参数的工具显式传入当前页面的风格。使用 `motion_find_reference` 时采用 `product-ui dashboard`、`ecommerce product page` 等英文关键词；上游检索是关键词匹配，不保证中文语义检索。
- MCP 返回的 `source_dir: prompts` 位于 `vendor/motion-site-builder/` 内；用 `vendor/motion-site-builder/prompts/<file>` 读取命中的完整提示词。
- 继承项目已有的框架、字体、配色和组件约定；参考提示词中的依赖版本与当前官方稳定版本核对后再使用，不自动换框架。
- 生成或修改页面后，使用 `motion_validate` / `motion_validate_file` 检查对应风格，并检查浏览器实际显示、交互、窄屏和减少动画设置。静态得分不能替代业务验收。
- 商品事实、演示标识、数据来源和人工确认行为以 `Demo产品规划V1.md` 为准；不得把模板中的销量、评价或效果数字当作真实业务数据。
- 如本会话尚未加载 MCP，说明实际状态；可直接运行同一上游检查脚本，不声称已经调用 MCP。

接入路径、版本和验证方法见 `docs/Motion-MCP接入说明.md`。
