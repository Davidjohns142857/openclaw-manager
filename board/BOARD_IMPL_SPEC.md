# Viewer Board Implementation Spec (Phase A)

本文档定义 Viewer Board 的 Phase A 实现。给 Claude Code 用。

## 1. 目标

在仓库中新增一个独立的 board server，部署在 VPS 端口 18991 上，提供：

- 每个用户一个 opaque token
- 通过 `http://142.171.114.18:18991/board/bt_xxx` 访问只读看板
- 看板内容从 manager sidecar (18891) 内部代理并按 owner 过滤
- 不暴露 mutation 能力，不暴露其他用户的数据

## 2. 新增目录结构

```
board/
  BOARD.md              ← 本文档
  serve.ts              ← board server 主入口
  token-store.ts        ← token 存储与校验
  proxy.ts              ← 代理 sidecar API + 过滤
  ui/
    index.html          ← board 前端入口
    src/
      app.js
      style.css
      lib/
        api.js          ← 所有 board-api 调用
        router.js       ← 复用或简化版 hash router
        render.js       ← 复用 session-console 的渲染工具
        time.js         ← 复用
      pages/
        sessions.js     ← 只读 session 列表
        session-detail.js ← 只读详情
        run-detail.js   ← 只读 run timeline
        focus.js        ← 只读 focus queue
```

## 3. Token 系统

### 3.1 Token 格式

```
bt_<32 chars base64url random>
```

示例：`bt_f4J9xKp2mN7wQqA8vR3sT6yB1cD5eH0g`

生成方式：
```typescript
import { randomBytes } from "node:crypto";

function generateBoardToken(): string {
  return "bt_" + randomBytes(24).toString("base64url");
}
```

### 3.2 Token 存储

文件：`/var/lib/openclaw-board/tokens.json`

```json
{
  "tokens": [
    {
      "token": "bt_f4J9xKp2mN7wQqA8vR3sT6yB1cD5eH0g",
      "owner_ref": "user_primary",
      "created_at": "2026-03-18T10:00:00Z",
      "expires_at": null,
      "revoked": false,
      "label": "default board"
    }
  ]
}
```

### 3.3 token-store.ts 接口

```typescript
interface BoardToken {
  token: string;
  owner_ref: string;
  created_at: string;
  expires_at: string | null;
  revoked: boolean;
  label: string;
}

interface TokenStore {
  // 查询
  resolve(token: string): BoardToken | null;  // 返回有效 token 或 null
  list(): BoardToken[];

  // 管理
  create(ownerRef: string, label?: string): BoardToken;
  revoke(token: string): boolean;
  rotate(oldToken: string): BoardToken | null;  // 撤销旧的，生成新的
}
```

校验规则：
- token 不存在 → null
- token.revoked === true → null
- token.expires_at !== null && 已过期 → null
- 否则返回 token 对象

## 4. Board Server 路由

### 4.1 前端页面路由

```
GET /board/:token         → 提供 board UI (index.html)
GET /board/:token/*       → 提供 board UI 静态资源
```

所有 `/board/:token` 下的请求先校验 token，无效返回 403 页面。

### 4.2 Board API 路由（只读）

```
GET /board-api/:token/sessions          → 过滤后的 session 列表
GET /board-api/:token/sessions/:id      → 过滤后的 session 详情
GET /board-api/:token/focus             → 过滤后的 focus queue
GET /board-api/:token/digest            → 过滤后的 digest
GET /board-api/:token/health            → board 状态（不含敏感信息）
```

每个 API 路由：
1. 校验 token → 拿到 owner_ref
2. 代理到 sidecar (127.0.0.1:18891)
3. 过滤响应：只返回 owner_ref 匹配的 session/run/focus

### 4.3 Token 管理路由（内部）

```
POST /admin/tokens          → 创建 token（需 admin secret）
GET  /admin/tokens          → 列出 tokens（需 admin secret）
POST /admin/tokens/:token/revoke  → 撤销（需 admin secret）
POST /admin/tokens/:token/rotate  → 轮换（需 admin secret）
```

admin secret 通过环境变量 `BOARD_ADMIN_SECRET` 配置，请求需带 `Authorization: Bearer <secret>` header。

### 4.4 不暴露的路由

Board server 绝不代理以下 sidecar 路由：
- POST /adopt
- POST /sessions/:id/resume
- POST /sessions/:id/checkpoint
- POST /sessions/:id/close
- POST /inbound-message
- POST /bind
- 任何 POST mutation

## 5. 数据过滤逻辑

### 5.1 proxy.ts 核心

