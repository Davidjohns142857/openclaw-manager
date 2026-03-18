# Viewer Board Revised Architecture

## 核心转变

之前的假设：board server 代理同机 sidecar 的数据。
实际需求：每个用户的 sidecar 在本地，board server 在 VPS 上是一个 **共享的公网展示服务**。

数据流方向是 **push，不是 proxy**：

```
用户 A 的本地 sidecar ──push──→ VPS board server ←── 用户 A 的浏览器
用户 B 的本地 sidecar ──push──→ VPS board server ←── 用户 B 的浏览器
用户 C 的本地 sidecar ──push──→ VPS board server ←── 用户 C 的浏览器
```

每个用户有一个 board token。Token 同时用于：
1. sidecar 向 board 推送数据（写入凭据）
2. 浏览器打开 board 页面（读取凭据）

## Board Server 需要做的事

### 1. 接收 sidecar 推送的快照

```
POST /board-sync/:token
Content-Type: application/json

{
  "snapshot_at": "2026-03-18T10:00:00Z",
  "sessions": [ ...Session[] with activity... ],
  "focus": [ ...AttentionUnit[]... ],
  "session_details": {
    "sess_xxx": { session, run, checkpoint, summary },
    "sess_yyy": { session, run, checkpoint, summary }
  }
}
```

Board server 收到后：
- 校验 token 有效性
- 存到 `/var/lib/openclaw-board/snapshots/<token_hash>/latest.json`
- 覆盖式写入（不累积历史，只保留最新快照）

### 2. 给浏览器提供只读 API

```
GET /board-api/:token/sessions        → 从快照读 sessions
GET /board-api/:token/sessions/:id    → 从快照读 session detail
GET /board-api/:token/focus           → 从快照读 focus
GET /board-api/:token/health          → 快照时间 + 在线状态
```

数据全部来自本地存储的快照文件，不再代理任何外部服务。

### 3. 给浏览器提供只读 UI

```
GET /board/:token       → 只读 board 页面
GET /board/:token/*     → 静态资源
```

## 本地 Sidecar 需要做的事

在 sidecar 中新增一个 **board sync** 模块，定期把当前状态推送到 VPS：

### 触发时机

- sidecar 启动时推送一次
- 之后每 10-30 秒推送一次（可配置）
- 任何 mutation（adopt/resume/close/inbound）之后立即推送一次

### 推送内容

从 sidecar 内存/文件中读取：
- 所有 session（带 activity）
- focus queue
- 每个 session 的 detail（run, checkpoint, summary）

打包成一个 JSON 快照，POST 到 VPS。

### 配置

```typescript
// 新增到 ManagerConfig 或独立配置
interface BoardSyncConfig {
  enabled: boolean;                    // default: false
  board_push_url: string;             // e.g. http://142.171.114.18:18991/board-sync/<token>
  board_token: string;                // bt_xxx
  push_interval_ms: number;           // default: 15000
  push_on_mutation: boolean;          // default: true
}
```

环境变量：
```
OPENCLAW_BOARD_SYNC_ENABLED=true
OPENCLAW_BOARD_TOKEN=bt_xxx
OPENCLAW_BOARD_PUSH_URL=http://142.171.114.18:18991/board-sync/bt_xxx
OPENCLAW_BOARD_PUSH_INTERVAL_MS=15000
```

### 推送代码骨架

```typescript
// src/board/board-sync.ts

export class BoardSyncService {
  private config: BoardSyncConfig;
  private controlPlane: ControlPlane;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(config: BoardSyncConfig, controlPlane: ControlPlane) {
    this.config = config;
    this.controlPlane = controlPlane;
  }

  start(): void {
    if (!this.config.enabled) return;
    this.push();  // immediate first push
    this.timer = setInterval(() => this.push(), this.config.push_interval_ms);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  // Call this after any mutation
  async pushNow(): Promise<void> {
    if (!this.config.enabled) return;
    await this.push();
  }

  private async push(): Promise<void> {
    try {
      const snapshot = await this.buildSnapshot();
      const res = await fetch(this.config.board_push_url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-board-token": this.config.board_token
        },
        body: JSON.stringify(snapshot),
        signal: AbortSignal.timeout(5000)
      });
      if (!res.ok) {
        console.warn(`[board-sync] push failed: ${res.status}`);
      }
    } catch (err) {
      // Silent failure — board sync is best-effort, never blocks sidecar
      console.warn(`[board-sync] push error: ${err instanceof Error ? err.message : err}`);
    }
  }

  private async buildSnapshot(): Promise<BoardSnapshot> {
    const sessions = await this.controlPlane.listTasks();
    const focus = await this.controlPlane.focus();

    const sessionDetails: Record<string, unknown> = {};
    for (const session of sessions) {
      try {
        sessionDetails[session.session_id] = await this.controlPlane.getSessionDetail(session.session_id);
      } catch {
        // Skip failed detail reads
      }
    }

    return {
      snapshot_at: new Date().toISOString(),
      sessions: sessions.map(s => ({
        ...s,
        // activity is already included by serializer
      })),
      focus,
      session_details: sessionDetails
    };
  }
}

interface BoardSnapshot {
  snapshot_at: string;
  sessions: unknown[];
  focus: unknown[];
  session_details: Record<string, unknown>;
}
```

