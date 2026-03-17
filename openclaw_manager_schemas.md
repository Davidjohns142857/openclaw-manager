# OpenClaw Manager：Event / Session / Run Schema 草案

## 1. 设计原则

本 schema 草案服务于 OpenClaw Manager 的最小控制平面。  
设计目标不是“一开始覆盖所有情况”，而是先满足以下原则：

1. **Session 是第一公民**：消息不是系统的核心对象，session 才是。
2. **Run 与 Session 分离**：一次执行失败，不等于任务线程死亡。
3. **Event 是事实底座**：恢复、观测、统计、能力蒸馏都依赖 event，而不是聊天原文。
4. **Filesystem-first**：schema 应便于落盘为 JSON / JSONL。
5. **可扩展而不脆弱**：允许未来扩字段，但早期核心字段应稳定。

以下 schema 是草案，不是最终标准；目的是快速推进 MVP 实现。

---

## 2. 命名约定

### 2.1 ID 约定
建议各类对象使用前缀化 ID：

- Session: `sess_...`
- Run: `run_...`
- Event: `evt_...`
- Skill Trace: `trace_...`
- Attention Unit: `attn_...`
- Capability Fact: `fact_...`
- Artifact: `art_...`
- Request: `req_...`
- External Trigger: `ext_...`

### 2.2 时间格式
所有时间字段使用 ISO 8601 UTC，例如：

```json
"created_at": "2026-03-17T18:12:00Z"
```

### 2.3 枚举值原则
- 核心状态尽量用固定枚举；
- 可扩展标签类字段使用字符串数组；
- `metadata` 永远保留为开放字段。

---

## 3. Session Schema 草案

### 3.1 Session 的角色
Session 表示一个长期工作线程。  
它不是聊天窗口，而是一个拥有持续目标、状态、依赖、阻塞点、摘要和运行历史的任务对象。

### 3.2 Session JSON 示例

```json
{
  "session_id": "sess_01JQXYZABC123",
  "title": "调查某 AI 游戏产品并形成结论",
  "objective": "针对目标产品做近期调研，形成可复用分析框架与结论摘要。",
  "owner": {
    "type": "human",
    "ref": "user_primary"
  },
  "status": "active",
  "lifecycle_stage": "execution",
  "priority": "high",
  "scenario_signature": "product_research.ai_game.recent_market_scan",
  "tags": ["research", "product", "ai-game"],
  "source_channels": [
    {
      "source_type": "openclaw_chat",
      "source_ref": "thread_local_001",
      "bound_at": "2026-03-17T18:12:00Z"
    }
  ],
  "active_run_id": "run_01JQXYZRUN001",
  "latest_summary_ref": "summary.md",
  "latest_checkpoint_ref": "runs/run_01JQXYZRUN001/checkpoint.json",
  "state": {
    "phase": "collecting_sources",
    "goal_status": "in_progress",
    "blockers": [],
    "pending_human_decisions": [],
    "pending_external_inputs": [],
    "next_machine_actions": [
      "collect_recent_product_mentions",
      "group user-facing use cases"
    ],
    "next_human_actions": []
  },
  "metrics": {
    "run_count": 3,
    "failed_run_count": 1,
    "human_intervention_count": 1,
    "artifact_count": 4,
    "last_activity_at": "2026-03-17T20:45:00Z"
  },
  "sharing": {
    "is_shareable": true,
    "latest_snapshot_id": null
  },
  "created_at": "2026-03-17T18:12:00Z",
  "updated_at": "2026-03-17T20:45:00Z",
  "archived_at": null,
  "metadata": {
    "created_via": "adopt_command"
  }
}
```

