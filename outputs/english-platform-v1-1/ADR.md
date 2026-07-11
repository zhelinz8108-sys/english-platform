# 个性化英语学习平台 V1.1：架构决策记录

> 文档状态：Accepted
> 基线日期：2026-07-10
> 适用范围：General + TOEFL MVP
> 决策所有者：平台架构组

## 使用约定

- 本文记录“为什么这样设计”及不可违反的工程约束；数据库实体与约束以 [data-model.md](./data-model.md) 为准，HTTP wire contract 以 [openapi-v1.yaml](./openapi-v1.yaml) 为准。
- 状态含义：**Accepted** 表示 V1.1 实施必须遵循；变更必须新增 ADR 并明确 supersedes 关系，不得静默改写已生效决策。
- PostgreSQL 标识符统一使用 <code>snake_case</code>；主键使用 UUIDv7，HTTP wire format 仍声明为 <code>format: uuid</code>。数据库时间列使用 <code>timestamptz</code> 并按 UTC 处理，API 时间使用 UTC RFC 3339。

---

## ADR-001：采用 NestJS 模块化单体与独立 Worker

**状态：** Accepted

**背景：** MVP 需要同时覆盖身份与租户、学生与班级、内容目录、学习路径、任务编排、作答评分、进度和平台运营。团队需要清晰边界、事务一致性和较低运维成本；当前规模尚不足以抵消微服务带来的部署、追踪和分布式一致性成本。

**决策：**

- 官方 Web 端使用 Next.js；后端使用单个 NestJS 应用，按 <code>Identity/Tenant</code>、<code>Student/Class</code>、<code>Catalog</code>、<code>Learning Path</code>、<code>Task Orchestration</code>、<code>Assessment</code>、<code>Progress</code>、<code>Platform</code> 划分模块。
- 模块只能通过公开 application service 或领域事件协作；不得跨模块直接调用 repository。表可以位于同一 PostgreSQL，但每张表必须有唯一负责模块。
- 同步请求在模块化单体内完成；耗时、可重试任务由独立 Worker 进程消费 BullMQ。API 与 Worker 共享领域类型和事件契约，但独立部署、扩缩容和健康检查。
- V1.1 不引入微服务、GraphQL 或独立 AI 服务。只有在独立扩缩容、故障隔离或团队所有权出现可量化瓶颈时，才通过后续 ADR 拆分模块。

**后果 / 取舍：**

- 获得简单部署、单库事务和较低本地开发成本；模块边界为将来拆分保留清晰接缝。
- 单体发布仍可能扩大变更影响面，数据库资源也会共享；需要依赖检查、模块级测试和数据库连接池配额控制耦合。

**验证方式：**

- CI 执行模块依赖规则，拒绝跨模块 repository import 和循环依赖。
- API 与 Worker 可分别启动、扩缩容和通过健康检查；关闭 Worker 不应阻断非异步 API。
- 完成机构开户至教师反馈查看的端到端测试，并证明其不依赖任何外部微服务或 GraphQL endpoint。

---

## ADR-002：共享数据库、共享 Schema 与 PostgreSQL 强制 RLS

**状态：** Accepted

**背景：** 平台正式支持多租户。仅依赖 ORM 查询附加 <code>tenant_id</code> 容易因遗漏条件、后台任务或手写 SQL 产生越权；每租户独立数据库又会显著增加迁移、连接和运维成本。

**决策：**