```typescript
async function proxySessions(ownerRef: string): Promise<Session[]> {
  const sessions = await fetchFromSidecar("/sessions");
  return sessions.filter(s => s.owner?.ref === ownerRef);
}

async function proxySessionDetail(ownerRef: string, sessionId: string): Promise<SessionDetail | null> {
  const detail = await fetchFromSidecar(`/sessions/${sessionId}`);
  if (detail?.session?.owner?.ref !== ownerRef) return null;
  return detail;
}

async function proxyFocus(ownerRef: string): Promise<AttentionUnit[]> {
  const focus = await fetchFromSidecar("/focus");
  const ownedSessionIds = new Set(
    (await proxySessions(ownerRef)).map(s => s.session_id)
  );
  return focus.filter(f => ownedSessionIds.has(f.session_id));
}
```

### 5.2 响应清洗

代理返回数据前，移除可能泄露的内部字段：
- `metadata.pending_inbound_count`（保留）
- 文件系统路径相关字段 → 替换为 null
- `latest_checkpoint_ref`、`latest_summary_ref` → 保留引用名但不暴露绝对路径

## 6. Board 前端

Board 前端和 Session Console 功能几乎相同，但：

- 所有 API 调用走 `/board-api/:token/` 而不是 `/`
- 没有 mutation 按钮（Resume、Close、Checkpoint）
- 导航栏显示 "Viewer Board" 而不是 "OpenClaw"
- 底部加一行 "Read-only board. Mutations available in chat."

### 6.1 api.js 改动

```javascript
// Board token 从 URL 中提取
function getBoardToken() {
  const match = window.location.pathname.match(/^\/board\/([^/]+)/);
  return match ? match[1] : null;
}

const TOKEN = getBoardToken();
const API_BASE = `/board-api/${TOKEN}`;

export const fetchSessions = () => get(`${API_BASE}/sessions`);
export const fetchSessionDetail = (id) => get(`${API_BASE}/sessions/${encodeURIComponent(id)}`);
export const fetchFocus = () => get(`${API_BASE}/focus`);
// 没有 mutation exports
```

### 6.2 复用策略

可以直接从 `ui/session-console/src/` 复制以下文件并稍作修改：
- `lib/router.js` → 原样复用
- `lib/render.js` → 原样复用
- `lib/time.js` → 原样复用
- `pages/sessions.js` → 删除 action 按钮
- `pages/session-detail.js` → 删除 Resume/Checkpoint/Close 按钮
- `pages/run-detail.js` → 原样复用
- `style.css` → 原样复用或微调色调

## 7. 配置

```typescript
interface BoardConfig {
  port: number;                    // default: 18991
  sidecarOrigin: string;          // default: http://127.0.0.1:18891
  dataDir: string;                // default: /var/lib/openclaw-board
  adminSecret: string;            // from env BOARD_ADMIN_SECRET
}
```

环境变量：
```
BOARD_PORT=18991
BOARD_SIDECAR_ORIGIN=http://127.0.0.1:18891
BOARD_DATA_DIR=/var/lib/openclaw-board
BOARD_ADMIN_SECRET=<random strong secret>
```

## 8. 首次使用流程

部署完成后，管理员（你）创建第一个 board token：

```bash
# 生成 admin secret（一次性）
ADMIN_SECRET=$(openssl rand -hex 32)

# 创建 board token
curl -X POST http://127.0.0.1:18991/admin/tokens \
  -H "Authorization: Bearer ${ADMIN_SECRET}" \
  -H "Content-Type: application/json" \
  -d '{"owner_ref": "user_primary", "label": "my board"}'
```

返回：
```json
{
  "token": "bt_f4J9xKp2mN7wQqA8vR3sT6yB1cD5eH0g",
  "board_url": "http://142.171.114.18:18991/board/bt_f4J9xKp2mN7wQqA8vR3sT6yB1cD5eH0g",
  "owner_ref": "user_primary",
  "created_at": "2026-03-18T10:00:00Z"
}
```

然后把 board_url 发给你自己或者别人，打开就能看到只读看板。

## 9. 安全要点

- Board token 是访问凭据，泄露即可看到该用户的所有 session
- Admin secret 必须强随机且不对外暴露
- Board server 只做 GET 代理，绝不代理 POST mutation
- 每个 API 响应都按 owner_ref 过滤后才返回
- Token 支持撤销和轮换，发现泄露可立即 revoke

## 10. 给 Claude Code 的优先级

1. 先写 `board/token-store.ts` 和 `board/proxy.ts` — 核心逻辑
2. 再写 `board/serve.ts` — 路由 + 静态服务
3. 再复制和修改 board UI — 从 session-console 派生
4. 最后加 admin 路由 — token CRUD
