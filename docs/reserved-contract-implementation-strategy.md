# reserved-contract-implementation-strategy.md

## 1. 文档目的

这份文档定义 **reserved contracts** 在当前阶段的实现策略：  
不是定义最终业务能力，而是定义**在 Phase 1.5 / 宿主边界收口阶段，这些 contract 应该如何被“暴露、占位、验收、升级”**。

它回答的不是“这些能力未来要不要做”，而是：

- 现在要不要暴露 route
- 现在暴露后是 `501 reserved` 还是 `feature-gated minimal mutation`
- 现在允许写哪些最小状态
- 现在禁止产生哪些厚联动
- 未来从占位升级到真实实现时，哪些协议边界不能破

这份文档的作用，和 RemoteLab 的边界文档类似：  
先把**产品语法、协议归一、控制面与持久状态的边界**定住，再让实现跟进，而不是反过来让实现偷走定义权。

---

## 2. 设计背景与参考原则

本策略参考了 RemoteLab 的几条非常重要的架构原则：

- 系统首先是一个 **control plane**，不是把所有未来能力一次性做厚。  
- 核心对象要先稳定成 `Session / Run / ...` 这样的**产品语法**，再谈功能扩面。  
- **HTTP 是 canonical state path**，WebSocket 或其他机制只是辅助，不是真相来源。  
- 浏览器或宿主只是 **control surface**，不是 system of record。  
- 运行时进程可以是 disposable 的，**durable state 必须先站稳**。  
- 外部来源必须先被**归一化成标准消息流**，平台特殊语义停在边界之外。  
这些原则都在 RemoteLab 的 README、external message protocol 和 architecture 文档里写得很清楚。 citeturn862326view0turn862326view3turn862326view4turn862326view5

对 OpenClaw Manager 来说，这意味着：  
当前 reserved contracts 的首要任务，不是尽快“做出功能”，而是先让它们以一种**不破坏已通过验收内核**的方式被纳入控制面。

---

## 3. 文档适用范围

本策略文档只覆盖当前这一组 reserved contracts：

1. `human_decision_requested`
2. `human_decision_resolved`
3. `blocker_detected`
4. `blocker_cleared`

后续如果增加新的 reserved contracts，应复用本策略模板，而不是重新发明一套实现路线。

---

## 4. 关键术语

## 4.1 Reserved contract
“reserved contract” 指：  
**协议、schema、route、response envelope、测试预期已经先固定下来，但厚实现尚未启用的能力合同。**

它的重点是“边界先行”，不是“功能已经完成”。

## 4.2 `501 reserved`
表示 route 已被正式保留，路径、请求 schema、返回 envelope、错误码都固定，但当前不执行真实 mutation。  
适合那些：

- 未来必然存在
- 但现在一旦做厚实现就会牵动 recovery / focus / resume / close 的深层语义
- 当前阶段更适合先固定边界，再收集宿主与测试反馈

## 4.3 `feature-gated minimal mutation`
表示 route 已暴露，但只有在 feature flag 打开时才执行**最薄 mutation**。  
这个最薄 mutation 的目标不是“把功能做完”，而是：

- 只写最必要的 durable state
- 只写最必要的 normalized event
- 不引入复杂的跨对象联动
- 不破坏 Phase 1 guarantees
- 为未来真实实现保留升级路径

## 4.4 Minimal mutation
“最薄 mutation”在本项目里应理解为：

- 能写 event 就尽量先写 event
- 能只写 session.activity 就不要提前改复杂 checkpoint/recovery 行为
- 能先记录“有一个 decision/blocker 事实存在”就不要提前引入复杂自动调度
- 不为了局部体验，偷偷改变 close/resume/focus 的整体语义

---

## 5. 总体实现策略

当前阶段采用 **“route 先保留，mutation 后分层打开”** 的策略。

### 总原则
1. **先固定 contract，再开放实现。**
2. **先保护 recovery / idempotency / canonical envelope，再追求交互厚度。**
3. **先用 tests 和 feature gate 管住升级路径，再允许真实状态写入。**
4. **先让 reserved contracts 在宿主里“可见、可解释、可测试”，再让它们真正改变系统行为。**

这和 RemoteLab 的做法是同一路数：  
先把 control plane 的对象、HTTP 真相路径、外部归一协议与持久状态边界立稳，再把具体行为填进去。 citeturn862326view0turn862326view3turn862326view4

---