- 租户业务数据使用同一 PostgreSQL 数据库和共享业务 schema；每张租户业务表必须包含非空 <code>tenant_id</code>。
- 每张租户表建立 <code>UNIQUE (tenant_id, id)</code>，所有租户内关系使用包含 <code>tenant_id</code> 的复合外键，数据库层拒绝跨租户引用。
- 对租户表同时启用 <code>ENABLE ROW LEVEL SECURITY</code> 与 <code>FORCE ROW LEVEL SECURITY</code>。运行时 API、Worker 和 migration 账号分离；API/Worker 账号不得拥有 <code>BYPASSRLS</code>，也不得以表 owner 身份运行。
- 服务端先验证 <code>tenant_memberships</code>，随后在同一数据库事务内使用 transaction-local setting 写入 <code>app.tenant_id</code>、<code>app.user_id</code>、<code>app.membership_id</code>；RLS policy 从这些 setting 读取上下文。缺少或非法上下文时采用 fail-closed，返回空集或拒绝写入。
- 所有租户查询必须在显式事务内执行；禁止使用 session-global tenant setting，避免连接池复用泄漏。受控 migration/运维账号仅用于维护窗口，其操作进入不可变审计日志。
- 无权获知资源存在时 API 返回 404；资源对调用者可见但动作不允许时返回 403。应用层角色与资源关系校验是 RLS 之外的第二道授权。

**后果 / 取舍：**

- 即使 ORM 漏写租户条件，数据库仍提供隔离；共享基础设施便于统一迁移和备份。
- 每个外键和唯一约束更宽，后台任务也必须建立租户上下文；RLS 会增加 SQL 调试和连接池使用复杂度。

**验证方式：**

- 使用 Tenant A 与 Tenant B 对列表、直接 UUID、关联写入、批处理和管理员接口执行越权矩阵，均不得泄露存在性或数据。
- 直接以运行时账号执行故意遗漏 <code>tenant_id</code> 的 SQL，证明 RLS 仍隔离；尝试跨租户复合外键写入必须失败。
- 自动检查所有租户表均具有非空 <code>tenant_id</code>、复合唯一约束、复合外键、<code>FORCE RLS</code>，且运行时账号无 <code>BYPASSRLS</code>。

---

## ADR-003：全局 User、TenantMembership 与多角色授权

**状态：** Accepted

**背景：** 同一个自然人可能同时属于多个机构，并在不同机构担任教师、管理员或学生。把角色直接放在 <code>users</code> 上会导致跨租户权限混淆，也无法表达一个成员的多个租户内角色。

**决策：**

- <code>users</code> 是全局身份主体，只保存登录和全局账户状态；<code>tenant_memberships</code> 表示用户在某租户内的成员身份，并具有独立状态与生命周期。
- 租户内角色通过 <code>membership_roles</code> 和连接表 <code>membership_role_assignments</code> 表达；同一 membership 可同时拥有多个角色。授权取当前 membership 的角色并叠加资源关系，禁止从其他租户继承。
- <code>super_admin</code> 是平台级角色，不写入租户 role assignment；只允许走专用平台入口、强认证和审计，不自动绕过 RLS。
- 多教师班级、班级学生、师生关系和多考试目标分别由 <code>class_teachers</code>、<code>class_students</code>、<code>student_teacher_links</code>、<code>student_exam_goals</code> 表达，不在 <code>users</code> 上存单值快捷字段。
- 登录后必须显式选择或解析当前 tenant；访问每个 tenant 路由时重新校验 membership 为 active。停用 membership 立即撤销该租户访问，不影响用户在其他租户的身份。

**后果 / 取舍：**

- 支持跨机构身份复用和最小权限，模型能准确表达多角色与多教师关系。
- 每次 tenant 请求增加 membership 解析；产品需向多机构用户提供明确的机构切换体验。

**验证方式：**

- 测试同一 user 在 Tenant A 为 teacher、Tenant B 为 student 时只能获得各自权限；停用其中一个 membership 不影响另一个。
- 测试多角色 union、资源关系限制、无 membership、suspended membership 和 super_admin 审计路径。
- 数据库约束必须阻止 role assignment、班级成员和师生关系跨租户引用。

---

## ADR-004：平台只读目录与租户复制编辑

**状态：** Accepted

**背景：** 官方 General/TOEFL 内容需要被所有机构稳定引用，同时机构希望按自身教学需求修改。若机构直接编辑共享记录会影响其他租户；若采用持续继承，官方更新又可能在未确认时改变机构教学内容。

