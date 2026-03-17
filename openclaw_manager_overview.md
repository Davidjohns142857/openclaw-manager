# OpenClaw Manager：OpenClaw-Native 管理工具总说明文档

## 1. 项目定位

**OpenClaw Manager** 不是一个“给 openclaw 加个更好看的聊天面板”的项目，而是一个位于 openclaw 之上的**控制平面（control plane）与状态平面（state plane）**。它把原本线性的消息流改造成一个**可恢复、可观测、可编排、可蒸馏**的任务系统。

这个项目的核心目标有三类：

1. **任务控制层**：恢复、分享、接外部消息源，解决 openclaw 基于聊天的线性、低信息密度、低可观测性问题。
2. **能力蒸馏层**：把分散在本地节点中的任务经验转成可聚合的 skill telemetry 与能力图谱。
3. **注意力操作层**：给人类一个多任务状态空间，让其知道“系统现在在做什么、卡在哪里、下一步谁动”。

从产品形态上看，它表面上是一个可以直接安装到 openclaw 上的 **skill**；但内部不能只是 prompt 或单个脚本，而应该是：

- 一个 **openclaw-native skill**，负责为用户提供命令入口；
- 一个 **本地 sidecar 服务**，负责状态持久化、事件归档、run 恢复、connector 归一化、telemetry 汇总；
- 一个 **文件化状态层**，负责 durable state、snapshot、capability facts 的落盘与导出。

因此，它更准确地说是：

> 一个以 openclaw skill 形态安装的 agent operating layer。

---

## 2. 背景问题与产品动机

OpenClaw 当前以聊天为主要交互形态，这种范式天然存在三类问题：

### 2.1 线性问题
聊天记录天然是线性的，适合临时问答，不适合管理长期任务线程。随着任务变多，用户只能在长上下文中反复回滚和检索，无法快速回答：

- 当前系统里一共有多少个任务线程？
- 哪些线程正在运行？
- 哪些线程卡在人类决策点？
- 哪些线程只是“看起来没动”，其实已经 stale 或 drift？

### 2.2 低信息密度问题
原始消息流往往混合了：

- 任务目标
- 过程讨论
- 工具输出
- skill 调用
- 失败日志
- 中间结论
- 人类插话

这些信息杂糅在一起，缺乏结构化状态，因此用户很难恢复上下文，也很难高密度理解当前局面。

### 2.3 低可观测性问题
用户缺少一种稳定的方法回答：

- skill 到底做了什么？
- 某次任务为什么失败？
- 哪个环节需要人工接管？
- 哪些 skill 在哪些场景里真的有效？
- 哪类 workflow 的闭环率高？

OpenClaw Manager 的动机，就是把 openclaw 从“消息流系统”抬升为“任务状态系统”。

---

## 3. 借鉴 RemoteLab 的核心经验

这个项目在思路上可以高强度借鉴 RemoteLab，但借鉴的不是“手机远程控制 UI”，而是它背后的三件事：

1. **产品语法**：Session / Run / App / Share snapshot
2. **控制平面架构**：HTTP canonical state、durable state、runtime disposable
3. **外部消息归一化协议**：把各种上游来源压成统一的 normalized inbound message

RemoteLab 最值得借鉴的不是表层体验，而是这三条结构性经验：

### 3.1 把“聊天窗口”升级为“任务对象”
系统的真实工作单元不应是 message，而应是 `session`。  
一条长期工作线程，应该拥有自己的目标、状态、依赖、阻塞点、运行历史与分享出口。

### 3.2 把“连接状态”升级为“可恢复状态”
浏览器、终端、agent runtime 都可以断；  
系统不应该把真相放在连接上，而应该放在 durable state、checkpoint 和 normalized events 上。

### 3.3 把“平台语义”压缩为“统一消息协议”
企业微信、Telegram、邮件、GitHub、浏览器插件、本地 watcher 都可能接入系统；  
核心层不应理解它们各自的线程语义，而应只理解：

- 一个 inbound update
- 归属于哪个 session
- 是否触发新的 run
- 是否生成 attention item

---

## 4. 系统哲学

建议把整个项目的“宪法”浓缩成三句话：

1. **OpenClaw 的真实工作单元不是消息，而是 session。**
2. **系统的真实状态不在聊天窗口里，而在 durable state 与 normalized events 里。**
3. **一个优秀的管理工具，不是展示更多日志，而是把复杂运行体压缩成可恢复、可判断、可蒸馏的状态空间。**

