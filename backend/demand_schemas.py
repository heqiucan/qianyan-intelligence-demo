"""Validated contracts for the demand-material workflow."""
from datetime import date
from typing import Literal
from pydantic import Field, model_validator
from backend.knowledge import Input, Operation

TaskKind = Literal['organize', 'analyze', 'topics', 'faq']

class Filters(Input):
    theme_terms: list[str] = Field(default_factory=list, max_length=30)
    intent_terms: list[str] = Field(default_factory=list, max_length=30)
    exclude_terms: list[str] = Field(default_factory=list, max_length=30)
    match_mode: Literal['any', 'all'] = 'any'
    semantic: bool = False
    date_from: date | None = None
    date_to: date | None = None
    missing_time: Literal['include', 'review', 'exclude'] = 'review'
    dedupe: bool = True
    sort: Literal['source', 'newest', 'oldest'] = 'source'
    limit: int = Field(default=200, ge=1, le=2000)

    @model_validator(mode='after')
    def validate_filters(self):
        if self.date_from and self.date_to and self.date_from > self.date_to:
            raise ValueError('开始日期不能晚于结束日期')
        for key in ('theme_terms', 'intent_terms', 'exclude_terms'):
            words = list(dict.fromkeys(v.strip() for v in getattr(self, key) if v.strip()))
            if any(len(v) > 60 for v in words):
                raise ValueError('单个关键词不能超过 60 字')
            setattr(self, key, words)
        return self

class TaskConfig(Input):
    space_id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=100)
    goal: str = Field(min_length=4, max_length=1500)
    task_type: TaskKind = 'analyze'
    batch_id: str = Field(min_length=1, max_length=80)
    channel: Literal['internal', 'douyin'] = 'internal'
    template_id: str | None = None
    template_version: int | None = Field(default=None, ge=1)
    pack_id: str | None = None
    pack_version: int | None = Field(default=None, ge=1)
    filters: Filters = Field(default_factory=Filters)

class PreviewInput(Operation):
    config: TaskConfig

class CreateDemandTask(PreviewInput):
    preview_signature: str = Field(min_length=64, max_length=64)

class PlanInput(Operation):
    space_id: str = Field(min_length=1, max_length=80)
    goal: str = Field(min_length=4, max_length=1500)
    batch_id: str | None = None
    template_id: str | None = None

class TaskControl(Operation):
    expected_revision: int = Field(ge=1)
    action: Literal['pause', 'resume', 'cancel', 'complete']

class ResultSelection(Input):
    id: str
    revision: int = Field(ge=1)

class ReviewResults(Operation):
    selected: list[ResultSelection] = Field(min_length=1, max_length=2000)
    action: Literal['confirm', 'exclude', 'classify', 'group']
    category: str = Field(default='', max_length=60)
    group: str = Field(default='', max_length=80)
    reason: str = Field(default='', max_length=400)

class UndoReview(Operation):
    operation_id: str

class HandoffDemand(Operation):
    selected: list[ResultSelection] = Field(min_length=1, max_length=100)
    task_type: Literal['topics', 'faq'] = 'topics'
    note: str = Field(default='', max_length=1000)
    new_version: bool = False

class GenerateDemandContent(Operation):
    expected_revision: int = Field(ge=1)
    result_id: str