### 3.3 Session 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `session_id` | string | 是 | Session 唯一标识 |
| `title` | string | 是 | 任务线程标题 |
| `objective` | string | 是 | 当前 session 的持续目标 |
| `owner` | object | 是 | session 的主责任主体 |
| `status` | enum | 是 | session 当前状态 |
| `lifecycle_stage` | enum | 否 | 生命周期阶段 |
| `priority` | enum | 否 | 优先级 |
| `scenario_signature` | string | 否 | 场景签名，用于能力统计 |
| `tags` | string[] | 否 | 标签 |
| `source_channels` | array | 否 | 绑定的来源通道 |
| `active_run_id` | string/null | 否 | 当前活跃 run |
| `latest_summary_ref` | string/null | 否 | 最新摘要文件引用 |
| `latest_checkpoint_ref` | string/null | 否 | 最新 checkpoint 引用 |
| `state` | object | 是 | 当前结构化状态 |
| `metrics` | object | 否 | 聚合指标 |
| `sharing` | object | 否 | 分享状态 |
| `created_at` | string | 是 | 创建时间 |
| `updated_at` | string | 是 | 最后更新时间 |
| `archived_at` | string/null | 否 | 归档时间 |
| `metadata` | object | 否 | 扩展元数据 |

### 3.4 Session 状态枚举

#### `status`
- `draft`
- `active`
- `waiting_human`
- `blocked`
- `completed`
- `abandoned`
- `archived`

#### `lifecycle_stage`
- `intake`
- `planning`
- `execution`
- `review`
- `closure`
- `archival`

#### `priority`
- `low`
- `medium`
- `high`
- `critical`

### 3.5 Session.state 子结构

```json
{
  "phase": "collecting_sources",
  "goal_status": "in_progress",
  "blockers": [
    {
      "blocker_id": "blk_001",
      "type": "external_dependency",
      "summary": "等待外部邮件回复",
      "detected_at": "2026-03-17T20:30:00Z",
      "severity": "medium"
    }
  ],
  "pending_human_decisions": [
    {
      "decision_id": "dec_001",
      "summary": "是否继续扩大搜索范围",
      "requested_at": "2026-03-17T20:35:00Z",
      "urgency": "medium"
    }
  ],
  "pending_external_inputs": [],
  "next_machine_actions": ["collect_recent_mentions"],
  "next_human_actions": ["confirm scope"]
}
```

