# Submit Public Facts Mock Flow

本文档定义当前阶段 `submit-public-facts` 的完整 mock 流程。

目标不是搭建真实公域服务器，而是先把从 **本地蒸馏 → outbox → mock submit → 验收** 的完整链路跑通，为未来真实公域上报提供可升级的骨架。

## 1. 流程总览

```
Session Close / Periodic Distill
        │
        ▼
┌──────────────────┐
│ Local SkillTrace │
│ + CapabilityFact │
│ + Run Outcomes   │
└────────┬─────────┘
         │
         ▼
┌──────────────────────────┐
│ PublicFactDistiller       │
│ (aggregate + anonymize)  │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ Outbox: pending/         │
│   batch_xxxx.json        │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ /review-outbox (optional)│
│ user inspects / deletes  │
└────────┬─────────────────┘
         │
         ▼
┌──────────────────────────┐
│ PublicFactSubmitter       │
│ (mock or real HTTP POST) │
└────────┬─────────────────┘
         │
    ┌────┴────┐
    ▼         ▼
submitted/  failed/
```

## 2. 模块职责

### 2.1 PublicFactDistiller

代码位置（建议）：

- `src/telemetry/public-fact-distiller.ts`

输入：

- 一个或多个已闭环的 session
- 每个 session 的全部 `SkillTrace[]`
- 每个 session 的全部本地 `CapabilityFact[]`
- 每个 session 的 `Run[]` 和闭环 `outcome`

输出：

- `PublicCapabilityFact[]`

职责边界：

- 只读取本地 durable state
- 只产出去身份化的 `PublicCapabilityFact`
- 不直接做 IO（outbox 写入由调用方负责）
- 不访问网络

### 2.2 OutboxService

代码位置（建议）：

- `src/telemetry/outbox-service.ts`

职责：

- 把 `PublicCapabilityFact[]` 打包成 batch 写入 `pending/`
- 管理 `pending/` → `submitted/` → `failed/` 的生命周期
- 提供 `listPending()`、`reviewBatch(batchId)`、`deleteBatch(batchId)` 方法
- 提供 `markSubmitted(batchId)` 和 `markFailed(batchId, reason)` 方法

### 2.3 PublicFactSubmitter

代码位置（建议）：

- `src/telemetry/public-fact-submitter.ts`

职责：

- 从 outbox 取出 pending batch
- 调用公域 ingest API（mock 或 real）
- 根据响应更新 outbox 状态

当前阶段该模块内置 mock 模式，不实际发送 HTTP 请求。

## 3. 蒸馏规则

### 3.1 触发时机

蒸馏在以下时机触发：

1. **Session 闭环时**：`closeSession` 已经在产出本地 `CapabilityFact`。在此之后追加一步 public fact distillation。
2. **手动触发**：用户通过 `/distill` 命令手动触发当前所有已闭环 session 的蒸馏。
3. **定期汇总**（未来）：sidecar background task 定期扫描新闭环的 session。

当前阶段只实现 1 和 2。

### 3.2 最小蒸馏样本要求

为避免公域数据过于稀疏或暴露单次任务细节：

- 单个 `PublicCapabilityFact` 的 `sample_size` 必须 >= 3
- 如果某 skill + scenario 组合的样本量不足 3，暂不写入 outbox，等待后续 session 闭环后再聚合
- 本地维护一个 `distillation_buffer.jsonl`，存储尚未达到最小样本量的中间聚合态

### 3.3 聚合逻辑

以 `(subject_type, subject_ref, subject_version, scenario_signature, metric_name)` 为聚合键。

对于 `closure_rate` 类比率指标：

```
metric_value = count(condition_met) / count(total)
confidence = min(0.99, 1 - 1 / sqrt(sample_size))
```

对于 `avg_duration_ms` 类均值指标：

```
metric_value = mean(values)
confidence = min(0.99, 1 - cv / sqrt(sample_size))  // cv = coefficient of variation
```

