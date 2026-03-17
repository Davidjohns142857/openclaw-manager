# Public Capability Ingest Contract

本文档定义 OpenClaw Manager 向公域能力服务器提交匿名化能力事实的最小协议。

目标不是现在就建一个复杂的公域平台，而是先把三件事固定住：

- 节点本地到底提交什么
- 公域服务器到底接收什么
- 哪些信息绝对不能离开本地节点

## 1. 产品目标

让所有 OpenClaw 用户可以免费查阅：

- 哪些 skill 在哪些场景中被真实使用
- 这些 skill 的成功率、闭环率、人工介入率如何
- 哪些 workflow 组合在特定场景下表现更好
- 哪些场景容易卡住、容易失败、容易需要人工接管

公域服务器收到的不是任务内容，而是 **去身份化的能力事实切片**。

## 2. 核心原则

### 2.1 本地先蒸馏，公域只收结论

节点本地负责：

- 从 `SkillTrace`、`Run`、`Session`、`Event` 中计算能力事实
- 把原始任务内容、用户信息、私有上下文全部剥离
- 只产出 `PublicCapabilityFact` 这一种上报对象

公域服务器负责：

- 接收标准化事实
- 聚合跨节点统计
- 提供免费查询 API

### 2.2 Opt-in only

能力事实上报必须是显式 opt-in：

- 默认关闭
- 用户必须手动启用 `public_fact_submission` feature flag
- 每次提交前本地必须先写一份 `outbox` 待审文件
- 用户可以在提交前检查、删除、修改 outbox 中的内容

### 2.3 不可逆去身份化

提交到公域的事实中不能包含：

- `session_id`、`run_id`、`event_id` 等本地标识
- 用户名、邮箱、owner_ref、API key
- 任务标题、目标、内容、附件
- 原始消息文本或 spool 内容
- 文件路径、IP 地址、机器标识
- 任何可以通过组合还原出用户身份或任务内容的字段

允许包含的只有：

- `scenario_signature`（场景签名，本身就是抽象标签）
- skill 名称 + 版本
- 归一化数值指标
- 置信度和样本量
- 提交时间

## 3. PublicCapabilityFact Schema

这是节点向公域服务器提交的唯一对象类型。

```json
{
  "public_fact_id": "pfact_a1b2c3d4e5f6g7h8",
  "schema_version": "1.0.0",
  "node_fingerprint": "anon_sha256_abc123def456",

  "subject_type": "skill",
  "subject_ref": "web-research",
  "subject_version": "0.2.0",

  "scenario_signature": "product_research.ai_game.recent_market_scan",
  "scenario_tags": ["research", "product", "ai-game"],

  "metric_name": "closure_rate",
  "metric_value": 0.75,
  "sample_size": 12,
  "confidence": 0.82,

  "context": {
    "avg_run_count_per_session": 3.2,
    "avg_human_intervention_rate": 0.25,
    "avg_duration_ms": 45000,
    "dominant_failure_mode": "external_dependency",
    "co_skills": ["summarizer", "planner-v2"]
  },

  "computed_at": "2026-03-17T20:00:00Z",
  "submitted_at": "2026-03-17T20:05:00Z"
}
```

### 3.1 字段定义

| 字段 | 类型 | 必填 | 说明 |
|---|---|---:|---|
| `public_fact_id` | string | 是 | 上报唯一标识，`pfact_` 前缀 |
| `schema_version` | string | 是 | 上报 schema 版本，当前固定 `1.0.0` |
| `node_fingerprint` | string | 是 | 节点匿名指纹，见 §3.2 |
| `subject_type` | enum | 是 | `skill` / `workflow` / `connector` / `scenario` |
| `subject_ref` | string | 是 | skill 名称或 workflow 签名 |
| `subject_version` | string | 否 | skill 版本号 |
| `scenario_signature` | string | 是 | 场景签名 |
| `scenario_tags` | string[] | 否 | 场景标签，用于聚合查询 |
| `metric_name` | string | 是 | 指标名称，见 §4 |
| `metric_value` | number/string/boolean | 是 | 指标值 |
| `sample_size` | integer | 是 | 支撑该指标的样本量，最低为 1 |
| `confidence` | number | 是 | 0-1 之间的置信度 |
| `context` | object | 否 | 聚合上下文，见 §5 |
| `computed_at` | string | 是 | 本地计算时间 |
| `submitted_at` | string | 是 | 实际提交时间 |

### 3.2 Node Fingerprint

节点指纹的目的是让公域服务器能区分"同一个节点的多次提交"和"不同节点的独立提交"，但不能反推出用户身份。

生成规则：

```
node_fingerprint = "anon_" + sha256(local_node_secret + "openclaw-public-facts")[0:32]
```

其中 `local_node_secret` 是节点首次启用 public submission 时随机生成的一次性密钥，存储在本地 state 目录中，不上传。

如果用户想更换指纹（比如担心跨提交关联），可以删除本地密钥文件重新生成。

## 4. Canonical Metric Names

