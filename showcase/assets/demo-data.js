// ── Demo Sessions ──────────────────────────────────────────────────────────

export const demoSessions = [
  {
    session_id: "sess_demo_001",
    title: "AI 游戏产品调研",
    objective: "针对目标 AI 游戏产品做近期调研，形成可复用分析框架与结论摘要。",
    status: "active",
    priority: "high",
    tags: ["research", "product", "ai-game"],
    active_run_id: "run_demo_001",
    metrics: {
      run_count: 3,
      failed_run_count: 1,
      human_intervention_count: 1,
      artifact_count: 4,
      last_activity_at: new Date(Date.now() - 3600000).toISOString()
    },
    state: {
      phase: "collecting_sources",
      goal_status: "in_progress",
      blockers: [],
      pending_human_decisions: [],
      next_machine_actions: ["collect_recent_product_mentions", "group_user_facing_use_cases"],
      next_human_actions: []
    },
    activity: {
      run: { state: "running", phase: "running" },
      queue: { state: "idle", count: 0 },
      summary: { state: "fresh" }
    }
  },
  {
    session_id: "sess_demo_002",
    title: "PTrade 量化交易系统部署",
    objective: "在阿里云上部署完整的 PTrade 量化交易系统，打通开发到可视化的全链路。",
    status: "waiting_human",
    priority: "critical",
    tags: ["quant", "deployment", "ptrade"],
    active_run_id: null,
    metrics: {
      run_count: 5,
      failed_run_count: 2,
      human_intervention_count: 3,
      artifact_count: 7,
      last_activity_at: new Date(Date.now() - 7200000).toISOString()
    },
    state: {
      phase: "deployment_validation",
      goal_status: "waiting_input",
      blockers: [],
      pending_human_decisions: [
        {
          decision_id: "dec_001",
          summary: "是否切换到 Windows Server 2022 实例以兼容 PTrade 桌面端",
          urgency: "high",
          requested_at: new Date(Date.now() - 3600000).toISOString()
        }
      ],
      next_machine_actions: [],
      next_human_actions: ["确认服务器规格", "审批云资源预算"]
    },
    activity: {
      run: { state: "idle", phase: "waiting_human" },
      queue: { state: "pending", count: 2 },
      summary: { state: "stale" }
    }
  },
  {
    session_id: "sess_demo_003",
    title: "强化学习交易终端文档",
    objective: "为 RL 交易终端撰写模块化、可复用的技术文档。",
    status: "completed",
    priority: "medium",
    tags: ["documentation", "rl", "trading"],
    active_run_id: null,
    metrics: {
      run_count: 2,
      failed_run_count: 0,
      human_intervention_count: 0,
      artifact_count: 3,
      last_activity_at: new Date(Date.now() - 86400000).toISOString()
    },
    state: {
      phase: "closure",
      goal_status: "complete",
      blockers: [],
      pending_human_decisions: [],
      next_machine_actions: [],
      next_human_actions: []
    },
    activity: {
      run: { state: "idle", phase: "completed" },
      queue: { state: "idle", count: 0 },
      summary: { state: "fresh" }
    }
  },
  {
    session_id: "sess_demo_004",
    title: "CoCo Bond 监管分析",
    objective: "分析 contingent convertible bonds 的跨司法管辖区监管差异。",
    status: "blocked",
    priority: "medium",
    tags: ["finance", "regulation", "coco-bonds"],
    active_run_id: null,
    metrics: {
      run_count: 4,
      failed_run_count: 3,
      human_intervention_count: 1,
      artifact_count: 2,
      last_activity_at: new Date(Date.now() - 43200000).toISOString()
    },
    state: {
      phase: "data_collection",
      goal_status: "in_progress",
      blockers: [
        {
          blocker_id: "blk_001",
          type: "external_dependency",
          summary: "等待 BIS 数据库 API 审批",
          severity: "high",
          detected_at: new Date(Date.now() - 43200000).toISOString()
        }
      ],
      pending_human_decisions: [],
      next_machine_actions: ["retry_data_fetch_after_approval"],
      next_human_actions: ["联系 BIS 数据团队催促审批"]
    },
    activity: {
      run: { state: "idle", phase: "blocked" },
      queue: { state: "idle", count: 0 },
      summary: { state: "stale" }
    }
  },
  {
    session_id: "sess_demo_005",
    title: "Manner Coffee 增长策略分析",
    objective: "使用因果推断框架分析 Manner Coffee 促销策略的真实效果。",
    status: "active",
    priority: "low",
    tags: ["growth", "causal-inference", "case-study"],
    active_run_id: "run_demo_005",
    metrics: {
      run_count: 1,
      failed_run_count: 0,
      human_intervention_count: 0,
      artifact_count: 1,
      last_activity_at: new Date(Date.now() - 600000).toISOString()
    },
    state: {
      phase: "analysis",
      goal_status: "in_progress",
      blockers: [],
      pending_human_decisions: [],
      next_machine_actions: ["compute_simpson_paradox_check", "build_causal_dag"],
      next_human_actions: []
    },
    activity: {
      run: { state: "running", phase: "running" },
      queue: { state: "idle", count: 0 },
      summary: { state: "fresh" }
    }
  },
  {
    session_id: "sess_demo_006",
    title: "Snowflake 数据仓库优化",
    objective: "分析并优化 Snowflake 查询性能，降低计算成本 30%。",
    status: "active",
    priority: "high",
    tags: ["data-engineering", "optimization", "snowflake"],
    active_run_id: "run_demo_006",
    metrics: {
      run_count: 2,
      failed_run_count: 0,
      human_intervention_count: 0,
      artifact_count: 5,
      last_activity_at: new Date(Date.now() - 1800000).toISOString()
    },
    state: {
      phase: "optimization",
      goal_status: "in_progress",
      blockers: [],
      pending_human_decisions: [],
      next_machine_actions: ["analyze_query_patterns", "implement_clustering_keys"],
      next_human_actions: []
    },
    activity: {
      run: { state: "running", phase: "running" },
      queue: { state: "idle", count: 0 },
      summary: { state: "fresh" }
    }
  }
];