这三句话决定了整个项目不会滑向“又一个 agent dashboard”，而会真正变成 openclaw 的管理层与操作层。

---

## 5. 核心对象模型

系统建议定义六个核心对象。

### 5.1 Session
表示一个长期工作线程。它不是“一个聊天窗口”，而是一个有持续目标、上下文、状态、依赖关系的任务单元。

一个 session 应包含：

- `session_id`
- `title`
- `objective`
- `owner`
- `source_channels`
- `current_state`
- `active_run_id`
- `priority`
- `blockers`
- `pending_human_decisions`
- `derived_summary`
- `tags`
- `created_at`
- `updated_at`
- `archived_at`

Session 是项目线程、需求线程、调查线程、执行线程的统一抽象。

### 5.2 Run
表示 session 内某一次具体执行尝试。

一次 agent 启动、续跑、重试、从外部消息触发后的处理，都算一个 run。  
这样可以把“任务线程是否还活着”和“某次执行是否失败”区分开。

状态机建议至少有：

- `accepted`
- `queued`
- `running`
- `waiting_human`
- `blocked`
- `completed`
- `failed`
- `cancelled`
- `superseded`

### 5.3 Event
表示标准化事件，是整个系统的事实底座。

后续的恢复、观察、统计、能力图谱，都不应直接依赖聊天原文，而要依赖 event。

建议事件类型包括：

- `message_received`
- `run_started`
- `skill_invoked`
- `skill_completed`
- `tool_called`
- `artifact_created`
- `state_changed`
- `summary_refreshed`
- `blocker_detected`
- `human_decision_requested`
- `human_decision_resolved`
- `external_trigger_bound`
- `session_shared`
- `session_archived`

### 5.4 SkillTrace
记录某个 skill 在某个 run 中扮演了什么角色、表现如何。

关键不是“skill 调用了几次”，而是：

- 在什么场景中被调用
- 它是主完成者还是辅助者
- 调完之后任务是向前推进了还是制造了返工
- 最终闭环时它的边际贡献如何

### 5.5 AttentionUnit
这是给人类看的控制面对象。  
它不是事实层对象，而是从底层状态推导出来的“值得人类注意的事项”。

例如：

- 一个待决策点
- 一个阻塞任务
- 一个超时未处理的线程
- 一个高价值但被遗忘的线程

### 5.6 CapabilityFact
这是能力图谱的最小事实单元。  
不要一开始就存“声誉分数”，先存“能力事实”。

例如：

- skill X 在 scenario Y 中连续完成 Z 类子任务
- skill X 在高模糊输入任务中失败率高
- workflow A 在需要外部消息回流时恢复率高
- planner B 在多轮 follow-up 条件下闭环更稳定

---

## 6. 总体模块架构

建议拆成七个模块，其中只有第一层直接暴露为 openclaw skill，其他层都是 skill 背后的运行支持。

### 6.1 模块 A：OpenClaw Native Skill Layer
这是用户真正安装和调用的部分。

它对外提供的能力包括：

- `/tasks`：查看任务总览
- `/resume <session>`：恢复一个任务线程
- `/share <session>`：生成分享页
- `/bind <channel>`：绑定外部消息源
- `/focus`：查看当前需要人处理的 attention units
- `/graph`：查看本节点能力摘要
- `/digest`：生成多任务摘要
- `/checkpoint`：把当前工作线程做一次状态固化
- `/close`：关闭线程并写入闭环结果
- `/adopt`：把普通聊天线程升级为 session

这个 skill 本身不直接持有真相，它只是一个 openclaw 内的操作入口。

### 6.2 模块 B：Session/Run Control Plane
这是系统的大脑。

负责：

- 创建、关闭、归档 session
- 启动、取消、重试 run
- 处理 run 状态机
- 判断是否需要 human checkpoint
- 将普通消息流提升为 structured task state

它更适合作为一个轻量有限状态控制器，而不是重型 workflow orchestrator。

### 6.3 模块 C：Durable State Store
这是整个系统成败的关键。  
建议早期坚持 **filesystem-first**，不要急着上数据库。

建议目录结构如下：

```text
~/.openclaw/skills/manager/
  sessions/
    <session_id>/session.json
    <session_id>/summary.md
    <session_id>/attention.json
    <session_id>/share/
    <session_id>/artifacts/
    <session_id>/runs/
      <run_id>/run.json
      <run_id>/events.jsonl
      <run_id>/spool.jsonl
      <run_id>/checkpoint.json
      <run_id>/skill_traces.jsonl
  indexes/
    sessions.json
    active_sessions.json
    attention_queue.json
    capability_facts.jsonl
  connectors/
    bindings.json
    inbox/
  snapshots/
  exports/
```

