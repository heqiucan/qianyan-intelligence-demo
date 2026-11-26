# 项目索引

核对日期：2026-11-26。六板块分级、GEO 原型与紫色羽绒服样例以当前工作区为准，提交前重新查看 Git 状态。Codex 看板属于独立任务。

## 最短阅读路线

1. [AGENTS.md](../AGENTS.md) → 本索引；通常只需全文读取这两个短入口。
2. 用下表定位功能 ID，只读[功能责任矩阵](功能责任矩阵.md)对应行。
3. 查目标入口函数、接口类型、直接调用方和相关测试；读到真实依赖后再扩大，不默认扫整个目录。
4. 涉及长期约定时查[项目记忆](项目记忆.md)对应段；涉及跨模块时查[模块地图](模块地图.md)；验证时查[测试地图](测试地图.md)对应行。
5. 若索引未覆盖，做定向代码搜索，说明不确定点并补登记；不要猜测路径。历史报告仅在解释差异时读取。

## 按任务定位

| 任务关键词 | 功能 ID | 最小入口（路径相对项目根目录） |
| --- | --- | --- |
| 导航、页面层级、返回、未保存保护 | SHELL | `docs/六板块页面分级.md`、`frontend/src/app/workspaceNavigation.ts`、`frontend/src/navigation.ts`、`frontend/src/app/useWorkspaceNavigation.ts` |
| 浅色、深色、系统外观、官网入口 | THEME / SITE | `frontend/src/app/ThemeControls.tsx`、`frontend/src/app/theme.ts`、`frontend/src/app/AppShell.tsx` |
| 首页指标、当前任务 | HOME | `frontend/src/features/Overview.tsx`、`frontend/src/app/useWorkspaceData.ts` |
| 医美咨询助手、公司看板、词表推荐 | RECOMMEND | `frontend/src/features/medical/MedicalAssistantPanel.tsx`、`backend/recommend.py`；入口 `#/overview?tab=assistant` |
| GEO 项目、问题监测、内容审核、效果报告 | GEO | `frontend/src/features/geo/GeoWorkspace.tsx`、`frontend/src/features/geo/model.ts`；入口 `#/geo`；当前为前端样例，未接外部平台 |
| 商品、品牌、SKU、活动策略 | PRODUCT / CAMPAIGN | `frontend/src/features/ProductPage.tsx`、`frontend/src/features/product/ProductEvidenceEditor.tsx`、`frontend/src/features/live/LiveCatalog.tsx`、`frontend/src/components/CampaignModal.tsx` |
| 知识库、Obsidian、资料、检索 | KNOWLEDGE | `frontend/src/features/knowledge/KnowledgeWorkspace.tsx`、`backend/knowledge.py` |
| Agent 创建、执行、审阅、重试 | AGENT | `frontend/src/features/agent/AgentWorkspace.tsx`、`backend/agents/routes.py` |
| 需求素材、词库、筛选、选题 | DEMAND | `frontend/src/features/demand/DemandWorkspace.tsx`、`backend/demand_tasks.py` |
| 创意、事实核对、生成、确认 | CREATIVE / HANDOFF | `frontend/src/features/CreativeStudio.tsx`、`backend/creative_handoff.py` |
| 投放计划、调整、模拟场景、购买 | ADS / CONSUMER | `frontend/src/features/AdsPage.tsx`、`frontend/src/features/Consumer.tsx` |
| 图表、订单、消耗、待办、报告 | ANALYTICS / FEEDBACK | `frontend/src/features/AnalyticsPage.tsx`、`frontend/src/Feedback.tsx` |
| 场次、货盘、账号模拟 | LIVE | `frontend/src/features/live/LiveWorkspace.tsx`、`backend/live.py` |
| 视频、摄像头、图层、滤镜 | PREVIEW | `frontend/src/features/live/LivePreview.tsx` |
| 自动回复、欢迎、定时 | INTERACTION | `frontend/src/features/live/LiveInteraction.tsx`、`backend/live_interaction.py` |
| 话术、音色、播报、混音、录音 | SPEECH / AUDIO | `frontend/src/features/live/speech/LiveSpeech.tsx`、`frontend/src/features/live/AudioMixer.tsx` |
| 音频转换、切片、字幕、草稿 | MEDIA / SCRIPTS | `frontend/src/features/live/MediaTools.tsx`、`frontend/src/features/live/ScriptDrafts.tsx` |
| 数据库、并发、模型、启动、分享 | STORAGE / MODEL / OPS | `backend/core/storage.py`、`backend/model_adapter.py`、`scripts/start_demo.py` |
| 六板块桌面启动、原资料恢复 | SHELL / GEO / OPS | `scripts/start_geo.ps1`；读取 Git 忽略的 `tmp/workspace-launcher.json` 中原数据库/环境文件，8011 打开现有资料，配置缺失则停止 |
| 紫色羽绒服演示商品 | PRODUCT | `backend/demo_product.py`、`backend/main.py:seed`；只用于新数据库，不覆盖已保存资料 |

## 文档分工与事实来源

| 问题 | 唯一维护入口 |
| --- | --- |
| AI 应如何工作、按需阅读与授权 | [AGENTS.md](../AGENTS.md) |
| 用户长期约定与来源、如何变更 | [项目记忆](项目记忆.md) |
| 产品要做成什么、哪些已实现/候选/未接入 | [产品目标与功能范围](product/产品目标与功能范围.md) |
| 功能主责、代码和接口入口 | [功能责任矩阵](功能责任矩阵.md) |
| 依赖方向、变更会影响什么 | [模块地图](模块地图.md) |
| 跑哪些测试、前置条件、旧测试限制 | [测试地图](测试地图.md) |
| 状态、失败与重试的现有约定 | [错误与状态分类](错误与状态分类.md) |
| 为什么这样决定、何时需要重新讨论 | [设计决策索引](decisions/INDEX.md) |
| 旧规划、旧交接和验收资料 | [历史资料索引](history/INDEX.md) |
| 启动、依赖安装和部署说明 | [README](../README.md)（按标注区分当前指引与历史里程碑） |
| DeepSeek 默认模型配置、版本映射和验证边界 | [DeepSeek接入说明](DeepSeek接入说明.md) |

目标看已确认产品要求；当前行为看代码、实际服务及有日期/版本的验证记录。二者不符是待处理差异，不互相覆盖。当前分级与验证入口见 [六板块页面分级](六板块页面分级.md)。

## 文档更新与检索成本

- 功能 ID 在索引、产品范围、责任矩阵和测试地图之间共用；一个领域一个主责，其他模块通过交接使用它。
- 新功能先标“拟新增/待确认”；实现后登记实际入口与验证状态。只更新受影响的行，不每次复制全份架构。
- 不固定全量阅读字数；读取完整目标逻辑及关键调用约束。大日志保存本地，仅返回摘要和失败片段。
- 导航文档采用可共享相对路径。个人库、密钥与真实业务记录不进入项目记忆；记录范围不等于上传授权。