## 6. 当前策略矩阵

| Contract | 当前阶段策略 | 默认状态 | Feature flag | 当前允许的最薄行为 | 当前禁止的厚行为 |
|---|---|---|---|---|---|
| `human_decision_requested` | `feature-gated minimal mutation` | 关闭 | `decision_lifecycle_v1` | 写 normalized event；可写 session.activity/pending decision 摘要；可影响 focus 候选 | 不自动改写复杂 checkpoint 语义；不自动派生新 run；不改变 close/resume 的主语义 |
| `human_decision_resolved` | `feature-gated minimal mutation` | 关闭 | `decision_lifecycle_v1` | 写 normalized event；可清理最小 pending decision 标记；可刷新 focus 候选 | 不自动恢复复杂执行链；不隐式补写旧 run 状态 |
| `blocker_detected` | `feature-gated minimal mutation` | 关闭 | `blocker_lifecycle_v1` | 写 normalized event；可写 session.activity/blocker 摘要；可进入 focus 候选 | 不自动把整个 session/所有 run 强制转 blocked；不改变 recovery head |
| `blocker_cleared` | `feature-gated minimal mutation` | 关闭 | `blocker_lifecycle_v1` | 写 normalized event；可清理最小 blocker 标记；可刷新 focus 候选 | 不自动恢复 run；不自动触发 inbound-like 续跑 |
| 以上四个 route 在 flag 关闭时 | `501 reserved` 或 `feature disabled` | 开启 route 暴露 | N/A | 返回固定 envelope 与错误码，供宿主和测试使用 | 不写任何 durable mutation |

### 为什么不是直接全部 `501`
因为这四个能力已经和你当前的 session.activity / focus / decision-blocker 语义绑定得很近。  
如果始终只停在 `501`，你会缺少一层“最薄但真实”的联动测试，无法验证宿主与控制面的边界是否顺。  
但如果直接做厚实现，又会过早牵动 recovery、resume、close 等深层行为。

所以最佳折中就是：

> **默认关闭；打开 flag 后只做最薄 mutation。**

---

## 7. 默认行为规范

## 7.1 当 feature flag 关闭时
所有这四个 endpoints 都必须：

- 路由存在
- 请求 schema 可校验
- 返回 canonical envelope
- 明确返回：
  - `status = "not_enabled"` 或等价语义
  - `error_code = "FEATURE_NOT_ENABLED"` 或 `FEATURE_RESERVED`
- 不写任何 durable state
- 不写 event
- 不改变 focus
- 不改变 session.activity
- 不改变 checkpoint / summary / recovery head

### 这样做的意义
- 宿主接入可以提早对齐路径与 envelope
- acceptance tests 可以提早固定
- 以后升级为真实实现时，不需要改路径和返回体骨架
- 你可以先在产品层决定“这些路由长什么样”，而不是让实现层先写出随意行为

---

## 7.2 当 feature flag 打开时
这些 endpoints 只能执行**最薄 mutation**，且必须遵守下面的边界。

### 允许的事情
1. 通过 schema 校验请求体  
2. 写一条对应的 normalized event  
3. 更新最小 session.activity 摘要  
4. 触发 focus 候选重算  
5. 返回 canonical session-detail envelope  

### 暂时不允许的事情
1. 自动创建新 run  
2. 自动恢复或取消既有 run  
3. 修改 committed recovery head  
4. 让 summary/checkpoint 的恢复语义发生变化  
5. 因单次 mutation 改写 session 的核心 lifecycle  
6. 隐式触发 close / reopen / resume  

---

## 8. 各个 contract 的具体含义与实现边界

下面这部分既是策略，也是给开发者看的语义说明。

## 8.1 `human_decision_requested`

### 含义
系统或外部调用者声明：  
当前 session 中存在一个**需要人类做出的最小决策单元**。

它的本质不是“用户发来一条消息”，而是“控制面现在需要一个人来决定某件事”。

### 当前阶段最薄实现
- 写一条 `human_decision_requested` event
- 在 session.activity 中追加或更新一个最小 pending decision 摘要
- 允许它影响 focus 候选
- 返回更新后的 session-detail envelope

### 当前阶段不做
- 不自动暂停/恢复 run
- 不自动改变 recovery 顺序
- 不自动补写复杂 checkpoint
- 不把所有 waiting_human 语义都压进这个 endpoint

