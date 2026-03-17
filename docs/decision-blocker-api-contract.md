# Decision / Blocker Minimal API Contract

本文档定义 `ysq` 当前阶段为 human decision / blocker 预留的最小 HTTP API contract。

目标是：

- 先把协议面固定住
- 让后续实现者可以并行开发而不再猜测 endpoint 形状
- 明确这些 contract 当前是 `reserved`，不是已经完整实现的产品功能

## 1. Contract Status

当前 4 个 mutation contract 的状态统一为：

- `contract_state = reserved`
- `owner = ysq`
- `response_envelope = session_detail`

这表示：

- 路由和 payload 语义已被定义
- 真正的状态变更实现仍可后续落地
- 后续实现必须遵守这里的 request / response / invariant

机器可读出口：

- `GET /contracts`

## 2. Reserved Endpoints

### 2.1 Request Human Decision

- `POST /sessions/:session_id/decisions`

用途：

- 为某个 session 增加一个结构化 pending human decision

最小请求体：

```json
{
  "summary": "Need a go/no-go decision for the next step.",
  "urgency": "high"
}
```

允许字段：

- `decision_id?`
- `summary`
- `urgency?`
- `requested_by_ref?`
- `requested_at?`
- `next_human_actions?`
- `metadata?`

预期事件：

- `human_decision_requested`

### 2.2 Resolve Human Decision

- `POST /sessions/:session_id/decisions/:decision_id/resolve`

用途：

- 将一个结构化 pending decision 标记为已解决

最小请求体：

```json
{
  "resolution_summary": "User approved the next step."
}
```

允许字段：

- `resolution_summary`
- `resolved_by_ref?`
- `resolved_at?`
- `next_machine_actions?`
- `next_human_actions?`
- `metadata?`

预期事件：

- `human_decision_resolved`

### 2.3 Detect Blocker

- `POST /sessions/:session_id/blockers`

用途：

- 为某个 session 增加一个结构化 blocker

最小请求体：

```json
{
  "type": "external_dependency",
  "summary": "Need upstream approval before continuing.",
  "severity": "high"
}
```

允许字段：

- `blocker_id?`
- `type`
- `summary`
- `severity?`
- `detected_by_ref?`
- `detected_at?`
- `next_human_actions?`
- `metadata?`

预期事件：

- `blocker_detected`

### 2.4 Clear Blocker

- `POST /sessions/:session_id/blockers/:blocker_id/clear`

用途：

- 将一个结构化 blocker 标记为已清除

最小请求体：

```json
{
  "resolution_summary": "Approval arrived and execution can continue."
}
```

允许字段：

- `resolution_summary`
- `cleared_by_ref?`
- `cleared_at?`
- `next_machine_actions?`
- `next_human_actions?`
- `metadata?`

预期事件：

- `blocker_cleared`

## 3. Canonical Response Rule

4 个 reserved mutation contract 未来落地时都必须返回：

- canonical `session_detail` envelope

也就是：

- `session`
- `run`
- `checkpoint`
- `summary`

其中：

- `session` 是当前 canonical state
- `checkpoint` 是最近 committed recovery head
- 客户端不能假设服务端已把 checkpoint 回填进 `session`

## 4. Non-Negotiable Invariants

后续实现时必须保持：

### 4.1 Structured object only

- decision / blocker 必须是结构化对象
- 不能退回为自由文本备注

### 4.2 Recovery relevance

- 它们必须进入 committed checkpoint
- `resume` 必须能恢复它们

### 4.3 Auto-continue guard

- open decision 会阻止 auto-continue
- open blocker 会阻止 auto-continue

### 4.4 Canonical read surface

- mutation 生效后，对宿主可见的结果仍通过 canonical `session` 和 `focus` 暴露
- 客户端不要自己再维护一套 decision/blocker lifecycle

## 5. 与命令面的关系

当前阶段：

- 这些 contract 先作为 HTTP API contract 保留
- 暂不强制暴露新的 OpenClaw 命令

原因：

- `ysq` 先固定协议、状态语义与验收边界
- 命令面是否需要 `/decision`、`/blocker` 这类入口，可以在下一阶段再决定

## 6. 验收口径

当前阶段至少要验证：

- `GET /contracts` 能暴露这 4 个 reserved contracts
- 每个 contract 都带 method/path/request_fields/response_envelope/invariants/docs
- contract 文档与 machine-readable registry 一致
