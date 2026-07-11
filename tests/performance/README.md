# Performance smoke

默认场景模拟 1000 个处于活跃学习会话中的虚拟用户，并将同时在途请求限制为 100；这对应有阅读/作答思考时间的常规在线负载，而不是 1000 个请求在同一毫秒到达的尖峰。虚拟用户复用一个已认证的种子会话，因此该场景衡量在线 API/RLS 热路径，不包含 1000 次 Argon2 登录或 1000 个独立 Session 的冷启动成本。常规任务列表必须满足 P95 < 500 ms，连续自动保存必须满足 P95 < 300 ms，且所有 1000 次请求均成功。

```bash
pnpm test:performance
```

可以显式提高在途请求数做容量/尖峰探测；输出会保留真实延迟，目标值必须由调用者明确设置，不能把尖峰结果冒充常规 SLO：

```bash
LOAD_VIRTUAL_USERS=1000 LOAD_MAX_IN_FLIGHT=1000 API_P95_TARGET_MS=2500 pnpm test:performance
```

PowerShell 使用 `$env:LOAD_VIRTUAL_USERS='1000'` 等环境变量。单实例尖峰超过常规 SLO 时，应扩展 API 副本、使用连接池代理并按数据库容量限制每副本连接数，而不是无限增大 PostgreSQL 连接池。测试应在干净的端到端流程之后、API 与 Worker 均运行时执行。
