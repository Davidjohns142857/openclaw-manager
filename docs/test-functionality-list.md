# Test Functionality List

本文档汇总仓库从项目启动到当前为止已经具备的自动化测试与校验能力，按“功能覆盖”而不是按文件名组织，方便继续补独立测试。

## 1. 静态可信化与结构门槛

### 1.1 结构存在性校验

入口：

- `node scripts/verify-structure.ts`

当前覆盖：

- 核心 README / `skill.yaml`
- MVP / host integration 等关键文档
- 核心 schemas
- `src/main.ts`
- API / control plane / store / schema registry
- host-side sidecar client
- skill 包入口

用途：

- 防止关键骨架文件被删掉或漂移出仓库

### 1.2 TypeScript 类型校验

入口：

- `npm run typecheck`

当前覆盖：

- 全仓 TypeScript 编译期类型闭合
- 模块导入、接口拼接、返回值一致性

用途：

- 发现接口改动后的隐性断裂

## 2. Smoke 流程

入口：

- `npm run smoke`

当前覆盖：

- adopt session
- resume session
- focus
- digest
- inbound message
- duplicate inbound
- share snapshot
- close session
- list tasks

用途：

- 快速确认 control plane 主流程没有整体性崩坏

## 3. Phase 1 Acceptance Suites

入口：

- `npm run test:acceptance`

### 3.1 边界与静态契约

文件：

- [`tests/phase1.static-boundary.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.static-boundary.test.ts)

当前覆盖：

- command registry 与 `skill.yaml`、`SKILL.md` 同步
- 所有 shipped schema 都能被 JSON 解析
- server route layer 返回 canonical `session.activity`
- `/adopt`、`/inbound-message`、`/resume`、`/checkpoint`、`/close` 的路由层边界成立
- fs-store 对违反 schema 的写入会拒绝

适合继续补的独立测试方向：

- serializer shape 的更细粒度 contract
- schema version 兼容
- command 文档漂移检测

### 3.2 主链路 E2E

文件：

- [`tests/phase1.e2e.acceptance.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.e2e.acceptance.test.ts)

当前覆盖：

- `adopt -> durable artifacts -> resume -> close`
- session/run/checkpoint/summary/attention 等关键文件落盘
- 恢复不依赖历史 replay
- committed checkpoint 对恢复是 authoritative

适合继续补的独立测试方向：

- 多 run session 的恢复选择
- abandon / completed 分叉
- share snapshot 对 closed session 的行为

### 3.3 协议边界与破坏性测试

文件：

- [`tests/phase1.protocol-destructive.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.protocol-destructive.test.ts)

当前覆盖：

- sequential duplicate `request_id` 幂等
- concurrent duplicate `request_id` 不会双写事件
- concurrent distinct inbound 不会丢失 queued request_id / `pending_inbound_count`
- concurrent distinct inbound 在可 auto-continue 的 session 上只会启动 1 个新 run
- checkpoint/summary 写入失败时不会留下 torn recovery artifacts

适合继续补的独立测试方向：

- 更高并发下的 inbox claim
- read path 对 stale / corrupted recovery head 的处理
- connector metadata 异常值

### 3.4 注意力压缩

文件：

- [`tests/phase1.attention.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.attention.test.ts)

当前覆盖：

- 同一个 noisy session 在 `focus` 中最多压成 1 项

适合继续补的独立测试方向：

- 多 session 混合排序
- blocker / waiting_human / stale 信号冲突时的行为

### 3.5 宿主最薄真实接入

文件：

- [`tests/phase1.host-integration.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.host-integration.test.ts)

当前覆盖：

- 真实 HTTP `adopt -> tasks -> checkpoint -> resume -> close`
- host-side command executor 不直接依赖 control-plane internals
- sidecar client 是 canonical host boundary
- host-side client 已具备 4 个 reserved decision / blocker typed methods，且不要求同步进入 command surface

适合继续补的独立测试方向：

- sidecar 不可用时的 host 错误语义
- `/commands` 与 client 能力对齐
- host rendering 对 `session.activity` 的最小使用约束

### 3.6 Host Message Admission

文件：

- [`tests/phase1.host-admission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.host-admission.test.ts)

当前覆盖：

- hostContext 会聚合关键词、结构信号、active session 数、focus backlog
- 精确 `source_thread` 匹配可进入 direct manager ingress
- 精确 `source_thread` 但缺少 `message_id` 时会降级为 suggestion
- 语义相似但无精确 source-thread 绑定时，只允许 `suggest_adopt`
- 缺少稳定 source-thread id 时，suggestion 不会偷偷写 Manager
- 缺少稳定 `message_id` 时，suggestion 也不会偷偷写 Manager
- `direct_adopt` 会通过 canonical `adopt + inbound-message` 真正导入原始宿主消息
- 同 source-thread 的 follow-up message 会进入已有 session，而不是重复 adopt
- 同一条宿主消息 retry 时，如果 `source_type + source_thread_key + message_id` 不变，不会创建第二个 session，也不会重复写入 `message_received`