**决策：**

- 官方内容位于独立的 <code>platform</code> schema，例如 <code>platform.contents</code>、<code>platform.content_versions</code>、<code>platform.questions</code>、<code>platform.learning_paths</code> 和 <code>platform.tasks</code>；由 <code>Platform</code> 模块管理。租户运行时账号只能读取已发布版本，只有受控平台发布角色可以写入。
- 机构修改官方内容时执行显式 copy：从 <code>platform</code> schema 复制到含 <code>tenant_id</code> 的 tenant-owned tables，并在对应租户版本记录 <code>source_platform_content_version_id</code>、<code>source_platform_question_version_id</code>、<code>source_platform_learning_path_version_id</code> 或 <code>source_platform_task_version_id</code>；这些 nullable 来源字段只在 clone 时写入，副本后续生命周期完全独立且永不反向写平台表。
- 官方版本升级不会自动覆盖租户副本。界面可以提示有新版本，但比较、重新复制或人工合并必须由有权限的租户成员主动触发。
- 禁止租户对平台实体建立可写 FK 或通过 overlay 字段改变平台记录；学生任务只能引用一个确定的 platform version 或 tenant version。

**后果 / 取舍：**

- 官方内容始终一致，租户修改不会产生侧向影响；已分配内容可精确追溯。
- 复制会产生存储重复，官方修复不会自动传播；需要版本比较和来源展示。

**验证方式：**

- 以租户账号尝试新增、更新、删除 <code>platform</code> schema 目录记录必须失败。
- Tenant A 复制并编辑后，平台版本及 Tenant B 视图保持不变；官方发布新版本后 Tenant A 副本仍指向原来源版本。
- 任务与 attempt 查询必须返回明确的 catalog scope、稳定实体 ID 和 version ID。

---

## ADR-005：稳定实体、不可变发布版本与 Attempt 快照

**状态：** Accepted

**背景：** 内容、题目、路径和任务会持续修改，但历史作答、评分申诉和学习进度必须可重现。直接更新已发布记录会使同一次作答在未来得到不同题面或分数。

**决策：**

- <code>contents</code>、<code>questions</code>、<code>learning_paths</code>、<code>tasks</code> 是稳定实体；可发布数据分别写入 <code>content_versions</code>、<code>question_versions</code>、<code>learning_path_versions</code>、<code>task_versions</code>。
- draft 可编辑；publish 在单一事务中校验完整性并生成新的 version、单调 version number、<code>published_at</code> 和内容 hash。published row 永不原地修改；修正必须发布新版本。archived 只影响新引用，不删除历史版本。
- 创建 <code>task_attempts</code> 时固化 task version、全部 question version、题目顺序、选项顺序、评分规则、满分和内容 hash；提交、自动评分、教师评分、管理员修正和反馈均保存不可变快照。
- 已被 assignment、task item 或 attempt 引用的版本禁止物理删除。最终成绩采用固定优先级：管理员修正 > 教师确认 > 自动评分，并保留每一层结果及操作者。

**后果 / 取舍：**

- 可完整重放历史作答与评分，发布变更不会污染进行中任务。
- 版本与快照增加存储量；内容修复需要新版本和显式迁移，而不是简单 update。

**验证方式：**

- 发布 V2 后重放基于 V1 的 attempt，题面、选项顺序、评分规则、hash 和最终得分必须与原记录一致。
- 数据库触发器或权限必须拒绝更新 published row 和删除被引用版本。
- 对管理员、教师、自动评分同时存在的场景验证最终成绩优先级，并证明底层评分记录未被覆盖。

---

## ADR-006：任务实例物化、来源保留与 slot_key 冲突解析

**状态：** Accepted

**背景：** 学生任务可来自管理员强制、个人、班级、考试路径和 General 路径。运行时临时拼接会导致列表不稳定、难以解释来源，也难以可靠表达隐藏、替换、恢复、改期和重做。

