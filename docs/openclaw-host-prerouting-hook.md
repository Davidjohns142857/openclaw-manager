# OpenClaw Host Pre-Routing Hook Integration

本文档定义现在仓库里已经提供的宿主接线资产，以及它们当前能自动完成到什么程度：

- 在普通消息进入默认 skill / router 之前
- 先执行一次 manager admission pre-routing hook

这不是为了把宿主变成第二个 control plane，而是为了把现有的 host admission 能力真正挂到宿主消息入口上。

## 1. 当前事实

当前仓库现在已经有：

- host admission policy
- host context aggregator
- suggest-or-adopt thin host behavior
- sidecar `POST /host/prerouting` ingress
- 可安装的 managed hook：
  - [`hooks/openclaw-manager-prerouting/HOOK.md`](/Users/yangshangqing/metaclaw/hooks/openclaw-manager-prerouting/HOOK.md)
  - [`hooks/openclaw-manager-prerouting/handler.ts`](/Users/yangshangqing/metaclaw/hooks/openclaw-manager-prerouting/handler.ts)
- 本机 local-chain setup helper：
  - [`scripts/setup-openclaw-local-chain.ts`](/Users/yangshangqing/metaclaw/scripts/setup-openclaw-local-chain.ts)
- 一次性宿主 setup helper：
  - [`scripts/setup-openclaw-host.ts`](/Users/yangshangqing/metaclaw/scripts/setup-openclaw-host.ts)

对应位置：

- [`src/host/context.ts`](/Users/yangshangqing/metaclaw/src/host/context.ts)
- [`src/host/admission-policy.ts`](/Users/yangshangqing/metaclaw/src/host/admission-policy.ts)
- [`src/host/suggest-or-adopt.ts`](/Users/yangshangqing/metaclaw/src/host/suggest-or-adopt.ts)
- [`src/host/server-sidecar.ts`](/Users/yangshangqing/metaclaw/src/host/server-sidecar.ts)
- [`docs/host-message-admission.md`](/Users/yangshangqing/metaclaw/docs/host-message-admission.md)

当前仓库已经能把这套 admission 通过 hook 安装到 OpenClaw Gateway 上，但要注意两件事：

- 只安装 skill，不会自动把所有普通消息劫持到 manager。
- 只安装 skill，本身不会自动把所有普通消息劫持到 manager
- `allow_implicit_invocation` 也不等于 pre-routing hook。

你还需要完成一次 setup：

```bash
node ~/.openclaw/tools/openclaw-manager/scripts/setup-openclaw-local-chain.ts
```

这个 helper 会自动执行：

1. 写本机 local-chain config
2. `openclaw hooks install -l <repo>/hooks/openclaw-manager-prerouting`
3. `openclaw hooks enable openclaw-manager-prerouting`
4. 安装本机 sidecar user service

然后要求你重启 Gateway。

## 2. 目标形态

普通消息进入 OpenClaw 宿主后，应先走：

1. 宿主读取最小 message envelope
2. 宿主调用 manager pre-routing hook
3. 宿主根据 admission result 决定：
   - `do_nothing`：继续走原来的默认 skill / router
   - `suggest_adopt`：向用户提示 `/adopt` 或显示“交给 manager”的建议
   - `direct_adopt`：直接走 manager canonical ingress，并短路默认 skill 路由

目标不是让 manager 接管一切，而是让“明显属于长期任务 / 跟进 / 研究 / 项目”的普通消息先被 manager 看一眼。

## 3. 宿主侧最小 hook 点

pre-routing hook 应放在：

- 用户普通消息进入默认 skill 选择之前
- 学术研究、通用聊天、搜索等 skill 被选择之前
- 但在显式命令解析之后

推荐顺序：

1. 先处理显式 manager 命令：`/adopt`、`/resume`、`/focus` 等
2. 如果不是显式命令，再执行 manager pre-routing hook
3. 只有 hook 返回 `do_nothing` 时，才继续正常 skill routing

## 4. 宿主侧调用链

宿主 pre-routing hook 应复用现有三段式链路：

1. `collectHostContext(...)`
2. `shouldSuggestAdopt(...)`
3. `suggestOrAdopt(...)`

宿主不要自己复制规则，不要自己重新拼 admission score。

如果宿主希望只接一个最薄 helper，而不是自己拼三段式调用，当前仓库提供两种入口：

- [`src/host/prerouting-hook.ts`](/Users/yangshangqing/metaclaw/src/host/prerouting-hook.ts)
- `POST /host/prerouting`

宿主或 hook 可直接调用：