// ── Demo Runs ──────────────────────────────────────────────────────────────

export const demoRuns = {
  "sess_demo_001": {
    run_id: "run_demo_001",
    session_id: "sess_demo_001",
    status: "running",
    trigger: { trigger_type: "resume", request_id: "req_demo_001" },
    execution: {
      invoked_skills: ["web-research", "summarizer", "market-scanner"],
      invoked_tools: ["web.run", "file.write"],
      start_checkpoint_ref: "runs/run_demo_prev/checkpoint.json",
      recovery_checkpoint_ref: "runs/run_demo_001/checkpoint.json",
      end_checkpoint_ref: null,
      artifact_refs: ["art_analysis_draft", "art_source_list"],
      events_ref: "runs/run_demo_001/events.jsonl",
      skill_traces_ref: "runs/run_demo_001/skill_traces.jsonl"
    },
    outcome: {
      result_type: null,
      summary: null,
      human_takeover: false,
      closure_contribution: null
    },
    metrics: {
      skill_invocation_count: 5,
      tool_call_count: 3,
      error_count: 0,
      duration_ms: null
    },
    started_at: new Date(Date.now() - 300000).toISOString(),
    ended_at: null
  },
  "sess_demo_002": {
    run_id: "run_demo_002",
    session_id: "sess_demo_002",
    status: "waiting_human",
    trigger: { trigger_type: "external_message", request_id: "req_demo_002" },
    execution: {
      invoked_skills: ["cloud-deployer", "config-validator", "ptrade-connector"],
      invoked_tools: ["ssh.exec", "file.read", "docker.build"],
      start_checkpoint_ref: "runs/run_demo_002_prev/checkpoint.json",
      recovery_checkpoint_ref: "runs/run_demo_002/checkpoint.json",
      end_checkpoint_ref: "runs/run_demo_002/checkpoint.json",
      artifact_refs: ["art_deploy_log", "art_config_snapshot"],
      events_ref: "runs/run_demo_002/events.jsonl",
      skill_traces_ref: "runs/run_demo_002/skill_traces.jsonl"
    },
    outcome: {
      result_type: "awaiting_human",
      summary: "部署到 validation 阶段，需要确认服务器规格。",
      human_takeover: true,
      closure_contribution: 0.6
    },
    metrics: {
      skill_invocation_count: 8,
      tool_call_count: 12,
      error_count: 2,
      duration_ms: 125000
    },
    started_at: new Date(Date.now() - 7200000).toISOString(),
    ended_at: new Date(Date.now() - 3600000).toISOString()
  },
  "sess_demo_005": {
    run_id: "run_demo_005",
    session_id: "sess_demo_005",
    status: "running",
    trigger: { trigger_type: "manual", request_id: "req_demo_005" },
    execution: {
      invoked_skills: ["causal-inference-engine", "data-wrangler", "statistician"],
      invoked_tools: ["python.exec", "csv.parse"],
      start_checkpoint_ref: null,
      recovery_checkpoint_ref: "runs/run_demo_005/checkpoint.json",
      end_checkpoint_ref: null,
      artifact_refs: ["art_causal_dag_draft"],
      events_ref: "runs/run_demo_005/events.jsonl",
      skill_traces_ref: "runs/run_demo_005/skill_traces.jsonl"
    },
    outcome: {
      result_type: null,
      summary: null,
      human_takeover: false,
      closure_contribution: null
    },
    metrics: {
      skill_invocation_count: 3,
      tool_call_count: 2,
      error_count: 0,
      duration_ms: null
    },
    started_at: new Date(Date.now() - 600000).toISOString(),
    ended_at: null
  },
  "sess_demo_006": {
    run_id: "run_demo_006",
    session_id: "sess_demo_006",
    status: "running",
    trigger: { trigger_type: "resume", request_id: "req_demo_006" },
    execution: {
      invoked_skills: ["query-optimizer", "cost-analyzer", "snowflake-expert"],
      invoked_tools: ["sql.analyze", "snowflake.api"],
      start_checkpoint_ref: "runs/run_demo_006_prev/checkpoint.json",
      recovery_checkpoint_ref: "runs/run_demo_006/checkpoint.json",
      end_checkpoint_ref: null,
      artifact_refs: ["art_optimization_plan", "art_query_analysis"],
      events_ref: "runs/run_demo_006/events.jsonl",
      skill_traces_ref: "runs/run_demo_006/skill_traces.jsonl"
    },
    outcome: {
      result_type: null,
      summary: null,
      human_takeover: false,
      closure_contribution: null
    },
    metrics: {
      skill_invocation_count: 4,
      tool_call_count: 6,
      error_count: 0,
      duration_ms: null
    },
    started_at: new Date(Date.now() - 1800000).toISOString(),
    ended_at: null
  }
};

