# 腾讯云生产部署手册

本文用于把当前英语学习平台部署到腾讯云。首发采用单台 CVM 运行 Web、API、Worker 和 HTTPS 入口，PostgreSQL、Redis、音频存储使用腾讯云托管服务。开发用 PostgreSQL、Redis 和 MinIO 不进入生产环境。

## 1. 首发架构

```mermaid
flowchart LR
  Student["中国大陆学生浏览器"] --> DNS["域名 / DNSPod"]
  DNS --> Caddy["CVM · Caddy HTTPS"]
  Caddy --> Web["Next.js Web"]
  Web --> API["NestJS API"]
  API --> PG[("TencentDB PostgreSQL · RLS")]
  API --> Redis[("TencentDB Redis · BullMQ")]
  API --> COS["私有 COS · 音频与附件"]
  Worker["BullMQ Worker"] --> PG
  Worker --> Redis
```

建议所有资源使用同一腾讯云账号、地域、VPC 和可用区组。面向全国学生且没有更明确分布数据时，上海是可用默认；若学生主要在华南或华北，分别选择广州或北京。不要跨地域部署 CVM、数据库、Redis 和 COS。

首发容量基线：

| 资源       | 建议起步配置                             | 说明                                               |
| ---------- | ---------------------------------------- | -------------------------------------------------- |
| CVM        | 4 核 8 GB、100 GB 云硬盘                 | 运行 4 个容器；低于 2 核 4 GB 不建议正式首发       |
| PostgreSQL | PostgreSQL 17、2 核 4 GB、100 GB、高可用 | 开启自动备份和日志备份/PITR                        |
| Redis      | 1 GB、高可用                             | 只走 VPC，淘汰策略设为 `noeviction`                |
| COS        | 私有读写、标准存储                       | 约 200 GB 音频；开启版本控制、服务端加密和生命周期 |
| 域名与证书 | 已备案域名；Caddy 自动申请证书           | 后续多 CVM 时换为 CLB 托管证书                     |

## 2. 上线前的硬性条件

1. 腾讯云账号完成实名认证。
2. 购买或转入一个域名并完成域名实名。
3. 如果 CVM 位于中国大陆，网站对外服务前完成 ICP 备案；从其他服务商迁入时办理接入备案。
4. 确认网站的教育业务分类是否需要前置审批，并把隐私政策、用户协议、未成年人信息处理规则和数据保留期限交由合规负责人签字。
5. 准备一个只能访问本项目资源的 CAM 子账号。不要把主账号永久密钥写进服务器。

如果域名暂时未备案，可以先在腾讯云香港地域搭建验收环境；这不是面向大陆学生的正式长期方案。正式上线仍建议迁回大陆同地域资源。

## 3. 创建云资源

### 3.1 VPC 与安全组

创建一个 VPC 和至少两个子网。CVM、PostgreSQL 和 Redis 放在同一 VPC。安全组只允许：

| 端口             | 来源                | 用途                   |
| ---------------- | ------------------- | ---------------------- |
| 80/TCP           | `0.0.0.0/0`、`::/0` | ACME 验证和 HTTPS 跳转 |
| 443/TCP、443/UDP | `0.0.0.0/0`、`::/0` | HTTPS / HTTP/3         |
| 22/TCP           | 管理员固定公网 IP   | SSH；不要对全网开放    |
| 5432/TCP         | 仅 CVM 安全组       | PostgreSQL 内网连接    |
| 6379/TCP         | 仅 CVM 安全组       | Redis 内网连接         |

不要开放 3000、4000、5432、6379 到公网。API 只接受 Docker 内网中的 Web 代理访问。

### 3.2 TencentDB for PostgreSQL

创建名为 `english_platform` 的数据库，并创建以下账号：

- `english_owner`：`pg_tencentdb_superuser` 类型，作为数据库 OWNER，只用于建库、迁移和恢复。
- `english_app`：普通账号，只供 API 使用。
- `english_worker`：普通账号，只供 Worker 使用。

账号名称不能改，因为 RLS 和安全函数会校验 `english_worker`。给三个账号分别生成独立的长随机密码。

在同 VPC 的 CVM 安装 `psql`，使用 `english_owner` 执行一次：

```bash
psql "$DATABASE_ADMIN_URL" -f deploy/tencent-cloud/bootstrap-postgres.sql
```

脚本会确认两个运行账号存在，创建安全函数所需的无登录角色，强制运行账号启用 RLS，并撤销 `public` 的多余建表权限。完成后不要让 API 或 Worker 使用 `english_owner`。

在控制台设置每日自动备份、保留至少 7 天，并保持日志备份开启以支持 PITR。上线前做一次克隆恢复演练。

### 3.3 TencentDB for Redis

创建高可用 Redis，使用 VPC 地址和独立强密码。参数 `maxmemory-policy` 设为 `noeviction`，不要开启公网地址。Redis 不是业务事实源；队列丢失后由 PostgreSQL Outbox 重放。

### 3.4 COS 音频桶

创建与 CVM 相同地域的普通 COS 存储桶：

- 访问权限：私有读写。
- 存储桶名称：例如 `english-platform-private-APPID`，环境变量必须包含 APPID 后缀。
- 版本控制：开启。
- 服务端加密：开启。
- CORS：只允许正式站点 Origin；方法 `GET`、`HEAD`、`PUT`；请求头允许 `*`；暴露响应头 `ETag`；不要使用 `*` Origin。

