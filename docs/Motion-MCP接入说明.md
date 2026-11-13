# Motion Site Builder MCP 接入说明

安装日期：2026-11-09。用途：辅助“浙衍 AI”项目的前端设计、组件参考检索和动效检查。

## 当前状态

- 已安装项目级 MCP 配置：`.codex/config.toml`，服务名 `motion-site-tools`，状态 `enabled = true`。
- 正常用户环境中的 `codex mcp get motion-site-tools --json` 已识别配置。
- 已通过 stdio 初始化、工具发现及全部 8 个工具的实际调用。
- Codex CLI 0.157.1 的 app-server 协议客户端也成功发现全部 8 个工具，`toolsError = null`。此测试读取同一项目配置并作为临时进程参数传入，没有创建聊天或调用模型。
- 2026-11-10：本项目桌面聊天已加载全部工具，V2 开发实际调用了 `motion_get_tokens`（product-ui / ecommerce）、`motion_find_reference` 与 `motion_validate_file`。早期安装时“当前聊天尚未加载”的限制已解除。配置层面、协议测试和当前聊天实际加载仍需分别判断。

官方配置依据：[OpenAI MCP 文档](https://learn.chatgpt.com/docs/extend/mcp?surface=cli)。项目配置仅在受信任项目中加载，本机正常用户配置中已将此项目设为受信任。隔离沙箱内运行的 Codex CLI 使用另一用户环境，可能看不到项目配置；这不等同于桌面客户端连接失败。

## 安装内容和来源

| 项目 | 内容 |
|---|---|
| 官方上游 | https://github.com/olbboy/motion-site-builder |
| 固定提交 | `a0e1cad6aeac73283400df791869a5c7443e49c7` |
| 上游提交时间 | 2026-07-21 06:48:41 UTC |
| 服务自报版本 | `1.0.0`；版本来源以固定提交为准，仓库未发布 GitHub Release |
| 许可证 | MIT，保留于 `vendor/motion-site-builder/LICENSE` |
| 源码和资料 | `vendor/motion-site-builder/` |
| 来源记录 | `vendor/motion-site-builder/UPSTREAM.json` |
| 配置 | `.codex/config.toml` |
| 项目使用约定 | `AGENTS.md` |
| 可重复验证脚本 | `scripts/check_motion_mcp.py` |

从上游保存了 `skills/`、`prompts/`、许可证及 README/CHANGELOG，共 86 个原始文件，逐文件哈希与下载内容一致。没有修改上游 Python 实现。保留的 Skill 文件仅作为参考文档，未注册为全局或项目自动发现的 Skill；本次实际接入的是 MCP 服务。

本地新增的是项目 MCP 配置、UTF-8 启动参数、验证脚本、项目使用约定和本说明。上游演示站及其 Node 依赖没有作为项目运行依赖安装。

MCP 使用 Codex 自带的 Python 3.12.14：

```text
C:\Users\16620\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe
```

不需要额外 pip 包、API Key 或外部托管服务。服务由客户端按需启动，以 stdio 通信，不占用 HTTP 端口。配置使用绝对路径；更换电脑、移动项目或更换 Python 后，应更新 `command`、`args` 和 `cwd` 并重新验证。

## 在本项目中使用

| 页面 | 默认风格 | 使用重点 |
|---|---|---|
| M1–M6 运营后台 | `product-ui` | 数据卡片、表格、抽屉、状态反馈；保持操作响应迅速 |
| C1 消费者演示商品页 | `ecommerce` | 商品图片、信息层次、购买操作和反馈 |
| 将来单独建设的品牌宣传页 | 视需求选择 `cinematic` | 首屏与宣传展示；不替代后台布局 |

可直接对编程助手说：

> 用 motion-site-tools 的 product-ui 风格实现 M1 工作台，先取设计参数和参考，再写页面并检查动效。业务行为按 Demo产品规划V1.md。

也可以说：

> 用 motion-site-tools 检查这次修改的页面，列出动效问题并验证减少动画设置。

建议流程：`motion_list_profiles` → `motion_get_tokens` → `motion_find_reference` / `motion_get_template` → 实现页面 → `motion_validate_file` → 浏览器检查。

上游默认风格是 `cinematic`，后台和商品页要显式传入相应 `profile`。`motion_find_reference` 是关键词匹配，推荐使用 `product-ui dashboard`、`ecommerce product page` 等英文关键词。命中的文件位于 `vendor/motion-site-builder/prompts/`。

该服务提供设计参考和检查结果；页面编码、业务逻辑、真实数据和运行验收仍由项目开发完成。检查得分不代表视觉质量、商业转化效果或业务正确性；图片、视频需要自行准备并核对来源。

## 已验证的结果

| 检查 | 结果 |
|---|---|
| 上游动效检查器自测 | 通过 |
| 上游跨文件一致性检查器自测 | 通过 |
| 54 份提示词重新生成索引 | 与上游保存的索引完全一致 |
| MCP 初始化及工具发现 | 通过，8 个工具 |
| 风格列表与产品后台参数 | 通过，5 种风格 |
| 产品后台组件片段与参考检索 | 通过，命中文件在本地存在 |
| 动画模式与时长建议 | 通过 |
| 内联代码和本地文件检查 | 均识别出故意加入的 `transition: all` 问题 |
| 中文请求、中文目录及中文文件名 | 通过 |
| Codex 协议客户端工具发现 | 通过，8 个工具，无工具发现错误 |

原始检查报告位于 `tmp/motion-mcp-check/verification.json` 和 `tmp/motion-mcp-check/codex-client-verification.json`。这些临时文件不纳入 Git；前一报告使用的是安装前的待写入配置，已核对其 SHA-256 与最终 `.codex/config.toml` 完全相同。

在项目根目录重复验证：

```powershell
& 'C:\Users\16620\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe' -B -X utf8 scripts/check_motion_mcp.py
```

脚本读取正式 `.codex/config.toml`，启动同一 MCP 进程，调用所有工具并检查返回值；不创建 AI 聊天、不调用模型、不消耗模型额度。运行会更新临时检查报告。

## 更新与停用

本次按提交固定版本，不会自动拉取上游更新。更新时重新核对源码和许可证，保持 `skills/motion-site-builder/` 与 `prompts/` 同一版本，更新 `UPSTREAM.json`，再运行验证脚本。

停用时将 `.codex/config.toml` 中该服务的 `enabled` 改为 `false`，重新加载 MCP。不要用 `codex mcp remove` 代替编辑本项目配置，该命令的写入范围需另外确认。