### 3.6 Session 最小 JSON Schema（草案）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "openclaw-manager/session.schema.json",
  "title": "Session",
  "type": "object",
  "required": [
    "session_id",
    "title",
    "objective",
    "owner",
    "status",
    "state",
    "created_at",
    "updated_at"
  ],
  "properties": {
    "session_id": {
      "type": "string",
      "pattern": "^sess_[A-Za-z0-9_-]+$"
    },
    "title": {
      "type": "string",
      "minLength": 1
    },
    "objective": {
      "type": "string",
      "minLength": 1
    },
    "owner": {
      "type": "object",
      "required": ["type", "ref"],
      "properties": {
        "type": {
          "type": "string",
          "enum": ["human", "agent", "system"]
        },
        "ref": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    "status": {
      "type": "string",
      "enum": [
        "draft",
        "active",
        "waiting_human",
        "blocked",
        "completed",
        "abandoned",
        "archived"
      ]
    },
    "lifecycle_stage": {
      "type": "string",
      "enum": [
        "intake",
        "planning",
        "execution",
        "review",
        "closure",
        "archival"
      ]
    },
    "priority": {
      "type": "string",
      "enum": ["low", "medium", "high", "critical"]
    },
    "scenario_signature": {
      "type": "string"
    },
    "tags": {
      "type": "array",
      "items": {"type": "string"}
    },
    "source_channels": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["source_type", "source_ref", "bound_at"],
        "properties": {
          "source_type": {"type": "string"},
          "source_ref": {"type": "string"},
          "bound_at": {"type": "string", "format": "date-time"}
        },
        "additionalProperties": true
      }
    },
    "active_run_id": {
      "type": ["string", "null"],
      "pattern": "^run_[A-Za-z0-9_-]+$"
    },
    "latest_summary_ref": {
      "type": ["string", "null"]
    },
    "latest_checkpoint_ref": {
      "type": ["string", "null"]
    },
    "state": {
      "type": "object",
      "required": ["phase", "goal_status"],
      "properties": {
        "phase": {"type": "string"},
        "goal_status": {
          "type": "string",
          "enum": [
            "not_started",
            "in_progress",
            "waiting_input",
            "partially_complete",
            "complete",
            "abandoned"
          ]
        },
        "blockers": {"type": "array"},
        "pending_human_decisions": {"type": "array"},
        "pending_external_inputs": {"type": "array"},
        "next_machine_actions": {
          "type": "array",
          "items": {"type": "string"}
        },
        "next_human_actions": {
          "type": "array",
          "items": {"type": "string"}
        }
      },
      "additionalProperties": true
    },
    "metrics": {
      "type": "object"
    },
    "sharing": {
      "type": "object"
    },
    "created_at": {
      "type": "string",
      "format": "date-time"
    },
    "updated_at": {
      "type": "string",
      "format": "date-time"
    },
    "archived_at": {
      "type": ["string", "null"],
      "format": "date-time"
    },
    "metadata": {
      "type": "object"
    }
  },
  "additionalProperties": true
}
```

---

## 4. Run Schema 草案

### 4.1 Run 的角色
Run 表示 session 内某一次具体执行尝试。  
它允许系统把“线程是否存在”和“单次执行是否成功”分离开。

### 4.2 Run JSON 示例

```json
{
  "run_id": "run_01JQXYZRUN001",
  "session_id": "sess_01JQXYZABC123",
  "status": "running",
  "trigger": {
    "trigger_type": "message",
    "trigger_ref": "evt_01JQXYZMSG001",
    "request_id": "req_01JQXYZREQ001",
    "external_trigger_id": null
  },
  "planner": {
    "planner_name": "default_planner",
    "planner_version": "0.1.0"
  },
  "execution": {
    "invoked_skills": ["web-research", "summarizer"],
    "invoked_tools": ["web.run"],
    "start_checkpoint_ref": "runs/run_prev/checkpoint.json",
    "end_checkpoint_ref": null,
    "artifact_refs": [],
    "spool_ref": "runs/run_01JQXYZRUN001/spool.jsonl"
  },
  "outcome": {
    "result_type": null,
    "summary": null,
    "human_takeover": false,
    "closure_contribution": null
  },
  "metrics": {
    "skill_invocation_count": 2,
    "tool_call_count": 1,
    "error_count": 0,
    "human_intervention_count": 0,
    "duration_ms": null
  },
  "started_at": "2026-03-17T20:40:00Z",
  "ended_at": null,
  "metadata": {}
}
```

### 4.3 Run 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `run_id` | string | 是 | Run 唯一标识 |
| `session_id` | string | 是 | 所属 session |
| `status` | enum | 是 | run 状态 |
| `trigger` | object | 是 | 触发来源 |
| `planner` | object | 否 | planner 信息 |
| `execution` | object | 是 | 执行上下文与引用 |
| `outcome` | object | 否 | 执行结果 |
| `metrics` | object | 否 | run 指标 |
| `started_at` | string | 是 | 开始时间 |
| `ended_at` | string/null | 否 | 结束时间 |
| `metadata` | object | 否 | 扩展字段 |

### 4.4 Run 状态枚举

- `accepted`
- `queued`
- `running`
- `waiting_human`
- `blocked`
- `completed`
- `failed`
- `cancelled`
- `superseded`

### 4.5 Trigger 子结构

```json
{
  "trigger_type": "external_message",
  "trigger_ref": "evt_01JQXYZMSG002",
  "request_id": "req_01JQXYZREQ002",
  "external_trigger_id": "ext_tg_001"
}
```

#### `trigger_type`
- `manual`
- `message`
- `external_message`
- `scheduled`
- `resume`
- `retry`
- `system_maintenance`

### 4.6 Outcome 子结构

```json
{
  "result_type": "partial_progress",
  "summary": "已收集完来源，等待人类确认结论结构。",
  "human_takeover": false,
  "closure_contribution": 0.4
}
```

#### `result_type`
- `no_op`
- `partial_progress`
- `awaiting_human`
- `blocked`
- `completed`
- `failed`

### 4.7 Run 最小 JSON Schema（草案）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "openclaw-manager/run.schema.json",
  "title": "Run",
  "type": "object",
  "required": [
    "run_id",
    "session_id",
    "status",
    "trigger",
    "execution",
    "started_at"
  ],
  "properties": {
    "run_id": {
      "type": "string",
      "pattern": "^run_[A-Za-z0-9_-]+$"
    },
    "session_id": {
      "type": "string",
      "pattern": "^sess_[A-Za-z0-9_-]+$"
    },
    "status": {
      "type": "string",
      "enum": [
        "accepted",
        "queued",
        "running",
        "waiting_human",
        "blocked",
        "completed",
        "failed",
        "cancelled",
        "superseded"
      ]
    },
    "trigger": {
      "type": "object",
      "required": ["trigger_type"],
      "properties": {
        "trigger_type": {
          "type": "string",
          "enum": [
            "manual",
            "message",
            "external_message",
            "scheduled",
            "resume",
            "retry",
            "system_maintenance"
          ]
        },
        "trigger_ref": {
          "type": ["string", "null"]
        },
        "request_id": {
          "type": ["string", "null"]
        },
        "external_trigger_id": {
          "type": ["string", "null"]
        }
      },
      "additionalProperties": true
    },
    "planner": {
      "type": "object"
    },
    "execution": {
      "type": "object",
      "properties": {
        "invoked_skills": {
          "type": "array",
          "items": {"type": "string"}
        },
        "invoked_tools": {
          "type": "array",
          "items": {"type": "string"}
        },
        "start_checkpoint_ref": {
          "type": ["string", "null"]
        },
        "end_checkpoint_ref": {
          "type": ["string", "null"]
        },
        "artifact_refs": {
          "type": "array",
          "items": {"type": "string"}
        },
        "spool_ref": {
          "type": ["string", "null"]
        }
      },
      "additionalProperties": true
    },
    "outcome": {
      "type": "object",
      "properties": {
        "result_type": {
          "type": ["string", "null"],
          "enum": [
            "no_op",
            "partial_progress",
            "awaiting_human",
            "blocked",
            "completed",
            "failed",
            null
          ]
        },
        "summary": {
          "type": ["string", "null"]
        },
        "human_takeover": {
          "type": "boolean"
        },
        "closure_contribution": {
          "type": ["number", "null"],
          "minimum": 0,
          "maximum": 1
        }
      },
      "additionalProperties": true
    },
    "metrics": {
      "type": "object"
    },
    "started_at": {
      "type": "string",
      "format": "date-time"
    },
    "ended_at": {
      "type": ["string", "null"],
      "format": "date-time"
    },
    "metadata": {
      "type": "object"
    }
  },
  "additionalProperties": true
}
```