适合继续补的独立测试方向：

- host message retry 的更强幂等性
- richer source-type policies
- admission 对 overloaded focus 的降级策略
### 3.7 交互语义合同

文件：

- [`tests/phase1.interaction-contract.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.interaction-contract.test.ts)

当前覆盖：

- `session.activity` 的 run / queue / summary 投影
- `focus` 的 primary category precedence
- `focus` 的 merged category metadata
- `focus` 的跨 session 排序基础语义

适合继续补的独立测试方向：

- terminal session 在 focus 中的排除
- `desynced` 与 active run 的边界
- `activity.run.phase` 对 terminal run 的语义

### 3.8 Human Decision / Blocker 合同

文件：

- [`tests/phase1.decision-blocker-contract.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.decision-blocker-contract.test.ts)

当前覆盖：

- `waiting_human` session 收到 inbound 时会 queue，而不是 auto-start run
- `blocked` session 收到 inbound 时会 queue，而不是 auto-start run
- checkpoint / resume 会恢复 blocker 与 pending decision 的结构化状态
- `close` 会清理 blocker / pending decision / queued inbound 噪音，不把它们带进 terminal checkpoint

适合继续补的独立测试方向：

- future resolve / clear API 的事件与状态投影
- failed-run 导致 blocked 的投影是否需要实体 blocker

### 3.9 Reserved API Contracts

文件：

- [`tests/phase1.api-contracts.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.api-contracts.test.ts)

当前覆盖：

- `GET /contracts` 暴露 4 个 reserved decision / blocker mutation contracts
- 每个 contract 都带 machine-readable method/path/request_fields/response_envelope/invariants/docs
- contract 文档与 boundary 文档对齐

适合继续补的独立测试方向：

- reserved contract 升级到 implemented 时的兼容性检查
- `/contracts` 中 implemented 与 reserved contract 的混排策略
- host/client 对 `/contracts` 的消费方式

### 3.10 Feature-Gated Reserved Mutation Routes

文件：

- [`tests/phase1.reserved-contract-routes.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.reserved-contract-routes.test.ts)

当前覆盖：

- 4 个 reserved routes 在 flag 关闭时返回 `501/not_enabled` 且保持 canonical envelope
- `human_decision_requested` 在 flag 打开时只做 event + 轻量 session metadata + focus 重算
- `blocker_detected` 在 flag 打开时只做 event + 轻量 session metadata + focus 重算
- 不会自动创建新 run，也不会改写 committed checkpoint

适合继续补的独立测试方向：

- `resolved/cleared` 的最薄 mutation 验收
- 400 schema validation 分支
- duplicate decision_id / blocker_id 的 rejected 语义

### 3.11 Connector Binding And External Source Integration

文件：

- [`tests/phase2.connector-binding.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.connector-binding.test.ts)

当前覆盖：

- `/bind` 会写 durable binding registry，并把 source channel 投影回 session
- 同 session / same source pair 的重复绑定是幂等的
- `POST /inbound-message` 在缺少 `target_session_id` 时可通过 active binding 解析 session
- binding conflict 会拒绝 cross-session 抢占
- 未绑定 source 在缺少 `target_session_id` 时返回 `404`
- `/bind` 已进入 command surface，但实现仍然只走 canonical sidecar HTTP
- `/bindings/:binding_id/disable` 会停用 active binding，但保留 durable 记录
- `/bindings/:binding_id/rebind` 会把 source ownership 受控移动到新 session
- `GET /bindings` 支持按 `status/session/source_type` 做最小筛选
- unchanged binding registry 的 hot-path read 会复用已校验缓存，而不是每次全量重新校验

适合继续补的独立测试方向：

- connector polling/webhook adapter contract
- 多 connector 同 session 的 source-channel 管理
- same-session disabled binding reactivation

### 3.12 GitHub Connector Adapter

文件：

- [`tests/phase2.github-connector.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.github-connector.test.ts)

当前覆盖：

- GitHub `issue_comment` webhook 可归一化为 canonical inbound 并通过 binding 路由进 session
- 重复 `X-GitHub-Delivery` 不会重复写 `message_received`
- `ping` 和不支持的 event/action 会被 `202 ignored`
- GitHub thread key 与 generic binding registry 可以协同工作

适合继续补的独立测试方向：

- signature verification
- `issues` / `issue_comment` 以外的 GitHub event 覆盖
- PR review / discussion thread 归一化

### 3.13 Browser Connector Adapter

文件：