**决策：**

- <code>task_assignments</code> 保存分配配置；学生、班级和路径目标分别使用有真实复合外键的 target 表，禁止 <code>target_type + target_id</code> 多态引用。
- resolver 将结果物化为 <code>student_task_items</code>；<code>student_task_sources</code> 保存所有到达来源。相同 student 与相同 task version 经多个来源到达时只保留一个 item，并幂等追加 source。
- 只有 <code>slot_key</code> 相同的 item 才互相冲突。来源基础优先级固定为：管理员强制 500、个人 400、班级 300、考试路径 200、General 100；同级依次按显式 priority 降序、<code>published_at</code> 降序、UUIDv7 字典序升序稳定决胜。
- 冲突赢家保持 <code>resolution_state=active</code>，其余为 <code>superseded</code>。人工动作通过追加式 <code>student_task_overrides</code> 表达 hide、replace、restore、reschedule、require_redo；不回写或删除历史 source/override。
- 状态分离为 <code>resolution_state</code>（active、hidden、superseded）、<code>workflow_state</code>（not_started、in_progress、submitted、grading、returned、completed、cancelled）和派生 availability（locked、upcoming、available）；overdue、late 仅由时间和提交事实派生，不持久化为独立真相。
- 教师退回时保留同一 <code>task_attempts</code> 记录并进入 returned；学生继续修改时由 returned 转回 in_progress。后续再次提交只向 <code>submission_snapshots</code> 追加递增 revision，不新增 attempt。只有学生显式触发 retry 才创建新的 <code>task_attempts</code> 记录并递增 <code>attempt_no</code>；<code>require_redo</code> 只赋予或要求 retry，不得由 Worker 自动创建 attempt。
- 退班、暂停路径或移除来源仅使无剩余有效来源且未开始的 item 失活；已有 attempt 或 submission 的 item 必须保留。重新解析同一输入必须得到同一排序和同一 item identity。

**后果 / 取舍：**

- 学生列表查询稳定、来源可解释，复杂覆盖行为可审计并能重放。
- resolver 与物化表增加写放大和最终一致性窗口；需要明确的重算任务、唯一约束和告警。

**验证方式：**

- 覆盖五类来源、同 slot 冲突、不同 slot 共存、多来源合并、hide/restore、replace、路径暂停、入班退班和管理员强制任务。
- 对相同输入重复、乱序和并发运行 resolver，item 数量、winner、source 集合和排序必须一致。
- 验证 teacher return 后仍为原 <code>attempt_id</code>，returned → in_progress 后再次提交只递增 SubmissionSnapshot revision；仅学生显式 retry 才生成新 <code>attempt_id</code> 和更大的 <code>attempt_no</code>。
- 验证退班后历史 attempt/submission 仍可读取，且不会生成重复 item。

---

## ADR-007：事务 Outbox、至少一次投递与幂等 Worker

**状态：** Accepted

**背景：** 任务解析、通知和进度统计既要响应数据库变更又要异步执行。直接在事务提交后发队列会出现“数据库成功、消息丢失”，而分布式事务不适合当前架构。

**决策：**

- 产生业务变更的同一 PostgreSQL 事务内写入 <code>outbox_events</code>；事件至少包含 event ID、tenant ID、event type、aggregate ID、schema version、occurred time 和 payload。
- dispatcher 以短租约批量读取未发布事件并投递 BullMQ；投递成功后记录时间。系统承诺 at-least-once，不宣称 exactly-once。
- Worker 在执行副作用前，以 event ID 和业务 natural key 建立唯一处理记录；重复事件返回既有结果。数据库写入与处理记录同事务提交，外部副作用使用供应商幂等键或可查询回执。
- API 幂等使用 <code>idempotency_records</code>，键由 tenant、membership、route、<code>Idempotency-Key</code> 共同限定，并保存请求 hash、状态和响应引用。相同键同 payload 返回原结果；相同键不同 payload 返回 409。
- 失败采用有上限的指数退避；超过阈值进入 DLQ 并告警。重放必须保留原 event ID、tenant context 和 trace ID。