---

## 5. Event Schema 草案

### 5.1 Event 的角色
Event 是整个系统的事实底座。  
系统所有恢复、观测、统计、能力蒸馏，最终都应建立在 event 序列之上，而不是聊天原文。

建议存储形式为：

- 每个 run 一个 `events.jsonl`
- 一行一个 event
- 大体积内容使用 `payload_ref` 外置

### 5.2 Event JSON 示例

```json
{
  "event_id": "evt_01JQXYZEVT001",
  "session_id": "sess_01JQXYZABC123",
  "run_id": "run_01JQXYZRUN001",
  "event_type": "skill_invoked",
  "actor": {
    "actor_type": "agent",
    "actor_ref": "openclaw_manager"
  },
  "causality": {
    "causal_parent": "evt_01JQXYZEVT000",
    "correlation_id": "corr_01JQXYZ001",
    "request_id": "req_01JQXYZREQ001",
    "external_trigger_id": null
  },
  "payload": {
    "skill_name": "web-research",
    "skill_version": "0.2.0",
    "invocation_reason": "collect_recent_product_mentions"
  },
  "payload_ref": null,
  "timestamp": "2026-03-17T20:41:00Z",
  "metadata": {}
}
```

### 5.3 Event 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `event_id` | string | 是 | Event 唯一标识 |
| `session_id` | string | 是 | 所属 session |
| `run_id` | string/null | 否 | 所属 run |
| `event_type` | enum | 是 | 事件类型 |
| `actor` | object | 是 | 事件发起主体 |
| `causality` | object | 否 | 因果链信息 |
| `payload` | object | 否 | 轻量事件负载 |
| `payload_ref` | string/null | 否 | 大体积内容引用 |
| `timestamp` | string | 是 | 事件时间 |
| `metadata` | object | 否 | 扩展字段 |