// ── Demo Focus ─────────────────────────────────────────────────────────────

export const demoFocus = [
  {
    attention_id: "attn_demo_001",
    session_id: "sess_demo_002",
    category: "waiting_human",
    urgency: "critical",
    reasoning_summary: "PTrade 部署需要确认服务器规格选择",
    recommended_next_step: "审查决策列表并解除阻塞",
    expected_human_action: "确认是否切换到 Windows Server 2022",
    attention_priority: 52,
    metadata: {
      primary_category_rule: "waiting_human > blocked > desynced > stale > summary_drift",
      merged_categories: ["waiting_human", "desynced", "summary_drift"]
    }
  },
  {
    attention_id: "attn_demo_002",
    session_id: "sess_demo_004",
    category: "blocked",
    urgency: "high",
    reasoning_summary: "CoCo Bond 分析被外部数据依赖阻塞 + 连续失败 3 次",
    recommended_next_step: "决定是否重试、缩小范围还是切换策略",
    expected_human_action: "联系 BIS 数据团队或调整数据源",
    attention_priority: 49,
    metadata: {
      primary_category_rule: "waiting_human > blocked > desynced > stale > summary_drift",
      merged_categories: ["blocked", "stale"]
    }
  }
];

// ── Demo Summaries ─────────────────────────────────────────────────────────

