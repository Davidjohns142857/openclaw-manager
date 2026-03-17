# Run Timeline Contract

`GET /sessions/:session_id/timeline` 是当前最小 run/evidence 读面。

它只做 derived read，不产生新真相。  
它必须稳定回答四件事：

1. 这个 session 下发生过哪些 run
2. 每个 run 是怎么触发的
3. 每个 run 的状态怎么流转
4. 每个 run 最终留下了什么 outcome、checkpoint 和 evidence refs

当前返回面固定为 `session_run_timeline_v1`，包含：

- `session`
- `run_count`
- `runs[]`

其中 `session` 也会带上派生后的 `status_reason`，说明当前 summary status 来自 paused run 还是事实对象。

每个 `runs[]` 项至少包含：

- `trigger`
- `status_flow`
- `outcome`
- `recovery`
- `evidence`

其中：

- `status_flow` 只消费 durable run events，不自己脑补执行历史
- `recovery` 只反映 committed checkpoint / summary refs 和 terminal head marker
- `evidence` 只暴露 refs 与最小计数，不把 timeline 反过来做成恢复真相
