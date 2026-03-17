# Phase 1 Guarded Expansion Collaboration Plan

本文档用于当前阶段的并行开发协作。目标不是“尽快把面铺大”，而是在 **不破坏已经通过验收的 Phase 1 guarantees** 的前提下，进行受控扩面与宿主集成。

这份文档可以直接发给并行开发人员。它定义：

- 谁负责什么
- 哪些文件和模块是高风险区
- 哪些区域可以安全扩展
- 什么时候必须先同步、先写文档、先补测试
- 分支、提交流程、合并门槛

---

## 1. 当前阶段定义

当前阶段不是“概念探索”，也不是“自由扩展期”，而是：

> 在保持 Phase 1 内核稳定、验收持续为绿的前提下，进行受控扩面与真实宿主接入。

这意味着：

- 已通过的 Phase 1 guarantees 视为 **受保护内核**
- 新增能力必须以 **不回退 guarantees** 为约束
- 任何扩面都要能解释：
  - 是否动到了内核契约
  - 是否改变了恢复、幂等、状态一致性
  - 是否改变了 API / session activity / command surface
  - 是否需要先更新文档与验收

---

## 2. 绝不能回退的 Phase 1 Guarantees

以下内容默认不可退化：

### G-01 Session is first-class

- `session` 不是聊天窗口别名，而是 durable task object
- `/adopt -> session/run 落盘 -> /resume -> /close` 主链路必须保持成立

### G-02 Recovery is structured and checkpoint-authoritative

- 恢复优先走 committed checkpoint
- `summary.md` 是 checkpoint 的人类可读缓存，不是新的真相来源
- 不能退回为“靠历史重放凑恢复”

### G-03 Inbound idempotency is real

- `request_id` 必须是真实幂等键
- duplicate delivery 不能双写 message facts
- duplicate delivery 不能制造双重 session state mutation

### G-04 HTTP canonical state contract remains stable

- HTTP 仍是 canonical read/write path
- `session.activity` 仍是 server-authored client contract
- mutation endpoints 返回的 session-like payload 不能漂移成多种形状

### G-05 Acceptance suite remains green

以下检查必须持续通过：

- `node scripts/verify-structure.ts`
- `npm run typecheck`
- `npm run test:acceptance`

如果扩面之后这里任何一项变红，则该变更不能视为可合并状态。

---

## 3. 分工总览

### 3.1 ysq负责的部分

ysq负责：

- OpenClaw 最薄真实接入
- 产品语义
- 状态空间与交互规则
- 协议与边界定义
- 文档
- 验收定义

ysq在当前阶段的核心产出包括：

- 宿主接入方式与最薄命令入口
- `session.activity`、`focus`、human decision、task semantics 的产品定义
- HTTP / protocol / recovery / interaction docs
- `docs/interaction-contract.md` 中 `session.activity` / `focus` / human-decision 语义
- acceptance test 的口径与通过条件
- “什么叫允许扩面、什么叫破坏 guarantees”的判断

### 3.2 zephyr负责的部分

zephyr负责：

- Run 状态面的受控扩展
- Timeline / Evidence View 的最小落地
- Store / Service 的工程级稳健性补强

zephyr在当前阶段的核心产出应包括：

- 在不破坏现有 guarantees 的前提下扩展 Run lifecycle
- 为 Timeline / Evidence View 提供最小、稳定、可解释的数据面
- 强化 store/service 的稳健性、错误围栏、版本兼容和写入一致性

### 3.3 协作原则

- zephyr在契约内做工程扩面
- zephyr不要自行改写产品语义，ysq不要随意侵入其工程扩面实现细节
- 任何跨边界变更，都必须先落文档或 issue，再动代码

---

## 4. 你那一部分的核心需求与规则

这部分是直接写给zephyr的。

### 4.1 关于 Run 状态面的受控扩展

你的目标不是把 Run 变复杂，而是把它变得 **更完整但仍可控**。

你可以做：

- 扩展 `accepted / queued / running / waiting_human / blocked / completed / failed / cancelled / superseded` 的真实状态流转
- 补 run transition guard
- 补 run-level metrics 的维护
- 补 run / session 之间的聚合更新