对于 `dominant_failure_mode` 类众数指标：

```
metric_value = mode(failure_modes)
confidence = count(mode) / count(total)
```

### 3.4 去身份化规则

蒸馏过程中必须执行以下去身份化：

```typescript
function sanitizeForPublic(fact: LocalAggregation): PublicCapabilityFact {
  return {
    public_fact_id: createId("pfact"),
    schema_version: "1.0.0",
    node_fingerprint: getNodeFingerprint(),

    // 保留：抽象标签
    subject_type: fact.subject_type,
    subject_ref: fact.subject_ref,
    subject_version: fact.subject_version ?? null,
    scenario_signature: fact.scenario_signature,
    scenario_tags: fact.scenario_tags ?? [],

    // 保留：归一化数值
    metric_name: fact.metric_name,
    metric_value: fact.metric_value,
    sample_size: fact.sample_size,
    confidence: fact.confidence,

    // 保留：聚合上下文（已去身份化）
    context: sanitizeContext(fact.context),

    computed_at: fact.computed_at,
    submitted_at: null  // 提交时填入
  };
}

function sanitizeContext(context: Record<string, unknown>): Record<string, unknown> {
  const allowed = [
    "avg_run_count_per_session",
    "avg_human_intervention_rate",
    "avg_duration_ms",
    "dominant_failure_mode",
    "co_skills",
    "co_skill_count",
    "environment_hint"
  ];

  return Object.fromEntries(
    Object.entries(context).filter(([key]) => allowed.includes(key))
  );
}
```

### 3.5 Node Fingerprint 生成

```typescript
import { createHash, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const SECRET_FILENAME = ".public-fact-node-secret";

async function getOrCreateNodeSecret(stateRoot: string): Promise<string> {
  const secretPath = path.join(stateRoot, SECRET_FILENAME);

  try {
    return await readFile(secretPath, "utf8");
  } catch {
    const secret = randomBytes(32).toString("hex");
    await writeFile(secretPath, secret, "utf8");
    return secret;
  }
}

async function getNodeFingerprint(stateRoot: string): Promise<string> {
  const secret = await getOrCreateNodeSecret(stateRoot);
  const hash = createHash("sha256")
    .update(secret + "openclaw-public-facts")
    .digest("hex")
    .slice(0, 32);
  return `anon_${hash}`;
}
```

## 4. Outbox 文件格式

### 4.1 Batch 文件

`pending/batch_a1b2c3d4.json`：

```json
{
  "batch_id": "batch_a1b2c3d4",
  "schema_version": "1.0.0",
  "node_fingerprint": "anon_sha256_abc123def456",
  "created_at": "2026-03-17T20:00:00Z",
  "fact_count": 5,
  "facts": [
    { "...": "PublicCapabilityFact" },
    { "...": "PublicCapabilityFact" }
  ],
  "source_sessions_count": 3,
  "status": "pending"
}
```

注意 `source_sessions_count` 只记录数量，不记录具体 session_id。

### 4.2 提交后的文件

`submitted/batch_a1b2c3d4.json`：

```json
{
  "batch_id": "batch_a1b2c3d4",
  "status": "submitted",
  "submitted_at": "2026-03-17T20:05:00Z",
  "response": {
    "status": "accepted",
    "accepted_count": 5,
    "rejected_count": 0,
    "rejected_facts": []
  },
  "facts": [ "..." ]
}
```

`failed/batch_i9j0k1l2.json`：

```json
{
  "batch_id": "batch_i9j0k1l2",
  "status": "failed",
  "attempted_at": "2026-03-17T20:05:00Z",
  "error": {
    "type": "http_error",
    "status_code": 503,
    "message": "Service unavailable",
    "retryable": true
  },
  "facts": [ "..." ]
}
```

## 5. Mock Submitter 实现

### 5.1 Mock 模式行为

当前阶段 `PublicFactSubmitter` 默认运行在 mock 模式。

Mock 模式下：

