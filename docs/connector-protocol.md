# Connector Protocol

本文档定义 Phase 2 起点的 connector / binding / external-source integration 边界。

目标不是现在就做厚平台适配器，而是先把三件事立住：

- source binding registry 是 durable 一等对象
- connector 可以通过 binding 把外部线程稳定映射到 session
- manager 仍然只接收 canonical inbound contract，而不吃平台私有语义

## 1. Durable Binding Registry

binding registry 当前落在：

- `connectors/bindings.json`

每条 binding 至少包含：

- `binding_id`
- `source_type`
- `source_thread_key`
- `session_id`
- `status`
- `created_at`
- `updated_at`
- `metadata`

约束：

- 同一个 `source_type + source_thread_key` 最多只能绑定到一个 active session
- 同 session / same source pair 的重复 `/bind` 是幂等的
- 如果另一个 session 想抢同一个 source thread，必须返回 conflict，而不是隐式改绑

## 2. Canonical Binding API

当前最小 API：

- `GET /bindings`
- `POST /bind`

`POST /bind` 请求体：

```json
{
  "session_id": "sess_...",
  "source_type": "telegram",
  "source_thread_key": "tg_thread_123",
  "metadata": {}
}
```

返回：

- `binding`
- `created`
- canonical `session_detail`

其中：

- `created=true` 表示首次建立 active binding
- `created=false` 表示同 session 的重复绑定请求，被幂等吸收

## 3. Binding-Aware Inbound

当前 canonical ingress 仍然是：

- `POST /inbound-message`

但现在它支持两种模式：

### 3.1 Explicit target mode

connector 已明确知道 `target_session_id`：

```json
{
  "request_id": "req_...",
  "source_type": "telegram",
  "source_thread_key": "tg_thread_123",
  "target_session_id": "sess_...",
  "message_type": "user_message",
  "content": "..."
}
```

### 3.2 Binding-aware mode

connector 只提供 source metadata，由 sidecar 通过 binding 解析 session：

```json
{
  "request_id": "req_...",
  "source_type": "telegram",
  "source_thread_key": "tg_thread_123",
  "message_type": "user_message",
  "content": "..."
}
```

解析规则：

- 有 binding 且无显式 target：自动路由到 bound session
- 有 binding 且显式 target 一致：允许
- 有 binding 但显式 target 不一致：返回 conflict
- 无 binding 且无显式 target：返回 not found

## 4. Core Boundary

connector 层可以知道：

- 来源平台
- 平台线程标识
- webhook / polling / auth
- 平台原始 payload

control plane 不应该知道：

- Telegram reply markup
- 企业微信回调结构
- 邮件线程渲染细节
- GitHub webhook 原始事件语义

control plane 只知道：

- `source_type`
- `source_thread_key`
- 该消息最终归属哪个 session
- 该消息是否触发新的 run

## 5. 当前阶段不做的事

当前这轮 Phase 2 foundation 不做：

- 真正的 Telegram / 企业微信 / 邮件 adapter
- webhook auth / polling runtime
- 自动新建 session 的 source-aware policy
- 多 binding merge / split
- 跨 connector 的复杂 dedup

当前仓库里已经有两条真实 adapter：

- GitHub webhook adapter，见 [`docs/github-connector.md`](/Users/yangshangqing/metaclaw/docs/github-connector.md)
- Browser plugin ingress adapter，见 [`docs/browser-connector.md`](/Users/yangshangqing/metaclaw/docs/browser-connector.md)

## 6. 当前阶段的结论

这层 foundation 的目的，是先让 external-source integration 有稳定骨架：

- 先把 binding 做成 durable registry
- 再让 inbound 支持 binding-aware resolution
- 最后再往上接具体 connector