你不可以做：

- 自行发明新的 product semantics
- 让 Run 取代 Session 成为第一公民
- 让恢复重新依赖 message replay
- 让状态扩展先于 schema / docs / acceptance

必须遵守的规则：

- 每增加一个真实可达状态，必须同步更新 `types`、`schemas`、`docs`、`tests`
- 不能引入“看起来更完整、实际上更脆弱”的状态分叉
- 任何新状态都要回答：
  - 谁触发
  - 谁结束
  - 是否需要人工确认
  - 对 `session.activity` 如何投影

### 4.2 关于 Timeline / Evidence View 的最小落地

你的目标不是做 dashboard，而是做 **最小 evidence surface**。

建议你交付：

- 一个最小 timeline model
- 一个最小 evidence export/read model
- 明确哪些对象是 evidence、哪些只是日志

你可以新增：

- 新的只读 view model
- 新的 evidence serializer
- 新的 timeline template
- 新的 timeline tests

你不要做：

- 重写 canonical state
- 让 timeline 反过来成为恢复真相
- 引入重型前端依赖
- 在 evidence view 里偷偷塞 product rule

建议边界：

- Timeline / Evidence View 是 **derived surface**
- derived surface 只能读 canonical objects，不能自行产生新真相

### 4.3 关于 Store / Service 的工程稳健性补强

这是你最重要的一部分，但也是最高风险的工程区。

你可以做：

- 写入原子性补强
- 并发一致性补强
- schema 校验完善
- recovery head / manifest / versioning 补强
- read path 的兼容与容错
- index rebuild / repair / diagnostics

你不要做：

- 重写 store 基本目录布局
- 引入数据库并把 filesystem-first 直接推翻
- 在没有验收用例的情况下重构核心存储代码
- 把“工程更优雅”置于“guarantees 更稳定”之上

必须遵守的规则：

- 任何 store/service 改动必须先补失败前提的测试，再补通过后的测试
- 写入链路的改动要显式说明：
  - atomic unit 是什么
  - commit fence 是什么
  - crash 之后 read path 怎么判断 committed / torn / stale

---

## 5. 高风险区 vs 安全扩展区

### 5.1 高风险区

以下区域属于高风险区。没有同步和测试，不要改。

- `src/storage/fs-store.ts`
- `src/storage/schema-registry.ts`
- `src/control-plane/control-plane.ts`
- `src/control-plane/checkpoint-service.ts`
- `src/control-plane/attention-service.ts`
- `src/api/server.ts`
- `src/api/serializers.ts`
- `src/shared/types.ts`
- `src/shared/activity.ts`
- `schemas/`
- `docs/http-protocol-boundary.md`
- `docs/recovery-model.md`
- `docs/interaction-contract.md`
- `docs/mvp-requirements.md`
- `tests/phase1.*`

这些区域之所以高风险，是因为它们直接决定：

- durable truth 是什么
- recovery 是否可靠
- HTTP / protocol contract 是否稳定
- acceptance 是否还能成立

### 5.2 安全扩展区

以下区域适合并行开发，冲突风险相对更低：

- 新增 `src/timeline/`
- 新增 `src/evidence/`
- 新增 `src/exporters/` 下的派生导出器
- 新增 `templates/timeline-*`
- 新增 `templates/evidence-*`
- 新增 `tests/timeline-*`
- 新增 `tests/evidence-*`
- 新增 run-state 扩展用的 helper/module，只要不先改写 core contract

安全扩展区的原则：

- 尽量新建文件，而不是直接改核心
- 先做 derived surface，再决定是否需要触碰 canonical core

### 5.3 共享但需握手的区域

以下区域不是完全禁改，但任何改动都要先同步：

- `src/control-plane/run-service.ts`
- `src/skill/commands.ts`
- `skills/openclaw-manager/`
- `skill.yaml`
- `docs/phase1-guarded-expansion-collaboration.md`

这类区域一改，就容易造成：

- command drift
- host integration drift
- runtime contract drift

---

## 6. 对并行开发最关键的接口规则