前期使用文件系统的优势在于：

- 适合 self-hosted / 半 self-hosted 的 openclaw 用户
- 最容易理解与备份
- 发生 bug 时最好排查
- 也最适合以后被 agent 自己读取、修复、总结
- Git 备份、增量同步、节点间导出都方便

### 6.4 模块 D：Connector Normalization Layer
职责只有一个：

> 把所有外部来源压成统一的 normalized inbound message。

输入可能来自：

- 企业微信
- Telegram
- 邮件
- GitHub issue / comment
- 浏览器插件
- 定时任务
- 本地 watcher
- 其他 openclaw 节点

归一后统一变成：

```json
{
  "request_id": "req_...",
  "external_trigger_id": "ext_...",
  "source_type": "telegram",
  "source_thread_key": "tg_thread_123",
  "target_session_id": "sess_...",
  "message_type": "user_message",
  "content": "新的外部消息内容",
  "attachments": [],
  "timestamp": "2026-03-17T10:00:00Z",
  "metadata": {}
}
```

注意：connector 层不能把平台语义泄漏进核心层。  
核心层只知道：

- 这是某个 session 的新输入
- 这是新 session 还是旧 session 的继续
- 是否应触发 run
- 是否应合并到 attention queue

### 6.5 模块 E：Observability & Attention Engine
这是区别于普通任务系统的关键层。

它不直接执行任务，而是持续把底层 state 翻译成高信息密度的“掌控感”。

建议产出四类视图：

#### Session Map
当前有哪些任务线程；每个线程在什么状态；最后更新时间；谁在等待谁。

#### Attention Queue
当前所有需要人类操作的事项，按紧急度和价值排序。

#### Risk / Blocker View
哪些任务卡住了；卡在哪里；是外部依赖还是内部失败；是否已经 stale。

#### Drift / Decay View
哪些 session 太久没更新、摘要失效、上下文开始腐化，需要重构。

判定规则可以从简单规则开始，例如：

- 24 小时无更新且未完成 → stale
- 连续两次 failed run → blocked
- 等待 human 超过 6h → attention
- 有外部消息但未触发新的 run → desynced
- artifact 更新但 summary 未刷新 → summary drift

### 6.6 模块 F：Capability Distillation Engine
这是能力图谱的核心。

建议分两步做：

#### 第一步：节点内蒸馏
每个节点本地定期从 event、skill trace、outcome 中计算能力事实。

例如：

- 某 skill 在“产品调研”场景下平均 run duration
- 某 workflow 在“外部消息回流型任务”中的闭环率
- 某 planner 对多跳子任务的失败分布
- 某 connector 的映射稳定性

生成：

- `capability_facts.jsonl`
- `local_skill_report.md`
- `workflow_performance_snapshot.json`

#### 第二步：跨节点聚合
由用户选择是否上报匿名化能力事实到公域网络。

上传的不是原始任务内容，而是：

- scenario signature
- normalized metrics
- skill/workflow version
- closure facts
- confidence / sample_size

### 6.7 模块 G：Sharing / Snapshot Layer
建议支持三类分享：

#### Task Snapshot
某个 session 当前状态和主要产物的只读页。

#### Run Evidence Snapshot
某次执行的关键事件、关键 skill trace、关键 artifacts，用来做审查与复盘。

#### Capability Snapshot
某个 skill / workflow 在本节点的表现摘要。

分享必须默认只读，并且默认去敏感化；不要默认共享原始日志。

---

## 7. 关键数据流设计

### 7.1 数据流一：普通 openclaw 对话升级为可恢复任务线程

流程如下：

1. 用户在 openclaw 中发起一段普通任务对话；
2. 管理 skill 识别这是一个长期任务候选；
3. 调用 `/adopt` 或自动建议建 session；
4. 创建 `session.json`；
5. 把当前上下文摘要成 objective / state / assumptions / next_actions；
6. 启动 run；
7. 后续所有相关动作都写成 event / run / skill trace；
8. session summary 持续刷新；
9. 用户随时 `/resume`，恢复的是 session state，而不是整段聊天重放。

这一步解决“聊天线性、断了就散”的问题。

### 7.2 数据流二：外部消息回流到既有任务线程

流程如下：

1. 外部 connector 收到消息；
2. 映射 `source_thread_key` 到 `session_id`；
3. 生成 normalized inbound message；
4. 写入 `connectors/inbox`；
5. control plane 消费该消息，写 event；
6. 如果 session 当前可继续，则自动创建新 run；
7. 如果需要人决策，则只生成 attention item；
8. 刷新 session summary 与 state。

