# Browser Connector

这是当前仓库里的第二个真实 connector adapter。

它不是浏览器扩展本体，而是浏览器插件向 manager sidecar 交付消息时应遵守的最薄 server-side contract。

当前目标只有三件事：

- 浏览器插件产生稳定的 `source_thread_key`
- 浏览器插件把消息通过 sidecar 交给 manager
- manager 通过 binding registry 把该消息路由进已有 session

## 1. 当前入口

当前浏览器消息入口：

- `POST /connectors/browser/messages`

这是一个 connector-specific ingress route，但进入 manager 后仍然会转成 canonical inbound message。

## 2. 当前最小请求体

```json
{
  "source_thread_key": "browser:sidepanel/threads/research-001",
  "message_id": "browser-msg-001",
  "text": "继续跟进这篇文章，整理后续要点。",
  "page_url": "https://example.com/research",
  "page_title": "Research Notes",
  "selection_text": "optional selected text",
  "captured_at": "2026-03-17T10:00:00.000Z",
  "metadata": {
    "surface": "sidepanel"
  }
}
```

当前硬约束：

- `source_thread_key` 必须稳定
- `message_id` 必须稳定
- `text` 必须是非空文本

不满足时返回 `400`。

## 3. Source Thread Key

浏览器 connector 当前推荐的 thread key 规范为：

```text
browser:<surface>/threads/<thread_id>
```

例如：

```text
browser:sidepanel/threads/research-001
```

这里的 `surface` 应该来自插件自己定义的稳定入口，例如 `sidepanel`、`popup`、`assistant-pane`，而不是页面标题。

## 4. Binding Flow

当前浏览器消息要真正进入某个 session，仍然遵守 generic binding flow：

1. 先创建或拿到 session
2. 调用 generic `/bind`
3. `source_type = "browser"`
4. `source_thread_key = browser:<surface>/threads/<thread_id>`
5. 浏览器插件发来的后续消息再走 `POST /connectors/browser/messages`
6. sidecar 通过 binding registry 解析 `session_id`

## 5. 当前阶段不做的事

当前浏览器 connector 还没做：

- 浏览器扩展前端实现
- 页面上下文注入
- 本地扩展通信桥
- DOM 抓取和自动摘要
- tab/session 自动合并

## 6. 当前结论

这层已经足够让“OpenClaw + 外接浏览器插件”的消息进入 manager：

- 插件只要提供稳定 `source_thread_key + message_id`
- manager 就能通过 binding-aware ingress 正确导入
- 不需要插件直接理解 manager 的 session/run/recovery 内核
