# OpenClaw Diary Skill 开发架构与严格规范

## 1. 文档目标

本文档服务两个目的：

1. 梳理当前仓库的开发架构，明确这个仓库究竟在交付什么。
2. 总结一套可执行、可审查、可发布的 skill 开发规范，用于后续持续扩展。

本文档同时参考了：

- 当前仓库的 3 个现有 skill 目录与其资源组织方式。
- OpenClaw 官方文档对 `SKILL.md`、metadata、加载优先级、安装与安全的要求。
- ClawHub 当前的发布、版本化、审计与发现机制。
- `skill-creator` 所强调的渐进加载、上下文节制和资源分层原则。

---

## 2. 当前仓库的开发架构

### 2.1 仓库定位

这个仓库不是传统意义上的“应用代码仓库”，而是一个 **OpenClaw skill 产品包仓库**。

它交付的核心资产不是服务端代码、前端工程或 SDK，而是：

- 可被 OpenClaw 加载的 skill 目录
- skill 自带的配置样板
- skill 的参考文档
- skill 的静态资源模板

换句话说，这个仓库的主产品是“面向代理的行为规范包”，而不是“面向 CPU 的执行程序”。

### 2.2 顶层结构

当前仓库可抽象为 4 层：

```text
openclaw-diary/
├── 根目录文档层
│   ├── README.md
│   ├── INSTALL.md
│   ├── SECURITY.md
│   └── STATUS.md
├── skill 产品层
│   ├── openclaw-diary-setup/
│   ├── openclaw-diary-core/
│   └── openclaw-diary-insights/
├── skill 资源层
│   ├── personalities/
│   ├── config/
│   ├── importers/
│   └── demo/
└── 发布与兼容层
    └── 依赖 OpenClaw / ClawHub 的加载、安装、版本和分发机制
```

### 2.3 三段式 skill 架构

当前仓库采用了比较清晰的“三段式产品拆分”：

#### A. `openclaw-diary-setup`

职责：

- 初始安装
- 配置收集
- 依赖 skill 安装
- 授权与导入引导
- 生成配置文件

本质上它是 **编排入口 skill**。

#### B. `openclaw-diary-core`

职责：

- 日常记录
- 触发识别
- 人设加载
- 存储路径解析
- 多平台写入规则

本质上它是 **核心执行 skill**。

#### C. `openclaw-diary-insights`

职责：

- 读取日记语料
- 结构化提取
- 可视化生成
- 产出 HTML / JSON

本质上它是 **后处理与分析 skill**。

### 2.4 运行时依赖关系

当前技能链路是一个典型的 pipeline：

```text
setup -> 生成配置/准备目录
      -> core 读取配置并持续产生日记
      -> insights 读取日记并生成分析结果
```

对应的运行时数据流为：

```text
用户消息
  -> OpenClaw 触发 skill
  -> skill 读取自身 SKILL.md 指令
  -> 按需读取 skill 内部资源文件
  -> 访问用户工作区 / 本地目录 / 外部平台
  -> 输出 Markdown / JSON / HTML / 文档链接
```

### 2.5 当前仓库的资源组织方式

这个仓库已经体现出 4 类常见 skill 资源：

#### 1. 指令资源

- `*/SKILL.md`

作用：

- 定义触发条件
- 定义主流程
- 约束交互风格
- 约束工具使用与输出格式

#### 2. 配置资源

- `openclaw-diary-core/config/diary-config.json`

作用：

- 为 skill 提供可读的默认配置结构
- 把运行时行为转化为配置驱动

#### 3. 参考资源

- `openclaw-diary-setup/importers/*.md`
- `openclaw-diary-core/personalities/*.md`

作用：

- 把主流程之外的变体逻辑拆出去
- 降低主 `SKILL.md` 的膨胀速度

#### 4. 产物模板资源

- `openclaw-diary-insights/demo/insights.html`
- `openclaw-diary-insights/demo/data.js`

作用：