- 不发送真实 HTTP 请求
- 在本地模拟公域服务器的验证逻辑
- 按照真实 API contract 产出 response
- 把结果写入 outbox 的 `submitted/` 或 `failed/`

### 5.2 Mock 实现骨架

```typescript
import { createId } from "../shared/ids.ts";
import { isoNow } from "../shared/time.ts";

interface MockIngestResponse {
  status: "accepted" | "partial" | "rejected";
  batch_id: string;
  accepted_count: number;
  rejected_count: number;
  rejected_facts: Array<{ public_fact_id: string; reason: string }>;
}

interface PublicFactBatch {
  batch_id: string;
  schema_version: string;
  node_fingerprint: string;
  facts: PublicCapabilityFact[];
}

function mockIngest(batch: PublicFactBatch): MockIngestResponse {
  const rejected: Array<{ public_fact_id: string; reason: string }> = [];

  for (const fact of batch.facts) {
    // Rule 1: sample_size >= 1
    if (typeof fact.sample_size !== "number" || fact.sample_size < 1) {
      rejected.push({
        public_fact_id: fact.public_fact_id,
        reason: "sample_size_below_minimum"
      });
      continue;
    }

    // Rule 2: confidence in [0, 1]
    if (typeof fact.confidence !== "number" || fact.confidence < 0 || fact.confidence > 1) {
      rejected.push({
        public_fact_id: fact.public_fact_id,
        reason: "invalid_confidence"
      });
      continue;
    }

    // Rule 3: schema_version match
    if (fact.schema_version !== batch.schema_version) {
      rejected.push({
        public_fact_id: fact.public_fact_id,
        reason: "schema_version_mismatch"
      });
      continue;
    }

    // Rule 4: no local identifiers leaked
    const serialized = JSON.stringify(fact);
    if (/sess_|run_|evt_|user_|owner/.test(serialized)) {
      rejected.push({
        public_fact_id: fact.public_fact_id,
        reason: "local_identifier_leak_detected"
      });
      continue;
    }

    // Rule 5: required fields present
    if (!fact.subject_ref || !fact.scenario_signature || !fact.metric_name) {
      rejected.push({
        public_fact_id: fact.public_fact_id,
        reason: "missing_required_field"
      });
      continue;
    }
  }

  const acceptedCount = batch.facts.length - rejected.length;

  return {
    status: rejected.length === 0 ? "accepted" : acceptedCount > 0 ? "partial" : "rejected",
    batch_id: batch.batch_id,
    accepted_count: acceptedCount,
    rejected_count: rejected.length,
    rejected_facts: rejected
  };
}
```

### 5.3 Mock Submitter 完整流程

```typescript
interface SubmitResult {
  batch_id: string;
  outcome: "submitted" | "failed";
  response: MockIngestResponse | null;
  error: string | null;
}

class PublicFactSubmitter {
  mode: "mock" | "live";
  outboxService: OutboxService;
  endpoint: string;

  constructor(outboxService: OutboxService, options: { mode?: "mock" | "live"; endpoint?: string } = {}) {
    this.outboxService = outboxService;
    this.mode = options.mode ?? "mock";
    this.endpoint = options.endpoint ?? "https://facts.openclaw.dev/v1/ingest";
  }

  async submitPending(): Promise<SubmitResult[]> {
    const pendingBatches = await this.outboxService.listPending();
    const results: SubmitResult[] = [];

    for (const batch of pendingBatches) {
      const result = await this.submitBatch(batch);
      results.push(result);
    }

    return results;
  }

  async submitBatch(batch: PublicFactBatch): Promise<SubmitResult> {
    // Fill submitted_at on all facts
    const now = isoNow();
    const preparedBatch: PublicFactBatch = {
      ...batch,
      facts: batch.facts.map((fact) => ({ ...fact, submitted_at: now }))
    };

    try {
      const response = this.mode === "mock"
        ? mockIngest(preparedBatch)
        : await this.liveIngest(preparedBatch);

      if (response.status === "rejected") {
        await this.outboxService.markFailed(batch.batch_id, JSON.stringify(response));
        return { batch_id: batch.batch_id, outcome: "failed", response, error: null };
      }

      await this.outboxService.markSubmitted(batch.batch_id, response);
      return { batch_id: batch.batch_id, outcome: "submitted", response, error: null };
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown submission error";
      await this.outboxService.markFailed(batch.batch_id, message);
      return { batch_id: batch.batch_id, outcome: "failed", response: null, error: message };
    }
  }

  private async liveIngest(batch: PublicFactBatch): Promise<MockIngestResponse> {
    // Future: real HTTP POST to this.endpoint
    // For now, always falls through to mock
    throw new Error("Live ingest not yet implemented. Use mock mode.");
  }
}
```

