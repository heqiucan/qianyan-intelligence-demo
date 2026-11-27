# DeepSeek 模型接入

用户于 2026-11-24 指定后续调用 DeepSeek V4.1-Flash-1017。修改范围为 MODEL 领域及模型来源/费用文案，沿用现有 HTTP 客户端和业务 JSON 校验，不引入 SDK 或 Agent 框架。

## 型号与地址

- Provider：`deepseek`
- 官方 Base URL：`https://api.deepseek.com`
- API 模型 ID：`deepseek-flash`
- 官方当前映射：`DeepSeek-V4.1-Flash-1017`，2026-11-24 核对。
- `deepseek-flash` 是滚动别名，官方可能更新映射；页面版本说明不是响应已验证的固定版本。
- 使用 Chat Completions、JSON Object 响应、关闭思考模式。已有返回字段、引用和事实核对继续执行。
- 仅允许上述 provider/base/model 组合；不自动切换型号、提供者、重定向或付费备选模型。

参考官方 API 文档：`https://api-docs.deepseek.com/zh-cn/`、`https://api-docs.deepseek.com/zh-cn/api/create-chat-completion`。参考其模型命名、认证、JSON格式及思考模式；路由、任务记录、业务校验和保密配置按本项目实现。现有 httpx 依赖不变，不复制模型权重或上游代码。

## 本地配置

双击 `configure-deepseek.cmd` 在隐藏输入中填写 Key；或由用户明确指定纯密钥文件：

```powershell
.venv\Scripts\python.exe scripts/configure_deepseek.py --key-file '用户指定的纯密钥文件路径'
```

脚本只写项目 `.env` 的四个 MODEL 字段，保留其他配置，不打印、备份或提交密钥。只有先确认 `.env` 被 Git 忽略才写入。原始密钥文件由用户保管，不擅自删除。

```text
MODEL_PROVIDER=deepseek
MODEL_BASE_URL=https://api.deepseek.com
MODEL_NAME=deepseek-flash
MODEL_API_KEY=<仅在本机填写>
```

使用 `scripts/start_demo.py` 启动时加载 `.env`；进程已设置的环境变量优先。修改后必须重启原服务，不能仅刷新网页。启动前核对同一数据目录已有进程和运行中任务；临时验收服务保持 replay，不全局修改所有 Python 服务。

## 费用与验证

DeepSeek 根据账户规则计费；界面 `free_only=false`，不估算实际账单。连接测试会真实请求官方服务，只发送简短 JSON 测试，不传商品、订单或知识库内容。不要自动运行旧的多次真实生成验收脚本。

```powershell
.venv\Scripts\python.exe scripts/configure_deepseek.py --check
.venv\Scripts\python.exe -m pytest backend/test_deepseek.py backend/test_zhipu.py backend/test_model_status.py -q
```

普通回归使用 MockTransport 或 replay；模型状态读取不触发生成。来源记录保留实际 provider/model，智谱旧记录不改名为 DeepSeek，DeepSeek调用历史与原提供者隔离。真实业务内容效果需要另行选择样例验证，连接成功不等于所有生成任务已验收。

## 2026-11-24 本机验收

- 已写入用户提供的本机密钥，不保存密钥到本文件或仓库。
- 已确认8001模型/Agent/需求/直播模拟无运行中任务后重启，沿用原 `data/` 目录。
- 两次成功的最小真实连接检查：一次配置脚本，一次运行中的工作台连接接口；均仅发送简短JSON验证，无业务资料。网络沙箱内第一次未连通，不计为成功。
- 工作台 `/api/model/status` 返回 `mode=deepseek`、`model_name=deepseek-flash`、`configured=true`、`live_verified=true`、`free_only=false`。
- 后端完整离线回归560项通过，配置脚本专项5项通过；前端TypeScript/构建通过，桌面与390px只读设置检查8项通过，无额外模型调用。
- 旧Agent任务在继续时会检查创建时的模型，换提供者后可能拒绝继续。保留旧任务记录，按新配置创建任务，不强行改写历史来源。
- 验收日志在 `tmp/deepseek-backend-all.log`、`tmp/deepseek-settings/`，本机启动日志为 `tmp/deepseek-workspace-start.log`。临时replay预览不自动改成真实付费模型。

## 同日补充：真实业务生成验收

用户指出需要真实调用而不是仅显示已配置后，额外执行了一轮实际创意生成与一轮内容Agent流程。使用脚本 `scripts/check_deepseek_live.py --run`，读取本机配置，发送独立虚构商品资料，日常数据库不参与测试。

- 创意：1次真实请求，生成2份 `source=model`、`model_name=deepseek-flash` 的草稿并保存；同一request_id再次提交未重复调用。
- Agent：5次真实请求，分别完成3次步骤选择、1次草稿生成、1次引用核对，最终为 `waiting_review`，未自动确认、发布或创建投放计划。
- 合计6次成功请求，官方响应 usage 合计4082 tokens；这是用量不是费用估算。
- 结果与调用类别、接口用量保存在 `tmp/deepseek-live-acceptance/result.json`；控制台摘要在 `tmp/deepseek-live-run.log`。文件只包含虚构产物和脱敏元数据，不包含密钥。
- 此验收证明上述两条实际链路；不宣称所有需求/知识/复盘/直播生成质量均已完整验收。
- 脚本默认不执行真实调用，必须明确传 `--run`；一轮最多8次请求，不自动重跑整轮。普通离线回归不可包含此脚本。

日常8001服务查询也已发现 `generate` 成功记录（非 model-check），证明配置后的日常内容生成路径确实到达DeepSeek。查看旧回放素材不会自动生成新内容；新生成结果与旧记录按来源区分。
