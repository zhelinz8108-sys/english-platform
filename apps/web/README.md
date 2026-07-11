# Official Web

Next.js 16 App Router 官方 Web 客户端，覆盖学生、教师与机构管理员 MVP。

## 本地运行

1. 复制 .env.local.example 为 .env.local。
2. 默认配置使用真实本地 API，seed 学生账号为 student@example.test，
   密码为 Demo123!。
3. 同源代理设置服务端 API_ORIGIN=http://localhost:4000；也可设置
   NEXT_PUBLIC_API_ORIGIN=http://localhost:4000 由浏览器直接访问。
4. 只有在明确需要无后端演示时，才设置 NEXT_PUBLIC_DEMO_MODE=true。
5. 运行 pnpm dev。

所有请求携带 Cookie credentials；写请求先取得 CSRF token，并按契约发送
X-CSRF-Token。关键命令使用 Idempotency-Key，错误按 RFC 7807 展示。
