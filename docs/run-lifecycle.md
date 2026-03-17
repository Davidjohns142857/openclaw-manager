# Run Lifecycle

本文档定义当前阶段的 run 语义边界。

核心原则：

- run 不是 session 的流水号
- run 表示一次独立执行尝试
- run 必须有自己的 trigger、status、outcome、evidence refs
- run 结束后的 checkpoint 语义必须明确，不能靠调用方猜

## 1. Run 的职责

run 的第一职责是隔离单次执行。

每个 run 至少回答四个问题：

1. 这次执行是如何开始的
2. 这次执行当前处于什么状态
3. 这次执行为什么结束
4. 这次执行留下了哪些 evidence

## 2. Run Status 语义

当前 run status 语义分层如下：

- open：`accepted`、`queued`、`running`
- paused-terminal：`waiting_human`、`blocked`
- ended-terminal：`completed`、`failed`、`cancelled`、`superseded`

这里最重要的约束是：

- `waiting_human` 不是标签，而是一次 run 的暂停结束态
- `blocked` 不是 `failed` 的别名，而是可恢复但当前被阻塞的结束态
- `failed` 表示这次执行失败，但不自动等价于 session 被 block

### 2.1 Status 与 Outcome 的 canonical 映射

`status` 表示 run 在生命周期中的位置。  
`outcome.result_type` 表示这次执行留下的语义性结论。

当前阶段，这两者的 canonical 映射固定如下：

| run.status | allowed outcome.result_type | 说明 |
| --- | --- | --- |
| `waiting_human` | `waiting_human` | 命名与 status 对齐；不是历史遗留的 `awaiting_human` |
| `blocked` | `blocked` | run 因阻塞结束 |
| `completed` | `completed` / `partial_progress` / `no_op` | `completed` 是生命周期终态；语义结论再细分 |
| `failed` | `failed` | 失败不等于 blocked |
| `cancelled` | `null` | 需要 `reason_code` 解释为何取消 |
| `superseded` | `null` | 需要 `reason_code` 解释为何被替代 |

额外约束：

- `partial_progress` 和 `no_op` 只允许出现在 `status=completed`
- `cancelled` / `superseded` 不借用 `no_op`
- `waiting_human` / `blocked` / `failed` / `cancelled` / `superseded` 的 `closure_contribution` 为 `null`
- `completed` 的 `closure_contribution=1`
- `partial_progress` 的 `closure_contribution` 必须在 `(0, 1)` 之间
- `no_op` 的 `closure_contribution=0`
- session 被显式关闭但没有新增 closure 时，应使用 `status=completed + result_type=no_op`，而不是 `cancelled + no_op`

## 3. Trigger 语义

每个 run 都必须保留：

- `trigger_type`
- `trigger_ref`
- `request_id`
- `external_trigger_id`

当前 control plane 已把这些字段当成 durable run contract，而不是调用时临时附带的信息。

## 4. Checkpoint / Recovery Head 语义

run 与 checkpoint 的关系当前收紧为：

- `execution.start_checkpoint_ref`
  - run 开始前，session 已有的 trusted checkpoint
- `execution.recovery_checkpoint_ref`
  - 当前 run 最近一次成功写入并被 sidecar 信任的 recovery head
- `execution.end_checkpoint_ref`
  - 只有当 run 以允许推进 recovery head 的终态结束时，才会写入

当前 recovery head 推进策略：

- `completed`：允许推进
- `waiting_human`：允许推进
- `blocked`：允许推进
- `failed`：不允许推进
- `cancelled`：默认不作为一般 run lifecycle 的推进条件
- `superseded`：不允许推进

`resume` 或新的 run 开始时，`execution.start_checkpoint_ref` 的选择顺序固定为：

1. 最近一次 `end_checkpoint_ref != null` 的 run
2. 如果还没有任何推进过 head 的 run，再回退到最近一次 `recovery_checkpoint_ref != null` 的 run
3. 如果以上都不存在，则为 `null`

这意味着：

- paused run 的恢复是结构化恢复，不靠历史回放
- failed run 不会覆盖掉最后一个可信 checkpoint
- 已有 terminal head 时，failed / cancelled / superseded run 不会抢走下一次 `resume` 的起点
- paused run 结束后新进入的 durable inbound queue，`resume` 不会被旧 checkpoint 覆盖掉

## 5. Session Projection

session 仍是上层对象，但它现在只投影 run 的结果，不吞掉 run 语义：

- `waiting_human` run -> session 进入 `waiting_human`
- `blocked` run -> session 进入 `blocked`
- `failed` run -> session 保持可继续，但 `failed_run_count` 增加
- `completed` / `cancelled` / `superseded` run -> session 是否继续，由 session 自身状态决定

## 6. Minimal Evidence

当前 run 至少稳定关联这些 evidence refs：

- `execution.events_ref`
- `execution.skill_traces_ref`
- `execution.spool_ref`
- `execution.recovery_checkpoint_ref`
- `execution.end_checkpoint_ref`
- `execution.summary_ref`
- `execution.artifact_refs`

另外还有：

- `execution.invoked_skills`
- `execution.invoked_tools`

这些字段的目标不是现在就做完整 timeline UI，而是先把 run 作为 evidence subject 固定下来。

## 7. 当前阶段的结论

当前 run 层优先保证两件事：

- 不破坏 session guarantees
- 让 paused / failed / completed 这些执行状态真正影响 recovery、resume、focus 和 evidence

后续如果要做 timeline / evidence view，应优先消费这些 durable run refs，而不是重新推导执行历史。
