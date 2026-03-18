# Session Console Frontend

这是 OpenClaw Manager 的最小只读前端。它从 manager sidecar 同源提供，用于让用户在浏览器中直观查看任务进程、工作状态和 skill 使用情况。

## 1. 架构约束

- **零构建工具**：纯 HTML/CSS/JS，无 React/Vue/Webpack/Vite，直接被 sidecar 静态提供
- **同源部署**：sidecar 在 `/ui/*` 路径下提供静态文件，API 在 `/` 下，无跨域
- **只读优先**：首要目标是可视化，mutation 按钮（resume/close）是增强项
- **不碰内核**：前端不 import 任何 `src/` 代码，只通过 HTTP API 消费数据
- **Hash 路由**：用 `#/path` 做客户端路由，不需要服务端 rewrite

## 2. 页面结构

```
#/                          → Session 列表页（默认）
#/sessions/:session_id      → Session 详情页
#/sessions/:session_id/runs/:run_id  → Run Timeline / Evidence 页
#/outbox                    → Public Facts / Outbox 状态页
```

## 3. 后端 API 接口清单

所有接口都是同源调用，base path 为空。

### 3.1 只读接口（首要）

| 方法 | 路径 | 用途 | 返回核心字段 |
|------|------|------|-------------|
| GET | `/health` | sidecar 状态 | `status`, `session_count`, `port`, `ui.session_console_url`, `ui.local_session_console_url`, `host_integration` |
| GET | `/sessions` | 全部 session 列表 | `Session[]`，每个带 `activity` |
| GET | `/sessions/:id` | 单个 session 详情 | `{ session, run, checkpoint, summary }` |
| GET | `/sessions/:id/timeline` | session 下全部 run timeline / evidence | `SessionTimelineView` |
| GET | `/focus` | 注意力队列 | `AttentionUnit[]` |
| GET | `/digest` | 多任务摘要 | `string`（Markdown） |
| GET | `/bindings` | 外部源绑定列表 | `ConnectorBinding[]` |
| GET | `/contracts` | reserved API contracts | `{ version, contracts[] }` |
| GET | `/public-facts/outbox` | outbox batch 列表 | `CapabilityFactOutboxBatch[]` |
| GET | `/public-facts/outbox/:batch_id` | 单 batch 详情 | `{ batch, receipts }` |

### 3.2 Session 列表接口详情

**GET /sessions**

返回 `Session[]`，每个 session 对象包含 `activity` 字段：

```json
{
  "session_id": "sess_xxx",
  "title": "...",
  "objective": "...",
  "status": "active | waiting_human | blocked | completed | abandoned | ...",
  "priority": "low | medium | high | critical",
  "active_run_id": "run_xxx | null",
  "tags": ["research", "product"],
  "metrics": {
    "run_count": 3,
    "failed_run_count": 1,
    "human_intervention_count": 1,
    "artifact_count": 4,
    "last_activity_at": "2026-03-17T20:45:00Z"
  },
  "activity": {
    "run": { "state": "running | idle", "phase": "running | completed | failed | idle | ..." },
    "queue": { "state": "pending | idle", "count": 0 },
    "summary": { "state": "fresh | stale" }
  }
}
```

### 3.3 Session 详情接口详情

**GET /sessions/:session_id**

返回 session detail envelope：

```json
{
  "session": { "...完整 Session 对象..." },
  "run": {
    "run_id": "run_xxx",
    "status": "running | waiting_human | completed | failed | ...",
    "trigger": { "trigger_type": "manual | message | resume | ...", "request_id": "..." },
    "execution": {
      "invoked_skills": ["web-research", "summarizer"],
      "invoked_tools": ["web.run"],
      "start_checkpoint_ref": "...",
      "recovery_checkpoint_ref": "...",
      "end_checkpoint_ref": "...",
      "artifact_refs": ["art_xxx"],
      "events_ref": "runs/run_xxx/events.jsonl",
      "skill_traces_ref": "runs/run_xxx/skill_traces.jsonl"
    },
    "outcome": {
      "result_type": "completed | partial_progress | waiting_human | failed | null",
      "summary": "...",
      "human_takeover": false,
      "closure_contribution": 0.8
    },
    "metrics": {
      "skill_invocation_count": 2,
      "tool_call_count": 1,
      "error_count": 0,
      "duration_ms": 45000
    },
    "started_at": "...",
    "ended_at": "..."
  },
  "checkpoint": { "...或 null..." },
  "summary": "...Markdown 字符串或 null..."
}
```