1. `runOpenClawManagerPreRoutingHook(...)`
2. 或 `POST /host/prerouting`
3. 根据返回的 `action` 决定继续默认路由、显示 suggestion，或短路到 manager

这个 helper 还会顺带返回：

- `session_console_url`

方便宿主在收编成功后直接把 `/ui` 地址发给用户。

## 5. 规范化行为

### 5.1 `do_nothing`

宿主行为：

- 不写 Manager
- 不改写原生会话历史
- 继续原有 skill routing

### 5.2 `suggest_adopt`

宿主行为：

- 不写 Manager durable state
- 不偷偷创建 session
- 向用户显示明确建议，例如：
  - “这条消息更像长期任务，可以交给 openclaw-manager 管理”
  - “如需持久跟进，请执行 `/adopt`”

### 5.3 `direct_adopt`

宿主行为：

- 只在存在完整 capture key 时允许：
  - `source_type`
  - `source_thread_key`
  - `message_id`
- 直接走 manager canonical ingress，并短路默认 skill 路由
- 调用 canonical manager ingress：
  - `POST /adopt`
  - `POST /inbound-message`
- 成功后不再把同一条消息交给其他 skill 当成普通对话重新处理

## 6. 安装时必须提示宿主完成的设置

如果希望“装好 skill 后普通消息能被 manager 优先接触”，安装流程里必须明确完成这些设置：

1. 启用 manager pre-routing hook
2. 保证 manager sidecar 在同机可达，默认：
   - `http://127.0.0.1:8791`
3. 如果 sidecar 不是默认端口，给 Gateway 进程设置：
   - `OPENCLAW_MANAGER_BASE_URL=http://127.0.0.1:8791`
4. 让宿主在普通消息入口提供稳定 capture key：
   - `source_type`
   - `source_thread_key`
   - `message_id`
5. 让宿主把 pre-routing hook 放在默认 skill routing 之前
6. 让宿主在 `suggest_adopt` 时显示建议，而不是静默忽略

如果宿主没完成这些设置，那么 manager 仍然只能靠显式命令或显式 skill 调用进入。

## 7. 为什么默认是 `127.0.0.1:8791`

当前推荐拓扑是：

- OpenClaw 宿主和 openclaw-manager sidecar 同机运行
- sidecar 监听本机 loopback

因此默认地址应是：

- `http://127.0.0.1:8791`

这意味着：

- manager sidecar 不必直接暴露公网
- admission / command path 都走本机 HTTP
- 宿主可以把 manager 当作本地控制面，而不是远程服务

如果宿主和 sidecar 不同机，就不能继续假设 `127.0.0.1:8791` 有效。

## 8. 明确禁止事项

宿主 pre-routing hook 绝不能：

- 直接改写 OpenClaw 原生历史
- 直接 import manager control plane / fs-store
- 在宿主侧偷偷做 session merge
- 在没有稳定 `message_id` 时自动 direct ingress
- 在只有语义相似时把消息硬塞给已有 session

## 9. 建议的安装提示文案

安装 openclaw-manager skill 时，宿主应至少提示：

1. “是否启用 manager pre-routing hook，用于在普通消息进入默认技能前先做任务收编判定？”
2. “如果启用，请确认 OpenClaw 与 manager sidecar 同机运行，并把 base URL 设为 `http://127.0.0.1:8791`。”
3. “请确认宿主普通消息入口能提供稳定 `source_type + source_thread_key + message_id`，否则只能 suggestion，不能 direct adopt。”

## 10. 当前自动化程度

当前仓库已经自动化的部分：

- 提供 install-time 可下载的 manager bundle
- 提供一键 hook setup helper
- 提供 managed hook 实现
- 提供 sidecar canonical prerouting API

当前还没有自动化的部分：

- OpenClaw skill install action 本身还不能运行任意自定义 post-install prompt / script
- generic `message:received` hook 只能完成 admission + 提示/收编，不保证硬性中止默认 skill 路由
- 如果要做到严格的“先 manager 再决定是否继续默认 skill”，仍然需要更深的宿主/runtime pre-router 支持

## 11. 与当前验收边界的关系

这份文档定义的是宿主集成方案，不是仓库内核已经自动完成的能力。

当前自动化验收已经证明：

- admission 规则本身成立
- direct ingress 语义成立
- host-side thin client / sidecar 边界成立

但当前自动化验收没有证明：

- OpenClaw 宿主已经真的把普通消息 pre-route 给 manager

因此这份文档的作用是：

- 明确“为什么现在安装 skill 还不够”
- 明确“宿主侧到底还要接哪一个 hook”
- 防止后续把 `allow_implicit_invocation` 误当成真正的消息劫持能力