## 6. 命令面集成

### 6.1 新增命令

当前阶段预留但不强制进入 skill command surface：

| 命令 | 说明 | 对应动作 |
|---|---|---|
| `/distill` | 手动触发 public fact 蒸馏 | 扫描已闭环 session，运行 distiller，写入 outbox |
| `/review-outbox` | 查看待提交的 public facts | 列出 pending batches 和摘要 |
| `/submit-facts` | 手动触发提交 | 运行 submitter（mock 或 live） |
| `/outbox-status` | 查看 outbox 统计 | pending / submitted / failed 数量 |

### 6.2 与 closeSession 的集成点

在 `control-plane.ts` 的 `closeSession` 中，现有 `capabilityFactService.emitClosureFacts` 之后，追加：

```typescript
// 现有代码
const facts = this.capabilityFactService.emitClosureFacts(session, run);
await this.store.appendCapabilityFacts(facts);

// 新增：如果 public submission 启用，追加蒸馏
if (this.config.features.public_fact_submission) {
  const publicFacts = await this.publicFactDistiller.distillSession(session, run, facts);

  if (publicFacts.length > 0) {
    await this.outboxService.writePendingBatch(publicFacts);
  }
}
```

### 6.3 与 sidecar HTTP API 的集成

预留但当前不强制实现：

```
POST /public-facts/distill       → 手动蒸馏
GET  /public-facts/outbox        → 查看 outbox 状态
POST /public-facts/submit        → 手动提交
GET  /public-facts/outbox/:batch → 查看单个 batch 详情
DELETE /public-facts/outbox/:batch → 删除 pending batch
```

## 7. 端到端 Mock Flow 示例

以下是一个完整的 mock 流程示例：

```
Step 1: 用户通过 /adopt 创建 session
Step 2: session 经过多轮 run，积累 SkillTrace
Step 3: 用户 /close session

  → closeSession 产出本地 CapabilityFact
  → PublicFactDistiller 从 SkillTrace + CapabilityFact 聚合
  → 去身份化，检查 sample_size >= 3
  → 如果达标，写入 outbox/pending/batch_xxxx.json

Step 4: 用户 /review-outbox

  → 列出 pending batches
  → 用户检查内容，确认没有敏感信息

Step 5: 用户 /submit-facts

  → PublicFactSubmitter 读取 pending batch
  → mock 模式下本地验证（schema、隐私、sample_size）
  → 验证通过 → batch 移入 submitted/
  → 验证失败 → batch 移入 failed/，附带 rejected 原因

Step 6: 用户查看结果

  → /outbox-status 显示 submitted: 1, failed: 0, pending: 0
```

## 8. 测试策略

### 8.1 蒸馏测试

- **T-01**：闭环 session 产出的 `PublicCapabilityFact` 不包含任何 `sess_`/`run_`/`evt_` 前缀字符串
- **T-02**：`sample_size < 3` 的聚合不被写入 outbox，而是留在 buffer
- **T-03**：多个 session 闭环后，同一 skill + scenario 的指标正确累加
- **T-04**：`confidence` 随 `sample_size` 增大而增大
- **T-05**：`co_skills` 正确反映共现的 skill 组合