当前阶段支持以下标准化指标名称。

### 4.1 Skill-level 指标

| metric_name | 类型 | 说明 |
|---|---|---|
| `closure_rate` | number | skill 参与的 session 中，最终闭环的比例 |
| `success_rate` | number | skill 被调用后，run 以 completed 结束的比例 |
| `failure_rate` | number | skill 被调用后，run 以 failed 结束的比例 |
| `human_intervention_rate` | number | skill 参与的 run 中，需要人工介入的比例 |
| `avg_duration_ms` | number | skill 在 run 中的平均执行时长 |
| `avg_closure_contribution` | number | 该 skill 对最终闭环的平均贡献分 |
| `primary_contribution_rate` | number | 该 skill 作为 primary contributor 的比例 |
| `regressive_rate` | number | 该 skill 导致返工或回退的比例 |
| `blocker_trigger_rate` | number | 该 skill 执行后产生 blocker 的比例 |
| `invocation_count` | integer | 该 skill 在当前 scenario 下的总调用次数 |

### 4.2 Scenario-level 指标

| metric_name | 类型 | 说明 |
|---|---|---|
| `scenario_closure_rate` | number | 该场景签名下的整体闭环率 |
| `scenario_avg_run_count` | number | 该场景下平均每个 session 的 run 数 |
| `scenario_avg_human_decisions` | number | 该场景下平均每个 session 的人工决策次数 |
| `scenario_dominant_failure_mode` | string | 该场景下最常见的失败模式 |
| `scenario_recovery_success_rate` | number | 该场景下 resume 后成功继续的比例 |
| `scenario_blocker_recurrence_rate` | number | 该场景下 blocker 反复出现的频率 |

### 4.3 Workflow-level 指标

| metric_name | 类型 | 说明 |
|---|---|---|
| `workflow_closure_rate` | number | 该 skill 组合的闭环率 |
| `workflow_efficiency` | number | 闭环所需的平均 run 数的倒数 |
| `workflow_co_skill_synergy` | number | 该组合相比单 skill 的闭环率增益 |

## 5. Context 字段

`context` 是 **可选的聚合上下文**，用于帮助公域消费者理解指标的背景。

当前允许的 context 字段：

| 字段 | 类型 | 说明 |
|---|---|---|
| `avg_run_count_per_session` | number | 该指标对应的 session 平均 run 数 |
| `avg_human_intervention_rate` | number | 对应 session 中人工介入的平均比例 |
| `avg_duration_ms` | number | 平均执行时长 |
| `dominant_failure_mode` | string | 最常见失败模式的归一化标签 |
| `co_skills` | string[] | 最常与该 subject 共同出现的 skill 列表 |
| `co_skill_count` | integer | 平均共同使用的 skill 数量 |
| `environment_hint` | string | `local` / `cloud` / `hybrid`（不含具体云平台或 IP） |

禁止出现在 context 中的字段：

- 任何 session/run 级别的原始标识
- 任何能还原任务内容的文本
- 任何用户标识或机器标识

## 6. 公域 HTTP Ingest API

### 6.1 Endpoint

```
POST https://facts.openclaw.dev/v1/ingest
```

当前阶段该 endpoint 是 mock，不存在真实服务器。

### 6.2 Request

```http
POST /v1/ingest HTTP/1.1
Content-Type: application/json
X-Schema-Version: 1.0.0
X-Node-Fingerprint: anon_sha256_abc123def456

{
  "facts": [
    { ... PublicCapabilityFact ... },
    { ... PublicCapabilityFact ... }
  ],
  "batch_id": "batch_a1b2c3d4",
  "submitted_at": "2026-03-17T20:05:00Z"
}
```

约束：

- 单次 batch 最多 100 条 facts
- 每个 fact 的 `sample_size` 必须 >= 1
- `schema_version` 必须与 header 一致
- `node_fingerprint` 必须与 header 一致

### 6.3 Response

成功：

```json
{
  "status": "accepted",
  "batch_id": "batch_a1b2c3d4",
  "accepted_count": 2,
  "rejected_count": 0,
  "rejected_facts": []
}
```

部分拒绝：

```json
{
  "status": "partial",
  "batch_id": "batch_a1b2c3d4",
  "accepted_count": 1,
  "rejected_count": 1,
  "rejected_facts": [
    {
      "public_fact_id": "pfact_...",
      "reason": "sample_size_below_minimum"
    }
  ]
}
```

错误码：

| HTTP status | reason | 说明 |
|---|---|---|
| 200 | `accepted` | 全部接受 |
| 200 | `partial` | 部分拒绝 |
| 400 | `schema_mismatch` | schema_version 不匹配 |
| 400 | `batch_too_large` | 超过 100 条 |
| 422 | `validation_failed` | payload 不符合 schema |
| 429 | `rate_limited` | 提交频率过高 |
| 503 | `service_unavailable` | 服务端维护 |

### 6.4 Idempotency