**后果 / 取舍：**

- 消除提交与发消息之间的丢失窗口，并允许安全重放和 Worker 横向扩展。
- 事件可能重复且存在短暂延迟；每个消费者都必须设计幂等，outbox/DLQ 也需要清理和运营工具。

**验证方式：**

- 在业务提交后、投递前、消费中和确认前分别注入进程崩溃，最终业务副作用只能出现一次且事件不会丢失。
- 重放同一 event 100 次，数据库结果和外部副作用保持单一；错误 tenant context 必须 fail-closed。
- 验证相同 <code>Idempotency-Key</code> 的同 payload 返回原响应，不同 payload 返回 RFC 7807 的 409。

---

## ADR-008：Cookie 会话、CSRF 防护与 Refresh Token 轮换

**状态：** Accepted

**背景：** MVP 只服务官方 Web 端。浏览器端持有 bearer token 会扩大 XSS 窃取风险；使用 Cookie 又必须显式防御 CSRF 和 refresh token 重放。

**决策：**

- Access token 存在 <code>access_token</code> Cookie，默认有效期 15 分钟；Refresh token 存在 <code>refresh_token</code> Cookie，滑动有效期 30 天、绝对有效期 90 天。两者均设置 HttpOnly、Secure、SameSite=Lax；access path 为 <code>/</code>，refresh path 限定为 refresh/revoke endpoint。
- 所有改变状态的请求必须同时通过 <code>accessCookie</code> 与 <code>csrfHeader</code>：前端从可读 CSRF token 获取值并发送 <code>X-CSRF-Token</code>，服务端校验 token 与会话绑定值及 Origin。GET/HEAD/OPTIONS 不得产生业务副作用。
- Refresh token 只保存不可逆 hash，并归属 token family；每次 refresh 都轮换并使旧 token 失效。检测到旧 token 复用时撤销整个 family、写入安全审计并要求重新登录。
- 登出撤销当前 family；密码重置、账户停用或高风险安全事件撤销该 user 的全部 family。认证失败返回 401，认证成功但租户授权不足返回 403 或按 ADR-002 返回 404。
- CORS 默认只允许官方 Web origin 且携带 credentials；关键命令仍独立要求 <code>Idempotency-Key</code>，CSRF token 不能替代幂等控制。

**后果 / 取舍：**

- JavaScript 无法直接读取认证 token，refresh 重放可被检测；适合受控的同源 Web 客户端。
- 需要 CSRF token 生命周期、Cookie domain 和多标签页刷新协调；不直接满足第三方 API 或原生 App。

**验证方式：**

- 验证缺失/错误 CSRF、非法 Origin、跨站表单和允许 origin 的正常写请求；所有 Cookie 属性必须由自动化安全测试断言。
- 并发 refresh 只能有一个成功；复用已轮换 token 必须撤销 token family，后续 refresh 均失败。
- XSS 场景下浏览器脚本不可读取 <code>access_token</code> 或 <code>refresh_token</code>。

---

## ADR-009：OpenAPI 3.1 是 HTTP 契约唯一真相源

**状态：** Accepted

**背景：** 原需求中的路由、枚举、错误和字段命名存在不一致。手写 Controller、前端类型和文档会继续漂移，并使并发、幂等和权限行为无法验收。

**决策：**