这一步让企业微信、Telegram、邮件都能自然接进来。

### 7.3 数据流三：任务闭环后蒸馏为能力事实

流程如下：

1. session 被 `/close` 或自动判定闭环；
2. control plane 写 closure event；
3. distillation engine 汇总 run、skill trace、artifact、human checkpoints；
4. 计算 closure metrics；
5. 产出 capability facts；
6. 写入本地 capability store；
7. 用户若允许，可上传匿名化 facts 到公域。

这一步是从“管理工具”走向“能力图谱平台”的桥。

---

## 8. 核心能力与对应技术路径

### 8.1 任务恢复
**目标**：让 openclaw 恢复的是“任务状态”，不是“聊天窗口”。

**技术路径**：

- session / run / event 模型
- summary + checkpoint 双层恢复
- append-only event log
- 每次 run 结束固化 checkpoint

**实现方法**：

每个 session 保持一个 `summary.md` 和一个 `checkpoint.json`：

- `summary.md` 给人看：目标、当前状态、已完成、未决问题、下一步；
- `checkpoint.json` 给系统看：active assumptions、blockers、pending inputs、artifact refs、next machine actions、next human actions。

恢复时优先读 checkpoint，再补 summary，而不是扫描全量历史。

### 8.2 分享
**目标**：让任务结果、执行证据、skill 表现可被只读分享。

**技术路径**：

- 静态 HTML / Markdown snapshot
- 脱敏导出
- snapshot manifest

**实现方法**：

每次 `/share` 时生成一个 export 目录：

```text
snapshots/<snapshot_id>/
  manifest.json
  index.html
  summary.md
  artifacts/
  traces/
```

分享页显示：

- session 摘要
- 当前状态
- 主要产物
- 关键决策点
- 可选 run evidence

### 8.3 接外部消息源
**目标**：让不同通道都能推动同一个任务线程，而不是制造新的上下文碎片。

**技术路径**：

- connector adapter
- thread / session 映射表
- normalized inbound schema
- source binding registry

**实现方法**：

本地 sidecar 开一个轻量 webhook / polling 接口，connector 各自负责采集来源，再调用统一入口：

`POST /inbound-message`

内部逻辑：

- 识别 session
- 写 event
- 判定触发 run 还是仅进入 attention queue

### 8.4 Skill 使用轨迹
**目标**：记录 skill 不是“用了没”，而是“如何参与了任务推进”。

**技术路径**：

- skill wrapper
- invocation hook
- standardized skill trace schema

**实现方法**：

提供一个 skill 调用包装器。  
其他 skill 被调用时，若经过该 wrapper，就自动记录：

- skill 名称 / 版本
- 输入输出摘要
- 耗时
- 成功失败
- 对 run 状态的影响
- 是否引发人工接管

### 8.5 任务闭环率与场景表现
**目标**：把任务经验蒸馏为有用的能力事实。

**技术路径**：

- scenario tagging
- closure typing
- metrics computation pipeline

**实现方法**：

给每个 session 标一个 `scenario_signature`，可以由：

- 用户定义标签
- 管理 skill 自动推断
- workflow 预设

闭环时记录：

- 是否按预期完成
- 是否部分完成
- 是否转人工完成
- 是否放弃
- 是否外部中断
- 总 run 数
- skill 参与矩阵
- 人工决策次数

然后计算：

- closure rate
- mean time to closure
- human intervention rate
- recovery success rate
- blocker recurrence rate

### 8.6 多任务注意力管理
**目标**：让人类对 openclaw 当前状态空间有掌控感。

**技术路径**：

- attention scoring
- stale detection
- risk classification
- periodic digest generation

**实现方法**：

给每个 session 持续计算：

- `urgency_score`
- `value_score`
- `blockage_score`
- `staleness_score`
- `uncertainty_score`

最后合成：

- `attention_priority`
- `recommended_action`

`/focus` 的输出应回答：

- 现在最值得你处理的 5 个点是什么；
- 每个点为何重要；
- 处理它后会释放哪些下游任务；
- 哪些任务可以暂时无视。

---

## 9. 完全 openclaw-native 的落地方式

“完全 openclaw-native”不意味着“全部逻辑只能写在 skill 文本里”，而意味着：

- 以 openclaw skill 的形式安装；
- 以 openclaw 的工作流进入；
- 以 openclaw 的任务对象为中心；
- 以 openclaw 生态内其他 skill 为被观测对象。

