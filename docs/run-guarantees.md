# Run Guarantees

这份文档冻结当前 `run` 语义。  
任何会改动这些结论的提交，必须同时更新：

- [`tests/phase2.run-lifecycle.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.run-lifecycle.test.ts)
- 本文档

## Canonical Run Status

- open：`accepted`、`queued`、`running`
- paused-terminal：`waiting_human`、`blocked`
- ended-terminal：`completed`、`failed`、`cancelled`、`superseded`
- `status=completed` 只允许 `outcome.result_type=completed | partial_progress | no_op`
- `status=waiting_human` 只允许 `outcome.result_type=waiting_human`
- `status=failed` 只允许 `outcome.result_type=failed`
- `status=cancelled | superseded` 时 `outcome.result_type=null`，并且 `reason_code` 必填
- `partial_progress` 和 `no_op` 只属于 `completed`
- session 的 `abandoned close` 如果需要结束当前 run，应落成 `completed + no_op`
- terminal run 不允许再回退到 open status

## Focus

- `waiting_human` 会直接成为 `focus` 的 primary category
- `blocked` 会直接成为 `focus` 的 primary category
- `failed` 第一次失败不等于 `blocked`；重复失败会把 `focus` 抬升为 `blocked`
- `completed`、`cancelled`、`superseded` 本身不会单独抬高 `focus`

## Session Summary

- `session.status` 是控制面摘要，不是第二套 run 状态机
- paused run 会把 `session.status` 投影成 `waiting_human` 或 `blocked`
- unresolved decision / blocker 也会把 `session.status` 投影成 `waiting_human` / `blocked`
- 对外读面应同时看 `session.status_reason`

## Committed Recovery Head

- 终态会推进 committed recovery head：`waiting_human`、`blocked`、`completed`
- 终态不会推进 committed recovery head：`failed`、`cancelled`、`superseded`
- `end_checkpoint_ref` 是“run 结束时推进了 head”的 authoritative marker
- `superseded` 会发出专门的 `run_superseded` 事件，不混入一般 `run_status_changed`
- 新 run 的 `start_checkpoint_ref` 优先指向最近一次推进过 head 的 `end_checkpoint_ref`；只有还没有 terminal head 时，才回退到最近的 `recovery_checkpoint_ref`

## Resume

- 面对 `waiting_human`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue
- 面对 `blocked`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue
- 面对 `failed`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`
- 面对 `completed` / `cancelled` / `superseded`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`

## Retry

- `retry` / `resume` 总是创建新 run
- 已结束 run 不会被原地重开
