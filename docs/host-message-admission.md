# Host Message Admission Contract

本文档定义宿主普通消息进入 Manager 的最薄 capture / admission 层。

目标不是把宿主做成第二个 control plane，而是让来自 OpenClaw 外接插件的普通消息能以 **可判定、可解释、可验收** 的方式进入 Manager。

## 1. 当前阶段要解决的问题

宿主收到一条普通消息时，不能只有两种极端：

- 全部丢给 OpenClaw 原生系统
- 全部自动变成 Manager session

当前阶段采用三层 admission：

1. Layer 1: 显式命令进入  
   `/adopt`、`/resume` 等显式命令路径保持不变。
2. Layer 2: 提示式进入  
   普通消息先经过一个最薄规则判定，结果可能是 `do_nothing` 或 `suggest_adopt`。
3. Layer 3: 策略式直接进入  
   只在高置信且边界安全时，才直接进入 Manager。

## 2. 当前实现的四个模块

代码位置：

- [`src/host/context.ts`](/Users/yangshangqing/metaclaw/src/host/context.ts)
- [`src/host/admission-policy.ts`](/Users/yangshangqing/metaclaw/src/host/admission-policy.ts)
- [`src/host/suggest-or-adopt.ts`](/Users/yangshangqing/metaclaw/src/host/suggest-or-adopt.ts)
- [`tests/phase1.host-admission.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.host-admission.test.ts)

职责边界：

- `context.ts`：聚合最小判定输入
- `admission-policy.ts`：纯规则判定，不做 IO，不写状态
- `suggest-or-adopt.ts`：根据判定结果执行最薄宿主行为
- `phase1.host-admission.test.ts`：验收 host message capture 行为

## 3. 最小判定输入

当前 admission 只依赖这些输入：

- `message_text`
- `source_type`
- `source_thread_key`
- `message_id`
- `capture_key`
- `active_session_count`
- `focus_backlog`
- `existing_session_match`
- `keyword_hits`
- `structural_signals`

其中当前的 host capture 幂等键固定为：

- `source_type + source_thread_key + message_id`

这三个字段缺一不可。当前 direct ingress 的 `request_id` 由这个固定 capture key 派生，而不是由 `text`、`received_at` 之类易漂移字段派生。

其中规则式特征当前只看：

- 关键词：`任务`、`研究`、`跟进`、`持续`、`整理`、`帮我查`、`后续`、`project`、`todo`
- 结构信号：长期任务、外部依赖、交付物、后续动作
- 现有 session 关系：
  - 精确 `source_thread` 匹配
  - 保守的 `keyword_overlap`

## 4. 最小判定输出

当前 `HostAdmissionPolicy` 输出：

```json
{
  "decision": "suggest_adopt",
  "reason_codes": ["keyword_research", "long_horizon_task"],
  "confidence": 0.72,
  "existing_session_match": null
}
```

`decision` 当前只允许：

- `do_nothing`
- `suggest_adopt`
- `direct_adopt`

## 5. 当前 direct path 的安全约束

当前实现刻意保守。

### 5.1 允许自动直入的情况

- 命中高置信任务关键词
- 同时具备长期任务和强结构信号
- 有稳定 `source_thread_key`
- 有稳定 `message_id`
- 当前 focus / active session 压力不过高

另外一种安全直入情况是：

- 已有 session 与当前消息形成 **精确 source-thread 绑定**

这种情况下，follow-up message 可以直接进入同一个 session，而不是再新建一个。

### 5.2 不允许自动直入的情况

- 没有稳定 `source_thread_key`
- 没有稳定 `message_id`
- 只有模糊语义相似，没有精确 source-thread 绑定
- 当前 focus backlog 已明显偏高

这些情况只能 `suggest_adopt`，不能偷偷替用户做不可逆导入。

## 6. suggestOrAdopt 的最薄宿主行为

当前行为只有四种结果：

- `ignored`
- `suggested`
- `adopted_new_session`
- `routed_to_existing_session`

具体动作：

- `suggested`
  - 不写任何 Manager durable state
  - 只返回建议的 `/adopt` payload
- `adopted_new_session`
  - 走 canonical `POST /adopt`
  - 然后把原始消息走 canonical `POST /inbound-message`
- `routed_to_existing_session`
  - 只在精确 source-thread match 且存在完整 capture key 时允许
  - 直接把原始消息走 canonical `POST /inbound-message`

retry 语义：

- 如果宿主因为超时或重试再次提交同一条消息
- 且 `source_type + source_thread_key + message_id` 不变
- 那么 manager 应路由到同一 session
- 且 `inbound-message` 应被视为 duplicate，而不是再次写新的事实

## 7. 明确禁止事项

当前 admission 层绝不能：

- 直接读写 `.openclaw-manager-state/`
- 直接 import `ControlPlane`
- 偷偷改写 OpenClaw 原生会话历史
- 自动做复杂 session merge
- 以模糊语义匹配为依据，把消息自动塞进已有 session

## 8. 与 Phase 1 guarantees 的关系

这层 admission 是 host boundary 扩面，不是内核重写。

因此它必须继续遵守：

- HTTP is canonical
- `session` / `run` / `event` 仍然是一等真相
- recovery / checkpoint / summary 内核语义不变
- focus 仍由 control plane 推导，不由宿主侧本地猜

## 9. 当前阶段的结论

当前实现已经让宿主普通消息能开始接触 Manager，但方式仍然是受控的：

- 只做规则式 admission
- 只走 canonical `/adopt` 与 `/inbound-message`
- 只对高置信、边界安全的消息做 direct ingress
- 对模糊情况只给 suggestion，不偷做 session merge
