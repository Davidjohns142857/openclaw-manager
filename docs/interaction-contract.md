# Session Activity And Focus Contract

本文档定义当前 Phase 1.5 阶段由 `ysq` 维护的交互语义合同。

它解决两个问题：

1. `session.activity` 到底表达什么，不表达什么
2. `focus` 如何把底层状态压缩成对人类真正有用的 next action

这份文档属于高风险契约文档。任何会改变 host 呈现、attention 判断、human decision 语义的变更，都应先更新这里，再更新实现与验收。

## 1. 交互层分工

当前交互层有两个不同职责的 surface：

- `session.activity`：给宿主和列表页使用的最小高层状态合同
- `focus`：给人类决策使用的注意力压缩面

不要混用它们。

### 1.1 `session.activity` 不是 attention queue

`session.activity` 只回答三类问题：

- 当前有没有活跃 run
- 当前有没有待处理 inbound queue
- 当前 summary 是 fresh 还是 stale

它不直接表达：

- human decision 的具体内容
- blocker 的具体原因
- stale / desynced / summary drift 的优先级排序

这些属于 `focus` 的职责。

## 2. `session.activity` 合同

`session.detail` 读面返回的是 **当前 canonical session state**。  
如果客户端还需要最近一次 committed recovery head，应读取同一 envelope 中单独提供的 `checkpoint` 字段，而不是假设 `session` 已被 checkpoint 回填。

当前服务端返回的 `session.activity` 结构为：

```json
{
  "run": {
    "state": "running | idle",
    "phase": "accepted | queued | running | waiting_human | blocked | completed | failed | cancelled | superseded | idle"
  },
  "queue": {
    "state": "pending | idle",
    "count": 0
  },
  "summary": {
    "state": "fresh | stale"
  }
}
```

### 2.1 `activity.run.state`

- `running`：`session.active_run_id` 指向当前返回的 run，说明系统认为该 session 仍有活跃执行
- `idle`：当前没有活跃 run

### 2.2 `activity.run.phase`

- 若存在最新 run，则返回该 run 的 authoritative status
- 若根本没有 run，则返回 `idle`

因此允许出现：

- `state=idle, phase=completed`
- `state=idle, phase=failed`

这表示“当前没有活跃 run，但最近一次 run 的终态是 ...”。

### 2.3 `activity.queue`

- `count` 来自 `session.state.pending_external_inputs.length`
- `state=pending` 当且仅当 `count > 0`

这里表达的是“有待消费的标准化外部输入”，不是消息总量。

### 2.4 `activity.summary`

- `fresh`：当前 `summary.md` 与结构化状态一致
- `stale`：结构化状态已变化，summary 需要刷新

它由服务端 `summary_needs_refresh` 推导，宿主不要自行猜测。

## 3. Focus 合同

`focus` 的目标不是罗列日志，而是给出：

- 哪个 session 现在最值得你处理
- 为什么值得处理
- 你下一步应该做什么

### 3.1 支持的注意力类别

当前 Phase 1 规范化支持 5 类 attention：

- `waiting_human`
- `blocked`
- `desynced`
- `stale`
- `summary_drift`

### 3.2 每类的产品含义

`waiting_human`

- 含义：session 需要明确的人类决策才能继续
- 触发：`pending_human_decisions` 非空，或 `session.status=waiting_human`

`blocked`

- 含义：session 已被明确阻塞，或失败模式已经足以说明它卡住了
- 触发：`blockers` 非空，或 `session.status=blocked`，或 `failed_run_count >= 2`

`desynced`

- 含义：外部消息已经进入系统，但没有活跃 run 在消费它
- 触发：`pending_inbound_count > 0` 且 `!active_run_id`

`stale`

- 含义：session 太久没有有效推进，需要决定是恢复、关闭还是忽略
- 触发：`last_activity_at` 距今至少 24h

`summary_drift`

- 含义：结构化状态已变化，但 summary 还没刷新
- 触发：`summary_needs_refresh = true`

## 4. 同一 Session 的压缩规则

`focus` 不应把同一个 session 拆成很多噪音项。

当前规则：

- 每个 session 最多产出 1 个 primary attention item
- 其他信号折叠到该 item 的 `metadata.merged_categories`

### 4.1 Primary category precedence

当一个 session 同时满足多个信号时，primary category 采用固定优先级：

1. `waiting_human`
2. `blocked`
3. `desynced`
4. `stale`
5. `summary_drift`

这样做的原因是：

- 优先展示最可行动的人类介入点
- 避免 `blocked`、`stale`、`summary_drift` 抢走真正应先处理的 human decision

### 4.2 Merged metadata

压缩后的 attention item 必须保留：

- `metadata.primary_category_rule`
- `metadata.merged_categories`

这样客户端或后续 evidence 面可以看到这个 session 其实同时具备哪些风险信号。

## 5. 跨 Session 的排序规则

在每个 session 先被压成 1 项之后，attention queue 再按：

1. `attention_priority` 从高到低
2. `created_at` 从新到旧

排序。

这意味着：

- 同一 session 内，先讲“什么最值得处理”
- 不同 session 之间，再讲“哪一个先处理”

## 6. 宿主层的使用规则

宿主层应遵守：

- 列表视图优先看 `session.activity`
- 决策视图优先看 `focus`
- 不要用 `session.status` 本地重建 attention
- 不要在客户端自己复制 stale / blocked / desynced 规则

## 7. 验收要求

当前这份合同至少要被以下验收覆盖：

- `session.activity` 的 run / queue / summary 投影
- `focus` 的 per-session collapse
- `focus` 的 primary category precedence
- `focus` 的 merged category metadata
- `focus` 的跨 session 排序基本正确
