# Session Status Derivation

`session` 现在开始收敛成控制面摘要，不再继续扩成第二套执行状态机。

核心规则：

- `completed` / `abandoned` / `archived` 仍由 session 自己持有
- 非终态里的 `waiting_human` / `blocked` 优先从 run 和事实对象推导
- 对外读面应优先看 `session.status_reason`

当前派生优先级：

1. terminal session
2. paused run
3. pending human decision
4. blocker fact
5. active run
6. default active

当前 `status_reason` 至少回答：

- 这个 status 是怎么来的
- 是否来自某个 paused run
- 是否来自某个 decision / blocker

因此：

- `session.status=waiting_human` 可能来自 paused run，也可能来自 unresolved decision
- `session.status=blocked` 可能来自 paused run，也可能来自 blocker fact
- `failed` 不直接投影成 `session.status=blocked`；它只通过 `focus` 的 repeated-failure heuristic 抬高注意力

这层派生不改变 recovery 原则：

- recovery 仍由 committed checkpoint / summary / events 驱动
- session summary 只是控制面摘要，不是新的真相来源