### 5.4 Event 类型枚举

- `message_received`
- `message_normalized`
- `run_accepted`
- `run_started`
- `run_status_changed`
- `run_completed`
- `run_failed`
- `run_cancelled`
- `skill_invoked`
- `skill_completed`
- `skill_failed`
- `tool_called`
- `artifact_created`
- `artifact_updated`
- `checkpoint_written`
- `summary_refreshed`
- `blocker_detected`
- `blocker_cleared`
- `human_decision_requested`
- `human_decision_resolved`
- `external_trigger_bound`
- `session_shared`
- `session_closed`
- `session_archived`
- `capability_fact_emitted`

### 5.5 Actor 子结构

```json
{
  "actor_type": "system",
  "actor_ref": "connector.telegram"
}
```

#### `actor_type`
- `human`
- `agent`
- `system`
- `external`

### 5.6 Causality 子结构

```json
{
  "causal_parent": "evt_01JQXYZEVT000",
  "correlation_id": "corr_01JQXYZ001",
  "request_id": "req_01JQXYZREQ001",
  "external_trigger_id": "ext_tg_001"
}
```

说明：

- `causal_parent`：直接上游事件
- `correlation_id`：同一动作链路内的相关事件共享一个 correlation id
- `request_id`：一次 inbound update 对应一个 request id
- `external_trigger_id`：某外部线程或触发器的稳定映射键

### 5.7 Event 最小 JSON Schema（草案）

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "openclaw-manager/event.schema.json",
  "title": "Event",
  "type": "object",
  "required": [
    "event_id",
    "session_id",
    "event_type",
    "actor",
    "timestamp"
  ],
  "properties": {
    "event_id": {
      "type": "string",
      "pattern": "^evt_[A-Za-z0-9_-]+$"
    },
    "session_id": {
      "type": "string",
      "pattern": "^sess_[A-Za-z0-9_-]+$"
    },
    "run_id": {
      "type": ["string", "null"],
      "pattern": "^run_[A-Za-z0-9_-]+$"
    },
    "event_type": {
      "type": "string",
      "enum": [
        "message_received",
        "message_normalized",
        "run_accepted",
        "run_started",
        "run_status_changed",
        "run_completed",
        "run_failed",
        "run_cancelled",
        "skill_invoked",
        "skill_completed",
        "skill_failed",
        "tool_called",
        "artifact_created",
        "artifact_updated",
        "checkpoint_written",
        "summary_refreshed",
        "blocker_detected",
        "blocker_cleared",
        "human_decision_requested",
        "human_decision_resolved",
        "external_trigger_bound",
        "session_shared",
        "session_closed",
        "session_archived",
        "capability_fact_emitted"
      ]
    },
    "actor": {
      "type": "object",
      "required": ["actor_type", "actor_ref"],
      "properties": {
        "actor_type": {
          "type": "string",
          "enum": ["human", "agent", "system", "external"]
        },
        "actor_ref": {
          "type": "string"
        }
      },
      "additionalProperties": true
    },
    "causality": {
      "type": "object",
      "properties": {
        "causal_parent": {
          "type": ["string", "null"]
        },
        "correlation_id": {
          "type": ["string", "null"]
        },
        "request_id": {
          "type": ["string", "null"]
        },
        "external_trigger_id": {
          "type": ["string", "null"]
        }
      },
      "additionalProperties": true
    },
    "payload": {
      "type": ["object", "null"]
    },
    "payload_ref": {
      "type": ["string", "null"]
    },
    "timestamp": {
      "type": "string",
      "format": "date-time"
    },
    "metadata": {
      "type": "object"
    }
  },
  "additionalProperties": true
}
```

---

## 6. Session / Run / Event 的关系约束

为了让实现稳定，建议明确以下约束。

### 6.1 Session 与 Run
- 一个 session 可以包含多个 run；
- 任一时刻最多只有一个 `active_run_id`；
- 一个 completed / archived session 不应再启动新的普通 run，除非显式 reopen；
- run 失败不会自动使 session 失败，除非策略判断该 session 已不可恢复。

### 6.2 Run 与 Event
- 一个 run 可以对应 0 到 N 个 event；
- 所有与某次执行相关的关键状态变化都应该有 event；
- `run_started` 与 `run_completed / run_failed / run_cancelled` 应成对出现，除非系统崩溃导致异常中断；
- run 的最终状态应可从 event 回放与 `run.json` 相互校验。

### 6.3 Session 与 Event
- 某些事件可以没有 run，例如 `external_trigger_bound`、`session_shared`；
- session 的结构化摘要刷新应对应 `summary_refreshed` 事件；
- session 的 blocker 与 pending human decision 应可追踪回相应事件。

---

## 7. 目录与存储建议

建议如下落盘方式：

```text
~/.openclaw/skills/manager/
  sessions/
    <session_id>/
      session.json
      summary.md
      runs/
        <run_id>/
          run.json
          checkpoint.json
          events.jsonl
          spool.jsonl
