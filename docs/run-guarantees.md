# Run Guarantees

这份文档冻结当前 `run` 语义。  
任何会改动这些结论的提交，必须同时更新：

- [`tests/phase2.run-lifecycle.test.ts`](/Users/yangshangqing/metaclaw/tests/phase2.run-lifecycle.test.ts)
- 本文档

## Canonical Run Status

- open：`accepted`、`queued`、`running`
- paused-terminal：`waiting_human`、`blocked`
- ended-terminal：`completed`、`failed`、`cancelled`、`superseded`

## Focus

- `waiting_human` 会直接成为 `focus` 的 primary category
- `blocked` 会直接成为 `focus` 的 primary category
- `failed` 第一次失败不等于 `blocked`；重复失败会把 `focus` 抬升为 `blocked`
- `completed`、`cancelled`、`superseded` 本身不会单独抬高 `focus`

## Committed Recovery Head

- 终态会推进 committed recovery head：`waiting_human`、`blocked`、`completed`
- 终态不会推进 committed recovery head：`failed`、`cancelled`、`superseded`
- `end_checkpoint_ref` 是“run 结束时推进了 head”的 authoritative marker

## Resume

- 面对 `waiting_human`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue
- 面对 `blocked`：不自动开新 run；恢复 committed checkpoint；保留 checkpoint 之后进入的 inbound queue
- 面对 `failed`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`
- 面对 `completed` / `cancelled` / `superseded`：恢复最近 committed checkpoint，然后创建新 run，`trigger_type=resume`

## Retry

- `retry` / `resume` 总是创建新 run
- 已结束 run 不会被原地重开
