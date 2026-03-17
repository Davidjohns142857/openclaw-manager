# GitHub Connector

这是当前仓库里的第一个真实 connector adapter。

它的职责只有三件事：

- 接收 GitHub webhook
- 把 `issues` / `issue_comment` 归一化成 canonical inbound message
- 通过 binding registry 把 GitHub thread 路由进已有 session

## 1. 当前入口

当前 webhook 入口：

- `POST /connectors/github/events`

当前使用的 GitHub headers：

- `X-GitHub-Event`
- `X-GitHub-Delivery`

## 2. 当前支持的事件

### `issue_comment`

当前支持 action：

- `created`
- `edited`

归一结果：

- `message_type = "user_message"`
- `content = comment.body`
- `request_id` 优先由 `X-GitHub-Delivery` 派生

### `issues`

当前支持 action：

- `opened`
- `edited`
- `reopened`
- `closed`

归一结果：

- `message_type = "system_update"`
- `content = issue.title + issue.body`

### 当前忽略

- `ping`
- 其他 event
- 不在支持列表内的 action

忽略时返回：

- `202`
- `accepted=false`
- `ignored=true`

## 3. Source Thread Key

当前 GitHub binding 使用的 `source_thread_key` 规范为：

```text
github:<owner>/<repo>/issues/<issue_number>
```

例如：

```text
github:openai/openclaw/issues/42
```

这是 `issues` 和 `issue_comment` 共同使用的 thread key。

## 4. Binding Flow

要让 GitHub webhook 真正推动某个 session，当前步骤是：

1. 先创建或拿到一个 session
2. 调用 generic `/bind`
3. `source_type = "github"`
4. `source_thread_key = github:<owner>/<repo>/issues/<issue_number>`
5. GitHub webhook 进来后，sidecar 自动通过 binding registry 解析 `session_id`

## 5. 当前阶段不做的事

当前 GitHub connector 还没做：

- webhook signature verification
- PR review / discussion thread 归一化
- check_run / workflow_run / push event 映射
- GitHub-specific bind helper API
- 反向写回 GitHub comment

## 6. 当前结论

这层已经足够让 GitHub 作为第一个真实 external source 跑通：

- 先 bind
- 再 webhook
- 再 canonical inbound
- 再走既有 session/run/event/recovery 内核