- 提供稳定的输出模板
- 避免模型每次重新生成大块 HTML

### 2.6 当前架构的优点

当前仓库已经具备一些正确方向：

- **按职责拆 skill**：setup / core / insights 分工明确。
- **配置外置**：不是把全部运行逻辑都硬编码进 `SKILL.md`。
- **支持渐进加载**：personality、importer、demo 已拆到独立文件。
- **产品链路完整**：安装、记录、分析三段都可独立触发。
- **具备发布意识**：根目录已存在安装、状态、安全说明。

### 2.7 当前架构的主要问题

当前仓库也存在几类明显的结构性问题：

#### 1. `SKILL.md` 过重

- `openclaw-diary-setup/SKILL.md` 已明显偏长。
- `openclaw-diary-core/SKILL.md` 和 `openclaw-diary-insights/SKILL.md` 也承载了过多细节。

问题：

- 上下文成本高
- 修改风险大
- 局部变体难以替换

#### 2. skill 命名存在“目录名 / frontmatter 名 / 触发名”不一致

例如当前目录名是：

- `openclaw-diary-setup`
- `openclaw-diary-core`
- `openclaw-diary-insights`

但 skill frontmatter 内部名字分别是：

- `onboarding`
- `diary`
- `note-extractor`

问题：

- 发布、安装、覆盖、排错时认知负担高
- 不利于 ClawHub 发现与统一运维

#### 3. README 与 SKILL 说明存在重复

每个 skill 目录下都有 README，这在“人类可读”上有帮助，但对 skill 包本身不是必须。

问题：

- 文档易漂移
- 维护成本翻倍
- 容易出现 README 与 `SKILL.md` 不一致

#### 4. 校验资产已漂移

`openclaw-diary-core/check-config.sh` 仍检查旧结构中的 `skill.json` 与 `prompt.md`，与当前仓库结构不一致。

问题：

- 自动化检查失效
- 容易制造错误安全感

#### 5. 缺少统一的发布前验收标准

当前仓库没有形成明确的：

- 命名准则
- metadata 规范
- 长度预算
- 安全红线
- 测试清单
- 发布清单

这会导致后续新增 skill 的质量不稳定。

---

## 3. 从 OpenClaw 当前实践抽象出的优秀 skill 特征

下面是结合 OpenClaw 当前官方机制与 ClawHub 生态，总结出的优秀 skill 必备特征。

### 3.0 生态中的高频共同模式

从当前公开目录中高频出现的 skill 类型可以看到一些非常稳定的共性。典型例子包括：

- 集成型：`Github`、`Notion`、`Slack`、`Trello`、`Caldav`
- CLI / 工具型：`Summarize`、`Gog`、`Weather`
- 检索型：`Tavily Web Search`、`Answer Overflow`
- 结构化状态型：`Ontology`

这些 skill 尽管面向的工具和场景不同，但都呈现出同样的设计倾向：

1. **单一能力面**：一个 skill 只包住一个集成面或一类动作。
2. **显式依赖**：依赖 CLI、API key、目标平台时都可声明、可检查。
3. **输出稳定**：结果通常是明确的文本、结构化数据、外部对象操作，或固定文件。
4. **组合友好**：可以被其他 skill 当作上游能力复用。
5. **文案克制**：名称直接、描述具体，不靠修辞触发。

### 3.1 可发现

优秀 skill 必须在最短文本里让系统和用户都知道：

- 这是做什么的
- 什么情况下触发
- 需要什么依赖
- 输出什么结果

原因：

- OpenClaw 会把 skill 名称、描述、位置注入系统提示词。
- 这些字段越冗长，越浪费 token。
- 这些字段越模糊，越难正确触发。

### 3.2 可门控

优秀 skill 不能默认“总能运行”，而必须能声明：

- 需要哪些二进制
- 需要哪些环境变量
- 需要哪些配置项
- 适用于哪些操作系统

原因：