创建专用 CAM 子账号，只授予该桶对象读写权限。`S3_ENDPOINT` 使用地域服务地址，例如上海为 `https://cos.ap-shanghai.myqcloud.com`，`S3_FORCE_PATH_STYLE=false`。浏览器只拿到短期预签名 URL，不拿永久密钥。

## 4. 准备 CVM

推荐 TencentOS Server 或当前受支持的 Ubuntu LTS。安装 Git、Docker Engine 和 Compose Plugin，将当前仓库克隆到 `/opt/english-platform`：

```bash
sudo mkdir -p /opt/english-platform
sudo chown "$USER":"$USER" /opt/english-platform
git clone https://github.com/zhelinz8108-sys/english-platform.git /opt/english-platform
cd /opt/english-platform
```

生成生产环境文件：

```bash
cp deploy/tencent-cloud/.env.production.example deploy/tencent-cloud/.env.production
chmod 600 deploy/tencent-cloud/.env.production
```

填写真实域名、三个数据库连接串、Redis VPC 地址、两个独立应用密钥和 COS 专用密钥。密码在 URL 中必须进行百分号编码。禁止提交 `.env.production`；仓库已全局忽略该文件。

将域名 A/AAAA 记录指向 CVM 公网地址。大陆 CVM 必须等备案通过并完成腾讯云接入后再提供公开访问。

## 5. 首次启动

先校验 Compose 展开结果，再构建和启动：

```bash
cd /opt/english-platform
docker compose \
  --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml config --quiet

docker compose \
  --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml up -d --build
```

`migrate` 会先执行只向前的数据库迁移；迁移成功后 API、Worker、Web 和 Caddy 才启动。Caddy 会为 `SITE_DOMAIN` 自动申请并续期 HTTPS 证书。

创建第一个真实机构和 Owner。密码只通过这条一次性命令传入，不要写入 `.env.production`：

```bash
docker compose \
  --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml \
  --profile bootstrap run --rm \
  -e BOOTSTRAP_TENANT_NAME='你的机构名称' \
  -e BOOTSTRAP_TENANT_SLUG='your-academy' \
  -e BOOTSTRAP_OWNER_EMAIL='owner@example.com' \
  -e BOOTSTRAP_OWNER_DISPLAY_NAME='机构管理员' \
  -e BOOTSTRAP_OWNER_PASSWORD='使用密码管理器生成的长密码' \
  bootstrap
```

命令输出 `tenantId`。保存它，后续导入听力音频和学习资料时使用。

## 6. 导入 270 个听力音频与学习资料

目前整理后的音频源目录在 Windows：`D:\留学\托福\听力\Minute Earth_仅讲话`。第一次上线可直接从 Windows 通过 COS S3 兼容接口导入；Windows 需要能访问 TencentDB，正式环境建议通过临时 SSH 隧道连接数据库，不要长期开放数据库公网地址。

在本地临时环境文件中配置生产 `IMPORT_DATABASE_URL`、COS 变量和刚生成的 `tenantId`，然后运行：

```powershell
$env:IMPORT_DATABASE_URL='postgresql://english_owner:...@127.0.0.1:15432/english_platform'
$env:S3_ENDPOINT='https://cos.ap-shanghai.myqcloud.com'
$env:S3_REGION='ap-shanghai'
$env:S3_BUCKET='english-platform-private-APPID'
$env:S3_ACCESS_KEY='专用 SecretId'
$env:S3_SECRET_KEY='专用 SecretKey'
$env:S3_FORCE_PATH_STYLE='false'

pnpm --filter @english/api import:minute-earth -- \
  --source='D:\留学\托福\听力\Minute Earth_仅讲话' \
  --tenant='生产 tenantId'

pnpm --filter @english/api import:minute-earth-study-content -- \
  --source='解析后的 MinuteEarth 学习资料 JSON' \
  --tenant='生产 tenantId'
```

导入脚本会保持对象 key、数据库记录和 SHA-256 一致。导入完成后立即关闭 SSH 隧道并清除当前终端中的临时密钥。未来约 200 GB 音频继续进入 COS，不复制到 CVM 系统盘。

## 7. 验收

```bash
curl -I "https://$SITE_DOMAIN"
curl -fsS "https://$SITE_DOMAIN/healthz"
docker compose --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml ps
docker compose --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml logs --tail=200 api worker web caddy
```

浏览器验收至少覆盖：Owner 登录、托福听力列表、随机三条音频播放、词汇发音、原文显示、创建教师/学生、布置任务、学生提交和教师批改。确认音频请求是有过期时间的 COS 签名 URL，未出现永久密钥。

## 8. 日常发布与回滚

每次发布使用不可变 `IMAGE_TAG` 或 Git commit SHA：

```bash
git pull --ff-only
# 修改 deploy/tencent-cloud/.env.production 中的 IMAGE_TAG
docker compose --env-file deploy/tencent-cloud/.env.production \
  -f deploy/tencent-cloud/docker-compose.prod.yml up -d --build
```

发布顺序固定为迁移、API、Worker、Web。Schema 只向前迁移；应用故障时切回上一个 Git commit / 镜像标签，不执行在线 SQL 回滚。生产日志采用轮换的 JSON 文件；正式运营前接入腾讯云 CLS/云监控，并按 `docs/operations.md` 配置 API 5xx、P95、Outbox、BullMQ、数据库容量和备份告警。

当单台 CVM CPU 长期超过 60% 或需要无中断发布时，把 Web/API 复制到两台 CVM 并前置 CLB；Worker 保持单独部署并按队列并发扩容。首发阶段无需 TKE。