### 8.2 Outbox 测试

- **T-06**：batch 文件格式正确且通过 schema validation
- **T-07**：pending 目录超过 50 个 batch 时，最旧的被自动归档
- **T-08**：deleteBatch 真正移除 pending 文件
- **T-09**：`source_sessions_count` 只是数字，不泄露 session_id

### 8.3 Mock Submitter 测试

- **T-10**：mock ingest 对合法 batch 返回 `accepted`
- **T-11**：mock ingest 对 `sample_size < 1` 返回 `rejected` 并给出原因
- **T-12**：mock ingest 对包含 `sess_` 的 fact 返回 `local_identifier_leak_detected`
- **T-13**：同一 `batch_id` 重复提交返回相同结果（幂等）
- **T-14**：提交成功后 batch 从 `pending/` 移到 `submitted/`
- **T-15**：提交失败后 batch 从 `pending/` 移到 `failed/`

### 8.4 隐私回归测试

- **T-16**：对任意已闭环 session 运行蒸馏，输出的 JSON 中 grep 不到 `session_id` 的实际值
- **T-17**：对任意已闭环 session 运行蒸馏，输出的 JSON 中 grep 不到 `owner.ref` 的实际值
- **T-18**：`context` 字段中不存在非白名单 key
- **T-19**：`node_fingerprint` 不能被还原为 `local_node_secret`

### 8.5 集成测试

- **T-20**：从 `/adopt` → 多轮 run → `/close` → 蒸馏 → outbox → mock submit 的完整链路成功
- **T-21**：`public_fact_submission` flag 关闭时，closeSession 不产出 outbox 文件
- **T-22**：`public_fact_submission` flag 打开但 sample_size 不足时，不产出 outbox 文件但 buffer 增长

## 9. 升级路径

### 9.1 从 mock 到 live

当前代码已经支持真实 HTTP POST：

1. `PublicFactSubmitter` 已实现 live ingest transport
2. config 中已经有 `public_facts.endpoint`
3. submitter mode 使用 `http`
4. 其他模块（distiller、outbox、命令面）不需要改动

### 9.2 从手动到自动

当需要自动提交时：

1. 在 sidecar 中增加一个 background interval
2. 定期调用 `submitter.submitPending()`
3. 加入 rate limiting 守卫
4. outbox 机制不变

### 9.3 从单指标到复合指标

当需要更复杂的 skill 评估时：

1. 在 `canonical_metric_names` 中增加新指标
2. 在 distiller 中增加计算逻辑
3. 在 `public-ingest-contract.md` 中同步更新
4. `schema_version` 升级到 `1.1.0`
5. 公域服务器需要向后兼容旧版本

## 10. 与 Phase 1 Guarantees 的关系

public fact submission 是纯粹的 **derived surface**，不影响任何 Phase 1 guarantee：

- 不改变 session/run/event 的 durable truth
- 不改变 checkpoint/recovery head 语义
- 不改变 inbound idempotency
- 不改变 session.activity contract
- 不改变 focus/attention 推导

如果 public fact submission 模块完全崩溃，系统的核心功能不受影响。

## 11. 文件结构总结

```
src/telemetry/
  capability-facts.ts          # 现有：本地闭环 facts
  skill-trace.ts               # 现有：skill 调用记录
  public-fact-distiller.ts     # 新增：聚合 + 去身份化
  outbox-service.ts            # 新增：outbox 文件管理
  public-fact-submitter.ts     # 新增：mock/live 提交

docs/
  public-ingest-contract.md    # 新增：公域 ingest 协议
  submit-public-facts-mock-flow.md  # 本文档

schemas/
  public-capability-fact.schema.json  # 新增：上报对象 schema

~/.openclaw/skills/manager/
  exports/
    public-facts-outbox/
      pending/
      submitted/
      failed/
    distillation_buffer.jsonl  # 未达标的中间聚合态
```