export const demoSummaries = {
  "sess_demo_001": `# AI 游戏产品调研进展

## 已完成
- 收集 Reddit r/AIGaming 近期热门讨论 (30+ posts)
- 整理 ProductHunt 上线的 AI 游戏产品列表 (15 款)
- 初步分类：AIGC 内容生成 vs. AI NPC 交互 vs. AI 辅助设计

## 当前重点
正在分析用户对话质量 vs. 游戏性平衡的讨论趋势。初步发现：
- 纯 AI 生成的开放世界游戏用户留存低 (<2 days avg)
- 混合设计（人工关卡 + AI NPC）口碑最佳

## 下一步
- 深挖 Ludo.ai 和 Scenario 的定位差异
- 整理可复用的产品分析框架`,

  "sess_demo_002": `# PTrade 部署进展

## 已完成里程碑
1. ✅ 阿里云 ECS 实例创建（Ubuntu 22.04）
2. ✅ Docker 环境配置 + PostgreSQL 数据库
3. ✅ PTrade 后端服务部署（API 正常响应）
4. ⚠️ 前端 GUI 兼容性问题（需 Windows 环境）

## 当前阻塞
PTrade 的 Qt 桌面端在 Linux 上无法正常渲染行情图表。
两个选项：
- A: 切换到 Windows Server 2022（成本 +40%）
- B: 改用 Web 版可视化（需重构部分代码）

## 人工决策点
需要你确认：成本 vs. 开发工时的权衡。`,

  "sess_demo_003": `# RL 交易终端文档 - 已完成

## 交付物
- \`architecture.md\`: 系统架构图 + 模块依赖
- \`api-reference.md\`: 所有公开接口的使用示例
- \`deployment-guide.md\`: Docker Compose 一键部署方案

## 文档特点
- 每个模块都有"为什么这样设计"的 rationale
- 代码示例覆盖 90% 的常见场景
- 包含性能调优建议（backtest 速度 +3x）

任务已闭环，无需后续行动。`,

  "sess_demo_004": `# CoCo Bond 监管分析 - 受阻

## 已收集
- Basel III 对 AT1 资本工具的定义
- 欧盟 vs. 美国的触发机制差异
- 2023 年 Credit Suisse AT1 归零事件回顾

## 数据缺口
需要 BIS 统计数据库的 API 访问权限，但申请已提交 12 天无回复。

## 备选方案
- 改用公开的 ECB 统计数据（覆盖面窄）
- 暂停此任务，等 API 审批通过

任务处于 blocked 状态。`,

  "sess_demo_005": `# Manner Coffee 增长分析进展

## 研究框架
使用 Pearl（微软因果推断库）构建 DAG：
- 节点：促销力度、门店位置、用户复购率、天气
- 边：假设促销 → 短期流量 ↛ 长期留存（待验证）

## 初步发现
数据显示 Simpson's Paradox 风险：
- 全局看：促销期销量 +35%
- 分门店看：核心商圈反而 -5%（可能是品牌稀释）

## 下一步
需要控制混淆变量（竞品开店、节假日）后再下结论。`,

  "sess_demo_006": `# Snowflake 优化进展

## 成本分析
当前月度计算开销：$12,400
主要热点：
- \`daily_aggregation\` job (38% 成本)
- \`user_behavior_join\` query (22% 成本)

## 优化方案
1. ✅ 为高频 join 列添加 clustering keys
2. ⏳ 正在实施：分区表改造（预计节省 25%）
3. 待验证：查询结果缓存策略

## 预期效果
根据 Snowflake profiler，优化后月度成本 → $8,600 (-31%)`
};

// ── Demo Timeline ──────────────────────────────────────────────────────────

export const demoTimelines = {
  "sess_demo_001": {
    session_id: "sess_demo_001",
    runs: [
      {
        run_id: "run_demo_001",
        session_id: "sess_demo_001",
        status: "running",
        trigger: { trigger_type: "resume" },
        started_at: new Date(Date.now() - 300000).toISOString(),
        ended_at: null,
        outcome: { result_type: null }
      },
      {
        run_id: "run_demo_001_prev",
        session_id: "sess_demo_001",
        status: "completed",
        trigger: { trigger_type: "manual" },
        started_at: new Date(Date.now() - 7200000).toISOString(),
        ended_at: new Date(Date.now() - 3600000).toISOString(),
        outcome: { result_type: "partial_progress", summary: "完成初步数据收集" }
      }
    ]
  },
  "sess_demo_002": {
    session_id: "sess_demo_002",
    runs: [
      {
        run_id: "run_demo_002",
        session_id: "sess_demo_002",
        status: "waiting_human",
        trigger: { trigger_type: "external_message" },
        started_at: new Date(Date.now() - 7200000).toISOString(),
        ended_at: new Date(Date.now() - 3600000).toISOString(),
        outcome: { result_type: "awaiting_human", summary: "需要确认服务器规格" }
      }
    ]
  }
};