- OpenClaw 会在加载阶段根据 metadata 做 eligibility filter。
- macOS 客户端和 gateway 也依赖这些字段展示安装和缺失要求。

### 3.3 可安装

优秀 skill 不应只告诉用户“你自己去装”，而应尽量通过 metadata 暴露：

- 安装方式
- 依赖来源
- API key 主字段
- 官方主页

原因：

- OpenClaw / ClawHub 已支持 install action、env 注入和 registry 分发。
- 安装元数据越完整，用户摩擦越低。

### 3.4 可审计

优秀 skill 必须能被用户和维护者快速审计：

- 包结构清晰
- 关键动作可追踪
- 配置项可枚举
- 发布版本可对比
- 危险行为可识别

原因：

- ClawHub 本质上是公开分发市场。
- skill 是“可执行行为规范”，不是普通说明文档。

### 3.5 上下文经济

优秀 skill 不追求“把所有知识都塞进 SKILL.md”，而是追求：

- 元数据最短可用
- 主 `SKILL.md` 只写主流程
- 细节放到 references
- 稳定逻辑放到 scripts
- 输出模板放到 assets

原因：

- 技能列表注入系统提示有固定成本。
- 主 `SKILL.md` 被加载后也会直接消耗上下文。

### 3.6 行为可预测

优秀 skill 不是“写得很聪明”，而是“边界明确、失败可预期”：

- 前置检查明确
- 正常路径明确
- 异常路径明确
- 输出结构明确
- 终止条件明确

### 3.7 安全默认

优秀 skill 必须把安全作为默认值，而不是附加说明：

- 默认最小权限
- 默认不暴露 secret
- 默认不执行来源不明的 shell
- 默认不要求用户复制不透明命令
- 默认兼容 sandbox

### 3.8 易组合

优秀 skill 不是孤岛，而是能清楚声明：

- 上游 skill 是谁
- 下游 skill 是谁
- 输入输出边界是什么
- 哪些结果可被其他 skill 复用

当前仓库中的 `setup -> core -> insights` 就是一个正确方向。

### 3.9 易维护

优秀 skill 的维护成本必须随规模缓慢上升，而不是爆炸式上升。

体现为：

- 变体拆分
- 文件边界稳定
- 配置结构稳定
- 文档和实现不重复
- 有验收清单

---

## 4. 严格开发规范

以下规范使用 RFC 风格术语：

- `MUST`：必须遵守
- `SHOULD`：强烈建议遵守
- `MAY`：可选
- `MUST NOT`：禁止

## 4.1 仓库级规范

### 4.1.1 Skill 的职责边界

1. 一个 skill `MUST` 只负责一个主任务。
2. 一个 skill `MUST NOT` 同时承担“安装 + 执行 + 分析 + 发布”四类完全不同职责。
3. 多阶段产品 `SHOULD` 拆成多个 skill，并用输入输出衔接。
4. 编排型 skill `SHOULD` 只负责收集配置、检查前置条件和调度下游 skill。

### 4.1.2 仓库目录

1. 根目录 `MUST` 只保留仓库级说明、安全、安装、发布文档。
2. 每个 skill `MUST` 拥有独立目录。
3. skill 目录名 `MUST` 使用 kebab-case。
4. skill 目录名 `SHOULD` 直接对应发布 slug。

## 4.2 Skill 包结构规范

每个 skill `MUST` 至少满足：

```text
skill-name/
├── SKILL.md
```

推荐结构：

```text
skill-name/
├── SKILL.md
├── references/
├── scripts/
├── assets/
└── agents/
```

约束如下：

1. `SKILL.md` `MUST` 存在。
2. `references/` `SHOULD` 存放按需加载的长文档。
3. `scripts/` `SHOULD` 存放可重复执行的稳定逻辑。
4. `assets/` `SHOULD` 存放模板、样式、示例产物。
5. `agents/` `MAY` 存放 UI 元数据。
6. skill 目录内 `MUST NOT` 随意堆放无归类文件。