- [openapi-v1.yaml](./openapi-v1.yaml) 使用 OpenAPI 3.1，并作为所有公开 HTTP route、schema、enum、security requirement 和 error response 的唯一真相源；服务端 DTO、客户端类型和 contract test 从其生成或与其校验。
- 租户资源统一位于 <code>/api/v1/tenants/{tenantId}/...</code>；标识符在 wire 中使用 <code>format: uuid</code>（服务端生成 UUIDv7），时间使用 UTC RFC 3339，并统一采用游标分页。错误使用 <code>application/problem+json</code> 的 RFC 7807 结构，并附稳定 machine-readable error code 和 trace ID。
- 发布、分配、开始 attempt、提交、评分、退回等关键命令强制 <code>Idempotency-Key</code>。草稿保存使用 revision 与 ETag；<code>If-Match</code> 不匹配返回 412，业务状态冲突或幂等键复用冲突返回 409。
- 写请求使用 <code>accessCookie + csrfHeader</code>；refresh endpoint 使用 <code>refreshCookie + csrfHeader</code>。响应不得把 Cookie token 暴露在 JSON body。
- v1 只允许向后兼容的可选字段和新 endpoint；删除/重命名字段、收紧既有 enum 或改变语义必须发布新 major version 并新增 ADR。

**后果 / 取舍：**

- 前后端、测试和文档共享可执行契约，错误及幂等行为可自动验证。
- 契约变更需要先更新规范并通过兼容性检查；生成代码会限制临时、未建模的响应。

**验证方式：**

- CI 校验 OpenAPI 语法、operationId 唯一性、breaking change、示例与 schema，并执行生成客户端对真实 API 的 contract test。
- 对每个关键命令验证缺少 <code>Idempotency-Key</code>、重复请求、409 与 412；对每个租户 route 验证 security requirement 和 tenantId。
- 扫描 Controller，禁止存在未在 OpenAPI 声明的公开 route 或响应字段。

---

## ADR-010：私有对象存储与租户隔离

**状态：** Accepted

**背景：** 内容附件、导入文件和未来扩展会进入 S3 兼容对象存储。仅依赖不可猜测 key 或公开 URL 不能满足租户隔离，Worker 和预签名上传也可能绕开 API 的 RLS。

**决策：**

- 所有 bucket 默认 private；平台目录和租户对象使用独立 bucket 或不可交叠 prefix。租户 object key 由服务端生成并强制包含 <code>tenants/{tenantId}/</code>，不得接受客户端提供完整 key。
- 对象 metadata 必须记录 tenant ID、owner entity、content type、size、checksum 和 lifecycle state；数据库对象记录是授权真相，任何下载或处理都先在租户事务中验证记录。
- 上传采用短时预签名 URL，只允许固定 key、method、content type 与 size；上传后进入 quarantine，服务端校验 checksum、实际 MIME、大小和恶意内容后才标记 available。
- 下载使用短时预签名 URL 或后端代理；禁止永久公开 URL。Worker 必须从 event 恢复 tenant context，并再次校验 object key prefix 与数据库 metadata。
- 传输使用 TLS，静态数据使用服务端加密；日志、trace 和错误不得记录预签名 URL、凭据或原始敏感内容。生命周期删除先满足业务保留、审计和 legal hold。

**后果 / 取舍：**

- 即使对象 key 泄露，仍有时间、签名和数据库授权边界；平台与租户资源不会混放。
- 上传增加 finalize/scan 阶段和短暂等待；私有下载需要签名服务并增加对象 metadata 管理。

**验证方式：**

- Tenant A 无法为 Tenant B 的 key 获取上传/下载签名；篡改 prefix、metadata、content type、size 或 checksum 必须失败。
- 验证过期 URL、重复 finalize、quarantine 文件、Worker 跨租户事件和删除保留策略。
- 自动扫描 bucket policy，拒绝 public access，并审计对象 key 与数据库 tenant ID 一致性。

---

## ADR-011：中国大陆隐私与未成年人数据基线

**状态：** Accepted

**背景：** 首发面向中国大陆，学生可能是未成年人。账号、学习行为、教师评价和未满十四周岁学生信息可能具有较高权益风险；产品必须在设计阶段落实最小必要、目的限定和可审计的数据生命周期。本 ADR 是工程基线，不替代上线前的专业法律意见。

