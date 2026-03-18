# Cloud Deploy Boundary

这份文档定义 OpenClaw Manager 在 Cloud / 托管环境下必须遵守的网络边界。

## 1. 明确禁止事项

以下做法一律禁止：

- 把 manager sidecar 绑定到 `0.0.0.0`
- 直接把 `127.0.0.1:8791` 暴露到公网
- 让终端用户直接访问 sidecar 原生端口
- 复用 public ingest 端点当作 UI 地址
- 复用 public ingest 的同一个 `host:port` 当作 UI 地址
- 复用 `56557/v1/ingest`、`/v1/health`、`/v1/facts` 这组公网 API 做前端页面

Manager sidecar 是本机控制面，不是公网 Web 应用。

## 2. 允许的形态

允许的边界有三种：

1. 本机管理员模式

- sidecar 监听 `127.0.0.1:8791`
- `/ui` 只给同机管理员使用
- 终端用户不拿这个地址

2. Gateway / 反代发布模式

- sidecar 仍然监听 `127.0.0.1:8791`
- OpenClaw Gateway 默认 WebUI 在 `127.0.0.1:18789`
- 云端通常不会直接暴露 `:18789`，而是由外层 reverse proxy 映射成公网 URL
- 如果要让手机或远端用户看页面，应该发布一个 Gateway / reverse-proxy URL，再把它配置成 `OPENCLAW_MANAGER_UI_PUBLIC_BASE_URL`

3. 独立 Viewer Board 服务

- sidecar 仍然监听 `127.0.0.1:8791`
- 单独起一个共享只读 board 服务，绑定到独立端口，例如 `0.0.0.0:18991`
- 本地 sidecar 通过 `POST /board-sync/:token` 推快照
- 公开给手机或远端用户的是 `http://host:18991/board/<token>/`

也就是说，公开页面必须是：

- Gateway 自己的公开 Web surface
- 或 Gateway 前面的 reverse proxy path
- 或独立 Viewer Board 服务的独立端口

绝不能是 sidecar 原生端口，也绝不能是 ingest 的 `host:port`。

## 3. 与 Public Ingest 的关系

公网 ingest 只负责接收 facts：

- `http://142.171.114.18:56557/v1/ingest`

它是提交面，不是 UI 面。

以下地址只能用于数据提交或只读检查：

- `/v1/ingest`
- `/v1/health`
- `/v1/facts`

这些地址绝不能被当作 session console、timeline 页面或用户前端。

## 4. Cloud 模式下的宿主行为

在 OpenClaw Cloud 里，如果你无法：

- 写入 Gateway hook 目录
- 重启 Gateway

那么系统必须退回：

- `manual_adopt`

也就是：

- 用户继续正常对话
- 当某个任务值得持久跟踪时，手动执行 `/adopt`
- 其余 sidecar / facts auto-submit 能力仍然可以继续启用

## 5. 推荐的公开页面方式

如果未来要做手机可访问页面，推荐顺序是：

1. 挂到 OpenClaw Gateway 已有公开 Web surface 下
2. 挂到 Gateway 前面的 reverse proxy 路径下
3. 使用独立 Viewer Board 服务端口，例如 `18991`
4. 单独部署只读 dashboard 服务

不推荐，也不允许：

- 直接开放 sidecar 端口
- 直接复用 ingest 的 `host:port` / 端点
