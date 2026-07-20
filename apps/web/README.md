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

## 本地听力资料库

无后端演示模式通过 `/api/local-listening` 读取生成的听力目录，并从本地源目录按需流式播放音频和 PDF：

- `MINUTE_EARTH_SOURCE_DIR`：Minute Earth 根目录。
- `BBC_LISTENING_SOURCE_DIR`：BBC 资料根目录。
- `ENABLE_LOCAL_LISTENING=true`：在非演示模式显式启用本地媒体接口。

目录由 `scripts/build-local-listening-library.py` 生成。脚本只把目录、原文和词汇写入仓库，不复制大体积音频；生产环境仍应把媒体上传至 COS，并通过正式 API 返回签名地址。

## 本地 CommonLit 阅读资料库

`scripts/build-local-reading-library.py` 从 CommonLit 保存页和配套 PDF 中生成按 Grade 拆分的文字版文章、原文理解题和讨论题。

- `COMMONLIT_READING_SOURCE_DIR`：原始 PDF 根目录，仅用于网站中的“查看原 PDF”引用。
- `ENABLE_LOCAL_READING=true`：在非演示模式显式启用本地阅读接口。

学生作答草稿和完成状态保存在浏览器本地；原资料未包含标准答案，因此不做伪造的自动评分。