- `batch_id` 是幂等键
- 同一个 `batch_id` 重复提交不会重复写入
- 重复提交返回 `200 accepted` 和原始 batch 的结果

### 6.5 Rate Limiting

当前阶段建议：

- 每个 `node_fingerprint` 每小时最多 10 次 batch 提交
- 每天最多 100 次
- 超限返回 `429` 和 `Retry-After` header

## 7. 本地 Outbox 机制

节点不直接从蒸馏结果发送到公域服务器，而是通过 outbox 中转。

### 7.1 Outbox 路径

```
~/.openclaw/skills/manager/exports/public-facts-outbox/
  pending/
    batch_a1b2c3d4.json
    batch_e5f6g7h8.json
  submitted/
    batch_a1b2c3d4.json
  failed/
    batch_i9j0k1l2.json
```

### 7.2 Outbox 生命周期

1. 本地蒸馏引擎在 session 闭环或定期汇总时，把 `PublicCapabilityFact[]` 写入 `pending/`
2. 用户可以在提交前通过 `/review-outbox` 检查 pending 内容
3. 用户可以手动删除不想提交的 batch
4. 提交服务（手动触发或定时）从 `pending/` 取出 batch，发送到公域 endpoint
5. 成功后移入 `submitted/`，失败后移入 `failed/`（附带错误信息）

### 7.3 Outbox 约束

- pending 目录中最多保留 50 个 batch 文件
- 超过 50 个时，最旧的自动归档到 `submitted/` 目录（标记为 `expired_before_submission`）
- `submitted/` 目录中的文件保留 30 天后可清理
- `failed/` 中的文件保留到用户手动处理

## 8. 公域服务器查询 API（预留）

当前阶段不实现，但预留以下查询面：

```
GET /v1/skills?scenario=product_research
GET /v1/skills/{skill_name}/metrics?scenario=...
GET /v1/scenarios?tag=research
GET /v1/scenarios/{signature}/leaderboard
GET /v1/workflows?skill=web-research&skill=summarizer
```

预期返回：

- 跨节点聚合后的指标
- 按 scenario 分组的排行榜
- 按 skill 组合分组的协同效果
- 带置信区间和样本量的统计

## 9. 隐私保障总结

| 信息类别 | 是否离开本地 | 说明 |
|---|---|---|
| 任务标题/目标/内容 | 否 | 绝不上传 |
| session_id / run_id | 否 | 绝不上传 |
| 用户名/邮箱/owner | 否 | 绝不上传 |
| 文件路径/IP 地址 | 否 | 绝不上传 |
| 原始消息文本 | 否 | 绝不上传 |
| skill 名称 + 版本 | 是 | 仅名称和版本号 |
| scenario_signature | 是 | 本身是抽象标签 |
| 归一化数值指标 | 是 | 统计聚合值 |
| node_fingerprint | 是 | 不可逆匿名指纹 |
| 共现 skill 列表 | 是 | 仅 skill 名称 |
| 失败模式标签 | 是 | 归一化标签，非原始错误信息 |

## 10. 与现有系统的关系

### 10.1 与 CapabilityFact 的关系

本地 `CapabilityFact`（存储在 `capability_facts.jsonl`）是原始事实，包含 session/run 级引用。

`PublicCapabilityFact` 是从多个本地 facts 聚合并去身份化后的上报对象。

映射关系为多对一：多个本地 facts 蒸馏成一个 public fact。

### 10.2 与 SkillTrace 的关系

`SkillTrace` 是 run 级别的 skill 参与记录。蒸馏引擎从 `SkillTrace` 集合中计算出：

- skill 的 success_rate
- skill 的 contribution 分布
- skill 组合的协同效果
- 失败模式分类

这些计算结果最终产出 `PublicCapabilityFact`。

### 10.3 与 feature flag 的关系

当前在 `ManagerFeatureFlags` 中预留：

```typescript
public_fact_submission: boolean;
```

默认 `false`。只有显式启用后，蒸馏引擎才会写 outbox。

## 11. 当前阶段不做的事

- 不搭建真实公域服务器
- 不实现跨节点聚合查询
- 不实现自动定时提交
- 不实现 scenario_signature 的自动推断
- 不实现 public fact 的版本迁移
- 不实现 reputation score 或排行榜算法

## 12. 当前阶段的验收要求

至少应覆盖：

### A-01 本地蒸馏产出

- session 闭环后能产出至少一个 `PublicCapabilityFact`
- 产出内容不包含任何 session/run/user 标识

### A-02 Outbox 写入

- 蒸馏结果写入 `pending/` 目录
- batch 文件格式正确
- batch 内 facts 通过 schema validation

### A-03 Mock 提交

- mock 提交服务能读取 pending batch
- mock 提交成功后移入 `submitted/`
- 重复 batch_id 被幂等处理

### A-04 隐私守卫

- 自动化测试扫描 outbox 内容
- 不允许出现 `sess_`、`run_`、`evt_` 前缀的字符串
- 不允许出现 `user_` 或 `owner` 字段