## VPS Board Server 修改

当前 `deploy-board.sh` 里的 `serve.ts` 需要修改：

### 删除

- 所有 `sidecarGet()` 代理逻辑
- `BOARD_SIDECAR_ORIGIN` 配置

### 新增

- `POST /board-sync/:token` — 接收快照并存储
- 快照文件读写逻辑
- board-api 从快照文件读数据而不是代理 sidecar

### 快照存储

```
/var/lib/openclaw-board/
  tokens.json
  snapshots/
    <token_prefix>/          # 用 token 前 16 字符做目录名
      latest.json            # 最新快照
      meta.json              # 最后推送时间、推送次数
```

### 新增路由

```
POST /board-sync/:token     → 接收快照
  - 校验 token
  - 写入 snapshots/<prefix>/latest.json
  - 更新 meta.json

GET /board-api/:token/sessions     → 从 latest.json 读 sessions
GET /board-api/:token/sessions/:id → 从 latest.json 读 session_details[id]
GET /board-api/:token/focus        → 从 latest.json 读 focus
GET /board-api/:token/health       → 从 meta.json 读最后推送时间
```

## 用户体验流程

### 首次设置（一次性）

1. 你（管理员）在 VPS 上创建 board token：
   ```bash
   curl -X POST http://127.0.0.1:18991/admin/tokens \
     -H "Authorization: Bearer $ADMIN_SECRET" \
     -d '{"owner_ref":"user_primary"}'
   ```
   返回 `bt_xxx` 和 `board_url`

2. 用户在本地配置 sidecar 的 board sync：
   ```bash
   export OPENCLAW_BOARD_SYNC_ENABLED=true
   export OPENCLAW_BOARD_TOKEN=bt_xxx
   export OPENCLAW_BOARD_PUSH_URL=http://142.171.114.18:18991/board-sync/bt_xxx
   ```
   然后重启 sidecar

### 日常使用

- 用户正常在 OpenClaw 里工作（adopt/resume/close）
- 本地 sidecar 每 15 秒自动推送快照到 VPS
- 用户（或任何拿到链接的人）打开 `http://142.171.114.18:18991/board/bt_xxx`
- 看到该用户的只读任务看板，数据每次刷新都是最新快照

### 多用户

- 每个用户有自己的 token
- 每个用户的数据隔离在自己的快照目录
- 同一个 18991 端口服务所有用户
- 用户 A 看不到用户 B 的数据

## 相比之前方案的区别

| 之前 | 现在 |
|---|---|
| board 代理同机 sidecar | board 存储各用户推送的快照 |
| board 和 sidecar 必须在同一台机器 | board 在 VPS，sidecar 在用户本地 |
| 实时代理 | 准实时快照（15 秒延迟） |
| 只能一个用户 | 天然多用户 |

## 开发优先级

### 仓库里（给 Claude Code）

1. 写 `src/board/board-sync.ts` — sidecar 侧的推送模块
2. 在 `src/main.ts` 里接入 BoardSyncService
3. 在 `src/control-plane/control-plane.ts` 的 mutation 方法末尾加 `boardSync.pushNow()`
4. 加配置项到 `ManagerConfig`

### VPS 上

1. 更新 `serve.ts`：删代理逻辑，加 `POST /board-sync/:token` 和快照读取
2. `systemctl restart openclaw-board`

## 安全要点

- 推送时 token 既在 URL 里也在 header 里，board server 校验两者一致
- 快照文件只包含该用户自己的数据（sidecar 侧已经是单用户的）
- 快照大小限制：单次推送不超过 5MB
- 推送频率限制：每个 token 每分钟最多 10 次
- board server 不向外暴露快照文件路径