### 3.4 Focus 接口详情

**GET /focus**

返回 `AttentionUnit[]`：

```json
[
  {
    "attention_id": "attn_xxx",
    "session_id": "sess_xxx",
    "category": "waiting_human | blocked | desynced | stale | summary_drift",
    "urgency": "low | medium | high | critical",
    "expected_human_action": "...",
    "reasoning_summary": "...",
    "recommended_next_step": "...",
    "attention_priority": 48,
    "metadata": {
      "primary_category_rule": "waiting_human > blocked > desynced > stale > summary_drift",
      "merged_categories": ["waiting_human", "summary_drift"]
    }
  }
]
```

### 3.5 Mutation 接口（按钮用）

| 方法 | 路径 | 用途 | 请求体 |
|------|------|------|--------|
| POST | `/sessions/:id/resume` | 恢复 session | `{}` |
| POST | `/sessions/:id/checkpoint` | 刷新 checkpoint | `{}` |
| POST | `/sessions/:id/close` | 关闭 session | `{ resolution: "completed" }` |
| POST | `/adopt` | 新建 session | `{ title, objective }` |

所有 mutation 都返回 session detail envelope。

## 4. 页面设计要求

### 4.1 Session 列表页 (`#/`)

核心目标：一眼看到所有任务的状态全景。

必须展示：
- 每个 session 的 title、status、priority
- `activity.run.state` + `activity.run.phase` — 当前有没有活跃 run、处于什么阶段
- `activity.queue` — 有没有待处理的 inbound
- `metrics.run_count`、`metrics.failed_run_count` — 执行总量和失败次数
- `metrics.last_activity_at` — 最后活动时间（相对时间，如 "3h ago"）
- 每行可点击进入详情

分组/排序建议：
- 按 status 分组（active/waiting_human/blocked 在上，completed/abandoned 在下）
- 或者顶部放 focus attention items，下面放安静 session

可选增强：
- 顶部显示 `/health` 的 sidecar 状态
- 只有 `ui.session_console_url` 非空时，才把它当成可分享的用户入口
- `ui.local_session_console_url` 只应标记成“本机管理员入口”
- 只有 `ui.read_only !== true` 时才显示快捷 action 按钮（resume、close）

### 4.2 Session 详情页 (`#/sessions/:id`)

核心目标：理解一个任务的完整上下文。

左栏或上方：
- session 基本信息（title、objective、status、priority、tags）
- `state.blockers[]` — 当前阻塞列表
- `state.pending_human_decisions[]` — 待决策列表
- `state.next_machine_actions[]` + `state.next_human_actions[]` — 下一步
- `source_channels[]` — 绑定的外部源

右栏或下方：
- 当前 run 信息（status、trigger、duration）
- **invoked_skills** 列表 — 这是用户核心关注点之一
- **invoked_tools** 列表
- outcome 摘要
- summary（Markdown 渲染）
- checkpoint 状态（有/无、transaction_id）

底部：
- run 历史列表，直接消费 `GET /sessions/:id/timeline` 的 `runs[]`
- 每条可点击进入 run detail

Action 按钮：
- Resume / Checkpoint / Close

### 4.3 Run Timeline / Evidence 页 (`#/sessions/:id/runs/:run_id`)

核心目标：理解一次执行发生了什么。

当前页面应直接消费 `GET /sessions/:id/timeline`，不要再假设 `GET /sessions/:id` 能提供指定 run 的完整 evidence。

必须展示：
- run 基本信息（status、trigger、started_at、ended_at、duration）
- **invoked_skills** — 最重要，用户想看每个 run 都用了哪些 skill
- **invoked_tools** — 辅助
- outcome（result_type、summary、closure_contribution）
- execution refs（events_ref、skill_traces_ref、spool_ref）
- checkpoint refs（start → recovery → end）

增强：
- 如果后续加了 timeline-service 的 API，可以展示时间线可视化
- skill 使用可以做成卡片或者 tag 云

### 4.4 Public Facts / Outbox 状态页 (`#/outbox`)

核心目标：看到蒸馏和上报的状态。

展示：
- outbox 统计（pending / claimed / acked / failed_retryable / dead_letter）
- batch 列表（batch_id、fact_count、created_at、attempt_count、state）
- auto-submit 状态
- 公域 ingest 的连接状态

