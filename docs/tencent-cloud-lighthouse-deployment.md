# 腾讯云轻量服务器低成本部署

本方案针对一台已有 Nginx 和其他项目的 2 核 2 GB 腾讯云轻量应用服务器。英语平台使用独立 Docker 网络、独立 PostgreSQL/Redis 数据卷和本机 `3100` 端口，不占用现有项目的 `3000`、`3001`、`80`、`443` 或主机 PostgreSQL `5432`。

生产音频必须放私有 COS，不写入 40 GB 系统盘。现有 Nginx 继续统一处理域名和 HTTPS。

## 已验证资源占用

本地完整启动并完成迁移、机构初始化和健康检查后，各容器空闲内存约为：

| 容器       | 实际内存 | 强制上限 |
| ---------- | -------: | -------: |
| Web        |    44 MB |   256 MB |
| API        |    52 MB |   320 MB |
| Worker     |    27 MB |   192 MB |
| PostgreSQL |    38 MB |   256 MB |
| Redis      |     4 MB |    96 MB |

实际总计约 165 MB。上限用于阻止英语平台挤占现有项目；高峰容量仍需用 40 人场景做真实压测。

## 上线顺序

1. 在腾讯云控制台为服务器创建快照。
2. 为英语平台准备一个独立子域名，例如 `english.example.com`，将 A 记录指向服务器公网 IP。
3. 创建上海地域的私有 COS 普通存储桶，配置正式站点的 CORS 和最小权限 CAM 密钥。
4. 安装 Docker Engine 和 Compose Plugin。
5. 克隆 GitHub 仓库并填写轻量服务器环境文件。
6. 顺序构建镜像并启动容器。
7. 在现有 Nginx 中新增站点，签发 HTTPS 证书。
8. 创建第一个真实机构和 Owner，导入听力音频与学习资料。

## 安装 Docker

按 Docker 官方 Ubuntu 安装文档配置官方 APT 仓库，然后安装 Docker Engine 与 Compose Plugin。安装完成后验证：

```bash
sudo docker version
sudo docker compose version
```

不要删除或修改现有 Nginx、PM2、`study-plan.service` 或主机 PostgreSQL。

## 准备项目

```bash
sudo mkdir -p /opt/english-platform
sudo chown "$USER":"$USER" /opt/english-platform
git clone https://github.com/zhelinz8108-sys/english-platform.git /opt/english-platform
cd /opt/english-platform
cp deploy/tencent-cloud/.env.lighthouse.example deploy/tencent-cloud/.env.lighthouse
chmod 600 deploy/tencent-cloud/.env.lighthouse
```

使用 `openssl rand -hex 32` 分别生成三个数据库密码、JWT 密钥和 CSRF 密钥。十六进制密码不需要额外 URL 编码。填写正式域名、COS Bucket、专用 CAM SecretId/SecretKey；不得提交 `.env.lighthouse`。

## 构建与启动

2 GB 服务器必须顺序构建，避免三个构建任务同时争抢内存：

```bash
cd /opt/english-platform

sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml build api

sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml build worker

sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml build web

sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml up -d
```

验证：

```bash
curl -fsS http://127.0.0.1:3100/healthz
sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml ps
sudo docker stats --no-stream
```

确认镜像无须回滚后可清理构建缓存，但不要删除运行中的镜像或数据卷：

```bash
sudo docker builder prune -f
```

## 接入现有 Nginx

复制 `deploy/tencent-cloud/nginx-lighthouse.conf.example` 到 `/etc/nginx/sites-available/english-platform`，把示例域名替换为正式域名，然后启用：

```bash
sudo ln -s /etc/nginx/sites-available/english-platform /etc/nginx/sites-enabled/english-platform
sudo nginx -t
sudo systemctl reload nginx
```

域名解析生效后，用服务器现有的 Certbot 为新子域名签发证书。签发前确保 HTTP 页面能访问，签发后把环境变量 `WEB_ORIGIN` 保持为相同的 `https://` 地址。

## 创建首个机构

```bash
sudo docker compose \
  --env-file deploy/tencent-cloud/.env.lighthouse \
  -f deploy/tencent-cloud/docker-compose.lighthouse.yml \
  --profile bootstrap run --rm \
  -e BOOTSTRAP_TENANT_NAME='你的机构名称' \
  -e BOOTSTRAP_TENANT_SLUG='your-academy' \
  -e BOOTSTRAP_OWNER_EMAIL='owner@example.com' \
  -e BOOTSTRAP_OWNER_DISPLAY_NAME='机构管理员' \
  -e BOOTSTRAP_OWNER_PASSWORD='密码管理器生成的长密码' \
  bootstrap
```

保存命令输出的 `tenantId`，音频和学习资料导入时必须使用它。

## 安全与备份

- 防火墙只开放 22、80、443；3100 只绑定 `127.0.0.1`。
- 英语平台的 PostgreSQL/Redis 不发布任何主机端口。
- 不复用原有两个项目的数据库、Node 运行时或进程管理器。
- 每日对 `lighthouse-postgres-data` 中的数据库执行逻辑备份并上传私有 COS。
- 发布前创建快照；每次发布后检查旧项目和英语平台三个域名。
- 英语平台总内存上限约 1.1 GB，主机已有 2 GB Swap；若持续换页或 OOM，升级当前实例到 4 GB 或迁移到独立实例。
