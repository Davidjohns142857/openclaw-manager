# Session Console Server Integration

`ui/session-console/` 现在已经接进 [`src/api/server.ts`](/Users/yangshangqing/metaclaw/src/api/server.ts)，不再需要手工 patch。

当前 sidecar 行为是：

- `GET /ui` 或 `GET /ui/` 返回 `ui/session-console/index.html`
- `GET /ui/*` 返回对应静态资源
- 只对 extensionless route 做 SPA fallback
- 缺失的 `.js` / `.css` / `.png` 等静态资源返回 `404`
- `/health` 会暴露 `ui.session_console_url`

当前最重要的验证点：

1. sidecar 启动后访问 `http://127.0.0.1:8791/ui`
2. `/health` 返回：
   - `ui.session_console_url`
3. `/ui/src/app.js` 返回 `application/javascript`

对应基线测试在：

- [`tests/phase1.static-boundary.test.ts`](/Users/yangshangqing/metaclaw/tests/phase1.static-boundary.test.ts)