```

### 文件职责
- `session.json`：session 当前结构化真相
- `summary.md`：给人看的恢复摘要
- `run.json`：run 当前与最终状态
- `checkpoint.json`：给系统恢复的最小执行状态
- `events.jsonl`：事实事件序列
- `spool.jsonl`：原始执行输出，保留低层证据

---

## 8. 后续可扩展对象

虽然当前文档只要求 Event / Session / Run，但为了后续能力图谱与注意力系统，建议预留这些对象：

### 8.1 SkillTrace
记录 skill 在 run 中的角色与表现。

关键字段建议：

- `trace_id`
- `session_id`
- `run_id`
- `skill_name`
- `skill_version`
- `invocation_reason`
- `input_schema_hash`
- `output_schema_hash`
- `duration_ms`
- `success`
- `contribution_type`
- `downstream_effect`
- `requires_human_fix`
- `closure_contribution_score`
- `scenario_tags`

### 8.2 AttentionUnit
给人类看的控制面对象。

关键字段建议：

- `attention_id`
- `session_id`
- `category`
- `urgency`
- `expected_human_action`
- `reasoning_summary`
- `stale_after`
- `confidence`
- `recommended_next_step`

### 8.3 CapabilityFact
能力图谱的最小事实单元。

关键字段建议：

- `fact_id`
- `subject_type`
- `subject_ref`
- `scenario_signature`
- `metric_name`
- `metric_value`
- `sample_size`
- `confidence`
- `evidence_refs`
- `computed_at`

---

## 9. MVP 实现时的取舍建议

为了快速落地，建议 MVP 时做如下取舍：

### 必做
- Session / Run / Event 三对象稳定下来
- `session.json`、`run.json`、`events.jsonl` 落盘稳定
- 能从 session + checkpoint 恢复
- run 状态机完整
- 外部消息可归一成 event

### 可后做
- 复杂 schema 校验
- SQLite 查询层
- 图数据库
- 高级因果分析
- 复杂能力图谱推断
- 多用户权限系统

当前最重要的是：

> 先让系统拥有可恢复的真实状态，再谈复杂分析。

---

## 10. 最终说明

这一版 schema 草案的意义，不在于一次性定义完美标准，而在于先为 OpenClaw Manager 建立一个稳定的事实层与状态层。

如果这个层没有建立起来，后续的：

- 恢复
- 分享
- 外部消息接入
- skill telemetry
- 闭环率统计
- 能力图谱
- 多任务注意力管理

都会变成堆在聊天记录上的脆弱补丁。

因此，这三份 schema 的优先级是最高的。  
它们是整个 openclaw-native 管理工具真正的地基。
