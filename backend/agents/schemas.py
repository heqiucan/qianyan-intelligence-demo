from typing import Literal
from pydantic import Field, model_validator
from backend.knowledge import Operation, Input

ACTIVE = {"queued", "running"}
RESUMABLE = {"waiting_input", "failed", "interrupted", "waiting_review"}
LIMITS = {"model_calls": 7, "steps": 12, "searches": 2, "seconds": 240, "attempts": 5}


class CreateTask(Operation):
    scene: Literal["medical", "live"]
    goal: str = Field(min_length=4, max_length=1500)
    source_mode: Literal["demo", "knowledge", "catalog"] = "demo"
    space_id: str | None = Field(default=None, max_length=80)
    channel: Literal["internal", "douyin"] = "internal"
    campaign_id: str | None = Field(default=None, min_length=1, max_length=100)
    live_session_id: str | None = None
    live_item_id: str | None = None

    @model_validator(mode="after")
    def has_space(self):
        if bool(self.live_session_id) != bool(self.live_item_id):
            raise ValueError("请同时选择直播场次与货盘商品")
        if self.live_session_id and (self.scene != "live" or not self.campaign_id):
            raise ValueError("直播场次任务必须关联直播场景与营销活动")
        if self.source_mode == "catalog" and (not self.live_session_id or self.channel != "internal"):
            raise ValueError("货盘资料仅供关联场次的内部内容任务使用")
        if self.source_mode == "knowledge" and not self.space_id:
            raise ValueError("使用知识库时请选择资料空间")
        if self.source_mode == "demo" and self.channel != "internal":
            raise ValueError("内置示例只用于内部参考")
        if self.scene == "medical" and self.campaign_id:
            raise ValueError("医美任务使用独立知识资料，暂不关联商品成交活动")
        return self


class ContinueTask(Operation):
    expected_attempt: int = Field(ge=1)
    note: str = Field(default="", max_length=1500)


class ControlTask(Operation):
    expected_attempt: int = Field(ge=1)


class FinishTask(ControlTask):
    draft_id: str
    draft_revision: int = Field(ge=1)


class ReopenTask(ControlTask):
    expected_revision: int = Field(ge=1)


class Action(Input):
    action: Literal["search_knowledge", "read_evidence", "generate_draft", "request_input"]
    query: str = Field(default="", max_length=500)
    source_ids: list[str] = Field(default_factory=list, max_length=8)
    message: str = Field(default="", max_length=600)

    @model_validator(mode="after")
    def valid_arguments(self):
        if self.action == "search_knowledge" and not self.query:
            raise ValueError("检索动作缺少关键词")
        if self.action == "read_evidence" and not self.source_ids:
            raise ValueError("读取动作缺少引用编号")
        if self.action == "request_input" and not self.message:
            raise ValueError("需要说明缺少的信息")
        return self


class ReviewIssue(Input):
    block: int = Field(ge=1, le=6)
    claim: str = Field(min_length=1, max_length=500)
    reason: str = Field(min_length=1, max_length=500)


class EvidenceReview(Input):
    supported: bool
    issues: list[ReviewIssue] = Field(max_length=8)

    @model_validator(mode="after")
    def coherent(self):
        if self.supported == bool(self.issues):
            raise ValueError("依据判断与问题列表不一致")
        return self


class ScriptSelection(Input):
    title: str = Field(min_length=1, max_length=160)
    opening_ids: list[str] = Field(min_length=1, max_length=3)
    display_ids: list[str] = Field(min_length=1, max_length=4)
    closing_ids: list[str] = Field(default_factory=list, max_length=2)