- [`tests/phase2.browser-connector.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.browser-connector.test.ts)

当前覆盖：

- 浏览器插件消息可以归一化为 canonical inbound 并通过 binding 路由进已有 session
- 重复 `source_thread_key + message_id` 不会重复写 `message_received`
- 缺少稳定 `source_thread_key` 的 payload 会被拒绝
- 未绑定的浏览器 thread 不会隐式创建 session

适合继续补的独立测试方向：

- browser tab rebinding / disable lifecycle
- richer page-context payload normalization
- browser-side retry/backoff contract

### 3.14 Run Lifecycle And Evidence

文件：

- [`tests/phase2.run-lifecycle.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.run-lifecycle.test.ts)
- [`docs/run-guarantees.md`](/Users/yangshangqing/metaclaw/docs/run-guarantees.md)

当前覆盖：

- `waiting_human` run 会作为真实 paused-terminal 状态结束，并推进 recovery head
- `waiting_human` / `blocked` / `failed` / `completed` / `cancelled` / `superseded` 与 `outcome.result_type` 的 canonical 映射被显式校验
- `completed` 只允许 `completed / partial_progress / no_op`，并且 `partial_progress` / `no_op` 的 `closure_contribution` 语义固定
- `paused` run 在 checkpoint 之后收到新的 inbound backlog 时，`resume` 仍会保留 queue，并在 `focus` 中折叠为 `waiting_human/blocked + desynced + summary_drift`
- `completed` run 会推进 recovery head、保持 quiet focus，并在下一次 `resume` 时作为新 run 的 `start_checkpoint_ref`
- `failed` run 不会推进 recovery head，且与 `blocked` 保持不同语义；重复失败会在 `focus` 中升级为 `blocked`
- `cancelled` / `superseded` run 不会推进 recovery head，但 `resume` 仍会从最近 committed checkpoint 启动下一次 run
- `transitionRun` 具备状态转移守卫，不允许 terminal run 被直接改回 `running`
- `superseded` 会发出专门的 `run_superseded` 事件，而不是混入通用 `run_status_changed`
- 当更近的 failed run 存在自己的 recovery checkpoint 时，`resume` 仍优先选择最近一次 terminal head，而不是盲目跟随最新 run
- run 会稳定关联 `events_ref`、`skill_traces_ref`、`spool_ref`、`checkpoint`、`summary`、`artifact_refs`

适合继续补的独立测试方向：

- run-level artifact export / evidence snapshot
- run trigger 统计与 capability facts 的联动

### 3.15 Session Status Derivation

文件：

- [`tests/phase2.session-status-derivation.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.session-status-derivation.test.ts)
- [`docs/session-status-derivation.md`](/Users/yangshangqing/metaclaw/docs/session-status-derivation.md)

当前覆盖：

- paused run 会把 `session.status` 投影成 `waiting_human` / `blocked`
- unresolved decision / blocker facts 会投影 `session.status`，但不改变 run state
- `session.status_reason` 能说明当前 summary status 来自 paused run、decision 还是 blocker

适合继续补的独立测试方向：

- session status precedence 冲突矩阵
- terminal session vs paused run 的优先级
- share / export 面对 `status_reason` 的呈现

### 3.16 Run Timeline And Evidence View

文件：

- [`tests/phase2.timeline.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.timeline.test.ts)
- [`docs/run-timeline-contract.md`](/Users/yangshangqing/metaclaw/docs/run-timeline-contract.md)

当前覆盖：

- `GET /sessions/:session_id/timeline` 返回稳定的 `session_run_timeline_v1`
- timeline 能按 run 回答 trigger、status flow、outcome
- timeline 会暴露每个 run 的 committed checkpoint 摘要与 terminal head marker
- timeline 会暴露每个 run 的最小 evidence refs 与计数

适合继续补的独立测试方向：

- session-level timeline markdown export
- richer run milestone events beyond status-flow
- evidence snapshot bundling

## 4. 当前自动化校验总表

截至当前，仓库内已有的自动化校验入口包括：

- `node scripts/verify-structure.ts`
- `npm run typecheck`
- `npm run smoke`
- `npm run test:acceptance`

## 5. 当前已被覆盖的功能域

已覆盖：

- 核心文件结构
- 类型与模块接口闭合
- command / skill / server 边界
- session 主链路生命周期
- checkpoint-authoritative recovery
- inbound-message 幂等与并发 claim
- torn write 防护
- focus 压缩
- host HTTP 接入
- host message admission
- connector binding registry
- binding disable / rebind lifecycle
- binding-aware external inbound resolution
- first real GitHub connector adapter
- browser-plugin ingress adapter
- run lifecycle and evidence refs
- session status derivation
- run timeline and evidence view
- `session.activity` 与 `focus` 的基础交互语义
- reserved decision/blocker API registry
- feature-gated reserved mutation routes

尚适合补强：

- 多 run 复杂生命周期
- share / export 更细致的 artifact contract
- corrupted state / repair path
- richer host failure handling
- connector normalization 的异常输入矩阵