**决策：**

- 生产主存储、备份、日志、对象存储和默认监控均部署在中国大陆区域；跨境传输默认关闭。任何新增境外接收方、境外 SaaS 或远程支持访问必须先完成数据出境识别、影响评估、批准和适用法定程序。
- 建立字段级 data inventory，记录处理目的、法律基础、敏感级别、数据主体、接收方、保留期限和删除方式。只收集核心学习闭环所需数据；年龄判断优先保存 age band，非必要不保存完整生日、身份证件或精确位置。
- 不满十四周岁用户的个人信息按敏感个人信息处理：取得父母或其他监护人可验证同意，提供专门处理规则、撤回通道和严格访问控制；未完成同意不得创建可用学生账户或导入其学习数据。
- 提供访问、更正、删除、撤回同意和注销流程；删除请求在验证身份与保留义务后执行删除或不可逆匿名化，并同步主库、对象存储、搜索/缓存和下游任务。备份中的数据按轮换周期到期，恢复时重新应用 deletion ledger。
- 敏感字段传输和静态加密；支持人员默认不可查看学生正文，临时授权需工单、最小范围、到期时间和审计。日志/trace 使用 ID 与脱敏摘要，不记录答案正文、token、监护人证明或联系方式明文。
- 上线前由隐私/法务确定各数据类别保留期、监护人同意证据、隐私告知文本和处理者/受托处理者责任；配置未获书面签字不得进入 production。

**后果 / 取舍：**

- 降低未成年人和敏感信息风险，并为权利请求、审计和数据出境判断保留证据。
- 监护人同意会增加开户摩擦，境内优先限制部分全球 SaaS；删除编排和备份 ledger 增加工程成本。

**验证方式：**

- 上线 gate 必须包含 data inventory、个人信息保护影响评估、供应商清单、保留期签字和未成年人专门规则。
- 测试未满十四周岁无同意/撤回同意、越权客服访问、数据导出、更正、注销、对象删除、缓存失效和备份恢复后的再次删除。
- 每季度抽查审计日志和权限，每年至少完成一次未成年人数据与数据出境专项复核。

**规范依据（核对日期：2026-07-10）：**

