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

适合继续补的独立测试方向：

- sidecar 不可用时的 host 错误语义
- `/commands` 与 client 能力对齐
- host rendering 对 `session.activity` 的最小使用约束

### 3.6 交互语义合同

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
- `session.activity` 与 `focus` 的基础交互语义

尚适合补强：

- 多 run 复杂生命周期
- share / export 更细致的 artifact contract
- corrupted state / repair path
- richer host failure handling
- connector normalization 的异常输入矩阵