建议安装形态如下：

```text
skills/openclaw-manager/
  skill.yaml
  README.md
  hooks/
  templates/
  sidecar/
  schemas/
```

### 9.1 启动形态
当 openclaw 启动时：

- 该 skill 检查 sidecar 是否运行；
- 如果没有，则本地拉起一个轻量服务；
- 注册自身命令与 hooks；
- 创建本地状态目录。

### 9.2 集成形态
它和 openclaw 的结合点主要有三处：

#### 会话入口
用户直接通过 skill 命令管理 session。

#### Skill Wrapper / Hook
其他 skill 在被调用时，可由该工具记录 telemetry。

#### Heartbeat / Cron / Background Maintenance
管理 skill 定时刷新 summary、attention queue、capability facts。

因此，openclaw-native 的关键不在于“没有 sidecar”，而在于：

- 从用户视角看它就是一个 skill；
- 从系统视角看它增强的是 openclaw 内生对象；
- 从生态视角看它能观察和组织其他 skill。

---

## 10. 推荐技术栈

为了方便推广给其他 openclaw 用户，技术上应尽量克制。

### 推荐栈
- **TypeScript / Node.js**：control plane 和 sidecar
- **JSON / JSONL / Markdown**：状态落盘
- **SQLite（可选）**：二期需要复杂查询时加入
- **静态 HTML 导出**：snapshot share
- **简单 HTTP API**：供 skill 与 connector 调用
- **文件锁 / 单队列**：处理并发

### 不建议一开始做的东西
- 重型前端框架
- 分布式数据库
- 复杂权限系统
- 实时协同编辑
- 过度复杂的图数据库
- 花哨 dashboard

当前最需要的是：

> 先把状态对象立住，把恢复逻辑立住，把 telemetry 采样立住。

---

## 11. 分阶段落地建议

### Phase 1：Control Plane MVP
只做：

- session / run / event 模型
- `/adopt /resume /focus /close`
- checkpoint + summary 恢复
- 本地 snapshot 导出
- 基础 attention queue
- 基础 skill trace

这一期已经能解决：

- 线性聊天
- 低恢复性
- 多任务失控

### Phase 2：Connector + Multi-source
加入：

- Telegram / 企业微信 / 邮件 connector
- external thread 绑定
- inbound normalization
- source-aware session recovery

这一期解决：

- 外部消息回流
- 任务线程与通道解耦

### Phase 3：Capability Graph
加入：

- scenario signature
- closure metrics
- capability facts
- 节点内报告
- 跨节点匿名化上报协议

这一期才真正开始做公域能力图谱。

---

## 12. 建议的仓库结构

```text
openclaw-manager/
  AGENTS.md
  README.md
  skill.yaml
  package.json

  docs/
    architecture.md
    event-schema.md
    session-model.md
    connector-protocol.md
    capability-facts.md

  src/
    skill/
      commands.ts
      hooks.ts
      bootstrap.ts

    control-plane/
      session-service.ts
      run-service.ts
      event-service.ts
      checkpoint-service.ts
      attention-service.ts
      share-service.ts

    connectors/
      base.ts
      telegram.ts
      wecom.ts
      email.ts
      github.ts

    telemetry/
      skill-trace.ts
      scenario-tagging.ts
      closure-metrics.ts
      capability-facts.ts

    storage/
      fs-store.ts
      indexes.ts
      locks.ts

    api/
      server.ts
      inbound.ts
      health.ts

    exporters/
      snapshot-html.ts
      markdown-report.ts

  templates/
    session-summary.md
    focus-digest.md
    capability-report.md

  schemas/
    session.schema.json
    run.schema.json
    event.schema.json
    skill-trace.schema.json
    capability-fact.schema.json
```

---

## 13. 最终判断

这个项目如果做对，本质上不是“一个增强 openclaw 的插件”，而是：

> 一个把 openclaw 从消息流系统升级为任务状态系统的 openclaw-native 管理层。

它真正解决的，不只是“恢复上下文”或者“做个任务列表”，而是三件更深的事：

1. 把任务从聊天中解耦出来，变成 durable session；
2. 把执行经验从消息中提炼出来，变成 capability facts；
3. 把人类注意力从原始日志里解放出来，变成可判断的 control surface。

这也决定了它的价值不会随着更强的 agent 出现而消失；相反，agent 越强、并行线程越多、任务跨度越长，人类越需要一个这样的管理平面来维持掌控感、可控性和跨节点能力沉淀。