### 为什么这样设计
因为“需要人决策”是控制面语义，先让它能在 durable event 和 focus 中被看见，比过早和 run 状态机深度绑定更稳。

---

## 8.2 `human_decision_resolved`

### 含义
系统或外部调用者声明：  
某个已知的 pending decision 现在已经被解决。

### 当前阶段最薄实现
- 写一条 `human_decision_resolved` event
- 清理或标记 session.activity 里的相应 pending decision
- 允许 focus 重算
- 返回更新后的 session-detail envelope

### 当前阶段不做
- 不自动恢复先前 blocked/waiting 的复杂执行链
- 不自动创建新 run
- 不推导“既然已解决所以必须继续执行”的厚行为

### 为什么这样设计
因为“决策已解决”首先应该被系统稳定记录，其次才是调度含义。  
先把事实层做稳，未来再加执行层联动。

---

## 8.3 `blocker_detected`

### 含义
系统或外部调用者声明：  
当前 session 出现了一个阻塞条件，短期内限制任务继续推进。

### 当前阶段最薄实现
- 写一条 `blocker_detected` event
- 在 session.activity 中写最小 blocker 摘要
- 允许该 blocker 进入 focus 候选
- 返回更新后的 session-detail envelope

### 当前阶段不做
- 不自动把所有 run 强制置为 blocked
- 不自动中断恢复模型
- 不自动升级 session 生命周期
- 不引入复杂 blocker 依赖图

### 为什么这样设计
因为“阻塞被看到”比“阻塞导致系统大面积状态联动”更适合当前阶段。  
先把 blocker 变成 durable control-plane fact，而不是马上变成全系统主导状态。

---

## 8.4 `blocker_cleared`

### 含义
系统或外部调用者声明：  
一个已知 blocker 不再成立。

### 当前阶段最薄实现
- 写一条 `blocker_cleared` event
- 清理或标记 session.activity 的 blocker 摘要
- 重算 focus
- 返回更新后的 session-detail envelope

### 当前阶段不做
- 不自动恢复 run
- 不自动续跑
- 不自动改写 checkpoint / summary / committed head
- 不自动视为 ready-to-close 或 ready-to-resume

### 为什么这样设计
因为“阻塞解除”并不天然等于“系统立刻继续执行”。  
在控制面里，它首先是一个事实变化；后续是否继续，应交由上层策略或未来更厚的状态机处理。

---

## 9. 请求/响应合同

## 9.1 路由要求
这四个 contracts 的路由一旦暴露，路径就应该固定，不要频繁改名。  
这样做是为了让宿主、测试、文档和未来升级都能稳定对齐。

## 9.2 请求体要求
每个 route 至少应固定：

- 顶层 schema
- 必填标识
- 幂等键（如适用）
- actor/source metadata
- target session id
- 最小 reason / summary / category

### 建议
尽量让这些 mutation 请求也保留一个 `request_id` 或等价去重键。  
这样以后即使接入外部 connector，也能沿用统一的幂等语义。

## 9.3 响应体要求
无论 501、feature disabled 还是 minimal mutation 成功，都必须返回同一类 **canonical session-detail envelope**，只是在状态字段上区分：

- `ok`
- `not_enabled`
- `reserved`
- `accepted`
- `rejected`

### 原则
- 不因“现在还没实现”就返回一套临时 ad-hoc JSON
- 不因 feature gate 开关不同就改变 envelope 骨架
- 保持 HTTP 作为 canonical state path 的一致性

这与 RemoteLab 把 HTTP 当作 canonical state path 的原则是相符的。 citeturn862326view0

---

## 10. 状态写入边界

## 10.1 当前允许写入的 durable objects
当前阶段，reserved contracts 打开 feature flag 后，允许写入的对象仅限：

- `events`
- `session.activity` 或等价的轻量 activity 子结构
- 必要的 `updated_at`
- focus 计算所依赖的轻量摘要字段

## 10.2 当前禁止直接改写的 durable objects
当前阶段，除非另有明确合同，不应由这四个 contracts 直接改写：

- committed `checkpoint`
- `recovery-head`
- run 的深层状态流转
- summary 的主恢复语义
- close / archive / reopen 的 lifecycle 主状态

### 含义
这些 route 现在是**控制面事实入口**，不是“全能状态修改器”。

---

## 11. Acceptance 预期

每个 reserved contract 当前至少需要有三层测试。

## 11.1 边界测试
验证：

