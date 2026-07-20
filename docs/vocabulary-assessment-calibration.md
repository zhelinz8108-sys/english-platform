# Aurelis 科学词汇量测评：运行与校准手册

## 当前可发布状态

当前版本是双轨实现：

- 本地 56 题题库只运行内部 Beta，不生成正式分数，也不会显示“高可信度”。
- 持久化 API 的 Beta 固定卷只接受完成双人审核的试测题库：至少 280 题、每个 1K 频段至少 20 题。
- `shadow` 和 `calibrated` 都要求至少 700 道有冻结题目参数的正式题；没有满足条件的校准记录时，服务自动回退到 `beta`。
- “不认识”是有效的未掌握证据，不是异常行为。可信度只由区间宽度、反应时、固定位置作答、频段倒置、失焦和内容覆盖共同决定。

服务端功能开关：

```dotenv
VOCABULARY_ASSESSMENT_SCORING_MODE=beta
```

允许值为 `beta`、`shadow`、`calibrated`。不能通过修改环境变量绕过数据库验收门槛。

## 题库准入

正式 API 只会选择同时满足下列条件的中文接受性识别题：

1. `item_format = receptive-recognition`，语言版本为 `zh-CN`。
2. 唯一词族／词汇单元；跨题库不得重复。
3. 已完成遮住目标词后的泄题检查。
4. 两名不同教研人员独立批准，且词义、唯一最佳答案、干扰项、非定义性语境和语言自然度全部通过。
5. 标记为 `calibration_eligible`；AI 草稿不能绕过人工审核。
6. 正式 CAT 题必须具有当前校准版本的冻结参数。

导出的题库 JSON 可先离线审计：

```powershell
pnpm --filter @english/api audit:vocabulary-bank -- D:\path\bank-export.json
```

审计会检查总题量、14 个频段覆盖、词族重复、语料元数据、四个选项、双人审核和遮词审核。

审核通过后可生成循环平衡不完全区组卷；同一题在不同卷中的曝光次数会尽量均衡：

```powershell
pnpm --filter @english/api generate:vocabulary-forms -- D:\path\bank-export.json D:\path\calibration-forms.json calibration 4
```

生成结果默认是草稿，仍需导入数据库、核对锚题和内容分布后才能将卷设为 `active`。Standard Beta 必须有 140 题 `parallel` 卷，Calibration 必须有 280 题 `pilot` 卷；服务端不会用临时随机卷冒充平行卷或 BIBD 试测卷。

## 校准版本生命周期

1. 创建 `draft` 校准记录，写入样本量、模型、数据校验和、拟合摘要和验收证据。
2. 用 `item_id + calibration_id` 写入题目参数。参数除曝光计数外不可更新；重新拟合必须创建新版本。
3. 初步 Rasch 样本达到 500 后，可将记录设为 `shadow`，并在 `fit_summary` 写入 `shadowReady: true` 和冻结的 `vocabularyMapping`。
4. 影子阶段并行计算 CAT，但学生页面继续展示 Beta 能力带和内部范围。
5. 达到全部正式验收门槛后，将记录改为 `active`，同时写入 `activated_at`。数据库触发器会拒绝未达标的激活。
6. 已激活版本只能保持激活或进入 `retired`；历史参数、样本证据和分数版本不得覆盖。

正式激活时，`acceptance_gates` 至少包含：

```json
{
  "passed": true,
  "monotonic": true,
  "intervalCoverage": 0.94,
  "standardMeanAbsoluteError": 720,
  "externalCorrelation": 0.79,
  "retestCorrelation": 0.87,
  "standardWithin60": 0.93,
  "itemFitReviewComplete": true,
  "difPassed": true
}
```

`fit_summary` 必须包含 `releaseReady: true` 以及至少两个点的单调词族域映射：

```json
{
  "releaseReady": true,
  "shadowReady": true,
  "vocabularyMapping": [
    { "theta": -4, "vocabulary": 0 },
    { "theta": 0, "vocabulary": 7000 },
    { "theta": 4, "vocabulary": 14000 }
  ]
}
```

该映射必须由校准样本对完整 1K–14K 参考词族域的已知概率加权生成，示例中的线性数字不能用于真人正式分数。

数据库还会强制执行：

- 有效校准样本不少于 500，外部对照样本不少于 200。
- 正式参数不少于 700 道，每频段不少于 20 道。
- 2PL 至少需要 2,000 份样本；3PL 至少需要 5,000 份样本。
- 区间覆盖、平均绝对误差、外部相关、重测相关、60 题停止率、题目拟合复核和 DIF 必须达标。

## 离线仿真

运行内置合成题库的回归仿真：

```powershell
pnpm --filter @english/api simulate:vocabulary-assessment
```

合成结果永远输出 `releaseEligible: false`，只能验证代码的单调性、停止规则和区间传播。用冻结的校准导出运行：

```powershell
pnpm --filter @english/api simulate:vocabulary-assessment -- D:\path\calibration-fixture.json
```

即使统计仿真通过，仍必须单独提供真人样本量、认知访谈、外部效度、重测／平行卷和 DIF 证据。

## 匿名导出与隐私

迁移提供了 `vocabulary_assessment_calibration_exports` 和对应行表。导出行只保存带版本的匿名 `subject_token`、`session_token`、题目、响应类别、反应时和位置；不复制成员 ID、姓名或邮箱。只有 worker 角色可读写校准导出表，Web 应用角色无权读取。

## API 行为

- 创建、提交答案、暂停、恢复均支持 `Idempotency-Key`。
- 会话冻结内容、算法、校准、解释和词表版本。
- 客户端一次只收到一道题；响应中没有正确答案、难度、区分度、曝光量或完整题库。
- Quick Beta 使用 42 题分层固定卷；Standard Beta 使用 140 题平行卷；Calibration 使用 280 题平衡试测卷。
- 校准后的 Quick CAT 为 28–40 题、目标 `SE ≤ 0.45`；Standard CAT 为 40–60 题、目标 `SE ≤ 0.30`，同时强制至少 12 个频段和锚题覆盖。
- CAT 从满足约束且信息量最高的前五题中按会话种子选题，避免单题过度曝光。

部署前依次执行：

```powershell
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm build
```
