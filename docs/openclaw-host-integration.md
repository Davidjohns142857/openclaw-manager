# OpenClaw Thin Host Integration Contract

本文档定义当前阶段由 `ysq` 负责的“OpenClaw 最薄真实接入”边界。

目标不是在宿主侧做一个复杂 runtime，而是把 OpenClaw 命令入口收紧成一层 **薄、真、可验收** 的 host adapter：

- 从 OpenClaw 视角看，它就是一个可调用的 skill
- 从系统边界看，它只通过本地 sidecar HTTP 访问 canonical state
- 从工程约束看，它不重写 control plane，也不在宿主侧偷偷维护第二套状态

## 1. 当前阶段的接入定义

Phase 1 之后的受控扩面阶段，宿主接入只做三件事：

1. 发现或定位本地 sidecar
2. 通过 HTTP 调用 canonical commands / reads / mutations
3. 把 sidecar 返回的 canonical payload 翻译成宿主可展示的命令结果

当前不做：

- 在宿主侧缓存 durable truth
- 在宿主侧直接读写 `.openclaw-manager-state/`
- 在宿主侧复刻 run/session 生命周期逻辑
- 为了“体验更顺”而绕开 `session.activity`

## 2. 边界原则

### 2.1 Host is thin

宿主层只负责：

- 命令入口
- 参数组装
- sidecar 可用性检查
- 错误透传或降级提示

宿主层不负责：

- durable state 判定
- run 状态机
- checkpoint / summary 恢复逻辑
- attention 推导

### 2.2 HTTP is canonical

OpenClaw 命令进入 Manager 后，应默认走本地 sidecar HTTP API。

当前 canonical path：

- `GET /health`
- `GET /commands`
- `GET /sessions`
- `GET /sessions/:session_id`
- `GET /focus`
- `GET /digest`
- `POST /adopt`
- `POST /sessions/:session_id/resume`
- `POST /sessions/:session_id/checkpoint`
- `POST /sessions/:session_id/share`
- `POST /sessions/:session_id/close`
- `POST /inbound-message`

这意味着：

- host code 不应直接 import `ControlPlane`
- host code 不应直接 import `FilesystemStore`
- host code 不应自行推导高层状态

### 2.3 session.activity is the only high-level host contract

宿主侧高层状态展示应只依赖 server-authored 的 `session.activity`：

- `activity.run.state`
- `activity.run.phase`
- `activity.queue.state`
- `activity.queue.count`
- `activity.summary.state`

不要在宿主侧发明“如果 run.status=... 就显示 ...”这类本地派生语义。

补充约束：

- session detail envelope 中的 `session` 表示当前 canonical session state
- `checkpoint` 表示最近一次 committed recovery head
- 宿主不要假设服务端已经把 checkpoint 回填进 `session`

## 3. Phase 1.5 最薄落地形态

当前推荐的接入实现非常克制：

- 一个 `ManagerSidecarClient`
- 一个 `executeManagerCommand(...)`
- 一层独立于 command surface 的 host message admission
- 一套稳定的命令到 HTTP endpoint 映射

对应代码：

- Client: [`src/skill/sidecar-client.ts`](/Users/yangshangqing/metaclaw/src/skill/sidecar-client.ts)
- Command executor: [`src/skill/commands.ts`](/Users/yangshangqing/metaclaw/src/skill/commands.ts)
- Host admission: [`docs/host-message-admission.md`](/Users/yangshangqing/metaclaw/docs/host-message-admission.md)

当前 host-side client 还额外暴露了 4 个 reserved decision / blocker typed methods：

- `requestHumanDecision(...)`
- `resolveHumanDecision(...)`
- `detectBlocker(...)`
- `clearBlocker(...)`

这些是 HTTP client capability，不等于已经进入 OpenClaw command surface。

普通宿主消息的 capture / admission 也不进入 command surface；它是另一层 host adapter，负责：

- 先做规则式判定
- 再决定 suggestion 或 direct ingress
- 最终仍只通过 canonical `/adopt` 与 `/inbound-message` 写入 Manager

对 direct ingress，当前要求宿主提供稳定 capture key 组件：

- `source_type`
- `source_thread_key`
- `message_id`

默认 base URL 解析规则：

1. 优先 `OPENCLAW_MANAGER_BASE_URL`
2. 否则回退到 `http://127.0.0.1:${OPENCLAW_MANAGER_PORT || 8791}`

这使得宿主侧可以保持无状态，同时仍是真实接入，而不是内存内 mock。

## 4. 启动与失败语义

Phase 1 当前接受的启动方式是：

- sidecar 由开发者或外部 wrapper 预先启动
- 宿主命令先做 `/health` 检查
- sidecar 不可用时，宿主返回明确错误，而不是 silently fallback 到本地逻辑

当前不要求在宿主层内自动拉起 sidecar 进程；这是后续增强项，不是这一阶段的强约束。

错误处理要求：

- sidecar 不可用：直接报 sidecar unavailable，不要降级到 direct import
- sidecar 返回非 2xx：保留 HTTP status 和服务端错误信息
- 输入参数缺失：在 command executor 层尽早失败

## 5. 命令映射规则

命令层应只是 endpoint wrapper：

- `/tasks` -> `GET /sessions`
- `/focus` -> `GET /focus`
- `/digest` -> `GET /digest`
- `/adopt` -> `POST /adopt`
- `/resume` -> `POST /sessions/:session_id/resume`
- `/checkpoint` -> `POST /sessions/:session_id/checkpoint`
- `/share` -> `POST /sessions/:session_id/share`
- `/close` -> `POST /sessions/:session_id/close`

如果命令层开始出现以下行为，就说明边界已经漂了：

- 自己决定 run 状态流转
- 自己拼 session detail
- 自己推断 attention priority
- 自己读磁盘恢复 summary / checkpoint

## 6. 对 zephyr 的明确边界

这部分接入层默认由 `ysq` 维护。`zephyr` 不应主动改写：

- host-side command executor
- sidecar client 基础契约
- 命令到 endpoint 的映射规则
- `session.activity` 作为宿主展示合同的地位

如果 zephyr 的工程扩面需要影响这些边界，必须先走 doc-first 变更。

## 7. 验收定义

宿主最薄真实接入至少要满足：

### A-01 真实 HTTP 主链路成立

必须能通过真实 HTTP 而非 direct import 跑通：

- `/adopt`
- `/tasks`
- `/checkpoint`
- `/resume`
- `/close`

### A-02 命令层不偷穿内核

skill command code 不应依赖：

- `control-plane`
- `fs-store`
- recovery internals

### A-03 Host state remains derived

宿主侧展示必须依赖 sidecar 返回：

- canonical session detail envelope
- `session.activity`

而不是在本地维护第二套 session/run 语义。

## 8. 当前阶段的结论

对 `ysq` 来说，最重要的不是把宿主做厚，而是把边界做实：

> 命令层必须真实走 sidecar，宿主层必须保持薄，系统真相必须留在 canonical core。

只要这个边界不漂，后续宿主自动拉起、hook、background maintenance 都可以继续加；如果这个边界先漂了，后续扩面只会把系统重新拖回“概念正确、工程不稳”。