### 6.1 不要私改这些语义

以下语义默认由ysq维护：

- `session.activity` 的产品含义
- `focus` 的产品目标与排序逻辑
- human decision / blocker / stale / desynced 的产品定义
- OpenClaw command surface 的语义
- protocol / recovery doc 的最终口径

如果你需要改这些语义，请先提一个 doc-first change。

### 6.2 你可以稳定依赖这些事实

你可以假设以下前提成立并据此开发：

- HTTP 仍是 canonical transport
- filesystem-first 仍是当前阶段真相层
- `session` 仍是第一公民
- `checkpoint` 仍是 committed recovery head
- `summary` 仍是 checkpoint 派生的人类视图
- acceptance suite 仍是 merge gate

### 6.3 任何跨边界改动都要 doc-first

如果你的改动会影响以下任意一项：

- schema
- API shape
- `session.activity`
- recovery order
- command semantics
- acceptance expectations

你必须先做：

1. 在文档里说明改什么；
2. 列出受影响文件；
3. 列出新增或更新的测试；
4. 得到确认后再动核心实现。

---

## 7. 分支与提交流程建议

### 7.1 分支策略

建议：

- `main`: 受保护，只接收已经通过验收的变更
- ysq使用：`codex/host-*`
- zephyr使用：`codex/engine-*`
- 如需临时联调：`codex/integration-*`

不建议两个人长期共用一个开发分支。

### 7.2 提交粒度

建议 commit 保持小而明确，最好带 scope：

- `host:`
- `engine:`
- `contract:`
- `test:`
- `docs:`

示例：

- `engine: add guarded queued->running transition`
- `test: cover concurrent inbound duplicate claim`
- `docs: tighten recovery-head commit rules`

### 7.3 合并门槛

任何要进 `main` 的分支必须满足：

- `node scripts/verify-structure.ts` 通过
- `npm run typecheck` 通过
- `npm run test:acceptance` 通过
- 没有 command drift
- 没有 schema drift
- 没有 protocol doc drift

### 7.4 触碰高风险区时的额外要求

如果一个 PR 触碰了高风险区，必须额外满足：

- PR 描述里明确写出 touched guarantees
- 写出为什么不会破坏 Phase 1 guarantees
- 至少有一条新增或更新的验收测试覆盖该变更
- 不允许“先改核心，后补测试”

---

## 8. 推荐的并行开发节奏

### 8.1 ysq的优先队列

ysq会优先推进：

- OpenClaw 最薄真实接入
- 命令/交互/状态空间定义
- protocol / recovery / interaction docs
- acceptance scenarios 与验收口径

### 8.2 zephyr的优先队列

建议zephyr优先推进：

- Run 状态面的最小受控扩展
- Timeline / Evidence View 的最小 derived model
- store/service 的工程稳健性补强

### 8.3 每次同步时需要对齐的内容

每次同步最好只对齐 4 件事：

- 新增或修改了哪些 contract
- 是否触碰高风险区
- 哪些 tests 新增/更新
- 哪些 guarantees 可能被影响

不要把同步会开成泛泛的架构讨论。

---

## 9. 明确的禁令

以下事情在当前阶段默认禁止：

- 为了“更通用”而推翻 filesystem-first
- 为了“更优雅”而重写 recovery core
- 让 evidence / timeline 反客为主
- 在没有验收定义的情况下改 command semantics
- 删除、弱化或绕过已存在的 acceptance tests
- 为了追求并行开发速度而接受 contract drift

如果一个改动会让系统退回到：

> “概念正确、工程不稳”

那它在当前阶段就是不合格变更。

---

## 10. 最终协作原则

这次并行开发的目标不是比谁写得快，而是：

> 让产品语义、协议边界、恢复内核、工程稳健性在并行推进中仍保持可控。

因此：

- ysq负责定义系统“应该是什么”
- zephyr负责把其工程扩面部分做得“真的稳”
- 双方都不能单方面重写zephyr的边界

如果出现冲突，优先级应是：

1. Phase 1 guarantees
2. canonical contracts
3. acceptance suite
4. 扩面速度