## 4.3 命名规范

1. skill 目录名、发布 slug、frontmatter `name` `SHOULD` 尽量一致。
2. 若出于兼容原因不一致，`MUST` 在仓库级文档中列出映射表。
3. `name` `MUST` 使用稳定、短、可搜索的名字。
4. `description` `MUST` 直接描述任务与触发场景，不写营销文案。

推荐格式：

- 名称：`journal-record`
- 描述：`Record user journal entries, classify them, and append to the configured local store.`

不推荐：

- 名称：`ultimate-journal-super-assistant`
- 描述：`An amazing intelligent lifelong companion for every thought you ever have.`

## 4.4 Frontmatter 规范

### 4.4.1 必填字段

每个 `SKILL.md` `MUST` 包含：

```yaml
---
name: skill-name
description: One-line task and trigger summary.
---
```

### 4.4.2 推荐字段

如需面向 OpenClaw / ClawHub 发布，`SHOULD` 声明：

- `homepage`
- `metadata.openclaw.requires`
- `metadata.openclaw.install`
- `metadata.openclaw.primaryEnv`

### 4.4.3 Metadata 约束

1. `metadata` `MUST` 保持简洁。
2. `metadata` `SHOULD` 用于机器门控，而不是写长段说明。
3. `requires.bins`、`requires.env`、`requires.config` `SHOULD` 只填真正必需项。
4. 不需要外部依赖的 skill `MUST NOT` 虚构安装要求。

## 4.5 `SKILL.md` 正文规范

### 4.5.1 必备章节

每个 `SKILL.md` `MUST` 至少包含以下章节：

1. `前置检查`
2. `核心流程`
3. `输出约定`
4. `失败处理`
5. `边界与禁止事项`

### 4.5.2 长度控制

1. `SKILL.md` 正文 `SHOULD` 控制在 300 行以内。
2. 超过 500 行视为高风险，`MUST` 拆分。
3. 长文档、示例、变体、平台差异 `MUST` 拆入 `references/`。
4. 重复性高的操作步骤 `SHOULD` 下沉到 `scripts/`。

### 4.5.3 内容风格

1. `SKILL.md` `MUST` 讲“做什么”和“何时做”。
2. `SKILL.md` `MUST NOT` 塞入大量背景故事、产品宣传、项目过程记录。
3. 示例 `SHOULD` 简短且代表边界情况。
4. 如果支持多个变体，正文 `MUST` 只保留选择规则，不展开所有细节。

## 4.6 渐进加载规范

1. 主流程说明 `MUST` 放在 `SKILL.md`。
2. 可选平台、领域知识、复杂 schema `MUST` 放在 `references/`。
3. 只要逻辑需要“稳定复用”，`SHOULD` 优先写入 `scripts/`。
4. 输出模板、HTML、CSS、样板 JSON `SHOULD` 放在 `assets/` 或 `demo/`。
5. `SKILL.md` `MUST` 明确写出“在什么情况下读取哪个 reference”。

## 4.7 安全规范

### 4.7.1 通用安全

1. third-party 输入 `MUST` 默认视为不可信。
2. skill `MUST NOT` 要求用户执行来源不明的远程脚本。
3. skill `MUST NOT` 在提示词里要求输出 secret。
4. skill `MUST NOT` 把 token、密码、cookie、私钥写入普通日志或产物。
5. skill `SHOULD` 优先兼容 sandbox。

### 4.7.2 Shell 与外部命令

1. 需要 shell 的 skill `MUST` 明确命令的输入来源。
2. 所有命令拼接点 `MUST` 做输入边界说明。
3. 对用户提供的 URL、路径、参数，`MUST NOT` 直接无约束拼接执行。
4. 如果操作危险，`MUST` 先做前置确认或引导人工介入。

### 4.7.3 Secret 与配置