- route 存在
- schema 生效
- flag 关闭时响应正确
- envelope 稳定
- 不写 durable mutation

## 11.2 最薄 mutation 测试
验证：

- flag 打开后会写 event
- 最小 session.activity 变化成立
- focus 重算按预期工作
- canonical session-detail envelope 仍然稳定

## 11.3 非越界测试
验证：

- 不会自动改 committed recovery head
- 不会自动创建/恢复 run
- 不会改变 close/resume 既有 guarantees
- 不会产生多余 attention 噪音

### 测试设计原则
测试应先证明“没有越界”，再证明“写进来了东西”。  
因为当前阶段最重要的是不破坏已成立的内核。

---

## 12. 升级路径（Upgrade Path）

reserved contracts 后续升级成真实实现时，必须遵守以下规则：

## 12.1 不能改的东西
- route path
- request schema 的核心字段含义
- canonical session-detail envelope 骨架
- 幂等键的主语义
- Phase 1 guarantees

## 12.2 可以加的东西
- 更厚的 run 状态联动
- 更完整的 checkpoint/summary 协调
- 更细的 blocker/decision 对象化
- 更丰富的 evidence / timeline 产物
- 更强的 focus / digest 智能

## 12.3 升级顺序建议
1. 先从 `501 reserved` 升到 `feature-gated minimal mutation`
2. 再从 minimal mutation 升到“与 focus 深联动”
3. 再考虑和 run / recovery / resume 做更深联动
4. 最后才考虑自动调度与跨对象厚行为

### 为什么
因为这能最大限度复用现有 acceptance baseline，同时避免未来一升级就必须重写大段宿主或测试逻辑。

---

## 13. 推荐落地顺序

### 第一步
把这份文档定稿，并让它成为 decision/blocker reserved contracts 的实现宪法。

### 第二步
在代码里先把 4 个 routes 的：
- path
- schema
- canonical envelope
- feature gate
- `501/feature disabled` 语义
固定下来。

### 第三步
只对其中 1 到 2 个 contracts 开最薄 mutation，优先建议：
1. `human_decision_requested`
2. `blocker_detected`

### 第四步
补 acceptance：
- disabled
- minimal mutation
- no-overreach

### 第五步
再决定是否推进 `resolved/cleared` 的最薄实现。

---

## 14. 给你逐项解释：这份文档里每一项是什么意思

### “文档目的”
告诉团队：这份文档不是在定义最终功能，而是在定义**当前阶段怎么以正确方式先占位、再升级**。

### “设计背景与参考原则”
说明为什么这个策略不是拍脑袋，而是借鉴了 RemoteLab 那种**先控制面、后厚实现**的做法。

### “适用范围”
限定当前只讨论 4 个 reserved contracts，避免文档膨胀。

### “关键术语”
统一语言，避免“reserved”“feature gate”“minimal mutation”每个人理解不同。

### “总体实现策略”
给出总决策：先 route、先 contract、先 gate、后厚实现。

### “当前策略矩阵”
这是最重要的表。  
它一眼告诉开发者：**每个 contract 现在到底应该怎么实现，允许到什么程度。**

### “默认行为规范”
定义 route 开着但功能未启用时该怎么表现，避免以后到处出现不一致的 404/500/临时 JSON。

### “各个 contract 的具体含义与实现边界”
把 4 个 contract 的产品语义和当前实现边界分别写清楚，避免实现层偷改含义。

### “请求/响应合同”
保证 HTTP 边界稳定，便于宿主接入、测试、未来升级。

### “状态写入边界”
告诉开发者现在能写什么、不能写什么，避免一上来写太厚。

### “Acceptance 预期”
告诉测试层该测什么，尤其是要优先证明**没有越界破坏**。

### “升级路径”
确保以后从占位到真实实现时不会把今天定下的 contract 推翻。

### “推荐落地顺序”
给你和协作者一个实际执行顺序，而不是只给原则。

### “逐项解释”
这部分就是给你现在改文档时用的，方便你知道每节到底承担什么作用。

---

## 15. 最后一条总原则

> **Reserved contract 的价值，不在于“先把 endpoint 做出来”，而在于先把未来升级时不能乱动的边界固定下来。**

如果当前阶段能做到：

- path 稳定
- schema 稳定
- envelope 稳定
- disabled 行为稳定
- minimal mutation 边界稳定
- acceptance 稳定

那这份 reserved-contract-implementation-strategy 就是合格的。
