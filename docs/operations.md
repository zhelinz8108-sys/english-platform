# 运行与恢复手册

本文是 V1.1 的最小生产运行基线。示例命令使用本地 Compose 名称；云环境应映射到托管 PostgreSQL、Redis 和 S3 服务。

## 发布顺序

1. 对 PostgreSQL 创建可恢复快照并确认最近一次 PITR 恢复演练成功。
2. 以 `english_owner` 执行 `pnpm db:migrate`。迁移使用 advisory lock、文件校验和和逐文件事务。
3. 发布 API。`/health/live` 只表示进程存活；`/health/ready` 成功后才接流量。
4. 发布 Worker，观察 Outbox pending 数、BullMQ failed/delayed 数和处理延迟。
5. 发布 Web，完成登录、任务列表、一次草稿保存和一次只读管理员查询的冒烟验证。

迁移只允许前进，不在线回滚 SQL。发生兼容性问题时回滚应用版本；破坏性 Schema 变更必须经过“先扩展、双写/回填、再收缩”多个版本。

## 备份与目标

- PostgreSQL 开启持续 WAL 归档和每日全量备份，目标 RPO 15 分钟、RTO 4 小时。
- S3 开启版本控制、服务端加密和生命周期策略；应用数据库只保存对象 key、哈希与状态。
- Redis/BullMQ 不作为业务事实源。队列丢失时由 Outbox `pending/processing` 状态重新投递。
- Refresh Token 只存哈希；日志、Tracing 和错误事件不得包含 Cookie、Token、答案正文或题目 answer key。

本地逻辑备份：

```powershell
docker exec english-platform-postgres-1 pg_dump -U english_owner -d english_platform -Fc -f /tmp/english-platform.dump
docker cp english-platform-postgres-1:/tmp/english-platform.dump ./english-platform.dump
```

恢复演练必须在隔离实例执行，验证：迁移版本、租户 RLS、用户登录、Attempt 快照、最新评分决策、对象 HEAD 校验和 Outbox 重放。不要直接覆盖正在服务的生产数据库。

## 告警基线

API 以 JSON 输出结构化事件。配置 `SENTRY_DSN` 可启用未预期异常上报；配置 `OTEL_EXPORTER_OTLP_ENDPOINT`（基础地址）或 `OTEL_EXPORTER_OTLP_TRACES_ENDPOINT`（完整 traces 地址）可启用 OpenTelemetry。SDK 会在 NestJS 载入前初始化，并在 SIGINT/SIGTERM 时刷新后退出。不得在日志、仪表盘标签或告警正文中记录 DSN、Cookie、Refresh Token、答题内容或对象存储签名 URL。

| 信号         | 告警条件                            | 处置                                           |
| ------------ | ----------------------------------- | ---------------------------------------------- |
| API 5xx      | 5 分钟错误率 > 1%                   | 按 requestId 关联日志/Trace，必要时摘除新版本  |
| API 延迟     | 常规 API P95 >= 500 ms 持续 10 分钟 | 检查慢 SQL、连接池与下游对象存储               |
| 自动保存     | P95 >= 300 ms 持续 10 分钟          | 检查行锁、ETag 冲突率和数据库写延迟            |
| Outbox       | 最老 pending 事件 > 2 分钟          | 检查 claim 函数、Worker/Redis 连通性           |
| BullMQ       | failed > 0 或 delayed 持续增长      | 查看 eventId；修复后重放，禁止手工重复业务写入 |
| PostgreSQL   | 复制/WAL 延迟接近 15 分钟           | 立即修复归档或副本，暂停高风险发布             |
| 对象上传     | quarantined 或 complete 409 激增    | 检查代理、Content-Length、SHA-256 与 S3 凭据   |
| Refresh 复用 | `reuse_detected_at` 出现            | 撤销 token family，通知账号所有者并审计来源    |

性能验收的默认基线是 1000 个活跃虚拟用户、最多 100 个同时在途请求；它复用已认证会话，目标为常规 API P95 < 500 ms、自动保存 P95 < 300 ms。`LOAD_MAX_IN_FLIGHT=1000` 是单实例尖峰探测，不与常规 SLO 混为一谈；尖峰不达标时应扩展 API 副本并用连接池代理保护 PostgreSQL。

## 安全验收

每次迁移后执行：

```bash
pnpm test:security
```

该测试在单事务内创建 A/B 两个临时租户并回滚，证明运行账号无 `BYPASSRLS`、所有租户表强制 RLS、无上下文和错配上下文不可见、复合外键阻止跨租户引用、应用账号不能直接读取 answer key。

每季度至少执行一次完整恢复演练，并保存恢复开始时间、可用时间、恢复点、校验结果和未达标整改项。