1. API key `SHOULD` 通过 `skills.entries.*.apiKey` 或 `env` 注入。
2. `primaryEnv` `SHOULD` 显式声明。
3. skill 文档 `MUST NOT` 指导把 secret 写进版本库。
4. 需要配置项时，`MUST` 给出配置键、作用和默认值。

## 4.8 可安装性规范

1. 依赖外部 CLI 的 skill `SHOULD` 提供 `metadata.openclaw.install`。
2. 支持多平台时，安装器 `SHOULD` 按 OS 区分。
3. skill `SHOULD` 提供 `homepage`。
4. 如果 skill 只能在特定 OS 使用，`SHOULD` 设置 `metadata.openclaw.os`。

## 4.9 触发与输出规范

### 4.9.1 触发

1. `description` `MUST` 覆盖直接触发词和典型自然语言场景。
2. 触发条件 `MUST` 精确，避免把通用聊天都误吸进去。
3. 如果支持主动建议，`MUST` 说明触发阈值与限制。

### 4.9.2 输出

1. skill `MUST` 明确主输出是什么。
2. 如果输出文件，`MUST` 明确路径规则、命名规则、覆盖规则。
3. 如果输出结构化数据，`MUST` 给出 schema 或示例。
4. 如果失败，`MUST` 给出用户可继续执行的下一步动作。

## 4.10 可组合性规范

1. skill `MUST` 明确输入依赖。
2. skill `MUST` 明确输出可否被下游 skill 复用。
3. skill `SHOULD` 避免跨 skill 隐式共享不可见状态。
4. 多 skill 流水线 `SHOULD` 通过文件、配置或结构化数据交接，而不是靠模糊对话记忆。

## 4.11 验证规范

每个 skill 在发布前 `MUST` 完成以下验收：

1. 结构检查：目录、`SKILL.md`、references/scripts/assets 是否符合规范。
2. 触发检查：至少 3 条正例、3 条反例。
3. 前置检查：缺依赖、缺配置、缺权限时是否能正确失败。
4. 输出检查：主输出路径、格式、命名是否稳定。
5. 安全检查：是否存在 secret 泄漏、危险命令拼接、远程脚本执行引导。
6. 长度检查：`name`、`description`、`SKILL.md` 是否超预算。
7. 文档一致性检查：README、`SKILL.md`、配置样板是否冲突。
8. 发布检查：slug、版本、主页、依赖说明是否齐全。

## 4.12 发布规范

1. skill `SHOULD` 使用 semver 版本。
2. 每次发布 `SHOULD` 有简短 changelog。
3. 有 breaking change 时 `MUST` 升主版本。
4. 发布前 `MUST` 重新核对 `name`。
5. 发布前 `MUST` 重新核对 `description`。
6. 发布前 `MUST` 重新核对 `metadata`。
7. 发布前 `MUST` 重新核对配置键名。
8. 发布前 `MUST` 重新核对默认路径。
9. 发布前 `MUST` 重新核对安装依赖。

---

## 5. 推荐的标准 skill 形式

下面是一份建议的标准形态：

```text
my-skill/
├── SKILL.md
├── references/
│   ├── platform-a.md
│   └── platform-b.md
├── scripts/
│   └── generate_output.py
├── assets/
│   └── template.html
└── agents/
    └── openai.yaml
```

对应的 `SKILL.md` 建议骨架：

```markdown
---
name: my-skill
description: One-line summary including task, trigger, and output.
metadata:
  openclaw:
    homepage: https://example.com
    requires:
      bins: ["uv"]
      env: ["MY_API_KEY"]
    primaryEnv: MY_API_KEY
---

# My Skill

## 前置检查

- 检查配置文件是否存在
- 检查依赖命令是否存在
- 检查输出目录是否可写

## 核心流程

1. 读取输入
2. 按条件加载 references
3. 调用 scripts 或执行稳定步骤
4. 生成主输出

## 参考文件加载规则

- 平台 A：读取 `references/platform-a.md`
- 平台 B：读取 `references/platform-b.md`

## 输出约定

- 主输出：`~/output/result.json`
- 附加输出：`~/output/report.html`

## 失败处理

- 缺配置：提示用户先初始化
- 缺依赖：提示安装方式
- 输出失败：返回路径和错误原因

## 禁止事项

- 不记录 secret
- 不执行不透明远程脚本
- 不把不可信输入直接拼接进 shell
```

