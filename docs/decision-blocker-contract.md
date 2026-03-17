# Human Decision And Blocker Contract

本文档定义当前阶段 `PendingHumanDecision` 与 `Blocker` 的最小产品语义和生命周期约束。

它的目标不是立刻把完整 workflow API 做出来，而是先把这些对象在系统中的地位固定住，避免后续工程扩面时出现：

- 把 blocker 当成普通备注
- 把 human decision 当成自由文本
- 客户端和服务端各自理解不同
- 恢复时只恢复 session 主体，不恢复真正卡住任务的原因

## 1. 对象定位

### 1.1 PendingHumanDecision

`PendingHumanDecision` 表示：

- 系统已经明确知道“下一步需要人决定”
- 没有这个决定，任务不应自动继续

它不是：

- 任意 human-facing note
- 日志里的随手提问
- 只是“可能需要人看一下”的弱提醒

### 1.2 Blocker

`Blocker` 表示：

- session 已被明确阻塞
- 继续运行不会自然解除该问题

它可以是：

- 外部依赖未满足
- 上游审批缺失
- 关键输入缺失
- 重复失败后需要改策略

它不是：

- 普通风险提示
- 低优先级 TODO

## 2. 当前阶段的最小生命周期

当前 Phase 1.5 先固定“对象语义”和“状态投影”，不强制立即提供完整 mutation API。

### 2.1 Request / Detect

当系统发现：

- 需要人给一个明确选择
- 或任务已被阻塞

就应把对应对象写入：

- `session.state.pending_human_decisions`
- `session.state.blockers`

同时要求：

- `session.metadata.summary_needs_refresh = true`
- 后续 checkpoint 必须把这些对象写入 recovery head

### 2.2 Open State

只要对象还在对应数组中，就认为它仍是“开放状态”。

开放状态下的规则：

- `pending_human_decisions.length > 0` 时，session 不应 auto-continue
- `blockers.length > 0` 时，session 不应 auto-continue
- 新的 inbound message 可以进入 queue，但不应偷偷启动 run 来跳过这些对象

### 2.3 Resolve / Clear

当 decision 被明确解决，或 blocker 被解除时：

- 应从对应数组中移除
- 下一次 summary / checkpoint 应反映该变化

当前阶段尚未要求必须提供独立 HTTP mutation endpoint；但语义上必须预留：

- `human_decision_requested`
- `human_decision_resolved`
- `blocker_detected`
- `blocker_cleared`

这几个事件类型已经属于 canonical event vocabulary。

对应的最小 HTTP contract 定义见：

- [decision-blocker-api-contract.md](/Users/yangshangqing/metaclaw/docs/decision-blocker-api-contract.md)

## 3. 与 Session Status 的关系

当前产品语义要求以下投影顺序：

1. 只要存在 `pending_human_decisions`，优先投影为 `waiting_human`
2. 若不存在 pending decisions，但存在 blockers，则投影为 `blocked`
3. 若二者都不存在，session 才可能回到 `active`

这里的原则是：

- 优先表达最可行动的人类介入点
- 不让 blocker 抢走本应先决策的状态

## 4. 与 Inbound Message 的关系

当 session 已处于 waiting-human / blocked 语义时，新的 inbound message：

- 仍然要被 canonical ingress 接收
- 仍然要写入 message facts
- 仍然要进入 `pending_external_inputs`

但默认不应：

- 自动开启新 run
- 自动清空 pending decision
- 自动清空 blocker

换句话说：

> inbound arrival 是新输入，不是自动解锁器。

## 5. 与 Recovery 的关系

`PendingHumanDecision` 与 `Blocker` 都是 recovery-relevant state。

这意味着：

- committed `checkpoint.json` 必须包含它们
- `summary.md` 必须能把它们翻译成人类可读摘要
- `resume` 时若 checkpoint 中存在它们，恢复后的 session 也必须回到对应状态

系统不允许出现：

- summary 里看得到 decision/blocker，但 checkpoint 没有
- checkpoint 有 decision/blocker，但 resume 后丢失

## 6. 当前阶段的验收要求

至少应覆盖以下几类测试：

### A-01 waiting_human blocks auto-continue

- session 带 pending decision
- inbound message 到达
- 结果应 queued，不应自动 start run

### A-02 blocked blocks auto-continue

- session 带 blocker
- inbound message 到达
- 结果应 queued，不应自动 start run

### A-03 checkpoint restores decision and blocker state

- checkpoint 写入后，即使 mutable session state 漂移
- `resume` 仍应从 committed checkpoint 恢复 blocker / decision

## 7. 对后续 API 设计的约束

后续无论是 `zephyr` 还是 `ysq` 增加 dedicated endpoint / command，都不能破坏以下事实：

- decision 和 blocker 是结构化对象，不是备注文本
- 它们会阻止 auto-continue
- 它们属于 recovery-authoritative state
- 它们会投影到派生后的 `session.status`、`session.status_reason` 与 `focus`
