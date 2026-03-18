# OpenClaw Manager Showcase Site

面向投资人/非技术受众的项目展示站点。

## 目录结构

```
showcase/
├── index.html          # 落地页（Hero + 价值主张 + 架构图 + 实时统计）
├── demo.html           # 可交互 Demo（模拟 Session Console）
├── assets/
│   ├── style.css       # 全局样式
│   ├── landing.js      # 落地页逻辑（实时统计加载）
│   ├── demo.js         # Demo 页逻辑（Session 交互 + Public Facts）
│   └── demo-data.js    # 预填充的模拟数据
└── README.md           # 本文档
```

## 特性

### 落地页 (index.html)
- **Hero Section**: 一句话价值主张 + CTA
- **Problem Section**: 三个痛点卡片
- **Solution Section**: 四个核心能力
- **Architecture Diagram**: 简化架构图
- **Live Stats**: 从真实 Public Ingest API 拉取实时数据

### Demo 页 (demo.html)
- **Sessions Tab**: 6 个预填充模拟 session，覆盖各种状态
- **Focus Queue Tab**: 展示 Attention Engine 的筛选结果
- **Public Facts Tab**: 连接真实 `/api/v1/facts` API
- **Session Detail Modal**: 点击任一 session 查看完整信息

## 本地预览

### 方式 1: Python HTTP Server

```bash
cd /Users/yangshangqing/metaclaw/showcase
python3 -m http.server 8080
```

然后访问 `http://localhost:8080`

**注意**: Public Facts API 需要通过 `/api/` 路径访问，本地预览时该功能不可用。

### 方式 2: 使用 Caddy（推荐）

创建 `Caddyfile`:

```
:8080 {
  root * /Users/yangshangqing/metaclaw/showcase
  file_server

  # API 代理到 ingest 服务器
  handle_path /api/* {
    reverse_proxy your-vps-ip:56557
  }
}
```

运行:

```bash
caddy run
```

## VPS 部署

### 方式 1: 作为独立站点

将 `showcase/` 目录上传到 VPS `/opt/openclaw-showcase/`，配置 Caddy:

```
# /etc/caddy/Caddyfile
yourdomain.com {
  root * /opt/openclaw-showcase
  file_server

  handle_path /api/* {
    reverse_proxy 127.0.0.1:56557
  }
}
```

或者直接用 IP:

```
:80 {
  root * /opt/openclaw-showcase
  file_server

  handle_path /api/* {
    reverse_proxy 127.0.0.1:56557
  }
}
```

### 方式 2: 集成到 Ingest Server

在 ingest server 的 HTTP 服务中添加静态文件路径（类似 sidecar 的 `/ui` 实现）。

## API 依赖

### 落地页需要的 API

- `GET /api/v1/health` → 服务器状态 + 批次数量
- `GET /api/v1/aggregate` → skill 和 scenario 统计

### Demo 页需要的 API

- `GET /api/v1/facts?limit=10` → 最近的 capability facts

如果 API 不可用，页面会优雅降级，显示 "N/A" 或 "Server Offline"。

## 设计原则

- **零构建**: 纯 HTML/CSS/JS，无需 npm/webpack
- **本地数据 Demo**: 不依赖本地 sidecar，用模拟数据演示完整功能
- **渐进增强**: Public Facts 是增强功能，不影响核心展示
- **移动端适配**: 响应式设计，在手机上也能流畅查看
- **快速加载**: 首屏 < 1s，无外部依赖（除了 Google Fonts）

## 维护

- 模拟数据在 `assets/demo-data.js` 中，可随时更新
- 样式在 `assets/style.css` 中，使用 CSS 变量便于调整配色
- API 调用都有错误处理，服务器离线时不会破坏页面

## 许可

与 OpenClaw Manager 主项目共享许可。