当前应直接消费：

- `GET /public-facts/outbox`
- `POST /public-facts/submit`
- `GET /health`

## 5. 静态文件目录结构

```
ui/session-console/
  FRONTEND.md          ← 本文档
  index.html           ← 入口 HTML shell
  src/
    app.js             ← 路由 + 初始化
    lib/
      api.js           ← 封装所有 HTTP 调用
      router.js        ← hash 路由器
      render.js        ← DOM 渲染工具函数
      time.js          ← 时间格式化
    pages/
      sessions.js      ← Session 列表页
      session-detail.js ← Session 详情页
      run-detail.js    ← Run Timeline 页
      outbox.js        ← Public Facts 页
    components/
      status-badge.js  ← 状态标签组件
      skill-tags.js    ← Skill 使用展示组件
      activity-indicator.js ← activity 状态指示器
      markdown.js      ← Markdown 渲染（可选用 marked.js CDN）
    style.css          ← 全局样式
```

## 6. 技术要求

### 6.1 无构建约束

- 所有 JS 使用 ES modules（`<script type="module">`）
- CSS 直接引入，不用预处理器
- 外部依赖只通过 CDN（如 marked.js 用于 Markdown 渲染）
- 文件直接被 sidecar 提供，无编译步骤

### 6.2 API 调用封装

`lib/api.js` 应导出：

```javascript
// 只读
export async function fetchHealth()
export async function fetchSessions()
export async function fetchSessionDetail(sessionId)
export async function fetchFocus()
export async function fetchDigest()
export async function fetchBindings()

// Mutation
export async function resumeSession(sessionId)
export async function checkpointSession(sessionId)
export async function closeSession(sessionId, resolution = "completed")
export async function adoptSession(title, objective)
```

所有调用走同源相对路径，不需要 base URL 配置。

### 6.3 路由

`lib/router.js` 实现最小 hash router：

```javascript
// 注册路由
router.on("/", renderSessionList);
router.on("/sessions/:session_id", renderSessionDetail);
router.on("/sessions/:session_id/runs/:run_id", renderRunDetail);
router.on("/outbox", renderOutbox);

// 监听 hashchange
router.start();
```

### 6.4 自动刷新

Session 列表页每 10 秒自动 poll `/sessions`，详情页每 5 秒 poll session detail。用户离开页面时停止 poll。

## 7. Sidecar 静态文件服务集成

当前仓库已经完成静态文件集成。

当前 sidecar 行为是：

- `GET /ui` 或 `GET /ui/` 返回 `ui/session-console/index.html`
- `GET /ui/*` 返回对应静态资源
- 只有 extensionless route 才做 SPA fallback
- 缺失的 `.js` / `.css` / `.png` 等静态资源返回 `404`
- `GET /health` 会暴露 `ui.session_console_url` 与 `ui.local_session_console_url`

因此当前前端默认入口就是：

- `http://127.0.0.1:8791/ui`

但这只是同机管理面。只有当系统显式发布了外部 UI URL，并且 `/health -> ui.session_console_url` 非空时，前端页面才适合发给手机或远端用户。

当前允许的远程访问形态有两种：

- Gateway / reverse proxy 发布
- 独立 published read-only UI 代理端口

无论哪种方式，raw sidecar 端口和 ingest 的 `host:port` 都不能直接发给终端用户。

## 8. 设计方向

**色调**：深色系控制台风格，偏向 terminal/ops 审美，不要花哨。

**字体**：等宽字体用于数据（JetBrains Mono 或 Fira Code），正文用 DM Sans 或类似的清晰无衬线体。

**状态着色规则**：
- `active` / `running` → 绿色
- `waiting_human` → 琥珀/橙色
- `blocked` / `failed` → 红色
- `completed` → 蓝色或柔灰
- `stale` / `desynced` → 黄色警告
- `idle` / `abandoned` → 灰色

**Skill 展示**：skill 名称用 tag/chip 样式，不同 skill 用不同色调，让用户一眼识别哪些 skill 参与了执行。

## 9. 开发流程

1. 启动 sidecar：`node src/main.ts`
2. 浏览器访问 `http://127.0.0.1:8791/ui`
3. 用 `/adopt` 创建几个测试 session
4. 在 UI 中查看 session 列表、session 详情、run timeline 和 outbox