- [《中华人民共和国个人信息保护法》](https://www.miit.gov.cn/jgsj/zfs/fl/art/2022/art_515a4b20c12f430eab54bb4f56d89f56.html)：不满十四周岁未成年人的个人信息属于敏感个人信息，处理时需取得监护人同意并制定专门规则。
- [《未成年人网络保护条例》](https://www.cac.gov.cn/2023-10/24/c_1699806932316206.htm)：在线教育服务需按未成年人不同年龄阶段提供适配保护。
- [国家网信办数据出境政策问答（2025 年 4 月）](https://www.cac.gov.cn/2025-04/09/c_1745906286623776.htm)：数据出境须按数据类型与情形选择适用的安全评估、标准合同或认证等路径。

---

## ADR-012：收敛 General + TOEFL MVP，并明确 Post-MVP

**状态：** Accepted

**背景：** 原方案同时覆盖多个考试、AI、口语、移动端和开放平台，超出首版验证核心教学闭环所需范围，也会迫使身份、媒体、模型治理和第三方兼容性过早复杂化。

**决策：**

- MVP 只交付官方 Web 端上的 General + TOEFL：机构与账号、学生/教师/班级关系、官方与租户内容目录、学习路径、教师分配、学生任务列表、客观题与文本写作、自动客观评分、教师写作批改与反馈、基础结果和进度。
- 基础 CMS 支持人工编辑与结构化批量导入；不包含内容市场、直播或第三方发布。
- Post-MVP 明确后置：AI 评分与推荐、IELTS/SAT/高考等其他考试、口语录音/转录、视频流媒体、原生移动端、家长账号、GraphQL、第三方开放 API、SSO、完整错题本、高级统计、直播和课程市场。
- 后置能力不得以隐藏 endpoint、未验收 schema 或 production feature flag 形式半实现。只保留必要扩展点：模块边界、versioned event、OpenAPI major version 和对象类型枚举的兼容演进机制。
- 任何后置项进入开发前必须新增或更新 ADR，说明数据类别、权限、成本、SLO 和与现有契约的兼容策略。

**后果 / 取舍：**

- 团队可以围绕完整纵向闭环验收，降低首发风险并缩短反馈周期。
- 首版不能满足口语、多考试、家长或生态集成需求；部分潜在客户需等待后续版本。

**验证方式：**

- 需求、OpenAPI、数据模型、测试矩阵和 UI 导航对 MVP capability 做双向追踪，所有必需能力至少有一条端到端验收。
- CI/发布清单确认不存在 Post-MVP 公开 route、后台入口、队列 consumer 或可访问 feature flag。
- 完成“机构开户 → 学生加入 → 路径分配 → 教师布置 → 学生作答 → 客观评分/写作批改 → 反馈与基础进度”的端到端演示。

---

## ADR-013：可观测性、PITR 与恢复目标

**状态：** Accepted

**背景：** 多租户权限、异步解析和不可变作答记录要求问题可追踪且可恢复。只做应用备份而不定义恢复目标、队列积压和跨服务 trace，无法证明生产可运营。

**决策：**

- API、Worker、dispatcher 和定时任务输出结构化日志，并统一携带 trace ID、tenant ID、membership ID、operationId、event ID；禁止写入 token、Cookie、答案正文和敏感字段。
- 使用 OpenTelemetry 串联 HTTP、PostgreSQL、Redis/BullMQ 与 Worker；应用异常进入 Sentry 或境内合规的等价服务。关键指标包括 API latency/error、DB saturation、outbox age、queue lag、DLQ count、resolver duration 和 autosave conflict。
- PostgreSQL 开启连续归档与 point-in-time recovery；生产目标为 RPO ≤ 15 分钟、RTO ≤ 4 小时。对象存储启用版本/备份策略，Redis/BullMQ 不作为唯一业务真相。
- migration 必须可前向兼容滚动部署，并在 staging 以生产规模副本演练；破坏性变更采用 expand-and-contract。每季度执行恢复演练并记录实际 RPO/RTO。
- 常规 API 目标 P95 < 500 ms，autosave P95 < 300 ms；以 1,000 并发用户进行发布前基准测试。SLO 超限、outbox/queue lag 和 DLQ 非零持续状态必须告警。

**后果 / 取舍：**

- 生产问题可跨请求和事件追踪，恢复能力有可测目标。
- 增加遥测、归档存储和演练成本；高基数字段必须受控，敏感内容不可用于调试捷径。

**验证方式：**

- 从一次分配请求追踪到 outbox、resolver、student task item 和通知；trace 中 tenant context 连续且无敏感值。
- 在隔离环境从备份与归档恢复数据库和对象引用，实测并记录 RPO/RTO，随后重放未完成 outbox。
- 以 1,000 并发用户执行 API 与 autosave 压测，并通过故障注入验证队列积压、DLQ、数据库饱和和错误率告警。

---

## 决策一致性检查

交付前必须确认以下跨文档不变量：

1. [data-model.md](./data-model.md) 中的表名、状态枚举、复合外键、RLS、版本和快照模型与 ADR-002 至 ADR-007 一致。
2. [openapi-v1.yaml](./openapi-v1.yaml) 中的路径、Cookie/CSRF security scheme、<code>Idempotency-Key</code>、ETag、409/412 和 RFC 7807 与 ADR-008、ADR-009 一致。
3. [权限与租户测试矩阵.xlsx](./权限与租户测试矩阵.xlsx) 覆盖 RLS、对象存储、Worker、平台角色、任务冲突、历史重放、幂等与未成年人数据场景。
4. 主开发者文档引用这些 ADR，不复制出第二套相互冲突的规则。