---

## 6. 对本仓库后续开发的强约束建议

基于上面规范，建议本仓库后续新增或重构 skill 时严格遵守以下规则。

### 6.1 必须执行

1. 新增 skill 前，先判断它是入口 skill、执行 skill，还是分析 skill。
2. 新增 skill 目录名、slug、frontmatter `name` 尽量统一。
3. 每个 skill 的主 `SKILL.md` 控制在 300 行以内，500 行绝对上限。
4. 所有平台差异、导入器差异、人设差异都拆到 `references/`。
5. 所有可重复执行的稳定变换逐步迁移到 `scripts/`。
6. 所有输出模板迁移到 `assets/` 或现有模板目录。
7. 每个 skill 都要补一份发布前检查清单。

### 6.2 应优先整改

1. 统一 `openclaw-diary-*` 与 `onboarding/diary/note-extractor` 的命名映射。
2. 拆分 `openclaw-diary-setup/SKILL.md` 的超长内容。
3. 拆分 `openclaw-diary-core/SKILL.md` 中的人设和平台细节。
4. 拆分 `openclaw-diary-insights/SKILL.md` 中的数据 schema 与解析示例。
5. 修复或移除已过时的 `check-config.sh`。
6. 决定 skill 目录下 README 的保留策略。
7. 如果保留 README，`SHOULD` 只保留面向人类的极简说明，并建立同步规则。
8. 如果不保留 README，`SHOULD` 完全以 `SKILL.md` 为准。

### 6.3 禁止继续扩大

1. 禁止继续把长篇参考知识直接塞进主 `SKILL.md`。
2. 禁止继续增加命名不一致。
3. 禁止新增“只有文档、没有验证方式”的 skill。
4. 禁止让一个 skill 同时承担多个不相干职责。

---

## 7. 结论

一个优秀、好用、可持续维护的 OpenClaw skill，本质上应同时满足 8 个目标：

1. 容易被触发
2. 容易被加载
3. 容易被安装
4. 容易被审计
5. 容易被组合
6. 容易被验证
7. 容易被维护
8. 默认安全

对这个仓库而言，接下来最重要的不是“继续加更多功能”，而是先把 skill 的 **命名、层次、长度、资源分层、验证标准** 固化下来。只有这样，后续扩展出来的 skill 才不会逐步失控。

---

## 8. 外部依据（2026-03-16 快照）

以下外部材料支撑了本文档中的关键判断：

### 8.1 OpenClaw 官方机制

- OpenClaw Skills 参考文档：说明了 skill 位置优先级、格式、token 成本、`metadata.openclaw` 字段、资格过滤与安全注意事项。
- OpenClaw Creating Skills 文档：说明了 skill 的发现、结构、安装入口和发布路径。
- ClawHub 工具文档：说明了 ClawHub 是公开 skill registry，并支持安装、搜索、版本和审计。
- OpenClaw macOS Skills 文档：说明了桌面端对 install action、依赖和 API key 暴露的集成方式。

### 8.2 社区生态观察

当前公开目录与索引中，高频 skill 主要集中在以下类别：

- 单集成面 skill：`Github`、`Notion`、`Slack`、`Trello`、`Caldav`
- 单能力面 skill：`Summarize`、`Weather`、`Tavily Web Search`
- 状态/知识组织 skill：`Ontology`

这些案例共同说明：

1. 越热门的 skill，职责越单纯。
2. 越好用的 skill，依赖声明越明确。
3. 越可复用的 skill，输出契约越稳定。
4. 越面向分发的 skill，越重视安全与可审计性。
